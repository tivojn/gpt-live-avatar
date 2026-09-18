'use strict';
// Gemini Live in the real app against a stand-in Google: Settings saves the key
// and the choice, a conversation opens with a single-use token (the key never
// reaches the window), the microphone streams 16 kHz PCM, her reply is heard,
// shown and lip-synced, a function call is answered by the app's own reasoning
// path, and switching back to GPT-Live-1 leaves that path as it was.
// No real network, key or microphone. Run: npx electron qa/gemini-app.cjs
const {app,BrowserWindow,systemPreferences}=require('electron'),fs=require('fs'),path=require('path'),http=require('http'),crypto=require('crypto'),assert=require('assert/strict');
const repo=process.env.GLA_SOURCE_ROOT||path.resolve(__dirname,'..'),out=process.env.GLA_QA_OUTPUT||repo+'/build/qa-gemini';
fs.rmSync(out+'/profile',{recursive:true,force:true});fs.mkdirSync(out+'/profile',{recursive:true});app.setPath('userData',out+'/profile');process.env.GLA_OPENAI_KEY='sk-qa-not-a-real-key-0123456789'; // reasoning is delegated to the OpenAI API here; the backend is a stand-in, so this key is never used
app.commandLine.appendSwitch('use-fake-device-for-media-stream');app.commandLine.appendSwitch('use-fake-ui-for-media-stream');app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
systemPreferences.getMediaAccessStatus=()=>'granted';systemPreferences.askForMediaAccess=async()=>true;
fs.writeFileSync(out+'/profile/config.json',JSON.stringify({avatar:'sarah',quality:'friendly',bubbleMode:'always',conversationSounds:false,wardrobeFlourish:false,instinctEnabled:false,agentEnabled:false,windowWidth:450,windowHeight:750,reasoningMode:'delegate',delegateProvider:'openai',delegateAuth:'api_key'}));
const KEY='AQ.qa-only_key-0123456789abcdefghij';
// ---- the stand-in: /v1beta/models, /v1beta/auth_tokens, and a WebSocket that speaks Gemini's Live protocol
const seen={http:[],sockets:[]};
const server=http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{
 seen.http.push({method:req.method,url:req.url,key:req.headers['x-goog-api-key'],body:body?JSON.parse(body):null});
 const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
 if(req.headers['x-goog-api-key']!==KEY)return json(400,{error:{message:'API key not valid. Please pass a valid API key.',status:'INVALID_ARGUMENT'}});
 if(req.url.startsWith('/v1beta/models'))return json(200,{models:[{name:'models/gemini-3.8-flash'},{name:'models/gemini-3.8-live'},{name:'models/gemini-3.8-live-extended-thinking'}]});
 if(req.url==='/v1beta/auth_tokens'&&req.method==='POST')return json(200,{name:'auth_tokens/qa-'+seen.http.length});
 json(404,{error:{message:'not found'}});});});
server.on('upgrade',(req,socket)=>{
 const accept=crypto.createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
 socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
 const peer={url:req.url,messages:[],audio:0,socket,send(message){const data=Buffer.from(JSON.stringify(message)),head=data.length<126?Buffer.from([0x82,data.length]):data.length<65536?Buffer.from([0x82,126,data.length>>8,data.length&255]):(()=>{const h=Buffer.alloc(10);h[0]=0x82;h[1]=127;h.writeBigUInt64BE(BigInt(data.length),2);return h;})();socket.write(Buffer.concat([head,data]));}};
 seen.sockets.push(peer);let buffer=Buffer.alloc(0);
 socket.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);
  for(;;){if(buffer.length<2)return;let length=buffer[1]&127,offset=2;if(length===126){if(buffer.length<4)return;length=buffer.readUInt16BE(2);offset=4;}else if(length===127){if(buffer.length<10)return;length=Number(buffer.readBigUInt64BE(2));offset=10;}
   if(buffer.length<offset+4+length)return;const op=buffer[0]&15,mask=buffer.subarray(offset,offset+4),payload=Buffer.from(buffer.subarray(offset+4,offset+4+length));buffer=buffer.subarray(offset+4+length);
   for(let i=0;i<payload.length;i++)payload[i]^=mask[i&3];if(op===8){socket.end();return;}if(op!==1&&op!==2)continue;
   const message=JSON.parse(payload.toString());if(message.realtimeInput?.audio){peer.audio++;peer.lastAudio=message.realtimeInput.audio;}else peer.messages.push(message);
   if(message.setup)peer.send({setupComplete:{}});}});
 socket.on('error',()=>{});
});
let template;const {Menu}=require('electron'),build=Menu.buildFromTemplate;Menu.buildFromTemplate=function(value){const menu=build.call(Menu,value);menu.popup=()=>{template=require('./menu-flat.cjs').flat(value);};return menu;};
const answers=[];require(repo+'/electron/delegate.cjs').DelegateBackend.prototype.answer=async(owner,id,config,history)=>{answers.push({id,history,writer:require(repo+'/electron/delegate.cjs').selected(config)});return {ok:true,text:'George Eliot wrote Middlemarch.',provider:'openai',model:'qa'};};
const errors=[];app.on('browser-window-created',(_e,w)=>{w.webContents.setBackgroundThrottling(false);w.webContents.on('console-message',d=>{if(d.level==='error')errors.push(d.message);});});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label,ms=60000){const end=Date.now()+ms;let last;while(Date.now()<end){try{const r=await fn();if(r)return r;}catch(e){last=e;}await wait(60);}throw Error('Timed out: '+label+' '+(last?.message||''));}
// 0.4 s of a 440 Hz tone as 24 kHz PCM, in four chunks: enough for the lip-sync and the speaking state to react.
const tone=()=>{const chunks=[];for(let c=0;c<4;c++){const b=Buffer.alloc(2400*2);for(let i=0;i<2400;i++)b.writeInt16LE(Math.round(Math.sin((c*2400+i)/24000*2*Math.PI*440)*12000),i*2);chunks.push(b.toString('base64'));}return chunks;};
server.listen(0,'127.0.0.1',()=>{
 const port=server.address().port;process.env.GLA_GEMINI_API=`http://127.0.0.1:${port}/v1beta`;process.env.GLA_GEMINI_SOCKET=`ws://127.0.0.1:${port}/ws/{version}/BidiGenerateContentConstrained`;
 require(repo+'/electron/main.cjs');
 app.whenReady().then(async()=>{try{
  const solo=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/avatar.html')),'solo window');
  const js=(w,code)=>w.webContents.executeJavaScript('(async()=>{'+code+'})()');
  await until(()=>js(solo,`return Boolean(window.gla_avatar?.options)&&!document.querySelector('#status').textContent.startsWith('Loading')`),'avatar ready');
  // ---- Settings: the voice model, the key (checked with Google before it is kept), model, thinking, voice
  await js(solo,"gla.openSettings('voice')");const st=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/settings.html')),'settings');
  await until(()=>js(st,"return document.querySelector('#liveProvider')?.value==='openai'&&document.querySelector('#geminiSection').hidden"),'GPT-Live-1 is the default, Gemini section folded away');
  await js(st,"const s=document.querySelector('#liveProvider');s.value='gemini';s.dispatchEvent(new Event('change'));return 1");
  await until(()=>js(st,"return !document.querySelector('#geminiSection').hidden&&/Needs a Gemini API key/.test(document.querySelector('#chip-voice').textContent)"),'Gemini section with a missing-key status');
  await js(st,"document.querySelector('#geminiKey').value='AQ.wrong-key_0123456789abcdefghijk';document.querySelector('#saveGeminiKey').click();return 1");
  await until(()=>js(st,"return /rejected this Gemini API key/.test(document.querySelector('#geminiKeyState').textContent)"),'a wrong key is refused by Google and not kept');assert(!fs.existsSync(out+'/profile/gemini-key.bin'));
  await js(st,`document.querySelector('#geminiKey').value=${JSON.stringify(KEY)};document.querySelector('#saveGeminiKey').click();return 1`);
  await until(()=>js(st,"return /Key saved\\. Available: Gemini 3\\.8 Live, Gemini 3\\.8 Live · Extended Thinking/.test(document.querySelector('#geminiKeyState').textContent)"),'key saved with the models it can use');
  assert(fs.existsSync(out+'/profile/gemini-key.bin'));assert(!fs.readFileSync(out+'/profile/gemini-key.bin').includes(KEY)||!require('electron').safeStorage.isEncryptionAvailable(),'stored encrypted');assert.equal(await js(st,"return document.querySelector('#geminiKey').value"),'','the field is cleared');
  assert.equal(await js(st,"return document.querySelector('#geminiThinkingRow').hidden"),true,'no thinking level for the standard model');
  await js(st,"const m=document.querySelector('#geminiModel');m.value='gemini-3.8-live-extended-thinking';m.dispatchEvent(new Event('change'));return 1");
  await until(()=>js(st,"return !document.querySelector('#geminiThinkingRow').hidden"),'thinking level appears for Extended Thinking');
  await js(st,"const t=document.querySelector('#geminiThinkingLevel');t.value='medium';t.dispatchEvent(new Event('change'));const v=document.querySelector('#geminiVoice');v.value='Kore';v.dispatchEvent(new Event('change'));return 1");
  await until(async()=>{const s=await js(st,'return gla.getSettings()');return s.liveProvider==='gemini'&&s.hasGeminiKey&&s.gemini.model==='gemini-3.8-live-extended-thinking'&&s.gemini.thinkingLevel==='medium'&&s.gemini.voice==='Kore';},'choices saved');
  assert.match(await js(st,"return document.querySelector('#chip-voice').textContent"),/Extended Thinking · Kore/);assert.equal(await js(st,"return document.querySelector('#geminiVoice').options.length"),30);
  assert(!JSON.stringify(await js(st,'return gla.getSettings()')).includes(KEY),'the key is not in the settings the windows receive');st.close();
  // ---- a conversation
  await until(()=>js(solo,"return /Ready/.test(document.querySelector('#status').textContent)"),'ready');
  template=null;await js(solo,"document.querySelector('#bubble').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true}))");await until(()=>template,'menu');assert.equal(template.find(x=>x.label==='Start Conversation').enabled,true,'the Gemini key is the one that counts');
  await js(solo,'gla_call()');await until(()=>js(solo,"return gla_debug().state==='connected'"),'connected');
  const tokenRequest=seen.http.find(r=>r.url==='/v1beta/auth_tokens');assert.equal(tokenRequest.key,KEY);assert.equal(tokenRequest.body.uses,1);assert.equal(tokenRequest.body.bidiGenerateContentSetup.model,'models/gemini-3.8-live-extended-thinking');assert.match(tokenRequest.body.bidiGenerateContentSetup.systemInstruction.parts[0].text,/^You are Sarah/,'the whole setup is sealed into the token');assert(!('fieldMask' in tokenRequest.body));
  const peer=seen.sockets.at(-1);assert.match(peer.url,/^\/ws\/v1beta\/BidiGenerateContentConstrained\?access_token=auth_tokens%2Fqa-\d+$/);assert(!peer.url.includes(KEY));
  const setup=peer.messages[0].setup;assert.equal(setup.model,'models/gemini-3.8-live-extended-thinking');assert.deepEqual(setup.generationConfig.thinkingConfig,{thinkingLevel:'MEDIUM'});assert.equal(setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName,'Kore');
  const prompt=setup.systemInstruction.parts[0].text;assert.match(prompt,/^You are Sarah, the voice of an animated 3D companion/);assert.match(prompt,/Hand-off policy: you have one function, ask_assistant/);assert(!/Delegation policy:\nBackend tools/.test(prompt),'GPT-Live-1’s backend wording is not sent to Gemini');assert.match(prompt,/installed body animations/);
  assert.equal(setup.tools[0].functionDeclarations[0].behavior,'NON_BLOCKING');
  await until(()=>peer.audio>20,'the microphone streams');assert.equal(peer.lastAudio.mimeType,'audio/pcm;rate=16000');assert.equal(Buffer.from(peer.lastAudio.data,'base64').length,1280,'40 ms blocks of 16-bit mono');
  assert.equal(await js(solo,"return document.querySelector('#status').textContent"),'Live. Talk to me.');
  // she hears a question, says she will check, and calls her function; the app answers it through its reasoning path
  peer.send({serverContent:{inputTranscription:{text:'Who wrote the novel Middlemarch?'}}});
  peer.send({serverContent:{outputTranscription:{text:'Let me check.'},modelTurn:{parts:tone().slice(0,1).map(data=>({inlineData:{mimeType:'audio/pcm;rate=24000',data}}))}},interactionStatus:'IN_PROGRESS'});
  peer.send({serverContent:{turnComplete:true},interactionStatus:'IN_PROGRESS'});
  peer.send({toolCall:{functionCalls:[{id:'fc-1',name:'ask_assistant',args:{request:'Who wrote the novel Middlemarch?'}}]}});
  const response=await until(()=>peer.messages.find(m=>m.toolResponse),'the function response');
  assert.deepEqual(response.toolResponse.functionResponses,[{id:'fc-1',name:'ask_assistant',response:{result:'George Eliot wrote Middlemarch.'}}]);
  assert.equal(answers.length,1);assert.deepEqual(answers[0].history.at(-2),{role:'user',text:'Who wrote the novel Middlemarch?'},'the reasoning engine got the user’s own words from the local transcript');assert.deepEqual(answers[0].writer,{provider:'openai',auth:'api_key',model:'gpt-5.6-luna'});
  // she gives the answer: heard, shown, lip-synced
  for(const data of tone())peer.send({serverContent:{modelTurn:{parts:[{inlineData:{mimeType:'audio/pcm;rate=24000',data}}]}}});
  peer.send({serverContent:{outputTranscription:{text:'George Eliot wrote it.'}}});
  await until(()=>js(solo,"return /George Eliot wrote it/.test(document.querySelector('#lineAssistant').textContent)"),'her words in the bubble');
  await until(()=>js(solo,'return gla_debug().speaking===true'),'her voice drives the speaking state and the mouth',15000);
  assert.match(await js(solo,"return document.querySelector('#lineUser').textContent"),/Middlemarch/);
  peer.send({serverContent:{turnComplete:true},interactionStatus:'IDLE'});
  // Stop Talking is immediate and told to her; ending hangs up
  await js(solo,"document.querySelector('#hushBtn')?.click()");await until(()=>peer.messages.some(m=>/Stop speaking now/.test(m.realtimeInput?.text||'')),'Stop Talking reaches Gemini as a note');
  await js(solo,'gla_call()');await until(()=>js(solo,"return gla_debug().state==='idle'"),'ended');await until(()=>peer.socket.destroyed||peer.socket.readableEnded,'socket closed',10000);
  fs.writeFileSync(out+'/after.png',(await solo.webContents.capturePage()).toPNG());
  // ---- back to GPT-Live-1: the old path, asking for its own key
  await js(solo,"await gla.setSettings({liveProvider:'openai'})");await until(()=>js(solo,"return /Add your OpenAI key/.test(document.querySelector('#status').textContent)||true"),'provider switched');
  const refused=await js(solo,"return gla.createLiveSession('',{provider:'gemini',history:[]})");assert.equal(refused.ok,false);assert.match(refused.error,/not the selected voice model/,'a window cannot obtain a Gemini token while GPT-Live-1 is selected');
  assert.deepEqual(errors.filter(e=>!/Autofill|DevTools|srtp/.test(e)),[],'no console errors');
  console.log('Gemini app QA passed: Settings and key check, single-use token, setup and hand-off prompt, 16 kHz microphone stream ('+peer.audio+' blocks), function call answered by the reasoning path, reply heard/shown/lip-synced, Stop Talking, hang-up, provider guard.');
 }catch(e){console.error(e);console.error(errors.slice(-5));process.exitCode=1;}finally{server.close();app.exit(process.exitCode||0);}});
});
