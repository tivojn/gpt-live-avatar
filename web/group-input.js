// The microphone exists only for an explicit, bounded human turn. A recording
// becomes an editable draft; it never sends a conversation reply on its own.
export class GroupMicrophone {
 constructor(api,{onState=()=>{},onText=()=>{},onError=()=>{}}={}){Object.assign(this,{api,onState,onText,onError,generation:0,state:'idle'});}
 setState(state,seconds=0){this.state=state;this.onState(state,seconds);}
 release(){clearInterval(this.timer);this.timer=null;for(const track of this.stream?.getTracks()||[]){track.onended=null;track.stop();}this.stream=null;}
 cancel(){const pending=this.state==='transcribing';this.generation++;if(this.recorder){this.recorder.onstop=null;this.recorder.ondataavailable=null;if(this.recorder.state!=='inactive')this.recorder.stop();this.recorder=null;}this.release();this.setState('idle');if(pending)void this.api.cancel();}
 finish(){if(this.recorder?.state==='recording'){this.recorder.stop();this.release();}}
 async start(){
  if(this.state!=='idle')return;this.cancel();const generation=this.generation,current=()=>generation===this.generation;this.setState('requesting');
  try{
   const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
   if(!current()){stream.getTracks().forEach(t=>t.stop());return;}this.stream=stream;
   const mime=['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(t=>MediaRecorder.isTypeSupported(t));if(!mime)throw Error('Microphone recording is unavailable. You can still type your reply.');
   const recorder=this.recorder=new MediaRecorder(stream,{mimeType:mime,audioBitsPerSecond:64000}),chunks=[];let size=0;
   recorder.ondataavailable=e=>{if(current()&&e.data.size){chunks.push(e.data);size+=e.data.size;if(size>4*1024*1024)this.finish();}};
   recorder.onerror=()=>{if(current()){this.cancel();this.onError('The microphone recording failed. Please try again or type your reply.');}};
   recorder.onstop=async()=>{if(!current())return;this.recorder=null;this.release();this.setState('transcribing');try{
    if(size>4*1024*1024)throw Error('That recording is too long. Please try a shorter reply.');
    const audio=new Uint8Array(await new Blob(chunks,{type:mime}).arrayBuffer());if(!current())return;
    const result=await this.api.transcribe({audio,mime});if(!current())return;if(!result.ok)throw Error(result.error||'Could not transcribe your reply.');
    this.onText(result.text);this.setState('idle');
   }catch(e){if(current()){this.setState('idle');this.onError(e.message);}}};
   for(const track of stream.getAudioTracks())track.onended=()=>{if(current())this.finish();};
   recorder.start(250);const started=performance.now();this.setState('recording');this.timer=setInterval(()=>{const seconds=Math.floor((performance.now()-started)/1000);this.setState('recording',seconds);if(seconds>=60)this.finish();},250);
  }catch(e){if(current()){this.cancel();this.onError(e.name==='NotAllowedError'?'Microphone access is unavailable. Allow it in macOS Privacy settings, or type your reply.':e.message);}}
 }
}
