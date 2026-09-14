// Real WebGL/windows/native-menu tests. Network speech is replaced with an
// in-memory peer; qa/live-voices.cjs exercises the actual service separately.
const {app,BrowserWindow,Menu,ipcMain,safeStorage}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const repo=path.resolve(__dirname,'..'),output=path.join(repo,'build/qa-controls');fs.mkdirSync(output,{recursive:true});
app.setPath('userData',path.join(output,'profile'));fs.mkdirSync(app.getPath('userData'),{recursive:true});
delete process.env.GLA_OPENAI_KEY;
fs.writeFileSync(path.join(app.getPath('userData'),'config.json'),JSON.stringify({avatar:'tia',quality:'best',bubbleMode:'always',windowWidth:500,windowHeight:820,avatarLooks:{tia:{},sarah:{}}}));
app.whenReady().then(()=>fs.writeFileSync(path.join(app.getPath('userData'),'openai-key.bin'),safeStorage.isEncryptionAvailable()?safeStorage.encryptString('sk-local-regression-placeholder'):Buffer.from('sk-local-regression-placeholder')));
let template;const buildMenu=Menu.buildFromTemplate;
Menu.buildFromTemplate=function(items){const menu=buildMenu.call(Menu,items);menu.popup=()=>{template=items;};return menu;};
const errors=[],requests=[],screens=[];
app.on('browser-window-created',(_e,w)=>w.webContents.on('console-message',d=>{if(d.level==='error')errors.push(d.message);}));
require('../electron/main.cjs');
ipcMain.removeHandler('gla:live:create');ipcMain.handle('gla:live:create',(_e,request)=>{requests.push(request);return {ok:true,id:'local-test',sdp:'test-answer',voice:request.voice};});
ipcMain.removeHandler('gla:models:list');ipcMain.handle('gla:models:list',()=>({ok:true,backends:['gpt-5.6-terra'],hasLive:true}));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label='condition'){const end=Date.now()+90000;while(Date.now()<end){try{const r=await fn();if(r)return r;}catch{}await wait(150);}throw Error('Timed out: '+label);}
app.whenReady().then(async()=>{
 try{
  const win=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/avatar.html')),'avatar window');
  const js=code=>win.webContents.executeJavaScript(code.includes('await')&&!code.trim().startsWith('window.') ? '(async()=>('+code+'))()' : code).catch(error=>{console.error('QA expression:',code.slice(0,180));throw error;});
  const loaded=()=>until(()=>js("Boolean(gla_avatar?.model && gla_avatar?.motion?.clips.size===62 && !document.querySelector('#status').textContent.startsWith('Loading'))"),'avatar loaded');
  await loaded();
  const menu=async()=>{template=null;await js("gla.showMenu({live:gla_live.state,hasKey:true,bubbleMode:(await gla.getSettings()).bubbleMode,catalogue:gla_avatar.options.catalogue()})");return until(()=>template);};
  const nativeMenu=async()=>{template=null;await js("document.querySelector('#bubble').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true}))");return until(()=>template);};
  let items=await nativeMenu();assert(items.some(x=>x.label==='Avatar'));assert(items.some(x=>x.label==='Voice'));
  assert.equal(items.find(x=>x.label==='Original colors').submenu.reduce((n,x)=>n+x.submenu.length-1,0),87);
  await js("gla.setSettings({bubbleMode:'always'})");await wait(300);
  assert.equal(await js("document.querySelector('#bubble').classList.contains('hidden')"),false,'Always visible while idle');
  await js("gla_play('dance')");await until(()=>js("gla_debug().motionActive==='joyful-sway'"),'dance started');
  const poses=[];
  for(let i=0;i<8;i++){await wait(250);poses.push(await js("gla_avatar.options.current.map(x=>x.m.elements.slice(0,12))"));assert.equal(await js("document.querySelector('#bubble').classList.contains('hidden')"),false,'Always mode during dance');}
  assert(new Set(poses.map(JSON.stringify)).size>1,'Dance changes rig transforms');
  await js("gla.setSettings({bubbleMode:'off'})");await wait(300);
  await js("gla_live.dispatchEvent(new CustomEvent('transcript',{detail:{role:'assistant',text:'Hello!',final:false,id:'bubble-one'}}))");
  assert.equal(await js("document.querySelector('#bubble').classList.contains('hidden')"),true);
  await js("gla.setSettings({bubbleMode:'auto'})");await wait(250);
  assert.equal(await js("document.querySelector('#bubble').classList.contains('hidden')"),true,'No stale bubble on mode change');
  await js("gla_live.dispatchEvent(new CustomEvent('transcript',{detail:{role:'user',text:'Dance',final:true,id:'user-one'}}))");
  assert.equal(await js("document.querySelector('#bubble').classList.contains('hidden')"),true,'Outgoing messages do not wake auto');
  await js("gla_live.dispatchEvent(new CustomEvent('transcript',{detail:{role:'assistant',text:'Here is your message.',final:true,id:'reply-one'}}))");
  for(let i=0;i<6;i++){await wait(200);assert.equal(await js("document.querySelector('#bubble').classList.contains('hidden')"),false,'Incoming messages remain visible during motion');}
  await wait(8100);assert.equal(await js("document.querySelector('#bubble').classList.contains('hidden')"),true,'Incoming bubble expires');
  await js("gla_play('stay')");
  const snapshot=async name=>{await wait(500);fs.writeFileSync(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());screens.push(name);};
  await js("gla.setSettings({bubbleMode:'always'})");await snapshot('tia-original');
  // Every restored texture must decode and bind to its authored material.
  const colorItems=await js('gla_avatar.appearance.items.filter(x=>x.kind==="texture").map(({id,slot,material})=>({id,slot,material}))');
  for(const item of colorItems){
   await js(`gla_avatar.options.select({...gla_avatar.options.selection,['texture:'+${JSON.stringify(item.slot)}]:${JSON.stringify(item.id)}});void 0`);
   await until(()=>js(`gla_avatar.appearance.textureSelections.has(${JSON.stringify(item.id)})`),'Color '+item.id);
   assert.equal(await js(`(()=>{const chosen=gla_avatar.appearance.textureSelections.get(${JSON.stringify(item.id)});let matched=false;gla_avatar.model.traverse(n=>{for(const m of Array.isArray(n.material)?n.material:[n.material])if(m?.name===${JSON.stringify(item.material)}&&m.map===chosen.texture)matched=true});return matched})()`),true,item.id);
  }
  await js(`gla_avatar.options.select(Object.fromEntries(Object.entries(gla_avatar.options.selection).filter(([k])=>!k.startsWith('texture:'))));void 0`);
  const oldModelURL=await js('(await gla.getSettings()).avatar.modelURL');
  items=await nativeMenu();items.find(x=>x.label==='Avatar').submenu.find(x=>x.label==='Sarah').click();await loaded();
  await until(()=>js("gla_avatar?.appearance?.items.filter(x=>x.kind==='texture').length===74"),'Sarah color library');
  assert.equal(await js(`(await (await fetch(${JSON.stringify(oldModelURL)})).json()).materials[1].name`),'Top_Tia01A_M','Previous package URL remains pinned');
  await js("Promise.all([gla.selectAvatar('tia'),gla.selectAvatar('sarah'),gla.selectAvatar('tia')])");await loaded();
  await until(()=>js("gla_avatar?.appearance?.items.filter(x=>x.kind==='texture').length===87"),'Final avatar after rapid switches');
  items=await nativeMenu();const colors=items.find(x=>x.label==='Original colors');
  const choose=slot=>colors.submenu.find(x=>x.label===slot).submenu[2].click();
  choose('Hair');choose('Coat');choose('Eyes');await wait(2500);await snapshot('tia-colors');
  assert.equal(await js('gla_avatar.appearance.textureSelections.size'),3);
  win.webContents.reload();await loaded();await until(()=>js('gla_avatar?.appearance?.textureSelections.size===3'),'Colors survive reload');
  // Fake only the transport; actual controls, LiveClient and IPC still run.
  await js(`window.micRequests=0;Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{micRequests++;return {getAudioTracks:()=>[],getTracks:()=>[]}}});
  window.RTCPeerConnection=class extends EventTarget{
   constructor(){super();this.iceGatheringState='complete';this.connectionState='new'}
   addTrack(){} addTransceiver(){} createDataChannel(){const e=new EventTarget();e.readyState='open';e.send=()=>{};e.close=()=>{};return this.channel=e}
   async createOffer(){return {sdp:'fake-offer',type:'offer'}} async setLocalDescription(d){this.localDescription=d}
   async setRemoteDescription(){setTimeout(()=>this.channel.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type:'session.started'})})),20)} close(){this.connectionState='closed'}
  };void 0;`);
  items=await nativeMenu();items.find(x=>x.label==='Voice').submenu.find(x=>x.label.startsWith('Ripple')).submenu[0].click();
  await until(()=>js("(async()=> (await gla.getSettings()).voicePreview.state==='connected')()"),'Menu voice preview');
  assert.equal(await js('micRequests'),0);assert.equal(requests.at(-1).preview,true);assert.equal(requests.at(-1).voice,'ripple');
  assert.equal(await js('(await gla.getSettings()).voice'),'marin','Preview does not select voice');
  await js('gla.stopVoicePreview()');await wait(100);
  await js("gla_live.start({voice:'marin'})");await until(()=>js("gla_live.state==='connected'"),'Live connected');
  await js("gla_live.remember('user','Please remember our dance.');gla_live.setMuted(true)");
  items=await nativeMenu();items.find(x=>x.label==='Voice').submenu.find(x=>x.label.startsWith('Ripple')).submenu[1].click();
  await until(()=>js("gla_live.state==='connected' && gla_live.voice==='ripple'"),'Dynamic voice reconnect');
  assert.equal(requests.at(-1).history[0].text,'Please remember our dance.');assert.equal(await js('gla_live.muted'),true);
  await js("gla.setSettings({bubbleMode:'off'})");await wait(300);
  assert.equal(await js("getComputedStyle(document.querySelector('#listen')).opacity"),'0.6','Muted listening pill visible');
  await snapshot('listening-gap');
  await js("gla.setSettings({bubbleMode:'always'})");await wait(300);
  assert.equal(await js("getComputedStyle(document.querySelector('#listen')).opacity"),'0','Muted pill stays hidden when bubble shown');
  items=await nativeMenu();items.find(x=>x.label==='Settings…').click();
  const settings=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/settings.html')),'Settings');
  const sj=code=>settings.webContents.executeJavaScript(code);
  await until(()=>sj("document.querySelector('#voice').options.length===13"));
  await sj("document.querySelector('#voice').value='quartz';document.querySelector('#voice').dispatchEvent(new Event('change'));document.querySelector('#previewVoice').click()");
  await until(()=>js("(async()=> (await gla.getSettings()).voicePreview.state==='connected')()"),'Settings preview');
  assert.equal(requests.at(-1).voice,'quartz');assert.equal(await js('(await gla.getSettings()).voice'),'ripple');
  await sj("document.querySelector('#useVoice').click()");
  await until(()=>js("gla_live.state==='connected' && gla_live.voice==='quartz'"),'Settings apply voice');
  await sj("document.querySelector('#voice').scrollIntoView({block:'center'})");fs.writeFileSync(path.join(output,'voice-settings.png'),(await settings.webContents.capturePage()).toPNG());
  await js('gla_live.stop()');
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({passed:true,tiaColors:87,sarahColors:74,screens,voiceConnections:requests.map(x=>({voice:x.voice,preview:x.preview})),errors},null,2));
  console.log('Native menus, avatar races, real dancing, all bubble modes, color persistence and voice controls passed.');
 }catch(error){console.error(error);console.error(errors);process.exitCode=1;}
 app.exit(process.exitCode || 0);
});
