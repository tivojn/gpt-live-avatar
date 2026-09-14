'use strict';
const {readJSON}=require('./delegate-auth.cjs');
const DEFAULT_MODELS={'openai:api_key':'gpt-5.6-luna','openai:oauth2':'gpt-5.6-sol','xai:api_key':'grok-4.6','xai:oauth2':'grok-4.6'};
const MODEL_CHOICES={openai:['gpt-5.6-luna','gpt-5.6-sol','gpt-5.6-terra'],xai:['grok-4.6','grok-build']};
const validModel=m=>typeof m==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/.test(m);
function normalizeDelegate(config,patch={}){
  const mode=['managed','delegate'].includes(patch.reasoningMode)?patch.reasoningMode:(['managed','delegate'].includes(config.reasoningMode)?config.reasoningMode:'managed');
  const provider=['openai','xai'].includes(patch.delegateProvider)?patch.delegateProvider:(['openai','xai'].includes(config.delegateProvider)?config.delegateProvider:'openai');
  const auth=['api_key','oauth2'].includes(patch.delegateAuth)?patch.delegateAuth:(['api_key','oauth2'].includes(config.delegateAuth)?config.delegateAuth:'api_key');
  const models={...DEFAULT_MODELS};for(const key of Object.keys(models))if(validModel(config.delegateModels?.[key]))models[key]=config.delegateModels[key];
  if(validModel(patch.delegateModel))models[provider+':'+auth]=patch.delegateModel;
  return {reasoningMode:mode,delegateProvider:provider,delegateAuth:auth,delegateModels:models};
}
function selected(config){const c=normalizeDelegate(config);return {provider:c.delegateProvider,auth:c.delegateAuth,model:c.delegateModels[c.delegateProvider+':'+c.delegateAuth]};}
function messages(history,limit=2400){
  if(!Array.isArray(history))return [];
  let bytes=0,result=[];
  for(const item of history.slice(-48).reverse()){
    if(!item||!['user','assistant'].includes(item.role)||typeof item.text!=='string')continue;
    const content=item.text.trim().slice(-limit);if(!content)continue;
    bytes+=Buffer.byteLength(content);if(bytes>16000)break;result.unshift({role:item.role,content});
  }
  return result;
}
function accountId(access){
  try{const claims=JSON.parse(Buffer.from(access.split('.')[1],'base64url').toString());const id=claims['https://api.openai.com/auth']?.chatgpt_account_id;if(typeof id==='string'&&/^[a-zA-Z0-9_-]{1,160}$/.test(id))return id;}catch{}
  throw Error('OpenAI sign-in has no ChatGPT account ID. Sign in again.');
}
function providerError(status){return status===401||status===403?'Authentication was rejected. Check the selected key or sign in again.':status===429?'This account has reached a usage limit. Please try again later.':status===404?'The selected model is not available for this account. Choose another model.':`The model request failed (HTTP ${status}).`;}
async function streamText(response){
  const reader=response.body?.getReader();if(!reader)throw Error('The model returned no response.');
  const decoder=new TextDecoder();let buffer='',text='',bytes=0,complete=false;
  const event=frame=>{
    const payload=frame.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
    if(!payload)return;if(payload==='[DONE]'){complete=true;return;}
    let d;try{d=JSON.parse(payload);}catch{throw Error('The model returned an unreadable stream.');}
    if(d.type==='error'||d.error||['response.failed','response.incomplete'].includes(d.type))throw Error('The model could not finish its answer. Please try again.');
    if(d.type==='response.output_text.delta'||d.type==='response.refusal.delta')text+=d.delta||'';
    if(d.choices?.[0]){text+=d.choices[0].delta?.content||'';if(d.choices[0].finish_reason){if(d.choices[0].finish_reason==='length')throw Error('The answer exceeded its limit. Please ask a shorter question.');complete=true;}}
    if(d.type==='response.completed'){complete=true;if(!text)text=(d.response?.output||[]).flatMap(i=>i.content||[]).filter(c=>c.type==='output_text').map(c=>c.text).join('');}
    if(text.length>12000)throw Error('The answer was too long. Please ask a shorter question.');
  };
  try{while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>2*1024*1024)throw Error('The model response was too large.');buffer+=decoder.decode(value,{stream:true});buffer=buffer.replace(/\r\n/g,'\n');let end;while((end=buffer.indexOf('\n\n'))>=0){event(buffer.slice(0,end));buffer=buffer.slice(end+2);}}if(buffer.trim())event(buffer);}
  finally{await reader.cancel().catch(()=>{});}
  if(!complete||!text.trim())throw Error('The model connection ended before an answer arrived. Please try again.');return text.trim();
}
class DelegateBackend {
  constructor({auth,fetchImpl=fetch}){this.auth=auth;this.fetch=fetchImpl;this.requests=new Map();}
  cancel(owner,id){for(const [key,r] of this.requests)if(r.owner===owner&&(!id||r.id===id)){r.abort.abort();this.requests.delete(key);}}
  cancelAll(){for(const r of this.requests.values())r.abort.abort();this.requests.clear();}
  async answer(owner,id,config,history,instructions,agent=null){
    if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,160}$/.test(id))throw Error('Invalid delegation request.');
    const context=messages(history,agent?6000:2400);if(!context.some(m=>m.role==='user'))throw Error('The question transcript has not arrived yet. Please repeat the question.');
    this.cancel(owner);const abort=new AbortController(),request={owner,id,abort},key=owner+':'+id;this.requests.set(key,request);
    try{
      const {provider,auth,model}=selected(config),credential=await this.auth.bearer(provider,auth);
      if(abort.signal.aborted)throw Error('Request cancelled.');
      const signal=AbortSignal.any([abort.signal,AbortSignal.timeout(agent?150000:90000)]);
      const headers={'Authorization':`Bearer ${credential.access}`,'Content-Type':'application/json','Accept':'text/event-stream'};
      let url,body;
      const brief=String(instructions||'').slice(0,6000)+(agent?'\nUse the supplied tools for requested actions. Do not claim success before a successful tool result. Give a concise final answer describing actual results; never reveal private reasoning.':'\nAnswer the latest user question from the conversation. Give only the final result, in at most 70 words. Do not describe private reasoning. You have no external tools in this request; do not claim to have searched or changed anything.');
      if(provider==='openai'){
        url=auth==='oauth2'?'https://chatgpt.com/backend-api/codex/responses':'https://api.openai.com/v1/responses';
        body={model,instructions:brief,input:context.map(m=>({role:m.role,content:[{type:m.role==='assistant'?'output_text':'input_text',text:m.content}]})),reasoning:{effort:'low'},store:false,stream:true};
        if(auth==='oauth2')Object.assign(headers,{'chatgpt-account-id':accountId(credential.access),originator:'gpt-live-avatar','User-Agent':'gpt-live-avatar/0.1.0','OpenAI-Beta':'responses=experimental'});
        else body.max_output_tokens=1400;
      }else{
        url=auth==='oauth2'?'https://cli-chat-proxy.grok.com/v1/chat/completions':'https://api.x.ai/v1/chat/completions';
        body={model:auth==='oauth2'?'grok-build':model,messages:[{role:'system',content:brief},...context],max_completion_tokens:1400,stream:true};
        if(auth==='oauth2')Object.assign(headers,{'X-XAI-Token-Auth':'xai-grok-cli','x-grok-client-version':'1.0.4','x-grok-client-identifier':'grok-shell','x-authenticateresponse':'authenticate-response','x-grok-client-mode':'interactive','User-Agent':'grok-shell/1.0.4 (macos; aarch64)','x-grok-model-override':model});
      }
      if(agent)return await require('./agent-model.cjs').runAgent({fetchImpl:this.fetch,url,headers,body,signal,agent,provider,model});
      let response;try{response=await this.fetch(url,{method:'POST',headers,body:JSON.stringify(body),redirect:'error',signal});}catch{throw Error(abort.signal.aborted?'Request cancelled.':'Could not reach the selected model. Please try again.');}
      if(!response.ok){await response.body?.cancel();throw Error(providerError(response.status));}
      const text=await streamText(response);if(abort.signal.aborted)throw Error('Request cancelled.');
      return {text,provider,model};
    }finally{if(this.requests.get(key)===request)this.requests.delete(key);}
  }
  async models(config){
    const {provider,auth}=selected(config);if(auth==='oauth2')return MODEL_CHOICES[provider];
    const credential=await this.auth.bearer(provider,auth),url=provider==='openai'?'https://api.openai.com/v1/models':'https://api.x.ai/v1/models';
    let response;try{response=await this.fetch(url,{headers:{Authorization:`Bearer ${credential.access}`},redirect:'error',signal:AbortSignal.timeout(20000)});}catch{throw Error('Could not load the model list.');}
    if(!response.ok){await response.body?.cancel();throw Error(providerError(response.status));}
    const data=await readJSON(response,1024*1024);return (data.data||[]).map(m=>m.id).filter(m=>validModel(m)&&(provider==='openai'?/^(gpt-5|o[34])/.test(m)&&!/(live|audio|image|transcri|tts)/.test(m):/^grok/.test(m))).sort();
  }
}
module.exports={DelegateBackend,DEFAULT_MODELS,MODEL_CHOICES,normalizeDelegate,selected,messages,streamText,accountId};
