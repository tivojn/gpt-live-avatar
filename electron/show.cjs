'use strict';
// Avatar Show · Playwright and Director. The main process owns the model
// calls (Playwright script, Director reasoning, Director live voice session)
// and the custom-motion pipeline; the Together window owns the stage.
const {ipcMain}=require('electron');
const {playwrightRequest,parseScript,scriptSummary,clean}=require('./show-script.cjs');
const {ShowMotionPipeline}=require('./show-motions.cjs');
const {normalizeDelegate}=require('./delegate.cjs');
const CUE='Places, everyone!';
const PHASES=['planning','writing','preparing','ready','performing','finished'];
function showContext(context={}){
 if(!context||typeof context!=='object')context={};
 const characters=(Array.isArray(context.characters)?context.characters:[]).slice(0,5).map(c=>({slug:clean(c?.slug,60),name:clean(c?.name,60),voice:clean(c?.voice,30)})).filter(c=>/^[a-z0-9_-]+$/i.test(c.slug)&&c.name);
 return {
  characters,user:{enabled:context.user?.enabled===true,name:clean(context.user?.name,40)||'You',role:clean(context.user?.role,80)},understudy:clean(context.understudy,60),
  phase:PHASES.includes(context.phase)?context.phase:'planning',script:clean(context.script,1500),theme:clean(context.theme,600),length:['short','medium','long'].includes(context.length)?context.length:'medium',
  motions:clean(context.motions,600),pipeline:{available:context.pipeline?.available===true,problems:(Array.isArray(context.pipeline?.problems)?context.pipeline.problems:[]).map(p=>clean(p,160)).slice(0,6)},
  prepared:clean(context.prepared,600),
 };
}
function directorInstructions(raw,{live=false}={}){
 const c=showContext(raw);
 const cast=c.characters.length?c.characters.map(x=>`${x.name} (${x.slug})`).join(', '):'none selected yet';
 const standby=c.user.enabled?c.characters.find(x=>x.slug===c.understudy)?.name||'the last selected character':'';
 const audience=c.user.enabled?`${c.user.name} wants to act one role${c.user.role?' ('+c.user.role+')':''}; ${standby} is the standby who takes over any line ${c.user.name} passes on.`:`${c.user.name} watches without a role.`;
 const custom=c.pipeline.available?'Custom motions: when the script needs a movement nobody has installed, the Playwright lists it and you generate it with Meshy text-to-motion (about two to three minutes each, at most three per show), check that it faces the audience, retarget it and add it to every character.':`Custom motion generation is not configured on this Mac (missing ${c.pipeline.problems.join('; ')||'setup'}); the Playwright substitutes the closest installed motion instead.`;
 return `You are the Director of Avatar Show, a small theatre of animated 3D characters living on the user's Mac desktop. You plan the show with the user; the Playwright (a reasoning model) writes the script from your conversation; you prepare motions and run the performance with text-to-speech voices, installed motion clips and facial expressions.
Selected characters: ${cast}. ${audience}
Installed motions: ${c.motions||'about seventy clips per character: greetings, dance, fitness, martial arts, everyday gestures and a theatre set (bow, kneel and pray, soliloquy, brood, weep, plead, accuse, recoil in horror, collapse in grief, proclaim, madness).'}
${custom}
Current phase: ${c.phase}. Theme so far: ${c.theme||'(none)'}. Length: ${c.length}. Script: ${(c.script||'none yet').replace(/\.$/,'')}.${c.prepared?' Prepared: '+c.prepared+'.':''}
How you work:
- Answer in the user's language. Keep every turn to one or two short sentences and ask one question at a time.
- Learn the essentials: the story idea or theme, the mood, which characters perform, whether the user acts a role (and which), the length (short, medium or long) and the language of the play. Suggest ideas when the user is unsure.
- Never write or recite the play's lines yourself; the Playwright does that.
- When the user says they are ready, or confirms your summary, reply with a one-sentence summary of the show and end with the exact cue phrase "${CUE}" The app then writes the script, prepares any custom motions, and starts the performance. Use that phrase for nothing else.
- During preparation and performance the app tells you the floor is CLOSED: stay silent until it is opened again. Do not narrate the preparation as if you had already done it.
- After the performance, ask for feedback. If the user wants changes, restate them in one sentence and end with "${CUE}" so the Playwright revises the script; if they are happy, thank them and offer another show.
- Only describe abilities the characters really have; do not promise motions or effects that are not installed unless custom motion generation is available.${live?'\nThis is a live voice conversation. Handle it directly in your own voice. Delegate to the reasoning assistant only when the user asks something you cannot answer from this briefing.':''}`;
}
function setupShow(deps){
 const pipeline=new ShowMotionPipeline({root:deps.root,toolsDir:deps.toolsDir||'',workDir:deps.workDir||'',characterDir:slug=>deps.characterDir(slug),...(process.env.GLA_SHOW_MOTION_CONFIG?{configFile:process.env.GLA_SHOW_MOTION_CONFIG}:{})});
 let pendingVoice=null;const jobs=new Map();
 const allowed=e=>e.senderFrame===e.sender.mainFrame&&e.sender.getURL()===deps.origin+'/group.html';
 const handle=(channel,fn)=>ipcMain.handle(channel,async(e,...args)=>{try{if(!allowed(e))throw Error('Open Avatar Show first.');return {ok:true,...await fn(e,...args)};}catch(err){return {ok:false,error:err.status===401||err.status===403?'The voice API key was rejected. Check Settings.':String(err.message||'The show could not continue.').slice(0,600)};}});
 const reasoning=()=>{const config=deps.getConfig();const choice=config.reasoningMode==='delegate'?config:normalizeDelegate(config,{reasoningMode:'delegate',delegateProvider:'openai',delegateAuth:'api_key',delegateModel:'gpt-5.6-luna'});return {...config,...choice};};
 handle('gla:show:playwright',async(e,request={})=>{
  const r=playwrightRequest(request);
  const result=await deps.backend.answer(e.sender.id,r.id,{...reasoning(),personaName:'Playwright'},r.history,r.instructions,{long:true});
  const script=parseScript(result.text,request);
  return {script,summary:scriptSummary(script),provider:result.provider,model:result.model};
 });
 handle('gla:show:director',async(e,request={})=>{
  const id=String(request.id||'');if(!/^[a-zA-Z0-9_-]{1,160}$/.test(id))throw Error('Invalid Director request.');
  const history=(Array.isArray(request.history)?request.history:[]).slice(-40).map(x=>({role:x?.role==='assistant'?'assistant':'user',text:clean(x?.text,4000)})).filter(x=>x.text);
  const result=await deps.backend.answer(e.sender.id,id,{...reasoning(),personaName:'Director'},history,directorInstructions(request.context));
  return {text:result.text,cue:result.text.includes(CUE)};
 });
 handle('gla:show:director-live',async(_e,request={})=>{
  if(!deps.voices.includes(request.voice))throw Error('Choose a supported voice for the Director.');
  pendingVoice?.abort();const abort=new AbortController();pendingVoice=abort;
  try{return await deps.createSession({sdp:request.sdp,voice:request.voice,groupInstructions:directorInstructions(request.context,{live:true})+' Initially the floor is OPEN: greet the user in one sentence and ask what show they would like.'},AbortSignal.any([abort.signal,AbortSignal.timeout(30000)]));}
  finally{if(pendingVoice===abort)pendingVoice=null;}
 });
 handle('gla:show:pipeline',()=>({status:pipeline.status()}));
 handle('gla:show:generate',async(e,request={})=>{
  const id=String(request.id||'');if(!/^[a-zA-Z0-9_-]{1,160}$/.test(id))throw Error('Invalid preparation request.');
  const motions=(Array.isArray(request.motions)?request.motions:[]).slice(0,3),slugs=(Array.isArray(request.slugs)?request.slugs:[]).map(s=>clean(s,40));
  const abort=new AbortController();jobs.get(e.sender.id)?.abort();jobs.set(e.sender.id,abort);
  const results=[];const stamp=new Date().toISOString().replace(/[-:T]/g,'').slice(0,14),revision='show-'+stamp.slice(0,8)+'-'+stamp.slice(8);
  try{
   for(const motion of motions){
    if(abort.signal.aborted)throw Error('Motion preparation cancelled.');
    const progress=detail=>{if(!e.sender.isDestroyed())e.sender.send('gla:show:progress',{id,...detail});};
    try{results.push(await pipeline.generate({id:motion.id,label:clean(motion.label,40)||motion.id,prompt:clean(motion.prompt,600),duration:motion.duration,aliases:(Array.isArray(motion.aliases)?motion.aliases:[]).map(a=>clean(a,30)).filter(Boolean),expression:motion.expression&&typeof motion.expression==='object'?motion.expression:{}},{slugs,signal:abort.signal,onProgress:progress,revision}));}
    catch(err){if(abort.signal.aborted)throw err;results.push({ok:false,id:motion.id,label:motion.label,error:String(err.message).slice(0,400)});progress({id:motion.id,step:'failed',error:String(err.message).slice(0,400)});}
   }
   return {results,revision};
  }finally{if(jobs.get(e.sender.id)===abort)jobs.delete(e.sender.id);}
 });
 handle('gla:show:cancel',e=>{pendingVoice?.abort();pendingVoice=null;jobs.get(e.sender.id)?.abort();jobs.delete(e.sender.id);deps.backend.cancel(e.sender.id);return {};});
 return {pipeline,cancelAll(){pendingVoice?.abort();for(const job of jobs.values())job.abort();jobs.clear();}};
}
module.exports={setupShow,directorInstructions,showContext,CUE};
