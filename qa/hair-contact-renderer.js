(async()=>{
while(!window.OpenClamAvatar3D)await new Promise(r=>setTimeout(r,20));const T=await import('/vendor/three/three.module.js');window.shots=[];
const a=OpenClamAvatar3D.create({width:900,height:900});await a.load('/asset/sarah/runtime/resident/model.gltf',{resources:true,pose:'rest',performance:'quality',appearanceLibrary:'/asset/sarah/appearance/index.json',motionLibrary:'/asset/sarah/runtime/motions/library.json'});await a.resources.update('quality',1600,true);a.options.select({outfit:'casual',prop:'none',hands:'none',leftHand:'none',rightHand:'none',playTransitions:'false',followCursor:'false'});a.options.playback=[];
const result={unified:!!a.appearance.portrait.unifiedHair,records:a.hairContact?.records.length,metrics:[]};
const shot=async(name,now,head=false,state={})=>{a.root.updateMatrixWorld(true);const center=(head?a.bones.head:a.bones.chest).getWorldPosition(new T.Vector3()).add(new T.Vector3(0,head?.12:-.07,0));a.camera.position.copy(center).add(new T.Vector3(.10,head?.10:.05,head?.7:1.8));a.camera.lookAt(center);a.camera.fov=35;a.camera.near=.01;a.camera.far=20;a.camera.updateProjectionMatrix();a.layoutCamera=null;a.render(now,{cameraFocus:false,audienceContact:false,bodyMotion:false,...state});await a.resources.pending;a.render(now,{cameraFocus:false,audienceContact:false,bodyMotion:false,...state});shots.push({name,data:a.canvas.toDataURL()});};
for(const id of ['gangnam-groove','shake-it-off-dance','boxing-practice','backflip']){const clip=await a.motion.prepare(id),duration=(clip.frames.length-1)/clip.fps;await a.motion.play(id,{now:1000,loop:true});a.motion.active.start=0;a.motion.active.bounds=null;
for(let f=0;f<10;f++){const now=1000+duration*(f+.2)/10*1000;a.prepareMotionFrame(now,false);await shot(id+'-'+f,now);}
a.motion.stop({immediate:true});}
a.options.select({...a.options.selection,body:'Ps007.stand'});a.options.playback=[];if(a.options.transition){a.options.current=a.options.transition.target;a.options.transition=null;}a.options.write(a.options.current);
for(const [label,pitch,yaw] of [['idle',0,0],['listening',-.35,.3],['bow',-.65,0]]){await shot('hair-'+label,70000,true,{head:{pitch,yaw}});await shot('torso-'+label,70000,false,{head:{pitch,yaw}});}
const h=a.hairContact;result.contact={maxScalpDisplacement:0,correctedVertices:0,maxCorrection:0,maxResidual:0};
if(h?.bands)for(const id of ['gangnam-groove','shake-it-off-dance','boxing-practice','backflip']){
 const clip=await a.motion.prepare(id),duration=(clip.frames.length-1)/clip.fps;await a.motion.play(id,{now:1000,loop:true});a.motion.active.start=0;
 for(let f=0;f<40;f++){
  const now=1000+duration*(f+.1)/40*1000;a.prepareMotionFrame(now,false);a.render(now,{cameraFocus:false,audienceContact:false,bodyMotion:false});
  for(const r of h.records){const n=r.node,at=n.geometry.getAttribute('avatarHairRest');n.skeleton.update();for(let i=0;i<at.count;i+=4){
   const raw=T.SkinnedMesh.prototype.getVertexPosition.call(n,i,new T.Vector3()).applyMatrix4(r.uniforms.avatarHairToModel.value),rest=new T.Vector4().fromBufferAttribute(at,i),fixed=h.contact(raw.clone(),rest),d=raw.distanceTo(fixed);
   if(rest.y>h.bands[5].x+.01)result.contact.maxScalpDisplacement=Math.max(result.contact.maxScalpDisplacement,d);
   if(d>1e-5)result.contact.correctedVertices++;result.contact.maxCorrection=Math.max(result.contact.maxCorrection,d);
   const q=fixed.clone().applyMatrix4(h.toRest);if(q.y>h.bands[0].x+.045&&q.y<h.bands[5].x-.04)result.contact.maxResidual=Math.max(result.contact.maxResidual,fixed.distanceTo(h.contact(fixed.clone(),rest)));
  }}
 }
 a.motion.stop({immediate:true});
}
// Run after the real hair rig has installed its production shader chunks.
const verifyHairGPU=(h,T)=>{
 const renderer=new T.WebGLRenderer(),scene=new T.Scene();renderer.setSize(1,1);
 const geometry=new T.BufferGeometry();
 geometry.setAttribute('position',new T.Float32BufferAttribute(new Float32Array(9),3));
 geometry.setAttribute('avatarHairRest',new T.Float32BufferAttribute(new Float32Array(12),4));
 geometry.setAttribute('pixel',new T.Float32BufferAttribute([-1,-1,3,-1,-1,3],2));
 const material=new T.ShaderMaterial({defines:{AVATAR_HAIR_CONTACT:1},uniforms:h.records[0].uniforms,
  vertexShader:'attribute vec2 pixel;varying vec3 result;\n#include <skinning_pars_vertex>\nvoid main(){result=avatarHairContact(position,avatarHairRest);gl_Position=vec4(pixel,0.,1.);}',
  fragmentShader:'varying vec3 result;void main(){gl_FragColor=vec4(result,1.);}',toneMapped:false});
 const mesh=new T.Mesh(geometry,material);mesh.frustumCulled=false;scene.add(mesh);
 const target=new T.WebGLRenderTarget(1,1,{type:T.FloatType,format:T.RGBAFormat,depthBuffer:false});
 const output=new Float32Array(4),camera=new T.PerspectiveCamera(),cases=[];
 for(const side of [-1,1])for(const height of [h.bands[0].x-.1,h.bands[0].x+.02,h.bands[2].x,h.bands[5].x-.02,h.bands[5].x+.1]){
  const band=h.band(Math.max(h.bands[0].x,Math.min(h.bands[5].x,height))),raw=new T.Vector3(0,height,band.z-side*band.w*.8).applyMatrix4(h.fromRest),rest=new T.Vector4(0,height,band.z+side*band.w,side);
  for(let i=0;i<3;i++){geometry.attributes.position.setXYZ(i,...raw.toArray());geometry.attributes.avatarHairRest.setXYZW(i,...rest.toArray());}
  geometry.attributes.position.needsUpdate=true;geometry.attributes.avatarHairRest.needsUpdate=true;
  renderer.setRenderTarget(target);renderer.render(scene,camera);renderer.readRenderTargetPixels(target,0,0,1,1,output);
  const expected=h.contact(raw.clone(),rest),error=Math.max(...expected.toArray().map((v,i)=>Math.abs(v-output[i])));
  if(error>2e-5)throw Error('Hair CPU/GPU disagreement '+error);cases.push({side,height,error});
 }
 target.dispose();geometry.dispose();material.dispose();renderer.dispose();return cases;
};

result.gpuParity=verifyHairGPU(h,T);
result.shadowMaterials=a.appearance.portrait.meshes.filter(r=>r.hair).map(r=>({name:r.node.userData.sourceName,contact:!!r.shadow.defines?.AVATAR_HAIR_CONTACT}));result.glError=a.renderer.getContext().getError();a.dispose();return result;})();