'use strict';
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const live=process.argv.includes('--live'),offline=process.argv.includes('--offline');
const repo=path.resolve(__dirname,'..'),output=path.join(repo,live?'build/qa-protected-live':'build/qa-protected-app'),profile=path.join(output,'profile'),protectedDir=path.join(repo,'build/protected');
const starterOnly=process.argv.includes('--starter-only');
if(live&&!offline)fs.rmSync(profile,{recursive:true,force:true});
fs.mkdirSync(profile,{recursive:true});app.setPath('userData',profile);
const inventory=JSON.parse(fs.readFileSync(path.join(protectedDir,'inventory.json')));
for(const [slug,entry] of live?[]:Object.entries(inventory.index.avatars)){
 const dir=path.join(profile,'avatars',slug);fs.mkdirSync(dir,{recursive:true});
 for(const [tier,p] of Object.entries(entry.mac)){const dest=path.join(dir,tier+'.gla');fs.rmSync(dest,{force:true});if(starterOnly||(slug==='tia'&&tier==='base'))continue;fs.symlinkSync(path.join(protectedDir,p.file),dest);}
}
fs.writeFileSync(path.join(profile,'config.json'),JSON.stringify({avatar:'tia',quality:'balanced',bubbleMode:'off',windowWidth:450,windowHeight:750}));
// Isolate the fixture from the owner's development assets, as in the installer.
const moduleAssets=require('../electron/assets.cjs'),Original=moduleAssets.AvatarAssets;
moduleAssets.AvatarAssets=class extends Original{constructor(opts){super({...opts,developmentRoot:undefined,bundledRoot:path.join(protectedDir,'starter'),runtimeConfigPath:path.join(protectedDir,live?'assets-runtime.json':'private-build.json'),...(live&&process.env.GLA_QA_ASSET_BASE_URL?{baseURL:process.env.GLA_QA_ASSET_BASE_URL}:{}),...(offline?{baseURL:'http://127.0.0.1:1/',allowLocal:true}: {})});}};
const errors=[];app.on('browser-window-created',(_e,w)=>w.webContents.on('console-message',d=>{if(d.level==='error')errors.push(d.message);}));
require('../electron/main.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){const end=Date.now()+120000;while(Date.now()<end){try{const r=await fn();if(r)return r;}catch{}await wait(100);}throw Error('Timed out: '+label);}
app.whenReady().then(async()=>{try{
 const w=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/avatar.html')),'avatar window');
 const js=s=>w.webContents.executeJavaScript('(async()=>{'+s+'})()'),report=[];
 for(const slug of starterOnly?['tia']:Object.keys(inventory.index.avatars)){
  if(live&&!offline){
   for(const tier of starterOnly?[]:['base','balanced','best']){
    if(slug==='tia'&&tier==='base')continue;
    const result=await js(`return await gla.assets.download(${JSON.stringify(slug)},${JSON.stringify(tier)});`);assert(result.ok,result.error);console.log(slug+' '+tier+' downloaded from the live gateway.');
   }
  }
  await js(`await gla.selectAvatar(${JSON.stringify(slug)});`);
  await until(()=>js(`const s=await gla.getSettings();return s.avatar.slug===${JSON.stringify(slug)}&&window.gla_avatar?.resources?.ready&&gla_avatar.motion?.clips.size>0&&gla_avatar.appearance?.indexURL===s.avatar.appearanceURL;`),slug+' encrypted model');
  const info=await js(`const s=await gla.getSettings();return {slug:s.avatar.slug,revision:s.avatar.manifest.assetRevision,roots:s.avatar.roots,modelURL:s.avatar.modelURL,motions:gla_avatar.motion.clips.size,tiers:s.tiers,appearance:!!gla_avatar.appearance.indexURL};`);
  assert(info.roots.every(r=>r.startsWith(profile)||(slug==='tia'&&r===path.join(protectedDir,'starter/tia'))));if(slug==='tia'){assert(info.tiers.bundled);assert(!fs.existsSync(path.join(profile,'avatars/tia/base.gla')),'Tia uses the installer starter without downloading it');}assert.equal(info.revision,inventory.index.avatars[slug].assetRevision);assert.equal(info.tiers.tiers.best.present,!starterOnly);assert.equal(info.tiers.tiers.balanced.present,!starterOnly);
  assert.equal((await fetch(new URL(info.modelURL,w.webContents.getURL()))).status,403,'External clients cannot read decrypted models');
  assert.equal(await js(`return (await fetch(${JSON.stringify(info.modelURL)})).status;`),200,'The app can render protected models');
  const png=await js('const a=gla_avatar;a.setOrbit({yaw:.15,pitch:.025});await a.resources.pending;return a.snapshot(900);');
  fs.writeFileSync(path.join(output,slug+'.png'),Buffer.from(png.split(',')[1],'base64'));report.push(info);console.log(slug+' protected rendering passed.');
 }
 if(live)assert(fs.existsSync(path.join(profile,'avatars/content-keys.bin')),'Live authorization persists protected keys');
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,offline?'offline-report.json':'report.json'),JSON.stringify({passed:true,live,offline,report,errors},null,2));
 }catch(e){console.error(e);console.error(errors);process.exitCode=1;}app.exit(process.exitCode||0);});
