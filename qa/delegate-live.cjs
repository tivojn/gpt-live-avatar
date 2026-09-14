// Opt-in real OpenAI API-key inference and client-delegation session test.
// Uses generated silence; no microphone and no other app's OAuth credentials.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
if(!process.argv.includes('--live'))throw Error('Use --live for the real service test.');
app.setName('gpt-live-avatar');const output=path.resolve(__dirname,'../build/qa-delegate-live');fs.mkdirSync(output,{recursive:true});
app.setPath('userData',path.join(output,'profile'));fs.mkdirSync(app.getPath('userData'),{recursive:true});delete process.env.GLA_OPENAI_KEY;
fs.copyFileSync(path.join(os.homedir(),'Library/Application Support/gpt-live-avatar/openai-key.bin'),path.join(app.getPath('userData'),'openai-key.bin'));
fs.writeFileSync(path.join(app.getPath('userData'),'config.json'),JSON.stringify({avatar:'tia',quality:'friendly',bubbleMode:'off',reasoningMode:'delegate',avatarLooks:{tia:{}}}));
if(!fs.existsSync(path.join(output,'question.wav'))){const {execFileSync}=require('node:child_process');execFileSync('/usr/bin/say',['-v','Samantha','-o',path.join(output,'question.aiff'),'Please use your backend reasoning assistant to calculate twelve thousand three hundred forty seven multiplied by nine hundred eighty seven. I need the exact result.']);execFileSync('/usr/bin/afconvert',[path.join(output,'question.aiff'),path.join(output,'question.wav'),'-f','WAVE','-d','LEI16@24000']);}
require('../electron/main.cjs');const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label,timeout=60000){const end=Date.now()+timeout;while(Date.now()<end){const r=await fn();if(r)return r;await wait(150);}throw Error('Timed out: '+label);}
app.whenReady().then(async()=>{let win;try{
 win=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/avatar.html')),'avatar');const js=code=>win.webContents.executeJavaScript(`(async()=>{${code}})()`);
 await until(()=>js('return Boolean(window.gla_live);'),'client');const tested=await js('return await gla.delegate.test();');assert(tested.ok,tested.error);assert.equal(tested.model,'gpt-5.6-luna');console.log('Actual GPT-5.6 Luna response received.');
 await js(`window.qaClock=new AudioContext();await qaClock.resume();window.qaDestination=qaClock.createMediaStreamDestination();window.qaSource=qaClock.createConstantSource();qaSource.offset.value=0;qaSource.connect(qaDestination);qaSource.start();
 Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>qaDestination.stream});window.qaError='';window.qaEvents=[];window.qaSent=[];const send=gla_live.send.bind(gla_live);gla_live.send=event=>{qaSent.push({...event,event_id:'evt_'+(gla_live._nextEventId+1)});return send(event);};gla_live.addEventListener('remote-track',({detail})=>{window.qaOutput=qaClock.createAnalyser();qaOutput.fftSize=1024;window.qaSamples=new Float32Array(1024);qaClock.createMediaStreamSource(detail.stream).connect(qaOutput);});gla_live.addEventListener('error',({detail})=>qaError=detail.message);gla_live.addEventListener('event',({detail})=>qaEvents.push({type:detail.type,id:detail.delegation?.id,client_event_id:detail.client_event_id}));
 await gla_live.start({voice:'marin',muted:false});`);
 await until(()=>js("return gla_live.state==='connected'||qaError;"),'client delegation live session');assert(!await js('return qaError;'),await js('return qaError;'));assert.equal(await js('return gla_live.reasoningMode;'),'delegate');
 // Feed a generated spoken question into WebRTC, after the greeting.
 // Commentary is app context, not a substitute for user audio turns.
 await wait(3500);
 const speech=fs.readFileSync(path.join(output,'question.wav')).toString('base64');
 await js(`const bytes=Uint8Array.from(atob('${speech}'),c=>c.charCodeAt(0));const buffer=await qaClock.decodeAudioData(bytes.buffer);window.qaQuestion=qaClock.createBufferSource();qaQuestion.buffer=buffer;qaQuestion.connect(qaDestination);qaQuestion.start();`);
 await until(()=>js("return qaEvents.some(e=>e.type==='session.delegation.created')||qaError;"),'actual delegation event',40000);assert(!await js('return qaError;'),await js('return qaError;'));
 await until(()=>js("return qaSent.some(s=>s.delegation_id&&/12186489|12,186,489/.test(s.content)&&qaEvents.some(e=>e.type==='session.commentary.appended'&&e.client_event_id===s.event_id));"),'actual delegated reply',40000);
 await js('window.qaReplyPeak=0;');
 await until(()=>js("if(qaOutput){qaOutput.getFloatTimeDomainData(qaSamples);qaReplyPeak=Math.max(qaReplyPeak,Math.sqrt(qaSamples.reduce((n,x)=>n+x*x,0)/qaSamples.length));}return qaReplyPeak>.001&&gla_live.conversation().some(m=>m.role==='assistant'&&/12,186,489|12186489|twelve million/i.test(m.text));"),'spoken delegated answer',25000);
 const state=await js('return {peakRms:qaReplyPeak,events:qaEvents,sent:qaSent.filter(s=>s.delegation_id),history:gla_live.conversation(),error:qaError};');assert(!state.error,state.error);
 const report={passed:true,model:tested.model,connectionReply:tested.text,delegationCreated:state.events.some(e=>e.type==='session.delegation.created'),acceptedResult:state.sent,spokenResultPeakRms:state.peakRms,history:state.history};fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }catch(error){console.error(error.message);if(win){const diagnostic=await win.webContents.executeJavaScript('JSON.stringify({events:window.qaEvents,sent:window.qaSent,history:window.gla_live?.conversation(),error:window.qaError})').catch(()=>null);fs.writeFileSync(path.join(output,'failure.json'),diagnostic||'{}');console.error(diagnostic);}process.exitCode=1;}finally{if(win&&!win.isDestroyed())await win.webContents.executeJavaScript('gla_live.stop();window.qaSource?.stop();window.qaClock?.close();').catch(()=>{});fs.rmSync(path.join(app.getPath('userData'),'openai-key.bin'),{force:true});app.exit(process.exitCode||0);}});
