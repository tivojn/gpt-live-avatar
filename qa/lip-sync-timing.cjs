'use strict';
const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
const root=process.env.GLA_SOURCE_ROOT||path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'web/lip-sync.js'),'utf8').replace(/^import .*?;$/mg,'').replace(/export /g,'')+'\nthis.SpeechOutput=SpeechOutput;this.VisemeTimeline=VisemeTimeline;';
const names=['PP','FF','TH','DD','kk','CH','SS','nn','RR','aa','E','ih','oh','ou','sil'];
const ctx={VISEME_NAMES:names,performance:{now:()=>1000},URL,fetch(){throw Error('No model loading in timing test');},Float32Array,Map,WeakMap,Math,Number,Object,Promise,console};
vm.createContext(ctx);vm.runInContext(source.replace(/import\.meta\.url/g,"'http://test/lip-sync.js'"),ctx);
function output(analysisOnly){const sample=Object.create(ctx.SpeechOutput.prototype);Object.assign(sample,{analysisOnly,closed:false,active:true,_muted:false,peak:.025,samples:new Float32Array(512),analyser:{getFloatTimeDomainData:a=>a.fill(.02)},context:{currentTime:1,getOutputTimestamp:()=>({contextTime:1,performanceTime:1000})},timeline:new ctx.VisemeTimeline()});return sample;}
const voice=output(false),music=output(true);
for(const s of [voice,music]){s.timeline.push({time:.88,viseme:0});s.timeline.push({time:.97,viseme:9});}
assert.equal(voice.sample().viseme,'PP','spoken playback preserves its delayed audio clock');
assert.equal(music.sample().viseme,'aa','already-audible music samples the current input clock without an extra playback delay');
console.log('Conversation playback timing preserved; tapped music avoids the extra 80 ms output-delay offset.');
