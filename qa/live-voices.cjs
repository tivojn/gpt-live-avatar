// Opt-in service verification with the installed user's key and no microphone.
// Run explicitly: npx electron qa/live-voices.cjs --live
const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
if(!process.argv.includes('--live')){console.error('Pass --live to verify actual GPT-Live audio.');process.exit(1);}
app.setName('gpt-live-avatar');
const output=path.resolve(__dirname,'../build/qa-live-voices');fs.mkdirSync(output,{recursive:true});
app.setPath('userData',path.join(output,'profile'));fs.mkdirSync(app.getPath('userData'),{recursive:true});
delete process.env.GLA_OPENAI_KEY;
fs.copyFileSync(path.join(os.homedir(),'Library/Application Support/gpt-live-avatar/openai-key.bin'),path.join(app.getPath('userData'),'openai-key.bin'));
fs.writeFileSync(path.join(app.getPath('userData'),'config.json'),JSON.stringify({avatar:'tia',quality:'friendly',bubbleMode:'off'}));
require('../electron/main.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label,timeout=40000){const end=Date.now()+timeout;while(Date.now()<end){try{const r=await fn();if(r)return r;}catch{}await wait(150);}throw Error('Timed out: '+label);}
app.whenReady().then(async()=>{
 let win;const report=[];
 try{
  win=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/avatar.html')),'window');
  const js=c=>win.webContents.executeJavaScript(c,true);
  await until(()=>js('Boolean(window.gla_preview && window.gla_live)'),'client');
  await js(`window.microphoneRequests=0;Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>{microphoneRequests++;throw Error('Microphone must not open in preview QA')}});
  window.qaAudioContext=new AudioContext();window.qaResult={};window.qaEvents=[];
  gla_preview.client.addEventListener('event',({detail})=>qaEvents.push({type:detail.type,error:detail.error}));
  gla_preview.client.addEventListener('remote-track',({detail})=>{const meter=qaAudioContext.createAnalyser();meter.fftSize=1024;qaAudioContext.createMediaStreamSource(detail.stream).connect(meter);qaResult.meter=meter;qaResult.samples=new Float32Array(1024)});
  gla_preview.client.addEventListener('transcript',({detail})=>{if(detail.role==='assistant')qaResult.text=detail.text});
  gla_preview.client.addEventListener('error',({detail})=>qaResult.error=detail.message);`);
  const voices=process.argv.includes('--all-voices')?await js('gla.getSettings().then(s=>s.voices)'):['ripple','quartz'];
  for(const voice of voices){
   await js(`qaResult={};qaAudioContext.resume();gla_preview.sample.muted=true;gla.previewVoice('${voice}')`);
   await until(()=>js("Boolean(qaResult.error || gla_preview.client.state==='connected')"),'voice '+voice);
   const error=await js('qaResult.error');assert(!error,error);
   const signal=await until(()=>js(`(()=>{if(!qaResult.meter)return null;qaResult.meter.getFloatTimeDomainData(qaResult.samples);const rms=Math.sqrt(qaResult.samples.reduce((n,x)=>n+x*x,0)/qaResult.samples.length);qaResult.peak=Math.max(qaResult.peak||0,rms);return qaResult.peak>.001&&qaResult.text?{voice:gla_preview.client.voice,text:qaResult.text,peakRms:qaResult.peak}:null})()`),'audible '+voice);
   assert.equal(signal.voice,voice);report.push(signal);console.log('Audible preview passed:',voice);
   await js('gla.stopVoicePreview()');await wait(250);
   assert.equal(await js('gla_preview.client.state'),'idle');
  }
  assert.equal(await js('microphoneRequests'),0);
  // Exercise a genuine voice reconnect on a silent synthetic audio track.
  await js(`Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{window.qaSilence=qaAudioContext.createMediaStreamDestination();return qaSilence.stream}});
  gla_live.addEventListener('error',({detail})=>qaResult.error=detail.message);
  gla_live.addEventListener('transcript',({detail})=>{if(detail.role==='assistant')qaResult.liveText=detail.text});
  gla_live.start({voice:'marin',muted:true});`);
  await until(()=>js("gla_live.state==='connected' || qaResult.error"),'initial real session');assert(!await js('qaResult.error'),await js('qaResult.error'));
  await js("gla_live.remember('user','We are testing a voice change.');gla_live.remember('assistant','The test is ready.');gla_live.restart('ripple')");
  await until(()=>js("gla_live.state==='connected' && gla_live.voice==='ripple' || qaResult.error"),'real reconnect');assert(!await js('qaResult.error'),await js('qaResult.error'));
  assert.equal(await js('gla_live.muted'),true);
  report.push({realReconnect:true,from:'marin',to:'ripple',mutedPreserved:true,historyMessages:await js('gla_live.history.length')});
  await js('gla_live.stop()');
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({passed:true,microphoneRequests:0,checks:report},null,2));console.log(JSON.stringify({passed:true,checks:report},null,2));
 }catch(error){console.error(error);if(win)console.error(await win.webContents.executeJavaScript('JSON.stringify({events:window.qaEvents,result:{text:window.qaResult?.text,peak:window.qaResult?.peak,error:window.qaResult?.error},state:window.gla_preview?.client.state})'));process.exitCode=1;}
 finally{
  if(win&&!win.isDestroyed())try{await win.webContents.executeJavaScript('gla_preview.stop();gla_live.stop()')}catch{}
  fs.rmSync(path.join(app.getPath('userData'),'openai-key.bin'),{force:true});app.exit(process.exitCode || 0);
 }
});
