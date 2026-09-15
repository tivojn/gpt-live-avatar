import {LiveClient} from '/live-client.js';
import {SpeechOutput,silentSpeech} from '/lip-sync.js';
// One playback at a time. End-of-turn is based on received audio and transcript
// quiet, never on a context-injection acknowledgement.
export class GroupVoice {
 constructor(api){this.api=api;this.client=null;this.signal={rms:0,relative:0};this.generation=0;this.transcript='';}
 stop(){this.generation++;this.finish?.(new Error('Conversation stopped.'));this.finish=null;this.client?.stop('group_stop');this.client=null;this.output?.close();this.output=null;void this.context?.close();this.context=null;this.analyser=null;this.signal={rms:0,relative:0};void this.api.cancel();}
 sample(){this.signal=this.output?.sample()||silentSpeech();if(this.signal.rms>.008){this.heard=true;this.lastAudio=performance.now();}return this.signal;}
 async speak(text,voice,onText){
  this.stop();const generation=this.generation;this.heard=false;this.lastAudio=0;this.lastText=performance.now();this.transcript='';this.peak=.025;
  const client=this.client=new LiveClient({createSession:(sdp)=>this.api.voice({sdp,voice,text})});
  return new Promise((resolve,reject)=>{
   let done=false,timer,deadline;const complete=error=>{if(done)return;done=true;clearInterval(timer);clearTimeout(deadline);this.finish=null;client.stop('group_turn_end');this.client=null;this.output?.close();this.output=null;void this.context?.close();this.context=null;this.analyser=null;this.signal={rms:0,relative:0};error?reject(error):resolve(this.transcript.trim());};this.finish=complete;
   client.addEventListener('remote-track',({detail})=>{if(generation!==this.generation)return;this.context=new AudioContext();this.output=new SpeechOutput(this.context,{onError:message=>this.onWarning?.(message)});this.output.attach(detail.stream);void this.context.resume().catch(()=>complete(Error('Click Start to allow playback.')));});
   const segments=new Map();client.addEventListener('transcript',({detail})=>{if(generation!==this.generation||detail.role!=='assistant')return;segments.set(detail.id,detail.text);this.transcript=[...segments.values()].join(' ');this.lastText=performance.now();onText?.(this.transcript);});
   client.addEventListener('state',({detail})=>{if(done||generation!==this.generation)return;if(detail.state==='connected'){this.onConnected?.();client.appendCommentary('Speak the prepared line now, following the session instructions, then stay silent.');}else if(detail.state==='idle')complete(new Error('The voice connection ended before the turn finished.'));});
   client.addEventListener('error',({detail})=>complete(new Error(detail.message)));
   timer=setInterval(()=>{this.sample();const now=performance.now();if(this.heard&&this.transcript&&now-this.lastAudio>2200&&now-this.lastText>2200)complete();},100);
   deadline=setTimeout(()=>complete(new Error(this.heard?'The voice did not finish its turn. Please try again.':'No spoken audio arrived. Check the voice API key in Settings.')),40000);
   void client.start({receiveOnly:true,voice});
  });
 }
}
