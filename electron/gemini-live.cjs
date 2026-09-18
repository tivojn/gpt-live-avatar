'use strict';
// Gemini Live as a second voice model beside GPT-Live-1.
//
// The division of labour mirrors the OpenAI path. The API key never leaves the
// main process: it buys a single-use ephemeral token with the whole setup sealed in, and
// the renderer opens the WebSocket with that token (web/gemini-live-client.js).
// The main process also composes the whole setup message, so instructions and
// tools are decided here, next to the ones for GPT-Live-1.
//
// What differs from GPT-Live-1, and how it is bridged:
//   - No built-in delegation. One NON_BLOCKING function, ask_assistant, plays
//     that part; the renderer turns its call into the same delegation event
//     the rest of the app already handles, and the answer goes back as the
//     function response. Reasoning and action engines are therefore unchanged.
//   - Extended Thinking only accepts NON_BLOCKING tools and reports being done
//     with interaction_status, not turnComplete (handled in the renderer).
//   - The system prompt cannot change mid-session; later notes are sent as text.
const API=process.env.GLA_GEMINI_API||'https://generativelanguage.googleapis.com/v1beta'; // the override is for QA's stand-in server
const SOCKET='wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.{version}.GenerativeService.BidiGenerateContentConstrained';
const MODELS={
  'gemini-3.8-live':{label:'Gemini 3.8 Live',thinking:false},
  'gemini-3.8-live-extended-thinking':{label:'Gemini 3.8 Live · Extended Thinking',thinking:true},
};
const DEFAULT_MODEL='gemini-3.8-live',DEFAULT_VOICE='Aoede',THINKING_LEVELS=['low','medium','high'];
// Prebuilt voices of the Live API, with Google's own one-word characterisation.
const VOICES={Aoede:'breezy',Kore:'firm',Leda:'youthful',Zephyr:'bright',Callirrhoe:'easy-going',Autonoe:'bright',Despina:'smooth',Erinome:'clear',Laomedeia:'upbeat',Achernar:'soft',Gacrux:'mature',Pulcherrima:'forward',Vindemiatrix:'gentle',Sulafat:'warm',
  Puck:'upbeat',Charon:'informative',Fenrir:'excitable',Orus:'firm',Enceladus:'breathy',Iapetus:'clear',Umbriel:'easy-going',Algieba:'smooth',Algenib:'gravelly',Rasalgethi:'informative',Alnilam:'firm',Schedar:'even',Achird:'friendly',Zubenelgenubi:'casual',Sadachbia:'lively',Sadaltager:'knowledgeable'};
const TOOL='ask_assistant';

const validKey=value=>typeof value==='string'&&/^[A-Za-z0-9._-]{20,400}$/.test(value);
const clean=(value,max)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
function choice(config={}){
  const model=Object.hasOwn(MODELS,config.geminiModel)?config.geminiModel:DEFAULT_MODEL;
  return {model,thinking:MODELS[model].thinking,voice:Object.hasOwn(VOICES,config.geminiVoice)?config.geminiVoice:DEFAULT_VOICE,
    thinkingLevel:THINKING_LEVELS.includes(config.geminiThinkingLevel)?config.geminiThinkingLevel:'low'};
}
// The hand-off paragraph of the system prompt. GPT-Live-1 is told about its backend; Gemini is told about its one function.
function handOffPolicy({agent=false,engine='',thinking=false}={}){
  return [`Hand-off policy: you have one function, ${TOOL}. It reaches ${agent?'the external agent engine ('+engine+') that does real work on the user’s Mac, and a knowledge assistant':'a knowledge assistant'}; it runs in the background and its verified result comes back to you.`,
    `Call ${TOOL} when:\n- ${thinking?'The answer depends on current facts, figures or sources you cannot verify yourself':'The request needs careful reasoning, detailed facts or figures you are not confident about'}.${agent?'\n- The user asks for any real task: files, code, the shell, screenshots, the browser or another app. Pass the whole request, including any avatar movement combined with it.':''}`,
    `Do not call it when:\n- It is a greeting, small talk, a feeling, a compliment or something you can answer from the conversation${thinking?', or something you can reason out yourself':''}.\n- The user asks for an animation, pose, one-shot dance, gesture or movement (excluding the dance-along music control): answer yourself with the affirmative intention described above.`,
    'Before calling it, say one short natural line such as “Let me check.” Then wait: never guess the result, never claim a task is done before the result says so, and when the result arrives give it in your own words, briefly.'].join('\n\n');
}
function historyText(history){
  const lines=[];let bytes=0;
  for(const item of (Array.isArray(history)?history:[]).slice(-48).reverse()){
    if(!item||!['user','assistant'].includes(item.role)||typeof item.text!=='string')continue;
    const text=item.text.slice(-1800).trim();if(!text)continue;
    bytes+=Buffer.byteLength(text);if(bytes>6000)break;
    lines.unshift((item.role==='user'?'User: ':'You: ')+text);
  }
  return lines.length?'The conversation so far (you were reconnected; continue it naturally and do not greet again):\n'+lines.join('\n'):'';
}
// The first message on the socket. `instructions` is the app's system prompt with handOffPolicy() already in it.
function buildSetup({config={},instructions='',history=[],delegate=true,resumeHandle=''}={}){
  const {model,thinking,voice,thinkingLevel}=choice(config),past=historyText(history);
  return {setup:{
    model:'models/'+model,
    generationConfig:{responseModalities:['AUDIO'],speechConfig:{voiceConfig:{prebuiltVoiceConfig:{voiceName:voice}}},...(thinking?{thinkingConfig:{thinkingLevel:thinkingLevel.toUpperCase()}}:{})},
    systemInstruction:{parts:[{text:[clean(instructions,40000)&&String(instructions).slice(0,40000),past].filter(Boolean).join('\n\n')}]},
    ...(delegate?{tools:[{functionDeclarations:[{name:TOOL,behavior:'NON_BLOCKING',
      description:'Hands the user’s latest request to the assistant behind you (careful reasoning, verified facts and, when enabled, real tasks on the user’s Mac) and returns its verified result. Runs in the background.',
      parameters:{type:'OBJECT',properties:{request:{type:'STRING',description:'The user’s request in their own words, complete enough to act on without the conversation.'}},required:['request']}}]}]}:{}),
    inputAudioTranscription:{},outputAudioTranscription:{},
    // Audio sessions are time-limited: compress old context and keep a handle so a dropped or expiring connection resumes.
    contextWindowCompression:{slidingWindow:{}},sessionResumption:resumeHandle?{handle:String(resumeHandle).slice(0,4000)}:{},
  }};
}
async function request(fetchImpl,url,{key,method='GET',body,signal}={}){
  let response;
  try{response=await fetchImpl(url,{method,redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000),
    headers:{'x-goog-api-key':key,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});}
  catch(error){throw Error(error?.name==='TimeoutError'?'Google did not answer in time. Check your connection and try again.':'Could not reach Google. Check your connection and try again.');}
  let data=null;try{data=await response.json();}catch{}
  if(response.ok)return data||{};
  const message=clean(data?.error?.message,300);
  if([400,401,403].includes(response.status)&&/api key|API_KEY|permission|unauthenticated/i.test(message+' '+(data?.error?.status||'')))throw Object.assign(Error('Google rejected this Gemini API key.'),{status:response.status});
  if(response.status===429)throw Object.assign(Error('Gemini’s rate or quota limit was reached. Try again in a moment.'),{status:429});
  throw Object.assign(Error(message||`Gemini request failed (HTTP ${response.status}).`),{status:response.status});
}
// Which of our Live models this key can use; also the key check when it is saved.
async function availableModels(key,fetchImpl=fetch){
  const ids=new Set();let pageToken='';
  for(let page=0;page<6;page++){
    const data=await request(fetchImpl,API+'/models?pageSize=1000'+(pageToken?'&pageToken='+encodeURIComponent(pageToken):''),{key});
    for(const model of Array.isArray(data.models)?data.models:[])if(typeof model?.name==='string')ids.add(model.name.replace(/^models\//,''));
    pageToken=typeof data.nextPageToken==='string'?data.nextPageToken:'';if(!pageToken)break;
  }
  return Object.keys(MODELS).filter(id=>ids.has(id));
}
// A token for exactly one new session, valid for a few minutes to start and half an hour to run. The whole setup is
// sealed into it: with a setup and no field mask, Google takes the session's configuration entirely from the token and
// ignores what the connection sends, so the window cannot change the model, the instructions or the tools.
// (REST names: bidiGenerateContentSetup is the bare setup object; "liveConnectConstraints" is only the SDKs' name for it.)
async function createToken({key,setup,fetchImpl=fetch,now=Date.now(),signal}={}){
  if(!validKey(key))throw Error('Add your Gemini API key in Settings first.');
  const model=String(setup?.setup?.model||'').replace(/^models\//,'');
  if(!Object.hasOwn(MODELS,model))throw Error('Choose a supported Gemini Live model.');
  const iso=ms=>new Date(now+ms).toISOString();
  const data=await request(fetchImpl,API+'/auth_tokens',{key,method:'POST',signal,body:{uses:1,newSessionExpireTime:iso(2*60*1000),expireTime:iso(30*60*1000),bidiGenerateContentSetup:setup.setup}});
  const token=typeof data.name==='string'?data.name:typeof data.token?.name==='string'?data.token.name:'';
  if(!/^[\x21-\x7e]{8,2000}$/.test(token))throw Error('Google did not return a session token.');
  return token;
}
// What the renderer needs to open the session. v1beta first; older deployments only knew the constrained endpoint under v1alpha.
async function createSession({key,config,instructions,history,delegate,resumeHandle,fetchImpl=fetch,signal}={}){
  const picked=choice(config),setup=buildSetup({config,instructions,history,delegate,resumeHandle}),token=await createToken({key,setup,fetchImpl,signal});
  const base=process.env.GLA_GEMINI_SOCKET||SOCKET;
  return {provider:'gemini',model:picked.model,voice:picked.voice,thinking:picked.thinking,tool:TOOL,
    urls:['v1beta','v1alpha'].map(version=>base.replace('{version}',version)+'?access_token='+encodeURIComponent(token)).filter((url,i,all)=>all.indexOf(url)===i),
    setup}; // the socket still needs a first setup message; the sealed one in the token is what counts
}
module.exports={MODELS,VOICES,DEFAULT_MODEL,DEFAULT_VOICE,THINKING_LEVELS,TOOL,validKey,choice,handOffPolicy,historyText,buildSetup,availableModels,createToken,createSession};
