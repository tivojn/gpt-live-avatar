'use strict';
const {spawn}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {childEnv}=require('./child-env.cjs');
const NAMES={openclaw:'OpenClaw',hermes:'Hermes',grok:'Grok Build'};
function findRuntime(engine,override=''){
 if(!NAMES[engine])throw Error('Unknown agent runtime.');
 const home=os.homedir(),explicit=override||process.env['GLA_'+engine.toUpperCase()+'_PATH'];
 const names=engine==='hermes'?['hermes','hermes-acp']:[engine==='grok'?'grok':'openclaw'];
 const dirs=[path.join(home,'.grok/bin'),path.join(home,'.openclaw/bin'),path.join(home,'.local/bin'),path.join(home,'.hermes/hermes-agent/venv/bin'),path.join(home,'.hermes/hermes-agent/.venv/bin'),'/opt/homebrew/bin','/usr/local/bin',...(process.env.PATH||'').split(path.delimiter).filter(Boolean)];
 const candidates=explicit?[explicit]:dirs.flatMap(dir=>names.map(name=>path.join(dir,name)));
 for(const file of candidates)try{if(path.isAbsolute(file)&&fs.statSync(file).isFile()){fs.accessSync(file,fs.constants.X_OK);return {file,args:engine==='grok'?['--no-auto-update','agent','--no-leader','stdio']:path.basename(file)==='hermes-acp'?[]:['acp']};}}catch{}
 throw Error(explicit?`${NAMES[engine]} executable was not found at the saved path. Choose its executable in Settings.`:`Install and configure ${NAMES[engine]} on this Mac${engine==='hermes'?', including its ACP extra':''}, then check the connection. Codex is not required.`);
}
// ACP JSON-RPC over a private child process's stdio. Never invoke a login shell,
// copy credentials, emit stderr, or mutate the runtime's global configuration.
class AcpClient{
 constructor({engine,executable='',agent='',onEvent=()=>{},onRequest=async()=>{throw Error('Unsupported host request.');},spawnImpl=spawn}){Object.assign(this,{engine,executable,agent,onEvent,onRequest,spawnImpl});this.pending=new Map();this.sequence=0;this.buffer='';}
 async start(){
  const command=findRuntime(this.engine,this.executable),env=childEnv(path.dirname(command.file));
  const args=[...command.args];if(this.engine==='hermes'&&this.agent){if(!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(this.agent))throw Error('Invalid Hermes profile.');args.unshift('--profile',this.agent);}
  this.child=this.spawnImpl(command.file,args,{stdio:['pipe','pipe','pipe'],env});
  this.child.stdout.setEncoding('utf8');this.child.stdout.on('data',chunk=>{
   this.buffer+=chunk;if(Buffer.byteLength(this.buffer)>4*1024*1024){this.close();return;}
   let at;while((at=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,at);this.buffer=this.buffer.slice(at+1);if(!line.trim())continue;let frame;try{frame=JSON.parse(line);}catch{continue;}void this.receive(frame);}
  });
  this.child.stderr.on('data',()=>{});this.child.stdin.on('error',()=>this.fail('The runtime connection closed.'));
  this.child.on('error',()=>this.fail(`Could not launch ${NAMES[this.engine]}. Check its executable and ACP setup.`));
  this.child.on('exit',()=>this.fail(`${NAMES[this.engine]} disconnected. Check its setup and try again.`));
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
