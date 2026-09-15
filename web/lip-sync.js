import {VISEME_NAMES,decodeVisemeModel} from './lip-sync-model.js';

export const LIP_SYNC_DELAY=.08;
export const silentSpeech=()=>({rms:0,relative:0,viseme:'sil',visemeWeights:{},speaking:false,lipSyncSource:'audio-model'});
const contexts=new WeakMap();let modelPromise;
function resources(context){
  if(!contexts.has(context)){
    modelPromise ||= fetch(new URL('./vendor/headaudio/model-en-mixed.bin',import.meta.url)).then(async r=>{
      if(!r.ok)throw Error('Lip-sync model could not load.');const b=await r.arrayBuffer();decodeVisemeModel(b);return b;
    }).catch(e=>{modelPromise=null;throw e;});
    const pending=Promise.all([context.audioWorklet.addModule(new URL('./lip-sync-worklet.js',import.meta.url)),modelPromise]).then(([,model])=>model).catch(e=>{contexts.delete(context);throw e;});
    contexts.set(context,pending);
  }
  return contexts.get(context);
}

// Bounded audio-clock queue. A closed floor can never replay an old mouth pose.
export class VisemeTimeline {
  constructor(){this.clear();}
  clear(){this.queue=[];this.current={time:-Infinity,viseme:14};}
  push(frame){
    if(!Number.isFinite(frame.time)||!Number.isInteger(frame.viseme)||!VISEME_NAMES[frame.viseme])return;
    this.queue.push(frame);if(this.queue.length>128)this.queue.splice(0,this.queue.length-128);
  }
  sample(time){
    while(this.queue.length&&this.queue[0].time<=time)this.current=this.queue.shift();
    return time-this.current.time>.16?'sil':VISEME_NAMES[this.current.viseme];
  }
}

// One output graph owns both recognition and playback. It never sees the mic
// or connection sounds. All peers share the bundled model/module per context.
export class SpeechOutput {
  constructor(context,{onError=()=>{},monitor=true}={}){
    this.context=context;this.monitor=monitor;this.active=true;this._muted=false;this.closed=false;this.epoch=0;this.peak=.025;
    this.timeline=new VisemeTimeline();this.input=context.createGain();this.volume=context.createGain();
    this.analyser=context.createAnalyser();this.analyser.fftSize=512;this.samples=new Float32Array(512);
    this.volume.connect(context.destination);this.analyser.connect(this.volume);this.rebuildDelay();this.volume.gain.value=0;
    this.ready=resources(context).then(model=>{
      if(this.closed)return false;
      this.node=new AudioWorkletNode(context,'gla-visemes',{numberOfInputs:1,numberOfOutputs:0,channelCount:1,channelCountMode:'explicit',processorOptions:{model}});
      this.node.onprocessorerror=()=>{this.failed=true;this.timeline.clear();onError('Lip-sync recognition stopped. Reconnect to retry.');};
      this.node.port.onmessage=({data})=>{if(!this.closed&&this.active&&data.epoch===this.epoch)this.timeline.push(data);};
      this.input.connect(this.node);this.node.port.postMessage({type:'reset',epoch:this.epoch,active:this.active});this.updateVolume();return true;
    }).catch(error=>{if(!this.closed){this.failed=true;this.updateVolume();onError('Audio lip-sync unavailable; using a simple mouth fallback. '+error.message);}return false;});
  }
  rebuildDelay(){
    if(this.delay){try{this.input.disconnect(this.delay);this.delay.disconnect();}catch{}}
    this.delay=this.context.createDelay(.2);this.delay.delayTime.value=LIP_SYNC_DELAY;this.input.connect(this.delay);this.delay.connect(this.analyser);
  }
  attach(stream){
    if(this.closed)return;
    // Chromium's remote WebRTC audio renderer must be started even when the
    // audible route is WebAudio. Keep it muted: only the delayed graph plays.
    this.decoder ||= new Audio();this.decoder.muted=true;this.decoder.srcObject=stream;
    void this.decoder.play().catch(()=>{});
    this.source?.disconnect();this.source=this.context.createMediaStreamSource(stream);this.source.connect(this.input);
  }
  updateVolume(){this.volume.gain.value=this.active&&!this._muted&&this.monitor&&!this.closed?1:0;}
  get muted(){return this._muted;}
  set muted(value){if(this._muted===Boolean(value))return;this._muted=Boolean(value);this.clear();this.updateVolume();}
  setActive(value){
    value=Boolean(value);if(value===this.active||this.closed)return;this.active=value;this.input.gain.value=value?1:0;this.clear();this.updateVolume();
  }
  clear(){this.epoch++;this.timeline.clear();this.peak=.025;this.node?.port.postMessage({type:'reset',epoch:this.epoch,active:this.active&&!this._muted});this.rebuildDelay();}
  sample(){
    if(this.closed||!this.active||this._muted)return silentSpeech();
    this.analyser.getFloatTimeDomainData(this.samples);let sum=0;for(const v of this.samples)sum+=v*v;
    const rms=Math.sqrt(sum/this.samples.length);this.peak=Math.max(.025,rms,this.peak*.995);const relative=Math.min(1,rms/this.peak);
    // The output timestamp includes the device's actual playback latency.
    // Mouth targets lead their audible timestamp by 25 ms for morph blending.
    const stamp=this.context.getOutputTimestamp?.();
    const audible=stamp?.contextTime>0?stamp.contextTime+(performance.now()-stamp.performanceTime)/1000:this.context.currentTime-(this.context.outputLatency||0);
    const viseme=this.failed?(rms>.008?'aa':'sil'):this.timeline.sample(audible-LIP_SYNC_DELAY+.025);
    return {rms,relative,viseme,visemeWeights:viseme==='sil'?{}:{[viseme]:1},speaking:viseme!=='sil'||rms>.008,lipSyncSource:this.failed?'fallback':'audio-model'};
  }
  close(){
    if(this.closed)return;this.closed=true;this.volume.gain.value=0;this.timeline.clear();
    if(this.decoder){this.decoder.pause();this.decoder.srcObject=null;this.decoder=null;}
    this.node?.port.postMessage({type:'close'});this.node?.port.close();
    for(const node of [this.source,this.input,this.delay,this.analyser,this.volume,this.node])try{node?.disconnect();}catch{}
  }
}
