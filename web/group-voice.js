import {LiveClient} from '/live-client.js';
import {SpeechOutput,silentSpeech} from '/lip-sync.js';
// One playback at a time. End-of-turn is based on received audio and transcript
// quiet, never on a context-injection acknowledgement. The next cue's session is
// opened while the current line is still playing, because a staged show should
// not stand silent for several seconds of connection setup between every line.
const CUE='Speak the prepared line now, following the session instructions, then stay silent.';
const plain=value=>String(value||'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export class GroupVoice {
 constructor(api){this.api=api;this.client=null;this.signal={rms:0,relative:0};this.generation=0;this.transcript='';this.warm=null;}
 // Ending a line cancels that line's request only: the next line may already be
 // connecting, and the show's own reasoning requests are none of its business.
 stop({keepWarm=false}={}){this.generation++;this.finish?.(new Error('Conversation stopped.'));this.finish=null;this.client?.stop('group_stop');this.client=null;this.output?.close();this.output=null;void this.context?.close();this.context=null;this.analyser=null;this.signal={rms:0,relative:0};if(!keepWarm)this.dropWarm();void this.api.cancel({scope:'voice',slot:'speak'});}
 // A full stop also drops whatever was being warmed up for the next cue.
 stopAll(){this.dropWarm();this.generation++;this.finish?.(new Error('Conversation stopped.'));this.finish=null;this.client?.stop('group_stop');this.client=null;this.output?.close();this.output=null;void this.context?.close();this.context=null;this.analyser=null;this.signal={rms:0,relative:0};void this.api.cancel();}
 sample(){this.signal=this.output?.sample()||silentSpeech();if(this.signal.rms>.008){this.heard=true;this.lastAudio=performance.now();}return this.signal;}
 cueKey(text,voice,delivery,context){return JSON.stringify([voice||'',delivery||'',context||null,String(text||'')]);}
 dropWarm(reason='group_warm_drop'){const warm=this.warm;this.warm=null;if(warm){try{warm.client.stop(reason);}catch{}}}
 // Connect the session for a line that has not been reached yet. The voice is
 // told to wait for its cue, so nothing is spoken until speak() asks for it.
 prepare(text,voice,delivery='',context=null){
  if(!String(text||'').trim()||!voice)return;
  const key=this.cueKey(text,voice,delivery,context);
  if(this.warm?.key===key)return;
  this.dropWarm();
  const warm={key,segments:new Map(),transcript:'',connected:false,dead:false,error:null,track:null};
  warm.client=new LiveClient({createSession:sdp=>this.api.voice({sdp,voice,text,delivery,context,slot:'prepare'})});
  warm.client.addEventListener('remote-track',({detail})=>{warm.track=detail.stream;});
  warm.client.addEventListener('transcript',({detail})=>{if(detail.role!=='assistant')return;warm.segments.set(detail.id,detail.text);warm.transcript=[...warm.segments.values()].join(' ');});
  warm.client.addEventListener('state',({detail})=>{if(detail.state==='connected')warm.connected=true;else if(detail.state==='idle')warm.dead=true;});
  warm.client.addEventListener('error',({detail})=>{warm.error=new Error(detail.message);});
  this.warm=warm;
  try{Promise.resolve(warm.client.start({receiveOnly:true,voice})).catch(error=>{warm.error=error;});}
  catch(error){warm.error=error;}
 }
 async speak(text,voice,onText,delivery='',context=null){
  const key=this.cueKey(text,voice,delivery,context),warm=this.warm;
  // A session that spoke before its cue cannot be trusted with the line.
  const ready=Boolean(warm&&warm.key===key&&warm.connected&&!warm.dead&&!warm.error&&!plain(warm.transcript));
  if(ready)this.warm=null;
  this.stop({keepWarm:true});const generation=this.generation;this.heard=false;this.lastAudio=0;this.lastText=performance.now();this.transcript='';this.peak=.025;
  const client=this.client=ready?warm.client:new LiveClient({createSession:(sdp)=>this.api.voice({sdp,voice,text,delivery,context,slot:'speak'})});
  const expected=plain(text);
  return new Promise((resolve,reject)=>{
   let done=false,timer,deadline;const complete=error=>{if(done)return;done=true;clearInterval(timer);clearTimeout(deadline);this.finish=null;client.stop('group_turn_end');this.client=null;this.output?.close();this.output=null;void this.context?.close();this.context=null;this.analyser=null;this.signal={rms:0,relative:0};error?reject(error):resolve(this.transcript.trim());};this.finish=complete;
   const attach=stream=>{if(generation!==this.generation||done)return;this.context=new AudioContext();this.output=new SpeechOutput(this.context,{onError:message=>this.onWarning?.(message)});this.output.attach(stream);this.onStream?.(stream);void this.context.resume().catch(()=>complete(Error('Click Start to allow playback.')));};
   client.addEventListener('remote-track',({detail})=>attach(detail.stream));
   const segments=new Map();client.addEventListener('transcript',({detail})=>{if(generation!==this.generation||detail.role!=='assistant')return;segments.set(detail.id,detail.text);this.transcript=[...segments.values()].join(' ');this.lastText=performance.now();onText?.(this.transcript);});
   client.addEventListener('state',({detail})=>{if(done||generation!==this.generation)return;if(detail.state==='connected'){this.onConnected?.();client.appendCommentary(CUE);}else if(detail.state==='idle')complete(new Error('The voice connection ended before the turn finished.'));});
   client.addEventListener('error',({detail})=>complete(new Error(detail.message)));
   timer=setInterval(()=>{
    this.sample();const now=performance.now();
    if(!this.heard||!this.transcript)return;
    // Once the whole line has been delivered, the long guard against a
    // mid-sentence pause is just dead air before the next cue.
    const said=plain(this.transcript),full=expected?said.length>=expected.length*.85:false;
    const quiet=full?800:2200;
    if(now-this.lastAudio>quiet&&now-this.lastText>quiet)complete();
   },100);
   deadline=setTimeout(()=>complete(new Error(this.heard?'The voice did not finish its turn. Please try again.':'No spoken audio arrived. Check the voice API key in Settings.')),40000);
   if(ready){this.onConnected?.();if(warm.track)attach(warm.track);client.appendCommentary(CUE);}
   else void client.start({receiveOnly:true,voice});
  });
 }
}
