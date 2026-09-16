// Opt-in real-service Avatar Show: the actual reasoning model writes the
// script, the Director answers by text, custom motions go through Meshy and
// Blender when the Playwright asks for them, and the characters perform with
// real GPT-Live voices. The human line is passed to the standby from the
// prompter buttons. Frames are captured for a silent review video.
// Run: npx electron qa/show-live.cjs --live
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
if(!process.argv.includes('--live'))throw Error('Use --live for the real service test.');
app.setName('gpt-live-avatar');const repo=path.resolve(__dirname,'..'),out=path.join(repo,'build/qa-show-live');fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(out+'/frames',{recursive:true});
app.setPath('userData',path.join(out,'profile'));fs.mkdirSync(app.getPath('userData')+'/avatars',{recursive:true});delete process.env.GLA_OPENAI_KEY;
fs.copyFileSync(path.join(os.homedir(),'Library/Application Support/gpt-live-avatar/openai-key.bin'),path.join(app.getPath('userData'),'openai-key.bin'));
fs.writeFileSync(path.join(app.getPath('userData'),'config.json'),JSON.stringify({avatar:'tia',quality:'balanced',bubbleMode:'off',reasoningMode:'delegate',delegateProvider:'openai',delegateAuth:'api_key',delegateModel:'gpt-5.6-luna',avatarLooks:{tia:{}}}));
for(const slug of ['tia','sarah','iselda','ming-mei','seraphim']){const link=app.getPath('userData')+'/avatars/'+slug;if(!fs.existsSync(link))fs.symlinkSync(repo+'/build/characters/'+slug,link);}
const errors=[],log=[];const note=(...a)=>{const line=new Date().toISOString().slice(11,19)+' '+a.join(' ');console.log(line);log.push(line);};
app.on('browser-window-created',(_e,w)=>w.webContents.on('console-message',d=>{if(d.level==='error')errors.push(d.message);}));require('../electron/main.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));async function until(fn,label,timeout=120000){const end=Date.now()+timeout;while(Date.now()<end){try{const r=await fn();if(r)return r;}catch{}await wait(150);}throw Error('Timed out: '+label);}
app.whenReady().then(async()=>{let win,recorder=0;try{
 const primary=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/avatar.html')),'primary');await until(()=>primary.webContents.executeJavaScript('Boolean(window.gla_avatar?.model)'),'primary ready');await primary.webContents.executeJavaScript('gla.group.open()');
 win=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/group.html')),'group');const js=s=>win.webContents.executeJavaScript('(async()=>{'+s+'})()');
 await until(()=>js('return Boolean(window.gla_group)&&!gla_group.state.loading&&gla_group.actors.size===2&&Boolean(gla_group.show)'),'loaded');
 const shot=async name=>fs.writeFileSync(out+'/'+name+'.png',(await win.webContents.capturePage()).toPNG());
 let frame=0;const record=()=>{recorder=setInterval(async()=>{try{const png=(await win.webContents.capturePage()).toPNG();fs.writeFileSync(out+'/frames/'+String(frame++).padStart(5,'0')+'.png',png);}catch{}},200);};
 await js("document.querySelector('#humanName').value='Adam';document.querySelector('#join').checked=true;document.querySelector('#join').onchange();document.querySelector('#showLength').value='short';");
 const status=()=>js("return JSON.stringify({phase:gla_group.show.phase,busy:gla_group.show.busy,status:document.querySelector('#showStatus').textContent,progress:document.querySelector('#showProgress').textContent,chat:gla_group.show.chat.map(c=>c.role+': '+c.text)})").then(JSON.parse);
 // Brief the Director in Chinese by text.
 await js("document.querySelector('#showText').value='\u6211\u60f3\u8981\u4e00\u4e2a\u5173\u4e8e\u4e22\u5931\u738b\u51a0\u7684\u77ed\u559c\u5267\uff0c\u53f0\u8bcd\u7528\u4e2d\u6587\u3002\u6211\u6765\u6f14\u5c0f\u4e11\uff0c\u53ea\u8981\u4e24\u4e09\u53e5\u53f0\u8bcd\u5c31\u597d\u3002';document.querySelector('#showSend').click();");
 await until(async()=>(await status()).chat.length>=2&&!(await status()).busy,'director reply',180000);note('Director:',(await status()).chat.at(-1));
 await shot('01-briefing');
 let s=await status();
 if(s.phase==='planning'){await js("document.querySelector('#showText').value='\u597d\uff0c\u5c31\u8fd9\u6837\uff0c\u51c6\u5907\u5f00\u59cb\u5427\u3002';document.querySelector('#showSend').click();");await until(async()=>{s=await status();return s.phase!=='planning'||(!s.busy&&s.chat.length>=4);},'cue',180000);note('After cue:',JSON.stringify(s));}
 if((await status()).phase==='planning'){note('Cue not detected, pressing Prepare');await js("document.querySelector('#showPrepare').click();");}
 let last='';await until(async()=>{s=await status();const line=s.phase+' | '+s.status+' | '+s.progress.replace(/\n/g,' / ');if(line!==last){note(line);last=line;}return s.phase==='ready'||s.phase==='performing'||(!s.busy&&s.phase==='planning'&&/error|could not|failed|rejected/i.test(s.status));},'prepared',900000);
 s=await status();if(s.phase==='planning')throw Error('Preparation failed: '+s.status);
 const script=await js('return gla_group.show.script');fs.writeFileSync(out+'/script.json',JSON.stringify(script,null,1));note('Script:',script.title,'| lines',script.lineCount,'| user role',script.userRole?.role,'| wanted',JSON.stringify(script.wantedMotions.map(w=>w.id)));
 await shot('02-ready');record();
 await until(async()=>(await status()).phase==='performing','curtain up',30000);
 // Human lines: pass the first to the standby, deliver the rest with "I said it".
 let humanTurns=0;const cast=await js('return [...gla_group.actors.keys()]');
 while(true){s=await status();if(s.phase!=='performing')break;
  const prompter=await js("return document.querySelector('#prompter').hidden?'':document.querySelector('#prompterText').textContent");
  if(prompter){humanTurns++;note('Prompter:',prompter);await wait(2500);await shot('03-prompter-'+humanTurns);await js(humanTurns===1?"document.querySelector('#prompterPass').click();":"document.querySelector('#prompterDone').click();");await until(()=>js("return document.querySelector('#prompter').hidden||document.querySelector('#prompterText').textContent!=="+JSON.stringify(prompter)),'prompter handled',60000);}
  await wait(300);
 }
 clearInterval(recorder);recorder=0;await shot('04-curtain-call');
 s=await status();note('Final:',JSON.stringify(s));assert.equal(s.phase,'finished');assert.match(s.status,/Curtain call/);
 const transcript=await js("return [...document.querySelectorAll('#transcript p')].map(p=>p.textContent)");fs.writeFileSync(out+'/transcript.txt',transcript.join('\n'));note('Transcript lines:',transcript.length);
 assert(transcript.some(t=>/standby|takes the line/.test(t)),'the standby covered a passed line');
 assert(humanTurns>=1,'the human got a prompter line');
 await js('await gla.group.close();');await wait(500);
 fs.writeFileSync(out+'/report.json',JSON.stringify({passed:true,title:script.title,lines:script.lineCount,wanted:script.wantedMotions.map(w=>w.id),humanTurns,cast,errors,log},null,1));
 try{execFileSync('/opt/homebrew/bin/ffmpeg',['-y','-framerate','5','-i',out+'/frames/%05d.png','-vf','scale=trunc(iw/2)*2:trunc(ih/2)*2','-c:v','libx264','-pix_fmt','yuv420p','-crf','23',out+'/show-live.mp4'],{stdio:'ignore'});note('Video written');}catch(e){note('ffmpeg failed: '+e.message);}
 console.log('show live qa passed');
 }catch(e){console.error(e);console.error(errors);if(recorder)clearInterval(recorder);try{if(win)fs.writeFileSync(out+'/failure.png',(await win.webContents.capturePage()).toPNG());}catch{}fs.writeFileSync(out+'/report.json',JSON.stringify({passed:false,error:e.message,errors,log},null,1));process.exitCode=1;}finally{app.exit(process.exitCode||0);}});
