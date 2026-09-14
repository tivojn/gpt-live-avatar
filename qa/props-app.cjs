// Actual native window/input and WebGL regressions; no live call or microphone.
const {app,BrowserWindow,Menu}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const repo=path.resolve(__dirname,'..'),output=path.join(repo,'build/qa-props');fs.mkdirSync(output,{recursive:true});
app.setPath('userData',path.join(output,'profile'));fs.mkdirSync(path.join(app.getPath('userData'),'avatars'),{recursive:true});
const sarah=path.join(app.getPath('userData'),'avatars/sarah');if(!fs.existsSync(sarah))fs.symlinkSync(path.join(repo,'build/assets/packages/sarah'),sarah);
fs.writeFileSync(path.join(app.getPath('userData'),'config.json'),JSON.stringify({avatar:'tia',quality:'friendly',bubbleMode:'off',windowWidth:500,windowHeight:800,avatarLooks:{tia:{},sarah:{}}}));
let menu,configWrites=0;const originalWrite=fs.writeFileSync;
fs.writeFileSync=function(file,...args){if(String(file)===path.join(app.getPath('userData'),'config.json'))configWrites++;return originalWrite.call(fs,file,...args);};
const build=Menu.buildFromTemplate;Menu.buildFromTemplate=function(items){const m=build.call(Menu,items);m.popup=()=>{menu=items;};return m;};
const errors=[],checks=[],metrics={};app.on('browser-window-created',(_e,w)=>w.webContents.on('console-message',d=>{if(d.level==='error')errors.push(d.message);}));
require('../electron/main.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){const deadline=Date.now()+90000;while(Date.now()<deadline){const r=await fn();if(r)return r;await wait(100);}throw Error('Timed out: '+label);}
app.whenReady().then(async()=>{try{
 const win=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/avatar.html')),'window');
 let mouseDown=false;
 const input=e=>{if(e.type==='mouseDown')mouseDown=true;if(e.type==='mouseUp')mouseDown=false;const b=win.getBounds();win.webContents.sendInputEvent({...e,globalX:b.x+e.x,globalY:b.y+e.y,modifiers:[...(e.modifiers||[]),...(mouseDown?['leftButtonDown']:[])]});};
 const js=code=>win.webContents.executeJavaScript(`(async()=>{${code}})()`);
 const loaded=()=>until(()=>js("return Boolean(window.gla_avatar?.model&&gla_avatar?.motion?.clips.size===62&&!document.querySelector('#status').textContent.startsWith('Loading'))"),'load');
 const snapshot=async name=>{await wait(200);fs.writeFileSync(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());};
 const choose=async action=>{win.webContents.send('gla:menu-action',action);await wait(850);};
 const hit=()=>js("const c=document.querySelector('#stage'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;for(let y=Math.round(c.height*.4);y<c.height-15;y+=4)for(let x=15;x<c.width-15;x+=4)if([[0,0],[-12,0],[12,0],[0,-12],[0,12]].every(([dx,dy])=>d[((y+dy)*c.width+x+dx)*4+3]>200))return {x:Math.round(x/c.width*innerWidth),y:Math.round(y/c.height*innerHeight)};");
 await loaded();for(const w of BrowserWindow.getAllWindows())if(w!==win)w.close();win.show();win.focus();await wait(900);
 // Deterministic pointer stream through the real renderer and window IPC.
 // Electron's input injection does not hold the physical macOS button down;
 // moving a native window otherwise generates an unrelated button-up event.
 const actorX=async()=>win.getBounds().x+await js("const a=gla_avatar,g=gla_geometry(),p=a.crownProjection();return p.x*g.fit.scale+g.fit.x;");
 let point=await hit(),before=win.getBounds(),beforeActorX=await actorX();configWrites=0;
 await js("window.blockNative=e=>{if(e.isTrusted)e.stopImmediatePropagation();};for(const t of ['pointermove','lostpointercapture'])addEventListener(t,blockNative,true);window.captureOriginal=HTMLCanvasElement.prototype.setPointerCapture;HTMLCanvasElement.prototype.setPointerCapture=()=>{};");
 const pointerEvent=async(type,x,y,buttons)=>{const b=win.getBounds();await js(`document.querySelector('#stage').dispatchEvent(new PointerEvent('${type}',{bubbles:true,pointerId:1,button:0,buttons:${buttons},clientX:${x},clientY:${y},screenX:${b.x+x},screenY:${b.y+y}}));`);};
 await pointerEvent('pointerdown',point.x,point.y,1);await wait(250);const progress=[];
 for(let i=1;i<=20;i++){
  const b=win.getBounds();await pointerEvent('pointermove',Math.round(before.x+point.x-i*4-b.x),point.y,1);await wait(18);progress.push(Math.round(await actorX()));
 }
 await pointerEvent('pointerup',point.x,point.y,0);await wait(400);
 await js("for(const t of ['pointermove','lostpointercapture'])removeEventListener(t,blockNative,true);HTMLCanvasElement.prototype.setPointerCapture=captureOriginal;");
 // A wide wardrobe uses a stationary transparent stage. Measure the visible
 // actor on the desktop, which must move continuously in either window mode.
 assert(new Set(progress).size>=8,'Dragging updates throughout the gesture');assert(Math.abs(await actorX()-beforeActorX+80)<10,'Drag does not lose deltas');
 assert(configWrites<6,'Drag does not write config on each pointer move');metrics.compactDrag={positions:new Set(progress).size,writes:configWrites};checks.push('Controlled hold/drag stream moves native window continuously with complete deltas and debounced persistence');
 for(const slug of ['tia','sarah']){
  await js(`await gla.selectAvatar('${slug}');`);await loaded();await wait(700);
  for(const prop of ['rifle','pistol']){
   await choose('prop:'+prop);await until(()=>js('return Boolean(gla_stage());'),'prop frame');
   await js('gla_avatar.setOrbit({yaw:1.1,pitch:0});');await wait(300);
   let geometry=await js("const a=gla_avatar,g=gla_geometry();return {points:a.options.propPoints().map(p=>({x:p.x*g.fit.scale+g.fit.x,y:p.y*g.fit.scale+g.fit.y})),size:[innerWidth,innerHeight],held:a.options.heldProps.get(a.options.selection.prop)?.offsets.length};");
   assert(geometry.held>30,slug+' grip includes arms and fingers');
   assert(geometry.points.length===8,slug+' prop bounds measured');
   assert(geometry.points.every(p=>p.x>=3&&p.x<=geometry.size[0]-3&&p.y>=3&&p.y<=geometry.size[1]-3),slug+' '+prop+' full prop in frame');
   await snapshot(slug+'-'+prop+'-side');
   // Independent oracle: project actual deformed vertices, never the cached
   // corners used by the implementation. This catches nested-rig truncation.
   for(const [yaw,pitch] of [[.588,.376],[-1.2,.45],[1.4,-.35],[0,0]]){
    await js(`gla_avatar.setOrbit({yaw:${yaw},pitch:${pitch}});`);await wait(180);
    const bounds=await js("const a=gla_avatar,THREE=await import('/vendor/three/three.module.js'),p=new THREE.Vector3(),g=gla_geometry(),v=a.currentView;let count=0,missed=0;for(const name of a.options.props.find(p=>p.id===a.options.selection.prop).nodes)for(const root of a.options.nodes.get(name)||[]){root.traverseVisible(m=>{if(!m.isMesh)return;for(let i=0;i<m.geometry.attributes.position.count;i++){m.getVertexPosition(i,p).applyMatrix4(m.matrixWorld);const q=a.project(p);count++;if(q.x<v.x-1||q.x>v.x+v.w+1||q.y<v.y-1||q.y>v.y+v.h+1)missed++;}});}return {count,missed};");
    assert(bounds.count>100,slug+' actual prop vertices measured');assert.equal(bounds.missed,0,slug+' '+prop+' actual vertices stay inside rendered crop at '+yaw+','+pitch);
   }
   if(slug==='tia'&&prop==='rifle')await snapshot('tia-rifle-complete-tip');

   await js("gla_avatar.options.nextPlaybackAt=performance.now()-1;");await wait(1100);
   assert.equal(await js('return gla_avatar.options.transition===null;'),true,'Idle playlist cannot replace grip');
   for(const pose of ['Ps001.heart','Ps004.sit']){
    await choose('pose:'+pose);
    const error=await js('const h=gla_avatar.options.heldProps.get(gla_avatar.options.selection.prop),inv=h.anchor.matrixWorld.clone().invert();return Math.max(...h.offsets.flatMap(({node,offset})=>inv.clone().multiply(node.matrixWorld).elements.map((v,i)=>Math.abs(v-offset.elements[i]))));');
    assert(error<.025,slug+' '+prop+' grip retained in '+pose+': '+error);
   }
   await js("await gla_play('dance');");await wait(500);
   const samples=[];
   for(let i=0;i<6;i++){await wait(140);samples.push(await js('const a=gla_avatar,h=a.options.heldProps.get(a.options.selection.prop),inv=h.anchor.matrixWorld.clone().invert();return {error:Math.max(...h.offsets.flatMap(({node,offset})=>inv.clone().multiply(node.matrixWorld).elements.map((v,i)=>Math.abs(v-offset.elements[i])))),root:a.bones.hips.matrixWorld.elements};'));}
   assert(samples.every(s=>s.error<.025),'Holding arms follow dancing torso');assert(new Set(samples.map(s=>JSON.stringify(s.root))).size>1,'Dance still moves torso');
   await snapshot(slug+'-'+prop+'-dance');await js("await gla_play('stay');");
   checks.push(slug+' '+prop+': original grip, complete framing, idle, heart, sitting and dance');
  }
 }
 // A future avatar can attach a prop without a holding-pose declaration.
 await js("const a=gla_avatar,p=a.options.props.find(p=>p.id===a.options.selection.prop);window.savedPropPose=p.pose;delete p.pose;");
 assert.equal(await js('return gla_avatar.options.propPoints().length;'),8,'Generic prop bounds do not require a known hand or holding pose');
 await js("gla_avatar.options.props.find(p=>p.id===gla_avatar.options.selection.prop).pose=savedPropPose;");
 checks.push('Future imported props are framed without a named holding pose');
 // Native trackpad wheel stream: scale changes before the stream stops.
 await choose('pose:Ps071.rifle');await choose('prop:rifle');
 let p=await hit(),scales=[];const nativeBounds=win.getBounds();
 for(let i=0;i<30;i++){
  input({type:'mouseWheel',...p,deltaY:2,deltaX:0,modifiers:['control'],hasPreciseScrollingDeltas:true,canScroll:true});await wait(18);scales.push(await js('return gla_stage().scale;'));
 }
 await wait(350);assert(new Set(scales.map(v=>v.toFixed(4))).size>12,'Pinch updates while fingers move');assert.deepEqual(win.getBounds(),nativeBounds,'Pinch does not repeatedly resize native window');
 metrics.pinch={distinctScales:new Set(scales).size,start:scales[0],end:scales.at(-1)};checks.push('Continuous native pinch input with stable native window');
 p=await hit();const anchor=await js('return {...gla_stage().anchor};');
 input({type:'mouseMove',...p});input({type:'mouseDown',button:'left',clickCount:1,...p});await wait(240);
 const anchors=[];
 for(let i=1;i<=15;i++){input({type:'mouseMove',x:p.x-i*3,y:p.y});await wait(20);anchors.push(await js('return gla_stage().anchor.x;'));}
 input({type:'mouseUp',button:'left',clickCount:1,x:p.x-45,y:p.y});await wait(300);
 assert(new Set(anchors).size>8,'Stage drag moves throughout stream: '+JSON.stringify({p,anchor,anchors,debug:await js('return gla_debug();')}));
 const stopped=await js('return gla_stage().anchor.x;');input({type:'mouseMove',x:p.x-70,y:p.y});await wait(200);assert(Math.abs(await js('return gla_stage().anchor.x;')-stopped)<1,'Release ends drag');
 // A small initial move must not cancel the hold, and cancellation must
 // release the drag even when a normal mouse-up cannot be delivered.
 p=await hit();const earlyStart=await js('return gla_stage().anchor.x;');
 input({type:'mouseMove',...p});input({type:'mouseDown',button:'left',clickCount:1,...p});await wait(25);
 input({type:'mouseMove',x:p.x-14,y:p.y});await wait(70);
 assert(Math.abs(await js('return gla_stage().anchor.x;')-earlyStart)>8,'Early deliberate movement starts drag');
 await js("document.querySelector('#stage').dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:1}));");
 input({type:'mouseUp',button:'left',clickCount:1,x:p.x-14,y:p.y});
 assert.equal(await js('return gla_debug().interaction.dragging;'),false,'Cancellation releases drag');
 checks.push('Drag after pinch, continuous movement, early movement, clean release and cancellation');
 // Restore uses captured defaults; persistence is in main config, independent
 // of the randomly assigned loopback origin on the next full app launch.
 for(const slug of ['tia','sarah']){
  await js(`await gla.selectAvatar('${slug}');`);await loaded();await choose('appearance-reset');
  const result=await js('const s=await gla.getSettings();return {actual:gla_avatar.options.selection,defaults:s.appearanceDefaults[s.avatar.slug],saved:s.avatarLooks[s.avatar.slug]};');
  for(const [k,v] of Object.entries(result.defaults)){assert.equal(result.actual[k],v);assert.equal(result.saved[k],v);}
  await snapshot(slug+'-default');checks.push(slug+' current look restored and persisted independently of server address');
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({passed:true,checks,metrics,errors},null,2));console.log(JSON.stringify({checks,metrics}));
}catch(error){fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({checks,metrics,error:error.message}));console.error(error);console.error(errors);process.exitCode=1;}app.exit(process.exitCode||0);});
