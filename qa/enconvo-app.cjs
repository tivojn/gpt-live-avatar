'use strict';
// Explicit live check of EnConvo as reasoning and action engine through the
// real app: settings, per-character agent choice, connection check, one
// reasoning request and one file task via the running EnConvo app (Mavis).
// No microphone or voice session. Run: npx electron qa/enconvo-app.cjs --live
const {app,BrowserWindow,Menu}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
if(!process.argv.includes('--live'))throw Error('Pass --live to test the running EnConvo app.');
const root=path.resolve(__dirname,'..'),out=path.join(root,'build/qa-enconvo-app'),profile=path.join(out,'profile'),folder=path.join(out,'files');
fs.mkdirSync(folder,{recursive:true});fs.rmSync(profile,{recursive:true,force:true});fs.mkdirSync(profile+'/avatars',{recursive:true});app.setPath('userData',profile);
fs.symlinkSync(root+'/build/characters/tia',profile+'/avatars/tia');
fs.writeFileSync(profile+'/config.json',JSON.stringify({avatar:'tia',quality:'friendly',bubbleMode:'off',agentEnabled:true,agentAccess:'full',agentFolder:folder,reasoningMode:'delegate',delegateProvider:'enconvo',delegateAuth:'local_runtime',avatarAgentBindings:{tia:{enconvo:'main'}},avatarLooks:{tia:{}}}));
const errors=[],templates=[];const buildMenu=Menu.buildFromTemplate;Menu.buildFromTemplate=function(t){templates.push(t);return buildMenu.call(this,t);};
app.on('browser-window-created',(_e,w)=>w.webContents.on('console-message',d=>{if(d.level==='error')errors.push(d.message);}));
require('../electron/main.cjs');const wait=ms=>new Promise(r=>setTimeout(r,ms));async function until(fn,label){const end=Date.now()+180000;while(Date.now()<end){const v=await fn();if(v)return v;await wait(150);}throw Error('Timed out: '+label);}const run=(w,code)=>w.webContents.executeJavaScript('(async()=>{'+code+'})()');
app.whenReady().then(async()=>{try{
 const solo=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/avatar.html')),'solo');await until(()=>run(solo,'return Boolean(window.gla_avatar?.resources.ready)'),'Tia');await run(solo,'await gla.openSettings()');
 const settings=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/settings.html')),'settings');
 await until(()=>run(settings,"return Boolean(document.querySelector('[data-character=tia][data-engine=enconvo]')?.options.length>1)"),'EnConvo agent inventory');
 const choices=await run(settings,"return [...document.querySelector('[data-character=tia][data-engine=enconvo]').options].map(o=>[o.value,o.textContent])");
 assert(choices.some(([id,label])=>id==='main'&&/Mavis.*default/.test(label)),'Mavis is listed as the default EnConvo agent: '+JSON.stringify(choices));
 assert(choices.length>=3,'custom EnConvo agents are listed too');
 assert.equal(await run(settings,"return document.querySelector('[data-character=tia][data-engine=enconvo]').value"),'main');
 assert.equal(await run(settings,"return document.querySelector('#delegateProvider').value"),'enconvo');assert.equal(await run(settings,"return document.querySelector('#delegateAuth').disabled"),true);
 assert.equal(await run(settings,"return document.querySelector('#runtimePathLabel').textContent"),'Service URL (optional)');
 await run(settings,"await document.querySelector('#runtimeCheck').onclick()");assert.match(await run(settings,"return document.querySelector('#runtimeState').textContent"),/EnConvo connected/);
 await run(settings,"document.querySelector('#agentBindings').closest('section').scrollIntoView({block:'start'})");await wait(250);fs.writeFileSync(out+'/agent-choices.png',(await settings.webContents.capturePage()).toPNG());
 await run(settings,"document.querySelector('#agentEngine').closest('section').scrollIntoView({block:'start'})");await wait(250);fs.writeFileSync(out+'/action-engine.png',(await settings.webContents.capturePage()).toPNG());
 await run(solo,'await gla.showMenu({})');const provider=templates.flatMap(t=>t).find(x=>x.label==='Delegate Reasoning Provider');assert(provider);assert(provider.submenu.some(x=>/EnConvo/.test(x.label)),'EnConvo in the native reasoning menu');
 console.log('Reasoning through EnConvo (Mavis)…');
 const reason=await run(solo,"return gla.delegate.answer({id:'enconvo-reason',history:[{role:'user',text:'What is seven times eight? Reply in one short sentence.'}]})");assert(reason.ok,reason.error);assert.equal(reason.engine,'enconvo');assert.match(reason.text,/56|fifty.six/i);
 console.log('Action through EnConvo (Mavis)…');
 const file='enconvo-'+Date.now()+'.txt',request='Tia, create the file '+folder+'/'+file+' containing exactly the two words "Tia verified" (no punctuation or newline). Read it back and report briefly.';
 const result=await run(solo,`return gla.agent.run(${JSON.stringify({id:'enconvo-solo',history:[{role:'user',text:request}]})})`);assert(result.ok,result.error);assert.equal(result.engine,'enconvo');assert.equal(result.agent,'main');
 assert.equal(fs.readFileSync(folder+'/'+file,'utf8').trim(),'Tia verified');
 fs.writeFileSync(out+'/report.json',JSON.stringify({passed:true,agents:choices,reason:{text:reason.text,model:reason.model},action:{text:result.text,model:result.model,receipts:result.receipts?.length}},null,2));
 assert.deepEqual(errors,[]);console.log('EnConvo app QA passed. Reasoning: '+reason.text.slice(0,80)+' | Action: '+result.text.slice(0,120));
}catch(error){console.error(error);console.error(errors);process.exitCode=1;}finally{app.exit(process.exitCode||0);}});
