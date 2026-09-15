'use strict';
// Execute the production media controllers and group stop function. No Electron,
// microphone capture, provider calls or filesystem effects beyond source reads.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),read=name=>fs.readFileSync(path.join(root,'web',name),'utf8');
const groupSource=read('group.js');
const microphoneAPI=groupSource.match(/const microphone\s*=\s*new GroupMicrophone\((\w+),/)?.[1];
const voiceBinding=groupSource.match(/voiceAPI=(\{[^\n]*?\}),voice=new GroupVoice/ )?.[1];
const stopSource=groupSource.match(/^function stop\([^\n]+$/m)?.[0];
assert(microphoneAPI&&voiceBinding&&stopSource,'Production group controller binding and stop function remain discoverable');
function scenario(binding,preserveTasks){
 const sandbox={clearInterval,setInterval,performance,result:null};
 vm.createContext(sandbox);
 for(const file of ['group-input.js','group-voice.js','group-live.js'])vm.runInContext(read(file).replace(/^import .*$/mg,'').replace(/export /g,''),sandbox,{filename:file});
 vm.runInContext(`
 const cancellations=[],tasks=new Set(['typed-tia','voice-delegate']);let stoppedTracks=0;
 const api={cancel:options=>{cancellations.push(options?.scope||'all');if(options?.scope!=='voice')tasks.clear();}};
 const window={gla:{agent:{cancel:id=>tasks.delete(id)}}};
 const voiceAPI=${voiceBinding};
 const microphone=new GroupMicrophone(${binding});microphone.state='transcribing';
 microphone.stream={getTracks:()=>[{stop(){stoppedTracks++;}}]};
 const voice=new GroupVoice(voiceAPI),liveGroup=new LiveGroup(voiceAPI);
 liveGroup.pendingRequests.add('voice-delegate');
 const actor={activity:{id:'typed-tia',active:true},el:{classList:{remove(){}}}},actors=new Map([['tia',actor]]);
 const conversationSounds={transition(){}},controls=()=>{},status=()=>{},setBubble=(a,text)=>{a.message=text;};
 let runGeneration=0,running=true,speaker='tia',listener='sarah',waitingHuman=true,wantsTurn=false,humanResolve=null;
 ${stopSource}
 stop('Switching to live talk…',${JSON.stringify(preserveTasks)});
 globalThis.result={tasks:[...tasks],cancellations,stoppedTracks,state:microphone.state,activity:actor.activity,voicePending:liveGroup.pendingRequests.size};
 `,sandbox);
 return JSON.parse(JSON.stringify(sandbox.result));
}
const actual=scenario(microphoneAPI,true);
assert.deepEqual(actual.tasks,['typed-tia'],'Transcription cancellation during voice startup preserves the unrelated typed task');
assert(actual.cancellations.length>=3&&actual.cancellations.every(c=>c==='voice'),'Recording, playback and live cancellation are voice scoped');
assert.equal(actual.stoppedTracks,1);assert.equal(actual.state,'idle');assert.equal(actual.voicePending,0);
assert.equal(actual.activity?.id,'typed-tia','The typed task keeps its progress');
const explicitStop=scenario(microphoneAPI,false);
assert.deepEqual(explicitStop.tasks,[],'Explicit global Stop still cancels all jobs');assert.equal(explicitStop.activity,null);
const priorBug=scenario('api',true);
assert.deepEqual(priorBug.tasks,[],'Negative control reproduces the old unscoped transcription bug');
console.log('Transcribing→live transition: voice-only cancellation, retained typed job/progress, released input, scoped delegate cancellation, explicit global Stop, and negative control passed.');
