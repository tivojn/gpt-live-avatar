// Real settings, native menu, IPC, session creation and renderer handoff;
// only provider network responses and the WebRTC transport are simulated.
const {app,BrowserWindow,Menu,safeStorage}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const repo=path.resolve(__dirname,'..'),output=path.join(repo,'build/qa-delegate-app');fs.mkdirSync(output,{recursive:true});
app.setPath('userData',path.join(output,'profile'));fs.mkdirSync(app.getPath('userData'),{recursive:true});delete process.env.GLA_OPENAI_KEY;
fs.writeFileSync(path.join(app.getPath('userData'),'config.json'),JSON.stringify({avatar:'tia',agentEnabled:false,quality:'friendly',bubbleMode:'off',avatarLooks:{tia:{}}}));
app.whenReady().then(()=>fs.writeFileSync(path.join(app.getPath('userData'),'openai-key.bin'),safeStorage.encryptString('sk-test-not-a-real-key')));
const calls=[],errors=[];let menu;
const build=Menu.buildFromTemplate;Menu.buildFromTemplate=function(items){const m=build.call(Menu,items);m.popup=()=>menu=require('./menu-flat.cjs').flat(items);return m;};
const actualFetch=global.fetch;
global.fetch=async(url,options={})=>{
 const address=String(url);if(!address.startsWith('https://api.openai.com/')&&!address.startsWith('https://api.x.ai/'))return actualFetch(url,options);
 const body=options.body?JSON.parse(options.body):null;calls.push({url:address,body});
 if(address.endsWith('/models'))return new Response(JSON.stringify({data:[{id:'gpt-5.6-luna'},{id:'gpt-live-1'},{id:'grok-4.6'}]}),{headers:{'Content-Type':'application/json'}});
 if(address.endsWith('/live/sessions'))return new Response(JSON.stringify({id:'test-live-'+calls.length,transport:{type:'webrtc',sdp:'test-answer'}}),{headers:{'Content-Type':'application/json'}});
 return new Response('data: '+JSON.stringify({type:'response.output_text.delta',delta:'The answer is 42.'})+'\n\ndata: '+JSON.stringify({type:'response.completed'})+'\n\n',{headers:{'Content-Type':'text/event-stream'}});
};
app.on('browser-window-created',(_e,w)=>w.webContents.on('console-message',d=>{if(d.level==='error')errors.push(d.message);}));
require('../electron/main.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){const end=Date.now()+90000;while(Date.now()<end){if(await fn())return;await wait(100);}throw Error('Timed out: '+label);}
app.whenReady().then(async()=>{try{
 let win;await until(()=>win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/avatar.html')),'avatar');
 const js=code=>win.webContents.executeJavaScript(`(async()=>{${code}})()`);
 await until(()=>js('return Boolean(window.gla_live);'),'client');await js('await gla.openSettings();');
 let settings;await until(()=>settings=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/settings.html')),'settings');
 const sj=code=>settings.webContents.executeJavaScript(`(async()=>{${code}})()`);
 await until(()=>sj("return document.querySelector('#reasoningMode').value==='managed'"),'settings ready');
 const choose=async(id,value)=>{await sj(`const e=document.querySelector('#${id}');e.value='${value}';e.dispatchEvent(new Event('change'));`);await wait(150);};
 await choose('reasoningMode','delegate');assert.equal(await sj("return document.querySelector('#delegateOptions').hidden"),false);assert.equal(await sj("return document.querySelector('#delegateModel').value"),'gpt-5.6-luna');
 await choose('delegateAuth','oauth2');assert.equal(await sj("return document.querySelector('#delegateModel').value"),'gpt-5.6-sol');assert.equal(await sj("return document.querySelector('#delegateLogin').hidden"),false);
 await choose('delegateProvider','xai');assert.equal(await sj("return document.querySelector('#delegateModel').value"),'grok-4.6');assert.match(await sj("return document.querySelector('#signIn').textContent"),/xAI/);
 await choose('delegateAuth','api_key');assert.equal(await sj("return document.querySelector('#xaiDelegateKey').hidden"),false);
 await choose('delegateProvider','openai');assert.equal(await sj("return document.querySelector('#delegateModel').value"),'gpt-5.6-luna');
 await sj("document.querySelector('#testDelegate').click();");await until(()=>sj("return document.querySelector('#delegateTestState').textContent.includes('The answer is 42.')"),'test connection');
 await sj("document.querySelector('#reasoningMode').scrollIntoView({block:'start'});");await wait(300);fs.writeFileSync(path.join(output,'delegate-settings.png'),(await settings.webContents.capturePage()).toPNG());
 await js(`window.micRequests=0;Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{micRequests++;return new MediaStream()}});
 window.RTCPeerConnection=class extends EventTarget {constructor(){super();this.iceGatheringState='complete';this.connectionState='new'}addTrack(){}createDataChannel(){const c=new EventTarget();c.readyState='open';c.sent=[];c.send=raw=>c.sent.push(JSON.parse(raw));c.close=()=>{};return this.channel=c}async createOffer(){return {sdp:'test-offer',type:'offer'}}async setLocalDescription(d){this.localDescription=d}async setRemoteDescription(){setTimeout(()=>this.channel.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type:'session.started'})})),10)}close(){}};
 await gla_live.start({voice:'marin',muted:true});`);
 await until(()=>js("return gla_live.state==='connected'"),'live connected');assert.equal(calls.filter(c=>c.body?.session).at(-1).body.session.delegation.type,'client');
 await js("gla_live._onEvent(JSON.stringify({type:'session.input_transcript.delta',start_ms:0,end_ms:100,delta:'What is six times seven?'}));gla_live._onEvent(JSON.stringify({type:'session.delegation.created',delegation:{id:'request-1',type:'delegation',target:'client'}}));");
 await until(()=>js("return gla_live.events.sent.some(e=>e.type==='session.commentary.append'&&e.delegation_id==='request-1'&&e.content.includes('42'))"),'delegated reply');
 const request=calls.filter(c=>c.url.endsWith('/responses')).at(-1);assert.equal(request.body.model,'gpt-5.6-luna');assert(request.body.input.some(m=>m.content[0].text.includes('six times seven')));
 await js('await gla.showMenu({});');assert(menu.find(m=>m.label==='Delegate Reasoning Provider'));await js("await gla.setSettings({reasoningMode:'managed'})");
 await until(()=>js("return gla_live.state==='connected'&&gla_live.reasoningMode==='managed'"),'mode reconnect');assert.equal(calls.filter(c=>c.body?.session).at(-1).body.session.delegation.type,'responses');assert.equal(await js('return gla_live.muted;'),true);assert(await js("return gla_live.history.some(m=>m.text.includes('six times seven'));"));
 await js('gla_live.stop();');assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({passed:true,checks:['Settings provider/auth modes and defaults','Native reasoning menu','Connection test','Real IPC and SDK client delegation configuration','Unfinished transcript delivered to model','Reply injected with matching delegation ID','Mode reconnect retains context and mute'],errors},null,2));console.log('Delegate settings, menu, IPC, SDK session routing and transcript handoff passed.');
 }catch(error){console.error(error);console.error(errors);process.exitCode=1;}finally{fs.rmSync(path.join(app.getPath('userData'),'openai-key.bin'),{force:true});app.exit(process.exitCode||0);}});
