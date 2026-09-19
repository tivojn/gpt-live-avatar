'use strict';
// One cell of the voice-system x action-engine matrix, against the real
// services and the real engines on this Mac: in a live conversation she is
// asked ALOUD (macOS text-to-speech played in as the microphone, so both voice
// systems hear a real voice) to create a file on the Desktop, or to delete it,
// and the file system says whether it happened.
// Uses the keys and engine settings saved in the app (never printed).
//   npx electron qa/action-matrix-app.cjs --live --step=create|remove --voice=openai|gemini|gemini-thinking --engine=none|codex|openclaw|hermes|grok|enconvo
// qa/action-matrix.sh runs the whole matrix.
const {app,BrowserWindow,systemPreferences}=require('electron'),fs=require('fs'),os=require('os'),path=require('path');
const arg=name=>(process.argv.find(a=>a.startsWith('--'+name+'='))||'').split('=')[1]||'';
if(!process.argv.includes('--live')){console.error('This uses real voice sessions and real agent engines. Run it with --live.');process.exit(2);}
const voice=arg('voice')||'openai',engine=arg('engine')||'none',repo=path.resolve(__dirname,'..'),out=repo+'/build/qa-action-matrix',real=path.join(os.homedir(),'Library/Application Support/gpt-live-avatar');
const step=arg('step')||'create',DESKTOP=path.join(os.homedir(),'Desktop');
// A name that survives being spoken and transcribed: whatever the engine calls it, it is "avatar test" with a .txt on the Desktop.
const mine=()=>fs.readdirSync(DESKTOP).filter(n=>/^avatar[ _-]?test.*\.txt$/i.test(n));
if(step==='create'&&mine().length){console.error('Refusing to run: the Desktop already has '+mine().join(', '));process.exit(2);}
const SAY={create:'Hello. Please create a text file named avatar test dot t x t on my desktop, and put the single word hello inside it.',remove:'Hello. Please delete the file named avatar test dot t x t from my desktop. Moving it to the trash is fine.'}[step];
const wav=out+'/'+step+'-'+voice+'.wav',speech=out+'/speech-'+step+'.wav';fs.mkdirSync(out,{recursive:true});
require('child_process').execFileSync('say',['-v','Samantha','-o',speech,'--data-format=LEI16@48000',SAY]);
// lead-in silence: the session has to be up (and Extended Thinking has to finish its own greeting) before she is spoken to
require('child_process').execFileSync('/opt/homebrew/bin/ffmpeg',['-y','-loglevel','error','-f','lavfi','-t',voice==='gemini-thinking'?'11':'6','-i','anullsrc=r=48000:cl=mono','-i',speech,'-f','lavfi','-t','3','-i','anullsrc=r=48000:cl=mono','-filter_complex','[0][1][2]concat=n=3:v=0:a=1','-ar','48000','-ac','1',wav]);
fs.rmSync(out+'/profile',{recursive:true,force:true});fs.mkdirSync(out+'/profile',{recursive:true});app.setName('gpt-live-avatar');app.setPath('userData',out+'/profile');
for(const file of ['openai-key.bin','gemini-key.bin'])if(fs.existsSync(path.join(real,file)))fs.copyFileSync(path.join(real,file),out+'/profile/'+file);
if(fs.existsSync(path.join(real,'delegate-credentials')))fs.cpSync(path.join(real,'delegate-credentials'),out+'/profile/delegate-credentials',{recursive:true});
const own=JSON.parse(fs.readFileSync(path.join(real,'config.json'),'utf8'));
// "Third party": reasoning and actions both go to the engine, the way Settings sets it up (Delegate mode, actions follow reasoning).
const third=engine==='none'?{reasoningMode:'managed',agentEnabled:false}:{reasoningMode:'delegate',agentEnabled:true,agentEngine:engine,agentFollowReasoning:true,
  ...(engine==='codex'?{delegateProvider:'openai',delegateAuth:'codex_app_server'}:{delegateProvider:engine,delegateAuth:'local_runtime'})};
fs.writeFileSync(out+'/profile/config.json',JSON.stringify({avatar:'sarah',quality:'friendly',bubbleMode:'always',conversationSounds:false,wardrobeFlourish:false,instinctEnabled:false,windowWidth:450,windowHeight:750,
  agentRuntimePaths:own.agentRuntimePaths,agentRuntimeModels:own.agentRuntimeModels,avatarAgentBindings:own.avatarAgentBindings,agentPermissions:own.agentPermissions,delegateModels:own.delegateModels,agentCodexModel:own.agentCodexModel,
  liveProvider:voice==='openai'?'openai':'gemini',geminiModel:voice==='gemini-thinking'?'gemini-3.8-live-extended-thinking':'gemini-3.8-live',geminiThinkingLevel:'low',...third}));
delete process.env.GLA_OPENAI_KEY;
app.commandLine.appendSwitch('use-fake-device-for-media-stream');app.commandLine.appendSwitch('use-fake-ui-for-media-stream');app.commandLine.appendSwitch('use-file-for-fake-audio-capture',wav+'%noloop');app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
systemPreferences.getMediaAccessStatus=()=>'granted';systemPreferences.askForMediaAccess=async()=>true;
const errors=[];app.on('browser-window-created',(_e,w)=>{w.webContents.setBackgroundThrottling(false);w.webContents.on('console-message',d=>{if(d.level==='error')errors.push(d.message.slice(0,200));});});
require(repo+'/electron/main.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label,ms=60000){const end=Date.now()+ms;while(Date.now()<end){try{const r=await fn();if(r)return r;}catch{}await wait(150);}throw Error('Timed out: '+label);}
app.whenReady().then(async()=>{const r={voice,engine,step};try{
 const solo=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/avatar.html')),'window');
 const js=code=>solo.webContents.executeJavaScript('(async()=>{'+code+'})()');
 await until(()=>js(`return Boolean(window.gla_avatar?.options)&&/Ready/.test(document.querySelector('#status').textContent)`),'ready');
 const s=await js('return gla.getSettings()');r.actionEngine=s.agentEnabled?s.effectiveActionEngine:'(actions off)';r.installed=s.installedEngines;
 await js("window.__ev=[];gla_live.addEventListener('event',e=>{const t=e.detail.type||'';if(/delegation|gemini\\.(interaction|closed|resum|interrupted)|^error/.test(t))__ev.push([Math.round(performance.now()/100)/10,t+(e.detail.working!==undefined?':'+e.detail.working:'')]);});gla_live.addEventListener('error',e=>__ev.push([Math.round(performance.now()/100)/10,'ERROR '+e.detail.message]));window.__said=[];gla_live.addEventListener('transcript',e=>{if(e.detail.role==='assistant'&&e.detail.final&&e.detail.text)__said.push(e.detail.text);});");
 const t0=Date.now();await js('gla_call()');await until(()=>js("return gla_debug().state==='connected'"),'connected');r.connectMs=Date.now()-t0;
 await js("window.__heard=[];gla_live.addEventListener('transcript',e=>{if(e.detail.role==='user'&&e.detail.final&&e.detail.text)__heard.push(e.detail.text);});");
 const before=mine(),done=step==='create'?()=>mine().length>0:()=>mine().length===0,limit=engine==='none'?60000:240000,t=Date.now();let ok=false;
 if(step==='remove'&&!before.length)throw Error('Nothing to delete: the create step left no file.');
 while(Date.now()-t<limit){if(done()){ok=true;break;}if((await js("return gla_debug().state"))!=='connected')break;await wait(500);}
 r.ok=ok;r.fileMs=ok?Date.now()-t:null;if(step==='create'&&ok){r.file=mine()[0];try{r.content=fs.readFileSync(path.join(DESKTOP,r.file),'utf8').trim().slice(0,40);}catch{}}
 await wait(ok?10000:1500);r.heard=(await js('return __heard')).join(' | ').slice(0,300);r.said=(await js('return __said')).join(' | ').slice(0,500);r.status=await js("return document.querySelector('#status').textContent");r.bubble=await js("return document.querySelector('#lineAssistant').textContent.slice(0,200)");
 r.events=await js('return __ev');r.consoleErrors=errors.slice(0,4);
 await js('gla_call()').catch(()=>{});await wait(1200);
}catch(e){r.failure=e.message;}finally{
 // the test cleans up after itself if the engine did not: only its own, uniquely named file, and to the Trash
 if(step==='remove'||r.failure)for(const name of mine()){try{fs.renameSync(path.join(DESKTOP,name),path.join(os.homedir(),'.Trash','avatar-test '+Date.now()+'.txt'));r.cleanedUpByTest=true;}catch{}}
 console.log('RESULT '+JSON.stringify(r));app.exit(0);}});
