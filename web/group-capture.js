export function speechWav(pcm,rate){
 const outputRate=16000,count=Math.floor(pcm.length*outputRate/rate),audio=new Uint8Array(44+count*2),v=new DataView(audio.buffer);
 const word=(offset,text)=>{for(let n=0;n<text.length;n++)v.setUint8(offset+n,text.charCodeAt(n));};
 word(0,'RIFF');v.setUint32(4,audio.length-8,true);word(8,'WAVE');word(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,outputRate,true);v.setUint32(28,outputRate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);word(36,'data');v.setUint32(40,count*2,true);
 for(let n=0;n<count;n++){const from=Math.floor(n*rate/outputRate),to=Math.max(from+1,Math.floor((n+1)*rate/outputRate));let sum=0;for(let k=from;k<to;k++)sum+=pcm[k]||0;v.setInt16(44+n*2,Math.max(-1,Math.min(1,sum/(to-from)))*32767,true);}return audio;
}
export class GroupCapture {
 static async create(context,source){await context.audioWorklet.addModule('/group-capture-worklet.js');return new GroupCapture(context,source);}
 constructor(context,source){this.requests=new Map();this.sequence=0;this.source=source;this.node=new AudioWorkletNode(context,'gla-group-capture',{numberOfInputs:1,numberOfOutputs:0});source.connect(this.node);this.node.port.onmessage=({data})=>{const pending=this.requests.get(data.request);if(!pending)return;clearTimeout(pending.timer);this.requests.delete(data.request);data.truncated?pending.reject(Error('Keep each spoken request under one minute.')):pending.resolve(speechWav(data.pcm,data.rate));};}
 begin(id){this.node.port.postMessage({type:'begin',id});}
 take(id){const request=++this.sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.requests.delete(request);reject(Error('Microphone audio was not ready.'));},3000);this.requests.set(request,{resolve,reject,timer});this.node.port.postMessage({type:'take',id,request});});}
 close(){this.node.port.postMessage({type:'clear'});this.node.port.close();this.source.disconnect(this.node);this.node.disconnect();for(const pending of this.requests.values()){clearTimeout(pending.timer);pending.resolve(null);}this.requests.clear();}
}
