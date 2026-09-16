const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const web=process.env.GLA_VOCAL_WEB||path.join(__dirname,'../web');
let checks=0;
for(const sampleRate of [32000,44100,48000,96000]){
 let Processor,messages=[];const host={Float32Array,Math,sampleRate,currentTime:0,AudioWorkletProcessor:class{constructor(){this.port={postMessage:p=>messages.push(p)}}},registerProcessor:(_,p)=>Processor=p};
 vm.runInNewContext(fs.readFileSync(path.join(web,'vocal-detector-worklet.js'),'utf8'),host);
 const processor=new Processor();const input=[new Float32Array(128).fill(.25),new Float32Array(128).fill(.75)],enhanced=[new Float32Array(128).fill(.1),new Float32Array(128).fill(.3)];
 const blocks=Math.ceil(sampleRate*.305/128);for(let i=0;i<blocks;i++){host.currentTime=i*128/sampleRate;processor.process([input,enhanced]);}
 assert.equal(messages.length,3);for(const m of messages){assert.equal(m.raw.length,1600);assert.equal(m.enhanced.length,1600);assert(m.raw.every(x=>x===.5));assert(m.enhanced.every(x=>Math.abs(x-.2)<1e-6));}
 assert(Math.abs(messages[2].time-.3)<1/sampleRate);checks++;
}
class FakeNode{constructor(){this.connections=[];this.gain={value:1};this.frequency={value:0};this.Q={value:0};this.port={onmessage:null};}connect(n){this.connections.push(n);}disconnect(n){if(n)this.connections=this.connections.filter(x=>x!==n);else this.connections=[];}}
const workers=[];let shouldReady=true;
class FakeWorker{constructor(){workers.push(this);}postMessage(p){if(p.type==='init'&&shouldReady)queueMicrotask(()=>this.onmessage?.({data:{type:'ready'}}));}terminate(){this.terminated=true;}}
const host={URL,DOMException,AbortController,Worker:FakeWorker,AudioWorkletNode:FakeNode,setTimeout,clearTimeout,queueMicrotask,console};
const script=fs.readFileSync(path.join(web,'vocal-detector.js'),'utf8').replace('export async function','async function').replaceAll('import.meta.url',JSON.stringify('http://localhost/vocal-detector.js'))+'\nglobalThis.createVocalDetector=createVocalDetector;';
vm.runInNewContext(script,host);
const context=()=>({currentTime:1,audioWorklet:{addModule:async()=>{}},createBiquadFilter:()=>new FakeNode(),createGain:()=>new FakeNode(),destination:new FakeNode()});
(async()=>{
 shouldReady=false;const aborted=new AbortController(),promise=host.createVocalDetector(context(),new FakeNode(),{signal:aborted.signal});aborted.abort();await assert.rejects(promise,{name:'AbortError'});assert(workers.at(-1).terminated);checks++;
 shouldReady=true;const c=context(),source=new FakeNode(),enhanced=new FakeNode(),controller=new AbortController();const detector=await host.createVocalDetector(c,source,{enhancedSource:enhanced,signal:controller.signal});const worker=workers.at(-1);assert.equal(detector.allowed(),false);
 worker.onmessage({data:{type:'voice',time:1,allowed:true,score:.05}});assert.equal(detector.allowed(),true);c.currentTime=1.6;assert.equal(detector.allowed(),false);c.currentTime=1;
 worker.onmessage({data:{type:'error',message:'Model failed'}});assert.equal(detector.allowed(),false);checks++;
 controller.abort();assert(worker.terminated);assert.equal(detector.allowed(),false);assert.equal(source.connections.length,0);assert.equal(enhanced.connections.length,0);checks++;
 const already=new AbortController();already.abort();const count=workers.length;await assert.rejects(host.createVocalDetector(context(),new FakeNode(),{signal:already.signal}),{name:'AbortError'});assert.equal(workers.length,count);checks++;
 console.log(`Vocal detector: ${checks} resampling, startup, staleness, error and cancellation checks passed.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
