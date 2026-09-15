// Real WebGL captures and GPU-complete timings using the licensed local packs.
// The output remains in ignored build/; no source models are published.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),label=process.argv[2]||'current',out=root+'/build/qa-lighting-'+label,captureProfile=process.argv[3]||'balanced';
assert(['eco','balanced','quality'].includes(captureProfile));
fs.mkdirSync(out,{recursive:true});app.setPath('userData',out+'/profile');app.on('window-all-closed',()=>{});
const server=http.createServer((req,res)=>{
 const u=decodeURIComponent(req.url.split('?')[0]);if(u==='/'){res.setHeader('Content-Type','text/html');return res.end('<script type="module" src="/avatar3d.js"></script>');}
 const file=u.startsWith('/asset/')?root+'/build/characters/'+u.slice(7):root+'/web'+u;
 if(!fs.existsSync(file)&&fs.existsSync(file+'.deflate')){res.setHeader('Content-Type','application/json');return res.end(zlib.inflateRawSync(fs.readFileSync(file+'.deflate')));}
 if(!fs.existsSync(file)){res.statusCode=404;return res.end();}
 res.setHeader('Content-Type',({'.js':'text/javascript','.json':'application/json','.gltf':'model/gltf+json'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
});
app.whenReady().then(async()=>{const errors=[];try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const w=new BrowserWindow({show:false,width:1000,height:1000,webPreferences:{backgroundThrottling:false}});
 w.webContents.on('console-message',d=>{if(d.level==='error')errors.push(d.message);});
 await w.loadURL('http://127.0.0.1:'+server.address().port);
 const looks=require('../electron/default-appearance.json'),results=[];
 for(const slug of ['tia','sarah','iselda','ming-mei','seraphim']){
 const result=await w.webContents.executeJavaScript(`(async()=>{
 while(!window.OpenClamAvatar3D)await new Promise(r=>setTimeout(r,20));
 const T=await import('/vendor/three/three.module.js'),a=OpenClamAvatar3D.create({width:560,height:820});
 window.lightingAvatar=a;window.lightingShots=[];
 await a.load('/asset/${slug}/runtime/resident/model.gltf',{resources:true,performance:'balanced',appearanceLibrary:'/asset/${slug}/appearance/index.json'});
 a.options.select({...${JSON.stringify(looks[slug])},prop:'none',hands:'none',leftHand:'none',rightHand:'none',performance:${JSON.stringify(captureProfile)},playTransitions:'false',expression:'neutral'});
 a.options.playback=[];if(a.options.transition){a.options.current=a.options.transition.target;a.options.transition=null;}a.options.write(a.options.current);
 await a.resources.update(${JSON.stringify(captureProfile)},1500,true);await a.appearance.pending;
 const state={projectedHeight:1500,reduce:true,bodyMotion:false};
 const capture=(name)=>{a.render(5000,state);lightingShots.push({name,data:a.canvas.toDataURL()});};
 const views=[];
 for(const [name,yaw,pitch] of [['front',0,0],['high',.55,.55],['left',-1.1,.12],['back',Math.PI,0]]){
 a.setOrbit({yaw,pitch});for(let j=0;j<8;j++){await a.resources.pending;a.render(5000,state);}
 capture(name);const head=a.bones.head.getWorldPosition(new T.Vector3());head.y+=a.headRadius*.9;
 const c=a.project(head),size=a.headRadius*3.6*a.height*a.camera.projectionMatrix.elements[5]/(2*a.camera.position.distanceTo(head));
 a.render(5000,state,{x:c.x-size*.62,y:c.y-size*.62,w:size*1.24,h:size*1.24,pixelWidth:520,pixelHeight:520});
 lightingShots.push({name:name+'-face',data:a.canvas.toDataURL()});
 const p=a.appearance.portrait;
 if(p.portraitLights.quaternion.angleTo(a.camera.quaternion)>1e-6)throw Error('Studio lights lost camera alignment');
 if(p.portraitLights.children.length!==4)throw Error('Unexpected extra studio lights');
 views.push({name,profile:p.profile,exposure:a.renderer.toneMappingExposure});
 }
 const timing={};for(const profile of ['eco','balanced','quality']){
 a.options.select({...a.options.selection,performance:profile});await a.resources.update(profile,1500,true);await a.resources.pending;
 a.resize(320,600);const gl=a.renderer.getContext(),times=[];
 for(let i=0;i<42;i++){const start=performance.now();a.setOrbit({yaw:Math.sin(i*.04)*.6,pitch:.12});a.render(5000,state);gl.finish();if(i>7)times.push(performance.now()-start);await new Promise(r=>setTimeout(r,8));}
 times.sort((x,y)=>x-y);timing[profile]={median:times[Math.floor(times.length*.5)],p95:times[Math.floor(times.length*.95)],glError:gl.getError(),textures:a.renderer.info.memory.textures,effects:a.appearance.portrait.diffusion.effects};
 }
 const p=a.appearance.portrait;for(const style of ['classic','soft','studio']){a.options.select({...a.options.selection,lighting:style});a.render(5000,state);if(style==='classic'&&p.portraitLights.visible)throw Error('Classic did not restore');}
 return {slug:${JSON.stringify(slug)},views,timing};})()`);
 for(const shot of await w.webContents.executeJavaScript('lightingShots'))fs.writeFileSync(out+'/'+slug+'-'+shot.name+'.png',Buffer.from(shot.data.split(',')[1],'base64'));
 await w.webContents.executeJavaScript('lightingAvatar.dispose();');
 for(const time of Object.values(result.timing))assert.equal(time.glError,0);
 results.push(result);console.log(JSON.stringify(result));
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(out+'/report.json',JSON.stringify({results,errors},null,2));
 }catch(e){console.error(e,errors);process.exitCode=1;}finally{server.close();app.exit(process.exitCode||0);}});
