'use strict';
const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const readline=require('node:readline');

// Prefer the desktop engine: its supported models and connected tools match the app.
// An explicit executable override still takes priority.
function findCodex(){
 const candidates=[process.env.GLA_CODEX_PATH,'/Applications/Codex.app/Contents/Resources/codex','/Applications/ChatGPT.app/Contents/Resources/codex',path.join(os.homedir(),'.local/bin/codex'),'/opt/homebrew/bin/codex','/usr/local/bin/codex'];
 for(const dir of (process.env.PATH||'').split(path.delimiter))candidates.push(path.join(dir,'codex'));
 for(const file of candidates.filter(Boolean))try{fs.accessSync(file,fs.constants.X_OK);return file;}catch{}
 throw Error('Install Codex CLI or the Codex desktop app, then click Check Codex.');
}

// One stdio server per app, started only when needed. No listening TCP port,
// copied credentials, shell interpolation, or changes to the user's Codex config.
class CodexClient{
 constructor({executable=findCodex,onRequest=async()=>{throw Error('Unsupported Codex request.');},onEvent=()=>{}}={}){
  Object.assign(this,{executable,onRequest,onEvent});this.pending=new Map();this.sequence=0;
 }
 async start(){
  if(this.ready)return this.ready;
  this.ready=(async()=>{
   const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
   const child=this.child=spawn(this.executable(),['app-server','--stdio'],{stdio:['pipe','pipe','pipe'],env});
   this.lines=readline.createInterface({input:child.stdout});this.lines.on('line',line=>{let message;try{message=JSON.parse(line);}catch{return;}void this.receive(message);});
   // Diagnostics can contain local paths; never expose raw stderr to the renderer.
   child.stderr.on('data',()=>{});
   child.on('error',e=>this.failed(Error('Could not start Codex: '+e.message)));
   child.on('exit',()=>{if(this.child===child){this.child=null;this.failed(Error('Codex disconnected. Try the request again.'));}});
   await this.request('initialize',{clientInfo:{name:'gpt_live_avatar',title:'GPT-Live Avatar',version:'0.2.6'},capabilities:{experimentalApi:true}});
   this.send({method:'initialized',params:{}});
  })();
  try{await this.ready;}catch(e){this.close();throw e;}
 }
 send(message){if(!this.child||this.child.stdin.destroyed)throw Error('Codex is not connected.');this.child.stdin.write(JSON.stringify(message)+'\n');}
 request(method,params={},timeout=45000){
  return new Promise((resolve,reject)=>{const id=++this.sequence,timer=setTimeout(()=>{this.pending.delete(id);reject(Error('Codex timed out: '+method));},timeout);this.pending.set(id,{resolve,reject,timer});try{this.send({id,method,params});}catch(e){clearTimeout(timer);this.pending.delete(id);reject(e);}});
 }
 async receive(message){
  if(message.method&&message.id!==undefined){
   try{const result=await this.onRequest(message.method,message.params||{});this.send({id:message.id,result});}
   catch(e){try{this.send({id:message.id,error:{code:-32603,message:String(e.message).slice(0,800)}});}catch{}}
  }else if(message.id!==undefined){const p=this.pending.get(message.id);if(!p)return;this.pending.delete(message.id);clearTimeout(p.timer);message.error?p.reject(Error(message.error.message)):p.resolve(message.result);}
  else if(message.method)this.onEvent(message.method,message.params||{});
 }
 failed(error){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();this.ready=null;this.onEvent('connection/closed',{error:error.message});}
 close(){const child=this.child;this.child=null;this.lines?.close();if(child&&!child.killed)child.kill();this.failed(Error('Codex stopped.'));}
}
module.exports={CodexClient,findCodex};
