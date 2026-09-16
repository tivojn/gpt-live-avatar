'use strict';
// Avatar Show Director: custom motion preparation. Orchestrates
// tools/show-motion.py (Meshy text-to-motion, Blender facing gate, Blender
// retarget, library integration) for one wanted motion at a time and reports
// progress. Nothing here runs unless the Director asks for a missing motion.
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process');
const FRONT='A person stands facing the camera with feet planted and never turns or walks away. ';
const FRONT_TAIL=' The body faces the camera the whole time; express everything with the arms, head and upper body.';
function frontFacing(prompt,strong=false){
 const text=String(prompt||'').trim();
 if(!strong)return /facing the camera|feet planted/i.test(text)?text:FRONT+text;
 return FRONT+text.replace(/\b(turn(s|ing)? (away|around)|walk(s|ing)? (away|off)|spin(s|ning)?)\b/gi,'stays still')+FRONT_TAIL;
}
function readConfig(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return {};}}
function exists(p){try{return Boolean(p)&&fs.existsSync(p);}catch{return false;}}
function line(text){return String(text||'').split('\n').filter(Boolean).at(-1)||'';}

class ShowMotionPipeline {
 constructor({root,configFile=path.join(os.homedir(),'.config','gpt-live-avatar','show-motion.json'),characterDir=()=>'',workDir='',env=process.env}={}){
  Object.assign(this,{root,configFile,characterDir,env});this.workDir=workDir||path.join(root,'build','show-motions');this.jobs=new Map();
 }
 config(){
  const file=readConfig(this.configFile),dev=path.join(this.root,'build','motion-audit');
  const token=file.meshyApiKey||this.env.MESHY_API_KEY||(exists(path.join(dev,'meshy-token.txt'))?fs.readFileSync(path.join(dev,'meshy-token.txt'),'utf8').trim():'');
  const rig=file.rigTaskId||this.env.MESHY_RIG_TASK_ID||readConfig(path.join(dev,'new-rig-task.json')).result||'';
  const blender=file.blender||'/Applications/Blender.app/Contents/MacOS/Blender';
  const uv=[file.uv,path.join(os.homedir(),'.local','bin','uv'),'/opt/homebrew/bin/uv','/usr/local/bin/uv'].find(exists)||'';
  return {token,rig,blender,uv,blend:file.blend||'',python:file.python||'python3',donor:file.donor||'tia'};
 }
 status(){
  const c=this.config(),donorModel=path.join(this.characterDir(c.donor)||'',c.donor?'model.glb':'');
  const problems=[];
  if(!c.token)problems.push('Meshy API key (meshyApiKey in '+this.configFile+' or MESHY_API_KEY)');
  if(!c.rig)problems.push('Meshy rig task id (rigTaskId)');
  if(!exists(c.blender))problems.push('Blender at '+c.blender);
  if(!exists(c.blend))problems.push('the rig source .blend (blend)');
  if(!c.uv)problems.push('uv (for numpy and pillow)');
  if(!this.characterDir(c.donor)||!exists(donorModel))problems.push('the donor character '+c.donor+' installed locally');
  return {available:problems.length===0,problems,configFile:this.configFile,workDir:this.workDir,meshy:Boolean(c.token&&c.rig),blender:exists(c.blender),uv:Boolean(c.uv),blend:exists(c.blend)};
 }
 run(cmd,args,{signal,onProgress,env={}}){
  return new Promise((resolve,reject)=>{
   const child=spawn(cmd,args,{cwd:this.root,env:{...this.env,...env},stdio:['ignore','pipe','pipe']});let out='',err='',result=null;
   const abort=()=>{child.kill('SIGTERM');};signal?.addEventListener('abort',abort,{once:true});
   child.stdout.on('data',d=>{out+=d;let i;while((i=out.indexOf('\n'))>=0){const text=out.slice(0,i).trim();out=out.slice(i+1);if(text.startsWith('PROGRESS ')){try{onProgress?.(JSON.parse(text.slice(9)));}catch{}}else if(text.startsWith('RESULT ')){try{result=JSON.parse(text.slice(7));}catch{}}}});
   child.stderr.on('data',d=>{err+=d;if(err.length>20000)err=err.slice(-20000);});
   child.on('error',e=>{signal?.removeEventListener('abort',abort);reject(Error('Could not start '+path.basename(cmd)+': '+e.message));});
   child.on('close',code=>{signal?.removeEventListener('abort',abort);if(signal?.aborted)return reject(Error('Motion preparation cancelled.'));if(result&&result.ok===false)return reject(Error(result.error||'The motion step failed.'));if(code!==0||!result)return reject(Error((line(err)||'The motion step failed (exit '+code+').').slice(0,600)));resolve(result);});
  });
 }
 tool(){return path.join(this.root,'tools','show-motion.py');}
 async generate(motion,{slugs=[],signal,onProgress=()=>{},revision=''}={}){
  const status=this.status();if(!status.available)throw Error('Custom motions are not available: missing '+status.problems.join('; ')+'.');
  if(!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(motion?.id||''))throw Error('Invalid motion id.');
  const c=this.config(),clips=path.join(this.workDir,'clips'),rebuilt=path.join(this.workDir,'rebuilt'),env={MESHY_API_KEY:c.token,MESHY_RIG_TASK_ID:c.rig};
  await fsp.mkdir(clips,{recursive:true});await fsp.mkdir(rebuilt,{recursive:true});
  const report=(step,detail={})=>onProgress({id:motion.id,step,...detail});
  let attempt=0,generated=null,facing=null,prompt=frontFacing(motion.prompt);
  while(attempt<2){
   attempt++;const take=attempt===1?motion.id:motion.id+'-v'+attempt;
   report('generate',{attempt,prompt});
   generated=await this.run(c.python,[this.tool(),'generate','--id',take,'--prompt',prompt,'--duration',String(Math.min(6,Math.max(3,Number(motion.duration)||4))),'--out',clips],{signal,env,onProgress:p=>report('generate',{attempt,...p})});
   report('facing',{attempt});
   facing=await this.run(c.python,[this.tool(),'facing','--glb',generated.glb,'--blender',c.blender],{signal,onProgress:()=>{}});
   report('facing',{attempt,maxDeg:facing.maxDeg,passed:facing.passed});
   if(facing.passed)break;
   prompt=frontFacing(motion.prompt,true);
  }
  if(!facing?.passed)throw Error(`The generated motion turned ${facing?.maxDeg}\u00b0 away from the audience twice; keeping the fallback instead.`);
  report('retarget');
  const donorDir=this.characterDir(c.donor);
  const retargeted=await this.run(c.python,[this.tool(),'retarget','--id',motion.id,'--fbx',generated.fbx,'--out',rebuilt,'--blender',c.blender,'--blend',c.blend,'--model',path.join(donorDir,'model.glb')],{signal,onProgress:()=>{}});
  report('integrate',{frames:retargeted.frames});
  const characters=path.dirname(donorDir),targets=slugs.filter(s=>/^[a-z0-9_-]{1,40}$/.test(s)&&exists(path.join(characters,s,'runtime','motions','library.json')));
  if(!targets.length)throw Error('No installed character library to add the motion to.');
  const args=[this.tool(),'integrate','--clip',retargeted.clip,'--label',String(motion.label||motion.id).slice(0,40),'--characters',characters,'--slugs',targets.join(','),'--donor',c.donor,'--aliases',(motion.aliases||[]).join('|'),'--expression',JSON.stringify(motion.expression||{}),'--backup',path.join(this.workDir,'backup')];
  if(revision)args.push('--revision',revision);
  const integrated=await this.run(c.uv,['run','--quiet','--no-project','--with','numpy','--with','pillow','python',...args],{signal,onProgress:p=>report('integrate',p)});
  return {ok:true,id:motion.id,label:motion.label,attempts:attempt,facing:facing.maxDeg,frames:retargeted.frames,seconds:retargeted.seconds,characters:integrated.characters,revision:integrated.revision,files:{glb:generated.glb,fbx:generated.fbx,clip:retargeted.clip}};
 }
}
module.exports={ShowMotionPipeline,frontFacing};
