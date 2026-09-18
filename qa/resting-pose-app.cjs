'use strict';
// A weapon grip with nothing in her hand is not a way to stand: a saved look
// that kept a prop's pose after the prop was taken away is healed when she
// comes up, and Props › None lets go of the grip. Needs build/characters/tia.
// Run: npx electron qa/resting-pose-app.cjs
const {app,BrowserWindow,Menu}=require('electron'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const repo=process.env.GLA_SOURCE_ROOT||path.resolve(__dirname,'..'),out=process.env.GLA_QA_OUTPUT||repo+'/build/qa-resting-pose';
fs.rmSync(out+'/profile',{recursive:true,force:true});fs.mkdirSync(out+'/profile',{recursive:true});app.setPath('userData',out+'/profile');delete process.env.GLA_OPENAI_KEY;
const usual=require('../electron/default-appearance.json').tia.body;
fs.writeFileSync(out+'/profile/config.json',JSON.stringify({avatar:'tia',quality:'friendly',bubbleMode:'off',conversationSounds:false,wardrobeFlourish:false,windowWidth:450,windowHeight:750,
 avatarLooks:{tia:{body:'Ps052.pistol',outfit:'original',lighting:'studio',expression:'smile'}}}));
let template;const build=Menu.buildFromTemplate;Menu.buildFromTemplate=function(value){const menu=build.call(Menu,value);menu.popup=()=>{template=require('./menu-flat.cjs').flat(value);};return menu;};
require(repo+'/electron/main.cjs');const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){const end=Date.now()+120000;let last;while(Date.now()<end){try{const r=await fn();if(r)return r;}catch(e){last=e;}await wait(60);}throw Error('Timed out: '+label+' '+(last?.message||''));}
app.whenReady().then(async()=>{try{
 const solo=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/avatar.html')),'solo window');
 const js=code=>solo.webContents.executeJavaScript('(async()=>{'+code+'})()');
 await until(()=>js(`return Boolean(window.gla_avatar?.options)&&gla_avatar.characterId==='tia'`),'Tia is up');
 const selection=()=>js('return {...gla_avatar.options.selection}'),saved=()=>JSON.parse(fs.readFileSync(out+'/profile/config.json')).avatarLooks.tia;
 const props=await js('return gla_avatar.options.props.filter(p=>p.pose&&!p.retired).map(p=>({id:p.id,pose:p.pose}))');
 const pistol=props.find(p=>p.pose==='Ps052.pistol');assert(pistol,'the saved pose really is a prop grip: '+JSON.stringify(props));
 // ---- she comes up standing, and the healed look is what is saved
 let now=await selection();assert.equal(now.body,usual,'her usual stance, not the grip');assert(!now.prop&&!now.hands);assert.equal(now.outfit,'original','the rest of her look is kept');
 await until(()=>saved().body===usual,'the saved look is healed');
 // ---- taking a prop puts her in its pose; Props › None lets go again
 const menu=async()=>{template=null;await js("document.querySelector('#bubble').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true}))");return until(()=>template,'menu');};
 const rows=(await menu()).find(x=>x.label==='Props').submenu;const label=await js(`return gla_avatar.options.catalogue().props.find(p=>p.id===${JSON.stringify(pistol.id)}).label`);
 const row=rows.find(x=>x.label===label);assert(row,'Props lists '+label+': '+rows.map(x=>x.label));row.click();
 await until(async()=>(await selection()).prop===pistol.id,'pistol in hand');now=await selection();assert.equal(now.body,'Ps052.pistol');
 (await menu()).find(x=>x.label==='Props').submenu.find(x=>x.label==='None').click();
 await until(async()=>!(await selection()).prop,'prop put away');now=await selection();
 assert.equal(now.body,usual,'Props › None returns her to her usual stance');assert(!now.hands&&!now.leftHand&&!now.rightHand,'with relaxed hands');
 await until(()=>saved().body===usual&&!saved().prop,'and that is what is saved');
 // ---- a pose she is asked to hold is not second-guessed
 await js(`gla_avatar.options.select({...gla_avatar.options.selection,body:'Ps052.pistol'})`);assert.equal((await selection()).body,'Ps052.pistol');
 console.log('Resting pose QA passed: a saved weapon grip with no prop comes up as '+usual+', Props › None lets go of the grip, the healed look is saved.');
}catch(e){console.error(e);process.exitCode=1;}finally{app.exit(process.exitCode||0);}});
