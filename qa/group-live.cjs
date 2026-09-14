const fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
(async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../web/group-live.js'),'utf8').replace(/^import .*;$/gm,'');
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
 const humanPeer={slug:'tia',acceptUser:true,heard:false,segments:new Map(),audio:{},openAt:10,client:{reasoningMode:'delegate',conversation:()=>[],appendInstructions(){},appendCommentary:t=>spoken.push(t)}};grouped.peers.set('tia',humanPeer);
 grouped.transcript(humanPeer,{role:'user',id:'one',text:'Create an empty file named',final:false});
 grouped.interrupt(performance.now());grouped.userSpeaking=false;
 grouped.transcript(humanPeer,{role:'user',id:'two',text:'hello.txt in the selected folder.',final:false});humanPeer.humanChangedAt=performance.now()-500;
 const floor=humanPeer.openAt,tool=grouped.delegate(humanPeer,'split-turn');assert.equal(requests[0].humanRequest,'Create an empty file named hello.txt in the selected folder.');
 grouped.transcript(humanPeer,{role:'user',id:'two',text:'hello.txt in the selected folder.',final:true});assert.equal(humanPeer.openAt,floor,'Transcript final does not invalidate an active delegation');
 finishTool({ok:true,text:'Created hello.txt.'});await tool;assert.deepEqual(spoken,['Created hello.txt.']);
 humanPeer.heard=true;grouped.interrupt(performance.now());assert.equal(humanPeer.lastHumanText,'','A fresh human interruption cannot reuse earlier authorization');
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
})().catch(e=>{console.error(e);process.exitCode=1;});
