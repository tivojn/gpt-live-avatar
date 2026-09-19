'use strict';
const {app,BrowserWindow,Menu}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=root+'/build/qa-agent-permissions';
fs.mkdirSync(out+'/profile/avatars',{recursive:true});app.setPath('userData',out+'/profile');
for(const slug of ['tia','sarah'])if(!fs.existsSync(out+'/profile/avatars/'+slug))fs.symlinkSync(root+'/build/characters/'+slug,out+'/profile/avatars/'+slug);
const restart=process.argv.includes('--restart');
if(!restart)fs.writeFileSync(out+'/profile/config.json',JSON.stringify({avatar:'tia',quality:'friendly',agentEnabled:true,agentEngine:'codex',voice:'marin',reasoningMode:'delegate'}));
let menu;const build=Menu.buildFromTemplate;Menu.buildFromTemplate=function(items){const native=build.call(Menu,items);native.popup=options=>{menu=require('./menu-flat.cjs').flat(items);options?.callback?.();};return native;};
const errors=[];app.on('browser-window-created',(_e,w)=>w.webContents.on('console-message',d=>{if(d.level==='error')errors.push(d.message);}));
require('../electron/main.cjs');const wait=ms=>new Promise(r=>setTimeout(r,ms)),run=(w,code)=>w.webContents.executeJavaScript('(async()=>{'+code+'})()');
async function until(fn,label){const end=Date.now()+120000;while(Date.now()<end){const result=await fn();if(result)return result;await wait(100);}throw Error('Timed out: '+label);}
const access=async w=>run(w,'return (await gla.getSettings()).agentAccess');
const permissionItems=()=>menu.find(i=>i.label==='Actions & Permissions').submenu.find(i=>i.submenu&&i.label.includes('Codex App Server')).submenu.filter(i=>['Ask for approval','Approve for me','Full access'].includes(i.label));
const picker=async w=>run(w,"return document.querySelector('#agentAccess').value");
app.whenReady().then(async()=>{try{
 const solo=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/avatar.html')),'solo');await until(()=>run(solo,'return window.gla_avatar?.resources.ready'),'avatar');
 const settings=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/settings.html')),'settings');await until(()=>picker(settings),'permission choices');
 if(restart){assert.equal(await access(solo),'auto_review');assert.equal(await picker(settings),'auto_review');console.log('Saved permission survives restart.');return;}
 assert.equal(await access(solo),'full','New profile defaults to Full access');
 assert.deepEqual(await run(settings,"return [...document.querySelector('#agentAccess').options].map(o=>o.text)"),['Ask for approval','Approve for me','Full access']);
 const openSolo=async()=>{menu=null;await run(solo,'await gla.showMenu({})');return permissionItems();};
 for(const mode of ['workspace','auto_review','full']){
  await run(settings,`const p=document.querySelector('#agentAccess');p.value=${JSON.stringify(mode)};await p.onchange();`);
  assert.equal(await access(solo),mode);const choices=await openSolo();assert.equal(choices.filter(c=>c.checked).length,1);assert.equal(choices.find(c=>c.checked).label,mode==='workspace'?'Ask for approval':mode==='auto_review'?'Approve for me':'Full access');
 }
 (await openSolo()).find(c=>c.label==='Ask for approval').click();await until(async()=>await picker(settings)==='workspace','menu updates settings');
 await run(solo,'await gla.group.open()');const group=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/group.html')),'Together');await until(()=>run(group,'return window.gla_group&&!gla_group.state.loading'),'cast');
 await run(group,"await gla.group.showMenu({slug:'sarah'})");let choices=permissionItems();assert.equal(choices.find(c=>c.checked).label,'Ask for approval');choices.find(c=>c.label==='Approve for me').click();
 await until(async()=>await picker(settings)==='auto_review','Together selection updates settings');assert.equal(await access(solo),'auto_review');assert.equal(await access(group),'auto_review');
 await run(group,"await gla.setSettings({agentAccess:'bogus'})");assert.equal(await access(solo),'auto_review','Invalid patch cannot increase access');
 // Selecting another provider's permissions must not switch providers or alter Codex.
 const providers=menu.find(i=>i.label==='Actions & Permissions').submenu;
 providers.find(i=>i.submenu&&i.label.includes('Hermes')).submenu.find(i=>i.label==='Ask when the agent requests approval').click();
 await until(async()=>await run(solo,"return (await gla.getSettings()).agentPermissions.hermes==='workspace'"),'separate Hermes setting');
 assert.equal(await access(solo),'auto_review');
 providers.find(i=>i.submenu&&i.label.includes('Hermes')).submenu[0].click();
 await until(async()=>await run(solo,"return (await gla.getSettings()).effectiveActionEngine==='hermes'"),'switch to Hermes');assert.equal(await access(solo),'workspace');
 providers.find(i=>i.submenu&&i.label.includes('Codex App Server')).submenu[0].click();
 await until(async()=>await run(solo,"return (await gla.getSettings()).effectiveActionEngine==='codex'"),'switch back to Codex');assert.equal(await access(solo),'auto_review');
 // Default coupling and explicit override are reflected in real Settings and both menus.
 await run(solo,"await gla.setSettings({reasoningMode:'delegate',delegateProvider:'openclaw',agentFollowReasoning:true})");
 assert.equal(await run(solo,"return (await gla.getSettings()).effectiveActionEngine"),'openclaw');
 assert.equal(await run(settings,"return document.querySelector('#agentEngine').value"),'follow');
 await run(settings,"const p=document.querySelector('#agentEngine');p.value='codex';await p.onchange();");
 await run(solo,"await gla.setSettings({delegateProvider:'hermes'})");
 assert.equal(await run(solo,"return (await gla.getSettings()).effectiveActionEngine"),'codex');
 assert.equal(await run(solo,"return (await gla.getSettings()).effectiveReasoningEngine"),'hermes');
 assert.equal(await access(solo),'auto_review');
 assert.equal(fs.readFileSync(out+'/profile/config.json','utf8').includes('auto_review'),true);
 await run(settings,"document.querySelector('#agentAccess').scrollIntoView({block:'center'})");await wait(300);fs.writeFileSync(out+'/permissions-settings.png',(await settings.webContents.capturePage()).toPNG());
 assert.deepEqual(errors,[]);fs.writeFileSync(out+'/report.json',JSON.stringify({passed:true,choices:choices.map(c=>c.label),saved:await access(solo),errors},null,2));console.log('Default, Settings, solo/Together menus, cross-window updates and persistence passed.');
 }catch(e){console.error(e.stack);process.exitCode=1;}finally{app.exit(process.exitCode||0);}});
