'use strict';
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const repo=path.resolve(__dirname,'..'),output=path.join(repo,'build/qa-protected-app'),profile=path.join(output,'profile'),protectedDir=path.join(repo,'build/protected');
fs.mkdirSync(profile,{recursive:true});app.setPath('userData',profile);
const inventory=JSON.parse(fs.readFileSync(path.join(protectedDir,'inventory.json')));
for(const [slug,entry] of Object.entries(inventory.index.avatars)){
 const dir=path.join(profile,'avatars',slug);fs.mkdirSync(dir,{recursive:true});
 for(const [tier,p] of Object.entries(entry.mac)){const dest=path.join(dir,tier+'.gla');fs.rmSync(dest,{force:true});fs.symlinkSync(path.join(protectedDir,p.file),dest);}
}
fs.writeFileSync(path.join(profile,'config.json'),JSON.stringify({avatar:'tia',quality:'balanced',bubbleMode:'off',windowWidth:450,windowHeight:750}));
// Isolate the fixture from the owner's development assets, as in the installer.
const moduleAssets=require('../electron/assets.cjs'),Original=moduleAssets.AvatarAssets;
moduleAssets.AvatarAssets=class extends Original{constructor(opts){super({...opts,developmentRoot:undefined,bundledRoot:path.join(output,'empty-bundle'),runtimeConfigPath:path.join(protectedDir,'private-build.json')});}};
const errors=[];app.on('browser-window-created',(_e,w)=>w.webContents.on('console-message',d=>{if(d.level==='error')errors.push(d.message);}));
require('../electron/main.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){const end=Date.now()+120000;while(Date.now()<end){try{const r=await fn();if(r)return r;}catch{}await wait(100);}throw Error('Timed out: '+label);}
app.whenReady().then(async()=>{try{
 const w=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/avatar.html')),'avatar window');
 const js=s=>w.webContents.executeJavaScript('(async()=>{'+s+'})()'),report=[];
 for(const slug of Object.keys(inventory.index.avatars)){
  await js(`await gla.selectAvatar(${JSON.stringify(slug)});`);
  await until(()=>js(`const s=await gla.getSettings();return s.avatar.slug===${JSON.stringify(slug)}&&window.gla_avatar?.resources?.ready&&gla_avatar.motion?.clips.size>0&&gla_avatar.appearance?.indexURL===s.avatar.appearanceURL;`),slug+' encrypted model');
  const info=await js(`const s=await gla.getSettings();return {slug:s.avatar.slug,revision:s.avatar.manifest.assetRevision,roots:s.avatar.roots,modelURL:s.avatar.modelURL,motions:gla_avatar.motion.clips.size,tiers:s.tiers,appearance:!!gla_avatar.appearance.indexURL};`);
  assert(info.roots.every(r=>r.startsWith(profile)));assert.equal(info.revision,inventory.index.avatars[slug].assetRevision);assert(info.tiers.tiers.best.present&&info.tiers.tiers.balanced.present);
  assert.equal((await fetch(new URL(info.modelURL,w.webContents.getURL()))).status,403,'External clients cannot read decrypted models');
  assert.equal(await js(`return (await fetch(${JSON.stringify(info.modelURL)})).status;`),200,'The app can render protected models');
  const png=await js('const a=gla_avatar;a.setOrbit({yaw:.15,pitch:.025});await a.resources.pending;return a.snapshot(900);');
  fs.writeFileSync(path.join(output,slug+'.png'),Buffer.from(png.split(',')[1],'base64'));report.push(info);console.log(slug+' protected rendering passed.');
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({passed:true,report,errors},null,2));
 }catch(e){console.error(e);console.error(errors);process.exitCode=1;}app.exit(process.exitCode||0);});
