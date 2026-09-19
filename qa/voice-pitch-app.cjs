'use strict';
// Measures the speaking pitch of every voice of the live voice system in use,
// by playing each one's preview once in the real app and estimating the
// fundamental frequency of what is heard. OpenAI does not publish a gender for
// GPT-Live-1's voices; this is how electron/voice-gender.json was filled in.
// Uses the keys saved in the app (never printed). Costs about two minutes of
// live voice in all. Run: npx electron qa/voice-pitch-app.cjs --live [--gemini]
const {app,BrowserWindow,systemPreferences}=require('electron'),fs=require('fs'),os=require('os'),path=require('path');
if(!process.argv.includes('--live')){console.error('This plays real voice previews. Run it with --live.');process.exit(2);}
const gemini=process.argv.includes('--gemini'),repo=path.resolve(__dirname,'..'),out=repo+'/build/qa-voice-pitch',real=path.join(os.homedir(),'Library/Application Support/gpt-live-avatar');
fs.rmSync(out+'/profile',{recursive:true,force:true});fs.mkdirSync(out+'/profile',{recursive:true});app.setName('gpt-live-avatar');app.setPath('userData',out+'/profile');
for(const file of ['openai-key.bin','gemini-key.bin'])if(fs.existsSync(path.join(real,file)))fs.copyFileSync(path.join(real,file),out+'/profile/'+file);
delete process.env.GLA_OPENAI_KEY;app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
systemPreferences.getMediaAccessStatus=()=>'granted';systemPreferences.askForMediaAccess=async()=>true;
fs.writeFileSync(out+'/profile/config.json',JSON.stringify({avatar:'sarah',quality:'friendly',bubbleMode:'off',conversationSounds:false,wardrobeFlourish:false,instinctEnabled:false,agentEnabled:false,windowWidth:450,windowHeight:750,liveProvider:gemini?'gemini':'openai'}));
app.on('browser-window-created',(_e,w)=>w.webContents.setBackgroundThrottling(false));
require(repo+'/electron/main.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label,ms=60000){const end=Date.now()+ms;while(Date.now()<end){try{const r=await fn();if(r)return r;}catch{}await wait(100);}throw Error('Timed out: '+label);}
// Taps whatever stream the preview plays (a WebRTC track for GPT-Live-1, a Web Audio stream for Gemini) and tracks its pitch by autocorrelation.
const TAP=`window.__pitch={f0:[]};const analyse=stream=>{const ctx=window.__pctx||(window.__pctx=new AudioContext());void ctx.resume();const src=ctx.createMediaStreamSource(stream),an=ctx.createAnalyser();an.fftSize=4096;src.connect(an);const buf=new Float32Array(an.fftSize);
 clearInterval(window.__ptimer);window.__ptimer=setInterval(()=>{an.getFloatTimeDomainData(buf);let rms=0;for(const v of buf)rms+=v*v;rms=Math.sqrt(rms/buf.length);if(rms<.02)return;
  const sr=ctx.sampleRate,min=Math.floor(sr/400),max=Math.floor(sr/60);let best=0,lag=0,zero=0;for(let i=0;i<buf.length-max;i++)zero+=buf[i]*buf[i];
  for(let l=min;l<=max;l++){let c=0;for(let i=0;i<buf.length-max;i++)c+=buf[i]*buf[i+l];if(c>best){best=c;lag=l;}}
  if(lag&&best/zero>.5)__pitch.f0.push(sr/lag);},40);};
 const set=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'srcObject');Object.defineProperty(HTMLMediaElement.prototype,'srcObject',{configurable:true,get(){return set.get.call(this);},set(v){set.set.call(this,v);if(v instanceof MediaStream&&v.getAudioTracks().length)analyse(v);}});`;
app.whenReady().then(async()=>{const results={};try{
 const solo=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/avatar.html')),'window');
 const js=code=>solo.webContents.executeJavaScript('(async()=>{'+code+'})()');
 await until(()=>js(`return Boolean(window.gla_avatar?.options)&&/Ready/.test(document.querySelector('#status').textContent)`),'ready with a saved key');
 await js(TAP);const voices=(await js('return (await gla.getSettings()).characterVoices.list.map(v=>v.id)'));
 for(const voice of voices){
  await js('__pitch.f0=[]');const r=await js(`return gla.previewVoice(${JSON.stringify(voice)})`);if(!r.ok){results[voice]={error:r.error};continue;}
  await until(()=>js('return __pitch.f0.length>5'),'audio for '+voice,30000).catch(()=>{});
  await until(async()=>{const a=await js('return __pitch.f0.length');await wait(1500);return a===await js('return __pitch.f0.length');},'end of '+voice,30000).catch(()=>{});
  await js('gla.stopVoicePreview()');const f0=(await js('return __pitch.f0')).sort((a,b)=>a-b);
  const median=f0.length?f0[f0.length>>1]:0;results[voice]={frames:f0.length,medianHz:Math.round(median),range:f0.length?[Math.round(f0[Math.floor(f0.length*.1)]),Math.round(f0[Math.floor(f0.length*.9)])]:null};
  console.log(voice.padEnd(14),JSON.stringify(results[voice]));await wait(1200);
 }
 fs.writeFileSync(out+'/pitch-'+(gemini?'gemini':'openai')+'.json',JSON.stringify(results,null,1));
}catch(e){console.error(e.message);process.exitCode=1;}finally{app.exit(process.exitCode||0);}});
