// Instinct in the real app: settings, IPC, transcript stream and renderer.
// Only TypeSafe/OpenAI network responses and the WebRTC transport are simulated.
// Run: npx electron qa/instinct-app.cjs
const {app,BrowserWindow,safeStorage,net}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const repo=path.resolve(__dirname,'..'),output=path.join(repo,'build/qa-instinct-app');fs.rmSync(output,{recursive:true,force:true});fs.mkdirSync(output,{recursive:true});
app.setPath('userData',path.join(output,'profile'));fs.mkdirSync(app.getPath('userData'),{recursive:true});delete process.env.GLA_OPENAI_KEY;
fs.writeFileSync(path.join(app.getPath('userData'),'config.json'),JSON.stringify({avatar:'tia',agentEnabled:false,quality:'friendly',bubbleMode:'off',avatarLooks:{tia:{}}}));
app.whenReady().then(()=>fs.writeFileSync(path.join(app.getPath('userData'),'openai-key.bin'),safeStorage.encryptString('sk-test-not-a-real-key')));
const jev=[],errors=[];let outage=false;
const noul=value=>({type:'noul',noul:value}),pick=(choice,p=.92)=>({type:'choice',choice,confidence:p,probabilities:{[choice]:p}});
// A stand-in for Jev that reads the same state a real request carries.
function answer(body){
  const said=body.state.assistant_replied||'',heard=body.state.user_is_saying||'';
  if(!body.questions.performs&&body.questions.face)return {face:pick(/died|funeral/.test(heard)?'concern':/promotion/.test(heard)?'beam':'neutral')};
  if(body.questions.greeting)return {greeting:noul(.98)}; // key validation and connection warm-up
  if(/kung fu/i.test(said))return {performs:noul(.96),what:pick('clip:kung-fu-punch'),reaction:pick('none'),face:pick('proud')};
  if(/watch this/i.test(said))return {performs:noul(.9),what:pick('clip:victory-cheer',.8),reaction:pick('none')};
  if(/if i could dance/i.test(said))return {performs:noul(.04),what:pick('none'),reaction:pick('none')};
  return {performs:noul(.05),what:pick('none'),reaction:pick('none')};
}
const actualFetch=global.fetch;
global.fetch=async(url,options={})=>{
  const address=String(url),body=options.body?JSON.parse(options.body):null,reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
  if(address.startsWith('https://api.typesafe.ai/')){
    assert.equal(options.headers.Authorization,'Bearer ts_test_0123456789abcdef');jev.push(body);
    return outage?reply({},529):reply({model:'jev-latest',answers:answer(body),usage:{input_tokens:400,output_tokens:0}});
  }
  if(!address.startsWith('https://api.openai.com/'))return actualFetch(url,options);
  if(address.endsWith('/models'))return reply({data:[{id:'gpt-5.6-luna'},{id:'gpt-live-1'}]});
  return reply({id:'test-live',transport:{type:'webrtc',sdp:'test-answer'}});
};
net.fetch=global.fetch; // Instinct uses Chromium's stack; no real TypeSafe traffic from this test
app.on('browser-window-created',(_e,w)=>{w.webContents.setBackgroundThrottling(false);w.webContents.on('console-message',d=>{if(d.level==='error')errors.push(d.message);});});
require('../electron/main.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){const end=Date.now()+90000;while(Date.now()<end){if(await fn())return;await wait(100);}throw Error('Timed out: '+label);}
app.whenReady().then(async()=>{try{
  let win;await until(()=>win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/avatar.html')),'avatar');
  const js=code=>win.webContents.executeJavaScript(`(async()=>{${code}})()`);
  await until(()=>js("return Boolean(window.gla_live)&&window.gla_debug?.().clips>0"),'avatar and motions loaded');
  assert.equal(await js('return (await gla.getSettings()).instinct.active'),false);
  await js('await gla.openSettings();');
  let settings;await until(()=>settings=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/settings.html')),'settings');
  const sj=code=>settings.webContents.executeJavaScript(`(async()=>{${code}})()`);
  await until(()=>sj("return /No key/.test(document.querySelector('#instinctState').textContent)"),'instinct section');
  assert.equal(await sj("return document.querySelector('#testInstinct').disabled"),true);
  await sj("document.querySelector('#instinctKey').value='ts_test_0123456789abcdef';document.querySelector('#saveInstinctKey').click();");
  await until(()=>sj("return /^Ready/.test(document.querySelector('#instinctState').textContent)"),'key saved');
  assert.equal(await sj("return document.querySelector('#instinctKey').value"),'');
  const stored=fs.readFileSync(path.join(app.getPath('userData'),'delegate-credentials/typesafe-key.bin'));assert(!stored.toString().includes('ts_test'));
  assert(!fs.readFileSync(path.join(app.getPath('userData'),'config.json'),'utf8').includes('ts_test'));
  await sj("document.querySelector('#testInstinct').click();");
  await until(()=>sj("return /clip:kung-fu-punch/.test(document.querySelector('#instinctState').textContent)"),'test button');
  await sj("document.querySelector('#instinctKey').scrollIntoView({block:'center'});");await wait(300);fs.writeFileSync(path.join(output,'instinct-settings.png'),(await settings.webContents.capturePage()).toPNG());
  await until(()=>js('return (await gla.getSettings()).instinct.active===true'),'renderer sees Instinct');

  await js(`Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>new MediaStream()});
  window.RTCPeerConnection=class extends EventTarget {constructor(){super();this.iceGatheringState='complete';this.connectionState='new'}addTrack(){}createDataChannel(){const c=new EventTarget();c.readyState='open';c.sent=[];c.send=raw=>c.sent.push(JSON.parse(raw));c.close=()=>{};return this.channel=c}async createOffer(){return {sdp:'test-offer',type:'offer'}}async setLocalDescription(d){this.localDescription=d}async setRemoteDescription(){setTimeout(()=>this.channel.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type:'session.started'})})),10)}close(){}};
  await gla_live.start({voice:'marin',muted:true});`);
  await until(()=>js("return gla_live.state==='connected'"),'live connected');
  let clock=0;const say=(role,delta)=>{clock+=3000;return js(`gla_live._onEvent(${JSON.stringify(JSON.stringify({type:`session.${role==='user'?'input':'output'}_transcript.delta`,start_ms:clock,end_ms:clock+200,delta}))});`);};
  const played=()=>js('return window.gla_played.slice()');

  // 1. She starts moving while still mid-sentence: no final transcript exists yet.
  await say('user','Can you show me some kung fu?');await wait(1500);
  await say('assistant',"Sure, I'll try a kung fu");
  await until(async()=>(await played()).includes('kung-fu-punch'),'early motion from a partial reply');
  assert.equal(await js("return document.querySelector('#lineAssistant').classList.contains('pending')||gla_debug().assistantTurn===''"),true,'acted before the reply was final');
  await wait(1600);assert.equal((await played()).filter(id=>id==='kung-fu-punch').length,1,'the final transcript does not replay it');

  // 2. Phrasing the local rules cannot parse.
  await js("gla_play&&0;window.gla_avatar?.motion?.stop?.();");
  await say('user','Show me something triumphant.');await wait(1500);
  await say('assistant','Watch this!');
  await until(async()=>(await played()).includes('victory-cheer'),'semantic clip choice');

  // 2b. She answers before the user's transcript is final: Jev must still be
  // told the new request, not the previous one.
  await js("window.gla_avatar?.motion?.stop?.();");await wait(1300);
  await say('user','Now take a bow for me.');await wait(150);
  await say('assistant','Alright, I will do a little');await wait(900);
  assert(jev.at(-1).state.user_said.includes('take a bow'),'fresh user text, got: '+jev.at(-1).state.user_said);await wait(1500);

  // 3. A hypothetical that fools nobody.
  const count=(await played()).length;
  await say('user','Do you like dancing?');await wait(1500);
  await say('assistant',"If I could dance all day I would. I'll do a little dance in my head.");await wait(2600);
  assert.equal((await played()).length,count,'vetoed');

  // 4. Her face while the user is still talking.
  const face=async name=>fs.writeFileSync(path.join(output,name),(await win.webContents.capturePage()).toPNG());
  await js("window.gla_avatar?.motion?.stop?.();");await wait(1500);await face('face-before.png');
  await say('user','Honestly it has been rough, my dog died this morning and');
  await until(()=>js("return window.gla_listened?.face==='concern'"),'listening face');
  await wait(2500);await face('face-concern.png');
  assert(jev.some(b=>!b.questions.performs&&b.questions.face&&b.state.earlier.length>0&&Object.keys(b.questions.face.criteria).length>=20),'listening carries recent turns and the full expression list');
  assert.equal(await js('return window.gla_felt?.face'),'proud','her own face while she speaks');

  // 5. TypeSafe outage: the local rules carry on and traffic stops.
  outage=true;await wait(1500);
  for(const line of ['one','two','three']){await say('user','Tell me number '+line+' please.');await wait(1400);await say('assistant','That is number '+line+'.');await wait(1500);}
  const quiet=jev.length;await say('user','Please dance for me.');await wait(1500);
  await say('assistant',"I'll do a little dance.");
  await until(async()=>(await played()).length>count+0&&(await played()).at(-1)!=='victory-cheer','rules still animate during an outage');
  assert.equal(jev.length,quiet,'paused after repeated failures');
  assert.equal(await js('return (await gla.getSettings()).instinct.state'),'paused');

  await js('gla_live.stop();');assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({passed:true,requests:jev.length,played:await played(),checks:['Settings key entry, encrypted storage, test button','Motion starts from a partial reply','Semantic clip choice beyond local rules','Hypothetical vetoed','Listening face while the user speaks','Outage falls back to local rules and pauses traffic']},null,2));
  console.log('Instinct app QA passed. TypeSafe requests: '+jev.length+'. Played: '+(await played()).join(', '));
}catch(error){console.error(error);console.error(errors);process.exitCode=1;}finally{fs.rmSync(path.join(app.getPath('userData'),'openai-key.bin'),{force:true});app.exit(process.exitCode||0);}});
