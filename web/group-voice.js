import {LiveClient} from '/live-client.js';
// One playback at a time. End-of-turn is based on received audio and transcript
// quiet, never on a context-injection acknowledgement.
export class GroupVoice {
 constructor(api){this.api=api;this.client=null;this.audio=new Audio();this.audio.autoplay=true;this.signal={rms:0,relative:0};this.generation=0;this.transcript='';}
 stop(){this.generation++;this.finish?.(new Error('Conversation stopped.'));this.finish=null;this.client?.stop('group_stop');this.client=null;this.audio.pause();this.audio.srcObject=null;void this.context?.close();this.context=null;this.analyser=null;this.signal={rms:0,relative:0};void this.api.cancel();}
 sample(){if(!this.analyser)return this.signal;this.analyser.getByteTimeDomainData(this.samples);let sum=0;for(const v of this.samples)sum+=((v-128)/128)**2;const rms=Math.sqrt(sum/this.samples.length);this.peak=Math.max(.025,rms,this.peak*.995);this.signal={rms,relative:Math.min(1,rms/this.peak)};if(rms>.008){this.heard=true;this.lastAudio=performance.now();}return this.signal;}
 async speak(text,voice,onText){
  this.stop();const generation=this.generation;this.heard=false;this.lastAudio=0;this.lastText=performance.now();this.transcript='';this.peak=.025;
  const client=this.client=new LiveClient({createSession:(sdp)=>this.api.voice({sdp,voice,text})});
  return new Promise((resolve,reject)=>{
   let done=false,timer,deadline;const complete=error=>{if(done)return;done=true;clearInterval(timer);clearTimeout(deadline);this.finish=null;client.stop('group_turn_end');this.client=null;this.audio.pause();this.audio.srcObject=null;void this.context?.close();this.context=null;this.analyser=null;this.signal={rms:0,relative:0};error?reject(error):resolve(this.transcript.trim());};this.finish=complete;
   client.addEventListener('remote-track',({detail})=>{if(generation!==this.generation)return;this.audio.srcObject=detail.stream;this.audio.play().catch(()=>complete(new Error('Click Start to allow audio playback.')));this.context=new AudioContext();this.analyser=this.context.createAnalyser();this.analyser.fftSize=1024;this.samples=new Uint8Array(1024);this.context.createMediaStreamSource(detail.stream).connect(this.analyser);void this.context.resume();});
   const segments=new Map();client.addEventListener('transcript',({detail})=>{if(generation!==this.generation||detail.role!=='assistant')return;segments.set(detail.id,detail.text);this.transcript=[...segments.values()].join(' ');this.lastText=performance.now();onText?.(this.transcript);});
   client.addEventListener('state',({detail})=>{if(done||generation!==this.generation)return;if(detail.state==='connected'){client.appendCommentary('Speak the prepared line now, following the session instructions, then stay silent.');}else if(detail.state==='idle')complete(new Error('The voice connection ended before the turn finished.'));});
   client.addEventListener('error',({detail})=>complete(new Error(detail.message)));
   timer=setInterval(()=>{this.sample();const now=performance.now();if(this.heard&&this.transcript&&now-this.lastAudio>2200&&now-this.lastText>2200)complete();},100);
   deadline=setTimeout(()=>complete(new Error(this.heard?'The voice did not finish its turn. Please try again.':'No spoken audio arrived. Check the voice API key in Settings.')),40000);
   void client.start({receiveOnly:true,voice});
  });
 }
}
