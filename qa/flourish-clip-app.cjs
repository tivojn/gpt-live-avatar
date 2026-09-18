'use strict';
// A flourish look wider than a narrow window (Seraphim's armour in a 360 pt window) must not be cut off at
// the window's edge: the window grows during the hidden warm-up, never while it plays.
// Needs build/characters/seraphim. Run: npx electron qa/flourish-clip-app.cjs
const {app,BrowserWindow}=require('electron'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const repo=process.env.GLA_SOURCE_ROOT||path.resolve(__dirname,'..'),out=process.env.GLA_QA_OUTPUT||repo+'/build/qa-flourish-clip',slug='seraphim';
fs.rmSync(out+'/profile',{recursive:true,force:true});fs.mkdirSync(out+'/profile',{recursive:true});app.setPath('userData',out+'/profile');delete process.env.GLA_OPENAI_KEY;
fs.writeFileSync(out+'/profile/config.json',JSON.stringify({avatar:slug,quality:'balanced',bubbleMode:'off',conversationSounds:false,windowWidth:360,windowHeight:949}));
app.on('browser-window-created',(_e,w)=>w.webContents.setBackgroundThrottling(false));
require(repo+'/electron/main.cjs');const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,ms=120000){const end=Date.now()+ms;while(Date.now()<end){try{const r=await fn();if(r)return r;}catch{}await wait(30);}throw Error('timeout');}
const SAMPLER=`window.__s=[];(function tick(){const f=window.gla_flourish?.();let edge=null;try{if(f&&f.state==='playing'&&f.step>=0){const b=gla_visibleBox();edge=b&&{l:Math.round(b.x),r:Math.round(innerWidth-b.x-b.w),t:Math.round(b.y)};}}catch{}
 __s.push({t:Math.round(performance.now()),step:f?f.step:null,state:f?.state||null,vis:document.querySelector('#stage')?.style.visibility,w:innerWidth,stage:!!window.gla_stage?.(),edge});requestAnimationFrame(tick);})();`;
app.whenReady().then(async()=>{try{
 const solo=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/avatar.html')));
 const js=code=>solo.webContents.executeJavaScript('(async()=>{'+code+'})()');
 await solo.webContents.executeJavaScript(SAMPLER);
 await until(()=>js(`return Boolean(window.gla_avatar?.options)&&!gla_flourish()&&document.querySelector('#stage').style.visibility==='visible'&&__s.some(x=>x.state==='playing')`));await wait(4000);
 const s=await js('return __s'),playing=s.filter(x=>x.edge),first=s.findIndex(x=>x.state==='playing'),lastPlay=s.map(x=>x.state).lastIndexOf('playing');
 const touching=playing.filter(x=>x.edge.l<=2||x.edge.r<=2||x.edge.t<=2);
 assert.equal(new Set(playing.map(x=>x.step)).size,14,'every look was painted');
 assert.deepEqual(touching.map(x=>x.step+':'+JSON.stringify(x.edge)),[],'no look reaches the edge of the window, where it would be cut off');
 const widths=[...new Set(s.slice(first,lastPlay+1).map(x=>x.w))];assert.equal(widths.length,1,'the window does not resize while it plays: '+widths);
 assert(s.slice(first,lastPlay+1).every(x=>x.vis==='visible'),'and never blinks');
 assert(s.slice(0,first).filter(x=>x.state&&x.w!==widths[0]).every(x=>x.vis!=='visible'),'it grew while she was still out of sight');
 console.log('Wardrobe flourish clip QA passed: Seraphim in a 360 pt window, 14 looks, none cut off, window '+widths[0]+' pt throughout.');
}catch(e){console.error(e);process.exitCode=1;}finally{app.exit(process.exitCode||0);}});
