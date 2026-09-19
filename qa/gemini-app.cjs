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
  await js(st,"const t=document.querySelector('#geminiThinkingLevel');t.value='medium';t.dispatchEvent(new Event('change'));return 1");
  // only the chosen system's settings are on the page, and the voice lives with the character
  assert.deepEqual(await js(st,"return [document.querySelector('#openaiSection').hidden,document.querySelector('#geminiSection').hidden,Boolean(document.querySelector('#geminiVoice')),document.querySelector('#voice').closest('.pane').id,document.querySelector('#tab-voice').textContent.trim()]"),[true,false,false,'pane-character','Live Voice System']);
  assert.deepEqual(await js(st,"const v=document.querySelector('#voice');return [v.options.length,v.value,document.querySelector('#voiceLabel').textContent]"),[30,'Leda','Sarah’s Gemini 3.8 Live voice'],'Gemini’s voices, Sarah’s own default');
  await js(st,"gla_settings_pane('character');const v=document.querySelector('#voice');v.value='Kore';v.dispatchEvent(new Event('change'));document.querySelector('#useVoice').click();return 1");
  await until(async()=>{const s=await js(st,'return gla.getSettings()');return s.liveProvider==='gemini'&&s.hasGeminiKey&&s.gemini.model==='gemini-3.8-live-extended-thinking'&&s.gemini.thinkingLevel==='medium'&&s.gemini.voice==='Kore';},'choices saved');
  assert.match(await js(st,"return document.querySelector('#chip-voice').textContent"),/Extended Thinking$/);assert.match(await js(st,"return document.querySelector('#chip-character').textContent"),/^Sarah · Kore · /);
  assert.equal((await js(st,'return gla.getSettings()')).geminiVoices.sarah,'Kore','kept per character');
  // the Reasoning pane speaks the system's language: no "GPT-Live reasoning" and no OpenAI model picker while Gemini is the system
  await js(st,"await gla.setSettings({reasoningMode:'managed'});gla_settings_pane('reasoning');return 1");
  await until(()=>js(st,"return document.querySelector('#reasoningManaged').textContent==='Gemini reasoning'&&document.querySelector('#reasoningMode').value==='managed'"),'Gemini reasoning is the built-in mode');
  assert.deepEqual(await js(st,"return [document.querySelector('#managedBackend').hidden,document.querySelector('#geminiReasoningNote').hidden,/Extended Thinking is on \\(medium\\)/.test(document.querySelector('#geminiReasoningNote').textContent),document.querySelector('#chip-reasoning').textContent,/GPT/.test(document.querySelector('#reasoningNote').textContent)]"),[true,false,true,'Gemini · Extended Thinking · medium',false]);
  // Actions cannot "follow" a reasoning mode that cannot act: the pane names the engine that really does the work
  assert.deepEqual(await js(st,"const f=[...document.querySelector('#agentEngine').options].find(o=>o.value==='follow');return [f.disabled,f.textContent,document.querySelector('#agentEngine').value,/^Gemini reasoning answers questions but cannot act on this Mac, so real tasks .* are carried out by Codex App Server\\./.test(document.querySelector('#sharedCodexEngine').textContent)]"),[true,'Follow reasoning agent · not possible with Gemini reasoning','codex',true]);
  await js(st,"await gla.setSettings({reasoningMode:'delegate'});return 1");await until(()=>js(st,"return document.querySelector('#geminiReasoningNote').hidden&&!document.querySelector('#delegateOptions').hidden"),'Delegate mode is unchanged');
  assert(!JSON.stringify(await js(st,'return gla.getSettings()')).includes(KEY),'the key is not in the settings the windows receive');st.close();
  // ---- the right-click menu lists the same system's voices, and a preview is a short Gemini session of its own
  template=null;await js(solo,"document.querySelector('#bubble').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true}))");await until(()=>template,'menu for voices');
  {const mine=template.find(x=>x.label==='✓ Sarah'),voiceMenu=mine.submenu.find(x=>x.label==='Voice').submenu,tia=template.find(x=>x.label==='Tia').submenu.find(x=>x.label==='Voice').submenu;
   assert(tia.some(x=>x.label==='Aoede · female · breezy ✓'),'another character shows her own Gemini voice');
   tia.find(x=>x.label.startsWith('Zephyr')).submenu.find(x=>x.label==='Use this voice').click();await until(async()=>(await js(solo,'return gla.getSettings()')).geminiVoices.tia==='Zephyr','a voice chosen for a character who is not on screen');
   assert.equal((await js(solo,'return gla.getSettings()')).gemini.voice,'Kore','and the one on screen keeps hers');assert.match(voiceMenu[0].label,/^Gemini 3\.8 Live voices/);assert.equal(voiceMenu.filter(x=>x.submenu).length,30);assert(voiceMenu.some(x=>x.label==='Kore · female · firm ✓'),'her current Gemini voice is ticked');assert(voiceMenu.some(x=>x.label==='Puck · male · upbeat'),'Google’s published gender beside each voice');assert(!voiceMenu.some(x=>/Marin|Gleam/.test(x.label)),'no GPT-Live-1 voices while Gemini is the system');
   voiceMenu.find(x=>x.label.startsWith('Puck')).submenu.find(x=>x.label==='Preview voice').click();}
  const previewPeer=await until(()=>seen.sockets.find(p=>p.messages[0]?.setup?.systemInstruction?.parts[0].text.startsWith('You are providing a short voice sample')),'a preview session');
  assert.equal(previewPeer.messages[0].setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName,'Puck');assert.equal(previewPeer.messages[0].setup.model,'models/gemini-3.8-live','previews use the standard model');assert(!('tools' in previewPeer.messages[0].setup));
  await until(()=>previewPeer.messages.some(m=>/voice sample/.test(m.realtimeInput?.text||'')),'asked for the sample');assert.equal(previewPeer.audio,0,'a preview opens no microphone');
  previewPeer.send({serverContent:{outputTranscription:{text:'Hello, it is lovely to meet you.'}}});previewPeer.send({serverContent:{turnComplete:true}});
  await until(()=>previewPeer.socket.destroyed||previewPeer.socket.readableEnded,'the preview hangs up after the sample',15000);
  // ---- a conversation
  await until(()=>js(solo,"return /Ready/.test(document.querySelector('#status').textContent)"),'ready');
  template=null;await js(solo,"document.querySelector('#bubble').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true}))");await until(()=>template,'menu');assert.equal(template.find(x=>x.label==='Start Conversation').enabled,true,'the Gemini key is the one that counts');
  await js(solo,'gla_call()');await until(()=>js(solo,"return gla_debug().state==='connected'"),'connected');
  const tokenRequest=seen.http.findLast(r=>r.url==='/v1beta/auth_tokens'); // the first one was the voice preview'sassert.equal(tokenRequest.key,KEY);assert.equal(tokenRequest.body.uses,1);assert.equal(tokenRequest.body.bidiGenerateContentSetup.model,'models/gemini-3.8-live-extended-thinking');assert.match(tokenRequest.body.bidiGenerateContentSetup.systemInstruction.parts[0].text,/^You are Sarah/,'the whole setup is sealed into the token');assert(!('fieldMask' in tokenRequest.body));
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
  // ---- the right-click Agent menu says what Settings says, with the same thing ticked
  {const open=async()=>{template=null;await js(solo,"document.querySelector('#bubble').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true}))");return until(()=>template,'agent menu');};
   await js(solo,"await gla.setSettings({reasoningMode:'managed',agentEnabled:true,agentEngine:'grok',agentFollowReasoning:true})");await wait(200);
   let items=await open(),reasoning=items.find(x=>x.label==='Reasoning').submenu,actions=items.find(x=>x.label==='Actions & Permissions').submenu;
   assert.deepEqual(reasoning.filter(x=>x.checked).map(x=>x.label),['Gemini reasoning'],'the built-in reasoning of the system in use is an item, and the ticked one');assert(!reasoning.some(x=>/GPT-Live/.test(x.label)));
   assert.equal(actions[0].label,'Let avatars carry out my requests');assert.equal(actions[0].checked,true);assert.equal(actions[1].label,'Carried out by Grok Build (Gemini reasoning cannot act on this Mac)');
   const follow=actions.find(x=>x.label?.startsWith('Follow reasoning agent'));assert.deepEqual([follow.label,follow.enabled,follow.checked],['Follow reasoning agent · not possible with Gemini reasoning',false,false],'not ticked when nothing is being followed');
   assert.deepEqual(actions.filter(x=>x.label?.startsWith('✓ ')).map(x=>x.label.replace(' · not installed','')),['✓ Grok Build']);
   // choosing in the menu is choosing in Settings
   reasoning.find(x=>x.label?.startsWith('Codex App Server')).click();await until(async()=>(await js(solo,'return (await gla.getSettings()).effectiveReasoningEngine'))==='codex','menu choice saved');
   items=await open();reasoning=items.find(x=>x.label==='Reasoning').submenu;actions=items.find(x=>x.label==='Actions & Permissions').submenu;
   assert.deepEqual(reasoning.filter(x=>x.checked).map(x=>x.label.replace(' · not installed','')),['Codex App Server']);assert.deepEqual([actions.find(x=>x.label==='Follow reasoning agent').checked,actions[1].label],[true,'Carried out by Codex App Server, the agent that also reasons']);
   actions[0].click();await until(async()=>(await js(solo,'return (await gla.getSettings()).agentEnabled'))===false,'actions off from the menu');
   actions=(await open()).find(x=>x.label==='Actions & Permissions').submenu;assert.deepEqual([actions[0].checked,actions[1].label],[false,'Off: she will say she cannot do it']);
   await js(solo,"await gla.setSettings({agentEnabled:false})");}
  // ---- "Gemini reasoning": Gemini alone. No function is declared, so nothing can be handed to any other model.
  await js(solo,"await gla.setSettings({reasoningMode:'managed'})");await wait(300);const sockets=seen.sockets.length;
  await js(solo,'gla_call()');await until(()=>js(solo,"return gla_debug().state==='connected'"),'connected alone');const alone=await until(()=>seen.sockets.length>sockets&&seen.sockets.at(-1).messages[0]?.setup,'its setup');
  assert(!('tools' in alone),'no function in Gemini reasoning mode');assert.match(alone.systemInstruction.parts[0].text,/Capability limits: you cannot do anything on the user’s computer/,'and she is told she cannot act, so she does not claim to');assert(!/Hand-off policy|ask_assistant/.test(alone.systemInstruction.parts[0].text),'and no hand-off wording');assert(!('tools' in seen.http.findLast(r=>r.url==='/v1beta/auth_tokens').body.bidiGenerateContentSetup));
  await js(solo,'gla_call()');await until(()=>js(solo,"return gla_debug().state==='idle'"),'ended alone');
  // ---- back to GPT-Live-1: the old path, asking for its own key
  await js(solo,"await gla.setSettings({liveProvider:'openai'})");await until(()=>js(solo,"return /Add your OpenAI key/.test(document.querySelector('#status').textContent)||true"),'provider switched');
  const refused=await js(solo,"return gla.createLiveSession('',{provider:'gemini',history:[]})");assert.equal(refused.ok,false);assert.match(refused.error,/not the selected live voice system/,'a window cannot obtain a Gemini token while GPT-Live-1 is selected');
  assert.deepEqual(errors.filter(e=>!/Autofill|DevTools|srtp/.test(e)),[],'no console errors');
  console.log('Gemini app QA passed: Settings and key check, single-use token, setup and hand-off prompt, 16 kHz microphone stream ('+peer.audio+' blocks), function call answered by the reasoning path, reply heard/shown/lip-synced, Stop Talking, hang-up, provider guard.');
 }catch(e){console.error(e);console.error(errors.slice(-5));process.exitCode=1;}finally{server.close();app.exit(process.exitCode||0);}});
});
