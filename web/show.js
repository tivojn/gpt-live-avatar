import {estimateProgress,usualMs,remember,recall} from '/show-progress.js';
import {ShowPlayer,cueSheet} from '/show-player.js';
import {DirectorVoice} from '/show-director.js';
import {userCue,directorCue,stripCue,lineCoverage} from '/show-cues.js';
import {ShowRecorder,recordingType} from '/show-recorder.js';
// Avatar Show · Playwright and Director. The Director talks with the user
// (live voice or text), the Playwright writes the script, the Director
// prepares motions (Meshy when configured) and runs the performance on the
// Together stage. A standby character covers any line the human passes on.
const $=s=>document.querySelector(s);
const TALKING=['talk-with-hands-open','talk-with-left-hand-raised','talk-with-right-hand-open','stand-and-chat'];
const PHASE_LABEL={planning:'planning',writing:'writing the script',preparing:'preparing motions',ready:'ready',performing:'performing',finished:'curtain call'};
export function installShow({api,voice,actors,catalogue,hooks}){
 let phase='planning',chat=[],script=null,resolved=new Map(),pipeline={available:false,problems:[]},player=null,humanWait=null,countdown=0,lastShow=null,busy=false,liveDraft=null,starting=false,generation=0;
 // Notes from the audience mid-show ("do it in an Irish accent") reach every later line; the show holds while the Director acknowledges one.
let castNotes={};
 let writeKey='medium',writeUsual=75000;
 let notes=[],resumeTimer=0,phaseTimer=0,phaseStarted=0,connecting=false,recorder=null,recordingSink=null,savedRecording='',saving=false,savePromise=Promise.resolve();
 const PERFORMING='The show is being performed; the human may read lines aloud or call out notes for the cast. Stay silent unless the app opens the floor.';
 const director=new DirectorVoice(api,{
  connected:()=>{setStatus(phase==='performing'?'The Director is listening quietly. Call out a note for the cast at any time.':phase==='finished'?'The Director is listening. Say what to change, or “play it again”.':'The Director is listening. Say what show you would like.');refresh();},
  status:message=>{if(message)setStatus(message);},warning:message=>setStatus(message,true),
  error:message=>{setStatus(message,true);refresh();},
  microphone:()=>refresh(),
  stream:(stream,output)=>recorder?.addAudio(stream,output),
  text:({role,text,final})=>{if(final){liveDraft=null;}else liveDraft={role,text};renderChat();if(role==='user'&&humanWait&&!final)heard(text,false);},
  line:({role,text,typed})=>{
   if(role==='director'){const spoken=stripCue(text);if(spoken)pushChat('director',spoken);if(directorCue(text))void onDirectorCue();
    // The Director has answered a note: close the floor again and let the show go on.
    if(phase==='performing'&&director.floorOpen){clearTimeout(resumeTimer);resumeTimer=setTimeout(()=>resumeShow('director'),900);}
    return;}
   if(typed)return; // typed messages are handled by send()
   pushChat('user',text);
   if(humanWait){heard(text,true);return;}
   void onUserText(text,false);
  },
 });
 director.contextFor=()=>context();
 const setStatus=(message,error=false)=>{$('#showStatus').textContent=message;$('#showStatus').classList.toggle('error',error);};
 const mmss=ms=>{const s=Math.max(0,Math.round(ms/1000));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');};
 const setPhase=next=>{phase=next;clearInterval(phaseTimer);phaseTimer=0;$('#showPhase').textContent=PHASE_LABEL[next]||next;
  // Waiting on a model or on Meshy: show the clock so nobody wonders whether anything is happening.
  const bar=$('#showBar');if(bar)bar.hidden=next!=='writing';
  if(next==='writing'||next==='preparing'){phaseStarted=performance.now();const tick=()=>{const elapsed=performance.now()-phaseStarted;let label=(PHASE_LABEL[phase]||phase)+' · '+mmss(elapsed);
    // Writing has no real progress signal, so the bar is an estimate from how long the last scripts took (show-progress.js).
    if(phase==='writing'&&bar){const p=estimateProgress(elapsed,writeUsual);bar.firstElementChild.style.width=(p.fraction*100).toFixed(1)+'%';bar.setAttribute('aria-valuenow',String(p.percent));
     label=PHASE_LABEL.writing+' · '+p.percent+'% · '+(p.late?'taking longer than usual · '+mmss(elapsed):'about '+mmss(p.leftMs)+' left');}
    $('#showPhase').textContent=label;};tick();phaseTimer=setInterval(tick,500);}
  refresh();};
 function pushChat(role,text){chat.push({role,text,at:Date.now()});chat=chat.slice(-80);renderChat();}
 // The chat is a live region: only new lines are added to it and the running
 // transcript is a single node that changes, so a screen reader hears each
 // line once rather than the whole history on every partial.
 const rendered=[];let draftNode=null;
 function renderChat(){
  const box=$('#showChat'),lines=chat.slice(-30);
  const lineNode=line=>{const p=document.createElement('p');p.className=line.role;const who=document.createElement('span');who.className='who';who.textContent=(line.role==='director'?'Director':hooks.human().name)+': ';p.append(who,document.createTextNode(line.text));return p;};
  while(rendered.length&&rendered[0].line!==lines[0]){rendered.shift().node.remove();}
  if(rendered.some((r,i)=>r.line!==lines[i])){for(const r of rendered)r.node.remove();rendered.length=0;}
  for(const line of lines.slice(rendered.length)){const node=lineNode(line);rendered.push({line,node});box.insertBefore(node,draftNode);}
  if(liveDraft?.text){if(!draftNode){draftNode=document.createElement('p');box.append(draftNode);}draftNode.className='live '+liveDraft.role;const text=(liveDraft.role==='director'?'Director':hooks.human().name)+' … '+liveDraft.text;if(draftNode.textContent!==text)draftNode.textContent=text;}
  else if(draftNode){draftNode.remove();draftNode=null;}
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
  // Characters take a while to appear; say so rather than leave a dead button.
  $('#showPhase').classList.toggle('loading',hooks.loading());$('#showStatus').classList.toggle('loading',hooks.loading());
  if(hooks.loading()){$('#showPhase').textContent='loading characters…';if(!/Loading the characters/.test($('#showStatus').textContent))setStatus('Loading the characters onto the stage… the Director is ready as soon as they appear.');}
  else if(/Loading the characters/.test($('#showStatus').textContent)){$('#showPhase').textContent=PHASE_LABEL[phase]||phase;setStatus('Ready. Tell the Director what show you want, by voice or text.');}
  const mic=$('#showMic');mic.disabled=!hasKey||hooks.loading()||connecting;mic.classList.toggle('live',live);mic.classList.toggle('muted',live&&director.muted);mic.classList.toggle('connecting',connecting);
  mic.querySelector('span').textContent=connecting?'Connecting…':!live?'Talk to the Director':director.muted?'Unmute microphone':'Listening · mute';mic.title=!live?'Start a live voice conversation with the Director':director.muted?'Unmute the microphone':'Mute the microphone';mic.setAttribute('aria-pressed',String(live&&!director.muted));
  $('#showHangup').hidden=!live;
  $('#showSend').disabled=!hasKey&&!live;
  $('#showPrepare').disabled=!ready||busy||phase==='performing'||!hasKey;$('#showPrepare').textContent=script&&phase==='finished'?'Revise the show':'Prepare the show';
  $('#showStart').disabled=!script||busy||phase==='performing'||phase==='writing'||phase==='preparing';$('#showStart').textContent=phase==='finished'?'Play it again':'Start the show';
  $('#showStop').disabled=!(busy||phase==='performing'||phase==='ready'&&countdown);
  $('#showPause').disabled=phase!=='performing'||!player;$('#showPause').textContent=player?.paused?'Resume':'Pause';
  // The same controls live in the panel header, reachable when the panel is folded or compact.
  const showing=phase==='performing'&&Boolean(player);$('#headPause').hidden=!showing;$('#headPause').textContent=player?.paused?'Resume':'Pause';$('#headStop').hidden=!showing;
  // Leaving is spelled out in words once there is nothing to interrupt; during a performance Stop is the button, and the × light still closes.
  if($('#headClose'))$('#headClose').hidden=showing;
  $('#showRecord').disabled=!recordingType()||phase==='performing';$('#showReveal').hidden=!savedRecording;
  // The header's record light: grey when off, red when armed for the next show, breathing while it records.
  const rec=$('#headRecord'),recording=Boolean(recorder?.active),armed=$('#showRecord').checked;rec.disabled=!recordingType()||saving;
  rec.classList.toggle('on',recording);rec.classList.toggle('armed',!recording&&armed);rec.textContent=recording?'Recording':saving?'Saving…':'Record';
  rec.title=recording?'Stop recording now and save the video':showing?'Start recording the rest of the show':armed?'Recording is on for the next show · click to turn it off':'Record the next show to MP4';rec.setAttribute('aria-pressed',String(recording||armed));
  for(const a of actors.values())a.el.classList.toggle('standby',Boolean(hooks.human().enabled&&a.slug===understudySlug()&&['ready','performing','finished'].includes(phase)));
  hooks.controls();
 }
 // ------------------------------------------------------------ Director
 async function toggleMic(){
  if(connecting)return;
  if(director.running){director.setMuted(!director.muted);return;}
  if(!catalogue()?.hasKey){setStatus('Add a voice API key in Settings to talk to the Director.',true);return;}
  setStatus('Connecting the Director…');hooks.setIgnoreMouse(false);connecting=true;refresh();
  // During a performance the Director joins silently; it only speaks when a note needs an answer.
  try{await director.start({voice:$('#showVoice').value,context:context(),floorOpen:phase!=='performing'});}finally{connecting=false;refresh();}
 }
 // Hang up the voice session (it bills per connected minute) without touching
 // the script, the motions or the performance. The mic button reconnects.
 function hangUp(reason=''){
  if(!director.running)return;director.stop();refresh();
  setStatus(reason||'Director voice hung up: no session cost until you tap the microphone again. Anything in progress continues.');
 }
 async function onUserText(text,typed){
  const cue=userCue(text,phase);
  if(cue==='prepare'){if(!busy&&phase!=='performing')void prepare();return;}
  if(cue==='start'){if(script&&!busy&&phase!=='performing')void start();return;}
  if(cue==='stop'&&phase==='performing'){hooks.rest('The show was stopped.');return;}
  if(phase==='performing'){if(cue==='continue')resumeShow('user');else if(cue==='pause')holdShow();else if(!['pass','takeover'].includes(cue))void noteFromAudience(text);return;}
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
 // A note called out during the performance: hold after the current line, tell
 // the cast, let the Director acknowledge it in one breath, then continue.
 async function noteFromAudience(text){
  if(!player||phase!=='performing')return;
  const note=String(text||'').trim().slice(0,200);if(!note)return;
  notes=[...notes,note].slice(-4);voice.dropWarm?.();
  player.pause();clearTimeout(resumeTimer);
  setStatus(`Note for the cast: “${note}”. The show holds after this line${director.running?' while the Director answers':''}; say “continue” or wait.`);
  if(director.running){director.openFloor(`The audience just called out a note for the cast during the performance: ${JSON.stringify(note)}. In one short sentence acknowledge it and say how the cast will apply it from the next line, ending with the word "Action!". Do not perform any lines yourself and do not ask a question.`);resumeTimer=setTimeout(()=>resumeShow('timeout'),14000);}
  else resumeTimer=setTimeout(()=>resumeShow('auto'),3500);
 }
 function resumeShow(){
  clearTimeout(resumeTimer);resumeTimer=0;
  if(director.running&&phase==='performing')director.closeFloor(PERFORMING);
  if(player?.paused){player.resume();recorder?.resume();setStatus(notes.length?`Continuing. Notes in effect: ${notes.join('; ')}.`:'Continuing.');}
  refresh();
 }
 // The user's own pause: hold after this line until Resume or “continue”.
 function holdShow(reason='user'){
  if(!player||phase!=='performing'||player.paused)return;clearTimeout(resumeTimer);resumeTimer=0;
  player.pause();setStatus(reason==='note'?'Holding after this line while you give a note.':'Paused after this line. Press Resume or say “continue”.');refresh();
 }
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
  writeKey=$('#showLength').value+(revising?':revise':'');writeUsual=usualMs(recall(localStorage,writeKey));const writeStarted=performance.now();
  setPhase('writing');$('#showProgress').hidden=true;
  // Writing and motion preparation can take minutes; the live voice would only
  // sit there billing per minute, so hang it up and say so. The countdown still
  // starts the show; tapping the mic brings the Director back with full context.
  const hungUp=director.running;if(hungUp)director.stop();
  setStatus((revising?'The Playwright is revising the script from your feedback…':'The Playwright is writing the script…')+(hungUp?' Director voice hung up to save session cost; tap the microphone whenever you want to talk again.':''));
  try{
   const request={id:'show-'+Date.now().toString(36),brief:{theme:hooks.topic()||(chat.some(l=>l.role==='user')?'':hooks.suggestion?.()||''),transcript:chat.map(l=>({role:l.role,text:l.text})),notes:''},characters:characterList(),user:hooks.human(),understudy:understudySlug(),length:$('#showLength').value,previous,feedback};
   const result=await api.playwright(request);if(!current())return;if(!result.ok)throw Error(result.error);
   remember(localStorage,writeKey,performance.now()-writeStarted);
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
  if(!pipeline.available){setStatus(`Custom motions (${wanted.map(w=>w.label).join(', ')}) are not available on this ${navigator.platform.includes('Mac')?'Mac':'computer'} (missing ${pipeline.problems.join('; ')}); using the closest installed motions instead.`);return;}
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
   // Most lines carry no motion (the Playwright keeps motions for what a character is literally doing), so the
   // speaker talks with her hands: a conversational clip on a line long enough to hold one (they run about four
   // seconds), otherwise a shift of stance. Never the same clip twice running, and not on every line.
   talk:(slug,cue)=>{const a=actorOf(slug),motion=a?.avatar.motion;if(!a||!motion||motion.active)return;
    const words=String(cue.text||'').trim().split(/\s+/).filter(Boolean).length,pool=TALKING.filter(id=>motion.clips.has(id)&&id!==a.lastTalk);
    if(words>=10&&pool.length&&Math.random()<.75){a.lastTalk=pool[Math.floor(Math.random()*pool.length)];a.el.classList.remove('standby');void motion.play(a.lastTalk,{loop:false}).catch(()=>{});}
    else if(a.avatar.options&&a.avatar.options.nextPlaybackAt!==undefined)a.avatar.options.nextPlaybackAt=performance.now();},
   move:async(slug,destination)=>{const a=actorOf(slug);if(!a)return;a.el.classList.remove('standby');await hooks.walk(a,destination,()=>phase!=='performing');},
   // The line is scripted, so the bubble shows it the moment the cue starts; the
   // voice's own transcript trails the audio by a second and only ever confirms it.
   speak:async(cue,slug,context=null)=>{const a=actorOf(slug);if(!a)throw Error('That character left the stage.');a.el.classList.remove('standby');hooks.setBubble(a,cue.text);const heard=await voice.speak(cue.text,hooks.voiceFor(slug),text=>{if(text.length>=cue.text.length)hooks.setBubble(a,text);},cue.delivery||'',noted(context,slug));await pause(350);return heard;},
   prepare:(cue,slug,context=null)=>{if(!actorOf(slug))return;voice.prepare?.(cue?.text,hooks.voiceFor(slug),cue?.delivery||'',noted(context,slug));},
   paused:held=>{for(const a of actors.values())a.el.classList.toggle('held',held);refresh();},
   // The recording stops only once the hold takes effect, after the line under way, so no line is cut short in the file.
   held:()=>recorder?.hold(),
   clear:slug=>{const a=actorOf(slug);if(!a)return;a.showMood=null;hooks.setBubble(a,'');a.el.classList.remove('speaking');},
   human:(cue,{timeoutMs})=>waitForHuman(cue,timeoutMs),
   understudy:async(cue,slug,reason)=>{const a=actorOf(slug);hidePrompter();setStatus(`${a?.info.name||'The standby'} steps in for ${script.userRole?.role||'you'}${reason==='takeover'?' for the rest of the show':''}.`);hooks.appendLine({info:{name:'Director'}},`${a?.info.name||'The standby'} takes the line for ${script.userRole?.role||hooks.human().name}.`);await pause(500);},
   line:({speaker,text,cue,forUser,skipped})=>{const role=speaker==='user'?`${script.userRole?.role||'You'} (${hooks.human().name})`:`${script.cast.find(c=>c.slug===speaker)?.role||actors.get(speaker)?.info.name||speaker}${forUser?' · standby as '+(script.userRole?.role||'you'):''}`;hooks.appendLine({info:{name:role}},skipped?'(line skipped) '+text:text);},
   status:async message=>{setStatus(message,true);await pause(600);},
   stop:()=>{voice.stopAll();hidePrompter();for(const a of actors.values()){a.showMood=null;a.el.classList.remove('speaking');hooks.setBubble(a,'');}},
  };
 }
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 // Audience notes, and a character's own private notes, ride along as the director's ask for her later lines.
 const noted=(context,slug='')=>{const mine=castNotes[slug]||[];if(!notes.length&&!mine.length)return context;return {...(context||{}),note:[context?.note||'',...notes,...mine].filter(Boolean).join('; ').slice(0,200)};};
 // A private note to one character while the show plays: no hold, no Director, she just carries on with it.
 function steer(slug,text){
  const note=String(text||'').trim().slice(0,200),a=actors.get(slug);if(!note||!a||phase!=='performing')return false;
  castNotes={...castNotes,[slug]:[...(castNotes[slug]||[]),note].slice(-3)};voice.dropWarm?.();
  hooks.appendLine({info:{name:`Note to ${a.info.name}`}},note);setStatus(`Note for ${a.info.name}: “${note}”. She carries on and applies it from her next line.`);return true;
 }
 async function start(){
  if(!script||phase==='performing'||busy)return;clearTimeout(countdown);countdown=0;
  if(!catalogue()?.hasKey){setStatus('Add a voice API key in Settings to perform.',true);return;}
  if(script.userRole&&!actors.has(script.userRole.understudy)){setStatus('The standby character is no longer on stage. Prepare the show again.',true);return;}
  if(script.cast.some(c=>!actors.has(c.slug))){setStatus('A cast member is no longer on stage. Prepare the show again.',true);return;}
  starting=true;try{hooks.beginShow();}finally{starting=false;}const run=++generation;notes=[];castNotes={};setPhase('performing');director.closeFloor(PERFORMING);
  hooks.compact(true);hooks.minimize(true);setStatus(`“${script.title}” — curtain up.`);hooks.appendLine({info:{name:'Director'}},`“${script.title}” begins.`);
  player=new ShowPlayer(stage());savedRecording='';refresh(); // the Pause button exists only once there is a player
  if($('#showRecord').checked&&recordingType())startRecording();
  let result;try{result=await player.run(script,{timeoutMs:script.userRole?25000:0,resolveMotion:id=>resolved.has(id)?resolved.get(id):id});}catch(e){setStatus(e.message,true);}
  if(run!==generation)return;
  clearTimeout(resumeTimer);resumeTimer=0;endSteer();for(const a of actors.values())a.el.classList.remove('held');
  const finished=Boolean(result?.finished);player=null;hidePrompter();hooks.setFloor('','');savePromise=finishRecording(finished?'finished':'stopped');for(const a of actors.values()){a.el.classList.remove('speaking');hooks.setBubble(a,'');}
  lastShow=Date.now();setPhase('finished');hooks.endShow();hooks.minimize(false);
  const passes=result?.passes||0;setStatus(finished?`Curtain call. ${passes?`The standby covered ${passes} line${passes>1?'s':''}. `:''}Tell the Director what to change, or play it again.`:result?.aborted||'The show was stopped.',Boolean(result?.aborted));
  if(director.running)director.openFloor(finished?'The performance has just ended. Ask the user in one sentence how they liked it and whether they want changes.':'');
  else if(finished)pushChat('director',`That is the end of “${script.title}”. How was it? Tell me what to change, or say “play it again”.`);
 }
 function halt(){
  if(starting)return;generation++;clearTimeout(countdown);countdown=0;clearTimeout(resumeTimer);resumeTimer=0;endSteer();if(player){const p=player;player=null;p.stop();savePromise=finishRecording('stopped');}hidePrompter();$('#showProgress').hidden=true;
  for(const a of actors.values()){a.showMood=null;a.el.classList.remove('speaking','held');}
  const was=phase;
  // Stop cancels whatever is running: the Playwright, the Meshy jobs, or a Director answer.
  if(busy){busy=false;if(was==='writing'||was==='preparing'){void api.cancel({scope:was==='preparing'?'generate':'playwright'});setStatus('Preparation cancelled.');}else{void api.cancel({scope:'director'});setStatus('Cancelled.');}}
  if(was==='performing')hooks.minimize(false);
  // Stop during the countdown keeps the script ready to start by hand.
  if(was==='ready'){setStatus(`Countdown stopped. “${script?.title||'The show'}” is ready: press “Start the show” whenever you like.`);}
  else if(was!=='planning'&&was!=='finished'){setPhase(script?'finished':'planning');if(was==='performing')lastShow=Date.now();if(director.running)director.openFloor(was==='performing'?'The show was stopped by the user. Ask in one sentence what they would like to do next.':'');}
  refresh();
 }
 // ------------------------------------------------------------ Live steering
 // A private note to one character, by voice, through gpt-live-1: a short
 // session in her own voice. She hears the director in real time, replies
 // with one sentence in character, and the note lands on her next lines.
 let steerLive=null;
 async function steerVoice(slug){
  const a=actors.get(slug);if(!a||phase!=='performing')return false;
  if(steerLive){if(steerLive.slug===slug&&steerLive.state==='listening'){finishSteer('user');return true;}return false;}
  if(!catalogue()?.hasKey){setStatus('Add a voice API key in Settings to steer by voice.',true);return false;}
  holdShow('note');
  const role=script?.cast.find(c=>c.slug===slug)?.role||'',scene=script?.scenes?.[player?.scene||0]?.title||'';
  const session=new DirectorVoice({directorLive:req=>api.steerLive({sdp:req.sdp,voice:hooks.voiceFor(slug),character:a.info.name,role,scene}),director:async()=>({ok:false,error:'Not available while steering.'}),cancel:()=>{}},{
   connected:()=>{if(steerLive?.voice!==session)return;steerLive.state='listening';setStatus(`${a.info.name} is listening to your note. Speak, then press Done (or the mic) when finished.`);hooks.setBubble(a,'…');refreshSteer(slug);},
   error:message=>{if(steerLive?.voice!==session)return;endSteer();resumeShow('note');setStatus('Voice note failed: '+message+' You can type the note instead.',true);},
   text:({role,text,final})=>{if(steerLive?.voice!==session)return;if(role==='user'){steerLive.partial=text;hooks.setBubble(a,'“'+text+'…”');}else if(text)hooks.setBubble(a,text);},
   line:({role,text})=>{if(steerLive?.voice!==session)return;
    if(role==='user'){steerLive.heard.push(text);steerLive.partial='';if(steerLive.state==='listening'){setStatus(`${a.info.name} is taking your note…`);}return;}
    applySteer(text);},
   microphone:()=>refreshSteer(slug),
  });
  steerLive={slug,voice:session,heard:[],partial:'',state:'connecting',timer:setTimeout(()=>finishSteer('timeout'),45000)};
  setStatus(`Connecting to ${a.info.name}…`);refreshSteer(slug);
  const ok=await session.start({voice:hooks.voiceFor(slug),context:{},floorOpen:true});
  if(!ok&&steerLive?.voice===session){endSteer();resumeShow('note');if(!/Voice note failed/.test($('#showStatus').textContent))setStatus('Voice note could not start. You can type the note instead.',true);}
  return ok;
 }
 // The director has finished: she acknowledges, then the show goes on.
 function finishSteer(reason){
  if(!steerLive)return;const a=actors.get(steerLive.slug);
  if(!steerLive.heard.length&&!steerLive.partial){endSteer();setStatus('No note heard. Continuing.');resumeShow('note');return;}
  steerLive.state='taking';setStatus(`${a?.info.name||'She'} is taking your note…`);refreshSteer(steerLive.slug);
  steerLive.voice.client?.appendCommentary('The director has finished giving the note. Acknowledge it now in one short sentence, in character, and say nothing else.');
  clearTimeout(steerLive.timer);steerLive.timer=setTimeout(()=>applySteer(''),8000);
 }
 function applySteer(acknowledgement){
  if(!steerLive)return;const {slug,heard,partial}=steerLive,a=actors.get(slug);
  const note=[...heard,partial].filter(Boolean).join(' ').trim();
  endSteer();
  if(note){steer(slug,note);if(acknowledgement)hooks.setBubble(a,acknowledgement);setStatus(`${a?.info.name||'She'} has the note: “${note}”. Continuing.`);}
  else setStatus('No note heard. Continuing.');
  setTimeout(()=>resumeShow('note'),acknowledgement?900:100);
 }
 // Once the note is taken (or dropped) her bubble closes; it must not linger over the stage.
 function endSteer(){const s=steerLive;steerLive=null;if(!s)return;clearTimeout(s.timer);s.voice.stop();hooks.noteDone?.(s.slug);refreshSteer(s.slug);}
 // The director changed their mind (closed the bubble): drop the note and carry on.
 function cancelSteer(slug){if(!steerLive||slug&&steerLive.slug!==slug)return false;endSteer();setStatus('Note cancelled. Continuing.');resumeShow('note');return true;}
 function refreshSteer(slug){hooks.refreshActor?.(slug);}
 // ------------------------------------------------------------ Recording
 // Captions name the part, not its description: “Tia, Keeper of the Regalia — anxious, dramatic…” becomes “Tia, Keeper of the Regalia”.
 const shortRole=role=>{const s=String(role||'').split(/\s[—–-]\s|[:;(]/)[0].trim();return s.length>48?s.slice(0,47).trimEnd()+'…':s;};
 const roleOf=slug=>slug==='_human'||slug==='user'?`${shortRole(script?.userRole?.role)||'You'} (${hooks.human().name})`:(shortRole(script?.cast.find(c=>c.slug===slug)?.role)||actors.get(slug)?.info.name||'');
 function recordFrame(now,{actors:cast,speaker,viewport}){
  if(!recorder)return;
  const who=speaker,text=who==='_human'?(humanWait?$('#prompterText').textContent:''):(cast.get(who)?.message||'');
  recorder.frame(cast,{speaker:who,caption:text?{who:roleOf(who),text}:null,viewport});
 }
 function recordAudio(stream,output){recorder?.addAudio(stream,output);}
 // The file is opened on disk as the show starts and every encoded chunk is
 // appended in order as it arrives, so the recording never sits in memory.
 function startRecording(){
  const sink={id:'',queue:Promise.resolve(),failed:''};
  const append=chunk=>{sink.queue=sink.queue.then(async()=>{if(sink.failed)return;const r=await api.recordingChunk({id:sink.id,bytes:await chunk.arrayBuffer()});if(!r.ok)throw Error(r.error);}).catch(e=>{sink.failed=e.message;});};
  try{recorder=new ShowRecorder({onChunk:append});recorder.start();}catch(e){recorder=null;setStatus('Recording unavailable: '+e.message,true);return;}
  recordingSink=sink;sink.queue=api.recordingOpen({title:script?.title||'Avatar Show',ext:recorder.type.ext}).then(r=>{if(!r.ok)throw Error(r.error);sink.id=r.id;}).catch(e=>{sink.failed=e.message;});
  hooks.onFrame(recordFrame,true);hooks.onAudio(recordAudio,true);
  // A Director already on the line is part of the show too.
  if(director.running&&director.stream)recorder.addAudio(director.stream,director.output);
  refresh();
 }
 // The header light: mid-show it starts or stops the recording itself; otherwise it arms the next show.
 function toggleRecording(){
  if(phase==='performing'&&player){if(recorder){savePromise=finishRecording('stopped');}else if(recordingType())startRecording();refresh();return;}
  const box=$('#showRecord');box.checked=!box.checked;box.onchange();refresh();
 }
 // Finished, stopped or interrupted: whatever was performed is saved.
 async function finishRecording(reason){
  const active=recorder,sink=recordingSink;if(!active)return;saving=true;recorder=null;recordingSink=null;hooks.onFrame(recordFrame,false);hooks.onAudio(recordAudio,false);
  try{
   const result=await active.stop();await sink.queue;
   if(sink.failed)throw Error(sink.failed);
   if(!result?.bytes){if(sink.id)await api.recordingClose({id:sink.id,keep:false});setStatus('Nothing was recorded.',true);return;}
   const before=$('#showStatus').textContent;setStatus(`${before} Saving the recording (${result.seconds} s)…`.trim());
   const saved=await api.recordingClose({id:sink.id,keep:true});
   if(!saved.ok)throw Error(saved.error);
   savedRecording=saved.path;pushChat('director',`Recording saved: ${saved.path.split('/').pop()}`);
   setStatus(`${$('#showStatus').textContent.replace(/\s*Saving the recording.*$/,'').trim()} Recording saved to Movies › GPT-Live Avatar Shows (${result.seconds} s, ${(saved.bytes/1048576).toFixed(1)} MB).`.trim()); // keep the curtain-call message
  }catch(e){if(sink?.id)void api.recordingClose({id:sink.id,keep:false});setStatus('The recording could not be saved: '+e.message,true);}
  finally{saving=false;refresh();}
 }
 // ------------------------------------------------------------ Prompter
 function waitForHuman(cue,timeoutMs){
  return new Promise(resolve=>{
   const role=script.userRole?.role||'Your line';$('#prompterRole').textContent=`${role} — your line`;$('#prompterText').textContent=cue.text;$('#prompterHeard').textContent='';$('#prompterFill').style.width='100%';
   $('#prompterHint').textContent=director.running&&!director.muted?'Read the line aloud; the Director’s microphone is listening. Say “I’ll pass” or click it and the standby steps in.':'The Director’s microphone is off: read the line, then click “I said it”, or type it in the Director box (unfold the panel) and send. “I’ll pass” lets the standby speak it.';
   $('#prompter').hidden=false;hooks.setIgnoreMouse(false);
   const started=performance.now(),limit=timeoutMs>0?timeoutMs:0;let ceiling=limit?started+Math.max(limit*2.4,60000):0,deadline=limit?started+limit:0,finals=[],partial='',settleTimer=0,best=0;
   const tick=setInterval(()=>{const now=performance.now();
    if(player?.paused){if(deadline){deadline+=200;ceiling+=200;}return;} // a paused show does not run your clock down
    if(deadline){const left=Math.max(0,deadline-now);$('#prompterFill').style.width=Math.min(100,left/limit*100)+'%';$('#prompterCount').textContent=Math.ceil(left/1000)+' s';if(left<=0)finish({result:'pass',auto:true});}else $('#prompterCount').textContent='';},200);
   const extend=ms=>{if(deadline)deadline=Math.min(ceiling,Math.max(deadline,performance.now()+ms));};
   const finish=value=>{clearInterval(tick);if(humanWait?.finish!==finish)return;clearTimeout(settleTimer);humanWait=null;resolve(value);};
   humanWait={cue,finish,heard:(spoken,final)=>{
    const cueKind=userCue(spoken,'performing');
    if(cueKind==='pass'||cueKind==='takeover'){finish({result:cueKind});return;}
    if(cueKind==='stop'){finish({result:'stop'});return;}
    if(cueKind==='continue')return;
    if(final){partial='';const said=lineCoverage(spoken,cue.text),words=spoken.trim().split(/\s+/).length;
     // Off-script speech is a note for the cast, not the line; the prompter stays up.
     if(said<.3&&(words>=4||/[\u3400-\u9fff]{6,}/.test(spoken))&&!finals.length){$('#prompterHeard').textContent='Noted for the cast: '+spoken;notes=[...notes,spoken.slice(0,200)].slice(-4);voice.dropWarm?.();extend(15000);
      if(director.running){clearTimeout(resumeTimer);director.openFloor(`The human, who is waiting to read their own line, called out a note for the cast: ${JSON.stringify(spoken.slice(0,200))}. In one short sentence acknowledge it, then remind them their line is up. Do not read their line.`);resumeTimer=setTimeout(()=>resumeShow('timeout'),12000);}
      return;}
     finals.push(spoken);}else{partial=spoken;clearTimeout(settleTimer);} // still talking: the line is not over
    const text=[...finals,partial].filter(Boolean).join(' ');$('#prompterHeard').textContent='Heard: '+text;
    const coverage=lineCoverage(text,cue.text);if(coverage>best){best=coverage;extend(12000);} // progress earns time; chatter does not
    if(final){clearTimeout(settleTimer);settleTimer=setTimeout(()=>finish({result:'spoken',text:finals.join(' ')}),coverage>=.6?900:2600);}
   }};
  });
 }
 function heard(text,final){humanWait?.heard(text,final);}
 function finishHuman(value){const wait=humanWait;if(!wait)return;wait.finish(value);}
 // Hiding the prompter ends any pending wait, so a stopped show never keeps a clock running or swallows the next thing typed.
 function hidePrompter(){humanWait?.finish({result:'stop'});$('#prompter').hidden=true;$('#prompterCount').textContent='';}
 // ------------------------------------------------------------ Wiring
 function fillVoices(){const select=$('#showVoice');if(select.options.length)return;const voices=catalogue()?.voices||[];const used=new Set(Object.values(catalogue()?.groupVoices||{}));const preferred=voices.find(v=>v==='stone'&&!used.has(v))||voices.find(v=>!used.has(v))||voices[0];for(const v of voices){const o=document.createElement('option');o.value=v;o.textContent=v[0].toUpperCase()+v.slice(1);o.selected=v===preferred;select.append(o);}}
 $('#showMic').onclick=()=>void toggleMic();$('#showHangup').onclick=()=>hangUp();$('#showSend').onclick=send;$('#showText').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();send();}};
 $('#showPrepare').onclick=()=>void prepare();$('#showStart').onclick=()=>void start();$('#showStop').onclick=()=>hooks.rest('The show was stopped.');
 $('#showPause').onclick=()=>{if(player?.paused)resumeShow('user');else holdShow();};$('#headPause').onclick=()=>$('#showPause').onclick();$('#headStop').onclick=()=>hooks.rest('The show was stopped.');
 $('#showReveal').onclick=()=>{if(savedRecording)void api.reveal({path:savedRecording});};
 try{$('#showRecord').checked=localStorage.getItem('gla-show-record')==='1';}catch{}
 $('#showRecord').onchange=()=>{try{localStorage.setItem('gla-show-record',$('#showRecord').checked?'1':'0');}catch{}refresh();};
 $('#headRecord').onclick=toggleRecording;
 $('#prompterDone').onclick=()=>finishHuman({result:'spoken',text:''});$('#prompterPass').onclick=()=>finishHuman({result:'pass'});$('#prompterTakeover').onclick=()=>finishHuman({result:'takeover'});
 $('#showVoice').onchange=()=>{if(director.running)setStatus('The new Director voice applies the next time you start the Director.');};
 void api.pipeline().then(r=>{pipeline=r.ok?r.status:{available:false,problems:[r.error]};});
 return {
  get phase(){return phase;},get script(){return script;},get chat(){return chat;},get active(){return phase==='performing';},director,
  ready(){fillVoices();refresh();},
  get busy(){return busy;},get notes(){return notes;},get castNotes(){return castNotes;},steer,steerVoice,cancelSteer,get steering(){return steerLive?{slug:steerLive.slug,state:steerLive.state,session:steerLive.voice}:null;},get held(){return Boolean(player?.paused);},get connecting(){return connecting;},get recording(){return Boolean(recorder?.active);},get saving(){return saving;},get savedRecording(){return savedRecording;},settle:()=>savePromise,hangUp,holdShow,resumeShow,
  refresh,halt,
  expression(actor,now){if(phase!=='performing')return {};const mood=actor.avatar.motion?.expression(now)||{};return actor.showMood?{...mood,...Object.fromEntries(Object.entries(actor.showMood).map(([k,v])=>[k,Math.max(v,mood[k]||0)]))}:mood;},
  leave(){halt();director.stop();hooks.bill?.(null);},
  dispose(){halt();director.stop();},
 };
}
