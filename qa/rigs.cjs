// Real private packages + the actual WebGL renderer. No account or microphone.
const {app,BrowserWindow}=require('electron'),fs=require('fs'),path=require('path'),http=require('http'),zlib=require('zlib'),assert=require('assert/strict');
const repo=path.resolve(__dirname,'..'),out=path.join(repo,'build/qa-rigs');fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(out,'profile'));
const server=http.createServer((req,res)=>{let url=decodeURIComponent(req.url.split('?')[0]);if(url==='/'){res.setHeader('Content-Type','text/html');return res.end('<script type="module" src="/avatar3d.js"></script>');}let f=url.startsWith('/asset/')?path.join(repo,'build/characters',url.slice(7)):path.join(repo,'web',url);if(!fs.existsSync(f)&&fs.existsSync(f+'.deflate')){res.setHeader('Content-Type','application/json');return res.end(zlib.inflateRawSync(fs.readFileSync(f+'.deflate')));}if(!fs.existsSync(f)){res.statusCode=404;return res.end();}res.setHeader('Content-Type',({'.js':'text/javascript','.json':'application/json','.gltf':'model/gltf+json'})[path.extname(f)]||'application/octet-stream');fs.createReadStream(f).pipe(res);});
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{const reports=[];try{await new Promise(r=>server.listen(0,'127.0.0.1',r));for(const slug of ['iselda','ming-mei','seraphim','sarah','tia']){
 const w=new BrowserWindow({show:false,width:900,height:1000,webPreferences:{backgroundThrottling:false}}),errors=[];w.webContents.on('console-message',d=>{if(d.level==='error')errors.push(d.message);});await w.loadURL('http://127.0.0.1:'+server.address().port);
 const result=await w.webContents.executeJavaScript(`(async()=>{
 while(!window.OpenClamAvatar3D)await new Promise(r=>setTimeout(r,10));const T=await import('/vendor/three/three.module.js'),a=OpenClamAvatar3D.create({width:650,height:1000});await a.load('/asset/${slug}/runtime/resident/model.gltf',{resources:true,pose:'rest',performance:'eco',appearanceLibrary:'/asset/${slug}/appearance/index.json'});
 window.qaShots=[];const check=(v,message)=>{if(!v)throw Error(message);},name=n=>n.userData.sourceName||n.name,scope=n=>name(n).slice(0,name(n).lastIndexOf(':')+1);const primaryScope=scope(a.bones.head);
 for(const group of Object.values(a.boneGroups))for(const list of Object.values(group))check(list.every(n=>scope(n)===primaryScope),'Mixed skeleton in primary arm');
 for(const rig of a.secondaryBoneRigs)for(const group of Object.values(rig.boneGroups))for(const list of Object.values(group))check(list.every(n=>scope(n)===rig.namespace),'Mixed secondary skeleton');
 const lengths=()=>Object.fromEntries(['l','r'].flatMap(s=>[['upper-'+s,a.bones.upperArm[s].getWorldPosition(new T.Vector3()).distanceTo(a.bones.lowerArm[s].getWorldPosition(new T.Vector3()))],['fore-'+s,a.bones.lowerArm[s].getWorldPosition(new T.Vector3()).distanceTo(a.bones.hand[s].getWorldPosition(new T.Vector3()))]]));const rest=lengths();a.relaxArms();const relaxed=lengths();for(const k in rest)check(Math.abs(rest[k]-relaxed[k])<1e-5,'Relaxed arm length changed '+k);
 a.options.playback=[];let poses=0,maxSpineError=0,maxLengthError=0;const retargeted=!!a.options.data.retargetRevision;
 for(const p of a.options.poses.values()){
  if(p.group!=='body'){if(retargeted)check(Object.keys(p.deltas).every(n=>/^(c_)?(index|middle|ring|pinky|thumb)/.test(n.split(':').pop())),'Finger preset moves arm');continue;}
  a.options.select({body:p.id,prop:'none',performance:'eco',playTransitions:'false'});a.render(100000+poses*1000,{reduce:true,fitContent:true});poses++;
  if(retargeted)for(const b of a.options.bones){const n=b.name.replace(/^.*:/,'');if(!/^spine_\d+\.x$/.test(n))continue;const alias=b.name.slice(0,b.name.length-n.length)+'c_'+n.replace('.x','_bend.x'),other=a.options.bones.find(x=>x.name===alias);if(other)maxSpineError=Math.max(maxSpineError,b.node.getWorldPosition(new T.Vector3()).distanceTo(other.node.getWorldPosition(new T.Vector3())));}
  if(retargeted){const posed=lengths();for(const k in rest)maxLengthError=Math.max(maxLengthError,Math.abs(rest[k]-posed[k]));}
 }
 if(retargeted){check(maxSpineError<1e-5,'Torso aliases separate: '+maxSpineError);check(maxLengthError<.002,'Arm segment stretches: '+maxLengthError);}
 let gripChecks=0;
 a.options.select({body:'Ps007.stand',performance:'eco',playTransitions:'false'});a.render(190000,{reduce:true});
 let fittedVertices=0;
 if(a.clearance){
  await a.resources.update('eco',1000,true);a.render(190000,{reduce:true});
  for(const {node} of a.clearance.records)if(node.visible){const attr=node.geometry.getAttribute('avatarClothAllowance');check(!!attr,'Garment contact lacks original fit data');for(let i=0;i<attr.count;i++)if(attr.getW(i)===0){
   const corrected=node.getVertexPosition(i,new T.Vector3()),radii=[...a.clearance.a,...a.clearance.b].map(v=>v.w);[...a.clearance.a,...a.clearance.b].forEach(v=>v.w=0);
   const authored=node.getVertexPosition(i,new T.Vector3());[...a.clearance.a,...a.clearance.b].forEach((v,j)=>v.w=radii[j]);check(corrected.distanceTo(authored)<1e-7,'Contact inflates the fitted hip');fittedVertices++;
  }}check(fittedVertices>100,'Original fitted waist was not identified');
 }
 const armNodes=[...new Set(['upperArm','lowerArm','hand'].flatMap(k=>Object.values(a.boneGroups[k]).flat()))],armBefore=armNodes.map(n=>n.matrixWorld.clone());
 for(const hand of a.options.poses.values())if(hand.group!=='body'){
  a.options.select({body:'Ps007.stand',[hand.group]:hand.id,performance:'eco',playTransitions:'false'});a.render(190100+gripChecks*10,{reduce:true});
  armNodes.forEach((n,i)=>check(n.matrixWorld.elements.every((v,j)=>Math.abs(v-armBefore[i].elements[j])<1e-5),'Hand preset displaces arm '+hand.id));gripChecks++;
 }
 let propCases=0,vertices=0;for(const prop of a.options.props.filter(p=>p.nodes?.length)){
  a.options.select({prop:prop.id,performance:'eco',playTransitions:'false'});await a.resources.update('eco',1000,true);
  for(const yaw of [0,.7,-1.2,1.5]){a.setOrbit({yaw,pitch:.15});a.render(200000+propCases*1000,{reduce:true,fitContent:true});await a.resources.pending;a.render(200100+propCases*1000,{reduce:true,fitContent:true});const v=a.currentView,p=new T.Vector3();let count=0;
   for(const n of prop.nodes)for(const root of a.options.nodes.get(n)||[])root.traverseVisible(m=>{if(!m.isMesh)return;for(let i=0;i<m.geometry.attributes.position.count;i++){m.getVertexPosition(i,p).applyMatrix4(m.matrixWorld);const q=a.project(p);check(q.x>=v.x&&q.x<=v.x+v.w&&q.y>=v.y&&q.y<=v.y+v.h,'Actual prop vertex clipped '+prop.id);count++;}});check(count>10,'Missing prop '+prop.id);vertices+=count;propCases++;
   if(yaw===.7)window.qaShots.push({name:prop.id,data:a.canvas.toDataURL()});
  }
 }
 const report={character:'${slug}',poses,gripChecks,fittedVertices,secondaryRigs:a.secondaryBoneRigs.length,maxSpineError,maxLengthError,propCases,vertices,glError:a.renderer.getContext().getError()};a.dispose();return report;
})()`);assert.deepEqual(errors,[]);assert.equal(result.glError,0);for(const shot of await w.webContents.executeJavaScript('qaShots'))fs.writeFileSync(path.join(out,slug+'-'+shot.name+'.png'),Buffer.from(shot.data.split(',')[1],'base64'));reports.push(result);console.log(result);w.destroy();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({passed:true,reports},null,2));}
}catch(e){console.error(e);process.exitCode=1;fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:e.message,reports},null,2));}finally{server.close();app.exit(process.exitCode||0);}});
