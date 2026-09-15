// Requires licensed local build/characters packages; never uploads source models.
const {app,BrowserWindow}=require('electron'),fs=require('fs'),path=require('path'),http=require('http'),zlib=require('zlib');
const root=path.resolve(__dirname,'..'),out=root+'/build/qa-wardrobe-v12';fs.mkdirSync(out,{recursive:true});app.setPath('userData',out+'/profile');app.on('window-all-closed',()=>{});
const server=http.createServer((req,res)=>{const u=decodeURIComponent(req.url.split('?')[0]);if(u==='/'){res.setHeader('Content-Type','text/html');return res.end('<script type="module" src="/avatar3d.js"></script>');}const file=u.startsWith('/asset/')?root+'/build/characters/'+u.slice(7):u.startsWith('/audit/')?out+'/'+u.slice(7):root+'/web'+u;if(!fs.existsSync(file)&&fs.existsSync(file+'.deflate')){res.setHeader('Content-Type','application/json');return res.end(zlib.inflateRawSync(fs.readFileSync(file+'.deflate')));}if(!fs.existsSync(file)){res.statusCode=404;return res.end();}res.setHeader('Content-Type',({'.js':'text/javascript','.json':'application/json','.gltf':'model/gltf+json'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);});
app.whenReady().then(async()=>{try{await new Promise(r=>server.listen(0,'127.0.0.1',r));const w=new BrowserWindow({show:false,width:1200,height:1000,webPreferences:{backgroundThrottling:false}});await w.loadURL('http://127.0.0.1:'+server.address().port);const result=await w.webContents.executeJavaScript(`(async()=>{
 while(!window.OpenClamAvatar3D)await new Promise(r=>setTimeout(r,20));const T=await import('/vendor/three/three.module.js');
window.shots=[];const result={};
for(const slug of (location.hash?'sarah'.split(','):['seraphim','sarah'])){const a=OpenClamAvatar3D.create({width:640,height:900});await a.load('/asset/'+slug+'/runtime/resident/model.gltf',{resources:true,pose:'rest',performance:'balanced',appearanceLibrary:'/asset/'+slug+'/appearance/index.json',motionLibrary:'/asset/'+slug+'/runtime/motions/library.json'});await a.resources.update('balanced',1200,true);
 a.options.select({prop:'none',hands:'none',leftHand:'none',rightHand:'none',performance:'balanced',playTransitions:'false',body:'Ps001.heart'});a.options.playback=[];
 for(const outfit of slug==='seraphim'?['light-armor','heavy-armor','robot-armor','pilot']:['tactical','casual','summer']){
 a.options.select({...a.options.selection,outfit});if(a.options.transition){a.options.current=a.options.transition.target;a.options.transition=null;}a.options.write(a.options.current);
 for(const [index,yaw,pitch] of [[0,0,0],[1,1.15,.6],[2,-1.15,.6],[3,1.15,-.6],[4,-1.15,-.6],[5,Math.PI,0]]){a.setOrbit({yaw,pitch});await a.resources.update('balanced',1500,true);
 for(let j=0;j<8;j++){await a.resources.pending;a.render(1000+j*100,{projectedHeight:1500,audienceContact:true,cameraFocus:true,fitContent:true,bodyMotion:false});}
 window.shots.push({name:slug+'-'+outfit+'-'+index,data:a.canvas.toDataURL()});
 if(slug==='sarah'){const hip=a.options.bones.find(b=>b.name==='root.x').node.getWorldPosition(new T.Vector3()),c=a.project(hip);const view={x:c.x-120,y:c.y-145,w:240,h:290,pixelWidth:768,pixelHeight:928};a.render(1800,{projectedHeight:1500,audienceContact:true,cameraFocus:true,bodyMotion:false},view);window.shots.push({name:slug+'-'+outfit+'-'+index+'-fit',data:a.canvas.toDataURL()});}
 if(slug==='seraphim'&&['light-armor','heavy-armor','robot-armor'].includes(outfit)&&(a.smooth.headYaw!==0||a.smooth.headPitch!==0))throw Error('Head escapes helmet');
 }
 result[slug+'-'+outfit]={outfit};
 }
 a.dispose();}

return result;})()`);fs.writeFileSync(out+'/all-five-info.json',JSON.stringify(result));for(const shot of await w.webContents.executeJavaScript('shots'))fs.writeFileSync(out+'/'+shot.name+'.png',Buffer.from(shot.data.split(',')[1],'base64'));console.log('Wardrobe screenshots captured; helmet head alignment assertions passed. Review the captured images for clothing fit.');}catch(e){console.error(e);process.exitCode=1;}finally{server.close();app.exit(process.exitCode||0);}});
