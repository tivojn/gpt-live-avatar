'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const root=process.env.GLA_SOURCE_ROOT||path.resolve(__dirname,'..');
const silentSpeech=()=>({rms:0,relative:0,viseme:'sil',visemeWeights:{},speaking:false,lipSyncSource:'audio-model'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function fixture(){
 const intervals=new Set(),nodes=[],contexts=[],starts=[],stops=[];let now=100,latency=0,audible=true;
 class Node{constructor(){this.port={postMessage(){},close(){}};this.gain={value:0};this.parameters=new Map([['gate',{value:0}]]);}connect(){return this;}disconnect(){}getByteFrequencyData(a){a.fill(0);}}
 class Context{constructor(){this.sampleRate=48000;this.currentTime=0;this.destination=new Node();this.audioWorklet={addModule:async()=>{}};contexts.push(this);}async resume(){}async close(){this.closed=true;}createGain(){return new Node();}createBiquadFilter(){const n=new Node();n.frequency={value:0};n.Q={value:0};return n;}createAnalyser(){const n=new Node();n.frequencyBinCount=512;return n;}}
 class Worklet extends Node{constructor(_context,name){super();this.name=name;nodes.push(this);if(name==='tap-source')setTimeout(()=>this.port.onmessage?.({data:{type:'health',buffered:.04,rms:audible?.04:0,peak:audible?.1:0,receivedFrames:4096}}),10);}}
 class Speech{constructor(_context,options){this.ready=Promise.resolve(true);this.input=new Node();this.analysisOnly=options?.analysisOnly;}sample(){return {rms:.03,relative:.4,viseme:'PP',visemeWeights:{PP:1},speaking:true,lipSyncSource:'audio-model'};}close(){this.closed=true;}updateVolume(){}}
 const makeTarget=id=>{const motion={clips:new Map([['gangnam-groove',{id:'gangnam-groove',category:'dance'}]]),expression:()=>({}),active:null,setPlaybackRate(){},stop(){this.active=null;}};return {id,name:id,avatar:{motion},play:async()=>{motion.active={id:'gangnam-groove',clip:{frames:[1,2],fps:30}};}};};
 const targets=[makeTarget('sarah'),makeTarget('tia')],originalSpeech={unchanged:true};
 const ctx={console,DOMException,AbortController,Float32Array,Uint8Array,Math,Date,Number,Map,Set,Error,Promise,Object,Boolean,String,
  performance:{now:()=>now*1000},setTimeout,clearTimeout,setInterval:(fn,ms)=>{const t=setInterval(fn,ms);intervals.add(t);return t;},clearInterval:t=>{clearInterval(t);intervals.delete(t);},addEventListener(){},AudioContext:Context,AudioWorkletNode:Worklet,SpeechOutput:Speech,VisemeTimeline:class{},LIP_SYNC_DELAY:.08,silentSpeech,createVocalDetector:async()=>({allowed:()=>true,close(){}}),
  fetch:async(url,{signal}={})=>url.endsWith('/state')?{json:async()=>({mode:'off'})}:{ok:true,body:{getReader:()=>({read:()=>new Promise(resolve=>signal?.addEventListener('abort',()=>resolve({done:true}),{once:true})),cancel:async()=>{}})}},
  gla_speech:originalSpeech,gla_sing_targets:character=>targets.filter(t=>!character||character==='all'||t.id===character),
  gla:{tap:{start:async options=>{starts.push(options);if(latency)await sleep(latency);return {ok:true,source:'Spotify',player:'spotify',channels:2,sampleRate:48000,url:'http://stream'};},stop:async()=>{stops.push(true);},playing:async player=>({playing:true,player,title:'Test song'})}}};
 ctx.window=ctx;vm.createContext(ctx);let source=fs.readFileSync(path.join(root,'web/sing.js'),'utf8').replace(/^import .*?;$/mg,'');vm.runInContext(source,ctx);
 return {ctx,targets,contexts,starts,stops,nodes,originalSpeech,setLatency:n=>latency=n,setAudible:v=>audible=v,setNow:n=>now=n,close(){ctx.gla_sing_stop();for(const t of intervals)clearInterval(t);}};
}
(async()=>{
 const f=await fixture();try{
  const r=await f.ctx.gla_sing_command('sing_along',{character:'sarah'});
  assert.equal(r.ok,true);assert.equal(f.ctx.gla_sing_sample('sarah').viseme,'PP');
  assert.equal(f.ctx.gla_speech,f.originalSpeech,'music never replaces live conversation output');
  assert.equal(f.contexts.length,1);assert.equal(f.ctx.gla_sing_sample('tia'),null);
  await f.ctx.gla_sing_command('dance_along',{character:'tia'});
  assert.equal(f.contexts.length,1,'group shares one source');assert.equal(f.ctx.gla_sing_sample('tia').viseme,'sil','dance-only does not mouth instruments');
  f.ctx.gla_sing_stop('sarah');assert.equal(f.ctx.gla_sing_sample('sarah'),null);assert.ok(f.ctx.gla_sing(),'stopping one target leaves the other dancing');
  f.ctx.gla_sing_stop('tia');assert.equal(f.ctx.gla_sing(),null);assert.ok(f.contexts[0].closed);assert.equal(f.ctx.gla_speech,f.originalSpeech);
  f.setLatency(25);const pending=f.ctx.gla_sing_along({character:'sarah'});await sleep(5);
  assert.equal(f.ctx.gla_sing_pending('sarah'),true);assert.equal(f.ctx.gla_sing_pending('tia'),false);
  assert.equal(f.ctx.gla_sing_stop('tia'),false,'Stopping another avatar must not cancel pending Sarah');assert.equal(f.ctx.gla_sing_pending('sarah'),true);
  f.ctx.gla_sing_stop('sarah');assert.equal(f.ctx.gla_sing_pending(),false);await assert.rejects(pending,/cancelled/i);assert.equal(f.ctx.gla_sing(),null,'stop cancels startup before session exists');
  f.setLatency(10);const first=f.ctx.gla_sing_along({character:'sarah'});const caught=assert.rejects(first,/cancelled/i);const second=f.ctx.gla_sing_along({character:'tia',mode:'dance'});await caught;await second;assert.deepEqual(Array.from(f.ctx.gla_sing().targets,x=>x.id),['tia'],'latest start wins');
  assert.equal(f.ctx.gla_sing_sample('tia').speaking,false);f.ctx.gla_sing_stop();
  await assert.rejects(f.ctx.gla_sing_command('sing_along',{character:'missing'}),/not visible/);
  f.setLatency(0);await f.ctx.gla_sing_along({character:'sarah'});
  const originalPlay=f.targets[1].play;f.targets[1].play=async()=>{throw Error('Missing clip');};
  await assert.rejects(f.ctx.gla_sing_command('dance_along',{character:'tia'}),/Missing clip/);
  assert.equal(f.ctx.gla_sing_sample('tia'),null);assert.equal(f.targets[1].avatar.motion.__singWrapped,undefined,'failed add releases expression ownership');
  let complete;f.targets[1].play=()=>new Promise(r=>complete=r);const adding=f.ctx.gla_sing_command('dance_along',{character:'tia'});await sleep(5);f.ctx.gla_sing_stop('tia');complete(true);await assert.rejects(adding,/cancelled/i);assert.equal(f.ctx.gla_sing_sample('tia'),null);
  f.targets[1].play=originalPlay;
  const before=f.starts.length;await f.ctx.gla_sing_along({character:'sarah',pid:999});assert.equal(f.starts.length,before+1,'explicit new PID must retap');
  f.ctx.gla_sing_stop();
  // Filled silence must still time out, independently of transport buffering.
  f.setLatency(0);await f.ctx.gla_sing_along({character:'sarah'});
  const tap=f.nodes.filter(n=>n.name==='tap-source').at(-1);tap.port.onmessage({data:{type:'health',buffered:.04,rms:0,peak:0}});f.setNow(108);await sleep(550);assert.equal(f.ctx.gla_sing(),null,'silent PCM stops music performance');
  console.log('Music sessions: live voice ownership, targeted group/dance-only, cancellation, restart, missing target and buffered-silence cleanup passed.');
 }finally{f.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
