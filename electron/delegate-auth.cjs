'use strict';
// Public-client protocols used by OpenClaw (OpenAI PKCE) and OpenClam
// (Grok Build device authorization). Credentials belong only to this app.
const crypto=require('node:crypto'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const OPENAI_CLIENT='app_EMoamEEZ73f0CkXaXp7hrann';
const XAI_CLIENT='b1a00492-073a-47ea-816f-4c329264a828';
const XAI_SCOPE='openid profile email offline_access grok-cli:access api:access conversations:read conversations:write workspaces:read workspaces:write';
const providerName=p=>p==='openai'?'OpenAI':'xAI';
function provider(p){if(!['openai','xai'].includes(p))throw Error('Choose OpenAI or xAI.');return p;}
function tokenRecord(data,previous={}){
  if(!data || typeof data.access_token!=='string' || !data.access_token || data.access_token.length>131072 || (data.token_type && (typeof data.token_type!=='string'||data.token_type.toLowerCase()!=='bearer')))throw Error('Sign-in did not return a valid access token. Please try again.');
  // Honor the provider's lifetime. A seven-day ceiling rejected otherwise
  // valid OpenAI credentials after the browser had already authorized them.
  const seconds=typeof data.expires_in==='number'||(typeof data.expires_in==='string'&&/^\d+(?:\.\d+)?$/.test(data.expires_in))?Number(data.expires_in):NaN;
  const lifetime=seconds*1000,expires=Date.now()+lifetime;
  if(!(seconds>0)||!Number.isSafeInteger(Math.ceil(lifetime))||!Number.isFinite(expires)||expires>8.64e15)throw Error('Sign-in returned an invalid token expiry. Please try again.');
  const refresh=data.refresh_token||previous.refresh;
  if(typeof refresh!=='string'||!refresh||refresh.length>32768)throw Error('Sign-in did not return a renewable credential. Please try again.');
  return {access:data.access_token,refresh,expires};
}
async function readJSON(response,limit=1048576){
  const reader=response.body?.getReader();if(!reader)throw Error('The provider returned an empty response.');
  let total=0,chunks=[];
  try{while(true){const {value,done}=await reader.read();if(done)break;total+=value.length;if(total>limit)throw Error('The provider response was too large.');chunks.push(Buffer.from(value));}}
  finally{await reader.cancel().catch(()=>{});}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('The provider returned an unreadable response.');}
}
function tokenError(p,r){
  const code=typeof r.data?.error==='string'?r.data.error:r.data?.error?.code;
  const known={invalid_grant:'The sign-in code expired or was already used. Start a new sign-in.',access_denied:'Account authorization was denied.',invalid_client:'The sign-in client was rejected.',invalid_request:'The sign-in request was rejected.',temporarily_unavailable:'The sign-in service is temporarily unavailable.'};
  return `${providerName(p)} sign-in failed (HTTP ${r.status}). ${known[code]||'Please start again.'}`;
}
class DelegateAuth {
  constructor({directory,safeStorage,readOpenAIKey,openExternal,onChange=()=>{},fetchImpl=fetch,callbackPort=1455}){
    Object.assign(this,{directory,safeStorage,readOpenAIKey,openExternal,onChange,fetch:fetchImpl,callbackPort});
    this.pending=new Map();this.states=new Map();this.generations={openai:0,xai:0};this.refreshing=new Map();this.keyGeneration=0;
  }
  file(p,kind='oauth'){return path.join(this.directory,`${provider(p)}-${kind}.bin`);}
  read(p,kind='oauth'){
    const file=this.file(p,kind);if(!fs.existsSync(file))return null;
    if(!this.safeStorage.isEncryptionAvailable())throw Error('Secure credential storage is unavailable.');
    try{return JSON.parse(this.safeStorage.decryptString(fs.readFileSync(file)));}catch{throw Error('The saved credential could not be opened. Sign in again.');}
  }
  write(p,value,kind='oauth'){
    if(!this.safeStorage.isEncryptionAvailable())throw Error('Secure credential storage is unavailable. Nothing was saved.');
    fs.mkdirSync(this.directory,{recursive:true,mode:0o700});const file=this.file(p,kind),tmp=file+'.'+crypto.randomUUID()+'.tmp';
    try{fs.writeFileSync(tmp,this.safeStorage.encryptString(JSON.stringify(value)),{mode:0o600});fs.renameSync(tmp,file);}finally{try{fs.unlinkSync(tmp);}catch{}}
  }
  status(){return Object.fromEntries(['openai','xai'].map(p=>[p,{hasKey:p==='openai'?Boolean(this.readOpenAIKey()):fs.existsSync(this.file(p,'key')),signedIn:fs.existsSync(this.file(p)),...(this.states.get(p)||{state:'idle'})}]));}
  state(p,value){this.states.set(p,value);this.onChange();}
  cancel(p){provider(p);++this.generations[p];const flow=this.pending.get(p);if(flow){clearTimeout(flow.timer);clearTimeout(flow.expiry);flow.abort.abort();flow.server?.close();this.pending.delete(p);}this.state(p,{state:'idle'});}
  signOut(p){this.cancel(p);try{fs.unlinkSync(this.file(p));}catch{}this.onChange();}
  async post(url,body,signal){
    let r;try{r=await this.fetch(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body),redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)});}catch{throw Error('Could not reach the sign-in service. Please try again.');}
    const data=await readJSON(r);return {ok:r.ok,status:r.status,data};
  }
  async start(p){
    provider(p);this.cancel(p);
    const flow={generation:this.generations[p],abort:new AbortController()};this.pending.set(p,flow);this.state(p,{state:'starting'});
    const current=()=>this.pending.get(p)===flow&&!flow.abort.signal.aborted;
    const fail=message=>{if(current()){this.cancel(p);this.state(p,{state:'error',error:message});}};
    const complete=data=>{if(!current())return;const credential=tokenRecord(data);this.write(p,credential);this.cancel(p);this.state(p,{state:'signed-in'});};
    flow.expiry=setTimeout(()=>fail('Sign-in expired. Please start again.'),10*60*1000);
    try{
      if(p==='openai'){
        const verifier=crypto.randomBytes(48).toString('base64url'),state=crypto.randomBytes(32).toString('hex');
        const redirect=`http://localhost:${this.callbackPort}/auth/callback`;
        flow.server=http.createServer(async(req,res)=>{
          res.setHeader('Content-Type','text/plain; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
          const url=new URL(req.url,'http://localhost');
          if(req.method!=='GET'||url.pathname!=='/auth/callback'){res.writeHead(404);res.end('Not found');return;}
          if(!current()||url.searchParams.get('state')!==state||url.searchParams.getAll('state').length!==1){res.writeHead(400);res.end('Sign-in state did not match. Return to GPT-Live Avatar.');return;}
          if(flow.exchanging){res.writeHead(409);res.end('Sign-in is already being completed.');return;}
          const code=url.searchParams.get('code');
          if(url.searchParams.has('error')||!code||code.length>4096){res.end('Sign-in was not completed. Return to GPT-Live Avatar.');fail('Sign-in was cancelled or denied.');return;}
          flow.exchanging=true;
          try{const r=await this.post('https://auth.openai.com/oauth/token',{grant_type:'authorization_code',client_id:OPENAI_CLIENT,code,code_verifier:verifier,redirect_uri:redirect},flow.abort.signal);if(!r.ok)throw Error(tokenError(p,r));if(!current()){res.end('Sign-in was cancelled. Return to GPT-Live Avatar.');return;}complete(r.data);res.end('Signed in. You can close this tab and return to GPT-Live Avatar.');}
          catch(error){res.statusCode=400;res.end(`${error.message}\n\nReturn to GPT-Live Avatar to try again.`);fail(error.message);}
        });
        await new Promise((resolve,reject)=>{flow.server.once('error',()=>reject(Error('Sign-in port 1455 is busy. Finish any other OpenAI login, then try again.')));flow.server.listen(this.callbackPort,'127.0.0.1',resolve);});
        if(!current()){flow.server.close();return;}
        const url=new URL('https://auth.openai.com/oauth/authorize');
        for(const [k,v] of Object.entries({response_type:'code',client_id:OPENAI_CLIENT,redirect_uri:redirect,scope:'openid profile email offline_access',code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',state,id_token_add_organizations:'true',codex_cli_simplified_flow:'true',originator:'gpt-live-avatar'}))url.searchParams.set(k,v);
        this.state(p,{state:'waiting',message:'Complete OpenAI sign-in in your browser.'});await this.openExternal(url.href);
      }else{
        const r=await this.post('https://auth.x.ai/oauth2/device/code',{client_id:XAI_CLIENT,scope:XAI_SCOPE},flow.abort.signal);
        if(!current())return;
        if(!r.ok)throw Error('xAI could not start sign-in. Please try again.');
        const d=r.data,url=new URL(d.verification_uri_complete||d.verification_uri),ttl=Number(d.expires_in);
        if(url.protocol!=='https:'||!['auth.x.ai','accounts.x.ai'].includes(url.hostname)||url.username||url.password||url.port||typeof d.device_code!=='string'||!d.device_code||typeof d.user_code!=='string'||!/^[\x20-\x7E]{1,64}$/.test(d.user_code)||!Number.isFinite(ttl)||ttl<30||ttl>3600)throw Error('xAI returned an invalid sign-in request.');
        flow.interval=Math.max(1,Math.min(30,Number(d.interval)||5))*1000;
        clearTimeout(flow.expiry);flow.expiry=setTimeout(()=>fail('xAI sign-in expired. Please start again.'),ttl*1000);
        this.state(p,{state:'waiting',userCode:d.user_code,message:'Enter this code in the xAI sign-in page.'});
        const poll=async()=>{if(!current())return;try{
          const result=await this.post('https://auth.x.ai/oauth2/token',{grant_type:'urn:ietf:params:oauth:grant-type:device_code',device_code:d.device_code,client_id:XAI_CLIENT},flow.abort.signal);
          if(!current())return;
          if(result.ok){complete(result.data);return;}
          if(result.data.error==='slow_down')flow.interval=Math.min(30000,flow.interval+5000);
          else if(result.data.error!=='authorization_pending')throw Error('xAI sign-in was denied or expired. Please start again.');
          flow.timer=setTimeout(poll,flow.interval);
        }catch(error){fail(error.message);}};
        flow.timer=setTimeout(poll,flow.interval);await this.openExternal(url.href);
      }
    }catch(error){fail(error.message);}
  }
  async bearer(p,mode){
    provider(p);
    if(mode==='api_key'){const key=p==='openai'?this.readOpenAIKey():this.read(p,'key')?.key;if(!key)throw Error(`Add your ${providerName(p)} API key in Settings.`);return {access:key};}
    if(mode!=='oauth2')throw Error('Choose an authentication method.');
    const saved=this.read(p);if(!saved)throw Error(`Sign in to ${providerName(p)} in Settings.`);
    if(saved.expires>Date.now()+300000)return saved;
    const generation=this.generations[p],existing=this.refreshing.get(p);
    if(existing?.generation===generation)return existing.promise;
    const pending={generation};pending.promise=(async()=>{
      const r=await this.post(p==='openai'?'https://auth.openai.com/oauth/token':'https://auth.x.ai/oauth2/token',{grant_type:'refresh_token',client_id:p==='openai'?OPENAI_CLIENT:XAI_CLIENT,refresh_token:saved.refresh});
      if(!r.ok)throw Error(`${providerName(p)} could not renew sign-in. Please sign in again.`);
      const next=tokenRecord(r.data,saved);if(generation!==this.generations[p])throw Error('Sign-in changed. Please try again.');
      this.write(p,next);return next;
    })().finally(()=>{if(this.refreshing.get(p)===pending)this.refreshing.delete(p);});
    this.refreshing.set(p,pending);return pending.promise;
  }
  async setXAIKey(key){
    const generation=++this.keyGeneration;
    if(typeof key!=='string'||!/^xai-[A-Za-z0-9_-]{16,512}$/.test(key.trim()))throw Error('Enter a valid xAI API key.');key=key.trim();
    let r;try{r=await this.fetch('https://api.x.ai/v1/models',{headers:{Authorization:`Bearer ${key}`},redirect:'error',signal:AbortSignal.timeout(20000)});}catch{throw Error('Could not validate the xAI API key.');}
    await r.body?.cancel();if(!r.ok)throw Error(`xAI key validation failed (HTTP ${r.status}).`);
    if(generation!==this.keyGeneration)throw Error('Key entry was cancelled.');
    this.write('xai',{key},'key');this.onChange();
  }
  clearXAIKey(){++this.keyGeneration;try{fs.unlinkSync(this.file('xai','key'));}catch{}this.onChange();}
  close(){for(const p of ['openai','xai'])this.cancel(p);}
}
module.exports={DelegateAuth,readJSON,tokenRecord};
