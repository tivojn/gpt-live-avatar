import {MusicCommandRouter,musicCommand} from '/music-command.js';
import '/sing.js';
import '/avatar3d.js';
import {closeupView} from '/avatar-closeup.js';
import {zoomScale,normalizeView,pixelView,zoomCrop,panCrop} from '/avatar-zoom.js';
let selectedActor='',closeupPanelState=null;
import {installAgentUI} from '/agent-client.js';
import {shortenHomePaths} from '/path-display.js';
import { frameDue, renderPixelBudget, textureBudget } from '/avatar-render-budget.js';
import * as THREE from '/vendor/three/three.module.js';
import {GroupVoice} from '/group-voice.js';
import {AvatarHitMask} from '/avatar-hit-mask.js';
import {groupAction} from '/group-actions.js';
import {needsAgent} from '/group-agent-request.js';
import {installShow} from '/show.js';
import {LiveGroup} from '/group-live.js';
import {ConversationSounds} from '/conversation-sounds.js';
import {installGroupPanel} from '/group-panel.js';
import {GroupMicrophone} from '/group-input.js';
const $=s=>document.querySelector(s),api=window.gla.group,voiceAPI={...api,cancel:()=>api.cancel({scope:'voice'}),cancelRequest:id=>window.gla.agent.cancel(id)},voice=new GroupVoice(voiceAPI),actors=new Map();
let catalogue,loadGeneration=0,runGeneration=0,running=false,loading=false,speaker='',listener='',history=[],drag=null,ignore=false,lastFrame=0;
let waitingHuman=false,humanResolve=null,wantsTurn=false,currentTurn=0,totalTurns=0,human={enabled:false,name:'You'};
const conversationSounds=new ConversationSounds(()=>catalogue?.conversationSounds!==false);
const microphone=new GroupMicrophone(voiceAPI,{
 onState:(state,seconds)=>{const busy=state!=='idle';$('#mic').textContent=state==='recording'?'Finish recording':state==='requesting'?'Opening microphone…':state==='transcribing'?'Transcribing…':'Speak my reply';$('#mic').setAttribute('aria-pressed',String(state==='recording'));$('#mic').disabled=!waitingHuman||['requesting','transcribing'].includes(state);$('#humanText').disabled=busy;$('#send').disabled=!waitingHuman||busy||!$('#humanText').value.trim();$('#micStatus').textContent=state==='recording'?`Microphone on · ${seconds} / 60 seconds`:state==='requesting'?'Waiting for microphone access…':state==='transcribing'?'Microphone off · transcribing your recording…':'Microphone off. Review your text, then send.';},
 onText:text=>{if(!waitingHuman)return;$('#humanText').value=[$('#humanText').value.trim(),text].filter(Boolean).join(' ').slice(0,1200);$('#humanText').focus();},
 onError:message=>{$('#micStatus').textContent=message;}
});
// During a show a character's own mic and composer are private steering notes, never a conversation:
// a note by voice goes through gpt-live-1 in her own voice (show.js steerVoice); the show holds meanwhile.
async function steerActor(actor){openComposer(actor.info.name,false);await show?.steerVoice?.(actor.slug);refreshBubble(actor);}
const liveGroup=new LiveGroup(voiceAPI,{
 musicRequest:(text,meta)=>musicRouter.run(text,meta),
 connected:()=>conversationSounds.transition('connected'),
 warning:message=>status(message,true),status:message=>status(message),error:message=>{stop();status(message,true);},
 floor:floor=>{speaker=floor.speaker;listener=floor.listener;for(const a of actors.values()){a.el.classList.toggle('speaking',a.slug===speaker);if(a.slug!==speaker)setBubble(a,'');}},
 text:line=>{const actor=actors.get(line.speaker);if(actor)setBubble(actor,line.text);},
 line:line=>{const isMusic=line.speaker==='_human'&&musicCommand(line.text,{characters:[...actors.values()].map(a=>({slug:a.slug,name:a.info.name})),character:liveGroup.directed||liveGroup.active||speaker});if(line.speaker==='_human'&&!line.viaAgent&&!isMusic&&!(catalogue?.agentEnabled&&needsAgent(line.text)))void actOnSpeech(line.text);history.push(line);appendLine(actors.get(line.speaker)||{info:{name:human.name+' (you)'}},line.text);},
 microphone:state=>{$('#liveMic').textContent=!state.active?'Microphone off':state.muted?'Unmute microphone':'Mute microphone';$('#liveMic').disabled=!state.active;$('#liveMic').setAttribute('aria-pressed',String(state.active&&!state.muted));},
});
function liveMode(){return $('#liveMode').checked;}
voice.onWarning=message=>status(message,true);
voice.onConnected=()=>conversationSounds.transition('connected');
const status=(message,error=false)=>{$('#status').textContent=message;$('#status').classList.toggle('error',error);};
let helpCharacter='',actorVoiceStarting=false,show=null;
const showMode=()=>$('#format').value==='show';
const namedActor=name=>[...actors.values()].find(a=>[a.slug,a.info.name].some(value=>value.toLowerCase()===String(name).toLowerCase()));
const musicRouter = new MusicCommandRouter({
  characters:()=>[...actors.values()].map(a=>({slug:a.slug,name:a.info.name})),
  character:()=>helpCharacter || liveGroup.directed || liveGroup.active || selectedActor,
  execute:(action,args,cancelled)=>{
    if(typeof window.gla_sing_command!=='function')throw Error('Music performance is unavailable in this build.');
    return window.gla_sing_command(action,args,cancelled);
  }
});

function recordAskLine(line){
 if(liveGroup.running)liveGroup.recordLine({...line,viaAgent:true});
 else{history.push(line);appendLine(actors.get(line.speaker)||{info:{name:(human.name||'You')+' (you)'}},line.text);}
}
async function runAgentRequest(request){
 const target=[...actors.values()].find(a=>a.info.name===request.character);
 if(!target)throw Error('That character is no longer in this group.');
 const text=request.history.at(-1)?.text||'',prior=[...history];
 recordAskLine({id:request.id,speaker:'_human',text});
 const result=await api.reply({...request,speaker:target.slug,participants:[...actors.keys()],human:{enabled:true,name:human.name||'You'},topic:$('#topic').value.trim()||'Help with your requests',mode:$('#format').value,history:prior,humanRequest:text});
 if(result.ok)recordAskLine({id:request.id,speaker:target.slug,text:result.text});
 return result;
}
window.gla_sing_targets=character=>{
 const key=String(character||'').toLowerCase();
 return [...actors.values()].filter(a=>!a.avatar.disposed&&(!key||['all','everyone','everybody'].includes(key)||[a.slug,a.info.name.toLowerCase()].includes(key))).map(a=>({id:a.slug,name:a.info.name,avatar:a.avatar,play:id=>a.avatar.motion.play(id,{loop:false})}));
};
const agentUI=installAgentUI({api:{...window.gla.agent,run:runAgentRequest},onStatus:(_message,update)=>{if(!update)return;const actor=namedActor(update.character);if(!actor)return;actor.activity=update;refreshBubble(actor);},name:()=>actors.get(helpCharacter)?.info.name||'the characters',settings:()=>catalogue,onOpen:openComposer,questionHost:name=>namedActor(name)?.questions,onQuestionChange:(name,open)=>{const actor=namedActor(name);if(actor){actor.questionOpen=open;refreshBubble(actor);}},execute:async(action,args,cancelled)=>{
 if(action==='state')return {ok:true,characters:[...actors.values()].map(a=>({slug:a.slug,name:a.info.name,motions:[...a.avatar.motion.clips.values()].slice(0,180).map(c=>({id:c.id,label:c.label||c.id}))}))};
 if(['dance_along','stop_dancing'].includes(action))return window.gla_sing_command(action,args,cancelled);
 const actor=[...actors.values()].find(a=>[a.slug,a.info.name].some(n=>n.toLowerCase()===String(args.character).toLowerCase()));if(!actor)throw Error('That character is not visible.');
 if(action==='play_motion'){if(!actor.avatar.motion.clips.has(args.motion))throw Error('That motion is not installed.');const result=await actor.avatar.motion.play(args.motion,{loop:false});return {ok:result!==false,motion:args.motion,character:actor.slug};}
 if(action==='move_avatar'){await walkActor(actor,args.destination,cancelled);return {ok:true,character:actor.slug,destination:args.destination,reached:true};}
 throw Error('Unknown avatar action.');
}});

// Stage blocking: the actor walks (in the walking clip) to a named stage
// point. Shared by agent moves and show scripts; interrupted by drags.
const STAGE_POINTS={'upper-left':[0,0],'upper-right':[1,0],'lower-left':[0,1],'lower-right':[1,1],center:[.5,.5],left:[0,.5],right:[1,.5],top:[.5,0],bottom:[.5,1]};
// Prefer a free spot near the requested point so actors stand beside each
// other instead of stacking. An actor already walking reserves its destination,
// so two performers sent to neighbouring marks never converge on one spot.
// The stage is a shallow floor, not the deep studio the lens reports: actors
// keep their size as they move upstage, so depth is only a gentle bias here.
const BODY_WIDTH=.52, BODY_CLEAR=.06, STAGE_DEPTH=.55;
// The nameplate hangs below an actor's feet, so the downstage marks have to
// stop short of the window edge or the audience loses the name off the bottom.
const LABEL_ROOM=38;
const floorFor=actor=>Math.max(70,innerHeight-actor.h-LABEL_ROOM);
function footprint(actor,at){const w=actor.w*BODY_WIDTH;return {left:at.x+(actor.w-w)/2,right:at.x+(actor.w+w)/2,top:at.y,bottom:at.y+actor.h,w};}
function crowding(actor,at,others){
 const me=footprint(actor,at);let worst=0;
 for(const other of others){
  const theirs=footprint(other,other.walk?.to||{x:other.x,y:other.y});
  // Depth cannot excuse a shared column here. A real stage shrinks whoever
  // stands upstage so the audience still reads two people; these actors keep
  // their size, so one behind another fuses into a single confusing silhouette
  // and buries the other's nameplate. Standing back softens the clash, never
  // settles it.
  const dy=Math.abs(at.y-(other.walk?.to?.y??other.y));
  const relief=1-Math.min(1,dy/(Math.min(actor.h,other.h)*STAGE_DEPTH))*.35;
  const gap=Math.max(me.left,theirs.left)-Math.min(me.right,theirs.right);
  const needed=Math.min(me.w,theirs.w)*BODY_CLEAR;
  if(gap<needed)worst=Math.max(worst,(needed-gap)/Math.min(me.w,theirs.w)*relief);
 }
 return worst;
}
function freeSpot(actor,to){
 const others=[...actors.values()].filter(a=>a!==actor);
 // Shoulders almost touching is stagecraft, not a collision: only a real
 // overlap is worth moving for, or an actor crosses the stage over a few px.
 const OK=.05;
 let best=to,score=crowding(actor,to,others);
 if(!others.length||score<=OK)return to;
 const fit=(x,y)=>({x:Math.max(0,Math.min(Math.max(0,innerWidth-actor.w),x)),
  y:Math.max(70,Math.min(floorFor(actor),y))});
 const consider=(x,y)=>{
  const at=fit(x,y),value=crowding(actor,at,others);
  if(value<score){best=at;score=value;}
  return score<=OK;
 };
 // Standing beside whoever holds the mark is what an ensemble actually does,
 // and these actors keep their size upstage, so a shoulder-to-shoulder row
 // reads as a stage while a stack reads as one actor floating behind another.
 const step=actor.w*.28,near=actor.w*1.2,reach=actor.w*2;
 const aside=limit=>{
  for(let k=1;k*step<=limit;k++)for(const sign of [1,-1])if(consider(to.x+sign*k*step,to.y))return true;
  return false;
 };
 if(aside(near))return best;
 // A full row still has depth: take the mark upstage rather than inside someone.
 for(const dy of [.18,-.18,.34,-.34])if(consider(to.x,to.y+dy*actor.h))return best;
 if(aside(reach))return best;
 return best;
}
// Walking is a gait, not a slide. The actor turns to face its destination and
// then covers exactly the ground its own walk cycle covers, so the feet stay
// planted instead of skating. Every show reuses this.
const GAIT_CLIPS=['walk','walking-woman','casual-walk','stage-walk'];
function gaitClip(actor){
 const clips=actor.avatar.motion?.clips;
 for(const id of GAIT_CLIPS)if(clips?.get(id))return id;
 return actor.avatar.options.walkingClip();
}
function gaitScale(actor){
 const a=actor.avatar,view=actor.zoom||actor.closeup||a.currentView||{x:0,y:0,w:a.width,h:a.height};
 const projection=a.studioProjection(),width=view.w>0?view.w:a.width;
 return {perUnit:projection.pixelsPerUnit*(actor.w/width),groundDepth:projection.groundDepth||.5};
}
async function walkActor(actor,destination,cancelled=()=>false){
 const p=STAGE_POINTS[destination];if(!p)throw Error('Unknown destination.');
 const to=freeSpot(actor,{x:(innerWidth-actor.w)*p[0],y:70+(floorFor(actor)-70)*p[1]});
 if(Math.hypot(to.x-actor.x,to.y-actor.y)<12)return;
 const motion=actor.avatar.motion,clip=gaitClip(actor);
 await motion.prepare(clip);
 const stride=motion.clips.get(clip)?.ready?.forwardSpeed||0;
 const {perUnit}=gaitScale(actor);
 actor.walk={to,yaw:actor.yaw};
 await motion.play(clip,{loop:true});
 const deadline=performance.now()+20000;let last=performance.now();
 try{
  while(true){
   if(cancelled()||!actors.has(actor.slug)||drag?.actor===actor)throw Error('Movement interrupted.');
   const now=await new Promise(requestAnimationFrame);
   if(now>deadline)break;
   const dt=Math.min(.1,Math.max(0,(now-last)/1000));last=now;
   const vx=to.x-actor.x,vy=to.y-actor.y,remaining=Math.hypot(vx,vy);
   if(remaining<2)break;
   // Face the way the feet are going before covering any ground.
   const desired=Math.atan2(-vx,vy/STAGE_DEPTH);
   const turn=angle=>Math.atan2(Math.sin(angle-actor.walk.yaw),Math.cos(angle-actor.walk.yaw));
   actor.walk.yaw+=Math.max(-dt*2.8,Math.min(dt*2.8,turn(desired)));
   actor.walk.yaw=Math.atan2(Math.sin(actor.walk.yaw),Math.cos(actor.walk.yaw));
   const facing=actor.walk.yaw;
   // Strides into the distance foreshorten; strides across the stage do not.
   const natural=stride>0
    ?perUnit*Math.hypot(Math.sin(facing),STAGE_DEPTH*Math.cos(facing))*stride
    :Math.max(90,actor.w*.55);
   const rate=Math.max(1,Math.min(1.45,remaining/Math.max(natural*5.5,1)));
   const moving=Math.abs(turn(desired))<.08;
   motion.setPlaybackRate(moving?rate:.55,now);
   if(moving){
    const travel=Math.min(remaining,natural*rate*dt);
    actor.x+=vx/remaining*travel;actor.y+=vy/remaining*travel;position(actor);
   }
  }
  actor.x=to.x;actor.y=to.y;position(actor);
 }finally{motion.setPlaybackRate(1,performance.now());motion.stop();actor.walk=null;}
}
const panel=installGroupPanel($('.panel'),{onInteraction:()=>{api.setIgnoreMouse(false);ignore=false;}});
const selected=()=>[...document.querySelectorAll('.choice input:checked')].map(i=>i.value);
function compact(value){$('.panel').classList.toggle('compact',value);$('#compact').textContent=value?'Show controls':'Hide controls';$('#compact').setAttribute('aria-expanded',String(!value));}
function controls(){const available=actors.size>=2&&!loading;$('#start').disabled=!available||running||!catalogue?.hasKey;$('#stop').disabled=!running;for(const id of ['topic','rounds','format','join','humanName','liveMode'])$('#'+id).disabled=running;for(const el of document.querySelectorAll('.choice input,.choice select'))el.disabled=running;$('#liveControls').hidden=!running||!liveMode();$('#raise').hidden=liveMode()||!running||!human.enabled;$('#raise').disabled=waitingHuman||wantsTurn||currentTurn>=totalTurns-1;$('#raise').textContent=wantsTurn?'You’re next':'I’d like a turn';$('#humanTurn').hidden=!waitingHuman;$('#send').disabled=!waitingHuman||microphone.state!=='idle'||!$('#humanText').value.trim();}
function position(actor){
 const scale=Math.min(1,innerWidth/actor.w,(innerHeight-90)/actor.h);actor.w*=scale;actor.h*=scale;
 if(actor.h<230){const grow=230/actor.h;actor.h*=grow;actor.w*=grow;}
 actor.x=Math.max(0,Math.min(innerWidth-actor.w,actor.x));actor.y=Math.max(70,Math.min(innerHeight-actor.h,actor.y));
 Object.assign(actor.el.style,{left:actor.x+'px',top:actor.y+'px',width:actor.w+'px',height:actor.h+'px'});
 // Preserve projection aspect and Retina detail. CSS stretching alone would
 // widen faces when arranging a cast with differently sized viewports.
 const budget=renderPixelBudget(catalogue?.quality,actors.size,catalogue?.hardware?.memoryGB);
 const h=Math.round(Math.min(1400,actor.h*devicePixelRatio,Math.sqrt(budget*actor.h/actor.w))),w=Math.round(h*actor.w/actor.h);
 if(actor.renderW!==w||actor.renderH!==h){actor.avatar.resize(w,h);actor.renderW=w;actor.renderH=h;}
}
function recoverActor(actor){actor.zoom=null;actor.closeup=null;actor.el.style.zIndex='';const cell=innerWidth/actors.size,i=[...actors.keys()].indexOf(actor.slug),h=Math.min(innerHeight*.68,740),w=Math.min(cell+90,h*.9);Object.assign(actor,{w,h,x:cell*(i+.5)-w/2,y:innerHeight-h-24});position(actor);}
function closeupActor(actor){
 if(closeupPanelState===null)closeupPanelState=$('.panel').classList.contains('minimized');
 panel.setMinimized(true);
 for(const other of actors.values())if(other.closeup&&other!==actor)recoverActor(other);
 actor.avatar.motion?.stop();actor.userOrbit={yaw:0,pitch:0};actor.yaw=0;actor.avatar.setOrbit(actor.userOrbit);
 Object.assign(actor,{w:Math.min(innerWidth,innerHeight*.95),h:innerHeight-110,x:Math.max(0,(innerWidth-Math.min(innerWidth,innerHeight*.95))/2),y:80});
 position(actor);actor.zoom=null;actor.closeup=closeupView(actor.avatar);actor.el.style.zIndex='3';actor.lastFrame=0;
}
function arrange(){for(const actor of actors.values())recoverActor(actor);if(closeupPanelState!==null){panel.setMinimized(closeupPanelState);closeupPanelState=null;}}
// During a show the tag under an actor bills the part being played, not the
// avatar's own name; the avatar name stays available as the tooltip.
function billActor(actor,role){
 // A programme lists "Hamlet, Prince of Denmark"; the nameplate under an actor
 // on stage only has room for the name the audience actually calls them.
 const part=String(role||'').trim(),short=part.split(/\s*[,(\u2013\u2014]\s*|\s+-\s+/)[0].trim()||part;
 if(!actor.label)return;
 actor.label.textContent=short.slice(0,28)||actor.info.name;
 actor.label.title=part?`${part} · ${actor.info.name}`:'';
 actor.el.classList.toggle('billed',Boolean(part));
}
function billCast(roles){
 for(const actor of actors.values()){
  billActor(actor,roles?.get(actor.slug));
  actor.avatar.options?.setStageMode?.(Boolean(roles));
 }
}
function setBubble(actor,text){actor.message=text;if(text&&actor.activity&&!actor.activity.active)actor.activity=null;refreshBubble(actor);}
function openComposer(name,focus=true){
 const actor=namedActor(name);if(!actor)return;
 helpCharacter=actor.slug;selectedActor=actor.slug;actor.composerOpen=true;
 refreshBubble(actor);api.setIgnoreMouse(false);ignore=false;
 if(focus&&!actor.questionOpen)actor.askInput?.focus({preventScroll:true});
}
function updateComposer(actor){
 if(!actor.composer)return;
 const busy=agentUI.isBusy(actor.info.name),listening=Boolean(show?.steering&&show.steering.slug===actor.slug&&show.steering.state==='listening')||liveGroup.running&&Boolean(liveGroup.microphone)&&!liveGroup.muted&&(liveGroup.directed||liveGroup.active)===actor.slug;
 actor.composer.hidden=false; // Input belongs to every visible speech/task bubble.
 actor.askClose.hidden=!actor.composerOpen;
 const localMusic=Boolean(musicRouter.parse(actor.askInput.value,{character:actor.slug}));
 const showing=Boolean(show?.active),liveNote=show?.steering,steeringLive=Boolean(liveNote&&liveNote.slug===actor.slug),recordingNote=steeringLive&&liveNote.state==='listening';
 actor.askSend.disabled=recordingNote?false:(!localMusic&&busy)||!actor.askInput.value.trim()||(!catalogue?.agentEnabled&&!localMusic);
 // While a note records, Send becomes Done and the mic becomes a stop button: two obvious ways to finish.
 if(!actor.askSendIcon)actor.askSendIcon=actor.askSend.innerHTML;
 if(recordingNote){if(!actor.askSend.classList.contains('done')){actor.askSend.classList.add('done');actor.askSend.textContent='Done';}actor.askSend.title='Finished speaking: let her acknowledge the note';actor.askMic.classList.add('recording');actor.askInput.placeholder='Listening live…';}
 else{if(actor.askSend.classList.contains('done')){actor.askSend.classList.remove('done');actor.askSend.innerHTML=actor.askSendIcon;}actor.askSend.title='Send';actor.askMic.classList.remove('recording');actor.askInput.placeholder=showing?'Type a private note for '+actor.info.name+'…':'Ask me to do something…';}
 actor.askStop.hidden=!busy;actor.askMic.disabled=actorVoiceStarting||loading||!catalogue?.hasKey;
 actor.askMic.classList.toggle('listening',listening);actor.askMic.setAttribute('aria-pressed',String(listening));
 actor.askMic.title=showing?(listening?'Finish the note':'Give '+actor.info.name+' a private note'):listening?'Mute microphone':'Talk to '+actor.info.name;actor.askMic.setAttribute('aria-label',actor.askMic.title);
 actor.askTip.textContent=showing?(steeringLive?(liveNote.state==='connecting'?'Connecting to '+actor.info.name+'…':liveNote.state==='listening'?actor.info.name+' is listening live · speak your note, then press Done or the stop button.':actor.info.name+' is taking your note…'):'Steer '+actor.info.name+': press the mic or type a private note. The show holds while you give it, then carries on with it.'):actorVoiceStarting?'Connecting live talk…':listening?'Listening · speak to '+actor.info.name:!catalogue?.hasKey?'Add a voice API key in Settings to talk.':'Try “Dance along” or “Do a backflip” · mic or double-click my head to talk.';
 actor.el.classList.toggle('composing',Boolean(actor.composerOpen||actor.questionOpen));
}
function createComposer(actor){
 const text=document.createElement('div');text.className='speech-text';text.setAttribute('aria-live','polite');
 const composer=document.createElement('div');composer.className='actor-composer';composer.hidden=true;
 const tip=document.createElement('p');tip.className='actor-ask-tip';
 const form=document.createElement('form');form.className='actor-ask-form';form.setAttribute('aria-label','Ask '+actor.info.name);
 const input=document.createElement('input');input.type='text';input.className='actor-ask-input';input.maxLength=6000;input.autocomplete='off';input.placeholder='Ask me to do something…';input.setAttribute('aria-label','Request for '+actor.info.name);
 const button=(className,label,content)=>{const b=document.createElement('button');b.type='button';b.className=className;b.title=label;b.setAttribute('aria-label',label);b.innerHTML=content;return b;};
 const mic=button('actor-ask-mic','Talk to '+actor.info.name,'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M6 11v1a6 6 0 0 0 12 0v-1M12 18v3m-3 0h6"/></svg>');
 const send=button('actor-ask-send','Send to '+actor.info.name,'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6"/></svg>');send.type='submit';
 const stopTask=button('actor-ask-stop','Stop '+actor.info.name+'’s task','<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>');stopTask.hidden=true;
 const close=button('actor-ask-close','Close request input','<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg>');
 form.append(mic,input,send,stopTask,close);composer.append(tip,form);
 const questions=document.createElement('div');questions.className='actor-questions';actor.bubble.append(text,composer,questions);
 Object.assign(actor,{bubbleText:text,composer,askInput:input,askSend:send,askStop:stopTask,askMic:mic,askTip:tip,askClose:close,questions,composerOpen:false,questionOpen:false});
 form.onsubmit=async event=>{event.preventDefault();if(show?.steering?.slug===actor.slug){await show.steerVoice(actor.slug);refreshBubble(actor);return;}const request=input.value.trim();if(!request)return;
if(musicRouter.parse(request,{character:actor.slug})){
 input.value='';
 recordAskLine({id:'typed-music-'+crypto.randomUUID(),speaker:'_human',text:request,viaMusic:true});
 const result=await musicRouter.run(request,{id:'bubble-music-'+crypto.randomUUID(),character:actor.slug,cancelled:()=>actors.get(actor.slug)!==actor});
 if(!result.cancelled&&actors.get(actor.slug)===actor){
  input.blur();actor.composerOpen=false;setBubble(actor,result.text);
  recordAskLine({id:'music-result-'+crypto.randomUUID(),speaker:actor.slug,text:result.text,viaMusic:true});
 }
 refreshBubble(actor);return;
}
if(show?.active){input.value='';show.steer(actor.slug,request);input.blur();actor.composerOpen=false;refreshBubble(actor);show.resumeShow('note');return;}
if(agentUI.isBusy(actor.info.name))return;input.value='';const task=agentUI.run(request,actor.info.name);refreshBubble(actor);await task;if(actors.get(actor.slug)===actor)refreshBubble(actor);};
 input.onfocus=()=>{actor.composerOpen=true;if(show?.active)show.holdShow('note');refreshBubble(actor);};
 // Leaving the field with nothing typed (a click on the stage) is not a note: the show carries on.
 input.onblur=()=>{setTimeout(()=>{if(!actor.composerOpen||document.activeElement===input||!show?.active||show.steering||input.value.trim())return;actor.composerOpen=false;refreshBubble(actor);syncMouse();show.resumeShow('note');},300);};
 input.oninput=()=>updateComposer(actor);
 mic.onclick=()=>void startActorVoice(actor,true);
 stopTask.onclick=()=>{agentUI.stop(actor.info.name);refreshBubble(actor);};
 // Closing the bubble drops a voice note still being given; otherwise the held show simply continues.
 close.onclick=()=>{actor.composerOpen=false;actor.askInput.blur();refreshBubble(actor);syncMouse();if(show?.steering?.slug===actor.slug)show.cancelSteer(actor.slug);else if(show?.active)show.resumeShow('note');};
 actor.bubble.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();if(!actor.questionOpen)close.onclick();}});
 actor.bubble.addEventListener('pointerdown',()=>{api.setIgnoreMouse(false);ignore=false;});
 actor.avatar.canvas.title='Double-click my head to talk · right-click to type a request';
}
async function startActorVoice(actor,toggle=false){
 if(actors.get(actor.slug)!==actor||loading)return;
 if(show?.active)return steerActor(actor); // the show goes on; this is a note to her
 openComposer(actor.info.name,false);
 if(!catalogue.hasKey){status('Add a voice API key in Settings to start a conversation.',true);return;}
 if(actorVoiceStarting)return;
 if(liveGroup.running&&liveGroup.microphone){
  if(toggle&&!liveGroup.muted&&(liveGroup.directed||liveGroup.active)===actor.slug){liveGroup.setMuted(true);for(const a of actors.values())refreshBubble(a);return;}
  liveGroup.directed=actor.slug;if(liveGroup.active!==actor.slug&&liveGroup.peers.has(actor.slug))liveGroup.open(actor.slug,false);
  liveGroup.setMuted(false);for(const a of actors.values())refreshBubble(a);return;
 }
 actorVoiceStarting=true;for(const a of actors.values())refreshBubble(a);
 try{
  if(running)stop('Switching to live talk…',true);$('#liveMode').checked=true;$('#liveMode').onchange();$('#join').checked=true;$('#nameLabel').hidden=false;
  if(!$('#topic').value.trim())$('#topic').value='Have a conversation and help with my requests.';
  await startLive(actor.slug);
  if(liveGroup.running&&actors.get(actor.slug)===actor){liveGroup.directed=actor.slug;if(liveGroup.active!==actor.slug&&liveGroup.peers.has(actor.slug))liveGroup.open(actor.slug,false);liveGroup.setMuted(false);}
 }catch(error){status(error.message,true);}
 finally{actorVoiceStarting=false;for(const a of actors.values())refreshBubble(a);}
}
function headAt(actor,event){
 const a=actor.avatar,head=a.bones?.head;
 if(!head||!a.headReferencePoint||!a.headRadius)return false;
 const center=a.headReferencePoint.clone().applyMatrix4(head.matrixWorld),r=a.headRadius*1.4;
 const points=[];for(const x of [-r,r])for(const y of [-r,r]){const p=center.clone().add(new THREE.Vector3(x,y,0)).project(a.camera);if(p.z<-1||p.z>1)return false;points.push({x:actor.x+(p.x+1)*actor.w/2,y:actor.y+(1-p.y)*actor.h/2});}
 return event.clientX>=Math.min(...points.map(p=>p.x))&&event.clientX<=Math.max(...points.map(p=>p.x))&&event.clientY>=Math.min(...points.map(p=>p.y))&&event.clientY<=Math.max(...points.map(p=>p.y));
}
function refreshBubble(actor){
 const performing=Boolean(actor.avatar.motion?.active||window.gla_sing_sample?.(actor.slug));
 const beganPerforming=performing&&!actor.wasPerforming;
 actor.wasPerforming=performing; // set before blur or focus can refresh again
 // Guarded with typeof: test harnesses evaluate this function on its own.
 if(beganPerforming&&!actor.questionOpen&&!(typeof show!=='undefined'&&show?.active)){actor.composerOpen=false;if(actor.bubble.contains(document.activeElement))document.activeElement.blur();}
 const activity=actor.activity&&performance.now()<actor.activity.until?actor.activity:null;
 const text=shortenHomePaths(activity?[activity.label,activity.detail].filter(Boolean).join('\n'):actor.message||(actor.bubbleMode==='always'?(actor.slug===speaker?'Speaking…':running?'Listening':'Ready'):''),catalogue?.userHome);
 actor.bubble.classList.toggle('task-update',Boolean(activity));actor.bubble.setAttribute('aria-label',activity?actor.info.name+' task progress':actor.info.name+' speech');
 updateComposer(actor);
 // Explicit input and questions must be visible before focus can enter them.
 // While a motion plays the bubble steps aside and returns when it ends. The one
 // exception is a show line: it is scripted and almost always carries a
 // gesture, so its caption stays up for the whole line.
 const showing=typeof show!=='undefined'&&Boolean(show?.active);
 actor.bubble.hidden=!(actor.composerOpen||actor.questionOpen||((!performing||showing)&&actor.bubbleMode!=='off'&&Boolean(text||actor.slug===speaker)));
 if(actor.bubbleText.textContent!==text)actor.bubbleText.textContent=text;actor.bubbleText.hidden=!text;
 actor.bubble.classList.toggle('wave-only',false);
 placeBubble(actor);
}
// The bubble sits above her; when she stands too close to the top of the
// screen for that, it moves beside her head instead of covering her face.
function placeBubble(actor){
 const width=actor.bubble.offsetWidth||270,height=actor.bubble.offsetHeight||0;
 const head=headRect(actor),roomAbove=(head?head.y-head.r:actor.y)-height-8>=0;
 let left,bottom;
 if(roomAbove||!head){left=Math.max(width/2+8-actor.x,Math.min(actor.w/2,innerWidth-width/2-8-actor.x));bottom=Math.min(actor.h,actor.y+actor.h-height-8);}
 else{
  const gap=head.r*1.25,right=head.x+gap+width+8<=innerWidth,cx=right?head.x+gap+width/2:head.x-gap-width/2;
  left=Math.max(width/2+8,Math.min(innerWidth-width/2-8,cx))-actor.x;
  const top=Math.max(8,Math.min(innerHeight-height-8,head.y-height/2));bottom=actor.y+actor.h-top-height;
 }
 actor.bubble.classList.toggle('aside',!roomAbove&&Boolean(head));
 actor.bubble.style.left=left+'px';actor.bubble.style.bottom=bottom+'px';
}
// Her head on screen: centre and radius in window pixels, from the rig itself.
function headRect(actor){
 const a=actor.avatar,head=a?.bones?.head;
 if(!head||!a.headReferencePoint||!a.headRadius||!a.camera)return null;
 const centre=a.headReferencePoint.clone().applyMatrix4(head.matrixWorld),edge=centre.clone().add(new THREE.Vector3(a.headRadius,0,0));
 const c=centre.project(a.camera),e=edge.project(a.camera);if(c.z<-1||c.z>1)return null;
 const x=actor.x+(c.x+1)*actor.w/2,y=actor.y+(1-c.y)*actor.h/2,r=Math.max(12,Math.abs(e.x-c.x)*actor.w/2*1.4);
 return {x,y,r};
}
function stop(message='Stopped. Everyone is resting.',preserveTasks=false){conversationSounds.transition('idle');runGeneration++;running=false;speaker='';listener='';show?.halt();waitingHuman=false;wantsTurn=false;const resolve=humanResolve;humanResolve=null;resolve?.(null);microphone.cancel();voice.stopAll();liveGroup.stop();if(!preserveTasks)void api.cancel();for(const a of actors.values()){if(!preserveTasks)a.activity=null;setBubble(a,'');a.el.classList.remove('speaking');}controls();status(message);}
async function loadCast(){
 const generation=++loadGeneration;stop('Loading characters…');loading=true;controls();show?.refresh();const slugs=selected().slice(0,5);
 for(const [slug,actor] of actors)if(!slugs.includes(slug)){agentUI.stop(actor.info.name);actor.avatar.dispose();actor.el.remove();actors.delete(slug);}
 try{for(const slug of slugs){if(actors.has(slug))continue;const info=catalogue.avatars.find(x=>x.slug===slug);const avatar=OpenClamAvatar3D.create({width:480,height:700});
  const performance=catalogue.quality==='best'?'quality':catalogue.quality==='friendly'?'eco':'balanced';
  await avatar.load(info.modelURL,{resources:info.residentAvailable,pose:info.pose,yaw:info.yaw,performance,motionLibrary:info.motionsURL,appearanceLibrary:info.appearanceURL,textureLimit:textureBudget(slugs.length,catalogue.hardware?.memoryGB)});
  if(generation!==loadGeneration){avatar.dispose();return;}
  const look=catalogue.looks[slug]??catalogue.defaults[slug]??{};
  // A saved look may carry a weapon grip from a prop chosen elsewhere; with no prop in hand she stands normally.
  const grip=avatar.options.props?.some(p=>p.pose&&p.pose===look.body);
  avatar.options.select({...look,performance,body:look.body&&!grip?look.body:'Ps007.stand',prop:'',hands:'',leftHand:'',rightHand:'',playTransitions:look.playTransitions??'true',followCursor:'false'});
  await avatar.resources?.update(performance,900,true);avatar.root.updateMatrixWorld(true);
  // Wardrobes and props contribute to the frame from the outset, including
  // wide armor. Leave generous space around all sides for natural gestures.
  const bounds=avatar.modelBounds();if(!bounds.isEmpty()){bounds.expandByScalar(.08);avatar.restBounds=bounds.clone();avatar.bounds=bounds.clone();avatar.frame();}
  const el=document.createElement('div');el.className='actor';el.dataset.slug=slug;el.append(avatar.canvas);const label=document.createElement('span');label.className='name';label.textContent=info.name;el.append(label);const bubble=document.createElement('div');bubble.className='speech';bubble.hidden=true;el.append(bubble);$('#stage').append(el);
  const actor={slug,info,avatar,el,label,bubble,hitMask:new AvatarHitMask(),maskAt:0,yaw:0,w:480,h:700,x:0,y:100,blinkOffset:Math.random()*4,breathOffset:Math.random()*5};createComposer(actor);actors.set(slug,actor);
 }
 if(generation!==loadGeneration)return;
 for(const actor of actors.values()){actor.avatar.textureLimit=textureBudget(slugs.length,catalogue.hardware?.memoryGB);actor.avatar.resources.maxTextureSize=actor.avatar.textureLimit;actor.avatar.options.select(actor.avatar.options.selection);}
 arrange();
 await Promise.all([...actors.values()].map(async actor=>{const a=actor.avatar;await a.resources?.update(a.options.selection.performance,actor.h,true);a.render(performance.now(),{reduce:true,fitContent:true,projectedHeight:actor.h,audienceContact:true});await a.resources?.pending;}));
 if(generation!==loadGeneration)return;status(actors.size<2&&!showMode()?'Choose at least two characters.':catalogue.hasKey?(showMode()?'Ready. Tell the Director what show you want, by voice or text.':'Ready for live talk. Join as yourself to speak and interrupt anytime.'):'Add a voice API key in Settings to start a conversation.');
 }catch(e){status('Could not load a character: '+e.message,true);}finally{if(generation===loadGeneration){loading=false;controls();show?.refresh();}}
}
function appendLine(actor,text){const p=document.createElement('p'),b=document.createElement('b');b.textContent=actor.info.name+': ';p.append(b,document.createTextNode(shortenHomePaths(text,catalogue?.userHome)));$('#transcript').append(p);while($('#transcript').children.length>20)$('#transcript').firstChild.remove();$('#transcript').scrollTop=$('#transcript').scrollHeight;}
function humanTurn(){waitingHuman=true;wantsTurn=false;speaker='_human';listener='';$('#humanText').value='';microphone.cancel();controls();status(`Your turn, ${human.name}. They’re waiting for your reply.`);$('#humanText').focus();return new Promise(resolve=>{humanResolve=resolve;});}
function finishHuman(pass=false){if(!waitingHuman||!pass&&microphone.state!=='idle')return;const text=pass?'':$('#humanText').value.trim();if(!pass&&!text)return;microphone.cancel();waitingHuman=false;const resolve=humanResolve;humanResolve=null;controls();resolve?.(text);}
async function start(){
 if(liveMode())return startLive();
 if(running||loading||actors.size<2)return;const topic=$('#topic').value.trim();if(!topic){status('Add a topic first.',true);return;}
 stop('Starting…');compact(true);const generation=runGeneration;running=true;conversationSounds.transition('connecting');human={enabled:$('#join').checked,name:$('#humanName').value.trim().replace(/[\r\n]/g,' ').slice(0,40)||'You'};currentTurn=0;totalTurns=Math.min(10,Math.max(2,Number($('#rounds').value)||6));controls();history=[];$('#transcript').replaceChildren();const cast=[...actors.keys()],turns=totalTurns,mode=$('#format').value;let sinceHuman=0;
 try{for(let turn=0;turn<turns;turn++){
  if(generation!==runGeneration)break;currentTurn=turn;const slug=cast[turn%cast.length],actor=actors.get(slug),humanNext=human.enabled&&turn<turns-1&&(sinceHuman>=1||wantsTurn);speaker=slug;listener=humanNext?'_human':cast[(turn+1)%cast.length];controls();
  status(`${actor.info.name} is thinking · turn ${turn+1} of ${turns}`);
  const result=await api.reply({id:'group-'+Date.now().toString(36)+'-'+turn,speaker:slug,participants:cast,topic,history,human,mode,humanNext,nextSpeaker:listener,finalTurn:turn===turns-1});if(generation!==runGeneration)break;if(!result.ok)throw Error(result.error);
  const voiceName=document.querySelector(`[data-voice="${slug}"]`).value;actor.el.classList.add('speaking');status(`${actor.info.name} is speaking · turn ${turn+1} of ${turns}`);
  const heard=await voice.speak(result.text,voiceName,text=>{setBubble(actor,text);});
  if(generation!==runGeneration)break;const text=heard||result.text;history.push({speaker:slug,text});appendLine(actor,text);actor.el.classList.remove('speaking');setBubble(actor,'');
  sinceHuman++;
  if(human.enabled&&turn<turns-1&&(sinceHuman>=2||wantsTurn)){
   const reply=await humanTurn();if(generation!==runGeneration)break;
   if(reply){history.push({speaker:'_human',text:reply});appendLine({info:{name:human.name+' (you)'}},reply);$('#transcript').lastChild.classList.add('human-line');}
   sinceHuman=0;
  }
 }
 if(generation===runGeneration)stop('Conversation finished. Start again with a new topic whenever you like.');
 }catch(e){if(generation===runGeneration){stop();status(e.message,true);}}
}
async function startLive(focusSlug=''){
 if(running||loading||actors.size<2)return;const topic=$('#topic').value.trim();if(!topic){status('Add a topic first.',true);return;}
 stop('Starting live talk…',true);running=true;conversationSounds.transition('connecting');compact(true);human={enabled:$('#join').checked,name:$('#humanName').value.trim().replace(/[\r\n]/g,' ').slice(0,40)||'You'};if(!focusSlug){history=[];$('#transcript').replaceChildren();}controls();
 await liveGroup.start({initialHistory:[...history],agentEnabled:catalogue.agentEnabled,cast:[...actors.values()].sort((a,b)=>Number(b.slug===focusSlug)-Number(a.slug===focusSlug)).map(a=>({slug:a.slug,name:a.info.name,voice:document.querySelector(`[data-voice="${a.slug}"]`).value})),topic,mode:$('#format').value,human});
}
function animate(now){requestAnimationFrame(animate);if(document.visibilityState!=='visible')return;const due=frameDue(now,lastFrame,30);if(due===null)return;const dt=Math.min(.12,(now-lastFrame)/1000);lastFrame=due;const signal=liveGroup.running?liveGroup.sample():voice.sample();
 for(const actor of actors.values()){
  const a=actor.avatar;if(a.disposed||!a.options)continue;const isSpeaker=actor.slug===speaker;
  const liveTalking=isSpeaker&&Boolean(signal.speaking);
  const musicSignal=window.gla_sing_sample?.(actor.slug);
  const actorSignal=liveTalking?signal:musicSignal||signal;
  const talking=liveTalking||Boolean(musicSignal?.speaking);
  const busy=isSpeaker||a.motion?.active||a.options.transition||drag?.actor===actor||gestureSize?.actor===actor||wheelActor===actor;
  const actorDue=frameDue(now,actor.lastFrame||0,busy?30:12);if(actorDue===null)continue;const actorDt=Math.min(.15,(now-(actor.lastFrame||now))/1000);actor.lastFrame=actorDue;
  const partner=actors.get(isSpeaker?listener:speaker),audience=!running||!partner||(isSpeaker&&Math.sin(now/3200)>.75);
  const direction=audience?0:Math.sign(partner.x+partner.w/2-actor.x-actor.w/2);
  const targetYaw=actor.walk?actor.walk.yaw:(actor.userOrbit?.yaw??(-direction*.35)),pitch=actor.walk?0:(actor.userOrbit?.pitch||0);
  // A walking actor already steers itself; easing again would lag the turn.
  actor.yaw=actor.walk?targetYaw:actor.yaw+(targetYaw-actor.yaw)*(1-Math.exp(-actorDt*2.8));if(Math.abs(actor.yaw-(actor.renderYaw??999))>.001||pitch!==actor.renderPitch){a.setOrbit({yaw:actor.yaw,pitch});actor.renderYaw=actor.yaw;actor.renderPitch=pitch;}
  let lookTarget;if(!audience){lookTarget=a.camera.position.clone();lookTarget.x+=direction*1.5;}
  const cursor=a.options.enabled('followCursor'),gaze=cursor&&hoverPoint?{x:Math.max(-1,Math.min(1,(hoverPoint.x-actor.x-actor.w/2)/(actor.w/2))),y:Math.max(-1,Math.min(1,-(hoverPoint.y-actor.y-actor.h/2)/(actor.h/2)))}:{x:0,y:0};
  a.render(now,{reduce:false,breathe:1,bodyMotion:false,fitContent:true,stableFitContent:true,viseme:talking?actorSignal.viseme:'sil',visemeWeights:talking?actorSignal.visemeWeights:{},lipSyncSource:actorSignal.lipSyncSource,intensity:talking?actorSignal.relative:0,speaking:talking,projectedHeight:actor.h,lipSyncGain:1.35,audienceContact:audience&&!cursor,cameraFocus:true,lookTarget,gaze,expression:show?.expression(actor,now)||{}},actor.zoom?pixelView(actor.zoom,a.width,a.height):actor.closeup);
  refreshBubble(actor);
  // Layer the stage by depth so a downstage actor passes in front of an
  // upstage one rather than clipping through it; the speaker stays clear.
  const depth=Math.max(1,Math.min(30,Math.round(actor.y/20)));
  const z=actor.closeup||actor.composerOpen?'60':isSpeaker?'40':String(depth);
  if(actor.renderZ!==z){actor.el.style.zIndex=z;actor.renderZ=z;}
  if(now-actor.maskAt>80){actor.hitMask.update(a.canvas);actor.maskAt=now;}
 }
 for(const hook of frameHooks)try{hook(now,{actors,speaker,viewport:{w:innerWidth,h:innerHeight}});}catch{}
 syncMouse();
}
const frameHooks=new Set(),audioTaps=new Set();voice.onStream=stream=>{for(const tap of audioTaps)try{tap(stream,voice.output);}catch{}};
let hoverPoint=null;
function actorAt(event){
 if(event.target?.closest?.('.panel,.speech,#prompter'))return null;
 const priority=a=>a.composerOpen||a.questionOpen?30:a.closeup?3:0;
 return [...actors.values()].reverse().sort((a,b)=>priority(b)-priority(a)).find(a=>a.hitMask.contains(event.clientX-a.x,event.clientY-a.y,a.w,a.h))?.el||null;
}
function syncMouse(){
 if(!hoverPoint||panel.dragging||drag||gestureSize||wheelActor||menuOpen)return;
 const top=document.elementFromPoint(hoverPoint.x,hoverPoint.y),interactive=Boolean(top?.closest('.panel,.speech:not([hidden]),#prompter:not([hidden])'))||Boolean(actorAt({clientX:hoverPoint.x,clientY:hoverPoint.y,target:top}));
 if(ignore===interactive){ignore=!interactive;api.setIgnoreMouse(ignore);}
}
async function actOnSpeech(text){
 const request=groupAction(text,[...actors.values()].map(a=>({slug:a.slug,name:a.info.name,clips:a.avatar.motion?.clips})),liveGroup.directed||liveGroup.active||speaker);
 if(!request)return;const actor=actors.get(request.slug),a=actor.avatar;let action=request.action;
 if(action==='stay'){a.motion?.stop();return;}
 if(action==='smile'||action==='laugh'){a.appearance?.face.react(action);return;}
 if(action==='dance')action='clip:'+(a.motion?.clips.has('joyful-sway')?'joyful-sway':'dance');
 if(action==='wave')action='clip:wave';
 if(action.startsWith('clip:')){
  const id=action.slice(5);if(!a.motion?.clips.has(id)){status(actor.info.name+' does not have that motion installed.',true);return;}
  await a.motion.play(id,{loop:false});actor.playedAction=id;return;
 }
 const body={stand:'Ps007.stand',sit:'Ps004.sit',heart:'Ps001.heart'}[action];
 if(body){a.motion?.stop();a.options.select({...a.options.selection,body,hands:'',leftHand:'',rightHand:''});actor.playedAction=action;}
}

addEventListener('pointerdown',event=>{const el=actorAt(event);if(!el||event.button!==0)return;const actor=actors.get(el.dataset.slug);selectedActor=actor.slug;drag={id:event.pointerId,actor,x:event.clientX,y:event.clientY,startX:actor.x,startY:actor.y,view:actor.zoom?{...actor.zoom}:actor.closeup?normalizeView(actor.closeup,actor.avatar.width,actor.avatar.height):null};el.setPointerCapture(event.pointerId);el.classList.add('dragging');api.setIgnoreMouse(false);ignore=false;});
addEventListener('pointermove',event=>{hoverPoint={x:event.clientX,y:event.clientY};if(drag){if(event.pointerId!==drag.id)return;drag.actor.x=drag.startX+event.clientX-drag.x;drag.actor.y=drag.startY+event.clientY-drag.y;position(drag.actor);if(drag.view){drag.actor.zoom=panCrop(drag.view,drag.startX+event.clientX-drag.x-drag.actor.x,drag.startY+event.clientY-drag.y-drag.actor.y,drag.actor);drag.actor.closeup=null;}return;}syncMouse();});
function release(event){if(!drag||event?.pointerId!==undefined&&event.pointerId!==drag.id)return;const {actor,id}=drag;drag=null;actor.el.classList.remove('dragging');if(actor.el.hasPointerCapture(id))actor.el.releasePointerCapture(id);}
addEventListener('pointerup',release);addEventListener('pointercancel',release);addEventListener('blur',release);
addEventListener('dblclick',event=>{if(event.button!==0)return;const actor=actors.get(actorAt(event)?.dataset.slug);if(!actor||!headAt(actor,event))return;event.preventDefault();release();void startActorVoice(actor);});
let wheelActor=null,wheelTimer=0,gestureSize=null,menuOpen=false;
function resizeActor(actor,factor,point={x:actor.x+actor.w/2,y:actor.y+actor.h/2}){
 if(!(Number.isFinite(factor)&&factor>0))return;
 if(!Number.isFinite(point.x)||!Number.isFinite(point.y))point={x:actor.x+actor.w/2,y:actor.y+actor.h/2};
 const before={x:actor.x,y:actor.y,w:actor.w,h:actor.h},a=actor.avatar;
 const view=actor.zoom||normalizeView(actor.closeup||a.currentView||{x:0,y:0,w:a.width,h:a.height},a.width,a.height);
 // Grow the clickable viewport only as far as the display. Zoom beyond it is
 // a high-detail crop in the same bounded drawing buffer.
 const nextW=zoomScale(actor.w,factor,1,1e7),cssFactor=nextW/actor.w;
 actor.w=nextW;actor.h*=cssFactor;actor.x=point.x-(point.x-before.x)*cssFactor;actor.y=point.y-(point.y-before.y)*cssFactor;
 position(actor);actor.zoom=zoomCrop(view,before,actor,point,factor);actor.closeup=null;actor.lastFrame=0;
}
addEventListener('wheel',event=>{
 if(event.target?.closest?.('.speech'))return;
 const actor=wheelActor||actors.get(actorAt(event)?.dataset.slug);if(!actor)return;event.preventDefault();
 selectedActor=actor.slug;wheelActor=actor;api.setIgnoreMouse(false);ignore=false;clearTimeout(wheelTimer);wheelTimer=setTimeout(()=>{wheelActor=null;syncMouse();},180);
 const unit=event.deltaMode===1?16:event.deltaMode===2?innerHeight:1;
 if(event.ctrlKey){if(!gestureSize)resizeActor(actor,Math.exp(-Math.max(-90,Math.min(90,event.deltaY*unit))*.0075),{x:event.clientX,y:event.clientY});}
 else {const orbit=actor.userOrbit||{yaw:actor.yaw,pitch:0};actor.userOrbit={yaw:orbit.yaw+Math.max(-120,Math.min(120,event.deltaX*unit))*.006,pitch:Math.max(-1.3,Math.min(1.3,orbit.pitch-Math.max(-120,Math.min(120,event.deltaY*unit))*.006))};actor.yaw=actor.userOrbit.yaw;}
 lastFrame=0;
},{passive:false});
addEventListener('gesturestart',event=>{const actor=actors.get(actorAt(event)?.dataset.slug);if(actor){event.preventDefault();gestureSize={actor,scale:1,point:{x:event.clientX,y:event.clientY}};api.setIgnoreMouse(false);ignore=false;}});
addEventListener('gesturechange',event=>{if(!gestureSize||!Number.isFinite(event.scale)||event.scale<=0)return;event.preventDefault();const g=gestureSize;resizeActor(g.actor,event.scale/g.scale,g.point);g.scale=event.scale;lastFrame=0;});
addEventListener('gestureend',()=>{gestureSize=null;syncMouse();});
addEventListener('blur',()=>{clearTimeout(wheelTimer);wheelActor=null;gestureSize=null;});
function actorCatalogue(actor){
 const o=actor.avatar.options,sel=o.selection;
 return {...o.catalogue(),clips:[...(actor.avatar.motion?.clips.values()||[])].map(c=>({id:c.id,label:c.label||c.id,category:c.category||'Motions'})),poses:[...o.poses.values()].filter(p=>p.group==='body').map(p=>({id:p.id,label:p.label||p.id})),current:{...sel,pose:sel.body||'',outfit:sel.outfit||o.data.defaultOutfit||'',prop:sel.prop||'',accessory:sel.accessory||o.data.defaultAccessory||'',lighting:sel.lighting||actor.avatar.appearance.defaultLighting}};
}
addEventListener('contextmenu',async event=>{
 if(event.target?.closest?.('.speech'))return;event.preventDefault();const actor=actors.get(actorAt(event)?.dataset.slug);if(!actor)return;selectedActor=actor.slug;release();menuOpen=true;api.setIgnoreMouse(false);ignore=false;
 try{await api.showMenu({slug:actor.slug,catalogue:actorCatalogue(actor),bubbleMode:actor.bubbleMode||'auto',music:window.gla_sing?.(),musicPending:Boolean(window.gla_sing_pending?.(actor.slug)),musicAvailable:!loading&&!actor.avatar.disposed,performing:Boolean(actor.avatar.motion?.active||window.gla_sing_sample?.(actor.slug))});}finally{menuOpen=false;syncMouse();}
});
async function actorMenuAction({slug,action}){
 const actor=actors.get(slug||selectedActor||catalogue?.selected)||actors.values().next().value;if(!actor)return;selectedActor=actor.slug;const a=actor.avatar,o=a.options;
 if(action==='close-up'){closeupActor(actor);return;}
 if(action==='agent'){helpCharacter=actor.slug;agentUI.open(actor.info.name);return;}
 if(action==='music:dance'){
  const result=await musicRouter.run('Dance along to the current song',{id:'menu-music-'+crypto.randomUUID(),character:actor.slug,cancelled:()=>actors.get(actor.slug)!==actor});
  if(actors.get(actor.slug)===actor&&!result.cancelled){setBubble(actor,result.text);status(result.text,!result.ok);}
  return;
 }
 if(action==='stop-performing'){window.gla_sing_stop?.(actor.slug);a.motion?.stop();refreshBubble(actor);return;}
 if(action==='recover'){recoverActor(actor);return;}
 if(action==='face-audience'){actor.userOrbit=null;actor.yaw=0;return;}
 if(action.startsWith('bubble:')){actor.bubbleMode=action.slice(7);setBubble(actor,'');return;}
 if(action==='stay'){a.motion?.stop();return;}
 if(action.startsWith('motion:')){await a.motion?.play(action.slice(7),{loop:false});return;}
 let next={...o.selection};
 if(action==='appearance-reset')next={...catalogue.defaults[slug],performance:o.selection.performance};
 else if(action==='follow-cursor')next.followCursor=String(!o.enabled('followCursor'));
 else if(action.startsWith('pose:')){a.motion?.stop();next.body=action.slice(5);next.hands='';next.leftHand='';next.rightHand='';}
 else if(action.startsWith('outfit:'))next.outfit=action.slice(7);
 else if(action.startsWith('prop:')){next.prop=action.slice(5);const prop=next.prop?o.props.find(p=>p.id===next.prop):null;if(prop?.pose){a.motion?.stop();next.body=prop.pose;next.hands=prop.hands;next.leftHand='';next.rightHand='';}
  else if(!next.prop&&o.props.some(p=>p.pose===o.selection.body)){const look=catalogue.looks[slug]??catalogue.defaults[slug]??{};a.motion?.stop();next.body=look.body&&!o.props.some(p=>p.pose===look.body)?look.body:'Ps007.stand';next.hands='';next.leftHand='';next.rightHand='';}}
 else if(action.startsWith('appearance:')){const tail=action.slice(11),split=tail.lastIndexOf(':');if(split<0)return;next[tail.slice(0,split)]=tail.slice(split+1);}
 else return;
 o.select(next);catalogue.looks[slug]={...o.selection};await window.gla.saveAppearance(slug,o.selection);lastFrame=0;
}
api.onMenuAction(request=>void actorMenuAction(request).catch(e=>status(e.message,true)));
window.gla.onSettings(next=>{
 if(!catalogue)return;
 catalogue.conversationSounds=next.conversationSounds;catalogue.agentFolder=next.agentFolder;catalogue.userHome=next.userHome;catalogue.agentEnabled=next.agentEnabled;
 const changed=catalogue.quality!==next.quality;catalogue.hasKey=next.hasKey;catalogue.hardware=next.hardware;
 if(changed){catalogue.quality=next.quality;const performance=next.quality==='best'?'quality':next.quality==='friendly'?'eco':'balanced';
  for(const actor of actors.values()){const a=actor.avatar;if(a.disposed||!a.options)continue;a.textureLimit=textureBudget(actors.size,next.hardware?.memoryGB);if(a.resources)a.resources.maxTextureSize=a.textureLimit;a.options.select({...a.options.selection,performance});position(actor);actor.lastFrame=0;}
 }
 controls();
});
$('#liveMode').onchange=()=>{$('#start').textContent=liveMode()?'Start live talk':'Start conversation';$('#rounds').hidden=liveMode();document.querySelector('[for=rounds]').hidden=liveMode();};
$('#liveMic').onclick=()=>liveGroup.setMuted(!liveGroup.muted);
$('#liveSend').onclick=()=>{liveGroup.say($('#liveText').value);$('#liveText').value='';};
$('#liveText').onkeydown=e=>{if(e.key==='Enter')$('#liveSend').click();};
// Closing mid-show lets a recording finish writing first (a few seconds at most) so nothing performed is lost.
$('#start').onclick=start;$('#stop').onclick=()=>stop();$('#close').onclick=async()=>{stop();try{await Promise.race([show?.settle?.(),new Promise(r=>setTimeout(r,20000))]);}catch{}void api.close();};$('#reset').onclick=arrange;$('#compact').onclick=()=>compact(!$('.panel').classList.contains('compact'));
$('#join').onchange=()=>{$('#nameLabel').hidden=!$('#join').checked;show?.refresh();};
$('#format').onchange=()=>{const isShow=showMode();$('.panel').classList.toggle('show-mode',isShow);$('#joinLabel').textContent=isShow?'I’ll act a role':'Join as yourself';if(!isShow)show?.leave();else if(running)stop('Switched to Avatar Show.');show?.refresh();$('#topic').value=({show:'A short comedy about a lost crown, with a twist ending.',chat:'Plan a cheerful day out together, each suggesting something different.',story:'A mysterious invitation arrives from a floating city. We decide what happens next.',debate:'Is the best holiday carefully planned or completely spontaneous?',choices:'Would you rather have a tiny dragon companion or a door to anywhere? Explore our choices.'})[$('#format').value];};
$('#raise').onclick=()=>{if(liveMode()||!running||!human.enabled||waitingHuman||currentTurn>=totalTurns-1)return;wantsTurn=true;listener='_human';controls();status('You’re next, after this character finishes speaking.');};
$('#humanText').oninput=controls;$('#humanText').onkeydown=e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();finishHuman();}};$('#send').onclick=()=>finishHuman();$('#pass').onclick=()=>finishHuman(true);$('#mic').onclick=()=>microphone.state==='recording'?microphone.finish():void microphone.start();
// A hidden window ends every paid voice session, the Director's included.
const hiddenStop=()=>{show?.hangUp('Director voice hung up because the window was hidden; tap the microphone to reconnect.');stop('Conversation ended because the group was hidden.');};
let hiddenTimer;addEventListener('visibilitychange',()=>{clearTimeout(hiddenTimer);if(document.visibilityState!=='visible'){microphone.cancel();liveGroup.setMuted(true);hiddenTimer=setTimeout(hiddenStop,15000);}});
api.onReset(arrange);api.onStop(hiddenStop);addEventListener('resize',arrange);addEventListener('beforeunload',()=>{stop();for(const a of actors.values())a.avatar.dispose();actors.clear();});addEventListener('keydown',event=>{if(event.key==='Escape')stop();});
(async()=>{try{catalogue=await api.catalogue();if(!catalogue.ok)throw Error(catalogue.error);helpCharacter=catalogue.selected||catalogue.avatars[0]?.slug||'';const preferred=[catalogue.selected,...catalogue.avatars.map(x=>x.slug)].filter((x,i,arr)=>arr.indexOf(x)===i).slice(0,2);catalogue.avatars.forEach((info,i)=>{const row=document.createElement('label');row.className='choice';const check=document.createElement('input');check.type='checkbox';check.value=info.slug;check.checked=preferred.includes(info.slug);check.onchange=()=>{if(selected().length>5){check.checked=false;return;}void loadCast();};const voices=document.createElement('select');voices.dataset.voice=info.slug;voices.setAttribute('aria-label',info.name+' voice');for(const v of catalogue.voices){const option=document.createElement('option');option.value=v;option.textContent=v;voices.append(option);}voices.value=catalogue.groupVoices?.[info.slug]||({tia:'marin',sarah:'gleam',iselda:'quartz','ming-mei':'willow',seraphim:'bossa'}[info.slug])||'marin';voices.onchange=()=>{void gla.setSettings({groupVoices:{...catalogue.groupVoices,[info.slug]:voices.value}}).then(next=>{catalogue.groupVoices=next.groupVoices;});};row.append(check,document.createTextNode(info.name),voices);$('#cast').append(row);});show=installShow({api:gla.show,voice,actors,catalogue:()=>catalogue,hooks:{selected,voiceFor:slug=>document.querySelector(`[data-voice="${slug}"]`)?.value||'marin',human:()=>({enabled:$('#join').checked,name:$('#humanName').value.trim().replace(/[\r\n]/g,' ').slice(0,40)||'You'}),topic:()=>$('#topic').value.trim(),loading:()=>loading,controls,compact,minimize:v=>panel.setMinimized(v),setBubble,appendLine,setIgnoreMouse:value=>{api.setIgnoreMouse(value);ignore=value;},setFloor:(s,l)=>{speaker=s;listener=l;},walk:walkActor,bill:billCast,beginShow:()=>{if(running)stop('Starting the show…',true);running=true;conversationSounds.transition('live');human={enabled:$('#join').checked,name:$('#humanName').value.trim().replace(/[\r\n]/g,' ').slice(0,40)||'You'};$('#transcript').replaceChildren();controls();},endShow:()=>{running=false;speaker='';listener='';conversationSounds.transition('idle');controls();},rest:message=>stop(message),refreshActor:slug=>{const a=actors.get(slug);if(a)refreshBubble(a);},noteDone:slug=>{const a=actors.get(slug);if(!a)return;a.composerOpen=false;if(a.bubble.contains(document.activeElement))document.activeElement.blur();refreshBubble(a);syncMouse();},onFrame:(fn,on=true)=>{on?frameHooks.add(fn):frameHooks.delete(fn);},onAudio:(fn,on=true)=>{on?audioTaps.add(fn):audioTaps.delete(fn);}}});
 await loadCast();show.ready();requestAnimationFrame(animate);}catch(e){status(e.message,true);}})();
// Read-only diagnostics are useful for installation verification.
window.gla_group={openComposer,walkActor,freeSpot,billCast,startActorVoice,headAt,closeupActor,actors,voice,microphone,liveGroup,actorAt,actorCatalogue,actorMenuAction,actOnSpeech,start,stop,arrange,loadCast,get show(){return show;},get state(){return {running,loading,speaker,listener,history:[...history],generation:runGeneration,waitingHuman,wantsTurn,human:{...human},currentTurn,totalTurns};}};
