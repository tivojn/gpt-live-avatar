'use strict';
const {ipcMain,BrowserWindow,dialog}=require('electron');
const path=require('node:path'),crypto=require('node:crypto');
const {createAgentTools,latestUserRequest}=require('./agent-tools.cjs');
const {normalizeDelegate}=require('./delegate.cjs');
function setupAgent(deps){
 const pending=new Map(),completed=new Map();let recent=[];
 const allowed=e=>e.senderFrame===e.sender.mainFrame&&[deps.origin+'/avatar.html',deps.origin+'/group.html',deps.origin+'/settings.html'].includes(e.sender.getURL());
 const progress=(sender,value)=>{const item={...value,at:Date.now()};if(!sender.isDestroyed())sender.send('gla:agent:progress',item);recent.push(item);recent=recent.slice(-40);};
 function command(sender,action,args,signal){return new Promise((resolve,reject)=>{
  signal.throwIfAborted();const id=crypto.randomUUID(),finish=(error,result)=>{const p=pending.get(id);if(!p)return;pending.delete(id);clearTimeout(p.timer);signal.removeEventListener('abort',abort);error?reject(error):resolve(result);},abort=()=>{if(!sender.isDestroyed())sender.send('gla:agent:action-cancel',{id});finish(Error('Request cancelled.'));};
  const timer=setTimeout(()=>finish(Error('The avatar did not confirm the action.')),30000);pending.set(id,{sender,timer,finish});signal.addEventListener('abort',abort,{once:true});sender.send('gla:agent:action',{id,action,args});
 });}
 async function answer(sender,{id,history,turnId}={}){
  const config=deps.getConfig();if(!config.agentEnabled)throw Error('Enable actions and page context in Settings first.');
  if(typeof id!=='string'||!/^[\w-]{1,160}$/.test(id))throw Error('Invalid agent request.');
  if(!Array.isArray(history))throw Error('A user request is required.');const latest=latestUserRequest(history);if(!latest||latest.length>6000)throw Error('Use a request of up to 6,000 characters.');
  const key=sender.id+':'+(String(turnId||id).slice(0,160))+':'+crypto.createHash('sha256').update(latest).digest('hex');
  if(completed.has(key))return completed.get(key);
  const choice=config.reasoningMode==='delegate'?config:{...config,...normalizeDelegate(config,{reasoningMode:'delegate',delegateProvider:'openai',delegateAuth:'api_key',delegateModel:config.backendModel||'gpt-5.6-luna'})};
  const agent=createAgentTools({config,request:latest,avatarCommand:(action,args,signal)=>command(sender,action,args,signal),progress:value=>progress(sender,{id,...value})});
  progress(sender,{id,state:'thinking',tool:''});
  const work=deps.backend.answer(sender.id,id,choice,history,`You are ${config.personaName||'Tia'}, a desktop companion completing a real user's request. Give a concise plain-language result without markdown or code blocks, suitable to read aloud. ${agent.instructions}`,agent);
  completed.set(key,work);while(completed.size>64)completed.delete(completed.keys().next().value);
  try{const result=await work;progress(sender,{id,state:'complete',tool:'',text:result.text,receipts:result.receipts});return result;}
  catch(e){completed.delete(key);progress(sender,{id,state:'error',tool:'',error:e.message});throw e;}
 }
 const handle=(channel,fn)=>ipcMain.handle(channel,async(e,...args)=>{try{if(!allowed(e))throw Error('Unavailable outside the app.');return {ok:true,...await fn(e,...args)};}catch(e){return {ok:false,error:String(e.message).slice(0,600)};}});
 handle('gla:agent:run',(e,r)=>answer(e.sender,r));
 handle('gla:agent:cancel',(e,id)=>{deps.backend.cancel(e.sender.id,id);return {};});
 handle('gla:agent:recent',()=>({items:recent}));
 handle('gla:agent:folder',async e=>{const r=await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender),{title:'Choose the folder your avatar can use',defaultPath:deps.getConfig().agentFolder,properties:['openDirectory','createDirectory']});if(!r.canceled&&r.filePaths[0])deps.setFolder(path.resolve(r.filePaths[0]));return {folder:deps.getConfig().agentFolder};});
 ipcMain.on('gla:agent:action-result',(e,{id,result}={})=>{const p=pending.get(id);if(!p||p.sender!==e.sender||!allowed(e))return;if(!result||typeof result!=='object')return;p.finish(null,result);});
 return {answer,dispose(){for(const p of pending.values())p.finish(Error('App closed.'));pending.clear();completed.clear();}};
}
module.exports={setupAgent};
