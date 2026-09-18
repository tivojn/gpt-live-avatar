'use strict';
// The wardrobe flourish in the real app: she comes up straight into it, every
// step is painted, she ends exactly as she would without it, nothing is saved,
// and the Settings and menu switch turn it off. Run: npx electron qa/flourish-app.cjs
const {app,BrowserWindow,Menu}=require('electron'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const repo=process.env.GLA_SOURCE_ROOT||path.resolve(__dirname,'..'),out=process.env.GLA_QA_OUTPUT||repo+'/build/qa-flourish';
fs.rmSync(out+'/profile',{recursive:true,force:true});fs.mkdirSync(out+'/profile',{recursive:true});app.setPath('userData',out+'/profile');delete process.env.GLA_OPENAI_KEY;
const look={outfit:'tactical',body:'Ps007.stand',prop:'',playTransitions:'false','texture:eyes':'sarah-original/eyes-008'};
fs.writeFileSync(out+'/profile/config.json',JSON.stringify({avatar:'sarah',quality:'balanced',bubbleMode:'off',conversationSounds:false,windowWidth:450,windowHeight:750,avatarLooks:{sarah:look}}));
let template;const build=Menu.buildFromTemplate;Menu.buildFromTemplate=function(value){const menu=build.call(Menu,value);menu.popup=()=>{template=require('./menu-flat.cjs').flat(value);};return menu;};
const errors=[];app.on('browser-window-created',(_e,w)=>{w.webContents.setBackgroundThrottling(false);w.webContents.on('console-message',d=>{if(d.level==='error')errors.push(d.message);});});
require(repo+'/electron/main.cjs');const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label,ms=120000){const end=Date.now()+ms;let last;while(Date.now()<end){try{const r=await fn();if(r)return r;}catch(e){last=e;}await wait(50);}throw Error('Timed out: '+label+' '+(last?.message||''));}
// Sampled on every animation frame from inside the page, so a 90 ms step cannot be missed.
const SAMPLER=`window.__fl={samples:[]};(function tick(){const f=window.gla_flourish?.(),drawn=document.querySelector('#stage')?.style.visibility==='visible';__fl.samples.push({t:Math.round(performance.now()),state:f?f.state:null,step:f?f.step:-1,concealed:Boolean(f?.concealed),drawn});requestAnimationFrame(tick);})();`;
// What she looks like, independent of object identity: visible meshes, and whether each map is the authored one or a chosen colour.
const SIGNATURE=`(()=>{const a=gla_avatar,s=[];a.model.traverseVisible(n=>{if(n.isMesh)s.push(n.name+'|'+[].concat(n.material).map(m=>m.name+':'+(m.map?(m.map.userData?.residentTexture!==undefined?'authored':'chosen:'+(m.map.image?.width||0)):'none')).join(','));});return JSON.stringify(s.sort());})()`;
app.whenReady().then(async()=>{try{
 const solo=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/avatar.html')),'solo window');
 const js=code=>solo.webContents.executeJavaScript('(async()=>{'+code+'})()');
 const reload=async()=>{solo.webContents.once('dom-ready',()=>void solo.webContents.executeJavaScript(SAMPLER));solo.webContents.reload();await until(()=>js('return Boolean(window.__fl)'),'reloaded');};
 const settled=()=>until(()=>js(`return Boolean(window.gla_avatar?.options)&&!gla_flourish()&&document.querySelector('#stage').style.visibility==='visible'&&(!gla_avatar.resources||gla_avatar.resources.ready)`),'she is up and the flourish is over');
 const samples=()=>js('return __fl.samples');
 // ---- 1. first launch: straight into it
 await solo.webContents.executeJavaScript(SAMPLER);await until(()=>js('return Boolean(gla_flourish())'),'a flourish on first launch');
 await settled();await wait(400);let log=await samples();
 const played=log.filter(s=>s.state==='playing'&&s.step>=0),steps=[...new Set(played.map(s=>s.step))];
 assert.deepEqual(steps,[...Array(14).keys()],'all fourteen looks were on screen for at least one frame, in order');
 assert(log.filter(s=>s.concealed).every(s=>!s.drawn),'nothing of her is shown while it gets ready: she comes up and goes straight into it');
 const firstDrawn=log.find(s=>s.drawn),firstStep=played[0];assert(firstStep.t-firstDrawn.t>=200&&firstStep.t-firstDrawn.t<1500,'she is seen as herself for a moment, then it starts: '+(firstStep.t-firstDrawn.t)+' ms');
 const span=played.at(-1).t-firstStep.t;assert(span>1500&&span<3200,'about two seconds of looks, not stalled: '+span+' ms');
 for(let i=1;i<steps.length;i++){const gap=played.find(s=>s.step===i).t-played.find(s=>s.step===i-1).t;assert(gap<420,'step '+i+' came '+gap+' ms after the one before: a stall swallowed looks');}
 const info=await js('return gla_flourish_info=JSON.stringify({selection:gla_avatar.options.selection,held:gla_avatar.resources?.held?.size||0,paintHeld:Boolean(gla_avatar.appearance.paintHeld)})').then(JSON.parse);
 assert.equal(info.selection.outfit,'tactical');assert.equal(info.selection['texture:eyes'],look['texture:eyes']);assert.equal(info.held,0,'the outfits it kept in memory are released');assert.equal(info.paintHeld,false);
 const saved=()=>JSON.parse(fs.readFileSync(out+'/profile/config.json')).avatarLooks.sarah;
 assert.equal(saved().outfit,'tactical');assert.equal(saved()['texture:eyes'],look['texture:eyes']);assert(!Object.keys(saved()).some(k=>k.startsWith('texture:')&&k!=='texture:eyes'),'none of the colours she flashed through were saved');
 await until(()=>js(`return !gla_avatar.appearance.status&&gla_avatar.appearance.textureSelections.size===1`),'her chosen eye colour is loaded');
 const withFlourish=await js('return '+SIGNATURE);assert(/chosen:/.test(withFlourish),'her chosen eye colour is on, at full size');assert(!/chosen:512/.test(withFlourish),'no 512 px flourish texture is left on her');
 fs.writeFileSync(out+'/after.png',(await solo.webContents.capturePage()).toPNG());
 // ---- 2. the menu row and the Settings key
 template=null;await js("document.querySelector('#bubble').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true}))");await until(()=>template,'menu');
 const row=template.find(x=>x.label==='Wardrobe Flourish');assert(row,'View has a Wardrobe Flourish row');assert.equal(row.type,'checkbox');assert.equal(row.checked,true,'on by default');
 row.click();await until(async()=>(await js('return (await gla.getSettings()).wardrobeFlourish'))===false,'the menu row turns it off');
 assert.equal(JSON.parse(fs.readFileSync(out+'/profile/config.json')).wardrobeFlourish,false);
 template=null;await js("document.querySelector('#bubble').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true}))");await until(()=>template,'menu again');assert.equal(template.find(x=>x.label==='Wardrobe Flourish').checked,false);
 // ---- 3. off: she simply appears, and looks exactly the same as after a flourish
 await reload();await settled();await wait(300);log=await samples();
 assert(log.every(s=>s.state===null),'no flourish when it is switched off');
 await until(()=>js(`return !gla_avatar.appearance.status&&gla_avatar.appearance.textureSelections.size===1`),'eye colour without');
 assert.equal(await js('return '+SIGNATURE),withFlourish,'with or without the flourish she ends up identical');
 // ---- 4. back on from Settings; changing her outfit mid-way stops it at once and keeps the new outfit
 await js('await gla.setSettings({wardrobeFlourish:true})');await reload();
 await until(()=>js('return gla_flourish()?.step>=3'),'playing again');
 await js(`gla_avatar.options.select({...gla_avatar.options.selection,outfit:'casual'})`);
 await until(()=>js('return !gla_flourish()'),'stopped by the outfit change',2000);
 const after=await js(`const o=gla_avatar.options;return {outfit:o.selection.outfit,visible:o.outfits.filter(x=>!x.retired&&x.id!=='casual').flatMap(x=>x.nodes).filter(n=>!o.outfits.find(x=>x.id==='casual').nodes.includes(n)).filter(n=>(o.nodes.get(n)||[]).some(m=>m.visible)),held:gla_avatar.resources?.held?.size||0}`);
 assert.equal(after.outfit,'casual');assert.deepEqual(after.visible,[],'only the outfit she chose is on her');assert.equal(after.held,0);
 // ---- 5. a motion outranks it
 await js(`gla_avatar.options.select({...gla_avatar.options.selection,outfit:'tactical'})`);
 assert.equal(await js('return await gla_flourish_play()'),true,'the debug replay works on a character already on screen');
 await until(()=>js('return gla_flourish()?.step>=1'),'replay playing');await js(`gla_play('wave')`);
 await until(()=>js('return !gla_flourish()'),'stopped by the motion',3000);assert.equal(await js('return gla_avatar.options.selection.outfit'),'tactical');
 assert.deepEqual(errors.filter(e=>!/Autofill|DevTools/.test(e)),[],'no console errors');
 console.log('Wardrobe flourish app QA passed: concealed entrance, 14 painted steps in '+span+' ms, identical end state, nothing saved, menu and Settings switch, stops for an outfit change and for a motion.');
}catch(e){console.error(e);process.exitCode=1;}finally{app.exit(process.exitCode||0);}});
