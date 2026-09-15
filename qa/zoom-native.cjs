'use strict';
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const repo=process.env.GLA_QA_REPO||path.resolve(__dirname,'..'),out=process.env.GLA_QA_OUTPUT||path.join(repo,'build/qa-zoom');
const overlay=process.env.GLA_QA_OVERLAY;
fs.mkdirSync(out+'/profile/avatars',{recursive:true});app.setPath('userData',out+'/profile');delete process.env.GLA_OPENAI_KEY;
for(const slug of ['tia','sarah'])if(!fs.existsSync(out+'/profile/avatars/'+slug))fs.symlinkSync(repo+'/build/characters/'+slug,out+'/profile/avatars/'+slug);
fs.writeFileSync(out+'/profile/config.json',JSON.stringify({avatar:'tia',quality:'friendly',bubbleMode:'off',conversationSounds:false,agentEnabled:false,avatarLooks:{tia:{body:'Ps012.stand',prop:'',playTransitions:'false'}}}));
// Overlay only three candidate UI files; production files/profile are untouched.
const overlays=new Set(['avatar.html','group.js','avatar-zoom.js']);
const mapped=f=>overlay&&typeof f==='string'&&f.startsWith(repo+'/web/')&&overlays.has(path.basename(f))?path.join(overlay,path.basename(f)):f;
const stat=fsp.stat,stream=fs.createReadStream;fsp.stat=function(f,...a){return stat.call(this,mapped(f),...a);};fs.createReadStream=function(f,...a){return stream.call(this,mapped(f),...a);};
const errors=[];app.on('browser-window-created',(_e,w)=>{w.setOpacity(0);w.webContents.on('console-message',d=>{if(d.level==='error')errors.push(d.message);});});
require(repo+'/electron/main.cjs');const wait=ms=>new Promise(r=>setTimeout(r,ms)),js=(w,s)=>w.webContents.executeJavaScript('(async()=>{'+s+'})()');
async function until(fn,label){const end=Date.now()+120000;while(Date.now()<end){try{const v=await fn();if(v)return v;}catch{}await wait(100);}throw Error('Timed out: '+label);}
app.whenReady().then(async()=>{try{
 const solo=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/avatar.html')),'solo');
 await until(()=>js(solo,'return window.gla_avatar?.resources?.ready&&window.gla_geometry?.();'),'solo resources');
 for(const w of BrowserWindow.getAllWindows())if(w!==solo)w.close();
 solo.webContents.send('gla:menu-action','recover');await wait(800);const baselineNormal=await js(solo,'return gla_stage().scale*gla_avatar.layout().bounds[3]');
 solo.webContents.send('gla:menu-action','close-up');await wait(1400);
 const initial=await js(solo,'const g=gla_geometry(),a=gla_avatar,T=await import("/vendor/three/three.module.js"),p=a.project(a.bones.eye.l.getWorldPosition(new T.Vector3()));return {scale:g.fit.scale,near:a.camera.near,face:a.layout().faceBounds,point:{x:g.fit.x+p.x*g.fit.scale,y:g.fit.y+p.y*g.fit.scale}};');
 for(let n=0;n<5;n++){await js(solo,`dispatchEvent(new WheelEvent('wheel',{ctrlKey:true,deltaY:-90,clientX:${initial.point.x},clientY:${initial.point.y},cancelable:true}));`);await wait(90);}
 await wait(800);
 const deep=await js(solo,'const a=gla_avatar,g=gla_geometry();return {scale:g.fit.scale,face:a.layout().faceBounds,view:a.currentView,near:a.camera.near,pixels:a.canvas.width*a.canvas.height,windowPixels:innerWidth*innerHeight,fit:g.fit,visible:gla_visibleBox()};');
 assert(deep.scale>initial.scale*20,'Solo gestures pass face close-up into pupil scale');assert.equal(deep.near,initial.near,'Crop zoom never crosses the camera near plane');assert(deep.view.w<50&&deep.view.h<70);assert(deep.pixels<1500000,'Solo keeps the quality pixel budget');
 fs.writeFileSync(out+'/solo-pupil.png',(await solo.webContents.capturePage()).toPNG());
 solo.webContents.send('gla:menu-action','recover');await wait(500);const normal=await js(solo,'return gla_stage().scale*gla_avatar.layout().bounds[3]');console.log(JSON.stringify({reset:{normal,baselineNormal}}));assert(Math.abs(normal-require(repo+'/electron/default-placement.json').bodyHeight)<1&&await js(solo,'return !gla_stage().manualZoom&&!gla_stage().closeup'),'Recovery clears deep crop and restores the exact default size');
 await js(solo,'await gla.group.open();');const group=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/group.html')),'Together');await until(()=>js(group,'return window.gla_group&&!gla_group.state.loading&&gla_group.actors.size===2'),'group cast');
 await js(group,"gla_group.closeupActor(gla_group.actors.get('tia'));document.querySelector('.panel').style.display='none';");await wait(900);
 const groupInitial=await until(async()=>{const result=await js(group,"const a=gla_group.actors.get('tia');const m=a.hitMask.pixels;const face=a.avatar.layout().faceBounds,v=a.closeup;const px=(face[0]+face[2]*.35-v.x)/v.w*a.w,py=(face[1]+face[3]*.43-v.y)/v.h*a.h;let best=null,distance=1e20;for(let y=0;y<m.height;y++)for(let x=0;x<m.width;x++)if(m.data[(y*m.width+x)*4+3]>100){const xx=(x+.5)/m.width*a.w,yy=(y+.5)/m.height*a.h,d=(xx-px)**2+(yy-py)**2;if(d<distance){distance=d;best={x:a.x+xx,y:a.y+yy};}}return {view:v,w:a.w,h:a.h,point:best,logicalWidth:a.avatar.width,pixels:a.avatar.canvas.width*a.avatar.canvas.height,near:a.avatar.camera.near};");return result.point?result:null;},'group close-up pixels');
 assert(groupInitial.point,'Group silhouette available');
 for(let n=0;n<5;n++){await js(group,`dispatchEvent(new WheelEvent('wheel',{ctrlKey:true,deltaY:-90,clientX:${groupInitial.point.x},clientY:${groupInitial.point.y},cancelable:true}));`);await wait(60);}
 await wait(600);
 const groupDeep=await js(group,"const a=gla_group.actors.get('tia');return {zoom:a.zoom,w:a.w,h:a.h,pixels:a.avatar.canvas.width*a.avatar.canvas.height,near:a.avatar.camera.near,view:a.avatar.currentView,face:a.avatar.layout().faceBounds,otherZoom:gla_group.actors.get('sarah').zoom};");
 assert(groupDeep.zoom&&groupDeep.zoom.w<groupInitial.view.w/groupInitial.logicalWidth/20,'Together pinch zoom keeps growing after display frame limit');assert(groupDeep.pixels<1000000);assert.equal(groupDeep.near,groupInitial.near);assert(!groupDeep.otherZoom);
 fs.writeFileSync(out+'/group-pupil.png',(await group.webContents.capturePage()).toPNG());
 const groupPoint=await js(group,"const a=gla_group.actors.get('tia'),m=a.hitMask.pixels;for(let y=0;y<m.height;y++)for(let x=0;x<m.width;x++)if(m.data[(y*m.width+x)*4+3]>180)return {x:a.x+(x+.5)*a.w/m.width,y:a.y+(y+.5)*a.h/m.height};");
 assert(groupPoint,'Deep group zoom still hit tests the rendered detail');
 await js(group,"Element.prototype.setPointerCapture=()=>{};Element.prototype.hasPointerCapture=()=>false;");
 await js(group,`dispatchEvent(new PointerEvent('pointerdown',{pointerId:9,button:0,clientX:${groupPoint.x},clientY:${groupPoint.y}}));dispatchEvent(new PointerEvent('pointermove',{pointerId:9,clientX:${groupPoint.x+2500},clientY:${groupPoint.y+80}}));dispatchEvent(new PointerEvent('pointerup',{pointerId:9}));`);
 const panned=await js(group,"return gla_group.actors.get('tia').zoom");assert(panned.x<groupDeep.zoom.x,'Dragging beyond viewport margin pans the deep crop');
 group.webContents.send('gla:group:reset');await wait(500);assert(await js(group,'return [...gla_group.actors.values()].every(a=>!a.zoom&&!a.closeup)'),'Recovery removes group crop zoom');
 assert.deepEqual(errors,[]);fs.writeFileSync(out+'/report.json',JSON.stringify({passed:true,initial,deep,normal,groupInitial,groupDeep,panned,errors},null,2));console.log('Real solo/Together deep zoom, pupil detail hit testing, fixed pixel budgets, crop panning and recovery passed.');
 }catch(e){console.error(e,errors);process.exitCode=1;}finally{app.exit(process.exitCode||0);}});
