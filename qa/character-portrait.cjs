// Run with Electron. Uses a separate test profile and a local character package.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const slug=process.argv[2]||'iselda';assert(['tia','sarah','iselda','ming-mei','seraphim'].includes(slug));const output=path.resolve(__dirname,'../build/qa-portrait-'+slug);fs.mkdirSync(output,{recursive:true});
app.setPath('userData',path.join(output,'profile'));fs.mkdirSync(app.getPath('userData'),{recursive:true});
fs.mkdirSync(path.join(app.getPath('userData'),'avatars'),{recursive:true});for(const id of [slug]){const link=path.join(app.getPath('userData'),'avatars',id);if(!fs.existsSync(link))fs.symlinkSync(path.resolve(__dirname,'../build/characters',id),link);}
fs.writeFileSync(path.join(app.getPath('userData'),'config.json'),JSON.stringify({avatar:slug,quality:'best',bubbleMode:'off',avatarLooks:{[slug]:{lighting:'studio',followCursor:'false'}}}));
const errors=[];app.on('browser-window-created',(_e,w)=>w.webContents.on('console-message',d=>{if(d.level==='error')errors.push(d.message);}));
require('../electron/main.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){const end=Date.now()+120000;while(Date.now()<end){try{const r=await fn();if(r)return r;}catch{}await wait(100);}throw Error('Timed out: '+label);}
app.whenReady().then(async()=>{const checks=[];try{
 const w=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/avatar.html')),'window');
 const js=s=>w.webContents.executeJavaScript('(async()=>{'+s+'})()');
 await until(()=>js('return gla_avatar?.resources.ready&&gla_avatar.appearance?.portrait?.diffusion?.filmic&&gla_avatar.motion?.clips.size>=62;'),'enhanced character loaded');
 for(const other of BrowserWindow.getAllWindows())if(other!==w)other.close();
 const ready=()=>until(()=>js('return gla_avatar.resources.ready&&!gla_avatar.appearance.status;'),'wardrobe ready');
 for(const lighting of ['soft','classic','studio','classic','studio']){
  await js(`gla_avatar.options.select({...gla_avatar.options.selection,lighting:'${lighting}'});`);await ready();await wait(120);
  const state=await js('const a=gla_avatar,p=a.appearance.portrait;return {active:p.active,lights:p.portraitLights.children.length,visible:p.portraitLights.visible,capture:p.diffusion.capture.value,target:!!a.renderer.getRenderTarget()};');
  assert.equal(state.lights,4);assert.equal(state.visible,lighting!=='classic');assert(!state.capture&&!state.target);checks.push({lighting,state});
 }
 const outfits=await js('return gla_avatar.options.outfits.map(x=>x.id);');
 for(const outfit of outfits){
  await js(`gla_avatar.options.select({...gla_avatar.options.selection,outfit:'${outfit}'});`);await ready();await wait(180);
  assert.equal(await js('return gla_avatar.appearance.portrait.diffusion.composite.uniforms.effects.value;'),true);
  checks.push({outfit});
 }
 for(const profile of ['eco','balanced','quality']){
  await js(`gla_avatar.options.select({...gla_avatar.options.selection,performance:'${profile}'});await gla_avatar.resources.update('${profile}',1200,true);`);await ready();await wait(180);
  const state=await js('const p=gla_avatar.appearance.portrait;return {profile:p.profile,filmic:!!p.diffusion.filmic,capture:p.diffusion.capture.value,effects:p.diffusion.composite.uniforms.effects.value};');
  assert(state.filmic&&!state.capture);assert.equal(state.effects,profile==='quality');checks.push(state);
 }
 await js("await gla_avatar.motion.play([...gla_avatar.motion.clips.keys()].find(x=>/danc/.test(x))); ");await wait(700);assert(await js('return !!gla_avatar.motion.active;'));
 await js('gla_avatar.motion.stop({immediate:true});');checks.push('Dance starts and stops');
 const timing=await js(`const a=gla_avatar;a.resize(500,900);a.currentView=null;await a.resources.update('quality',1200,true);const times=[],gl=a.renderer.getContext();
  for(let i=0;i<45;i++){const start=performance.now();a.setOrbit({yaw:Math.sin(i*.03)*.25,pitch:.06});a.render(start,{reduce:true,gaze:{x:0,y:0}});await a.resources.pending;if(!a.resources.ready)throw Error('Resources did not settle');a.render(performance.now(),{reduce:true});gl.finish();if(i>=5)times.push(performance.now()-start);await new Promise(r=>requestAnimationFrame(r));}
  times.sort((x,y)=>x-y);return {median:times[Math.floor(times.length*.5)],p95:times[Math.floor(times.length*.95)],target:[a.appearance.portrait.diffusion.width,a.appearance.portrait.diffusion.height],glError:gl.getError()};`);
 assert.equal(timing.glError,0);assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({passed:true,checks,timing,errors},null,2));console.log(JSON.stringify({passed:true,checks:checks.length,timing}));
}catch(e){console.error(e,errors);process.exitCode=1;}finally{app.exit(process.exitCode||0);}});
