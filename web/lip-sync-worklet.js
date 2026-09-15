import {Processor} from './vendor/headaudio/processor.mjs';
import {RingBuffer} from './vendor/headaudio/ringbuffer.mjs';
import {decodeVisemeModel} from './lip-sync-model.js';

class VisemeProcessor extends AudioWorkletProcessor {
  constructor(options){
    super();this.model=decodeVisemeModel(options.processorOptions.model);this.epoch=0;this.active=true;
    this.reset();
    this.port.onmessage=({data})=>{
      if(data.type==='close'){this.closed=true;return;}
      if(data.type==='reset'){this.epoch=data.epoch;this.active=data.active;this.reset();}
    };
  }
  reset(){
    this.recognizer=new Processor({sampleRate,parameterData:{vadGateActiveDb:-45,vadGateInactiveDb:-52}}, {port:{postMessage:e=>{
      // A 32 ms MFCC frame plus three-frame voting represents speech about
      // 32 ms before this audio quantum. Use the audio clock, never UI arrival.
      if(e.event==='viseme'||e.event==='ended')this.port.postMessage({epoch:this.epoch,time:currentTime-.032,viseme:e.event==='ended'?14:e.viseme});
    }}});
    this.recognizer.classifier.import({model:this.model});
    this.recognizer.classifier.ringPredictions=new RingBuffer(3,()=>14,true);
  }
  process(inputs){
    if(this.closed)return false;
    if(this.active&&inputs[0]?.[0]?.length)this.recognizer.process(inputs[0][0]);
    return true;
  }
}
registerProcessor('gla-visemes',VisemeProcessor);
