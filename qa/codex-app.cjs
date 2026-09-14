'use strict';
// Opt-in real Codex/ChatGPT requests. Uses an isolated app profile and fixtures.
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
if(!process.argv.includes('--live'))throw Error('Pass --live to test the signed-in Codex engine.');
const root=path.resolve(__dirname,'..'),out=path.join(root,'build/qa-codex-app');fs.mkdirSync(out+'/files',{recursive:true});app.setPath('userData',out+'/profile');fs.mkdirSync(out+'/profile/avatars',{recursive:true});
for(const slug of ['tia','sarah'])if(!fs.existsSync(out+'/profile/avatars/'+slug))fs.symlinkSync(root+'/build/characters/'+slug,out+'/profile/avatars/'+slug);
fs.writeFileSync(out+'/profile/config.json',JSON.stringify({avatar:'tia',quality:'friendly',agentEnabled:true,agentEngine:'codex',agentFolder:out+'/files',reasoningMode:'delegate',delegateProvider:'openai',delegateAuth:'oauth2'}));
const filename='shared-'+Date.now()+'.txt';
require('../electron/main.cjs');const wait=ms=>new Promise(r=>setTimeout(r,ms));async function until(fn,label){const end=Date.now()+120000;while(Date.now()<end){const result=await fn();if(result)return result;await wait(150);}throw Error('Timed out: '+label);}
app.whenReady().then(async()=>{try{
 const solo=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/avatar.html')),'solo window');const run=(w,code)=>w.webContents.executeJavaScript('(async()=>{'+code+'})()');await until(()=>run(solo,'return window.gla_avatar?.resources.ready'),'avatar');
 const status=await run(solo,'return gla.agent.codexStatus()');assert(status.ok&&status.signedIn,JSON.stringify(status));assert(status.models.includes('gpt-6-astra'),'The desktop engine exposes Astra');
 const settings=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/settings.html'));assert(settings);await until(()=>run(settings,"return document.querySelector('#agentEngine')?.value==='codex'"),'Codex settings');
 const models=['gpt-5.6-sol','gpt-5.6-terra','gpt-5.6-luna','gpt-6-astra'];
 for(const id of ['delegateModel','agentCodexModel']){const picker=await run(settings,`const e=document.querySelector('#${id}');return {tag:e.tagName,options:[...e.options].map(o=>o.value)}`);assert.equal(picker.tag,'SELECT');for(const model of models)assert(picker.options.includes(model),id+' lists '+model);}
 assert.equal(await run(settings,"return document.querySelector('#delegateModel').value"),'gpt-5.6-sol');
 for(const model of models){await run(settings,`document.querySelector('#delegateModel').value=${JSON.stringify(model)};await document.querySelector('#saveDelegateModel').onclick();`);assert.equal(await run(settings,'return (await gla.getSettings()).delegate.model'),model);}
 await run(settings,"document.querySelector('#delegateModel').value='gpt-5.6-sol';await document.querySelector('#saveDelegateModel').onclick();await document.querySelector('#refreshDelegateModels').onclick();");
 assert.equal(await run(settings,"return document.querySelector('#delegateModel').value"),'gpt-5.6-sol');
 await run(settings,"document.querySelector('#agentCodexModel').value='gpt-6-astra';await document.querySelector('#codexSaveModel').onclick();");
 assert.equal(await run(settings,'return (await gla.getSettings()).agentCodexModel'),'gpt-6-astra');
 fs.writeFileSync(out+'/models.png',(await settings.webContents.capturePage()).toPNG());
 const question=`Tia, run Python to calculate 7 times 8, create ${filename} in the working folder containing the result, then read it back.`;
 const first=await run(solo,`return gla.agent.run(${JSON.stringify({id:'codex-solo',history:[{role:'user',text:question}]})})`);assert(first.ok,first.error);assert.match(fs.readFileSync(out+'/files/'+filename,'utf8'),/56/);assert.equal(first.character,'Tia');await run(settings,"await gla.setSettings({agentCodexModel:''})");
 await run(solo,'gla.group.open()');const group=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/group.html')),'group window');await until(()=>run(group,'return window.gla_group&&!gla_group.state.loading'),'group cast');
 const base={participants:['tia','sarah'],human:{enabled:true,name:'You'},topic:'Codex test'};
 const create=`Tia, use Python to create group-${filename} in the working folder with the text original, and verify it.`;
 const second=await run(group,`return gla.group.reply(${JSON.stringify({...base,id:'codex-group-tia',speaker:'tia',humanRequest:create,turnId:'group-tia',history:[]})})`);assert(second.ok,second.error);assert.equal(second.character,'Tia');
 const follow=`Sarah, append a newline and the word verified to that file Tia just created. Read back the complete contents using Python.`;
 const third=await run(group,`return gla.group.reply(${JSON.stringify({...base,id:'codex-group-sarah',speaker:'sarah',humanRequest:follow,turnId:'group-sarah',history:[{speaker:'_human',text:create},{speaker:'tia',text:second.text}]})})`);assert(third.ok,third.error);assert.equal(third.character,'Sarah');const text=fs.readFileSync(out+'/files/group-'+filename,'utf8');assert.match(text,/original\s+verified/);
 await run(group,"await gla_group.actorMenuAction({slug:'sarah',action:'agent'});");assert.equal(await run(group,"return document.querySelector('.agent-dialog h2').textContent"),'Ask Sarah');
 await run(group,`const d=document.querySelector('.agent-dialog');d.querySelector('textarea').value=${JSON.stringify('Read group-'+filename+' and tell me its contents, without changing it.')};d.querySelector('[data-send]').click();`);
 await until(()=>run(group,"return !document.querySelector('.agent-dialog [data-send]').disabled"),'Sarah context-menu action');const menuReply=await run(group,"return document.querySelector('.agent-answer').textContent");assert.match(menuReply,/original/);assert.match(menuReply,/verified/);
 fs.writeFileSync(out+'/settings.png',(await settings.webContents.capturePage()).toPNG());
 fs.writeFileSync(out+'/report.json',JSON.stringify({passed:true,computerUse:status.computerUse,models,menuReply,solo:first,groupTia:second,groupSarah:third,file:text},null,2));console.log('Real Codex solo execution, Tia→Sarah shared file handoff, exact character identity and Settings UI passed.');
 }catch(e){console.error(e.stack);process.exitCode=1;}finally{app.exit(process.exitCode||0);}});
