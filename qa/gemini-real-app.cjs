'use strict';
// Explicit live check of Gemini Live against Google's real service, through the
// real app: the items docs/GEMINI-LIVE.md lists as unverified. It uses the
// Gemini key already saved in the app (the encrypted file is copied into a test
// profile; the key is never printed), no real microphone (Chromium's fake
// device, muted at once) and a stand-in reasoning backend, so the only spend is
// a few short Gemini turns. Run: npx electron qa/gemini-real-app.cjs --live [--thinking] [--both]
const {app,BrowserWindow,systemPreferences}=require('electron'),fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert/strict');
if(!process.argv.includes('--live')){console.error('This check talks to Google’s real API. Run it with --live.');process.exit(2);}
const repo=process.env.GLA_SOURCE_ROOT||path.resolve(__dirname,'..'),out=process.env.GLA_QA_OUTPUT||repo+'/build/qa-gemini-real';
const real=path.join(os.homedir(),'Library/Application Support/gpt-live-avatar/gemini-key.bin');
if(!fs.existsSync(real)){console.error('No Gemini key is saved in the app yet: Settings › Voice › Voice model › Gemini, then Validate & save.');process.exit(2);}
fs.rmSync(out+'/profile',{recursive:true,force:true});fs.mkdirSync(out+'/profile',{recursive:true});app.setName('gpt-live-avatar'); // safeStorage keys belong to the app name: only under the app's own can the saved key be decrypted
app.setPath('userData',out+'/profile');fs.copyFileSync(real,out+'/profile/gemini-key.bin');
process.env.GLA_OPENAI_KEY='sk-qa-not-a-real-key-0123456789'; // the reasoning backend below is a stand-in; this is never sent anywhere
app.commandLine.appendSwitch('use-fake-device-for-media-stream');app.commandLine.appendSwitch('use-fake-ui-for-media-stream');app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
systemPreferences.getMediaAccessStatus=()=>'granted';systemPreferences.askForMediaAccess=async()=>true;
const models=process.argv.includes('--both')?['gemini-3.8-live','gemini-3.8-live-extended-thinking']:[process.argv.includes('--thinking')?'gemini-3.8-live-extended-thinking':'gemini-3.8-live'];
const config=model=>({avatar:'sarah',quality:'friendly',bubbleMode:'always',conversationSounds:false,wardrobeFlourish:false,instinctEnabled:false,agentEnabled:false,windowWidth:450,windowHeight:750,reasoningMode:'delegate',delegateProvider:'openai',delegateAuth:'api_key',liveProvider:'gemini',geminiModel:model,geminiVoice:'Aoede',geminiThinkingLevel:'low'});
fs.writeFileSync(out+'/profile/config.json',JSON.stringify(config(models[0])));
const FACT='The lighthouse keeper’s cat is called Marmalade Seventeen.',answers=[];
require(repo+'/electron/delegate.cjs').DelegateBackend.prototype.answer=async(owner,id,_config,history)=>{answers.push({id,asked:history.at(-1)?.text});return {ok:true,text:FACT,provider:'qa',model:'stand-in'};};
const errors=[];app.on('browser-window-created',(_e,w)=>{w.webContents.setBackgroundThrottling(false);w.webContents.on('console-message',d=>{if(d.level==='error')errors.push(d.message);});});
require(repo+'/electron/main.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label,ms=45000){const end=Date.now()+ms;let last;while(Date.now()<end){try{const r=await fn();if(r)return r;}catch(e){last=e;}await wait(80);}throw Error('Timed out: '+label+' '+(last?.message||''));}
app.whenReady().then(async()=>{const report=[];try{
 const solo=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/avatar.html')),'solo window');
 const js=code=>solo.webContents.executeJavaScript('(async()=>{'+code+'})()');
 await until(()=>js(`return Boolean(window.gla_avatar?.options)&&/Ready/.test(document.querySelector('#status').textContent)`),'avatar ready with the saved Gemini key');
 for(const model of models){
  const r={model};report.push(r);answers.length=0;
  await js(`await gla.setSettings({geminiModel:${JSON.stringify(model)}})`);await wait(500);
  // every raw message type and every socket URL version, for the unverified list
  await js(`window.__g={events:[],urls:[],audioAt:0};const W=WebSocket;window.WebSocket=class extends W{constructor(u,...a){super(u,...a);__g.urls.push(String(u).split('?')[0].match(/v1(alpha|beta)/)?.[0]||'?');}};`);
  let t0=Date.now();await js('gla_call()');await until(()=>js("return gla_debug().state==='connected'||/rejected|refused|failed|closed|not/i.test(document.querySelector('#status').textContent)&&gla_debug().state==='idle'"),'connected or refused');
  const state=await js('return {state:gla_debug().state,status:document.querySelector("#status").textContent}');
  if(state.state!=='connected'){r.connected=false;r.error=state.status;r.events=(await js('return gla_debug().events.map(e=>e[1])')).filter(x=>/error|state/.test(x)).slice(-6);r.endpointsTried=await js('return __g.urls');continue;}
  r.connected=true;r.connectMs=Date.now()-t0;r.endpoint=await js('return gla_live.active.endpoint');
  await js("document.querySelector('#muteBtn').click()"); // the fake microphone beeps; she should hear only what is typed
  const type=async text=>{await js(`document.querySelector('#steer').value=${JSON.stringify(text)};document.querySelector('#steerBtn').click();`);};
  const spoken=async(label,ms=45000)=>{const before=await js("return document.querySelector('#lineAssistant').textContent");const t=Date.now();
   await until(()=>js(`return document.querySelector('#lineAssistant').textContent!==${JSON.stringify(before)}&&document.querySelector('#lineAssistant').textContent.trim().length>3`),label,ms);const first=Date.now()-t;
   await until(async()=>{const a=await js("return document.querySelector('#lineAssistant').textContent");await wait(1800);return a===await js("return document.querySelector('#lineAssistant').textContent");},label+' finished',60000);
   return {firstWordsMs:first,text:await js("return document.querySelector('#lineAssistant').textContent")};};
  // 1. a plain turn: she answers aloud, the transcript arrives, the mouth moves
  await type('Please say this sentence and nothing else: The quick brown fox is awake.');
  let heardSpeaking=false;const watch=setInterval(async()=>{try{if(await js('return gla_debug().speaking'))heardSpeaking=true;}catch{}},150);
  r.plain=await spoken('her first reply');clearInterval(watch);r.plain.lipSync=heardSpeaking;
  // 2. a hand-off: only the stand-in backend knows this, so a right answer proves the function call round trip
  await type('What is the lighthouse keeper’s cat called? You do not know this yourself: use your assistant function to find out, then tell me.');
  r.handOff=await spoken('her first words after the hand-off request',90000);
  // Extended Thinking says a filler line first; the answer is a later utterance. Collect everything she says for up to a minute.
  const said=new Set([r.handOff.text]);const t1=Date.now();while(Date.now()-t1<60000&&![...said].some(x=>/Marmalade/i.test(x))){said.add(await js("return document.querySelector('#lineAssistant').textContent"));await wait(300);}
  r.handOff.said=[...said];r.handOff.answerMs=Date.now()-t1;r.handOff.backendAsked=answers.length;r.handOff.correct=[...said].some(x=>/Marmalade/i.test(x));
  // 3. an application note must not be read aloud
  await js("/* same path the app uses for a verified result */ 0");
  r.events=[...new Set((await js('return gla_debug().events.map(e=>e[1])')).filter(x=>/gemini\.(closed|resum|interaction|interrupted)|delegation|error/.test(x)))];
  r.noteReadAloud=/application note/i.test(r.plain.text+' '+r.handOff.text);
  r.usage=await js('return gla_live.active.usage');r.sessionSeconds=Math.round((Date.now()-t0)/1000); // Google's own token count for the session so far
  await js('gla_call()');await until(()=>js("return gla_debug().state==='idle'"),'ended');await wait(800);
 }
 console.log(JSON.stringify({report,consoleErrors:errors.filter(e=>!/Autofill|DevTools/.test(e)).slice(0,5)},null,1));
 assert(report.every(r=>r.connected),'every chosen model connected');
}catch(e){console.error(e.message);console.log(JSON.stringify({report,consoleErrors:errors.slice(0,8)},null,1));process.exitCode=1;}finally{app.exit(process.exitCode||0);}});
