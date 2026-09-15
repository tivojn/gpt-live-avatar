'use strict';
// Real Electron renderers/IPC, isolated settings/assets, deterministic local agents.
// Run: node_modules/.bin/electron qa/overhead-composer-smoke.cjs
// GLA_QA_OUTPUT may select an ignored/private output directory. No cloud sessions.
const {app,BrowserWindow,ipcMain,safeStorage,session}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const repo=path.resolve(__dirname,'..');
const out=process.env.GLA_QA_OUTPUT||fs.mkdtempSync(path.join(os.tmpdir(),'gla-overhead-composer-'));
fs.mkdirSync(path.join(out,'profile','avatars'),{recursive:true});
fs.mkdirSync(path.join(out,'files'),{recursive:true});
app.setPath('userData',path.join(out,'profile'));
delete process.env.GLA_OPENAI_KEY;
fs.writeFileSync(path.join(out,'profile','config.json'),JSON.stringify({avatar:'tia',quality:'friendly',bubbleMode:'auto',agentEnabled:true,agentEngine:'codex',agentFollowReasoning:false,reasoningMode:'delegate',conversationSounds:false,windowWidth:620,windowHeight:850}));
for(const slug of ['tia','sarah'])fs.symlinkSync(path.join(repo,'build','characters',slug),path.join(out,'profile','avatars',slug));
const errors=[],calls=[],answers=[],actionReplies=[],ignoreState=new Map(),network=[],voiceCalls=[];
const ignored=BrowserWindow.prototype.setIgnoreMouseEvents;
BrowserWindow.prototype.setIgnoreMouseEvents=function(value,...args){ignoreState.set(this.id,Boolean(value));return ignored.call(this,value,...args);};
ipcMain.on('gla:agent:action-result',(e,result)=>actionReplies.push({sender:e.sender.id,...result}));
const {CodexAgent}=require('../electron/codex-agent.cjs');
CodexAgent.prototype.status=async()=>({signedIn:true,models:['qa-local'],servers:[],computerUse:false});
CodexAgent.prototype.answer=async function(owner,id,config,history,request,character,tools,onReceipt=()=>{},progress=()=>{}){
 const key=JSON.stringify([owner,character]),job={owner,id,character,abort:new AbortController(),threadId:'qa-'+id};
 assert(!this.jobs.has(key),'The same avatar must not begin two simultaneous composer requests.');
 this.jobs.set(key,job);this.byThread.set(job.threadId,job);
 const call={owner,id,character,history,request,folder:config.agentFolder,done:false};calls.push(call);
 try{
  call.state=await tools.execute('avatar_state',{},job.abort.signal);
  assert(call.state.ok,'The original avatar renderer answered the control request.');
  progress({state:'update',text:character+' checks '+os.homedir()+'/Downloads/composer-check.txt'});
  if(request.includes('question')){
   progress({state:'waiting'});
   call.answer=await this.ask({threadId:job.threadId,character,signal:job.abort.signal,questions:[{id:'choice',question:'Keep the file in '+os.homedir()+'/Downloads?',options:[{label:os.homedir()+'/Downloads',description:'Retain the test fixture.'},{label:'Cancel',description:'Cancel the fixture request.'}]}]});
   answers.push({character,request,value:call.answer});
  }else if(request.includes('hold')){
   await new Promise((resolve,reject)=>{call.release=resolve;job.reject=reject;job.abort.signal.addEventListener('abort',()=>reject(Error('Request cancelled.')),{once:true});});
  }
  job.abort.signal.throwIfAborted();
  const receipts=[];
  if(request.includes('shared')){
   const file=path.join(out,'files','shared-composer.txt');fs.writeFileSync(file,'Verified local composer fixture.');
   receipts.push({tool:'fileChange',ok:true,path:file,summary:'Verified local composer fixture.'});
   for(const receipt of receipts)onReceipt(receipt);
  }
  const text=character+' verified '+request+'.';call.result=text;return {engine:'codex',character,text,receipts};
 }finally{call.done=true;this.jobs.delete(key);this.byThread.delete(job.threadId);}
};
require('../electron/delegate.cjs').DelegateBackend.prototype.answer=async()=>{throw Error('Unexpected non-agent model call in isolated composer QA.');};
app.on('browser-window-created',(_event,w)=>{
 w.webContents.on('console-message',d=>{if(d.level==='error')errors.push({window:w.id,message:d.message});});
 w.webContents.on('render-process-gone',(_e,detail)=>errors.push({window:w.id,renderProcessGone:detail.reason}));
 w.webContents.once('dom-ready',()=>{try{w.webContents.debugger.attach('1.3');w.webContents.debugger.on('message',(_e,method,p)=>{if(method==='Runtime.exceptionThrown')errors.push({window:w.id,exception:p.exceptionDetails.exception?.description||p.exceptionDetails.text});});void w.webContents.debugger.sendCommand('Runtime.enable');}catch{}});
});
app.whenReady().then(()=>{
 fs.writeFileSync(path.join(out,'profile','openai-key.bin'),safeStorage.encryptString('sk-isolated-qa-placeholder'));
 session.defaultSession.webRequest.onBeforeRequest((detail,done)=>{
  const local=/^(?:file:|data:|blob:|devtools:|http:\/\/(?:127\.0\.0\.1|localhost):)/.test(detail.url);
  if(!local)network.push(detail.url);done({cancel:!local});
 });
});
require('../electron/main.cjs');
// The fake voice objects below prevent audio/network capture. This permission
// shim only verifies that UI start controls reach the normal permission path.
ipcMain.removeHandler('gla:mic:ask');ipcMain.handle('gla:mic:ask',()=>{voiceCalls.push('mic-permission');return true;});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label,timeout=120000){const start=Date.now();let last;while(Date.now()-start<timeout){try{const value=await fn();if(value)return value;}catch(e){last=e;}await wait(80);}throw Error('Timed out '+label+(last?' ('+last.message+')':''));}
const run=(w,code)=>w.webContents.executeJavaScript('(async()=>{'+code+'})()');
const snapshot=async(w,label)=>fs.writeFileSync(path.join(out,label+'.png'),(await w.webContents.capturePage()).toPNG());
function noPopup(expected){assert.equal(BrowserWindow.getAllWindows().length,expected,'Ask creates no extra native window');}
async function bounds(w,selector){const b=await run(w,`const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,w:innerWidth,h:innerHeight};`);assert(b.x>=-1&&b.y>=-1&&b.right<=b.w+1&&b.bottom<=b.h+1,selector+' stays within its viewport: '+JSON.stringify(b));return b;}
async function noDialog(w){assert.equal(await run(w,'return document.querySelectorAll("dialog[open], [aria-modal=true]").length'),0,'No blocking dialog opens');}
async function typeSolo(w,text){await run(w,`const i=document.querySelector('#steer');i.value=${JSON.stringify(text)};i.dispatchEvent(new Event('input',{bubbles:true}));`);await until(()=>run(w,"return !document.querySelector('#steerBtn').disabled"),'solo send enabled',5000);await run(w,"document.querySelector('#steerBtn').click()");}
async function typeGroup(w,slug,text){await run(w,`const a=gla_group.actors.get(${JSON.stringify(slug)}),i=a.el.querySelector('.actor-ask-input');i.value=${JSON.stringify(text)};i.dispatchEvent(new Event('input',{bubbles:true}));`);await until(()=>run(w,`return !gla_group.actors.get(${JSON.stringify(slug)}).el.querySelector('.actor-ask-send').disabled`),'group send enabled',5000);await run(w,`gla_group.actors.get(${JSON.stringify(slug)}).el.querySelector('.actor-ask-form').requestSubmit();`);}
async function gapCheck(w,group){
 const point=await run(w,group?`for(let y=110;y<innerHeight-25;y+=23)for(let x=10;x<innerWidth-10;x+=23){const top=document.elementFromPoint(x,y);if(!top?.closest('.panel,.speech')&&!gla_group.actorAt({clientX:x,clientY:y,target:top}))return {x,y};}throw Error('No transparent group gap');`:`const b=gla_visibleBox();if(!b)return {x:5,y:innerHeight-5};for(const p of [{x:5,y:innerHeight-5},{x:innerWidth-5,y:innerHeight-5},{x:5,y:5}]){const t=document.elementFromPoint(p.x,p.y);if(!t?.closest('#bubble,#listen')&&(p.x<b.x||p.x>b.x+b.w||p.y<b.y||p.y>b.y+b.h))return p;}return {x:5,y:innerHeight-5};`);
 w.webContents.sendInputEvent({type:'mouseMove',...point});
 await until(()=>ignoreState.get(w.id)===true,'transparent gap sets native click-through',5000);
 return point;
}
let report={out,passed:false},solo,group;
app.whenReady().then(async()=>{try{
 solo=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/avatar.html')),'solo window');
 await until(()=>run(solo,'return window.gla_avatar?.resources?.ready && document.querySelector("#agentQuestions")'),'new solo composer');
 for(const w of BrowserWindow.getAllWindows())if(w!==solo)w.close();
 solo.setBounds({x:70,y:55,width:620,height:850});solo.show();solo.focus();
 const initialCount=BrowserWindow.getAllWindows().length;
 const settings=await run(solo,'return gla.getSettings()');assert.equal(settings.agentFolder,path.join(os.homedir(),'Downloads'),'A fresh install defaults to Downloads');
 solo.webContents.send('gla:menu-action','agent');
 await until(()=>run(solo,'return document.activeElement?.id==="steer"'),'solo input focus');
 noPopup(initialCount);await noDialog(solo);await until(()=>run(solo,'return gla_visibleBox()'),'first painted avatar');await wait(250);
 assert(await run(solo,'return /head/i.test(document.querySelector("#composerTip").textContent+document.querySelector("#steer").placeholder)'),'Composer explains the head interaction');
 await gapCheck(solo,false);await snapshot(solo,'solo-composer');
 await run(solo,'await gla.setSettings({bubbleMode:"off"})');solo.webContents.send('gla:menu-action','agent');await until(()=>run(solo,'return document.activeElement.id==="steer"&&!document.querySelector("#bubble").classList.contains("hidden")'),'Ask overrides bubble off');await run(solo,'document.querySelector("#composerClose").click()');await until(()=>run(solo,'return document.querySelector("#bubble").classList.contains("hidden")'),'Close restores bubble off');await run(solo,'await gla.setSettings({bubbleMode:"auto"})');solo.webContents.send('gla:menu-action','agent');
 await typeSolo(solo,'solo hold');const soloCall=await until(()=>calls.find(c=>c.request==='solo hold'),'idle solo request');
 assert.equal(soloCall.owner,solo.webContents.id);assert.equal(soloCall.character,'Tia');
 await until(()=>run(solo,'return document.querySelector("#bubble").innerText.includes("~/Downloads/composer-check.txt")'),'redacted solo progress');
 assert(!(await run(solo,'return document.querySelector("#bubble").innerText')).includes(os.homedir()),'User home is shortened only for display');
 assert(actionReplies.some(r=>r.sender===solo.webContents.id),'Avatar controls reply from original solo renderer');
 await snapshot(solo,'solo-task');
 await run(solo,'document.querySelector("#composerClose").click()');assert.equal(soloCall.done,false,'Closing the composer keeps its task running');soloCall.release();
 await until(()=>soloCall.done,'solo task finishes');
 solo.webContents.send('gla:menu-action','agent');await until(()=>run(solo,`return document.querySelector('#bubble').innerText.includes(${JSON.stringify('Tia verified solo hold.')})`),'solo final result');
 assert.equal((await run(solo,'return document.querySelector("#bubble").innerText')).split('Tia verified solo hold.').length-1,1,'One copy of the final result');
 solo.setBounds({x:70,y:55,width:360,height:510});await wait(350);
 await typeSolo(solo,'solo question');await until(()=>run(solo,'return document.querySelector("#agentQuestions .agent-question")!==null'),'inline solo question');
 await noDialog(solo);noPopup(initialCount);
 report.compactQuestionBounds=await bounds(solo,'#bubble');await snapshot(solo,'solo-compact-question');
 const wheelBefore=await run(solo,'const s=await gla.getSettings();return {orbit:gla_avatar.orbit,saved:[s.orbitYaw,s.orbitPitch]}');const wheel=await run(solo,`const q=document.querySelector('#agentQuestions .agent-question'),event=new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaX:70,deltaY:120});q.dispatchEvent(event);return {prevented:event.defaultPrevented,overflow:getComputedStyle(q).overflowY};`);assert.equal(wheel.prevented,false,'Question keeps native scrolling');assert.equal(wheel.overflow,'auto');await wait(500);assert.deepEqual(await run(solo,'const s=await gla.getSettings();return {orbit:gla_avatar.orbit,saved:[s.orbitYaw,s.orbitPitch]}'),wheelBefore,'Scrolling question does not rotate avatar or alter saved orbit');
 assert.equal(await run(solo,'return document.querySelector("#agentQuestions .agent-choices button").textContent'),'~/Downloads','Question options redact the display path');
 await run(solo,'document.querySelector("#agentQuestions .agent-choices button").click();document.querySelector("#agentQuestions .agent-question").requestSubmit()');
 await until(()=>answers.some(a=>a.request==='solo question'),'inline answer relayed');
 assert.deepEqual(answers.find(a=>a.request==='solo question').value,{answers:{choice:{answers:[os.homedir()+'/Downloads']}}},'Question option submits the original full path');
 await until(()=>calls.find(c=>c.request==='solo question')?.done,'question completes');solo.setBounds({x:70,y:55,width:620,height:850});await wait(250);
 await typeSolo(solo,'solo question cancel');await until(()=>run(solo,'return document.querySelector("#agentQuestions .agent-question")!==null'),'cancel question');
 await run(solo,'document.querySelector("#agentQuestions .agent-question-actions button:last-child").click()');await until(()=>answers.some(a=>a.request==='solo question cancel'),'dismiss response');assert.deepEqual(answers.at(-1).value,{answers:{}});
 await until(()=>calls.find(c=>c.request==='solo question cancel')?.done,'dismiss completes');
 const rawRequest='Read '+os.homedir()+'/Downloads/raw-input.txt';await typeSolo(solo,rawRequest);await until(()=>calls.find(c=>c.request===rawRequest)?.done,'raw path request');assert.equal(calls.find(c=>c.request===rawRequest).history.at(-1).text,rawRequest,'Display redaction never rewrites actual requests/history');
 await run(solo,`window.qaVoice=[];gla_live.start=async function(o){qaVoice.push(['start',o.voice]);this._setState('connected');};gla_live.stop=function(reason){qaVoice.push(['stop',reason]);this._setState('idle',{reason});};gla_live.setMuted=function(value){this.muted=value;qaVoice.push(['mute',value]);};`);
 await run(solo,'document.querySelector("#muteBtn").click()');await until(()=>run(solo,'return qaVoice.some(v=>v[0]==="start")'),'idle microphone starts fake voice');
 await run(solo,'document.querySelector("#muteBtn").click()');assert(await run(solo,'return qaVoice.some(v=>v[0]==="mute")'),'Live microphone toggles mute');
 await run(solo,'gla_live.stop("qa");document.querySelector("#composerClose").click()');
 const head=await run(solo,`const c=document.querySelector('#stage'),d=c.getContext('2d').getImageData(0,0,c.width,c.height),sx=innerWidth/c.width,sy=innerHeight/c.height;for(let y=0;y<d.height*.5;y+=2)for(let x=0;x<d.width;x+=2)if(d.data[(y*d.width+x)*4+3]>220)return {x:(x+.5)*sx,y:(y+.5)*sy};throw Error('No head pixels');`);
 await run(solo,`document.querySelector('#stage').dispatchEvent(new MouseEvent('dblclick',{bubbles:true,clientX:${head.x},clientY:${head.y}}));`);await until(()=>run(solo,'return qaVoice.filter(v=>v[0]==="start").length===2'),'head double click starts fake voice');
 report.solo={noPopup:true,focus:true,clickThrough:true,idleRequest:true,redaction:true,inlineQuestion:true,closeKeepsTask:true,micAndHead:true,bubbleOff:true,questionScroll:true};
 await run(solo,'gla_live.stop("qa");await gla.group.open()');
 group=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/group.html')),'Together window');
 await until(()=>run(group,'return window.gla_group&&!gla_group.state.loading&&gla_group.actors.size===2&&document.querySelector(".actor-ask-input")'),'new group composers');
 const groupCount=BrowserWindow.getAllWindows().length;
 await run(group,`document.querySelector('#minimize').click();await gla_group.actorMenuAction({slug:'sarah',action:'agent'});`);
 await until(()=>run(group,'return document.activeElement?.closest(".actor")?.dataset.slug==="sarah"'),'Sarah focus');
 await run(group,"await gla_group.actorMenuAction({slug:'tia',action:'agent'})");
 await typeGroup(group,'sarah','sarah shared');await until(()=>calls.find(c=>c.request==='sarah shared')?.done,'Sarah shared request');
 assert.equal(calls.find(c=>c.request==='sarah shared').character,'Sarah','Opening Tia later cannot retarget Sarah form');
 await typeGroup(group,'tia','tia follow-up');await until(()=>calls.find(c=>c.request==='tia follow-up')?.done,'Tia shared follow-up');
 const followup=calls.find(c=>c.request==='tia follow-up');assert(JSON.stringify(followup.history).includes('shared-composer.txt'),'Tia receives Sarah verified receipt');assert(JSON.stringify(followup.history).includes('Sarah verified sarah shared.'),'Tia receives Sarah spoken answer context');
 await typeGroup(group,'sarah','sarah hold');await typeGroup(group,'tia','tia hold');
 const s=await until(()=>calls.find(c=>c.request==='sarah hold'),'Sarah concurrent task'),t=await until(()=>calls.find(c=>c.request==='tia hold'),'Tia concurrent task');
 await until(()=>run(group,'return [...gla_group.actors.values()].every(a=>a.activity?.active&&a.bubble.innerText.includes("~/Downloads/composer-check.txt"))'),'independent concurrent progress');
 noPopup(groupCount);await noDialog(group);await gapCheck(group,true);await bounds(group,'.actor[data-slug=sarah] .speech');await bounds(group,'.actor[data-slug=tia] .speech');await snapshot(group,'group-concurrent-composers');
 await run(group,"gla_group.actors.get('sarah').el.querySelector('.actor-ask-stop').click()");await until(()=>s.done,'Sarah task cancelled');assert.equal(t.done,false,'Cancelling Sarah keeps Tia running');
 t.release();await until(()=>t.done,'Tia finishes');
 await typeGroup(group,'sarah','sarah question');await until(()=>run(group,"return Boolean(gla_group.actors.get('sarah').el.querySelector('.agent-question'))"),'Sarah inline question');assert(!(await run(group,"return Boolean(gla_group.actors.get('tia').el.querySelector('.agent-question'))")),'Question remains attached to Sarah');
 await run(group,"const a=gla_group.actors.get('sarah');a.el.querySelector('.agent-choices button').click();a.el.querySelector('.agent-question').requestSubmit()");await until(()=>answers.some(a=>a.request==='sarah question'),'Sarah answer');assert.equal(answers.at(-1).character,'Sarah');
 await until(()=>calls.find(c=>c.request==='sarah question')?.done,'Sarah question done');
 await run(group,`window.qaGroupVoice=[];window.qaGroupStartHistory=[];const l=gla_group.liveGroup;l.start=async function(config){this.running=true;this.cast=config.cast;this.active=config.cast[0].slug;this.muted=false;qaGroupStartHistory.push(config.initialHistory);qaGroupVoice.push(['start',this.active]);};l.open=function(slug){this.active=slug;qaGroupVoice.push(['open',slug]);};l.setMuted=function(value){this.muted=value;qaGroupVoice.push(['mute',value]);};`);
 await typeGroup(group,'tia','tia voice hold');const voiceTask=await until(()=>calls.find(c=>c.request==='tia voice hold'&&c.release),'pending typed task before microphone');
 await run(group,"gla_group.actors.get('sarah').el.querySelector('.actor-ask-mic').click()");await until(()=>run(group,'return qaGroupVoice.some(x=>x[0]==="start")'),'group microphone fake voice');assert(await run(group,'return gla_group.liveGroup.directed==="sarah"'),'Group mic directs Sarah');assert.equal(voiceTask.done,false,'Starting Sarah microphone keeps Tia typed task running');assert(await run(group,"return gla_group.actors.get('tia').activity?.active"),'Starting voice preserves typed task progress');assert(await run(group,"return JSON.stringify(qaGroupStartHistory[0]).includes('Sarah verified sarah shared.')"),'Microphone start receives prior typed conversation history');voiceTask.release();await until(()=>voiceTask.done,'pending typed task finishes after microphone start');
 await run(group,'gla_group.stop()');
 const gh=await run(group,`const a=gla_group.actors.get('tia'),m=a.hitMask.pixels;for(let y=0;y<m.height*.35;y++)for(let x=0;x<m.width;x++)if(m.data[(y*m.width+x)*4+3]>230){const p={clientX:a.x+(x+.5)*a.w/m.width,clientY:a.y+(y+.5)*a.h/m.height};if(gla_group.headAt(a,p))return {x:p.clientX,y:p.clientY};}throw Error('No group head pixel');`);
 await run(group,`gla_group.actors.get('tia').avatar.canvas.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,clientX:${gh.x},clientY:${gh.y}}));`);await until(()=>run(group,'return qaGroupVoice.filter(x=>x[0]==="start").length===2'),'group head starts fake voice');assert(await run(group,'return gla_group.liveGroup.directed==="tia"'),'Double clicked head targets Tia');
 await run(group,'gla_group.stop()');
 await snapshot(group,'group-results');
 assert(actionReplies.some(r=>r.sender===group.webContents.id),'Group controls execute in original group renderer');
 assert.deepEqual(errors,[],'No renderer errors or shader compile errors');
 report={...report,passed:true,group:{noPopup:true,targetIsolation:true,sharedHistory:true,concurrentProgress:true,isolatedCancellation:true,inlineQuestion:true,micAndHead:true,clickThrough:true,typedTaskSurvivesMicStart:true,micRetainsHistory:true},voicePermissionCalls:voiceCalls.length,calls:calls.map(({release,...c})=>c),answers,network,errors};
 console.log('Overhead composer native QA passed. '+out);
 }catch(e){report.error=e.stack;report.errors=errors;console.error(e.stack);for(const [label,w] of [['solo',solo],['group',group]])if(w&&!w.isDestroyed())await snapshot(w,label+'-failure').catch(()=>{});process.exitCode=1;}
 finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));app.exit(process.exitCode||0);}
});
