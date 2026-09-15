// Run with Electron. Synthetic geometry only; no licensed assets required.
const {app,BrowserWindow}=require('electron'),fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert');
const root=path.resolve(__dirname,'..');app.setPath('userData',root+'/build/qa-cloth-occlusion/profile');
const server=http.createServer((req,res)=>{if(req.url==='/'){res.setHeader('Content-Type','text/html');return res.end('<html></html>');}const f=path.join(root,'web',req.url);res.setHeader('Content-Type','text/javascript');fs.createReadStream(f).on('error',()=>{res.statusCode=404;res.end();}).pipe(res);});
app.whenReady().then(async()=>{try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const w=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});await w.loadURL('http://127.0.0.1:'+server.address().port);
 const errors=[];w.webContents.on('console-message',(_e,...args)=>{if(args.join(' ').includes('Shader Error'))errors.push(args.join(' '));});
 const result=await w.webContents.executeJavaScript(`(async()=>{
 const T=await import('/vendor/three/three.module.js'),{AvatarClothOcclusion}=await import('/avatar3d-cloth-occlusion.js');
 const renderer=new T.WebGLRenderer({alpha:true,antialias:false});renderer.setSize(64,64);renderer.setClearColor(0,0);renderer.toneMapping=T.NoToneMapping;
 const scene=new T.Scene(),model=new T.Group();scene.add(model);const camera=new T.OrthographicCamera(-.15,.15,.15,-.15,.1,10);camera.position.set(0,1,2);camera.lookAt(0,1,0);
 function mesh(g,name,material){const count=g.attributes.position.count;g.setAttribute('skinIndex',new T.Uint16BufferAttribute(new Uint16Array(count*4),4));const weights=new Float32Array(count*4);for(let i=0;i<count;i++)weights[i*4]=1;g.setAttribute('skinWeight',new T.Float32BufferAttribute(weights,4));const n=new T.SkinnedMesh(g,material),bone=new T.Bone();n.add(bone);n.bind(new T.Skeleton([bone]));n.userData.sourceName=name;model.add(n);return n;}
 const skin=new T.MeshBasicMaterial({color:0x00ff00});skin.name='Top_Sara01A_M.001';const body=mesh(new T.BoxGeometry(.18,.16,.1).translate(0,1,0),'body',skin);
 const cloth=mesh(new T.PlaneGeometry(.14,.14).translate(0,1,.04),'Fem-A_Bot_Ac_BknBrzl_1',new T.MeshBasicMaterial({color:0xff0000,side:T.DoubleSide}));
 const mask=new AvatarClothOcclusion({characterId:'sarah',model,scene,renderer,camera});
 function pixel(correct=true){model.updateMatrixWorld(true);if(correct)mask.beforeRender();else mask.enabled.value=false;renderer.render(scene,camera);const p=new Uint8Array(4);renderer.getContext().readPixels(32,32,1,1,renderer.getContext().RGBA,renderer.getContext().UNSIGNED_BYTE,p);return [...p];}
 const before=pixel(false),corrected=pixel();cloth.position.z=-.15;const distant=pixel();cloth.position.z=0;cloth.visible=false;const hidden=pixel();cloth.visible=true;
 const hand=mesh(new T.BoxGeometry(.05,.05,.02).translate(.6,1,.04),'body',skin);hand.position.x=-.6;const foreground=pixel();hand.visible=false;
 const depth=mask.target.texture.type===T.FloatType;mask.dispose();renderer.dispose();return {before,corrected,distant,hidden,foreground,depth};})()`);
 assert(result.before[1]>240&&result.before[0]<10,'Fixture must reproduce skin clipping');assert(result.corrected[0]>240&&result.corrected[1]<10,'Nearby garment must cover intersecting skin');
 for(const name of ['distant','hidden','foreground'])assert(result[name][1]>240&&result[name][0]<10,name+' must retain visible skin');assert(result.depth);assert.deepEqual(errors,[]);console.log('Garment depth correction, distant surfaces, outfit removal and foreground body bounds passed.',result);
 }catch(e){console.error(e);process.exitCode=1;}finally{server.close();app.exit(process.exitCode||0);}});
