const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const repo=path.resolve(__dirname,'..'),output=path.join(repo,'build/qa-portrait');fs.mkdirSync(output,{recursive:true});
app.setPath('userData',path.join(output,'profile'));fs.mkdirSync(app.getPath('userData'),{recursive:true});
const looks=require('../electron/default-appearance.json');
fs.writeFileSync(path.join(app.getPath('userData'),'config.json'),JSON.stringify({avatar:'tia',quality:'best',bubbleMode:'off',windowWidth:500,windowHeight:820,avatarLooks:{tia:{...looks.tia,prop:undefined,'texture:hair':'tia-original/hair-024'},sarah:looks.sarah}}));
const errors=[];app.on('browser-window-created',(_e,w)=>w.webContents.on('console-message',d=>{if(d.level==='error')errors.push(d.message);}));
require('../electron/main.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){const end=Date.now()+120000;while(Date.now()<end){try{const r=await fn();if(r)return r;}catch{}await wait(100);}throw Error('Timed out: '+label);}
app.whenReady().then(async()=>{try{
 const w=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/avatar.html')),'window');
 const js=s=>w.webContents.executeJavaScript('(async()=>{'+s+'})()');
 await until(()=>js("return Boolean(window.gla_avatar?.model&&gla_avatar.motion?.clips.size>=62&&gla_avatar.appearance.textureSelections.get('tia-original/hair-024')?.bitmap.width===4096&&gla_avatar.resources.ready);"),'4K portrait loaded');
 const initial=await js(`const a=gla_avatar,p=a.appearance.portrait;return {environment:!!a.appearance.environmentTarget,maps:p.maps.length,shadow:a.renderer.shadowMap.enabled,shadowSize:p.key.shadow.mapSize.x,hair:a.appearance.textureSelections.get('tia-original/hair-024').bitmap.width,skinTextures:[...a.resources.records.values()].filter(r=>r.loaded).map(r=>r.loaded.key),sorting:p.sorting,status:a.appearance.status,tiers:(await gla.getSettings()).tiers};`);
 assert(initial.environment&&initial.maps===2&&initial.shadow&&initial.shadowSize===2048);
 assert(initial.tiers.tiers.best.present);assert(initial.skinTextures.some(k=>k.includes('-4096.png')));assert(!initial.status);
 const capture=async(name,yaw=.14,pitch=.025)=>{
  const url=await js(`const a=gla_avatar;a.setOrbit({yaw:${yaw},pitch:${pitch}});await a.resources.update('quality',2200,true);a.snapshot(1100);await a.resources.pending;return a.snapshot(1100);`);
  fs.writeFileSync(path.join(output,name+'.png'),Buffer.from(url.split(',')[1],'base64'));
 };
 await capture('tia-after');await capture('tia-after-angle',.204,.376);
 const facial=await js(`const a=gla_avatar;const counts=()=>[...a.channels.get('portraitSmile')].map(t=>t.mesh.geometry.morphAttributes.position.length);const before=counts();await a.appearance.loadPacks(a.appearance.indexURL);const after=counts();
 a.options.select({...a.options.selection,expression:'neutral'});
 const sample=(viseme,height)=>{const start=performance.now();for(let i=0;i<45;i++)a.render(start+i*16,{speaking:viseme!=='sil',viseme,intensity:.6,projectedHeight:height,reduce:true});return Object.fromEntries(['jawOpen','portraitJaw','portraitSmile','viseme:aa','viseme:PP'].map(c=>[c,Math.max(0,...(a.channels.get(c)||[]).map(t=>t.mesh.morphTargetInfluences[t.index]))]));};
 const close=sample('aa',1600),desktop=sample('aa',330),closed=sample('PP',330),rest=sample('sil',330);
 a.appearance.face.react('smile',a.appearance.face.at);a.render(a.appearance.face.at+250,{reduce:true});const reaction=Math.max(...a.channels.get('portraitSmile').map(t=>t.mesh.morphTargetInfluences[t.index]));
 return {channels:[...a.appearance.face.channels],before,after,close,desktop,closed,rest,reaction,unified:!!a.appearance.portrait.unifiedHair};`);
 assert.deepEqual(facial.before,facial.after,'Reloading appearance does not duplicate GPU morphs');
 assert.equal(facial.channels.length,4);assert(facial.unified);
 assert(facial.desktop.jawOpen>facial.close.jawOpen*2,'Distant vowels articulate more visibly');
 assert(facial.closed.jawOpen<.001&&facial.rest.jawOpen<.001,'Consonant closure and silence remain closed');
 for(const state of [facial.close,facial.desktop,facial.closed,facial.rest])assert.equal(state.portraitJaw,0,'Original jaw shape remains unchanged at rest and during speech');
 assert(facial.reaction>.2,'Spoken smile can trigger an open-mouth expression');
 // Classic restores original material settings; returning to Studio must
 // restore the portrait maps/shader. Quality changes must replace textures.
 await js("gla_avatar.options.select({...gla_avatar.options.selection,lighting:'classic'});");
 assert.equal(await js('return gla_avatar.renderer.shadowMap.enabled;'),false);
 assert.equal(await js("return [...gla_avatar.appearance.materials.keys()].find(m=>m.name==='Hed_Hair-21A_Ponytail02_M').metalness;"),1);
 await js("gla_avatar.options.select({...gla_avatar.options.selection,lighting:'studio',performance:'eco'});");
 await until(()=>js("return gla_avatar.appearance.textureSelections.get('tia-original/hair-024')?.bitmap.width===1024;"),'friendly textures');
 assert.equal(await js('return gla_avatar.renderer.shadowMap.enabled;'),false);
 for(const profile of ['quality','eco','balanced','quality'])await js(`gla_avatar.options.select({...gla_avatar.options.selection,performance:'${profile}'});`);
 await until(()=>js("return gla_avatar.appearance.textureSelections.get('tia-original/hair-024')?.bitmap.width===4096;"),'quality switch race');
 assert.equal(await js('return gla_avatar.renderer.shadowMap.enabled;'),true);
 // Catch the largest restored color (larger than the previous file cap),
 // and verify its disposal/replacement doesn't close the active hair map.
 await js("gla_avatar.options.select({...gla_avatar.options.selection,'texture:skirt':'tia-original/skirt-049'});");
 await until(()=>js("return gla_avatar.appearance.textureSelections.get('tia-original/skirt-049')?.bitmap.width===4096;"),'large original texture');
 await js(`gla_avatar.options.select({...gla_avatar.options.selection,'texture:skirt':${JSON.stringify(looks.tia['texture:skirt'])}});`);
 await until(()=>js(`return gla_avatar.appearance.textureSelections.has(${JSON.stringify(looks.tia['texture:skirt'])});`),'restore skirt');
 // GPU-complete timings include shadow, cornea transmission and alpha hair;
 // capture runs in the same WebGL renderer used by the desktop app.
 const timing=await js(`const a=gla_avatar;a.setOrbit({yaw:0,pitch:0});a.resize(500,820);a.currentView=null;await a.resources.update('quality',1600,true);const gl=a.renderer.getContext(),times=[];for(let i=0;i<70;i++){const now=performance.now();a.setOrbit({yaw:Math.sin(i*.03)*.3,pitch:.08});a.render(now,{reduce:true,gaze:{x:0,y:0}});gl.finish();if(i>=10)times.push(performance.now()-now);await new Promise(r=>setTimeout(r,8));}times.sort((x,y)=>x-y);return {median:times[Math.floor(times.length*.5)],p95:times[Math.floor(times.length*.95)],sorting:a.appearance.portrait.sorting,renderer:a.renderer.info.render};`);
 await js("gla_play('dance');");await wait(1600);
 assert(await js('return !!gla_avatar.motion.active;'),'Dance still runs');
 await js("gla_play('stay');");
 assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({passed:true,initial,facial,timing,errors},null,2));console.log(JSON.stringify({passed:true,facial,timing}));
}catch(e){console.error(e);console.error(errors);process.exitCode=1;}app.exit(process.exitCode||0);});
