const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{
 const root=path.resolve(__dirname,'..');
 const {decodeVisemeModel,VISEME_NAMES}=await import('../web/lip-sync-model.js');
 const {VisemeTimeline}=await import('../web/lip-sync.js');
 const {ConversationSounds}=await import('../web/conversation-sounds.js');
 const bytes=fs.readFileSync(root+'/web/vendor/headaudio/model-en-mixed.bin'),model=decodeVisemeModel(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length));
 assert(model.length>30);assert.equal(new Set(model.map(p=>p.viseme)).size,15);
 assert.throws(()=>decodeVisemeModel(new ArrayBuffer(10)));assert.throws(()=>decodeVisemeModel(new ArrayBuffer(0)));
 const timeline=new VisemeTimeline();timeline.push({time:1,viseme:0});timeline.push({time:1.05,viseme:5});timeline.push({time:1.1,viseme:14});
 assert.equal(timeline.sample(.99),'sil');assert.equal(timeline.sample(1),'aa','Index zero is a vowel, not a false/empty prediction');assert.equal(timeline.sample(1.051),'PP');assert.equal(timeline.sample(1.1),'sil');
 for(let i=0;i<300;i++)timeline.push({time:2+i*.016,viseme:3});assert(timeline.queue.length<=128);timeline.clear();assert.equal(timeline.sample(9),'sil','Interruption drops all pending mouth poses');
 timeline.push({time:10,viseme:2});assert.equal(timeline.sample(10.3),'sil','A stalled stream cannot leave the mouth open');
 // Exercise the actual learned classifier, audio silence gate and worklet
 // resets. The wrapper must not infer a vowel from a zero-valued prediction.
 let Worklet;globalThis.AudioWorkletProcessor=class{constructor(){this.port={postMessage:e=>events.push(e)};}};globalThis.sampleRate=48000;globalThis.currentTime=0;globalThis.registerProcessor=(_n,c)=>Worklet=c;const events=[];
 await import('../web/lip-sync-worklet.js');const worklet=new Worklet({processorOptions:{model:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length)}});
 for(let n=0;n<375;n++){globalThis.currentTime=n*128/48000;worklet.process([[new Float32Array(128)]]);}assert(!events.some(e=>e.viseme!==14),'Silence does not move the mouth');
 worklet.port.onmessage({data:{type:'reset',epoch:3,active:false}});const count=worklet.recognizer.sampleCount;worklet.process([[new Float32Array(128).fill(.2)]]);assert.equal(worklet.recognizer.sampleCount,count,'Closed group floors do no recognition work');
 worklet.port.onmessage({data:{type:'reset',epoch:4,active:true}});assert.equal(worklet.recognizer.sampleCount,0);worklet.port.onmessage({data:{type:'close'}});assert.equal(worklet.process([]),false,'Disposed worklets terminate');
 const sounds=new ConversationSounds(),cues=[];sounds.play=k=>cues.push(k);
 sounds.transition('connecting');sounds.transition('connecting');sounds.transition('connected');sounds.transition('connected');sounds.transition('idle',{reason:'voice_change'});sounds.transition('connecting',{resumed:true});sounds.transition('connected',{resumed:true});sounds.transition('idle',{reason:'user'});sounds.transition('idle');
 assert.deepEqual(cues,['connecting','connected','ended'],'One cue per conversation edge, no restart/peer duplication');
 const liveSource=fs.readFileSync(root+'/web/group-live.js','utf8').replace(/^import .*;$/gm,'');globalThis.silentSpeech=(await import('../web/lip-sync.js')).silentSpeech;
 const {LiveGroup}=await import('data:text/javascript;base64,'+Buffer.from(liveSource).toString('base64'));const group=new LiveGroup({cancel(){}});group.active='tia';group.peers.set('tia',{output:{sample:()=>({viseme:'PP',visemeWeights:{PP:1},speaking:true})}});
 assert.equal(group.sample().viseme,'PP');group.userSpeaking=true;assert.equal(group.sample().viseme,'sil');group.userSpeaking=false;group.awaitingHuman=true;assert.equal(group.sample().viseme,'sil');
 console.log('Learned 15-viseme model, audio-clock scheduling, silence, interruption, worklet cleanup and conversation cue lifecycle passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
