'use strict';
const {app,BrowserWindow,safeStorage}=require('electron'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const repo=path.resolve(__dirname,'..'),out=repo+'/build/qa-agent-app';fs.mkdirSync(out+'/files',{recursive:true});app.setPath('userData',out+'/profile');fs.mkdirSync(app.getPath('userData')+'/avatars',{recursive:true});
fs.writeFileSync(app.getPath('userData')+'/config.json',JSON.stringify({avatar:'tia',quality:'friendly',agentEnabled:true,agentFolder:out+'/files'}));for(const slug of ['tia','sarah']){const link=app.getPath('userData')+'/avatars/'+slug;if(!fs.existsSync(link))fs.symlinkSync(repo+'/build/characters/'+slug,link);}for(const file of ['tia.txt','group.txt'])fs.rmSync(out+'/files/'+file,{force:true});
app.whenReady().then(()=>fs.writeFileSync(app.getPath('userData')+'/openai-key.bin',safeStorage.encryptString('sk-qa-placeholder')));
// Model execution is stubbed here; real native runtime requests are exercised by runtime-app.cjs.
const network=[],errors=[];let testCase='solo';
require('../electron/codex-agent.cjs').CodexAgent.prototype.answer=async function(owner,id,config,history,request,character,tools,onReceipt){
 network.push({engine:'codex',tools:tools.tools.map(t=>t.name)});
 assert(!tools.tools.some(t=>/file|page|shell/.test(t.name)));
 const moved=await tools.execute('move_avatar',{character:'Tia',destination:'upper-right'},new AbortController().signal);
 assert(moved.ok&&moved.reached,JSON.stringify(moved));
 const file=out+'/files/'+(testCase==='solo'?'tia.txt':'group.txt');fs.writeFileSync(file,'Created by the tested agent.');
 const receipts=[{tool:'move_avatar',ok:true},{tool:'fileChange',ok:true,path:file}];receipts.forEach(r=>onReceipt?.(r));
 return {engine:'codex',character,text:'I moved to the upper-right corner and created the test file.',receipts};
};
app.on('browser-window-created',(_e,w)=>w.webContents.on('console-message',d=>{if(d.level==='error')errors.push(d.message);}));require('../electron/main.cjs');const wait=ms=>new Promise(r=>setTimeout(r,ms));async function until(fn,label){const end=Date.now()+100000;while(Date.now()<end){try{const r=await fn();if(r)return r;}catch{}await wait(100);}throw Error('Timed out '+label);}
app.whenReady().then(async()=>{try{
 const solo=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/avatar.html')),'window'),js=code=>solo.webContents.executeJavaScript('(async()=>{'+code+'})()');await until(()=>js('return window.gla_avatar?.resources?.ready'),'avatar');
 const result=await js(`return await gla.agent.run({id:'solo-test',turnId:'solo-turn',history:[{role:'user',text:'Tia, go to the upper right corner and create a test file called'},{role:'user',text:'tia.txt there.'}]});`);assert(result.ok,JSON.stringify(result));assert.equal(fs.readFileSync(out+'/files/tia.txt','utf8'),'Created by the tested agent.');assert.equal(result.receipts.length,2);
 const count=network.length;const repeat=await js(`return await gla.agent.run({id:'solo-duplicate',turnId:'solo-turn',history:[{role:'user',text:'Tia, go to the upper right corner and create a test file called tia.txt there.'}]});`);assert(repeat.ok);assert.equal(network.length,count,'Same user turn reuses result without repeating effects');
 solo.webContents.send('gla:menu-action','agent');await wait(300);fs.writeFileSync(out+'/solo-result.png',(await solo.webContents.capturePage()).toPNG());await js("document.querySelector('.agent-dialog').close();await gla.group.open();");
 const group=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/group.html')),'group'),gj=code=>group.webContents.executeJavaScript('(async()=>{'+code+'})()');await until(()=>gj('return window.gla_group&&!gla_group.state.loading'),'group avatars');testCase='group';const before=await gj(`return {x:gla_group.actors.get('sarah').x,y:gla_group.actors.get('sarah').y};`);
 const grouped=await gj(`return await gla.agent.run({id:'group-test',history:[{role:'user',text:'Tia, go upper right and create a test file group.txt.'}]});`);assert(grouped.ok,JSON.stringify(grouped));assert.equal(fs.readFileSync(out+'/files/group.txt','utf8'),'Created by the tested agent.');assert.deepEqual(await gj(`return {x:gla_group.actors.get('sarah').x,y:gla_group.actors.get('sarah').y};`),before,'Sarah stays put');
 await gj("await gla_group.actorMenuAction({slug:'tia',action:'agent'});");await wait(300);fs.writeFileSync(out+'/group-result.png',(await group.webContents.capturePage()).toPNG());assert.deepEqual(errors,[]);fs.writeFileSync(out+'/report.json',JSON.stringify({passed:true,solo:result,group:grouped,errors},null,2));console.log('Real IPC, solo arrival before file creation, duplicate-turn suppression, group target isolation and result UI passed.');
 }catch(e){console.error(e);console.error(errors);process.exitCode=1;}finally{app.exit(process.exitCode||0);}});
