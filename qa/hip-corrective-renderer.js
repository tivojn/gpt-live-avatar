// Browser fixture for the isolated Electron renderer QA harness.
(async()=>{
 while(!window.OpenClamAvatar3D)await new Promise(r=>setTimeout(r,20));
 const T=await import('/vendor/three/three.module.js');
 const assert=(ok,message)=>{if(!ok)throw Error(message);};
 const result={characters:[],gpuSamples:0,maxGPUError:0,maxBriefBodyError:0,maxUpdateMs:0};
 const save=async(a,name)=>{a.renderer.render(a.scene,a.camera);await fetch('/capture/'+name+'.png',{method:'POST',body:await(await fetch(a.canvas.toDataURL())).blob()});};
 function gpuCheck(a,node,index){
  const g=new T.BufferGeometry();
  for(const name of ['position','skinIndex','skinWeight','avatarHipOffset','avatarHipRotation','avatarVolumeWeight']){
   const attribute=node.geometry.getAttribute(name);if(!attribute)continue;const values=[];
   for(let i=0;i<3;i++)for(let k=0;k<attribute.itemSize;k++)values.push(attribute.getComponent(index,k));
   g.setAttribute(name,new (name==='skinIndex'?T.Uint16BufferAttribute:T.Float32BufferAttribute)(values,attribute.itemSize));
  }
  g.setAttribute('pixel',new T.Float32BufferAttribute([-1,-1,3,-1,-1,3],2));
  const source=Array.isArray(node.material)?node.material[0]:node.material;
  const defines=Object.fromEntries(Object.entries(source.defines||{}).filter(([key])=>['AVATAR_DQ_SKIN','AVATAR_DQ_ARM_ONLY','AVATAR_HIP_CORRECTIVE'].includes(key)));
  const m=new T.ShaderMaterial({defines,uniforms:a.hipCorrective.uniforms,
   vertexShader:'attribute vec2 pixel;varying vec3 result;\n#include <skinning_pars_vertex>\nvoid main(){vec3 transformed=position;\n#include <skinbase_vertex>\n#include <skinning_vertex>\nresult=transformed;gl_Position=vec4(pixel,0.,1.);}',
   fragmentShader:'varying vec3 result;void main(){gl_FragColor=vec4(result,1.);}',toneMapped:false});
  const mesh=new T.SkinnedMesh(g,m);mesh.skeleton=node.skeleton;mesh.bindMatrix.copy(node.bindMatrix);mesh.bindMatrixInverse.copy(node.bindMatrixInverse);mesh.frustumCulled=false;
  // Preserve both of the subject's actual bind uniforms in this diagnostic draw.
  mesh.updateMatrixWorld=T.Object3D.prototype.updateMatrixWorld;
  const scene=new T.Scene();scene.add(mesh);const target=new T.WebGLRenderTarget(1,1,{type:T.FloatType,format:T.RGBAFormat,depthBuffer:false});
  const renderer=a.renderer,prior=renderer.getRenderTarget(),pixel=new Float32Array(4);
  renderer.setRenderTarget(target);renderer.render(scene,new T.PerspectiveCamera());renderer.readRenderTargetPixels(target,0,0,1,1,pixel);renderer.setRenderTarget(prior);
  const cpu=node.getVertexPosition(index,new T.Vector3()),error=cpu.distanceTo(new T.Vector3(...pixel.slice(0,3)));
  result.gpuSamples++;result.maxGPUError=Math.max(result.maxGPUError,error);assert(error<5e-6,'CPU/GPU disagreement '+error);
  g.dispose();m.dispose();target.dispose();
 }
 for(const slug of ['seraphim','sarah']){
  const a=OpenClamAvatar3D.create({width:900,height:900});
  await a.load('/asset/'+slug+'/runtime/resident/model.gltf',{resources:true,pose:'rest',performance:'balanced',appearanceLibrary:'/asset/'+slug+'/appearance/index.json',motionLibrary:'/asset/'+slug+'/runtime/motions/library.json'});
  a.options.select({outfit:slug==='sarah'?'summer':'pilot',prop:'none',hands:'none',leftHand:'none',rightHand:'none',performance:'balanced',lighting:'studio',playTransitions:'false'});a.options.playback=[];a.options.transition=null;a.options.nextPlaybackAt=1e12;
  await a.resources.update('balanced',1200,true);await a.resources.pending;
  a.scene.background=new T.Color('#e1e3e4');
  const motion=await a.motion.prepare('kung-fu-punch'),helper=a.hipCorrective;
  assert(helper?.data,'Missing corrective data');helper.beforeRender();
  const sourceFrames=JSON.stringify(motion.frames.map(f=>Array.from(f)));
  const originals=new Map(helper.meshes.map(n=>[n.geometry,['position','skinIndex','skinWeight'].map(k=>Array.from(n.geometry.attributes[k].array))]));
  const poseAt=f=>{const pose=a.motion.frame(motion,f);a.options.current=pose;a.options.write(pose);};
  a.options.write(a.options.bones.map(b=>b.rest));helper.beforeRender();assert(helper.uniforms.avatarHipGain.value===0,'Rest pose changed');
  let previous=0,maxStep=0;const gains=[];
  for(let f=0;f<motion.frames.length;f++){
   poseAt(f);const before=a.options.bones.map(b=>b.node.matrix.elements.slice());const start=performance.now();helper.beforeRender();result.maxUpdateMs=Math.max(result.maxUpdateMs,performance.now()-start);
   assert(JSON.stringify(before)===JSON.stringify(a.options.bones.map(b=>b.node.matrix.elements.slice())),'Corrective changed skeleton');
   const gain=helper.uniforms.avatarHipGain.value;gains.push(gain);maxStep=Math.max(maxStep,Math.abs(gain-previous));previous=gain;
  }
  assert(previous>.999,'Ending correction inactive');
  assert(maxStep<.35,'Abrupt corrective activation '+maxStep);
  const targets=helper.meshes.filter(n=>n.visible&&helper.prepareGeometry(n).count);
  for(const node of targets){const s=node.geometry.attributes.avatarHipOffset,ids=[];for(let i=0;i<s.count;i++)if(Math.hypot(s.getX(i),s.getY(i),s.getZ(i))>.002)ids.push(i);
   for(const i of [ids[0],ids[Math.floor(ids.length/2)],ids.at(-1)].filter(i=>i!==undefined))gpuCheck(a,node,i);
  }
  if(slug==='sarah'){
   const body=targets.find(n=>n.userData.sourceName==='Fem-A__Whl_BY_Sarah.export'),brief=targets.find(n=>n.userData.sourceName==='Fem-A_Bot_Ac_BknBrzl_1');
   const key=(p,i)=>[p.getX(i),p.getY(i),p.getZ(i)].map(x=>x.toFixed(6)).join(',');const lookup=new Map(),bp=body.geometry.attributes.position,cp=brief.geometry.attributes.position;
   for(let i=0;i<bp.count;i++)lookup.set(key(bp,i),i);
   for(let i=0;i<cp.count;i++){const j=lookup.get(key(cp,i));assert(j!==undefined,'Brief/body correspondence missing');
    const error=body.getVertexPosition(j,new T.Vector3()).applyMatrix4(body.matrixWorld).distanceTo(brief.getVertexPosition(i,new T.Vector3()).applyMatrix4(brief.matrixWorld));result.maxBriefBodyError=Math.max(result.maxBriefBodyError,error);assert(error<3e-6,'Clothing separation '+error);
   }
  }
  for(const f of [185,195,205,215,219]){
   poseAt(f);a.setOrbit({yaw:.5,pitch:0});a.render(5000,{bodyMotion:false,cameraFocus:false,audienceContact:false,fitContent:true});await a.resources.pending;poseAt(f);a.render(5000,{bodyMotion:false,cameraFocus:false,audienceContact:false,fitContent:true});await save(a,slug+'-frame-'+f);
  }
  for(const [view,yaw]of [['back',0],['threequarter',.5],['front',Math.PI],['side',Math.PI/2]]){
   poseAt(219);a.setOrbit({yaw,pitch:0});a.render(5000,{bodyMotion:false,cameraFocus:false,audienceContact:false,fitContent:true});
   a.camera.clearViewOffset();a.camera.updateProjectionMatrix();const hip=helper.root.getWorldPosition(new T.Vector3()),c=a.project(hip);
   a.render(5000,{bodyMotion:false,cameraFocus:false,audienceContact:false},{x:c.x-150,y:c.y-100,w:300,h:300,pixelWidth:900,pixelHeight:900});
   await save(a,slug+'-'+view+'-after');helper.uniforms.avatarHipGain.value=0;await save(a,slug+'-'+view+'-before');helper.update();
  }
  // Exercise streamed detail levels and restored neutral pose on the same avatar.
  for(const [quality,height]of [['friendly',400],['balanced',1200],['best',1800]]){
   await a.resources.update(quality,height,true);await a.resources.pending;poseAt(219);helper.beforeRender();a.renderer.render(a.scene,a.camera);assert(a.renderer.getContext().getError()===0,'Shader/LOD error '+quality);
   const node=helper.meshes.find(n=>n.visible&&helper.prepareGeometry(n).count);gpuCheck(a,node,Math.floor(node.geometry.attributes.position.count/2));
  }
  for(const [geometry,values]of originals)for(const [i,k]of ['position','skinIndex','skinWeight'].entries())assert(JSON.stringify(Array.from(geometry.attributes[k].array))===JSON.stringify(values[i]),'Authored geometry/weights changed');
  assert(JSON.stringify(motion.frames.map(f=>Array.from(f)))===sourceFrames,'Motion changed');
  a.options.write(a.options.bones.map(b=>b.rest));helper.beforeRender();assert(helper.uniforms.avatarHipGain.value===0,'Corrective left on at rest');
  result.characters.push({slug,frames:gains.length,maxActivationStep:maxStep,activeFrames:gains.filter(x=>x>0).length});a.dispose();console.log('Verified '+slug);
 }
 result.passed=true;return result;
})()
