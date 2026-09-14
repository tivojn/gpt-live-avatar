import {LiveClient} from '/live-client.js';
import {commentaryChunks} from '/delegate-client.js';

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
 constructor(api,callbacks={}){this.api=api;this.callbacks=callbacks;this.generation=0;this.peers=new Map();this.history=[];this.active='';this.running=false;this.muted=false;}
 emit(type,detail){this.callbacks[type]?.(detail);}
 async start({cast,topic,mode,human,inputStream=null,monitor=true}){
  this.stop();const generation=this.generation,current=()=>generation===this.generation;
  Object.assign(this,{cast,topic,mode,human,monitor,running:true,history:[],turn:0,active:'',userSpeaking:false,muted:false,gate:new SpeechGate()});
  try{
   this.context=new AudioContext();await this.context.resume();if(!current())return;
   if(human.enabled){
    const stream=inputStream?new MediaStream(inputStream.getAudioTracks().map(t=>t.clone())):await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
    if(!current()){stream.getTracks().forEach(t=>t.stop());return;}
    this.microphone=stream;this.source=this.context.createMediaStreamSource(stream);this.micAnalyser=this.context.createAnalyser();this.micAnalyser.fftSize=1024;this.micSamples=new Float32Array(1024);this.source.connect(this.micAnalyser);
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
      p.analyser=this.context.createAnalyser();p.analyser.fftSize=1024;p.samples=new Float32Array(1024);p.remoteSource=this.context.createMediaStreamSource(detail.stream);p.remoteSource.connect(p.analyser);p.routes=new Map();
      for(const other of this.peers.values()){this.linkAudio(p,other);this.linkAudio(other,p);}
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
 linkAudio(from,to){
  if(from===to||!from.remoteSource||from.routes.has(to.slug))return;
  const gain=this.context.createGain();gain.gain.value=0;from.remoteSource.connect(gain);gain.connect(to.input);from.routes.set(to.slug,gain);
 }
 routeAudio(){
  for(const p of this.peers.values())for(const [slug,gain] of p.routes||[])gain.gain.value=p.slug===this.active&&slug!==this.active&&!this.userSpeaking?1:0;
 }
 fail(message){this.stop();this.emit('error',message);}
 contextText(){return this.history.slice(-6).map(x=>`${this.cast.find(c=>c.slug===x.speaker)?.name||this.human.name}: ${x.text}`).join('\n').slice(-1400);}
 open(slug,first=false){
  if(!this.running)return;this.active=slug;const p=this.peers.get(slug),now=performance.now();
  p.segments.clear();p.heard=false;p.lastAudio=p.lastText=now;p.openAt=now;p.delegating=false;p.acceptUser=false;this.advanceAt=0;
  for(const peer of this.peers.values()){
   const active=peer===p;peer.micGain.gain.value=active&&!this.muted?1:0;peer.audio.muted=!active||!this.monitor||this.userSpeaking;
   if(!active)peer.client.appendInstructions('Floor CLOSED. Listen silently. Wait for an explicit floor-open instruction before speaking.');
  }
  // Context is bounded and quoted; no separate reasoning request or connection
  // setup stands between one character's turn and the next character's voice.
  for(const chunk of commentaryChunks(JSON.stringify(this.contextText())))p.client.send({type:'session.thinking.append',content:'Actual conversation (quoted): '+chunk,delegation_id:null});
  this.routeAudio();p.client.appendInstructions('Floor OPEN now for '+p.name+'. Your previous wait has ended. Immediately respond in your own live voice to the last contribution. One or two short sentences, then pause. Stop immediately if the human speaks.');
  p.client.appendCommentary(first?'Begin our conversation about '+JSON.stringify(this.topic)+'. One or two short sentences, then pause.':'Speak now as '+p.name+', reacting to the last words you heard. The latest contribution was: '+JSON.stringify(this.history.at(-1)?.text||this.topic).slice(0,900));
  this.emit('floor',{speaker:slug,listener:this.cast[(this.cast.findIndex(c=>c.slug===slug)+1)%this.cast.length].slug});
  this.emit('status',this.human.enabled?'Live · speak anytime to interrupt':'Live · characters are talking');
 }
 transcript(p,detail){
  if(!this.running||p.slug!==this.active)return;
  if(detail.role==='assistant'){
   if(this.userSpeaking)return;
   if(p.segments.get(detail.id)?.trim()!==detail.text.trim())p.lastText=performance.now();
   p.segments.set(detail.id,detail.text);
   this.emit('text',{speaker:p.slug,text:[...p.segments.values()].join(' ')});
  }else if(detail.role==='user'&&p.acceptUser&&this.human.enabled&&!this.muted){
   this.advanceAt=0;this.userUntil=performance.now()+1600;
   p.humanSegments ||= new Map();if(p.humanSegments.get(detail.id)!==detail.text)p.humanChangedAt=performance.now();
   p.humanSegments.set(detail.id,detail.text);while(p.humanSegments.size>16)p.humanSegments.delete(p.humanSegments.keys().next().value);
   p.lastHumanText=[...p.humanSegments.values()].join(' ').slice(0,6000);p.lastHumanId=detail.id;
   this.emit('text',{speaker:'_human',text:detail.text});
   if(detail.final&&detail.text.trim()){
    this.history=this.history.slice(-95);this.history.push({speaker:'_human',text:detail.text.trim()});this.emit('line',this.history.at(-1));
    if(!p.delegating&&!p.heard&&!this.userSpeaking){p.client.appendCommentary('Respond now to the human contribution you just heard, briefly and naturally.');p.openAt=performance.now();}
   }
  }
 }
 async delegate(p,id){
  if(!this.running||this.active!==p.slug||p.client.reasoningMode!=='delegate')return;
  p.delegatedIds ||= new Set();if(p.delegatedIds.has(id))return;p.delegatedIds.add(id);if(p.delegatedIds.size>128)p.delegatedIds.delete(p.delegatedIds.values().next().value);
  const generation=this.generation,floor=p.openAt;p.delegating=true;
  if(p.acceptUser){const until=performance.now()+1800;while((!p.lastHumanText||performance.now()-(p.humanChangedAt||0)<350)&&performance.now()<until&&this.running&&this.generation===generation)await new Promise(r=>setTimeout(r,100));}
  if(generation!==this.generation||p.openAt!==floor||p.slug!==this.active)return;
  const history=[...this.history,...p.client.conversation().filter(x=>x.role==='user').slice(-1).map(x=>({speaker:'_human',text:x.text}))];
  let result;try{result=await this.api.reply({id,speaker:p.slug,participants:this.cast.map(c=>c.slug),topic:this.topic,mode:this.mode,human:this.human,history,humanRequest:p.acceptUser?p.lastHumanText:'',turnId:p.lastHumanId});}catch(e){result={ok:false,error:e.message};}
  if(generation!==this.generation||p.openAt!==floor||p.slug!==this.active)return;p.delegating=false;
  const text=result.ok?result.text:'The reasoning connection failed. Say briefly that you could not complete that request.';
  for(const chunk of commentaryChunks(text))p.client.appendCommentary(chunk,id);
 }
 interrupt(now){
  void this.api.cancel();
  this.userSpeaking=true;this.advanceAt=0;this.userUntil=now+1600;
  const p=this.peers.get(this.active);if(p){
   const continuing=p.acceptUser&&!p.heard&&!p.segments.size&&now-(p.humanChangedAt||0)<4000;
   if(!continuing){p.humanSegments=new Map();p.lastHumanText='';p.lastHumanId='';}
   p.acceptUser=true;p.delegating=false;this.finishLine(p,true);p.segments.clear();p.heard=false;p.lastText=now;p.openAt=now;p.client.appendInstructions('The human is interrupting. Pause your current speech immediately, listen, then answer their actual contribution when they finish. Your speaking floor remains open.');}
  for(const peer of this.peers.values())peer.audio.muted=true;this.routeAudio();
  this.emit('floor',{speaker:'_human',listener:this.active});this.emit('status','Listening · go ahead');this.emit('interruption',{at:now});
 }
 finishLine(p,interrupted=false){
  const text=[...p.segments.values()].join(' ').trim();if(text){const line={speaker:p.slug,text,interrupted};this.history=this.history.slice(-95);this.history.push(line);this.emit('line',line);}p.segments.clear();
 }
 tick(now){
  if(!this.running)return;
  const mic=this.muted?0:rmsOf(this.micAnalyser,this.micSamples),edge=this.gate.sample(mic,now);
  if(edge===true)this.interrupt(now);
  if(edge===false){this.userSpeaking=false;this.userUntil=now+1000;this.emit('floor',{speaker:this.active,listener:'_human'});this.emit('status','Live · speak anytime to interrupt');this.routeAudio();}
  for(const p of this.peers.values()){
   const rms=rmsOf(p.analyser,p.samples);p.peak=Math.max(.025,rms,p.peak*.995);p.signal={rms,relative:Math.min(1,rms/p.peak)};
   p.audio.muted=p.slug!==this.active||!this.monitor||this.userSpeaking;
   if(p.slug===this.active&&rms>.008&&!this.userSpeaking){p.heard=true;p.lastAudio=now;}
  }
  const p=this.peers.get(this.active);if(!p||this.userSpeaking||now<(this.userUntil||0))return;
  if(p.heard&&p.segments.size&&now-p.lastAudio>1100&&now-p.lastText>1000&&!p.delegating){
   this.finishLine(p);p.heard=false;this.advanceAt=now+180;
   // Stop unsolicited continuations while the next voice is taking the floor.
   p.audio.muted=true;
  }
  if(this.advanceAt&&now>=this.advanceAt){this.advanceAt=0;this.turn++;this.open(this.cast[this.turn%this.cast.length].slug);}
  if(!p.heard&&now-p.openAt>45000&&!p.delegating)this.fail('No reply arrived. Ended live talk; please try again.');
 }
 sample(){return this.userSpeaking?{rms:0,relative:0}:this.peers.get(this.active)?.signal||{rms:0,relative:0};}
 setMuted(value){
  this.muted=Boolean(value);for(const track of this.microphone?.getTracks()||[])track.enabled=!this.muted;
  for(const p of this.peers.values())p.micGain.gain.value=p.slug===this.active&&!this.muted?1:0;
  if(this.muted){this.userSpeaking=false;this.gate=new SpeechGate();}
  this.routeAudio();
  this.emit('microphone',{muted:this.muted,active:Boolean(this.microphone)});
 }
 say(text){
  text=String(text||'').trim().slice(0,1200);if(!text||!this.running)return;
  this.history=this.history.slice(-95);this.history.push({speaker:'_human',text});this.emit('line',this.history.at(-1));
  this.open(this.active);const peer=this.peers.get(this.active);if(peer){peer.acceptUser=true;peer.lastHumanText=text;peer.lastHumanId='typed-'+Date.now();peer.humanSegments=new Map([[peer.lastHumanId,text]]);peer.humanChangedAt=performance.now();} // Explicit typed interruption, using the same live voice.
 }
 stop(){
  this.generation++;this.running=false;clearInterval(this.timer);this.timer=null;
  this.microphone?.getTracks().forEach(t=>t.stop());this.microphone=null;this.source=null;this.micAnalyser=null;
  for(const p of this.peers.values()){p.cancelConnect?.();p.cancelConnect=null;p.client.stop('group_end');p.audio.pause();p.audio.srcObject=null;try{p.silence.stop();}catch{}p.input.stream.getTracks().forEach(t=>t.stop());}
  this.peers.clear();void this.context?.close().catch(()=>{});this.context=null;this.active='';this.userSpeaking=false;
  void this.api.cancel();this.emit('microphone',{active:false,muted:true});
 }
}
