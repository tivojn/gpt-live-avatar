// Opt-in real GPT-Live output, no microphone. Separate profile; no credentials
// or licensed models enter test artifacts. Run: electron qa/lip-sync-app.cjs --live
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
if(!process.argv.includes('--live'))throw Error('Pass --live to test actual GPT-Live voices.');
const root=path.resolve(__dirname,'..'),out=root+'/build/qa-lip-sync',profile=out+'/profile',slugs=['tia','sarah','iselda','ming-mei','seraphim'];
fs.mkdirSync(profile+'/avatars',{recursive:true});app.setName('gpt-live-avatar');app.setPath('userData',profile);
for(const slug of slugs){const link=profile+'/avatars/'+slug;if(!fs.existsSync(link))fs.symlinkSync(root+'/build/characters/'+slug,link);}
fs.copyFileSync(path.join(os.homedir(),'Library/Application Support/gpt-live-avatar/openai-key.bin'),profile+'/openai-key.bin');
fs.writeFileSync(profile+'/config.json',JSON.stringify({avatar:'tia',quality:'balanced',bubbleMode:'off',conversationSounds:false}));
const errors=[];app.on('browser-window-created',(_e,w)=>w.webContents.on('console-message',d=>{if(d.level==='error')errors.push(d.message);}));require('../electron/main.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));async function until(fn,label,timeout=90000){const end=Date.now()+timeout;while(Date.now()<end){try{const value=await fn();if(value)return value;}catch{}await wait(80);}throw Error('Timed out: '+label);}
app.whenReady().then(async()=>{let win;const reports=[];try{
 win=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/avatar.html')),'avatar');const js=s=>win.webContents.executeJavaScript('(async()=>{'+s+'})()',true);
 await until(()=>js('return window.gla_live&&window.gla_avatar?.resources.ready;'),'ready');for(const other of BrowserWindow.getAllWindows())if(other!==win)other.close();
 await js(`window.micRequests=0;navigator.mediaDevices.getUserMedia=async()=>{micRequests++;throw Error('QA must never capture a microphone.');};`);
 for(const slug of slugs){
  await js(`await gla.selectAvatar(${JSON.stringify(slug)});`);await until(()=>js(`return (await gla.getSettings()).avatar.slug===${JSON.stringify(slug)}&&gla_avatar?.resources.ready&&gla_avatar.appearance.indexURL===(await gla.getSettings()).avatar.appearanceURL;`),'loaded '+slug);
  await js(`window.samples=[];window.pictures={};window.recorded=[];window.voiceText='';
   window.trackHandler=({detail})=>{gla_speech.monitor=false;gla_speech.updateVolume();window.recorder=new MediaRecorder(detail.stream);recorder.ondataavailable=e=>recorded.push(e.data);recorder.start();};
   window.textHandler=({detail})=>{if(detail.role==='assistant')voiceText=detail.text;};
   gla_live.addEventListener('remote-track',trackHandler);gla_live.addEventListener('transcript',textHandler);
   window.sampleTimer=setInterval(()=>{if(!gla_speech)return;const s=gla_speech.sample();samples.push({...s,t:performance.now()});},33);
   await gla_live.start({receiveOnly:true,voice:(await gla.getSettings()).voice});`);
  await until(()=>js("return gla_live.state==='connected';"),'connected '+slug,40000);
  await js(`gla_live.appendInstructions('For this pronunciation check, say exactly: Baby blue bubbles. Five fluffy feathers. See the shiny shoes. Ah, ee, oh, oo. Then stay silent.');gla_live.appendCommentary('Please say the pronunciation check now.');`);
  await until(()=>js('return samples.filter(s=>s.rms>.008).length>25;'),'speech '+slug,30000);await wait(4000);
  const report=await js(`clearInterval(sampleTimer);const stats={slug:${JSON.stringify(slug)},voice:gla_live.voice,text:voiceText,frames:samples.length,active:samples.filter(s=>s.rms>.008).length,classes:[...new Set(samples.filter(s=>s.speaking).map(s=>s.viseme))],recognized:samples.some(s=>s.lipSyncSource==='audio-model'),micRequests,channels:[...gla_avatar.channels.keys()].filter(k=>k.startsWith('viseme:')),coverage:gla_avatar.coverage};
   const done=new Promise(r=>recorder.onstop=r);recorder.stop();await done;const blob=new Blob(recorded,{type:'audio/webm'});stats.audio=await new Promise(r=>{const f=new FileReader();f.onload=()=>r(f.result);f.readAsDataURL(blob);});stats.pictures=pictures;stats.samples=samples;
   gla_speech.setActive(false);stats.interrupted=gla_speech.sample();gla_live.removeEventListener('remote-track',trackHandler);gla_live.removeEventListener('transcript',textHandler);gla_live.stop();return stats;`);
  assert(report.recognized);assert(report.classes.length>=5);assert.equal(report.micRequests,0);assert.equal(report.interrupted.viseme,'sil');assert.deepEqual(report.coverage.missing,[]);
  fs.writeFileSync(out+'/'+slug+'.webm',Buffer.from(report.audio.split(',')[1],'base64'));delete report.audio;
  for(const [viseme,url] of Object.entries(report.pictures))if(url)fs.writeFileSync(out+'/'+slug+'-'+viseme+'.png',Buffer.from(url.split(',')[1],'base64'));delete report.pictures;
  reports.push(report);console.log(JSON.stringify({...report,samples:undefined}));
 }
 const cues=await js(`const {synthConversationCue}=await import('/conversation-sounds.js');const result=[];for(const kind of ['connecting','connected','ended']){const c=new OfflineAudioContext(1,48000,48000);synthConversationCue(c,kind);const b=await c.startRendering(),data=b.getChannelData(0);let peak=0,sum=0;for(const x of data){peak=Math.max(peak,Math.abs(x));sum+=x*x;}result.push({kind,peak,rms:Math.sqrt(sum/data.length),pcm:Array.from(data)});}return result;`);
 for(const cue of cues){assert(cue.peak>.01&&cue.peak<.3);fs.writeFileSync(out+'/'+cue.kind+'.f32',Buffer.from(new Float32Array(cue.pcm).buffer));delete cue.pcm;}
 assert.deepEqual(errors,[]);fs.writeFileSync(out+'/report.json',JSON.stringify({passed:true,reports,cues,errors},null,2));console.log('Five live voices, learned visemes, interruption and synth cues passed.');
 }catch(e){console.error(e,errors);if(win&&!win.isDestroyed())console.error(await win.webContents.executeJavaScript('JSON.stringify({debug:gla_debug(),frames:window.samples?.length,classes:[...new Set((window.samples||[]).map(s=>s.viseme))],peak:Math.max(0,...(window.samples||[]).map(s=>s.rms)),text:window.voiceText,ctx:gla_speech?.context.state,ready:!!gla_speech?.node,failed:gla_speech?.failed,active:gla_speech?.active,epoch:gla_speech?.epoch,queue:gla_speech?.timeline.queue.slice(-2),tracks:gla_speech?.source.mediaStream.getTracks().map(t=>({state:t.readyState,muted:t.muted,enabled:t.enabled})),events:window.gla_live.state})'));process.exitCode=1;}finally{if(win&&!win.isDestroyed())try{await win.webContents.executeJavaScript('gla_live.stop();');}catch{}fs.rmSync(profile+'/openai-key.bin',{force:true});app.exit(process.exitCode||0);}});
