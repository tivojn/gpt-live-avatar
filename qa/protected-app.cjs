'use strict';
const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const live=process.argv.includes('--live'),offline=process.argv.includes('--offline'),tiaOnly=process.argv.includes('--tia-only'),starterOnly=process.argv.includes('--starter-only'),resume=process.argv.includes('--resume');
assert(!(starterOnly&&tiaOnly),'Choose --starter-only or --tia-only, not both');
const repo=path.resolve(__dirname,'..'),starter=require('../electron/default-avatar.json'),defaults=require('../electron/default-appearance.json'),voices=require('../electron/default-voices.json');
assert.equal(starter.slug,'sarah');assert.equal(starter.voice,'gleam');assert.equal(defaults.sarah.outfit,'casual');
const output=process.env.GLA_QA_OUTPUT||(live?path.join(repo,tiaOnly?'build/qa-protected-tia-live':starterOnly?'build/qa-protected-starter-live':'build/qa-protected-live'):fs.mkdtempSync(path.join(os.tmpdir(),'gla-protected-app-'))),profile=path.join(output,'profile'),protectedDir=path.join(repo,'build/protected'),bundledRoot=path.join(output,'bundled');
if(!offline&&!resume)fs.rmSync(profile,{recursive:true,force:true});
fs.mkdirSync(profile,{recursive:true});app.setPath('userData',profile);delete process.env.GLA_OPENAI_KEY;
// Bundle only the declared starter, so old development Tia artifacts cannot
// accidentally satisfy first-launch or explicit Tia-download assertions.
fs.rmSync(bundledRoot,{recursive:true,force:true});fs.mkdirSync(path.join(bundledRoot,starter.slug),{recursive:true});
for(const file of ['base.gla','motions.gla']){const source=path.join(protectedDir,'starter',starter.slug,file);assert(fs.existsSync(source),'Missing encrypted starter '+file);fs.symlinkSync(source,path.join(bundledRoot,starter.slug,file));}
const inventory=JSON.parse(fs.readFileSync(path.join(protectedDir,'inventory.json')));
for(const [slug,entry] of live?[]:Object.entries(inventory.index.avatars)){
 const dir=path.join(profile,'avatars',slug);fs.mkdirSync(dir,{recursive:true});
 for(const [tier,p] of Object.entries(entry.mac)){const dest=path.join(dir,tier+'.gla');fs.rmSync(dest,{force:true});if(starterOnly||(slug===starter.slug&&tier==='base'))continue;fs.symlinkSync(path.join(protectedDir,p.file),dest);}
}
// No avatar/persona/voice fields: the first model must come from app defaults.
fs.writeFileSync(path.join(profile,'config.json'),JSON.stringify({quality:'balanced',bubbleMode:'off',conversationSounds:false,windowWidth:450,windowHeight:750}));
const moduleAssets=require('../electron/assets.cjs'),Original=moduleAssets.AvatarAssets;
moduleAssets.AvatarAssets=class extends Original{constructor(opts){super({...opts,developmentRoot:undefined,bundledRoot,runtimeConfigPath:path.join(protectedDir,live?'assets-runtime.json':'private-build.json'),...(live&&process.env.GLA_QA_ASSET_BASE_URL?{baseURL:process.env.GLA_QA_ASSET_BASE_URL}:{}),...(offline?{baseURL:'http://127.0.0.1:1/',allowLocal:true}:{}),...(!live?{fetcher:async()=>{throw Error('Network disabled in protected fixture QA.');}}:{})});}};
const errors=[];app.on('browser-window-created',(_e,w)=>{w.webContents.on('console-message',d=>{if(d.level==='error')errors.push(d.message);});w.webContents.on('render-process-gone',(_e,d)=>errors.push('Renderer exited: '+d.reason));});
if(!live||offline)app.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest((detail,done)=>done({cancel:! /^(?:file:|data:|blob:|devtools:|http:\/\/(?:127\.0\.0\.1|localhost):)/.test(detail.url)})));
require('../electron/main.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){const end=Date.now()+120000;let last;while(Date.now()<end){try{const r=await fn();if(r)return r;}catch(e){last=e;}await wait(100);}throw Error('Timed out: '+label+(last?': '+last.message:''));}
let w,report={passed:false,live,offline,output};
app.whenReady().then(async()=>{try{
 w=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/avatar.html')),'avatar window');
 const js=s=>w.webContents.executeJavaScript('(async()=>{'+s+'})()');
 const ready=slug=>until(()=>js(`const s=await gla.getSettings();return s.avatar.slug===${JSON.stringify(slug)}&&window.gla_avatar?.resources?.ready&&gla_avatar.characterId===${JSON.stringify(slug)}&&gla_avatar.motion?.clips.size>0&&gla_avatar.appearance?.indexURL===s.avatar.appearanceURL;`),slug+' encrypted model');
 await ready(starter.slug);
 const fresh=await js(`const s=await gla.getSettings(),o=gla_avatar.options;const visible=name=>(o.nodes.get(name)||[]).some(n=>{for(let p=n;p;p=p.parent)if(!p.visible)return false;return true;});return {slug:s.avatar.slug,name:s.avatar.name,personaName:s.personaName,voice:s.voice,selection:o.selection,visible:Object.fromEntries(['Fem-A_Top_Ac_Tshtt','Fem-A_Top_Ac_ChnCt','Fem-A_Bot_Ac_ChnPnts_1','Fem-A_Bot_Ac_ChnPnts_2','Fem-A_Fot_Ac_Sndlhl'].map(n=>[n,visible(n)]))};`);
 assert.equal(fresh.slug,'sarah');assert.equal(fresh.name,'Sarah');assert.equal(fresh.personaName,'Sarah');assert.equal(fresh.voice,'gleam');assert.equal(fresh.selection.outfit,'casual');assert(!fresh.selection.prop);
 for(const n of ['Fem-A_Top_Ac_Tshtt','Fem-A_Bot_Ac_ChnPnts_1','Fem-A_Bot_Ac_ChnPnts_2','Fem-A_Fot_Ac_Sndlhl'])assert.equal(fresh.visible[n],true,n+' is visible');assert.equal(fresh.visible['Fem-A_Top_Ac_ChnCt'],false,'No coat on the encrypted first-launch Sarah');
 report.freshDefault=fresh;await wait(350);fs.writeFileSync(path.join(output,'sarah-fresh-window.png'),(await w.webContents.capturePage()).toPNG());const rows=[];
 for(const slug of starterOnly?[starter.slug]:tiaOnly?['tia']:[starter.slug,...Object.keys(inventory.index.avatars).filter(s=>s!==starter.slug)]){
  if(live&&!offline){
   for(const tier of starterOnly?[]:['base','balanced','best']){
    if(slug===starter.slug&&tier==='base'||resume&&fs.existsSync(path.join(profile,'avatars',slug,tier+'.gla')))continue;
    const result=await js(`return await gla.assets.download(${JSON.stringify(slug)},${JSON.stringify(tier)});`);assert(result.ok,result.error);console.log(slug+' '+tier+' downloaded from the live gateway.');
   }
  }
  await js(`await gla.selectAvatar(${JSON.stringify(slug)});`);await ready(slug);
  const info=await js(`const s=await gla.getSettings(),o=gla_avatar.options;return {slug:s.avatar.slug,voice:s.voice,revision:s.avatar.manifest.assetRevision,roots:s.avatar.roots,modelURL:s.avatar.modelURL,motions:gla_avatar.motion.clips.size,tiers:s.tiers,appearance:!!gla_avatar.appearance.indexURL,selection:o.selection,pose:o.poses.get(o.selection.body)?.label};`);
  assert(info.roots.every(r=>r.startsWith(profile+path.sep)||(slug===starter.slug&&r===path.join(bundledRoot,starter.slug))),'All models come only from the isolated encrypted fixture');
  if(slug===starter.slug){assert(info.tiers.bundled);assert(!fs.existsSync(path.join(profile,'avatars',starter.slug,'base.gla')),'The default avatar uses the installer starter without downloading it');}
  if(slug==='tia'){assert.equal(info.pose,'Standing · 6','Explicit Tia selection keeps Standing 6');assert(!info.selection.prop);assert.equal(info.voice,voices.tia);assert.equal(info.tiers.bundled,false,'Tia must use the downloaded fixture, not an old bundled starter');}
  assert.equal(info.revision,inventory.index.avatars[slug].assetRevision);assert.equal(info.tiers.tiers.best.present,!starterOnly);assert.equal(info.tiers.tiers.balanced.present,!starterOnly);
  assert.equal((await fetch(new URL(info.modelURL,w.webContents.getURL()))).status,403,'External clients cannot read decrypted models');
  assert.equal(await js(`return (await fetch(${JSON.stringify(info.modelURL)})).status;`),200,'The app can render protected models');
  const png=await js('const a=gla_avatar;a.setOrbit({yaw:.15,pitch:.025});await a.resources.pending;return a.snapshot(900);');
  fs.writeFileSync(path.join(output,slug+'.png'),Buffer.from(png.split(',')[1],'base64'));rows.push(info);console.log(slug+' protected rendering passed.');
 }
 if(live)assert(fs.existsSync(path.join(profile,'avatars/content-keys.bin')),'Live authorization persists protected keys');
 assert.deepEqual(errors,[]);report={...report,passed:true,report:rows,errors};console.log('Fresh encrypted Sarah defaults and protected model rendering passed. '+output);
 }catch(e){report.error=e.stack;report.errors=errors;console.error(e.stack);console.error(errors.slice(0,8));if(w&&!w.isDestroyed())fs.writeFileSync(path.join(output,'failure.png'),(await w.webContents.capturePage()).toPNG());process.exitCode=1;}
 finally{fs.writeFileSync(path.join(output,offline?'offline-report.json':'report.json'),JSON.stringify(report,null,2));app.exit(process.exitCode||0);}
});
