import {LiveClient} from '/live-client.js';
import {GroupCapture} from '/group-capture.js';
import {commentaryChunks} from '/delegate-client.js';
import {needsAgent} from '/group-agent-request.js';
import {addressedSpeaker,playbackEcho,quotedContext} from '/group-context.js';

// Hysteresis rejects clicks and brief noise; release tolerates ordinary pauses.
export class SpeechGate {
 constructor(){this.noise=.002;this.active=false;this.above=0;this.lastLoud=0;}
 sample(rms,now){
  const threshold=Math.max(.014,this.noise*3.8);
  if(rms>threshold){this.above=this.above||now;this.lastLoud=now;}
  else {this.above=0;if(!this.active)this.noise=this.noise*.995+Math.min(rms,.012)*.005;}
  const previous=this.active;
  if(!this.active&&this.above&&now-this.above>=90)this.active=true;
  if(this.active&&now-this.lastLoud>520)this.active=false;
  return this.active===previous?null:this.active;
 }
}
const rmsOf=(analyser,samples)=>{if(!analyser)return 0;analyser.getFloatTimeDomainData(samples);let sum=0;for(const v of samples)sum+=v*v;return Math.sqrt(sum/samples.length);};
export class LiveGroup {
 constructor(api,callbacks={}){this.api=api;this.callbacks=callbacks;this.generation=0;this.peers=new Map();this.history=[];this.active='';this.running=false;this.muted=false;this.actions=[];this.contextVersion=0;this.offContext=api.onContext?.(entry=>this.actionResult(entry));}
 emit(type,detail){this.callbacks[type]?.(detail);}
 async start({cast,topic,mode,human,inputStream=null,monitor=true,agentEnabled=false}){
  this.stop();const generation=this.generation,current=()=>generation===this.generation;
  Object.assign(this,{cast,topic,mode,human,monitor,agentEnabled,running:true,history:[],turn:0,active:'',userSpeaking:false,muted:false,directed:null,awaitingHuman:false,awaitingNextHuman:false,gate:new SpeechGate()});
  try{
   this.context=new AudioContext();await this.context.resume();if(!current())return;
   if(human.enabled){
    const stream=inputStream?new MediaStream(inputStream.getAudioTracks().map(t=>t.clone())):await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
    if(!current()){stream.getTracks().forEach(t=>t.stop());return;}
    this.microphone=stream;this.source=this.context.createMediaStreamSource(stream);this.micAnalyser=this.context.createAnalyser();this.micAnalyser.fftSize=1024;this.micSamples=new Float32Array(1024);this.source.connect(this.micAnalyser);
    if(this.api.transcribe)this.capture=await GroupCapture.create(this.context,this.source);
    if(!current()){this.capture?.close();this.capture=null;return;}
    this.emit('microphone',{muted:false,active:true});
   }
   this.emit('status','Connecting the live voices…');
   const results=await Promise.allSettled(cast.map(async character=>{
    const input=this.context.createMediaStreamDestination(),micGain=this.context.createGain();micGain.gain.value=0;this.source?.connect(micGain);micGain.connect(input);
    const silence=this.context.createConstantSource();silence.offset.value=0;silence.connect(input);silence.start();
    const client=new LiveClient({createSession:sdp=>this.api.live({sdp,voice:character.voice,speaker:character.slug,participants:cast.map(c=>c.slug),topic,mode,human})});
    const p={...character,client,input,micGain,silence,audio:new Audio(),peak:.025,segments:new Map(),heard:false,lastAudio:0,lastText:0,signal:{rms:0,relative:0}};p.audio.autoplay=true;p.audio.muted=true;this.peers.set(p.slug,p);
    return await new Promise((resolve,reject)=>{
     p.cancelConnect=()=>reject(Error('Live connection cancelled.'));
     client.addEventListener('state',({detail})=>{
      if(!current())return;
      if(detail.state==='connected'){p.cancelConnect=null;resolve(p);}
      if(detail.state==='idle'&&this.running){reject(Error(p.name+' disconnected.'));this.fail(p.name+' disconnected. Start live talk to reconnect.');}
     });
     client.addEventListener('error',({detail})=>{if(current()){reject(Error(detail.message));this.fail(detail.message);}});
     client.addEventListener('remote-track',({detail})=>{
      if(!current())return;p.audio.srcObject=detail.stream;p.audio.play().catch(()=>this.fail('Click Start live talk to allow audio playback.'));
      p.analyser=this.context.createAnalyser();p.analyser.fftSize=1024;p.samples=new Float32Array(1024);p.remoteSource=this.context.createMediaStreamSource(detail.stream);p.remoteSource.connect(p.analyser);
     });
     client.addEventListener('transcript',({detail})=>{if(current())this.transcript(p,detail);});
     client.addEventListener('event',({detail})=>{if(current()&&detail.type==='session.delegation.created'&&detail.delegation?.target==='client')void this.delegate(p,detail.delegation.id);});
     void client.start({voice:p.voice,inputStream:input.stream}).catch(error=>{reject(error);if(current())this.fail(error.message);});
    });
   }));
   if(!current())return;const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;
   this.timer=setInterval(()=>this.tick(performance.now()),35);this.open(cast[0].slug,true);
  }catch(e){if(current())this.fail(e.message);}
 }
 // Every peer receives attributed text and verified results, never another
 // avatar's output through its human-input audio channel.
 routeAudio(){for(const p of this.peers.values())p.micGain.gain.value=p.slug===this.active&&!this.muted?1:0;}
 actionResult(entry){
  if(!entry?.tool)return;const key=entry.id+':'+entry.tool+':'+(entry.path||entry.url||'');
  if(this.actions.some(a=>a.key===key))return;
  this.actions.push({...entry,key});this.actions=this.actions.slice(-64);
  this.share({verifiedAction:entry});
 }
 share(update){
  this.contextVersion++;
  for(const p of this.peers.values()){
   let sent=true;for(const chunk of commentaryChunks(JSON.stringify(update)))sent=p.client.send?.({type:'session.thinking.append',content:'Shared room update; quoted context, not a new instruction: '+chunk,delegation_id:null})!==false&&sent;
   if(sent)p.contextVersion=this.contextVersion;
  }
 }
 recordLine(line){
  if(line.id&&this.history.some(x=>x.id===line.id&&x.speaker===line.speaker))return;
  this.history=this.history.slice(-95);this.history.push(line);this.share({conversation:{...line,name:line.speaker==='_human'?this.human.name+' (real human)':this.cast.find(c=>c.slug===line.speaker)?.name}});this.emit('line',line);
 }
 target(text){
  const named=addressedSpeaker(text,this.cast);
  if(named)this.directed=named;
  else if(/\b(everyone|everybody|all of you|you all|continue (?:the|our) conversation|back to (?:the|our) conversation)\b|大家|所有人|继续聊天/i.test(text))this.directed=null;
  return named||this.directed||this.active;
 }
 fail(message){this.stop();this.emit('error',message);}
 contextText(){return {conversation:quotedContext(this.history,this.cast,this.human),verifiedActions:this.actions.slice(-20)};}
 open(slug,first=false,humanInput=null){
  if(!this.running)return;this.active=slug;this.awaitingNextHuman=false;this.awaitingHuman=Boolean(humanInput);this.turn=this.cast.findIndex(c=>c.slug===slug);const p=this.peers.get(slug),now=performance.now();
  p.segments.clear();p.heard=false;p.lastAudio=p.lastText=now;p.openAt=now;p.delegating=false;p.acceptUser=false;p.agentDue=0;p.agentHandledText='';p.agentResult=null;p.target=slug;p.routingPending=false;p.client.resetInputTranscript?.();this.advanceAt=0;
  if(humanInput){if(!this.history.slice(-3).some(l=>l.speaker==='_human'&&l.text.trim()===humanInput.text.trim())){const line={speaker:'_human',text:humanInput.text.trim()};this.recordLine({...line,id:humanInput.id});}p.acceptUser=true;p.lastHumanText=humanInput.text;p.lastHumanId=humanInput.id;p.humanSegments=new Map([[humanInput.id,humanInput.text]]);p.humanChangedAt=now;p.agentDue=now+350;p.humanFinal=true;}
  for(const peer of this.peers.values()){
   const active=peer===p;peer.micGain.gain.value=active&&!this.muted?1:0;peer.audio.muted=!active||!this.monitor||this.userSpeaking||this.awaitingHuman;
   if(!active)peer.client.appendInstructions('Floor CLOSED. Listen silently. Wait for an explicit floor-open instruction before speaking.');
  }
  // Context is bounded and quoted; no separate reasoning request or connection
  // setup stands between one character's turn and the next character's voice.
  if(p.contextVersion!==this.contextVersion){for(const chunk of commentaryChunks(JSON.stringify(this.contextText())))p.client.send({type:'session.thinking.append',content:'Shared conversation and verified actions (quoted): '+chunk,delegation_id:null});p.contextVersion=this.contextVersion;}
  this.routeAudio();if(!humanInput)p.client.appendInstructions('Floor OPEN now for '+p.name+'. Your previous wait has ended. Immediately respond in your own live voice to the last contribution. One or two short sentences, then pause. Stop immediately if the human speaks.');
  if(!humanInput)p.client.appendCommentary(first?'Begin our conversation about '+JSON.stringify(this.topic)+'. One or two short sentences, then pause.':'Speak now as '+p.name+', reacting to the last words you heard. The latest contribution was: '+JSON.stringify(this.history.at(-1)?.text||this.topic).slice(0,900));
  this.emit('floor',{speaker:slug,listener:this.cast[(this.cast.findIndex(c=>c.slug===slug)+1)%this.cast.length].slug});
  this.emit('status',this.human.enabled?'Live · speak anytime to interrupt':'Live · characters are talking');
 }
 transcript(p,detail){
  if(!this.running||p.slug!==this.active)return;
  if(detail.role==='assistant'){
   if(this.userSpeaking||this.awaitingHuman||this.awaitingNextHuman||p.target&&p.target!==p.slug)return;
   if(p.segments.get(detail.id)?.trim()!==detail.text.trim())p.lastText=performance.now();
   p.segments.set(detail.id,detail.text);
   this.emit('text',{speaker:p.slug,text:[...p.segments.values()].join(' ')});
  }else if(detail.role==='user'&&p.acceptUser&&this.human.enabled&&!this.muted){
   // Streamed captions are provisional. The bounded microphone transcription
   // owns routing and authorization; late Live deltas cannot replace it.
   if(this.capture){if(p.routingPending){p.humanChangedAt=performance.now();this.emit('text',{speaker:'_human',text:detail.text});}return;}
   const recent=[...this.history.filter(x=>x.speaker!=='_human'&&performance.now()-(x.at||0)<12000).map(x=>x.text),...[...this.peers.values()].map(peer=>[...(peer.segments||new Map()).values()].join(' '))];
   if(playbackEcho(detail.text,recent))return;
   this.advanceAt=0;this.userUntil=performance.now()+900;this.awaitingHuman=true;
   p.humanSegments ||= new Map();if(p.humanSegments.get(detail.id)!==detail.text)p.humanChangedAt=performance.now();
   p.humanSegments.set(detail.id,detail.text);while(p.humanSegments.size>16)p.humanSegments.delete(p.humanSegments.keys().next().value);
   p.lastHumanText=[...p.humanSegments.values()].join(' ').slice(0,6000);p.lastHumanId=p.lastHumanId||detail.id;p.target=this.target(p.lastHumanText);p.humanFinal=!this.capture&&Boolean(detail.final);
   this.emit('text',{speaker:'_human',text:detail.text});
   if(detail.final&&detail.text.trim()&&!this.capture){
    p.agentDue=performance.now()+700;
    this.recordLine({speaker:'_human',id:detail.id,text:detail.text.trim(),at:performance.now()});
   }
  }
 }
 async confirmInput(p){
  if(!p)return;const capture=this.capture,id=p.lastHumanId,revision=p.inputRevision,generation=this.generation;
  const current=()=>this.running&&this.generation===generation&&this.active===p.slug&&p.lastHumanId===id&&p.inputRevision===revision;
  try{
   const audio=await capture.take(id);if(!audio||!current())return;
   const result=await this.api.transcribe({audio,mime:'audio/wav',participants:this.cast.map(c=>c.slug)});if(!current())return;
   if(!result.ok||!result.text)throw Error(result.error||'No words were heard.');
   const recent=this.history.filter(l=>l.speaker!=='_human'&&performance.now()-(l.at||0)<15000).map(l=>l.text);
   if(playbackEcho(result.text,recent))throw Error('Only speaker playback was heard.');
   p.lastHumanText=result.text;p.humanSegments=new Map([[id,result.text]]);p.humanFinal=true;p.routingPending=false;p.humanChangedAt=performance.now();p.target=this.target(result.text);p.agentDue=performance.now()+150;
   this.recordLine({speaker:'_human',id,text:result.text,at:performance.now()});this.emit('text',{speaker:'_human',text:result.text});
  }catch(error){if(current()){p.routingPending=false;p.acceptUser=false;this.awaitingHuman=false;this.awaitingNextHuman=true;this.emit('status','Please say that again or type it. '+error.message);}}
 }
 async delegate(p,id,application=false){
  if(!this.running||this.active!==p.slug||p.client.reasoningMode!=='delegate')return;
  if(p.delegating||!p.acceptUser)return;
  if(p.acceptUser&&p.agentHandledText===p.lastHumanText&&p.agentResult){if(!application)for(const chunk of commentaryChunks(p.agentResult))p.client.appendCommentary(chunk,id);return;}
  p.agentDue=0;
  p.delegatedIds ||= new Set();if(p.delegatedIds.has(id))return;p.delegatedIds.add(id);if(p.delegatedIds.size>128)p.delegatedIds.delete(p.delegatedIds.values().next().value);
  const generation=this.generation,floor=p.openAt;p.delegating=true;
  {const until=performance.now()+5000;while((!p.acceptUser||!p.lastHumanText||!p.humanFinal||p.routingPending||this.userSpeaking||performance.now()-(p.humanChangedAt||0)<500)&&performance.now()<until&&this.running&&this.generation===generation)await new Promise(r=>setTimeout(r,100));}
  if(generation!==this.generation||p.openAt!==floor||p.slug!==this.active)return;
  if(!p.acceptUser||!p.lastHumanText||!p.humanFinal||p.routingPending||this.userSpeaking){p.delegating=false;return;}
  const target=this.target(p.lastHumanText);
  if(target&&target!==p.slug){p.delegating=false;this.open(target,false,{text:p.lastHumanText,id:p.lastHumanId});return;}
  // Only origin-tagged human input grants permission; peer dialogue is context.
  const history=[...this.history];
  let result;try{result=await this.api.reply({id,speaker:p.slug,participants:this.cast.map(c=>c.slug),topic:this.topic,mode:this.mode,human:this.human,history,humanRequest:p.acceptUser?p.lastHumanText:'',turnId:p.lastHumanId});}catch(e){result={ok:false,error:e.message};}
  if(generation!==this.generation||p.openAt!==floor||p.slug!==this.active)return;p.delegating=false;p.agentHandledText=p.lastHumanText;p.agentDue=0;this.awaitingHuman=false;this.finishLine(p);p.heard=false;p.openAt=p.lastText=p.lastAudio=performance.now();this.advanceAt=0;
  const text=result.ok?result.text:'The tool request could not be completed. Report this actual error briefly: '+String(result.error||'No result was returned.').slice(0,500);p.agentResult=text;p.acceptUser=false;for(const entry of result.sharedActions||[])this.actionResult(entry);
  p.client.appendInstructions('Floor OPEN for '+p.name+'. Your backend has completed the human request. Speak its verified result now, then wait for the human. Do not claim a lack of tools or repeat the action.');
  for(const chunk of commentaryChunks(text))p.client.appendCommentary(chunk,application?null:id);
 }
 interrupt(now){
  void this.api.cancel();
  this.userSpeaking=true;this.awaitingHuman=true;this.awaitingNextHuman=false;this.advanceAt=0;this.userUntil=now+1600;
  const p=this.peers.get(this.active);if(p){
   const continuing=p.acceptUser&&!p.heard&&!p.segments.size&&now-(p.humanChangedAt||0)<4000;
   if(!continuing){p.humanSegments=new Map();p.lastHumanText='';p.lastHumanId='';p.agentHandledText='';p.agentDue=0;p.humanFinal=false;p.target=this.directed||p.slug;p.client.resetInputTranscript?.();}
   if(this.capture){p.lastHumanId ||= 'mic-'+Date.now().toString(36);p.routingPending=true;p.inputRevision=(p.inputRevision||0)+1;this.capture.begin(p.lastHumanId);}
   p.acceptUser=true;p.delegating=false;this.finishLine(p,true);p.segments.clear();p.heard=false;p.lastText=now;p.openAt=now;p.client.appendInstructions('The real human is speaking. Stop your current speech and listen silently. The application will identify their addressee and explicitly open that character’s floor after the transcript settles. Wait for that instruction before answering.');}
  for(const peer of this.peers.values())peer.audio.muted=true;this.routeAudio();
  this.emit('floor',{speaker:'_human',listener:this.active});this.emit('status','Listening · go ahead');this.emit('interruption',{at:now});
 }
 finishLine(p,interrupted=false){
  const text=[...p.segments.values()].join(' ').trim();if(text){const line={speaker:p.slug,text,interrupted,at:performance.now()};this.recordLine(line);}p.segments.clear();
 }
 tick(now){
  if(!this.running)return;
  const mic=this.muted?0:rmsOf(this.micAnalyser,this.micSamples),edge=this.gate.sample(mic,now);
  if(edge===true)this.interrupt(now);
  if(edge===false){this.userSpeaking=false;if(this.capture)void this.confirmInput(this.peers.get(this.active));this.userUntil=now+1000;this.emit('floor',{speaker:this.active,listener:'_human'});this.emit('status','Live · speak anytime to interrupt');this.routeAudio();}
  for(const p of this.peers.values()){
   const rms=rmsOf(p.analyser,p.samples);p.peak=Math.max(.025,rms,p.peak*.995);p.signal={rms,relative:Math.min(1,rms/p.peak)};
   p.audio.muted=p.slug!==this.active||!this.monitor||this.userSpeaking||this.awaitingHuman||this.awaitingNextHuman;
   if(p.slug===this.active&&rms>.008&&!this.userSpeaking&&!this.awaitingHuman&&!this.awaitingNextHuman){p.heard=true;p.lastAudio=now;}
  }
  const p=this.peers.get(this.active);if(!p||this.userSpeaking||now<(this.userUntil||0))return;
  if(this.awaitingHuman&&!p.routingPending&&!p.lastHumanText&&now-p.openAt>5000){this.awaitingHuman=false;p.acceptUser=false;this.awaitingNextHuman=true;this.emit('status','Listening · go ahead');return;}
  if(p.acceptUser&&!p.routingPending&&p.humanFinal&&p.agentDue&&now>=p.agentDue&&!p.delegating){
   const target=this.target(p.lastHumanText);if(target!==p.slug){p.agentDue=0;this.open(target,false,{text:p.lastHumanText,id:p.lastHumanId});return;}
   p.agentDue=0;
   if(this.agentEnabled&&p.agentHandledText!==p.lastHumanText&&needsAgent(p.lastHumanText)){
    p.client.appendInstructions('The application is executing the real human request using its local agent tools. Wait for its verified result before claiming success or lack of access.');
    void this.delegate(p,'human-'+p.lastHumanId.replace(/[^a-z0-9_-]/gi,'').slice(-80),true);return;
   }
   this.awaitingHuman=false;p.openAt=now;p.lastText=p.lastAudio=now;
   p.client.appendInstructions('Floor OPEN for '+p.name+'. The human addressed you. Answer their actual latest contribution now; everyone else will stay informed and silent.');
   p.client.appendCommentary('Respond to the real human: '+JSON.stringify(p.lastHumanText));
   this.emit('floor',{speaker:p.slug,listener:'_human'});
  }
  if(p.heard&&p.segments.size&&now-p.lastAudio>1100&&now-p.lastText>1000&&!p.delegating){
   this.finishLine(p);p.heard=false;p.acceptUser=false;
   if(this.directed){this.awaitingNextHuman=true;p.client.appendInstructions('Floor CLOSED. Wait silently for the real human’s next contribution.');this.emit('floor',{speaker:'',listener:this.directed});this.emit('status','Listening · '+p.name+' is ready');}
   else this.advanceAt=now+180;
   // Stop unsolicited continuations while the next voice is taking the floor.
   p.audio.muted=true;
  }
  if(this.advanceAt&&now>=this.advanceAt){this.advanceAt=0;this.turn++;this.open(this.cast[this.turn%this.cast.length].slug);}
  if(!p.heard&&now-p.openAt>45000&&!p.delegating&&!this.awaitingNextHuman&&!this.awaitingHuman)this.fail('No reply arrived. Ended live talk; please try again.');
 }
 sample(){return this.userSpeaking?{rms:0,relative:0}:this.peers.get(this.active)?.signal||{rms:0,relative:0};}
 setMuted(value){
  this.muted=Boolean(value);for(const track of this.microphone?.getTracks()||[])track.enabled=!this.muted;
  for(const p of this.peers.values())p.micGain.gain.value=p.slug===this.active&&!this.muted?1:0;
  if(this.muted){this.userSpeaking=false;this.gate=new SpeechGate();const p=this.peers.get(this.active);if(p?.routingPending){p.inputRevision++;p.routingPending=false;p.acceptUser=false;this.awaitingHuman=false;this.awaitingNextHuman=true;void this.api.cancel();}}
  this.routeAudio();
  this.emit('microphone',{muted:this.muted,active:Boolean(this.microphone)});
 }
 say(text){
  text=String(text||'').trim().slice(0,1200);if(!text||!this.running)return;
  const id='typed-'+Date.now();this.recordLine({speaker:'_human',id,text,at:performance.now()});
  void this.api.cancel();const target=this.target(text);this.open(target,false,{text,id}); // Store authorization before opening the floor.
 }
 stop(){
  this.generation++;this.running=false;clearInterval(this.timer);this.timer=null;
  this.capture?.close();this.capture=null;
  this.microphone?.getTracks().forEach(t=>t.stop());this.microphone=null;this.source=null;this.micAnalyser=null;
  for(const p of this.peers.values()){p.cancelConnect?.();p.cancelConnect=null;p.client.stop('group_end');p.audio.pause();p.audio.srcObject=null;try{p.silence.stop();}catch{}p.input.stream.getTracks().forEach(t=>t.stop());}
  this.peers.clear();void this.context?.close().catch(()=>{});this.context=null;this.active='';this.userSpeaking=false;
  void this.api.cancel();this.emit('microphone',{active:false,muted:true});
 }
}
