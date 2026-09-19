'use strict';
const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {childEnv}=require('./child-env.cjs');
const {resolveWindowsCommand,findWindowsCommand,pathDirs}=require('./win-command.cjs');
const NAMES={openclaw:'OpenClaw',hermes:'Hermes',grok:'Grok Build'};
const engineArgs=(engine,name)=>engine==='grok'?['--no-auto-update','agent','--no-leader','stdio']:name==='hermes-acp'?[]:['acp'];
const missing=(engine,explicit)=>Error(explicit?`${NAMES[engine]} executable was not found at the saved path. Choose its executable in Settings.`:`Install and configure ${NAMES[engine]} on this ${process.platform==='darwin'?'Mac':'computer'}${engine==='hermes'?', including its ACP extra':''}, then check the connection. Codex is not required.`);
// → {file,args,prefix}: `prefix` comes before every argument list (on Windows, the script node.exe runs for an npm-installed engine).
function findRuntime(engine,override='',{platform=process.platform,env=process.env,home=os.homedir()}={}){
 if(!NAMES[engine])throw Error('Unknown agent runtime.');
 if(platform==='win32'){
  const explicit=override||env['GLA_'+engine.toUpperCase()+'_PATH'],names=engine==='hermes'?['hermes','hermes-acp']:[engine==='grok'?'grok':'openclaw'];
  const dirs=[path.join(home,'.grok','bin'),path.join(home,'.openclaw','bin'),path.join(home,'.local','bin'),path.join(home,'.hermes','hermes-agent','venv','Scripts'),path.join(home,'.hermes','hermes-agent','.venv','Scripts'),...(env.APPDATA?[path.join(env.APPDATA,'npm')]:[]),...pathDirs(env)];
  const nodeDirs=engine==='openclaw'?[path.join(home,'.openclaw','tools','cli-node')]:[]; // the Node OpenClaw installs for itself; it refuses older ones
  const found=explicit?resolveWindowsCommand(explicit,env,nodeDirs):findWindowsCommand(names,dirs,env,nodeDirs);
  if(!found)throw missing(engine,explicit);
  const name=(found.name||path.basename(explicit||'')).replace(/\.(exe|cmd|ps1|bat)$/i,'').toLowerCase();
  return {file:found.file,prefix:found.prefix,args:[...found.prefix,...engineArgs(engine,name)]};
 }
 const explicit=override||env['GLA_'+engine.toUpperCase()+'_PATH'];
 const names=engine==='hermes'?['hermes','hermes-acp']:[engine==='grok'?'grok':'openclaw'];
 const dirs=[path.join(home,'.grok/bin'),path.join(home,'.openclaw/bin'),path.join(home,'.local/bin'),path.join(home,'.hermes/hermes-agent/venv/bin'),path.join(home,'.hermes/hermes-agent/.venv/bin'),'/opt/homebrew/bin','/usr/local/bin',...(process.env.PATH||'').split(path.delimiter).filter(Boolean)];
 const candidates=explicit?[explicit]:dirs.flatMap(dir=>names.map(name=>path.join(dir,name)));
 for(const file of candidates)try{if(path.isAbsolute(file)&&fs.statSync(file).isFile()){fs.accessSync(file,fs.constants.X_OK);return {file,prefix:[],args:engineArgs(engine,path.basename(file))};}}catch{}
 throw missing(engine,explicit);
}
// ACP JSON-RPC over a private child process's stdio. Never invoke a login shell,
// copy credentials, emit stderr, or mutate the runtime's global configuration.
class AcpClient{
 constructor({engine,executable='',agent='',onEvent=()=>{},onRequest=async()=>{throw Error('Unsupported host request.');},spawnImpl=spawn}){Object.assign(this,{engine,executable,agent,onEvent,onRequest,spawnImpl});this.pending=new Map();this.sequence=0;this.buffer='';}
 async start(){
  const command=findRuntime(this.engine,this.executable),env=childEnv(path.dirname(command.file));
  const args=[...command.args];if(this.engine==='hermes'&&this.agent){if(!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(this.agent))throw Error('Invalid Hermes profile.');args.splice(command.prefix.length,0,'--profile',this.agent);}
  this.child=this.spawnImpl(command.file,args,{stdio:['pipe','pipe','pipe'],env,windowsHide:true});
  this.child.stdout.setEncoding('utf8');this.child.stdout.on('data',chunk=>{
   this.buffer+=chunk;if(Buffer.byteLength(this.buffer)>4*1024*1024){this.close();return;}
   let at;while((at=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,at);this.buffer=this.buffer.slice(at+1);if(!line.trim())continue;let frame;try{frame=JSON.parse(line);}catch{continue;}void this.receive(frame);}
  });
  // stderr is never shown (it can hold paths and tokens); it is only searched for the one failure users keep meeting.
  let diagnostics='';this.child.stderr.on('data',chunk=>{if(diagnostics.length<4000)diagnostics+=chunk;});this.child.stdin.on('error',()=>this.fail('The runtime connection closed.'));
  this.child.on('error',()=>this.fail(`Could not launch ${NAMES[this.engine]}. Check its executable and ACP setup.`));
  this.child.on('exit',()=>setTimeout(()=>this.fail(this.engine==='openclaw'&&/ACP bridge failed.*ECONNREFUSED/.test(diagnostics)?'The OpenClaw gateway is not running. Start it (openclaw gateway), then try again.':`${NAMES[this.engine]} disconnected. Check its setup and try again.`),50)); // a moment for the last of stderr
  this.info=await this.request('initialize',{protocolVersion:1,clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false},clientInfo:{name:'gpt-live-avatar',version:require('../package.json').version}});
  if(this.info.protocolVersion!==1)throw Error('This runtime uses an unsupported ACP version.');
  if(this.engine==='grok'){
   const methods=new Set((this.info.authMethods||[]).map(m=>m.id));
   const methodId=env.XAI_API_KEY&&methods.has('xai.api_key')?'xai.api_key':methods.has('cached_token')?'cached_token':null;
   if(!methodId)throw Error('Sign in to Grok Build with grok login, then check the connection.');
   try{await this.request('authenticate',{methodId,_meta:{headless:true}});}catch{throw Error('Grok Build sign-in is unavailable. Run grok login, then check the connection.');}
  }
  return this.info;
 }
 send(value){if(!this.child||this.child.stdin.destroyed)throw Error('The runtime is not connected.');this.child.stdin.write(JSON.stringify({jsonrpc:'2.0',...value})+'\n');}
 notify(method,params){this.send({method,params});}
 request(method,params={},timeout=60000){return new Promise((resolve,reject)=>{const id=++this.sequence,timer=setTimeout(()=>{this.pending.delete(id);reject(Error(`${NAMES[this.engine]} timed out during ${method}.`));},timeout);this.pending.set(id,{resolve,reject,timer});try{this.send({id,method,params});}catch(e){clearTimeout(timer);this.pending.delete(id);reject(e);}});}
 async receive(frame){
  if(frame.method&&frame.id!==undefined){
   try{const result=await this.onRequest(frame.method,frame.params||{});this.send({id:frame.id,result});}
   catch{try{this.send({id:frame.id,error:{code:-32601,message:'This host operation is unavailable or was cancelled.'}});}catch{}}
  }else if(frame.id!==undefined){const task=this.pending.get(frame.id);if(!task)return;this.pending.delete(frame.id);clearTimeout(task.timer);frame.error?task.reject(Error(`${NAMES[this.engine]}: ${String(frame.error.message||'Request failed').slice(0,600)}`)):task.resolve(frame.result);}
  else if(frame.method)this.onEvent(frame.method,frame.params||{});
 }
 fail(message){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error(message));}this.pending.clear();}
 close(){const child=this.child;this.child=null;if(child&&!child.killed){child.kill();const timer=setTimeout(()=>{if(child.exitCode===null)child.kill('SIGKILL');},2000);timer.unref();}this.fail('Runtime request cancelled or connection closed.');}
}
module.exports={AcpClient,findRuntime,NAMES};
