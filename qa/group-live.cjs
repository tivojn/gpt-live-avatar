const fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
(async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../web/group-live.js'),'utf8').replace(/^import .*;$/gm,'');
 Object.assign(globalThis,await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(path.join(__dirname,'../web/group-context.js'),'utf8')).toString('base64')));globalThis.commentaryChunks=t=>[t];
 globalThis.needsAgent=(await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(path.join(__dirname,'../web/group-agent-request.js'),'utf8')).toString('base64'))).needsAgent;
 const {SpeechGate,LiveGroup}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 const gate=new SpeechGate();for(let n=1;n<2000;n+=35)assert.equal(gate.sample(.003,n),null);assert.equal(gate.sample(.12,2030),null);assert.equal(gate.sample(.002,2065),null);assert(!gate.active,'A click does not interrupt');
 let onset;for(let n=2100;n<2400;n+=35)if(gate.sample(.05,n)===true)onset=n;assert(onset>=2190&&onset<2250);assert(gate.active);assert.equal(gate.sample(0,2500),null);assert.equal(gate.sample(0,3000),false);
 let released=0,cancelled=0;const events=[],live=new LiveGroup({cancel:()=>{cancelled++;}},{microphone:d=>events.push(d)});live.microphone={getTracks:()=>[{stop(){released++;}}]};live.running=true;live.stop();assert.equal(released,1);assert.equal(live.running,false);assert.equal(live.peers.size,0);assert.equal(events.at(-1).active,false);
 live.running=true;live.active='tia';live.human={enabled:true,name:'You'};const p={slug:'tia',acceptUser:false,segments:new Map(),client:{appendCommentary:()=>{}},lastText:0};live.transcript(p,{role:'user',text:'Sarah speaking',final:true});assert.equal(live.history.length,0,'Relayed character speech is not human input');p.acceptUser=true;p.heard=true;live.transcript(p,{role:'user',text:'My own reply',final:true});assert.equal(live.history[0].text,'My own reply');live.transcript(p,{role:'assistant',id:'a',text:' A reply',final:false});const changed=p.lastText;await new Promise(r=>setTimeout(r,5));live.transcript(p,{role:'assistant',id:'a',text:'A reply',final:true});assert.equal(p.lastText,changed,'A transcript final cannot add another pause');
 // Pauses can split one spoken file instruction. Preserve both segments until
 // the character actually answers, including while a tool request is pending.
 globalThis.commentaryChunks=t=>[t];let finishTool;const requests=[],spoken=[];
 const grouped=new LiveGroup({cancel(){},reply:r=>{requests.push(r);return new Promise(resolve=>finishTool=resolve);}});
 Object.assign(grouped,{running:true,active:'tia',human:{enabled:true,name:'You'},cast:[{slug:'tia'}]});
 const humanPeer={slug:'tia',acceptUser:true,heard:false,humanFinal:true,segments:new Map(),audio:{},micGain:{gain:{value:0}},openAt:10,client:{reasoningMode:'delegate',conversation:()=>[],appendInstructions(){},appendCommentary:t=>spoken.push(t)}};grouped.peers.set('tia',humanPeer);
 grouped.transcript(humanPeer,{role:'user',id:'one',text:'Create an empty file named',final:false});
 grouped.interrupt(performance.now());grouped.userSpeaking=false;
 grouped.transcript(humanPeer,{role:'user',id:'two',text:'hello.txt in the selected folder.',final:false});humanPeer.humanChangedAt=performance.now()-700;humanPeer.humanFinal=true;
 const floor=humanPeer.openAt,tool=grouped.delegate(humanPeer,'split-turn');assert.equal(requests[0].humanRequest,'Create an empty file named hello.txt in the selected folder.');
 grouped.transcript(humanPeer,{role:'user',id:'two',text:'hello.txt in the selected folder.',final:true});assert.equal(humanPeer.openAt,floor,'Transcript final does not invalidate an active delegation');
 finishTool({ok:true,text:'Created hello.txt.'});await tool;assert.deepEqual(spoken,['Created hello.txt.']);
 humanPeer.heard=true;grouped.interrupt(performance.now());assert.equal(humanPeer.lastHumanText,'','A fresh human interruption cannot reuse earlier authorization');

 assert(needsAgent('Sarah, delete it.'));assert(needsAgent('Delete that file.'));assert(needsAgent('Sarah, create a file called hello.txt on the desktop.'));assert(needsAgent('你怎么看这个网页'));assert(!needsAgent('Let us tell a story about a dragon.'));
 // A typed request must be authorized before the model can request tools.
 const typed=new LiveGroup({cancel(){}});Object.assign(typed,{running:true,active:'tia',human:{enabled:true,name:'You'},cast:[{slug:'tia',name:'Tia'},{slug:'sarah',name:'Sarah'}]});
 let opened;typed.open=(slug,first,input)=>{opened={slug,input};};typed.say('Sarah, create hello.txt on the desktop.');assert.equal(opened.slug,'sarah');assert.equal(opened.input.text,'Sarah, create hello.txt on the desktop.');assert(opened.input.id.startsWith('typed-'));

 // Greetings, isolated trailing vocatives, mentions and file names.
 const cast=[{slug:'tia',name:'Tia'},{slug:'sarah',name:'Sarah'},{slug:'ming-mei',name:'Ming-Mei'}];
 for(const text of ['Hi Tia, can you create a file?','Hey, Tia!','Okay, um, Tia, read it','Tia','Delete that file, Tia.'])assert.equal(addressedSpeaker(text,cast),'tia',text);
 assert.equal(addressedSpeaker('Hello Ming Mei, tell me about it',cast),'ming-mei');
 for(const text of ['Create Tia.txt on the desktop','Tia.test.txt','Tia dot test dot txt','What did Sarah create?','Tell me about Tia',"Sarah's file was created",'Sarah’s idea was good'])assert.equal(addressedSpeaker(text,cast),null,text);
 assert.equal(addressedSpeaker('Hi Tia, ask Sarah about her idea',cast),'tia');
 typed.cast=cast;typed.say('Hi Tia, can you read that file?');assert.equal(opened.slug,'tia');typed.say('Delete that file.');assert.equal(opened.slug,'tia','The named conversation remains with its addressee');typed.say('Hey Sarah, delete it.');assert.equal(opened.slug,'sarah');
 assert(playbackEcho('Sure, happy to help. What file do you mean?',['Sure! Happy to help. What file do you mean?']));assert(!playbackEcho('Yes',['Yes']));assert(!playbackEcho('Hi Tia, create a file',['Sure, happy to help.']));
 // Every listener receives labeled context without any audio-input relay.
 const sent={tia:[],sarah:[]},room=new LiveGroup({cancel(){}});Object.assign(room,{running:true,cast,human:{enabled:true,name:'Jamie'}});
 for(const c of cast.slice(0,2))room.peers.set(c.slug,{...c,client:{send:e=>{sent[c.slug].push(e);return true;}}});
 room.recordLine({speaker:'_human',text:'Hi Tia, create hello.txt',id:'one'});room.actionResult({id:'one',speaker:'tia',tool:'create_text_file',ok:true,path:'/selected/hello.txt'});room.recordLine({speaker:'tia',text:'I created hello.txt.'});
 for(const slug of ['tia','sarah']){assert(sent[slug].some(e=>e.content.includes('Jamie (real human)')));assert(sent[slug].some(e=>e.content.includes('/selected/hello.txt')));}
 room.recordLine({speaker:'_human',text:'Sarah, delete it.',id:'two'});assert.equal(room.actions.length,1);assert(!('linkAudio' in room));

 // Independent name-aware transcription replaces a misheard greeting and
 // stale recognition cannot authorize a tool after a new human interruption.
 let resolveRecognition;const recognition=new LiveGroup({cancel(){},transcribe:()=>new Promise(r=>resolveRecognition=r)});
 Object.assign(recognition,{running:true,active:'sarah',cast,human:{enabled:true,name:'You'},capture:{take:async()=>new Uint8Array(256)}});
 const listener={slug:'sarah',acceptUser:true,routingPending:true,inputRevision:1,lastHumanId:'mic-one',segments:new Map()};recognition.peers.set('sarah',listener);
 const recognize=recognition.confirmInput(listener);await new Promise(r=>setTimeout(r,0));resolveRecognition({ok:true,text:'Hi Tia, create shared.txt.'});await recognize;assert.equal(listener.target,'tia');assert.equal(recognition.history.at(-1).text,'Hi Tia, create shared.txt.');
 recognition.transcript(listener,{role:'user',id:'late',text:'My idea. Create shared.txt.',final:true});assert.equal(listener.lastHumanText,'Hi Tia, create shared.txt.','Late captions do not replace verified routing');assert(listener.humanFinal);
 listener.inputRevision=2;listener.routingPending=true;const outdated=recognition.confirmInput(listener);await new Promise(r=>setTimeout(r,0));listener.inputRevision=3;resolveRecognition({ok:true,text:'Sarah, delete it.'});await outdated;assert.equal(listener.lastHumanText,'Hi Tia, create shared.txt.');
 // Slow transcription plus a pause after the name used to throw away the
 // original mic buffer and route the remaining task to the previous speaker.
 const captured=[];recognition.capture.begin=id=>captured.push(id);
 Object.assign(listener,{heard:false,segments:new Map(),acceptUser:true,routingPending:true,lastHumanId:'name-and-task',humanChangedAt:performance.now()-9000,client:{appendInstructions(){},resetInputTranscript(){}},audio:{},micGain:{gain:{}}});
 recognition.interrupt(performance.now());assert.equal(listener.lastHumanId,'name-and-task');assert.equal(captured.at(-1),'name-and-task','Pending recognition retains the name-containing microphone buffer');recognition.userSpeaking=false;
 const isolated=recognition.confirmInput(listener);await new Promise(r=>setTimeout(r,0));resolveRecognition({ok:true,text:'Sarah.'});await isolated;assert.equal(recognition.directed,'sarah');assert.equal(listener.agentDue,0);assert.equal(listener.acceptUser,false,'A name alone never authorizes work');
 assert.equal(recognition.target('Create a snack list.'),'sarah','A following request retains the selected listener');assert.equal(recognition.target('And Tia, read it.'),'tia');
 for(const text of ['Run Python to check the file','Take a screenshot of the app','Read the webpage I have open','Click the preview button','执行脚本'])assert(needsAgent(text),text);
 // Speech encoding is bounded, mono PCM at 16 kHz and clips overflow.
 const {speechWav}=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(path.join(__dirname,'../web/group-capture.js'),'utf8')).toString('base64'));
 const wav=speechWav(new Float32Array(48000).fill(.5),48000),view=new DataView(wav.buffer);assert.equal(wav.length,32044);assert.equal(view.getUint32(24,true),16000);assert.equal(view.getInt16(44,true),16383);
 // Late permission after Stop must release capture without opening a peer.
 let deliver;globalThis.AudioContext=class{resume(){return Promise.resolve();}close(){return Promise.resolve();}};Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:()=>new Promise(r=>deliver=r)}}});const waiting=live.start({cast:[],topic:'hello',human:{enabled:true}});await new Promise(r=>setTimeout(r,0));live.stop();deliver({getTracks:()=>[{stop(){released++;}}]});await waiting;assert.equal(live.peers.size,0);assert.equal(released,2);assert(!live.running);
 // Stop during negotiation settles the startup promise as well as releasing
 // every peer; a quick restart cannot leave an old Start handler suspended.
 const track={stop(){released++;}},node={connect(){},start(){},stop(){},gain:{value:0},offset:{value:0},stream:{getTracks:()=>[track]}};
 globalThis.Audio=class{pause(){}};
 globalThis.AudioContext=class{resume(){return Promise.resolve();}close(){return Promise.resolve();}createMediaStreamDestination(){return node;}createGain(){return {...node,gain:{value:0}};}createConstantSource(){return node;}};
 globalThis.LiveClient=class extends EventTarget{start(){return Promise.resolve();}stop(){}};
 const negotiating=live.start({cast:[{slug:'tia',name:'Tia'},{slug:'sarah',name:'Sarah'}],topic:'hello',human:{enabled:false}});
 await new Promise(r=>setTimeout(r,0));assert.equal(live.peers.size,2);live.stop();
 await Promise.race([negotiating,new Promise((_,reject)=>setTimeout(()=>reject(Error('Cancelled startup did not settle')),100))]);assert.equal(live.peers.size,0);
 console.log('Speech gate, noise rejection, stream cleanup, cancelled startup, relayed input isolation and turn completion passed.');
})().catch(e=>{console.error(String(e.stack||e).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'group-live.js'));process.exitCode=1;});
