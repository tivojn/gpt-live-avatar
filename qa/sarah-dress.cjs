// Run with Electron. Requires licensed local build/characters; images stay local.
// GLA_REPO=/path/to/repo GLA_SARAH_STAGE=/path/to/audit electron qa/sarah-dress.cjs
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),zlib=require('node:zlib');
const root=path.resolve(process.env.GLA_REPO||path.join(__dirname,'..'));
const stage=process.env.GLA_SARAH_STAGE&&path.resolve(process.env.GLA_SARAH_STAGE);
const out=path.resolve(process.env.GLA_QA_OUT||path.join(root,'work','sarah-dress-qa'));
fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(out,'isolated-profile'));app.on('window-all-closed',()=>{});
const errors=[];
const server=http.createServer((req,res)=>{
 const u=decodeURIComponent(req.url.split('?')[0]);
 if(req.method==='POST'&&u.startsWith('/capture/')){const name=path.basename(u);let chunks=[];req.on('data',x=>chunks.push(x));req.on('end',()=>{fs.writeFileSync(path.join(out,name),Buffer.concat(chunks));res.end('ok');});return;}
 if(u==='/'){res.setHeader('Content-Type','text/html');return res.end('<script type="module" src="/avatar3d.js"></script>');}
 let file=u.startsWith('/asset/')?path.join(root,'build/characters',u.slice(7)):path.join(root,'web',u);
 if(stage){
  if(u==='/asset/sarah/runtime/resident/model.gltf')file=path.join(stage,'body-fitted-model-v5.gltf');
  else if(u.endsWith('/body-fitted-brief-v5.bin'))file=path.join(stage,'body-fitted-brief-v5.bin');
  else if(['/avatar3d-body-brief.js','/avatar3d-garment-fit.js','/avatar3d-cloth-occlusion.js'].includes(u))file=path.join(stage,'final/web',u);
 }
 if(!fs.existsSync(file)&&fs.existsSync(file+'.deflate')){res.setHeader('Content-Type','application/json');return res.end(zlib.inflateRawSync(fs.readFileSync(file+'.deflate')));}
 if(!fs.existsSync(file)){errors.push('404 '+u);res.statusCode=404;return res.end();}
 res.setHeader('Content-Type',({'.js':'text/javascript','.json':'application/json','.gltf':'model/gltf+json'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
});
app.whenReady().then(async()=>{try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const w=new BrowserWindow({show:false,width:1200,height:1000,webPreferences:{backgroundThrottling:false}});
 w.webContents.on('console-message',e=>{if(e.level==='error')errors.push(e.message);});
 await w.loadURL('http://127.0.0.1:'+server.address().port);
 const report=await w.webContents.executeJavaScript(`(async()=>{
 const until=async fn=>{let t=performance.now();while(!fn()){if(performance.now()-t>60000)throw Error('Avatar load timeout');await new Promise(r=>setTimeout(r,20));}};
 await until(()=>window.OpenClamAvatar3D);const T=await import('/vendor/three/three.module.js');
 const a=OpenClamAvatar3D.create({width:640,height:900});
 await a.load('/asset/sarah/runtime/resident/model.gltf',{resources:true,pose:'rest',performance:'balanced',appearanceLibrary:'/asset/sarah/appearance/index.json',motionLibrary:'/asset/sarah/runtime/motions/library.json'});
 await a.resources.update('balanced',1500,true);await a.resources.pending;
 const meshes=[];a.model.traverse(n=>{if(n.isSkinnedMesh)meshes.push(n);});
 const under=meshes.find(n=>n.userData.avatarBodyFittedUnderlayer);
 if(!under)throw Error('Expected body-fitted underwear metadata');
 const body=meshes.find(n=>n.geometry.attributes.position?.count===52921);
 if(!body)throw Error('Sarah body primitive missing');
 const p=body.geometry.attributes.position, q=under.geometry.attributes.position;
 const key=(v,i)=>[v.getX(i),v.getY(i),v.getZ(i)].map(x=>x.toFixed(7)).join(',');
 const mapping=new Map();for(const i of new Set(body.geometry.index.array)){const id=key(p,i);if(!mapping.has(id))mapping.set(id,[]);mapping.get(id).push(i);}
 // Unreferenced internal source vertices can share boundary positions. Match
 // only rendered outer-body vertices with the same four skin influences.
 const ids=Array.from({length:q.count},(_,i)=>mapping.get(key(q,i))?.find(v=>[0,1,2,3].every(k=>body.geometry.attributes.skinIndex.getComponent(v,k)===under.geometry.attributes.skinIndex.getComponent(i,k)&&Math.abs(body.geometry.attributes.skinWeight.getComponent(v,k)-under.geometry.attributes.skinWeight.getComponent(i,k))<1e-7)));
 if(ids.some(x=>x===undefined))throw Error('Underwear surface moved away from the body');
 const info={poses:[],motions:[],outfits:[],shots:0,underwearVertices:q.count,maxWeightError:0,maxSurfaceError:0,glErrors:[],renderMs:[]};
 for(const m of [under,body]){const j=m.geometry.attributes.skinIndex,v=m.geometry.attributes.skinWeight;for(let i=0;i<v.count;i++){
  let sum=0;for(let k=0;k<4;k++){const n=v.getComponent(i,k);if(!Number.isFinite(n)||n<0||j.getComponent(i,k)>=m.skeleton.bones.length)throw Error('Invalid skin influence');sum+=n;}
  info.maxWeightError=Math.max(info.maxWeightError,Math.abs(sum-1));
 }}if(info.maxWeightError>1e-4)throw Error('Unnormalized skin weights');
 const v1=new T.Vector3(),v2=new T.Vector3();
 const aligned=()=>{if(!under.visible||!under.geometry.attributes.position.count)return;body.skeleton.update();under.skeleton.update();for(let i=0;i<q.count;i+=19){
  body.getVertexPosition(ids[i],v1).applyMatrix4(body.matrixWorld);under.getVertexPosition(i,v2).applyMatrix4(under.matrixWorld);info.maxSurfaceError=Math.max(info.maxSurfaceError,v1.distanceTo(v2));
 }if(info.maxSurfaceError>1e-5)throw Error('Body / underwear skinning diverged');};
 info.morphChecks=[];
 for(const name of ['Smaller.Pelvis','Thicker.Legs']){const bi=body.morphTargetDictionary[name],ui=under.morphTargetDictionary[name];if(bi===undefined||ui===undefined)throw Error('Missing shared body morph '+name);const beforeBody=body.morphTargetInfluences[bi],beforeUnder=under.morphTargetInfluences[ui];body.morphTargetInfluences[bi]=under.morphTargetInfluences[ui]=.65;aligned();body.morphTargetInfluences[bi]=beforeBody;under.morphTargetInfluences[ui]=beforeUnder;info.morphChecks.push(name);}
 const savedPosition=Array.from(q.array);
 let clock=1000;const state={projectedHeight:1500,audienceContact:true,cameraFocus:true,fitContent:true,bodyMotion:false};
 const render=async()=>{await a.resources.pending;for(let i=0;i<3;i++)a.render(clock+=40,state);const gl=a.renderer.getContext();const error=gl.getError();if(error!==gl.NO_ERROR)info.glErrors.push(error);aligned();};
 const capture=async name=>{const image=await new Promise(r=>a.canvas.toBlob(r,'image/png'));await fetch('/capture/'+name+'.png',{method:'POST',body:image});info.shots++;};
 const angles=[[0,0,0],[1,1.15,.6],[2,-1.15,.6],[3,1.15,-.6],[4,-1.15,-.6],[5,Math.PI,0],[6,0,-1.12],[7,Math.PI,-1.12]];
 const select=async(body,outfit)=>{a.motion.stop({immediate:true});a.options.select({prop:'none',hands:'none',leftHand:'none',rightHand:'none',performance:'balanced',playTransitions:'false',body,outfit});a.options.playback=[];if(a.options.transition){a.options.current=a.options.transition.target;a.options.transition=null;}a.options.write(a.options.current);await a.resources.update('balanced',1500,true);await a.resources.pending;};
 const shoot=async name=>{for(const[index,yaw,pitch]of angles){a.setOrbit({yaw,pitch});await render();await capture(name+'-'+index);
 if(index===0||index===5||index>=6){const hip=a.options.bones.find(b=>b.name==='root.x').node.getWorldPosition(new T.Vector3()),c=a.project(hip);a.render(clock,state,{x:c.x-120,y:c.y-145,w:240,h:290,pixelWidth:768,pixelHeight:928});await capture(name+'-'+index+'-fit');}
 }};
 const poses=['Ps001.heart','Ps007.stand','Ps008.stand','Ps009.stand','Ps010.stand','Ps011.stand','Ps012.stand','Ps013.stand','Ps015.stand','Ps004.sit','Ps005.sit','Ps006.crawl','Ps014.sit'];
 for(const outfit of ['summer','dress','dress-straps'])for(const pose of poses){await select(pose,outfit);
  if(!under.visible||!under.parent.visible)throw Error('Missing underlayer in '+outfit);
  await shoot(outfit+'-'+pose);info.poses.push({outfit,pose});
 }
 for(const outfit of ['tactical','casual']){await select('Ps007.stand',outfit);await shoot(outfit+'-Ps007.stand');info.outfits.push(outfit);}
 await select('Ps007.stand','summer');if(savedPosition.some((x,i)=>x!==under.geometry.attributes.position.array[i]))throw Error('Summer round-trip modified underwear geometry');info.summerRoundTrip=true;
 for(const id of ['boxing-warm-up','happy-sway-standing','360-power-spin-jump','backflip','bubble-dance','all-night-dance']){
  if(!a.motion.clips.has(id))throw Error('Required motion missing: '+id);
  const clip=await a.motion.prepare(id);for(const outfit of ['summer','dress']){
   await select('Ps007.stand',outfit);for(const fraction of [.25,.5,.75]){
    a.options.write(a.motion.frame(clip,Math.min(clip.frames.length-1,Math.round(fraction*(clip.frames.length-1)))));a.options.current=a.motion.frame(clip,Math.min(clip.frames.length-1,Math.round(fraction*(clip.frames.length-1))));
    await shoot(outfit+'-'+id+'-'+fraction);info.motions.push({id,outfit,fraction});
   }
  }
 }
 await select('Ps007.stand','summer');a.setOrbit({yaw:0,pitch:0});await render();
 for(let i=0;i<20;i++){const t=performance.now();a.render(clock+=33,state);a.renderer.getContext().finish();info.renderMs.push(performance.now()-t);}
 info.rendererMemory={...a.renderer.info.memory};info.drawCalls=a.renderer.info.render.calls;
 info.renderMs.sort((a,b)=>a-b);info.renderMedianMs=info.renderMs[10];
 if(info.glErrors.length)throw Error('WebGL errors: '+info.glErrors.join(','));a.dispose();return info;
 })().catch(e=>({failure:e.stack}))`);
 if(report.failure)throw Error(report.failure);
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({...report,errors},null,2));
 if(errors.length)throw Error(errors.join('\n'));
 console.log(JSON.stringify({passed:true,shots:report.shots,poseCases:report.poses.length,motionCases:report.motions.length,maxSurfaceError:report.maxSurfaceError,maxWeightError:report.maxWeightError,renderMedianMs:report.renderMedianMs}));
 }catch(e){fs.writeFileSync(path.join(out,'failure.txt'),String(e.stack||e)+'\n'+errors.join('\n'));console.error(e);process.exitCode=1;}finally{server.close();app.exit(process.exitCode||0);}});
