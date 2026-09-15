import '/avatar3d.js';
import {closeupView} from '/avatar-closeup.js';
let selectedActor='',closeupPanelState=null;
import {installAgentUI} from '/agent-client.js';
import { frameDue, renderPixelBudget, textureBudget } from '/avatar-render-budget.js';
import * as THREE from '/vendor/three/three.module.js';
import {GroupVoice} from '/group-voice.js';
import {AvatarHitMask} from '/avatar-hit-mask.js';
import {groupAction} from '/group-actions.js';
import {needsAgent} from '/group-agent-request.js';
import {LiveGroup} from '/group-live.js';
import {ConversationSounds} from '/conversation-sounds.js';
import {installGroupPanel} from '/group-panel.js';
import {GroupMicrophone} from '/group-input.js';
const $=s=>document.querySelector(s),api=window.gla.group,voice=new GroupVoice(api),actors=new Map();
let catalogue,loadGeneration=0,runGeneration=0,running=false,loading=false,speaker='',listener='',history=[],drag=null,ignore=false,lastFrame=0;
let waitingHuman=false,humanResolve=null,wantsTurn=false,currentTurn=0,totalTurns=0,human={enabled:false,name:'You'};
const conversationSounds=new ConversationSounds(()=>catalogue?.conversationSounds!==false);
const microphone=new GroupMicrophone(api,{
 onState:(state,seconds)=>{const busy=state!=='idle';$('#mic').textContent=state==='recording'?'Finish recording':state==='requesting'?'Opening microphone…':state==='transcribing'?'Transcribing…':'Speak my reply';$('#mic').setAttribute('aria-pressed',String(state==='recording'));$('#mic').disabled=!waitingHuman||['requesting','transcribing'].includes(state);$('#humanText').disabled=busy;$('#send').disabled=!waitingHuman||busy||!$('#humanText').value.trim();$('#micStatus').textContent=state==='recording'?`Microphone on · ${seconds} / 60 seconds`:state==='requesting'?'Waiting for microphone access…':state==='transcribing'?'Microphone off · transcribing your recording…':'Microphone off. Review your text, then send.';},
 onText:text=>{if(!waitingHuman)return;$('#humanText').value=[$('#humanText').value.trim(),text].filter(Boolean).join(' ').slice(0,1200);$('#humanText').focus();},
 onError:message=>{$('#micStatus').textContent=message;}
});
const liveGroup=new LiveGroup(api,{
 connected:()=>conversationSounds.transition('connected'),
 warning:message=>status(message,true),status:message=>status(message),error:message=>{stop();status(message,true);},
 floor:floor=>{speaker=floor.speaker;listener=floor.listener;for(const a of actors.values()){a.el.classList.toggle('speaking',a.slug===speaker);if(a.slug!==speaker)setBubble(a,'');}},
 text:line=>{const actor=actors.get(line.speaker);if(actor)setBubble(actor,line.text);},
 line:line=>{if(line.speaker==='_human'&&!(catalogue?.agentEnabled&&needsAgent(line.text)))void actOnSpeech(line.text);history.push(line);appendLine(actors.get(line.speaker)||{info:{name:human.name+' (you)'}},line.text);},
 microphone:state=>{$('#liveMic').textContent=!state.active?'Microphone off':state.muted?'Unmute microphone':'Mute microphone';$('#liveMic').disabled=!state.active;$('#liveMic').setAttribute('aria-pressed',String(state.active&&!state.muted));},
});
function liveMode(){return $('#liveMode').checked;}
voice.onWarning=message=>status(message,true);
voice.onConnected=()=>conversationSounds.transition('connected');
const status=(message,error=false)=>{$('#status').textContent=message;$('#status').classList.toggle('error',error);};
let helpCharacter='tia';
const agentUI=installAgentUI({api:{...window.gla.agent,run:request=>api.reply({...request,speaker:helpCharacter,participants:[...actors.keys()],human:{enabled:true,name:human.name||'You'},topic:$('#topic').value,mode:$('#format').value,history:[...history],humanRequest:request.history.at(-1)?.text||''})},onStatus:(_message,update)=>{if(!update)return;const actor=[...actors.values()].find(a=>[a.slug,a.info.name].some(n=>n.toLowerCase()===String(update.character).toLowerCase()));if(!actor)return;for(const a of actors.values())if(a!==actor){a.activity=null;refreshBubble(a);}actor.activity=update;refreshBubble(actor);},name:()=>actors.get(helpCharacter)?.info.name||'the characters',interactive:value=>{if(value){api.setIgnoreMouse(false);ignore=false;}},execute:async(action,args,cancelled)=>{
 if(action==='state')return {ok:true,characters:[...actors.values()].map(a=>({slug:a.slug,name:a.info.name,motions:[...a.avatar.motion.clips.values()].slice(0,180).map(c=>({id:c.id,label:c.label||c.id}))}))};
 const actor=[...actors.values()].find(a=>[a.slug,a.info.name].some(n=>n.toLowerCase()===String(args.character).toLowerCase()));if(!actor)throw Error('That character is not visible.');
 if(action==='play_motion'){if(!actor.avatar.motion.clips.has(args.motion))throw Error('That motion is not installed.');const result=await actor.avatar.motion.play(args.motion,{loop:false});return {ok:result!==false,motion:args.motion,character:actor.slug};}
 if(action==='move_avatar'){
  const points={'upper-left':[0,0],'upper-right':[1,0],'lower-left':[0,1],'lower-right':[1,1],center:[.5,.5],left:[0,.5],right:[1,.5],top:[.5,0],bottom:[.5,1]},p=points[args.destination];if(!p)throw Error('Unknown destination.');
  const from={x:actor.x,y:actor.y},to={x:(innerWidth-actor.w)*p[0],y:70+(innerHeight-actor.h-70)*p[1]},start=performance.now();
  await actor.avatar.motion.play(actor.avatar.options.walkingClip(),{loop:true});
  try{while(true){if(cancelled()||!actors.has(actor.slug)||drag?.actor===actor)throw Error('Movement interrupted.');const t=Math.min(1,(performance.now()-start)/2000),e=t*t*(3-2*t);actor.x=from.x+(to.x-from.x)*e;actor.y=from.y+(to.y-from.y)*e;position(actor);if(t===1)break;await new Promise(requestAnimationFrame);}}finally{actor.avatar.motion.stop();}
  return {ok:true,character:actor.slug,destination:args.destination,reached:true};
 }
 throw Error('Unknown avatar action.');
}});

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
function recoverActor(actor){actor.closeup=null;actor.el.style.zIndex='';const cell=innerWidth/actors.size,i=[...actors.keys()].indexOf(actor.slug),h=Math.min(innerHeight*.68,740),w=Math.min(cell+90,h*.9);Object.assign(actor,{w,h,x:cell*(i+.5)-w/2,y:innerHeight-h-24});position(actor);}
function closeupActor(actor){
 if(closeupPanelState===null)closeupPanelState=$('.panel').classList.contains('minimized');
 panel.setMinimized(true);
 for(const other of actors.values())if(other.closeup&&other!==actor)recoverActor(other);
 actor.avatar.motion?.stop();actor.userOrbit={yaw:0,pitch:0};actor.yaw=0;actor.avatar.setOrbit(actor.userOrbit);
 Object.assign(actor,{w:Math.min(innerWidth,innerHeight*.95),h:innerHeight-110,x:Math.max(0,(innerWidth-Math.min(innerWidth,innerHeight*.95))/2),y:80});
 position(actor);actor.closeup=closeupView(actor.avatar);actor.el.style.zIndex='3';actor.lastFrame=0;
}
function arrange(){for(const actor of actors.values())recoverActor(actor);if(closeupPanelState!==null){panel.setMinimized(closeupPanelState);closeupPanelState=null;}}
function setBubble(actor,text){actor.message=text;if(text&&actor.activity&&!actor.activity.active)actor.activity=null;refreshBubble(actor);}
function refreshBubble(actor){
 const activity=actor.activity&&performance.now()<actor.activity.until?actor.activity:null;
 const text=activity?[activity.label,activity.detail].filter(Boolean).join('\n'):actor.message||(actor.bubbleMode==='always'?(actor.slug===speaker?'Speaking…':running?'Listening':'Ready'):'');
 actor.bubble.classList.toggle('task-update',Boolean(activity));actor.bubble.setAttribute('aria-label',activity?actor.info.name+' task progress':actor.info.name+' speech');
 actor.bubble.hidden=actor.bubbleMode==='off';if(actor.bubble.textContent!==text)actor.bubble.textContent=text;
 const width=actor.bubble.offsetWidth||270,height=actor.bubble.offsetHeight||0;
 actor.bubble.style.left=Math.max(width/2+8-actor.x,Math.min(actor.w/2,innerWidth-width/2-8-actor.x))+'px';
 actor.bubble.style.bottom=Math.min(actor.h,actor.y+actor.h-height-8)+'px';
}
function stop(message='Stopped. Everyone is resting.'){conversationSounds.transition('idle');runGeneration++;running=false;speaker='';listener='';waitingHuman=false;wantsTurn=false;const resolve=humanResolve;humanResolve=null;resolve?.(null);microphone.cancel();voice.stop();liveGroup.stop();for(const a of actors.values()){a.activity=null;setBubble(a,'');a.el.classList.remove('speaking');}controls();status(message);}
async function loadCast(){
 const generation=++loadGeneration;stop('Loading characters…');loading=true;controls();const slugs=selected().slice(0,5);
 for(const [slug,actor] of actors)if(!slugs.includes(slug)){actor.avatar.dispose();actor.el.remove();actors.delete(slug);}
 try{for(const slug of slugs){if(actors.has(slug))continue;const info=catalogue.avatars.find(x=>x.slug===slug);const avatar=OpenClamAvatar3D.create({width:480,height:700});
  const performance=catalogue.quality==='best'?'quality':catalogue.quality==='friendly'?'eco':'balanced';
  await avatar.load(info.modelURL,{resources:info.residentAvailable,pose:info.pose,yaw:info.yaw,performance,motionLibrary:info.motionsURL,appearanceLibrary:info.appearanceURL,textureLimit:textureBudget(slugs.length,catalogue.hardware?.memoryGB)});
  if(generation!==loadGeneration){avatar.dispose();return;}
  const look=catalogue.looks[slug]??catalogue.defaults[slug]??{};
  avatar.options.select({...look,performance,body:look.body||'Ps007.stand',prop:'',hands:'',leftHand:'',rightHand:'',playTransitions:look.playTransitions??'true',followCursor:'false'});
  await avatar.resources?.update(performance,900,true);avatar.root.updateMatrixWorld(true);
  // Wardrobes and props contribute to the frame from the outset, including
  // wide armor. Leave generous space around all sides for natural gestures.
  const bounds=avatar.modelBounds();if(!bounds.isEmpty()){bounds.expandByScalar(.08);avatar.restBounds=bounds.clone();avatar.bounds=bounds.clone();avatar.frame();}
  const el=document.createElement('div');el.className='actor';el.dataset.slug=slug;el.append(avatar.canvas);const label=document.createElement('span');label.className='name';label.textContent=info.name;el.append(label);const bubble=document.createElement('div');bubble.className='speech';el.append(bubble);$('#stage').append(el);
  actors.set(slug,{slug,info,avatar,el,bubble,hitMask:new AvatarHitMask(),maskAt:0,yaw:0,w:480,h:700,x:0,y:100,blinkOffset:Math.random()*4,breathOffset:Math.random()*5});
 }
 if(generation!==loadGeneration)return;
 for(const actor of actors.values()){actor.avatar.textureLimit=textureBudget(slugs.length,catalogue.hardware?.memoryGB);actor.avatar.resources.maxTextureSize=actor.avatar.textureLimit;actor.avatar.options.select(actor.avatar.options.selection);}
 arrange();
 await Promise.all([...actors.values()].map(async actor=>{const a=actor.avatar;await a.resources?.update(a.options.selection.performance,actor.h,true);a.render(performance.now(),{reduce:true,fitContent:true,projectedHeight:actor.h,audienceContact:true});await a.resources?.pending;}));
 if(generation!==loadGeneration)return;status(actors.size<2?'Choose at least two characters.':catalogue.hasKey?'Ready for live talk. Join as yourself to speak and interrupt anytime.':'Add a voice API key in Settings to start a conversation.');
 }catch(e){status('Could not load a character: '+e.message,true);}finally{if(generation===loadGeneration){loading=false;controls();}}
}
function appendLine(actor,text){const p=document.createElement('p'),b=document.createElement('b');b.textContent=actor.info.name+': ';p.append(b,document.createTextNode(text));$('#transcript').append(p);while($('#transcript').children.length>20)$('#transcript').firstChild.remove();$('#transcript').scrollTop=$('#transcript').scrollHeight;}
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
async function startLive(){
 if(running||loading||actors.size<2)return;const topic=$('#topic').value.trim();if(!topic){status('Add a topic first.',true);return;}
 stop('Starting live talk…');running=true;conversationSounds.transition('connecting');compact(true);human={enabled:$('#join').checked,name:$('#humanName').value.trim().replace(/[\r\n]/g,' ').slice(0,40)||'You'};history=[];$('#transcript').replaceChildren();controls();
 await liveGroup.start({agentEnabled:catalogue.agentEnabled,cast:[...actors.values()].map(a=>({slug:a.slug,name:a.info.name,voice:document.querySelector(`[data-voice="${a.slug}"]`).value})),topic,mode:$('#format').value,human});
}
function animate(now){requestAnimationFrame(animate);if(document.visibilityState!=='visible')return;const due=frameDue(now,lastFrame,30);if(due===null)return;const dt=Math.min(.12,(now-lastFrame)/1000);lastFrame=due;const signal=liveGroup.running?liveGroup.sample():voice.sample();
 for(const actor of actors.values()){
  const a=actor.avatar;if(a.disposed||!a.options)continue;const isSpeaker=actor.slug===speaker,talking=isSpeaker&&Boolean(signal.speaking);
  const busy=isSpeaker||a.motion?.active||a.options.transition||drag?.actor===actor||gestureSize?.actor===actor||wheelActor===actor;
  const actorDue=frameDue(now,actor.lastFrame||0,busy?30:12);if(actorDue===null)continue;const actorDt=Math.min(.15,(now-(actor.lastFrame||now))/1000);actor.lastFrame=actorDue;
  const partner=actors.get(isSpeaker?listener:speaker),audience=!running||!partner||(isSpeaker&&Math.sin(now/3200)>.75);
  const direction=audience?0:Math.sign(partner.x+partner.w/2-actor.x-actor.w/2),targetYaw=actor.userOrbit?.yaw??(-direction*.35),pitch=actor.userOrbit?.pitch||0;
  actor.yaw+= (targetYaw-actor.yaw)*(1-Math.exp(-actorDt*2.8));if(Math.abs(actor.yaw-(actor.renderYaw??999))>.001||pitch!==actor.renderPitch){a.setOrbit({yaw:actor.yaw,pitch});actor.renderYaw=actor.yaw;actor.renderPitch=pitch;}
  let lookTarget;if(!audience){lookTarget=a.camera.position.clone();lookTarget.x+=direction*1.5;}
  const cursor=a.options.enabled('followCursor'),gaze=cursor&&hoverPoint?{x:Math.max(-1,Math.min(1,(hoverPoint.x-actor.x-actor.w/2)/(actor.w/2))),y:Math.max(-1,Math.min(1,-(hoverPoint.y-actor.y-actor.h/2)/(actor.h/2)))}:{x:0,y:0};
  a.render(now,{reduce:false,breathe:1,bodyMotion:false,fitContent:true,stableFitContent:true,viseme:talking?signal.viseme:'sil',visemeWeights:talking?signal.visemeWeights:{},lipSyncSource:signal.lipSyncSource,intensity:talking?signal.relative:0,speaking:talking,projectedHeight:actor.h,lipSyncGain:1.35,audienceContact:audience&&!cursor,cameraFocus:true,lookTarget,gaze,expression:{}},actor.closeup);
  refreshBubble(actor);
  if(now-actor.maskAt>80){actor.hitMask.update(a.canvas);actor.maskAt=now;}
 }
 syncMouse();
}
let hoverPoint=null;
function actorAt(event){
 if(event.target?.closest?.('.panel'))return null;
 return [...actors.values()].reverse().find(a=>a.hitMask.contains(event.clientX-a.x,event.clientY-a.y,a.w,a.h))?.el||null;
}
function syncMouse(){
 if(agentUI.dialog.open){if(ignore){ignore=false;api.setIgnoreMouse(false);}return;}
 if(!hoverPoint||panel.dragging||drag||gestureSize||wheelActor||menuOpen)return;
 const top=document.elementFromPoint(hoverPoint.x,hoverPoint.y),interactive=Boolean(top?.closest('.panel'))||Boolean(actorAt({clientX:hoverPoint.x,clientY:hoverPoint.y,target:top}));
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

addEventListener('pointerdown',event=>{const el=actorAt(event);if(!el||event.button!==0)return;const actor=actors.get(el.dataset.slug);selectedActor=actor.slug;drag={id:event.pointerId,actor,x:event.clientX,y:event.clientY,startX:actor.x,startY:actor.y};el.setPointerCapture(event.pointerId);el.classList.add('dragging');api.setIgnoreMouse(false);ignore=false;});
addEventListener('pointermove',event=>{hoverPoint={x:event.clientX,y:event.clientY};if(drag){if(event.pointerId!==drag.id)return;drag.actor.x=drag.startX+event.clientX-drag.x;drag.actor.y=drag.startY+event.clientY-drag.y;position(drag.actor);return;}syncMouse();});
function release(event){if(!drag||event?.pointerId!==undefined&&event.pointerId!==drag.id)return;const {actor,id}=drag;drag=null;actor.el.classList.remove('dragging');if(actor.el.hasPointerCapture(id))actor.el.releasePointerCapture(id);}
addEventListener('pointerup',release);addEventListener('pointercancel',release);addEventListener('blur',release);
let wheelActor=null,wheelTimer=0,gestureSize=null,menuOpen=false;
function resizeActor(actor,factor){const oldW=actor.w,oldH=actor.h;actor.w*=factor;actor.h*=factor;actor.x-=(actor.w-oldW)/2;actor.y-=(actor.h-oldH)/2;position(actor);}
addEventListener('wheel',event=>{
 const actor=wheelActor||actors.get(actorAt(event)?.dataset.slug);if(!actor)return;event.preventDefault();
 selectedActor=actor.slug;wheelActor=actor;api.setIgnoreMouse(false);ignore=false;clearTimeout(wheelTimer);wheelTimer=setTimeout(()=>{wheelActor=null;syncMouse();},180);
 const unit=event.deltaMode===1?16:event.deltaMode===2?innerHeight:1;
 if(event.ctrlKey){if(!gestureSize)resizeActor(actor,Math.exp(-Math.max(-90,Math.min(90,event.deltaY*unit))*.0075));}
 else {const orbit=actor.userOrbit||{yaw:actor.yaw,pitch:0};actor.userOrbit={yaw:orbit.yaw+Math.max(-120,Math.min(120,event.deltaX*unit))*.006,pitch:Math.max(-1.3,Math.min(1.3,orbit.pitch-Math.max(-120,Math.min(120,event.deltaY*unit))*.006))};actor.yaw=actor.userOrbit.yaw;}
 lastFrame=0;
},{passive:false});
addEventListener('gesturestart',event=>{const actor=actors.get(actorAt(event)?.dataset.slug);if(actor){event.preventDefault();gestureSize={actor,w:actor.w,h:actor.h,x:actor.x,y:actor.y};api.setIgnoreMouse(false);ignore=false;}});
addEventListener('gesturechange',event=>{if(!gestureSize||!Number.isFinite(event.scale)||event.scale<=0)return;event.preventDefault();const g=gestureSize;g.actor.w=g.w*event.scale;g.actor.h=g.h*event.scale;g.actor.x=g.x-(g.actor.w-g.w)/2;g.actor.y=g.y-(g.actor.h-g.h)/2;position(g.actor);lastFrame=0;});
addEventListener('gestureend',()=>{gestureSize=null;syncMouse();});
addEventListener('blur',()=>{clearTimeout(wheelTimer);wheelActor=null;gestureSize=null;});
function actorCatalogue(actor){
 const o=actor.avatar.options,sel=o.selection;
 return {...o.catalogue(),clips:[...(actor.avatar.motion?.clips.values()||[])].map(c=>({id:c.id,label:c.label||c.id,category:c.category||'Motions'})),poses:[...o.poses.values()].filter(p=>p.group==='body').map(p=>({id:p.id,label:p.label||p.id})),current:{...sel,pose:sel.body||'',outfit:sel.outfit||o.data.defaultOutfit||'',prop:sel.prop||'',accessory:sel.accessory||o.data.defaultAccessory||'',lighting:sel.lighting||actor.avatar.appearance.defaultLighting}};
}
addEventListener('contextmenu',async event=>{
 event.preventDefault();const actor=actors.get(actorAt(event)?.dataset.slug);if(!actor)return;selectedActor=actor.slug;release();menuOpen=true;api.setIgnoreMouse(false);ignore=false;
 try{await api.showMenu({slug:actor.slug,catalogue:actorCatalogue(actor),bubbleMode:actor.bubbleMode||'auto'});}finally{menuOpen=false;syncMouse();}
});
async function actorMenuAction({slug,action}){
 const actor=actors.get(slug||selectedActor||catalogue?.selected)||actors.values().next().value;if(!actor)return;selectedActor=actor.slug;const a=actor.avatar,o=a.options;
 if(action==='close-up'){closeupActor(actor);return;}
 if(action==='agent'){helpCharacter=slug;agentUI.open(catalogue);return;}
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
 else if(action.startsWith('prop:')){next.prop=action.slice(5);if(next.prop){const prop=o.props.find(p=>p.id===next.prop);if(prop?.pose){a.motion?.stop();next.body=prop.pose;next.hands=prop.hands;next.leftHand='';next.rightHand='';}}}
 else if(action.startsWith('appearance:')){const tail=action.slice(11),split=tail.lastIndexOf(':');if(split<0)return;next[tail.slice(0,split)]=tail.slice(split+1);}
 else return;
 o.select(next);catalogue.looks[slug]={...o.selection};await window.gla.saveAppearance(slug,o.selection);lastFrame=0;
}
api.onMenuAction(request=>void actorMenuAction(request).catch(e=>status(e.message,true)));
window.gla.onSettings(next=>{
 if(!catalogue)return;
 catalogue.conversationSounds=next.conversationSounds;catalogue.agentFolder=next.agentFolder;catalogue.agentEnabled=next.agentEnabled;
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
$('#start').onclick=start;$('#stop').onclick=()=>stop();$('#close').onclick=()=>{stop();void api.close();};$('#reset').onclick=arrange;$('#compact').onclick=()=>compact(!$('.panel').classList.contains('compact'));
$('#join').onchange=()=>{$('#nameLabel').hidden=!$('#join').checked;};
$('#format').onchange=()=>{$('#topic').value=({chat:'Plan a cheerful day out together, each suggesting something different.',story:'A mysterious invitation arrives from a floating city. We decide what happens next.',debate:'Is the best holiday carefully planned or completely spontaneous?',choices:'Would you rather have a tiny dragon companion or a door to anywhere? Explore our choices.'})[$('#format').value];};
$('#raise').onclick=()=>{if(liveMode()||!running||!human.enabled||waitingHuman||currentTurn>=totalTurns-1)return;wantsTurn=true;listener='_human';controls();status('You’re next, after this character finishes speaking.');};
$('#humanText').oninput=controls;$('#humanText').onkeydown=e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();finishHuman();}};$('#send').onclick=()=>finishHuman();$('#pass').onclick=()=>finishHuman(true);$('#mic').onclick=()=>microphone.state==='recording'?microphone.finish():void microphone.start();
let hiddenTimer;addEventListener('visibilitychange',()=>{clearTimeout(hiddenTimer);if(document.visibilityState!=='visible'){microphone.cancel();liveGroup.setMuted(true);hiddenTimer=setTimeout(()=>stop('Conversation ended because the group was hidden.'),15000);}});
api.onReset(arrange);api.onStop(()=>stop('Conversation ended because the group was hidden.'));addEventListener('resize',arrange);addEventListener('beforeunload',()=>{stop();for(const a of actors.values())a.avatar.dispose();actors.clear();});addEventListener('keydown',event=>{if(event.key==='Escape')stop();});
(async()=>{try{catalogue=await api.catalogue();if(!catalogue.ok)throw Error(catalogue.error);const preferred=[catalogue.selected,...catalogue.avatars.map(x=>x.slug)].filter((x,i,arr)=>arr.indexOf(x)===i).slice(0,2);catalogue.avatars.forEach((info,i)=>{const row=document.createElement('label');row.className='choice';const check=document.createElement('input');check.type='checkbox';check.value=info.slug;check.checked=preferred.includes(info.slug);check.onchange=()=>{if(selected().length>5){check.checked=false;return;}void loadCast();};const voices=document.createElement('select');voices.dataset.voice=info.slug;voices.setAttribute('aria-label',info.name+' voice');for(const v of catalogue.voices){const option=document.createElement('option');option.value=v;option.textContent=v;voices.append(option);}voices.value=catalogue.groupVoices?.[info.slug]||({tia:'marin',sarah:'gleam',iselda:'quartz','ming-mei':'willow',seraphim:'bossa'}[info.slug])||'marin';voices.onchange=()=>{void gla.setSettings({groupVoices:{...catalogue.groupVoices,[info.slug]:voices.value}}).then(next=>{catalogue.groupVoices=next.groupVoices;});};row.append(check,document.createTextNode(info.name),voices);$('#cast').append(row);});await loadCast();requestAnimationFrame(animate);}catch(e){status(e.message,true);}})();
// Read-only diagnostics are useful for installation verification.
window.gla_group={closeupActor,actors,voice,microphone,liveGroup,actorAt,actorCatalogue,actorMenuAction,actOnSpeech,start,stop,arrange,loadCast,get state(){return {running,loading,speaker,listener,history:[...history],generation:runGeneration,waitingHuman,wantsTurn,human:{...human},currentTurn,totalTurns};}};
