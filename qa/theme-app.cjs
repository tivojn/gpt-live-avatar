'use strict';
// The whole app wears one monochrome theme (web/theme.css) that follows the
// macOS appearance. This opens the real Settings, Avatar Show and updates
// windows in light and in dark and checks, from computed styles, that
// (1) nothing visible is painted with a hue, (2) text and surfaces actually
// flip between the two appearances, and (3) every Settings pane fits its window
// when nothing needs downloading. Run: npx electron qa/theme-app.cjs
const {app,BrowserWindow,nativeTheme}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'build/qa-theme-app'),profile=path.join(out,'profile');
fs.rmSync(profile,{recursive:true,force:true});fs.mkdirSync(profile+'/avatars',{recursive:true});app.setPath('userData',profile);
for(const slug of ['tia','sarah'])fs.symlinkSync(root+'/build/characters/'+slug,profile+'/avatars/'+slug);
fs.writeFileSync(profile+'/config.json',JSON.stringify({avatar:'sarah',quality:'friendly',bubbleMode:'always',agentEnabled:true,agentEngine:'enconvo',agentFollowReasoning:false,avatarLooks:{tia:{},sarah:{}}}));
const errors=[];app.on('browser-window-created',(_e,w)=>w.webContents.on('console-message',d=>{if(d.level==='error')errors.push(d.message);}));
require('../electron/main.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label,ms=120000){const end=Date.now()+ms;while(Date.now()<end){const v=await fn();if(v)return v;await wait(150);}throw Error('Timed out: '+label);}
const js=(w,code)=>w.webContents.executeJavaScript('(async()=>{'+code+'})()');
// Every visible element's text, background and border colour; anything with real saturation is a hue.
const HUES=`const hue=c=>{const m=c.match(/rgba?\\(([^)]+)\\)/);if(!m)return 0;const [r,g,b,a=1]=m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number);if(a<.08)return 0;const max=Math.max(r,g,b),min=Math.min(r,g,b);return max?(max-min)/max:0;};
const found=[];for(const el of document.querySelectorAll('body *')){if(['CANVAS','IMG','SCRIPT','STYLE','OPTION'].includes(el.tagName)||!el.getClientRects().length)continue;const cs=getComputedStyle(el);
 for(const prop of ['color','backgroundColor','borderTopColor','outlineColor'])if(hue(cs[prop])>.18&&!(prop==='borderTopColor'&&cs.borderTopWidth==='0px')&&!(prop==='outlineColor'&&cs.outlineStyle==='none'))found.push((el.id?'#'+el.id:el.tagName.toLowerCase()+'.'+el.className)+' '+prop+' '+cs[prop]);}
return [...new Set(found)].slice(0,12);`;
const LUMA=selector=>`const c=getComputedStyle(document.querySelector(${JSON.stringify(selector)}));const l=v=>{const m=v.match(/rgba?\\(([^)]+)\\)/)[1].split(/[ ,\\/]+/).filter(Boolean).map(Number);return Math.round(.2126*m[0]+.7152*m[1]+.0722*m[2]);};return {text:l(c.color),surface:l(c.backgroundColor)};`;
app.whenReady().then(async()=>{try{
 const solo=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/avatar.html')),'solo');await until(()=>js(solo,'return Boolean(window.gla_avatar?.resources?.ready)'),'avatar');
 await js(solo,'await gla.openSettings();return 1');const settings=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/settings.html')),'settings');
 await js(solo,'await gla.openUpdates();return 1');const updates=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/app-info.html')),'updates');
 await js(solo,'await gla.group.open();return 1');const group=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/group.html')),'group');
 await until(()=>js(group,'return Boolean(window.gla_group&&!gla_group.state.loading&&gla_group.show)'),'cast loaded');
 // something in every state: a caption, an open composer, the Record light armed, a status
 await js(group,"const a=gla_group.actors.get('tia');a.message='A caption to look at.';gla_group.openComposer('Tia',false);if(!document.querySelector('#showRecord').checked)document.querySelector('#headRecord').click();return 1");
 const seen={};
 for(const theme of ['light','dark']){
  nativeTheme.themeSource=theme;await wait(700);seen[theme]={};
  for(const pane of await js(settings,"return [...document.querySelectorAll('#tabs .tab')].map(t=>t.dataset.pane)")){
   await js(settings,`gla_settings_pane('${pane}');return 1`);await wait(150);
   assert.deepEqual(await js(settings,HUES),[],`Settings · ${pane} is monochrome in ${theme}`);
   const fit=await js(settings,`const m=document.querySelector('main'),d=document.querySelector('#tiersBox');const open=d?.open;if(d)d.open=false;const ok=m.scrollHeight<=m.clientHeight+1;if(d)d.open=open;return {ok,h:m.scrollHeight,view:m.clientHeight}`);
   assert(fit.ok,`Settings · ${pane} fits its window (${fit.h} of ${fit.view}px)`);
  }
  fs.writeFileSync(`${out}/settings-${theme}.png`,(await settings.webContents.capturePage()).toPNG());
  assert.deepEqual(await js(group,HUES),[],`Avatar Show panel, bubbles and composer are monochrome in ${theme}`);
  fs.writeFileSync(`${out}/show-${theme}.png`,(await group.webContents.capturePage()).toPNG());
  assert.deepEqual(await js(updates,HUES),[],`Updates window is monochrome in ${theme}`);
  assert.deepEqual(await js(solo,HUES),[],`Solo bubble is monochrome in ${theme}`);
  seen[theme]={settings:await js(settings,LUMA('body')),panel:await js(group,LUMA('.panel')),speech:await js(group,LUMA('.actor[data-slug=tia] .speech')),updates:await js(updates,LUMA('body')),bubble:await js(solo,LUMA('#bubble'))};
 }
 for(const surface of Object.keys(seen.light)){const l=seen.light[surface],d=seen.dark[surface];
  assert(l.text<90&&l.surface>200,`${surface}: dark text on a light surface in light mode `+JSON.stringify(l));assert(d.text>180&&d.surface<70,`${surface}: light text on a dark surface in dark mode `+JSON.stringify(d));}
 assert.equal(await js(settings,"return document.querySelector('#appVersion').textContent.startsWith('Version ')"),true);
 assert.deepEqual(errors,[]);
 fs.writeFileSync(out+'/report.json',JSON.stringify({passed:true,seen},null,1));console.log('Theme QA passed: monochrome in light and dark across Settings, Avatar Show, updates and the solo bubble; every Settings pane fits.');
}catch(e){console.error(e);console.error(errors);process.exitCode=1;}finally{nativeTheme.themeSource='system';app.exit(process.exitCode||0);}});
