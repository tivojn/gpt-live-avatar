'use strict';
const {ipcMain,BrowserWindow,dialog}=require('electron');
const path=require('node:path'),crypto=require('node:crypto');
const {createAgentTools,latestUserRequest}=require('./agent-tools.cjs');
const {normalizeDelegate,usesCodexActions,codexConfig}=require('./delegate.cjs');
function setupAgent(deps){
 const pending=new Map(),completed=new Map(),fileReferences=new Map(),questions=new Map();let recent=[];
 const allowed=e=>e.senderFrame===e.sender.mainFrame&&[deps.origin+'/avatar.html',deps.origin+'/group.html',deps.origin+'/settings.html'].includes(e.sender.getURL());
 const progress=(sender,value)=>{const item={...value,at:Date.now()};if(!sender.isDestroyed())sender.send('gla:agent:progress',item);recent.push(item);recent=recent.slice(-40);};
 const codex=new (require('./codex-agent.cjs').CodexAgent)({
  approve:async p=>{
   const detail=p.command||p.reason||p.message||JSON.stringify(p.permissions||{});
   const {response}=await dialog.showMessageBox({type:'question',title:'GPT-Live Avatar · '+p.character,message:p.character+' needs your approval',detail:String(detail).slice(0,12000),buttons:['Allow this action','Decline'],defaultId:1,cancelId:1,signal:p.signal});
   return response===0&&!p.signal.aborted;
  },
  ask:p=>new Promise(resolve=>{
   const job=codex.byThread.get(p.threadId),sender=job&&require('electron').webContents.fromId(job.owner);
   if(!sender||sender.isDestroyed()){resolve({answers:{}});return;}
   const id=crypto.randomUUID(),finish=answers=>{questions.delete(id);p.signal.removeEventListener('abort',abort);if(!sender.isDestroyed())sender.send('gla:agent:question-close',{id});resolve({answers});},abort=()=>finish({});
   questions.set(id,{sender,finish});p.signal.addEventListener('abort',abort,{once:true});sender.send('gla:agent:question',{id,character:p.character,questions:p.questions});
  }),
 });
 function command(sender,action,args,signal){return new Promise((resolve,reject)=>{
  signal.throwIfAborted();const id=crypto.randomUUID(),finish=(error,result)=>{const p=pending.get(id);if(!p)return;pending.delete(id);clearTimeout(p.timer);signal.removeEventListener('abort',abort);error?reject(error):resolve(result);},abort=()=>{if(!sender.isDestroyed())sender.send('gla:agent:action-cancel',{id});finish(Error('Request cancelled.'));};
  const timer=setTimeout(()=>finish(Error('The avatar did not confirm the action.')),30000);pending.set(id,{sender,timer,finish});signal.addEventListener('abort',abort,{once:true});sender.send('gla:agent:action',{id,action,args});
 });}
 async function answer(sender,{id,history,turnId,character,onReceipt}={}){
  const config=deps.getConfig();if(!config.agentEnabled)throw Error('Enable actions and page context in Settings first.');
  if(typeof id!=='string'||!/^[\w-]{1,160}$/.test(id))throw Error('Invalid agent request.');
  if(!Array.isArray(history))throw Error('A user request is required.');const latest=latestUserRequest(history);if(!latest||latest.length>6000)throw Error('Use a request of up to 6,000 characters.');
  const speaker=typeof character==='string'?character.slice(0,60):config.personaName||'Tia';
  const update=value=>progress(sender,{...value,id,character:speaker});
  const key=sender.id+':'+speaker+':'+(String(turnId||id).slice(0,160))+':'+crypto.createHash('sha256').update(latest).digest('hex');
  if(completed.has(key))return completed.get(key);
  const choice=config.reasoningMode==='delegate'?config:{...config,...normalizeDelegate(config,{reasoningMode:'delegate',delegateProvider:'openai',delegateAuth:'api_key',delegateModel:config.backendModel||'gpt-5.6-luna'})};
  const agent=createAgentTools({config,request:latest,avatarCommand:(action,args,signal)=>command(sender,action,args,signal),referenceFile:fileReferences.get(sender.id),onReceipt:receipt=>{if(receipt.ok&&receipt.path&&['create_text_file','read_text_file','trash_file'].includes(receipt.tool))fileReferences.set(sender.id,receipt.path);if(!usesCodexActions(config)&&typeof onReceipt==='function')onReceipt(receipt);},progress:update});
  update({state:'thinking',tool:''});
  const work=usesCodexActions(config)
   ?codex.answer(sender.id,id,codexConfig(config),history,latest,speaker,agent,receipt=>onReceipt?.(receipt),update)
   :deps.backend.answer(sender.id,id,choice,history,`You are ${speaker}, a desktop companion completing a real user's request. Give a concise plain-language result without markdown or code blocks, suitable to read aloud. ${agent.instructions}`,agent);
  completed.set(key,work);while(completed.size>64)completed.delete(completed.keys().next().value);
  try{const result=await work;update({state:'complete',tool:'',text:result.text,receipts:result.receipts});return result;}
  catch(e){completed.delete(key);update({state:/cancelled|aborted/i.test(e.message)?'cancelled':'error',tool:'',error:e.message});throw e;}
 }
 const handle=(channel,fn)=>ipcMain.handle(channel,async(e,...args)=>{try{if(!allowed(e))throw Error('Unavailable outside the app.');return {ok:true,...await fn(e,...args)};}catch(e){return {ok:false,error:String(e.message).slice(0,600)};}});
 handle('gla:agent:run',(e,r)=>answer(e.sender,r));
 handle('gla:agent:codex-status',()=>codex.status());
 handle('gla:agent:cancel',(e,id)=>{deps.backend.cancel(e.sender.id,id);codex.cancel(e.sender.id,id);return {};});
 handle('gla:agent:recent',()=>({items:recent}));
 handle('gla:agent:folder',async e=>{const r=await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender),{title:'Choose the folder your avatar can use',defaultPath:deps.getConfig().agentFolder,properties:['openDirectory','createDirectory']});if(!r.canceled&&r.filePaths[0])deps.setFolder(path.resolve(r.filePaths[0]));return {folder:deps.getConfig().agentFolder};});
 ipcMain.on('gla:agent:action-result',(e,{id,result}={})=>{const p=pending.get(id);if(!p||p.sender!==e.sender||!allowed(e))return;if(!result||typeof result!=='object')return;p.finish(null,result);});
 ipcMain.on('gla:agent:question-answer',(e,{id,answers}={})=>{const p=questions.get(id);if(!p||p.sender!==e.sender||!allowed(e)||!answers||typeof answers!=='object')return;const clean={};for(const [key,value]of Object.entries(answers).slice(0,8))if(Array.isArray(value?.answers))clean[key]={answers:value.answers.filter(x=>typeof x==='string').slice(0,8).map(x=>x.slice(0,6000))};p.finish(clean);});
 async function reason(owner,id,config,history,instructions){
  const character=config.personaName||'Tia';
  const update=value=>{const sender=require('electron').webContents.fromId(owner);if(sender)progress(sender,{...value,id,character});};
  update({state:'thinking'});
  try{const result=await codex.answer(owner,id,config,history,latestUserRequest(history),character,null,()=>{},update,{reasoningOnly:true,instructions});update({state:'complete',text:result.text});return result;}
  catch(error){update({state:/cancelled|aborted/i.test(error.message)?'cancelled':'error',error:error.message});throw error;}
 }
 return {answer,reason,status:()=>codex.status(),cancel:(owner,id)=>codex.cancel(owner,id),cancelAll:()=>codex.cancelAll(),dispose(){codex.close();for(const p of questions.values())p.finish({});for(const p of pending.values())p.finish(Error('App closed.'));pending.clear();completed.clear();fileReferences.clear();}};
}
module.exports={setupAgent};
