'use strict';
// The Gemini Live client without a network or an audio device: it must look to
// the window exactly like the GPT-Live client (same events, same methods) while
// speaking Gemini's protocol on the socket.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const web=path.join(__dirname,'..','web');
// ES modules of the app import each other by absolute path; inline them as data URLs, innermost first.
const inline=file=>'data:text/javascript;base64,'+Buffer.from(fs.readFileSync(path.join(web,file),'utf8').replace(/from '\/([a-z-]+\.js)'/g,(_m,f)=>`from '${inline(f)}'`)).toString('base64');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
class FakeSocket{
 static all=[];static refuse=new Set();
 constructor(url){this.url=url;this.sent=[];this.readyState=0;FakeSocket.all.push(this);
  setTimeout(()=>{if(FakeSocket.refuse.has(url.split('?')[0])){this.readyState=3;this.onclose?.({code:1006,reason:''});return;}this.readyState=1;this.onopen?.();},1);}
 send(data){this.sent.push(JSON.parse(data));if(this.sent.length===1&&this.sent[0].setup&&!this.silent)setTimeout(()=>this.server({setupComplete:{}}),1);}
 server(message,binary=true){this.onmessage?.({data:binary?new TextEncoder().encode(JSON.stringify(message)).buffer:JSON.stringify(message)});}
 close(code){if(this.readyState===3)return;this.readyState=3;this.closedWith=code;this.onclose?.({code:code||1005,reason:''});}
 drop(){this.readyState=3;this.onclose?.({code:1006,reason:''});}
}
function fakeAudio(){
 const log={played:[],flushed:0,micClosed:0,speakerClosed:0,onChunk:null,tracks:[{enabled:true}]};
 return {log,openSpeaker:async()=>({stream:{id:'her-voice'},play:b=>log.played.push(Buffer.from(b).toString('hex')),flush:()=>{log.flushed++;},close:()=>{log.speakerClosed++;}}),
  openMicrophone:async({onChunk})=>{log.onChunk=onChunk;return {stream:{getAudioTracks:()=>log.tracks},close:()=>{log.micClosed++;}};}};
}
const pcm=hex=>Buffer.from(hex,'hex').toString('base64');
(async()=>{
 const {GeminiLiveClient}=await import(inline('gemini-live-client.js')),{LiveSession}=await import(inline('live-session.js'));
 const requests=[];let handleSeen=[];
 const createSession=async(sdp,options)=>{requests.push({sdp,options});handleSeen.push(options.resumeHandle);return {ok:true,provider:'gemini',model:'gemini-3.8-live',voice:'Aoede',tool:'ask_assistant',thinking:false,reasoningMode:'delegate',urls:['wss://x/v1beta?access_token=t','wss://x/v1alpha?access_token=t'],setup:{setup:{model:'models/gemini-3.8-live'}}};};
 const make=()=>{const audio=fakeAudio(),client=new GeminiLiveClient({createSession,WebSocketImpl:FakeSocket,audio}),events=[];
  for(const type of ['state','error','event','remote-track','usage','transcript','turn-start','muted'])client.addEventListener(type,e=>events.push([type,e.detail]));return {client,audio,events,of:type=>events.filter(e=>e[0]===type).map(e=>e[1])};};
 // ---- start: the older endpoint is tried when the first refuses, setup goes first, then she is connected
 FakeSocket.refuse.add('wss://x/v1beta');let t=make();await t.client.start({voice:'Aoede',history:[{role:'user',text:'earlier'}]});FakeSocket.refuse.clear();
 assert.deepEqual(t.of('state').map(s=>s.state),['connecting','connected']);assert.equal(requests[0].sdp,'');assert.equal(requests[0].options.provider,'gemini');assert.deepEqual(requests[0].options.history,[{role:'user',text:'earlier'}]);
 let socket=t.client.socket;assert.equal(socket.url,'wss://x/v1alpha?access_token=t');assert.deepEqual(socket.sent[0],{setup:{model:'models/gemini-3.8-live'}});
 assert.deepEqual(t.of('remote-track'),[{stream:{id:'her-voice'}}],'her voice is a stream the window attaches like a WebRTC track');assert.equal(t.client.reasoningMode,'delegate');assert.equal(t.client.microphone.getAudioTracks()[0].enabled,true);
 // ---- microphone out: 16 kHz PCM, and nothing while muted
 t.audio.log.onChunk(new Uint8Array([1,2,3,4]));assert.deepEqual(socket.sent.at(-1),{realtimeInput:{audio:{data:pcm('01020304'),mimeType:'audio/pcm;rate=16000'}}});
 t.client.setMuted(true);assert.deepEqual(socket.sent.at(-1),{realtimeInput:{audioStreamEnd:true}});assert.equal(t.audio.log.tracks[0].enabled,false);assert.deepEqual(t.of('muted'),[{muted:true}]);
 const before=socket.sent.length;t.audio.log.onChunk(new Uint8Array([9,9]));t.client.setMuted(true);assert.equal(socket.sent.length,before,'no audio and no second stream-end while muted');t.client.setMuted(false);assert.equal(t.audio.log.tracks[0].enabled,true);
 // ---- her turn: audio is played, transcripts become the app's transcript events, the user's turn closes when she begins
 socket.server({serverContent:{inputTranscription:{text:'What is '}}});socket.server({serverContent:{inputTranscription:{text:'the time?'}}},false);
 socket.server({serverContent:{modelTurn:{parts:[{inlineData:{mimeType:'audio/pcm;rate=24000',data:pcm('0a0b0c0d')}}]},outputTranscription:{text:'It is '}}});
 socket.server({serverContent:{outputTranscription:{text:'noon.'}}});socket.server({serverContent:{turnComplete:true},usageMetadata:{totalTokenCount:321}});
 assert.deepEqual(t.audio.log.played,['0a0b0c0d']);
 const finals=t.of('transcript').filter(x=>x.final).map(x=>[x.role,x.text]);assert.deepEqual(finals,[['user','What is the time?'],['assistant','It is noon.']]);
 assert.deepEqual(t.client.conversation().slice(-2),[{role:'user',text:'What is the time?'},{role:'assistant',text:'It is noon.'}]);assert.deepEqual(t.of('turn-start').map(x=>x.role),['user','assistant']);
 // ---- the user speaks over her: what is queued is not heard
 socket.server({serverContent:{outputTranscription:{text:'Let me tell you a long'}}});socket.server({serverContent:{interrupted:true}});
 assert.equal(t.audio.log.flushed,1);assert.deepEqual(t.of('transcript').at(-1),{role:'assistant',id:t.of('transcript').at(-1).id,text:'Let me tell you a long',final:true});
 // ---- her one function is the app's delegation
 socket.server({toolCall:{functionCalls:[{id:'call-1',name:'ask_assistant',args:{request:'What is 17 times 23?'}},{id:'call-2',name:'format_disk',args:{}}]}});
 assert.deepEqual(t.of('event').filter(e=>e.type==='session.delegation.created'),[{type:'session.delegation.created',delegation:{id:'call-1',target:'client',request:'What is 17 times 23?'}}],'announced the way GPT-Live-1 announces a delegation');
 assert.deepEqual(socket.sent.at(-1),{toolResponse:{functionResponses:[{id:'call-2',name:'format_disk',response:{error:'This function is not available.'}}]}},'a function the app never declared is refused, not run');
 assert.equal(t.client.appendCommentary('17 times 23 ','call-1'),true);assert.equal(t.client.appendCommentary('is 391.','call-1'),true);const sentBefore=socket.sent.length;await wait(70);
 assert.equal(socket.sent.length,sentBefore+1,'the chunks of one answer are one function response');
 assert.deepEqual(socket.sent.at(-1),{toolResponse:{functionResponses:[{id:'call-1',name:'ask_assistant',response:{result:'17 times 23 is 391.'},scheduling:'INTERRUPT'}]}});
 assert.equal(t.client.appendCommentary('late duplicate','call-1'),false,'an answered hand-off takes no second result');
 socket.server({toolCall:{functionCalls:[{id:'call-3',name:'ask_assistant',args:{request:'x'}}]}});socket.server({toolCallCancellation:{ids:['call-3']}});
 assert.equal(t.client.appendCommentary('stale','call-3'),false,'a cancelled hand-off is not answered, and its result is not spoken as a note');
 // ---- notes from the app, and Stop Talking
 // Extended Thinking schedules its own speech: Google closes the socket (1007) if a scheduling field is sent to it
 t.client.thinking=true;socket.server({toolCall:{functionCalls:[{id:'call-4',name:'ask_assistant',args:{request:'y'}}]}});t.client.appendCommentary('done','call-4');await wait(70);
 assert.deepEqual(socket.sent.at(-1),{toolResponse:{functionResponses:[{id:'call-4',name:'ask_assistant',response:{result:'done'}}]}});t.client.thinking=false;
 t.client.appendCommentary('Verified music-control result: playing.');assert.match(socket.sent.at(-1).realtimeInput.text,/^\(Application note, not said by the user\. Never read it aloud\.\) Verified music-control result: playing\.$/);
 t.client.appendInstructions('The avatar is now Sarah.');assert.match(socket.sent.at(-1).realtimeInput.text,/The avatar is now Sarah\. Do not reply to this note\.$/);
 t.client.userText('And tomorrow?');assert.deepEqual(socket.sent.at(-1),{realtimeInput:{text:'And tomorrow?'}},'what the user typed goes as their own words, not as an application note');
 assert.equal(t.client.send({type:'session.close'}),false,'GPT-Live event objects are not forwarded to Gemini');
 socket.server({serverContent:{outputTranscription:{text:'And another thing'}}});t.client.stopSpeaking();assert.equal(t.audio.log.flushed,2);const played=t.audio.log.played.length;
 socket.server({serverContent:{modelTurn:{parts:[{inlineData:{mimeType:'audio/pcm',data:pcm('ffff')}}]},outputTranscription:{text:' I was saying'}}});
 assert.equal(t.audio.log.played.length,played,'the rest of the turn she was asked to stop is dropped');socket.server({serverContent:{turnComplete:true}});
 socket.server({serverContent:{modelTurn:{parts:[{inlineData:{mimeType:'audio/pcm',data:pcm('1111')}}]}}});assert.equal(t.audio.log.played.length,played+1,'the next turn is heard again');
 // ---- Extended Thinking: only IDLE means she is done
 socket.server({interactionStatus:'IN_PROGRESS'});socket.server({serverContent:{turnComplete:true},interaction_status:'IN_PROGRESS'});assert.equal(t.client.working,true);
 socket.server({serverContent:{interactionStatus:'IDLE'}});assert.equal(t.client.working,false);assert.deepEqual(t.of('event').filter(e=>e.type==='gemini.interaction').map(e=>e.working),[true,false]);
 // ---- a dropped or expiring connection resumes with the handle, quietly
 socket.server({sessionResumptionUpdate:{newHandle:'h-1',resumable:true}});socket.server({sessionResumptionUpdate:{newHandle:'h-bad',resumable:false}});
 socket.drop();await wait(30);assert.equal(t.client.state,'connected');assert.notEqual(t.client.socket,socket);assert.equal(handleSeen.at(-1),'h-1','the last resumable handle');
 assert.deepEqual(t.of('event').filter(e=>/resum/.test(e.type)).map(e=>e.type),['gemini.resuming','gemini.resumed']);assert.deepEqual(requests.at(-1).options.history.slice(-1),[{role:'assistant',text:'And another thing'}],'and what was said, should the handle not be honoured');
 socket=t.client.socket;socket.server({sessionResumptionUpdate:{newHandle:'h-2',resumable:true}});socket.server({goAway:{timeLeft:'5s'}});await wait(30);
 assert.notEqual(t.client.socket,socket);assert.equal(handleSeen.at(-1),'h-2');assert.equal(t.of('state').at(-1).state,'connected','the window never saw it drop');
 // ---- the end
 const live=t.client.socket;t.client.stop('user');assert.equal(live.closedWith,1000);assert.equal(t.audio.log.micClosed,1);assert.equal(t.audio.log.speakerClosed,1);
 assert.deepEqual(t.of('state').at(-1),{state:'idle',reason:'user'});assert(t.of('usage')[0].duration_seconds>=0);assert.equal(t.of('usage')[0].tokens,321);assert.equal(t.client.microphone,null);
 // without a handle a lost connection ends the conversation
 t=make();await t.client.start({});t.client.socket.drop();await wait(10);assert.deepEqual(t.of('state').at(-1),{state:'idle',reason:'connection_lost'});
 // a refused session is an error the window shows, and everything is released
 t=make();const failing=new GeminiLiveClient({createSession:async()=>({ok:false,error:'Add your Gemini API key in Settings first.'}),WebSocketImpl:FakeSocket,audio:t.audio}),seen=[];
 failing.addEventListener('error',e=>seen.push(e.detail.message));await failing.start({});assert.deepEqual(seen,['Add your Gemini API key in Settings first.']);assert.equal(failing.state,'idle');assert.equal(t.audio.log.micClosed,1);
 // ---- one session object for the window, either provider
 const fake=name=>Object.assign(new EventTarget(),{name,state:'idle',muted:false,history:[],started:[],start(o){this.started.push(o);this.state='connected';this.dispatchEvent(new CustomEvent('state',{detail:{state:'connected'}}));return Promise.resolve();},stop(reason){this.state='idle';this.dispatchEvent(new CustomEvent('state',{detail:{state:'idle',reason}}));},conversation(){return [{role:'user',text:name}];},appendCommentary(t,id){this.last=[t,id];return true;}});
 const clients={openai:fake('openai'),gemini:fake('gemini')};let provider='openai';const session=new LiveSession({createSession,provider:()=>provider,clients}),states=[];
 session.addEventListener('state',e=>states.push(session.providerName+':'+e.detail.state));
 await session.start({voice:'marin'});assert.equal(session.providerName,'openai');assert.equal(session.state,'connected');clients.openai.history=[{role:'user',text:'kept'}];
 provider='gemini';await session.start({});assert.equal(session.providerName,'openai','a running conversation is not switched under the user');
 clients.gemini.dispatchEvent(new CustomEvent('state',{detail:{state:'connected'}}));assert.deepEqual(states,['openai:connected'],'events of the idle client are not forwarded');
 await session.restart('marin');assert.equal(session.providerName,'gemini');assert.deepEqual(clients.gemini.started[0],{history:[{role:'user',text:'kept'}],voice:'marin',resumed:true,muted:false},'the transcript crosses over with the switch');
 assert.deepEqual(states,['openai:connected','openai:idle','gemini:connected']);session.appendCommentary('note','d1');assert.deepEqual(clients.gemini.last,['note','d1']);assert.deepEqual(session.conversation(),[{role:'user',text:'gemini'}]);
 console.log('Gemini Live (client): endpoint fallback, PCM in and out, transcripts, barge-in, function call as delegation, notes, Stop Talking, interaction status, quiet resume, one session object for both providers.');
 process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
