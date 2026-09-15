// Run with Electron and locally licensed packs in build/characters. Captures remain ignored.
const {app,BrowserWindow}=require('electron');
const fs=require('fs'),path=require('path'),http=require('http'),zlib=require('zlib'),assert=require('assert/strict');
const repo=path.resolve(__dirname,'..'),label='current',out=path.join(repo,'build/qa-head-attachments');fs.mkdirSync(out,{recursive:true});app.setPath('userData',out+'/profile');app.on('window-all-closed',()=>{});
const server=http.createServer((req,res)=>{const u=decodeURIComponent(req.url.split('?')[0]);if(u==='/'){res.setHeader('Content-Type','text/html');return res.end('<script type="module" src="/avatar3d.js"></script>');}const f=u.startsWith('/asset/')?repo+'/build/characters/'+u.slice(7):repo+'/web'+u;
if(!fs.existsSync(f)&&fs.existsSync(f+'.deflate')){res.setHeader('Content-Type','application/json');return res.end(zlib.inflateRawSync(fs.readFileSync(f+'.deflate')));}if(!fs.existsSync(f)){res.statusCode=404;return res.end();}res.setHeader('Content-Type',({'.js':'text/javascript','.gltf':'model/gltf+json','.json':'application/json'})[path.extname(f)]||'application/octet-stream');fs.createReadStream(f).pipe(res);});
app.whenReady().then(async()=>{const errors=[];try{await new Promise(r=>server.listen(0,'127.0.0.1',r));const w=new BrowserWindow({show:false,width:1000,height:1000,webPreferences:{backgroundThrottling:false}});w.webContents.on('console-message',d=>{if(d.level==='error')errors.push(d.message)});await w.loadURL('http://127.0.0.1:'+server.address().port);
for(const slug of ['ming-mei','iselda']){const result=await w.webContents.executeJavaScript(`(async()=>{while(!window.OpenClamAvatar3D)await new Promise(r=>setTimeout(r,20));const T=await import('/vendor/three/three.module.js');window.shots=[];const a=OpenClamAvatar3D.create({width:640,height:900});await a.load('/asset/${slug}/runtime/resident/model.gltf',{resources:true,performance:'balanced',appearanceLibrary:'/asset/${slug}/appearance/index.json',motionLibrary:'/asset/${slug}/runtime/motions/library.json'});a.options.select({body:'Ps007.stand',outfit:'dress',lighting:'studio',performance:'balanced',playTransitions:'false',prop:'none'});a.options.playback=[];if(a.options.transition){a.options.current=a.options.transition.target;a.options.transition=null;}a.options.write(a.options.current);await a.resources.update('balanced',1500,true);const state={reduce:true,bodyMotion:false,projectedHeight:1500};
const capture=(name)=>{const h=a.bones.head.getWorldPosition(new T.Vector3());h.y+=a.headRadius*.9;const c=a.project(h);a.render(10000,state,{x:c.x-120,y:c.y-150,w:240,h:340,pixelWidth:600,pixelHeight:850});shots.push({name,data:a.canvas.toDataURL()});};
let maximumError=0;const checks=[];a.root.updateMatrixWorld(true);const authoredLocals=(a.headAttachments?.roots||[]).map(r=>r.node.matrix.clone());for(const [name,yaw,pitch,roll] of [['neutral',0,0,0],['left',.5,.1,0],['right',-.5,-.2,.1],['up',.1,-.35,-.1]]){a.setOrbit({yaw:.15,pitch:.05});const s={...state,head:{yaw,pitch,roll}};for(let i=0;i<15;i++){a.render(10000+i*16,s);await a.resources.pending;}const h=a.bones.head;const roots=a.headAttachments?.roots||[];for(const r of roots){const expected=a.headAttachments.headBefore.clone().invert().multiply(r.world),actual=h.matrixWorld.clone().invert().multiply(r.node.matrixWorld);maximumError=Math.max(maximumError,...actual.elements.map((v,i)=>Math.abs(v-expected.elements[i])));}const c=a.project(h.getWorldPosition(new T.Vector3()).add(new T.Vector3(0,a.headRadius*.9,0)));a.render(10300,s,{x:c.x-120,y:c.y-150,w:240,h:340,pixelWidth:600,pixelHeight:850});shots.push({name,data:a.canvas.toDataURL()});checks.push({name,roots:roots.length});}
for(let i=0;i<200;i++){a.render(11000+i*16,{...state,head:{yaw:Math.sin(i*.12)*.5,pitch:Math.cos(i*.08)*.3}});const p=a.headAttachments;if(p)for(const r of p.roots){const expected=p.headBefore.clone().invert().multiply(r.world),actual=a.bones.head.matrixWorld.clone().invert().multiply(r.node.matrixWorld);maximumError=Math.max(maximumError,...actual.elements.map((v,j)=>Math.abs(v-expected.elements[j])));}}
if(a.headAttachments?.roots.length){
 a.headAttachments.restore();a.root.updateMatrixWorld(true);
 a.headAttachments.roots.forEach((r,i)=>{if(r.node.matrix.elements.some((v,j)=>Math.abs(v-authoredLocals[i].elements[j])>1e-6))throw Error('Repeated attention drifted from authored local matrix');});
}
// Sample real motion while adding independent procedural attention.
if(a.headAttachments?.roots.length){
 for(const id of ['boxing-warm-up','360-power-spin-jump']){
  await a.motion.play(id,{now:20000,loop:true});
  const first=a.headAttachments.roots[0],authored=[];
  for(let i=0;i<60;i++){
   a.prepareMotionFrame(20000+i*40,false);a.render(20000+i*40,{...state,reduce:false,head:{yaw:Math.sin(i*.17)*.4,pitch:.15}});
   const p=a.headAttachments;
   for(const r of p.roots){const expected=p.headBefore.clone().invert().multiply(r.world),actual=a.bones.head.matrixWorld.clone().invert().multiply(r.node.matrixWorld);maximumError=Math.max(maximumError,...actual.elements.map((v,j)=>Math.abs(v-expected.elements[j])));}
   authored.push([...first.world.elements]);
  }
  const movement=Math.max(...authored.map(v=>Math.max(...v.map((n,j)=>Math.abs(n-authored[0][j])))));
  if(movement<.001)throw Error(id+' lost authored hair motion');
  a.motion.stop({immediate:true});
 }
}

// Writing a new authored pose must discard the previous procedural overlay.
for(const body of ['Ps007.stand','Ps001.heart']){a.options.select({...a.options.selection,body});if(a.options.transition){a.options.current=a.options.transition.target;a.options.transition=null;}a.options.write(a.options.current);a.render(16000,{...state,head:{yaw:.4}});a.options.write(a.options.current);if(a.headAttachments?.applied)throw Error('Authored pose retained the old hair overlay');}
const glError=a.renderer.getContext().getError();a.dispose();return {slug:${JSON.stringify(slug)},maximumError,checks,glError};})()`);for(const s of await w.webContents.executeJavaScript('shots'))fs.writeFileSync(out+'/'+slug+'-'+s.name+'.png',Buffer.from(s.data.split(',')[1],'base64'));if(label!=='before'){assert(result.maximumError<1e-5);assert(result.checks.every(c=>c.roots>=3));}assert.equal(result.glError,0);console.log(JSON.stringify(result));}
assert.deepEqual(errors,[]);fs.writeFileSync(out+'/passed.json',JSON.stringify({passed:true}));}catch(e){console.error(e,errors);process.exitCode=1;}finally{server.close();app.exit(process.exitCode||0);}});
