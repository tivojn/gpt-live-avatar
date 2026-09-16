// Resample two mono views to 16 kHz in bounded 100 ms messages. Audio is never
// sent outside the application. No inference runs on the audio callback.
class VocalDetectorCapture extends AudioWorkletProcessor{
 constructor(){super();this.raw=new Float32Array(1600);this.enhanced=new Float32Array(1600);this.used=0;this.phase=0;this.rawSum=0;this.enhancedSum=0;this.count=0;}
 process(inputs){
  const a=inputs[0],b=inputs[1];if(!a?.[0])return true;
  for(let i=0;i<a[0].length;i++){
   let raw=0,enhanced=0;for(const channel of a)raw+=channel[i]||0;
   for(const channel of b||[])enhanced+=channel[i]||0;
   this.rawSum+=raw/a.length;this.enhancedSum+=(b?.length?enhanced/b.length:raw/a.length);this.count++;
   this.phase+=16000;
   if(this.phase>=sampleRate){
    this.phase-=sampleRate;this.raw[this.used]=this.rawSum/this.count;this.enhanced[this.used]=this.enhancedSum/this.count;
    this.rawSum=this.enhancedSum=this.count=0;this.used++;
    if(this.used===1600){
     this.port.postMessage({type:'audio',raw:this.raw,enhanced:this.enhanced,time:currentTime+(i+1)/sampleRate},[this.raw.buffer,this.enhanced.buffer]);
     this.raw=new Float32Array(1600);this.enhanced=new Float32Array(1600);this.used=0;
    }
   }
  }
  return true;
 }
}
registerProcessor('vocal-detector-capture',VocalDetectorCapture);
