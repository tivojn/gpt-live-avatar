'use strict';
// Real avatar renderers and IPC; deterministic progress events exercise UI races.
// --live also verifies a real Codex commentary stream and a small local file task.
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=root+'/build/qa-agent-progress';
fs.mkdirSync(out+'/profile/avatars',{recursive:true});fs.mkdirSync(out+'/files',{recursive:true});app.setPath('userData',out+'/profile');
for(const slug of ['tia','sarah'])if(!fs.existsSync(out+'/profile/avatars/'+slug))fs.symlinkSync(root+'/build/characters/'+slug,out+'/profile/avatars/'+slug);
fs.writeFileSync(out+'/profile/config.json',JSON.stringify({avatar:'tia',quality:'friendly',bubbleMode:'auto',agentEnabled:true,agentEngine:'codex',agentFolder:out+'/files',reasoningMode:'delegate',windowWidth:500,windowHeight:820}));
const errors=[];app.on('browser-window-created',(_e,w)=>w.webContents.on('console-message',d=>{if(d.level==='error')errors.push(d.message);}));
require('../electron/main.cjs');const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){const end=Date.now()+120000;while(Date.now()<end){const result=await fn();if(result)return result;await wait(120);}throw Error('Timed out: '+label);}
const run=(w,code)=>w.webContents.executeJavaScript('(async()=>{'+code+'})()');
const send=(w,p)=>w.webContents.send('gla:agent:progress',p);
const snap=async(w,name)=>fs.writeFileSync(out+'/'+name+'.png',(await w.webContents.capturePage()).toPNG());
const rects=async(w)=>run(w,"const b=document.querySelector('#bubble'),r=b.getBoundingClientRect();return {hidden:b.classList.contains('hidden'),text:b.innerText,x:r.x,y:r.y,right:r.right,bottom:r.bottom,w:innerWidth,h:innerHeight,toast:document.querySelector('#toast').className}");
app.whenReady().then(async()=>{try{
 const solo=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/avatar.html')),'solo');await until(()=>run(solo,'return window.gla_avatar?.resources.ready'),'avatar');
 for(const w of BrowserWindow.getAllWindows())if(w!==solo)w.close();solo.setBounds({x:30,y:50,width:650,height:880});
 send(solo,{id:'long',character:'Tia',state:'thinking'});send(solo,{id:'long',character:'Tia',state:'working',tool:'imageGeneration'});send(solo,{id:'long',character:'Tia',state:'update',text:'I’m creating your image now. Next I’ll save it to your Desktop and check the result.'});await wait(400);
 let r=await rects(solo);assert(!r.hidden);assert(r.text.includes('creating your image'));assert(!r.text.includes('imageGeneration'));assert(!r.toast.includes('show'));assert(r.x>=0&&r.y>=0&&r.right<=r.w&&r.bottom<=r.h,JSON.stringify(r));await snap(solo,'solo-working');
 await run(solo,"gla_avatar.motion.play('kung-fu-punch',{loop:true})");await wait(10000);assert(!(await rects(solo)).hidden,'Long work remains visible during motion');
 await run(solo,"gla.setSettings({bubbleMode:'off'})");await wait(250);assert((await rects(solo)).hidden,'Off remains off during task');
 await run(solo,"gla.setSettings({bubbleMode:'auto'})");await wait(250);assert(!(await rects(solo)).hidden,'Auto returns to active work');
 send(solo,{id:'long',state:'tool-error'});await wait(200);assert(!(await rects(solo)).hidden);
 send(solo,{id:'new',character:'Tia',state:'thinking'});send(solo,{id:'long',state:'complete',text:'Old result'});send(solo,{id:'new',state:'update',text:'I’m checking the new request.'});await wait(200);assert((await rects(solo)).text.includes('new request'));assert(!(await rects(solo)).text.includes('Old result'));
 send(solo,{id:'new',state:'cancelled'});await wait(2100);assert((await rects(solo)).hidden,'Cancelled progress clears');
 send(solo,{id:'complete',character:'Tia',state:'thinking'});send(solo,{id:'complete',state:'complete',text:'The image is saved and ready.'});await wait(200);assert((await rects(solo)).text.includes('saved and ready'));await wait(8100);assert((await rects(solo)).hidden,'Completed task expires in Auto');
 await run(solo,"gla_avatar.motion.stop();gla.group.open()");const group=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/group.html')),'group');await until(()=>run(group,'return window.gla_group&&!gla_group.state.loading'),'group cast');
 await run(group,"document.querySelector('.panel').style.left='16px';document.querySelector('.panel').style.top='16px';document.querySelector('.panel').style.transform='none';document.querySelector('#compact').click();");
 send(group,{id:'sarah-task',character:'Sarah',state:'thinking'});send(group,{id:'sarah-task',character:'Sarah',state:'update',text:'I’m reading the page you asked about, then I’ll check the key facts.'});await wait(400);
 let groupText=await run(group,"return [...gla_group.actors.values()].map(a=>({name:a.info.name,text:a.bubble.textContent,hidden:a.bubble.hidden,rect:a.bubble.getBoundingClientRect().toJSON()}))");assert(groupText.find(a=>a.name==='Sarah').text.includes('key facts'));assert(!groupText.find(a=>a.name==='Tia').text.includes('key facts'));await snap(group,'group-sarah-working');
 await run(group,"await gla_group.actorMenuAction({slug:'sarah',action:'bubble:off'})");await wait(150);assert(await run(group,"return gla_group.actors.get('sarah').bubble.hidden"));
 await run(group,"await gla_group.actorMenuAction({slug:'sarah',action:'bubble:auto'});gla_group.liveGroup?.emit?.('floor',{speaker:'tia',listener:'sarah'});");await wait(150);assert(await run(group,"return gla_group.actors.get('sarah').bubble.textContent.includes('key facts')"));
 send(group,{id:'tia-next',character:'Tia',state:'thinking'});send(group,{id:'sarah-task',character:'Sarah',state:'error',error:'stale failure'});send(group,{id:'tia-next',character:'Tia',state:'update',text:'I’m creating the file you requested.'});await wait(200);assert(await run(group,"return gla_group.actors.get('sarah').bubble.textContent===''") );assert(await run(group,"return gla_group.actors.get('tia').bubble.textContent.includes('creating the file')"));
 send(group,{id:'tia-next',character:'Tia',state:'cancelled'});await wait(2100);assert(await run(group,"return !gla_group.actors.get('tia').bubble.textContent"));
 if(process.argv.includes('--live')){
  await run(group,"gla_group.liveGroup.emit('floor',{speaker:'',listener:''})");
  const request='Sarah, first give a brief progress update saying you are checking the test file, then use Python to write the number 56 to bubble-progress.txt in the working folder. Read it back and verify the contents.';
  await run(group,"window.progressEvents=[];gla.agent.onProgress(p=>progressEvents.push(p));");
  const task=run(group,`return gla.group.reply(${JSON.stringify({id:'real-progress',speaker:'sarah',participants:['tia','sarah'],human:{enabled:true,name:'You'},humanRequest:request,turnId:'real-progress',topic:'Verify task updates',history:[]})})`);
  await until(()=>run(group,"return progressEvents.some(p=>p.state==='update'&&p.text.length>40)"),'real public commentary');await snap(group,'group-real-codex');
  const result=await task;assert(result.ok,result.error);assert.equal(result.character,'Sarah');assert.equal(fs.readFileSync(out+'/files/bubble-progress.txt','utf8').trim(),'56');
  const events=await run(group,'return progressEvents');assert(events.every(p=>p.character==='Sarah'));fs.writeFileSync(out+'/real-report.json',JSON.stringify({result,events},null,2));
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(out+'/report.json',JSON.stringify({passed:true,solo:r,group:groupText,errors},null,2));console.log('Overhead progress in solo and Together, correct actor, cancellation races, auto/off modes, motion persistence and screen bounds passed.');
 }catch(e){console.error(e.stack);process.exitCode=1;}finally{app.exit(process.exitCode||0);}});
