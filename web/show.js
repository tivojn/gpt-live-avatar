import {ShowPlayer,cueSheet} from '/show-player.js';
import {DirectorVoice} from '/show-director.js';
import {userCue,directorCue,stripCue,lineCoverage} from '/show-cues.js';
// Avatar Show · Playwright and Director. The Director talks with the user
// (live voice or text), the Playwright writes the script, the Director
// prepares motions (Meshy when configured) and runs the performance on the
// Together stage. A standby character covers any line the human passes on.
const $=s=>document.querySelector(s);
const PHASE_LABEL={planning:'planning',writing:'writing the script',preparing:'preparing motions',ready:'ready',performing:'performing',finished:'curtain call'};
export function installShow({api,voice,actors,catalogue,hooks}){
 let phase='planning',chat=[],script=null,resolved=new Map(),pipeline={available:false,problems:[]},player=null,humanWait=null,countdown=0,lastShow=null,busy=false,liveDraft=null,starting=false,generation=0;
 const director=new DirectorVoice(api,{
  connected:()=>{setStatus('The Director is listening. Say what show you would like.');refresh();},
  status:message=>{if(message)setStatus(message);},warning:message=>setStatus(message,true),
  error:message=>{setStatus(message,true);refresh();},
  microphone:()=>refresh(),
  text:({role,text,final})=>{if(final){liveDraft=null;}else liveDraft={role,text};renderChat();if(role==='user'&&humanWait&&!final)heard(text,false);},
  line:({role,text,typed})=>{
   if(role==='director'){const spoken=stripCue(text);if(spoken)pushChat('director',spoken);if(directorCue(text))void onDirectorCue();return;}
   if(typed)return; // typed messages are handled by send()
   pushChat('user',text);
   if(humanWait){heard(text,true);return;}
   void onUserText(text,false);
  },
 });
 director.contextFor=()=>context();
 const setStatus=(message,error=false)=>{$('#showStatus').textContent=message;$('#showStatus').classList.toggle('error',error);};
 const setPhase=next=>{phase=next;$('#showPhase').textContent=PHASE_LABEL[next]||next;refresh();};
 function pushChat(role,text){chat.push({role,text,at:Date.now()});chat=chat.slice(-80);renderChat();}
 function renderChat(){
  const box=$('#showChat');box.replaceChildren();
  for(const line of chat.slice(-30)){const p=document.createElement('p');p.className=line.role;const who=document.createElement('span');who.className='who';who.textContent=(line.role==='director'?'Director':hooks.human().name)+': ';p.append(who,document.createTextNode(line.text));box.append(p);}
  if(liveDraft?.text){const p=document.createElement('p');p.className='live '+liveDraft.role;p.textContent=(liveDraft.role==='director'?'Director':hooks.human().name)+' … '+liveDraft.text;box.append(p);}
  box.scrollTop=box.scrollHeight;
 }
 const cast=()=>hooks.selected().map(slug=>actors.get(slug)).filter(Boolean);
 const understudySlug=()=>{const slugs=hooks.selected();return hooks.human().enabled&&slugs.length>=2?slugs[slugs.length-1]:'';};
 const characterList=()=>cast().map(a=>({slug:a.slug,name:a.info.name,voice:hooks.voiceFor(a.slug),clips:[...(a.avatar.motion?.clips.values()||[])].map(c=>({id:c.id,label:c.label||c.id,category:c.category||'Motions'}))}));
 function motionSummary(){const counts=new Map();for(const c of cast()[0]?.avatar.motion?.clips.values()||[])counts.set(c.category||'Motions',(counts.get(c.category||'Motions')||0)+1);return [...counts].map(([k,v])=>`${k} (${v})`).join(', ');}
 function context(){
  const human=hooks.human();
  return {characters:characterList().map(({slug,name,voice})=>({slug,name,voice})),user:{enabled:human.enabled,name:human.name,role:script?.userRole?.role||''},understudy:understudySlug(),phase,script:script?summary(script):'',theme:hooks.topic(),length:$('#showLength').value,motions:motionSummary(),pipeline,prepared:[...resolved].filter(([id,to])=>id!==to).map(([id,to])=>`${id} → ${to||'skipped'}`).join(', ')};
 }
 function summary(s){return `"${s.title}": ${s.synopsis} Cast: ${s.cast.map(c=>c.name+' as '+c.role).join('; ')}${s.userRole?'; '+s.userRole.name+' (the human) as '+s.userRole.role+', standby '+s.userRole.understudyName:''}. ${s.scenes.length} scene(s), ${s.lineCount} lines.`;}
 function refresh(){
  const ready=cast().length>=1&&!hooks.loading(),live=director.running,hasKey=Boolean(catalogue()?.hasKey);
  $('#showMic').disabled=!hasKey||hooks.loading();$('#showMic').textContent=!live?'Talk to the Director':director.muted?'Unmute microphone':'Mute microphone';$('#showMic').setAttribute('aria-pressed',String(live&&!director.muted));
  $('#showSend').disabled=!hasKey&&!live;
  $('#showPrepare').disabled=!ready||busy||phase==='performing'||!hasKey;$('#showPrepare').textContent=script&&phase==='finished'?'Revise the show':'Prepare the show';
  $('#showStart').disabled=!script||busy||phase==='performing'||phase==='writing'||phase==='preparing';$('#showStart').textContent=phase==='finished'?'Play it again':'Start the show';
  $('#showStop').disabled=!(busy||phase==='performing'||phase==='ready'&&countdown);
  for(const a of actors.values())a.el.classList.toggle('standby',Boolean(hooks.human().enabled&&a.slug===understudySlug()&&['ready','performing','finished'].includes(phase)));
  hooks.controls();
 }
 // ------------------------------------------------------------ Director
 async function toggleMic(){
  if(director.running){director.setMuted(!director.muted);return;}
  if(!catalogue()?.hasKey){setStatus('Add a voice API key in Settings to talk to the Director.',true);return;}
  setStatus('Connecting the Director…');hooks.setIgnoreMouse(false);
  const ok=await director.start({voice:$('#showVoice').value,context:context()});
  if(ok&&phase==='performing')director.closeFloor();
  refresh();
 }
 async function onUserText(text,typed){
  const cue=userCue(text,phase);
  if(cue==='prepare'){if(!busy&&phase!=='performing')void prepare();return;}
  if(cue==='start'){if(script&&!busy&&phase!=='performing')void start();return;}
  if(cue==='stop'&&phase==='performing'){hooks.rest('The show was stopped.');return;}
  if(director.running){if(typed)director.say(text);return;}
  busy=true;refresh();setStatus('The Director is thinking…');let cued=false;
  try{
   const history=chat.map(l=>({role:l.role==='director'?'assistant':'user',text:l.text}));
   const result=await api.director({id:'director-'+Date.now().toString(36),history,context:context()});
   if(!result.ok)throw Error(result.error);
   const spoken=stripCue(result.text);if(spoken)pushChat('director',spoken);setStatus('');
   cued=Boolean(result.cue)||directorCue(result.text);
  }catch(e){setStatus(e.message,true);}
  finally{busy=false;refresh();}
  if(cued)void onDirectorCue();
 }
 async function onDirectorCue(){if(busy||phase==='performing')return;await prepare();}
 function send(){
  const text=$('#showText').value.trim();if(!text)return;$('#showText').value='';
  if(humanWait){finishHuman({result:'spoken',text});return;}
  pushChat('user',text);void onUserText(text,true);
 }
 // ------------------------------------------------- Playwright + Director
 async function prepare(){
  if(busy)return;const performers=cast();if(!performers.length){setStatus('Choose at least one character first.',true);return;}
  if(hooks.human().enabled&&performers.length<2){setStatus('With you in a role, choose at least two characters: one performs, one stands by.',true);return;}
  busy=true;const run=++generation,current=()=>run===generation;const revising=Boolean(script&&phase==='finished');const previous=revising?script:null;const feedback=revising?chat.filter(l=>l.role==='user'&&l.at>(lastShow||0)).map(l=>l.text).join(' '):'';
  setPhase('writing');director.closeFloor('The Playwright is writing and the Director is preparing the show.');setStatus(revising?'The Playwright is revising the script from your feedback…':'The Playwright is writing the script…');$('#showProgress').hidden=true;
  try{
   const request={id:'show-'+Date.now().toString(36),brief:{theme:hooks.topic(),transcript:chat.map(l=>({role:l.role,text:l.text})),notes:''},characters:characterList(),user:hooks.human(),understudy:understudySlug(),length:$('#showLength').value,previous,feedback};
   const result=await api.playwright(request);if(!current())return;if(!result.ok)throw Error(result.error);
   script=result.script;resolved=new Map();renderScript();
   setPhase('preparing');await prepareMotions(current);if(!current())return;
   setPhase('ready');$('#showScript').open=Boolean(script.userRole);
   const wait=script.userRole?8:4;setStatus(`Ready: “${script.title}”. Starting in ${wait} seconds… (Stop to hold)`);
   countdown=setTimeout(()=>{countdown=0;void start();},wait*1000);refresh();
  }catch(e){if(!current())return;setPhase(script?'finished':'planning');setStatus(e.message,true);if(director.running)director.openFloor('The preparation failed: '+String(e.message).slice(0,200)+'. Tell the user briefly and ask how to proceed.');}
  finally{if(current()){busy=false;refresh();}}
 }
 async function prepareMotions(current=()=>true){
  const wanted=script.wantedMotions||[],slugs=catalogue()?.avatars.map(a=>a.slug)||[];
  for(const w of wanted)resolved.set(w.id,w.fallback||'');
  const check=cue=>cue.motion&&(cue.speaker==='user'?[actors.get(cue.understudy)]:[actors.get(cue.speaker)]).filter(Boolean).every(a=>a.avatar.motion?.clips.has(cue.motion));
  const missing=cueSheet(script).filter(c=>c.motion&&!check(c)&&!wanted.some(w=>w.id===c.motion));
  for(const c of missing)resolved.set(c.motion,'');
  if(!wanted.length){setStatus(missing.length?`Ready. ${missing.length} line(s) use motions not installed for that character; they will play without a motion.`:'All motions are installed.');return;}
  const status=await api.pipeline();pipeline=status.ok?status.status:{available:false,problems:[status.error]};
  if(!pipeline.available){setStatus(`Custom motions (${wanted.map(w=>w.label).join(', ')}) are not available on this Mac (missing ${pipeline.problems.join('; ')}); using the closest installed motions instead.`);return;}
  const box=$('#showProgress');box.hidden=false;const lines=new Map();const draw=()=>{box.textContent=[...lines.values()].join('\n');};
  for(const w of wanted){lines.set(w.id,`${w.label}: queued`);}draw();
  const off=api.onProgress(p=>{if(!p||!lines.has(p.id))return;const w=wanted.find(x=>x.id===p.id);const detail=p.step==='generate'?`Meshy ${p.status||'text-to-motion'}${p.percent!=null?' '+p.percent+'%':''}${p.attempt>1?' (retry, front-facing prompt)':''}`:p.step==='facing'?(p.maxDeg!=null?`facing check ${p.maxDeg}° ${p.passed?'ok':'turned away, regenerating'}`:'checking that it faces the audience'):p.step==='retarget'?'retargeting in Blender':p.step==='integrate'?`adding to ${p.status||'the libraries'}`:p.step==='failed'?'failed: '+p.error:p.step;lines.set(p.id,`${w.label}: ${detail}`);draw();});
  setStatus(`The Director is creating ${wanted.length} custom motion${wanted.length>1?'s':''} with Meshy. This takes a few minutes per motion.`);
  try{
   const result=await api.generate({id:'prepare-'+Date.now().toString(36),motions:wanted,slugs});if(!current())return;if(!result.ok)throw Error(result.error);
   for(const r of result.results){const w=wanted.find(x=>x.id===r.id);if(r.ok){resolved.set(r.id,r.id);lines.set(r.id,`${w.label}: ready (${r.frames} frames, faces audience within ${r.facing}°, ${r.characters.length} characters)`);}else lines.set(r.id,`${w.label}: ${r.error} Using ${w.fallback||'no motion'} instead.`);}
   draw();
   if(result.results.some(r=>r.ok)){for(const a of actors.values()){const info=catalogue().avatars.find(x=>x.slug===a.slug);if(info?.motionsURL)await a.avatar.motion?.load(info.motionsURL).catch(()=>{});}
    for(const r of result.results.filter(r=>r.ok))for(const a of actors.values())if(a.avatar.motion?.clips.has(r.id))await a.avatar.motion.prepare(r.id).catch(e=>{lines.set(r.id,`${r.label}: ${a.info.name} cannot play it (${e.message}); using ${resolved.get(r.id)===r.id?'the fallback':''}`);resolved.set(r.id,wanted.find(x=>x.id===r.id)?.fallback||'');draw();});}
  }finally{off?.();}
 }
 function renderScript(){
  const body=$('#showScriptBody');body.replaceChildren();if(!script){$('#showScript').hidden=true;hooks.bill?.(null);return;}
  $('#showScript').hidden=false;const names=new Map(script.cast.map(c=>[c.slug,`${c.role} (${c.name})`]));hooks.bill?.(new Map(script.cast.map(c=>[c.slug,c.role])));if(script.userRole)names.set('user',`${script.userRole.role} (${script.userRole.name})`);
  const title=document.createElement('h3');title.textContent=script.title;const syn=document.createElement('p');syn.textContent=script.synopsis;body.append(title,syn);
  script.scenes.forEach((scene,si)=>{const h=document.createElement('h3');h.textContent=`Scene ${si+1}: ${scene.title}`;body.append(h);if(scene.setting){const s=document.createElement('p');s.className='stage';s.textContent=scene.setting;body.append(s);}
   scene.lines.forEach((line,li)=>{const p=document.createElement('p');p.dataset.cue=si+':'+li;if(line.speaker==='user')p.className='user-line';const b=document.createElement('b');b.textContent=(names.get(line.speaker)||line.speaker)+': ';p.append(b,document.createTextNode(line.text));if(line.motion||line.note||line.move||line.delivery){const em=document.createElement('span');em.className='stage';em.textContent=' ['+[line.note,line.delivery,line.move?'to '+line.move:'',line.motion].filter(Boolean).join(' · ')+']';p.append(em);}body.append(p);});});
 }
 // ------------------------------------------------------------ Performance
 const voiceCache=new Map();
 function stage(){
  const actorOf=slug=>actors.get(slug);
  return {
   scene:async(scene,i)=>{setStatus(`Scene ${i+1}: ${scene.title}`);await pause(700);},
   floor:({speaker,listener,cue})=>{hooks.setFloor(speaker==='user'?'_human':speaker,listener==='user'?'_human':listener);for(const a of actors.values())a.el.classList.toggle('speaking',a.slug===speaker);document.querySelectorAll('#showScriptBody p.current').forEach(p=>p.classList.remove('current'));const p=document.querySelector(`#showScriptBody p[data-cue="${cue.scene}:${cue.index}"]`);if(p){p.classList.add('current');p.scrollIntoView({block:'nearest'});}},
   motion:async(slug,id,expression)=>{const a=actorOf(slug);if(!a)return;a.showMood=Object.keys(expression).length?expression:null;if(id&&a.avatar.motion?.clips.has(id)){a.el.classList.remove('standby');void a.avatar.motion.play(id,{loop:false}).catch(()=>{});}},
   move:async(slug,destination)=>{const a=actorOf(slug);if(!a)return;a.el.classList.remove('standby');await hooks.walk(a,destination,()=>phase!=='performing');},
   speak:async(cue,slug,context=null)=>{const a=actorOf(slug);if(!a)throw Error('That character left the stage.');a.el.classList.remove('standby');const heard=await voice.speak(cue.text,hooks.voiceFor(slug),text=>hooks.setBubble(a,text),cue.delivery||'',context);await pause(350);return heard;},
   prepare:(cue,slug,context=null)=>{if(!actorOf(slug))return;voice.prepare?.(cue?.text,hooks.voiceFor(slug),cue?.delivery||'',context);},
   clear:slug=>{const a=actorOf(slug);if(!a)return;a.showMood=null;hooks.setBubble(a,'');a.el.classList.remove('speaking');},
   human:(cue,{timeoutMs})=>waitForHuman(cue,timeoutMs),
   understudy:async(cue,slug,reason)=>{const a=actorOf(slug);hidePrompter();setStatus(`${a?.info.name||'The standby'} steps in for ${script.userRole?.role||'you'}${reason==='takeover'?' for the rest of the show':''}.`);hooks.appendLine({info:{name:'Director'}},`${a?.info.name||'The standby'} takes the line for ${script.userRole?.role||hooks.human().name}.`);await pause(500);},
   line:({speaker,text,cue,forUser,skipped})=>{const role=speaker==='user'?`${script.userRole?.role||'You'} (${hooks.human().name})`:`${script.cast.find(c=>c.slug===speaker)?.role||actors.get(speaker)?.info.name||speaker}${forUser?' · standby as '+(script.userRole?.role||'you'):''}`;hooks.appendLine({info:{name:role}},skipped?'(line skipped) '+text:text);},
   status:async message=>{setStatus(message,true);await pause(600);},
   stop:()=>{voice.stopAll();hidePrompter();for(const a of actors.values()){a.showMood=null;a.el.classList.remove('speaking');hooks.setBubble(a,'');}},
  };
 }
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 async function start(){
  if(!script||phase==='performing'||busy)return;clearTimeout(countdown);countdown=0;
  if(!catalogue()?.hasKey){setStatus('Add a voice API key in Settings to perform.',true);return;}
  if(script.userRole&&!actors.has(script.userRole.understudy)){setStatus('The standby character is no longer on stage. Prepare the show again.',true);return;}
  if(script.cast.some(c=>!actors.has(c.slug))){setStatus('A cast member is no longer on stage. Prepare the show again.',true);return;}
  starting=true;try{hooks.beginShow();}finally{starting=false;}const run=++generation;setPhase('performing');director.closeFloor('The show is being performed; the human may read lines aloud. Do not react to them.');
  hooks.compact(true);hooks.minimize(true);setStatus(`“${script.title}” — curtain up.`);hooks.appendLine({info:{name:'Director'}},`“${script.title}” begins.`);
  player=new ShowPlayer(stage());
  let result;try{result=await player.run(script,{timeoutMs:script.userRole?25000:0,resolveMotion:id=>resolved.has(id)?resolved.get(id):id});}catch(e){setStatus(e.message,true);}
  if(run!==generation)return;
  const finished=Boolean(result?.finished);player=null;hidePrompter();hooks.setFloor('','');for(const a of actors.values()){a.el.classList.remove('speaking');hooks.setBubble(a,'');}
  lastShow=Date.now();setPhase('finished');hooks.endShow();hooks.minimize(false);
  const passes=result?.passes||0;setStatus(finished?`Curtain call. ${passes?`The standby covered ${passes} line${passes>1?'s':''}. `:''}Tell the Director what to change, or play it again.`:'The show was stopped.');
  if(director.running)director.openFloor(finished?'The performance has just ended. Ask the user in one sentence how they liked it and whether they want changes.':'');
  else if(finished)pushChat('director',`That is the end of “${script.title}”. How was it? Tell me what to change, or say “play it again”.`);
 }
 function halt(){
  if(starting)return;generation++;clearTimeout(countdown);countdown=0;if(player){const p=player;player=null;p.stop();}hidePrompter();$('#showProgress').hidden=true;
  for(const a of actors.values()){a.showMood=null;a.el.classList.remove('speaking');}
  const was=phase;if(busy){busy=false;setStatus('Preparation cancelled.');}if(was==='performing')hooks.minimize(false);
  if(was!=='planning'&&was!=='finished'){setPhase(script?'finished':'planning');if(was==='performing')lastShow=Date.now();if(director.running)director.openFloor(was==='performing'?'The show was stopped by the user. Ask in one sentence what they would like to do next.':'');}
  refresh();
 }
 // ------------------------------------------------------------ Prompter
 function waitForHuman(cue,timeoutMs){
  return new Promise(resolve=>{
   const role=script.userRole?.role||'Your line';$('#prompterRole').textContent=`${role} — your line`;$('#prompterText').textContent=cue.text;$('#prompterHeard').textContent='';$('#prompterFill').style.width='100%';
   $('#prompterHint').textContent=director.running&&!director.muted?'Read the line aloud; the Director’s microphone is listening. Say “I’ll pass” or click it and the standby steps in.':'The Director’s microphone is off: read the line, then click “I said it”, or type it below and send. “I’ll pass” lets the standby speak it.';
   $('#prompter').hidden=false;hooks.setIgnoreMouse(false);
   const started=performance.now(),limit=timeoutMs>0?timeoutMs:0;let deadline=limit?started+limit:0,text='',settleTimer=0;
   const tick=setInterval(()=>{const now=performance.now();if(deadline){const left=Math.max(0,deadline-now);$('#prompterFill').style.width=(left/limit*100)+'%';$('#prompterCount').textContent=Math.ceil(left/1000)+' s';if(left<=0)finish({result:'pass',auto:true});}else $('#prompterCount').textContent='';},200);
   const finish=value=>{if(humanWait?.finish!==finish)return;clearInterval(tick);clearTimeout(settleTimer);humanWait=null;resolve(value);};
   humanWait={cue,finish,heard:(spoken,final)=>{
    const cueKind=userCue(spoken,'performing');
    if(cueKind==='pass'||cueKind==='takeover'){finish({result:cueKind});return;}
    if(cueKind==='stop'){finish({result:'stop'});return;}
    text=final?[text,spoken].filter(Boolean).join(' '):spoken;$('#prompterHeard').textContent='Heard: '+(final?text:spoken);
    deadline=deadline?Math.max(deadline,performance.now()+12000):0;
    if(final){clearTimeout(settleTimer);const coverage=lineCoverage(text,cue.text);settleTimer=setTimeout(()=>finish({result:'spoken',text}),coverage>=.6?900:2600);}
   }};
  });
 }
 function heard(text,final){humanWait?.heard(text,final);}
 function finishHuman(value){const wait=humanWait;if(!wait)return;wait.finish(value);}
 function hidePrompter(){$('#prompter').hidden=true;$('#prompterCount').textContent='';}
 // ------------------------------------------------------------ Wiring
 function fillVoices(){const select=$('#showVoice');if(select.options.length)return;const voices=catalogue()?.voices||[];const used=new Set(Object.values(catalogue()?.groupVoices||{}));const preferred=voices.find(v=>v==='stone'&&!used.has(v))||voices.find(v=>!used.has(v))||voices[0];for(const v of voices){const o=document.createElement('option');o.value=v;o.textContent=v[0].toUpperCase()+v.slice(1);o.selected=v===preferred;select.append(o);}}
 $('#showMic').onclick=()=>void toggleMic();$('#showSend').onclick=send;$('#showText').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();send();}};
 $('#showPrepare').onclick=()=>void prepare();$('#showStart').onclick=()=>void start();$('#showStop').onclick=()=>hooks.rest('The show was stopped.');
 $('#prompterDone').onclick=()=>finishHuman({result:'spoken',text:''});$('#prompterPass').onclick=()=>finishHuman({result:'pass'});$('#prompterTakeover').onclick=()=>finishHuman({result:'takeover'});
 $('#showVoice').onchange=()=>{if(director.running)setStatus('The new Director voice applies the next time you start the Director.');};
 void api.pipeline().then(r=>{pipeline=r.ok?r.status:{available:false,problems:[r.error]};});
 return {
  get phase(){return phase;},get script(){return script;},get chat(){return chat;},get active(){return phase==='performing';},director,
  ready(){fillVoices();refresh();},
  get busy(){return busy;},
  refresh,halt,
  expression(actor,now){if(phase!=='performing')return {};const mood=actor.avatar.motion?.expression(now)||{};return actor.showMood?{...mood,...Object.fromEntries(Object.entries(actor.showMood).map(([k,v])=>[k,Math.max(v,mood[k]||0)]))}:mood;},
  leave(){halt();director.stop();hooks.bill?.(null);},
  dispose(){halt();director.stop();},
 };
}
