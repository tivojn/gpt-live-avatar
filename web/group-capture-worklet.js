// A short in-memory mic buffer. No playback enters this node and no audio is
// saved to disk. Pre-roll preserves the greeting before the speech gate opens.
class GroupCapture extends AudioWorkletProcessor {
 constructor(){super();this.pre=new Float32Array(Math.ceil(sampleRate*.8));this.head=0;this.id=null;this.length=0;this.parts=[];
  this.port.onmessage=({data})=>{
   if(data.type==='begin'&&data.id!==this.id){this.id=data.id;this.truncated=false;this.parts=[new Float32Array([...this.pre.slice(this.head),...this.pre.slice(0,this.head)])];this.length=this.pre.length;}
   if(data.type==='take'&&data.id===this.id){const pcm=new Float32Array(this.length);let at=0;for(const part of this.parts){pcm.set(part,at);at+=part.length;}this.port.postMessage({id:data.id,request:data.request,rate:sampleRate,pcm,truncated:this.truncated},[pcm.buffer]);}
   if(data.type==='clear'){this.parts=[];this.length=0;this.id=null;this.pre.fill(0);}
  };
 }
 process(inputs){const input=inputs[0]?.[0];if(input){for(const value of input){this.pre[this.head]=value;this.head=(this.head+1)%this.pre.length;}if(this.id){if(this.length+input.length<=sampleRate*60){this.parts.push(input.slice());this.length+=input.length;}else this.truncated=true;}}return true;}
}
registerProcessor('gla-group-capture',GroupCapture);
