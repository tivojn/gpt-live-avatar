'use strict';
const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const readline=require('node:readline');

// Prefer the desktop engine: its supported models and connected tools match the app.
// An explicit executable override still takes priority.
function findCodex({platform=process.platform,env=process.env,home=os.homedir(),arch=process.arch}={}){
 if(platform==='win32')return findCodexWindows({env,arch});
 const candidates=[env.GLA_CODEX_PATH,'/Applications/Codex.app/Contents/Resources/codex','/Applications/ChatGPT.app/Contents/Resources/codex',path.join(home,'.local/bin/codex'),'/opt/homebrew/bin/codex','/usr/local/bin/codex'];
 for(const dir of (env.PATH||'').split(path.delimiter))candidates.push(path.join(dir,'codex'));
 for(const file of candidates.filter(Boolean))try{fs.accessSync(file,fs.constants.X_OK);return file;}catch{}
 throw Error('Install Codex CLI or the Codex desktop app, then click Check Codex.');
}
// Windows. `npm i -g @openai/codex` leaves three shims beside each other (codex, codex.cmd, codex.ps1)
// and none of them can be spawned without a shell, which this app never uses. The shims only start
// node on bin/codex.js, which in turn starts the native codex.exe from the platform package, so that
// executable is what we look for: on PATH as it is, or inside the npm package a shim belongs to.
function npmNative(dir,arch){
 const triple=arch==='arm64'?'aarch64-pc-windows-msvc':'x86_64-pc-windows-msvc',tail=path.join('vendor',triple,'codex','codex.exe'),scope=path.join(dir,'node_modules','@openai');
 return [path.join(scope,'codex','node_modules','@openai','codex-win32-'+arch,tail),path.join(scope,'codex-win32-'+arch,tail),path.join(scope,'codex',tail)];
}
function findCodexWindows({env,arch}){
 const pathValue=env.PATH||env.Path||'',dirs=[...pathValue.split(';').filter(Boolean),...(env.APPDATA?[path.join(env.APPDATA,'npm')]:[])],candidates=[];
 const explicit=env.GLA_CODEX_PATH;
 if(explicit)candidates.push(...(/\.exe$/i.test(explicit)?[explicit]:npmNative(path.dirname(explicit),arch)));
 for(const dir of dirs){candidates.push(path.join(dir,'codex.exe'));if(fs.existsSync(path.join(dir,'codex.cmd')))candidates.push(...npmNative(dir,arch));}
 for(const file of candidates)try{if(fs.statSync(file).isFile())return file;}catch{}
 throw Error('Install Codex CLI (npm install -g @openai/codex), then click Check Codex.');
}
// What bin/codex.js gives the native executable: its bundled tools (ripgrep) on the path.
function codexEnv(file,base=process.env,platform=process.platform){
 const env={...base};delete env.ELECTRON_RUN_AS_NODE;
 if(platform!=='win32')return env;
 const tools=path.join(path.dirname(path.dirname(file)),'path');
 if(fs.existsSync(tools)){const key=Object.keys(env).find(k=>k.toUpperCase()==='PATH')||'PATH';env[key]=[tools,env[key]||''].filter(Boolean).join(';');env.CODEX_MANAGED_BY_NPM='1';}
 return env;
}

// One stdio server per app, started only when needed. No listening TCP port,
// copied credentials, shell interpolation, or changes to the user's Codex config.
class CodexClient{
 constructor({executable=findCodex,onRequest=async()=>{throw Error('Unsupported Codex request.');},onEvent=()=>{}}={}){
  Object.assign(this,{executable,onRequest,onEvent});this.pending=new Map();this.sequence=0;
 }
 async start(){
  if(this.ready)return this.ready;
  const ready=this.ready=(async()=>{
   const file=this.executable(),env=codexEnv(file);
   // Codex CLI 0.121 and earlier speak stdio by default and refuse the flag ("unexpected argument '--stdio'"); later ones take it.
   try{await this.connect(file,env,['app-server','--stdio']);}
   catch(e){if(!this.flagRefused)throw e;await this.connect(file,env,['app-server']);}
  })();
  try{await ready;this.ready=ready;}catch(e){this.close();throw e;}
 }
 async connect(file,env,args){
  this.flagRefused=false;let diagnostics='';
  const child=this.child=spawn(file,args,{stdio:['pipe','pipe','pipe'],env,windowsHide:true});
  this.lines=readline.createInterface({input:child.stdout});this.lines.on('line',line=>{let message;try{message=JSON.parse(line);}catch{return;}void this.receive(message);});
  // Diagnostics can contain local paths; never expose raw stderr to the renderer. Only the refused flag is read from them.
  child.stderr.on('data',chunk=>{if(diagnostics.length<4000){diagnostics+=chunk;if(args.includes('--stdio')&&/unexpected argument '--stdio'/.test(diagnostics))this.flagRefused=true;}});
  child.on('error',e=>this.failed(Error('Could not start Codex: '+e.message)));
  // stderr can still be in flight when the process is gone: let it finish (briefly) so a refused flag is seen before anyone is told.
  child.on('exit',()=>{const gone=()=>{if(this.child===child){this.child=null;this.failed(Error('Codex disconnected. Try the request again.'),this.flagRefused);}};if(child.stderr.readableEnded)gone();else{const timer=setTimeout(gone,300);child.stderr.once('end',()=>{clearTimeout(timer);gone();});}});
  await this.request('initialize',{clientInfo:{name:'gpt_live_avatar',title:'GPT-Live Avatar',version:require('../package.json').version},capabilities:{experimentalApi:true}});
  this.send({method:'initialized',params:{}});
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
 failed(error,quiet=false){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();this.ready=null;if(!quiet)this.onEvent('connection/closed',{error:error.message});}
 close(){const child=this.child;this.child=null;this.lines?.close();if(child&&!child.killed)child.kill();this.failed(Error('Codex stopped.'));}
}
module.exports={CodexClient,findCodex,codexEnv};
