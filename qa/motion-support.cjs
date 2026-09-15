// Requires licensed local build/characters packages; never uploads source models.
const {app,BrowserWindow}=require('electron'),fs=require('fs'),path=require('path'),http=require('http'),zlib=require('zlib');
const root=path.resolve(__dirname,'..'),out=root+'/build/qa-motion-support';fs.mkdirSync(out,{recursive:true});app.setPath('userData',out+'/profile');app.on('window-all-closed',()=>{});
const server=http.createServer((req,res)=>{const u=decodeURIComponent(req.url.split('?')[0]);if(u==='/'){res.setHeader('Content-Type','text/html');return res.end('<script type="module" src="/avatar3d.js"></script>');}const file=u.startsWith('/asset/')?root+'/build/characters/'+u.slice(7):u.startsWith('/audit/')?out+'/'+u.slice(7):root+'/web'+u;if(!fs.existsSync(file)&&fs.existsSync(file+'.deflate')){res.setHeader('Content-Type','application/json');return res.end(zlib.inflateRawSync(fs.readFileSync(file+'.deflate')));}if(!fs.existsSync(file)){res.statusCode=404;return res.end();}res.setHeader('Content-Type',({'.js':'text/javascript','.json':'application/json','.gltf':'model/gltf+json'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);});
app.whenReady().then(async()=>{try{await new Promise(r=>server.listen(0,'127.0.0.1',r));const w=new BrowserWindow({show:false,width:1200,height:1000,webPreferences:{backgroundThrottling:false}});await w.loadURL('http://127.0.0.1:'+server.address().port);const result=await w.webContents.executeJavaScript(`(async()=>{
 while(!window.OpenClamAvatar3D)await new Promise(r=>setTimeout(r,20));const T=await import('/vendor/three/three.module.js');
window.shots=[];const result={};
for(const slug of ['tia','sarah','iselda','ming-mei','seraphim']){const a=OpenClamAvatar3D.create({width:440,height:640});await a.load('/asset/'+slug+'/runtime/resident/model.gltf',{resources:true,pose:'rest',performance:'eco',appearanceLibrary:'/asset/'+slug+'/appearance/index.json',motionLibrary:'/asset/'+slug+'/runtime/motions/library.json'});await a.resources.update('eco',1200,true);
 a.options.select({prop:'none',hands:'none',leftHand:'none',rightHand:'none',performance:'eco',playTransitions:'false',body:'Ps007.stand'});a.options.playback=[];a.setOrbit({yaw:0,pitch:0});
 for(const id of ['boxing-warm-up','happy-sway-standing','360-power-spin-jump']){
 let data;try{data=await a.motion.prepare(id);}catch(e){const raw=await(await fetch('/asset/'+slug+'/runtime/motions/'+id+'.json')).json();throw Error(slug+' '+id+': '+e.message+' bones '+a.options.bones.length+'/'+raw.bones.length+' frame '+raw.frames[0].length+' id '+raw.id);}const duration=(data.frames.length-1)/data.fps;result[slug+'-'+id]={frames:data.frames.length,fps:data.fps};
 await a.motion.play(id,{now:1000,loop:false});a.motion.active.start=-1000;if(a.motion.active.hands.some(Boolean))throw Error('No-prop incorrectly preserves fingers: '+slug);if(id==='boxing-warm-up'&&!a.motion.active.authoredHands.some(Boolean))throw Error('Missing authored fists: '+slug);
 const joints=[],gap=[],heightL=[],heightR=[],depth=[],views=[];const bone=n=>a.options.bones.find(b=>b.name===n).node;const point=n=>bone(n).getWorldPosition(new T.Vector3());
 for(let i=0;i<data.frames.length-1;i++){
  const now=1000+i/data.fps*1000;
  a.render(now,{cameraFocus:false,audienceContact:false,fitContent:true,stableFitContent:true,bodyMotion:false});
  views.push(a.currentView.h);const l=point('foot.l'),r=point('foot.r'),hip=point('root.x');gap.push(l.x-r.x);heightL.push(l.y);heightR.push(r.y);depth.push(hip.clone().applyMatrix4(a.camera.matrixWorldInverse).z);
  joints.push(['l','r'].map(side=>[point('c_thigh_twist.'+side).distanceTo(point('c_leg_stretch.'+side)),point('c_leg_stretch.'+side).distanceTo(point('foot.'+side))]));
  if(i%Math.max(1,Math.floor((data.frames.length-1)/12))===0)window.shots.push({name:slug+'-'+id+'-'+i,data:a.canvas.toDataURL()});
 }
 const range=v=>Math.max(...v)-Math.min(...v),leg=joints[0][0].reduce((x,y)=>x+y,0);
 const metrics={minFootGap:Math.min(...gap),footLiftL:range(heightL),footLiftR:range(heightR),depthRange:range(depth),depthRatio:Math.max(...depth.map(Math.abs))/Math.min(...depth.map(Math.abs)),legLength:leg,viewRatio:Math.max(...views)/Math.min(...views)};
 if(metrics.viewRatio>1.001)throw Error('Motion framing changes scale: '+slug+' '+JSON.stringify(metrics));
 for(let side=0;side<2;side++)for(let segment=0;segment<2;segment++){const lengths=joints.map(j=>j[side][segment]);if(range(lengths)>leg*.005)throw Error('Leg length changed: '+slug+' '+id);}
 if(id==='360-power-spin-jump'){if(metrics.depthRatio>1.15)throw Error('Spin moves into camera: '+slug+' '+JSON.stringify(metrics));}
 else {if(metrics.minFootGap<leg*.06)throw Error('Feet collapse together: '+slug+' '+JSON.stringify(metrics));if(id==='boxing-warm-up'&&Math.min(metrics.footLiftL,metrics.footLiftR)<leg*.06)throw Error('Boxing feet pinned: '+slug);if(id==='happy-sway-standing'&&Math.max(metrics.footLiftL,metrics.footLiftR)<leg*.02)throw Error('Sway heel articulation lost: '+slug);}
 result[slug+'-'+id].support=metrics;

 }
 a.dispose();}
return result;})()`);fs.writeFileSync(out+'/all-five-info.json',JSON.stringify(result));for(const shot of await w.webContents.executeJavaScript('shots'))fs.writeFileSync(out+'/'+shot.name+'.png',Buffer.from(shot.data.split(',')[1],'base64'));console.log('All five characters: continuous spin depth, leg lengths, foot separation, lifts and heel articulation passed.');}catch(e){console.error(e);process.exitCode=1;}finally{server.close();app.exit(process.exitCode||0);}});
