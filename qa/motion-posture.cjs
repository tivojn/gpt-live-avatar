// Private renderer regression: original local models, revised local clips.
const {app,BrowserWindow}=require('electron');
const fs=require('fs'),path=require('path'),http=require('http'),zlib=require('zlib');
const root=path.resolve(__dirname,'..'),out=root+'/build/qa-motion-posture';
fs.mkdirSync(out,{recursive:true});app.setPath('userData',out+'/profile');app.on('window-all-closed',()=>{});
const server=http.createServer((req,res)=>{
 const u=decodeURIComponent(req.url.split('?')[0]);
 if(u==='/'){res.setHeader('Content-Type','text/html');return res.end('<script type="module" src="/avatar3d.js"></script>');}
 const file=u.startsWith('/asset/')?root+'/build/characters/'+u.slice(7):root+'/web'+u;
 if(!fs.existsSync(file)&&fs.existsSync(file+'.deflate')){res.setHeader('Content-Type','application/json');return res.end(zlib.inflateRawSync(fs.readFileSync(file+'.deflate')));}
 if(!fs.existsSync(file)){res.statusCode=404;return res.end();}
 res.setHeader('Content-Type',({'.js':'text/javascript','.json':'application/json','.gltf':'model/gltf+json'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
});
app.whenReady().then(async()=>{try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const w=new BrowserWindow({show:false,width:1000,height:1000,webPreferences:{backgroundThrottling:false}});
 const errors=[];w.webContents.on('console-message',event=>{if(event.level==='error'||event.level>=3)errors.push(event.message);});
 await w.loadURL('http://127.0.0.1:'+server.address().port);
 const result=await w.webContents.executeJavaScript(`(async()=>{
  while(!window.OpenClamAvatar3D)await new Promise(r=>setTimeout(r,20));
  const T=await import('/vendor/three/three.module.js');window.shots=[];const result=[];
  for(const slug of ['tia','sarah','iselda','ming-mei','seraphim']){
   const a=OpenClamAvatar3D.create({width:540,height:800});
   await a.load('/asset/'+slug+'/runtime/resident/model.gltf',{resources:true,pose:'rest',performance:'balanced',appearanceLibrary:'/asset/'+slug+'/appearance/index.json',motionLibrary:'/asset/'+slug+'/runtime/motions/library.json'});
   await a.resources.update('balanced',1200,true);
   if(['ming-mei','iselda'].includes(slug)&&!a.headAttachments?.roots.length)throw Error(slug+' missing head/hair attachment correction');
   const outfit=slug==='seraphim'?'pilot':slug==='ming-mei'?'dress':a.options.selection.outfit;
   a.options.select({outfit,prop:'none',hands:'none',leftHand:'none',rightHand:'none',performance:'balanced',lighting:'studio',playTransitions:'false'});a.options.playback=[];
   a.setOrbit({yaw:Math.PI/2,pitch:0});
   for(const id of ['backflip','360-power-spin-jump','joyful-sway','boxing-warm-up','happy-jump-female','hello-run']){
    const data=await a.motion.prepare(id),duration=(data.frames.length-1)/data.fps;
    const start=1000,total=Math.ceil(duration*2*60);await a.motion.play(id,{now:start,loop:true});
    let minView=Infinity,maxView=0,maxHairError=0,rendered=0;
    for(let i=0;i<=total;i++){
     const now=start+i*1000/60;
     a.prepareMotionFrame(now,false);
     a.render(now,{cameraFocus:true,audienceContact:true,fitContent:true,stableFitContent:true,bodyMotion:false});
     if(i>30){minView=Math.min(minView,a.stableContentView?.view.w||a.width);maxView=Math.max(maxView,a.stableContentView?.view.w||a.width);}
     for(const r of a.headAttachments?.roots||[]){
      const delta=a.bones.head.matrixWorld.clone().multiply(a.headAttachments.headBefore.clone().invert());
      const expected=delta.multiply(r.world);
      maxHairError=Math.max(maxHairError,...expected.elements.map((n,j)=>Math.abs(n-r.node.matrixWorld.elements[j])));
     }
     if(i%30===0){
      for(const b of a.options.bones)if(!b.node.matrixWorld.elements.every(Number.isFinite))throw Error(slug+' '+id+' non-finite bone');
      if(a.renderer.getContext().getError()!==0)throw Error(slug+' '+id+' WebGL error');
     }
     const moment=Math.floor(duration*60);
     if([Math.floor(moment*.08),Math.floor(moment*.25),Math.floor(moment*.5),Math.floor(moment*.75)].includes(i))window.shots.push({name:slug+'-'+id+'-'+i,data:a.canvas.toDataURL()});
     rendered++;
    }
    if(maxView-minView>.001)throw Error(slug+' '+id+' changing camera fit '+(maxView-minView));
    if(maxHairError>.00001)throw Error(slug+' '+id+' hair drift '+maxHairError);
    result.push({slug,id,rendered,seconds:duration*2,viewWidthVariation:maxView-minView,maximumHairMatrixError:maxHairError,hairRoots:a.headAttachments?.roots.length||0});
    await a.motion.stop({now:start+total*1000/60});
   }
   a.dispose();
  }
  return result;
 })()`);
 fs.writeFileSync(out+'/results.json',JSON.stringify({checks:result,errors},null,2));
 if(errors.length)throw Error('Renderer reported errors: '+errors.join('; '));
 for(const shot of await w.webContents.executeJavaScript('shots'))fs.writeFileSync(out+'/'+shot.name+'.png',Buffer.from(shot.data.split(',')[1],'base64'));
 console.log('PASS',result.length,'continuous scenarios',result.reduce((s,x)=>s+x.rendered,0),'frames');
 }catch(e){console.error(e);process.exitCode=1;}finally{server.close();app.exit(process.exitCode||0);}});
