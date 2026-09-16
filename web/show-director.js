import {LiveClient} from '/live-client.js';
import {SpeechOutput} from '/lip-sync.js';
import {DelegateClient,commentaryChunks} from '/delegate-client.js';
// The Director's live voice: one persistent GPT-Live session with the
// microphone. It briefs the show, listens for the human's lines during the
// performance (floor closed) and collects feedback afterwards. Complex
// questions are delegated to the reasoning account through the app.
export class DirectorVoice {
 constructor(api,callbacks={}){this.api=api;this.callbacks=callbacks;this.generation=0;this.running=false;this.muted=false;this.floorOpen=true;this.segments={user:new Map(),assistant:new Map()};}
 emit(type,detail){this.callbacks[type]?.(detail);}
 async start({voice,context}){
  this.stop();const generation=++this.generation,current=()=>generation===this.generation;this.running=true;this.floorOpen=true;
  try{
   this.context=new AudioContext();await this.context.resume();if(!current())return false;
   const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
   if(!current()){stream.getTracks().forEach(t=>t.stop());return false;}
   this.microphone=stream;
   const client=this.client=new LiveClient({createSession:sdp=>this.api.directorLive({sdp,voice,context:this.contextFor?.()||context})});
   this.delegate=new DelegateClient(client,{answer:({id,history})=>this.api.director({id,history,context:this.contextFor?.()||context}),cancel:()=>this.api.cancel()},message=>this.emit('status',message));
   await new Promise((resolve,reject)=>{
    client.addEventListener('state',({detail})=>{if(!current())return;if(detail.state==='connected')resolve();if(detail.state==='idle'&&this.running){reject(Error('The Director disconnected.'));this.fail('The Director disconnected. Start the Director again to reconnect.');}});
    client.addEventListener('error',({detail})=>{if(current()){reject(Error(detail.message));this.fail(detail.message);}});
    client.addEventListener('remote-track',({detail})=>{if(!current())return;this.output?.close();this.output=new SpeechOutput(this.context,{onError:message=>this.emit('warning',message)});this.output.attach(detail.stream);});
    client.addEventListener('transcript',({detail})=>{if(current())this.transcript(detail);});
    void client.start({voice,inputStream:stream}).catch(reject);
   });
   if(!current())return false;
   this.emit('microphone',{active:true,muted:false});this.emit('connected');return true;
  }catch(e){if(current())this.fail(e.message);return false;}
 }
 transcript(detail){
  const map=this.segments[detail.role];if(!map)return;
  map.set(detail.id,detail.text);
  if(detail.role==='assistant'){const text=[...map.values()].join(' ').trim();this.emit('text',{role:'director',text,final:detail.final});if(detail.final){map.clear();this.emit('line',{role:'director',text:detail.text.trim(),id:detail.id});}}
  else{this.emit('text',{role:'user',text:detail.text,final:detail.final});if(detail.final){map.clear();if(detail.text.trim())this.emit('line',{role:'user',text:detail.text.trim(),id:detail.id});}}
 }
 sample(){return this.output?.sample()||null;}
 // Typed text goes to the same live conversation as speech.
 say(text){
  text=String(text||'').trim().slice(0,1200);if(!text||!this.client)return false;
  this.emit('line',{role:'user',text,id:'typed-'+Date.now().toString(36),typed:true});
  for(const chunk of commentaryChunks('The user typed this message; treat it exactly like something they said aloud and reply in your voice: '+JSON.stringify(text)))if(!this.client.appendCommentary(chunk))return false;
  return true;
 }
 closeFloor(reason='The show is being prepared and performed.'){
  if(!this.client||!this.floorOpen)return;this.floorOpen=false;this.output?.setActive(false);
  this.client.appendInstructions('Floor CLOSED. '+reason+' Stay completely silent, do not answer anything you hear, and wait for an explicit floor-open instruction.');
 }
 openFloor(prompt=''){
  if(!this.client)return;this.floorOpen=true;this.output?.setActive(true);
  this.client.appendInstructions('Floor OPEN now for the Director. Your previous wait has ended. Respond in your own live voice in one or two short sentences.');
  if(prompt)this.client.appendCommentary(prompt);
 }
 setMuted(value){this.muted=Boolean(value);for(const track of this.microphone?.getTracks()||[])track.enabled=!this.muted;this.client?.setMuted?.(this.muted);this.emit('microphone',{active:Boolean(this.microphone),muted:this.muted});}
 fail(message){this.stop();this.emit('error',message);}
 stop(){
  this.generation++;this.running=false;this.delegate?.cancel();this.delegate=null;
  this.client?.stop('director_end');this.client=null;this.output?.close();this.output=null;
  this.microphone?.getTracks().forEach(t=>t.stop());this.microphone=null;void this.context?.close().catch(()=>{});this.context=null;
  this.segments={user:new Map(),assistant:new Map()};this.emit('microphone',{active:false,muted:true});
 }
}
