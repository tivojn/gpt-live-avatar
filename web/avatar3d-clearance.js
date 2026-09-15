import * as THREE from '/vendor/three/three.module.js';

// Garment contact is evaluated after skeletal deformation. Rest-space body
// cutouts cannot do this: a lifted skirt would expose the missing skin.
const declarations=`
#ifdef AVATAR_CLOTH_CLEARANCE
uniform vec4 avatarClothA[3],avatarClothB[3];
uniform mat4 avatarClothToModel,avatarClothFromModel;
attribute vec4 avatarClothAllowance;
vec3 avatarClothContact(vec3 p,vec4 allowance){
 vec3 original=p;
 for(int pass=0;pass<2;pass++)for(int i=0;i<3;i++){
  vec3 axis=avatarClothB[i].xyz-avatarClothA[i].xyz;
  float t=clamp(dot(p-avatarClothA[i].xyz,axis)/max(dot(axis,axis),.000001),0.,1.);
  vec3 delta=p-mix(avatarClothA[i].xyz,avatarClothB[i].xyz,t);
  float distance=length(delta),radius=max(0.,mix(avatarClothA[i].w,avatarClothB[i].w,t)-allowance[i]);
  if(distance<radius&&distance>.000001)p+=delta*(radius/distance-1.);
 }
 return mix(original,p,allowance.w);
}
#endif
`;
function installShaders(){
 if(THREE.ShaderChunk.avatar_cloth_ready)return;
 THREE.ShaderChunk.avatar_cloth_ready=true;
 THREE.ShaderChunk.skinning_pars_vertex+=declarations;
 THREE.ShaderChunk.project_vertex=`
#ifdef AVATAR_CLOTH_CLEARANCE
 transformed=(avatarClothFromModel*vec4(avatarClothContact((avatarClothToModel*vec4(transformed,1.)).xyz,avatarClothAllowance),1.)).xyz;
#endif\n`+THREE.ShaderChunk.project_vertex;
}
const materials=n=>Array.isArray(n.material)?n.material:[n.material];
export class AvatarClearance {
 constructor(avatar,config){
  this.avatar=avatar;this.config=config;this.records=[];this.depths=[];this.inverse=new THREE.Matrix4();
  this.a=Array.from({length:3},()=>new THREE.Vector4());this.b=this.a.map(()=>new THREE.Vector4());
  this.bones=new Map();avatar.model.updateMatrixWorld(true);
  avatar.model.traverse(n=>{if(n.isBone)this.bones.set(n.userData.sourceName||n.name,n);});
  this.rest=new Map([...this.bones].map(([name,n])=>[name,n.matrixWorld.clone().invert()]));
  installShaders();
  avatar.model.traverse(n=>{
   if(!n.isSkinnedMesh||!config.garments.includes(n.userData.sourceName))return;
   const uniforms={avatarClothA:{value:this.a},avatarClothB:{value:this.b},avatarClothToModel:{value:new THREE.Matrix4()},avatarClothFromModel:{value:new THREE.Matrix4()}};
   const bind=m=>{m.defines={...m.defines,AVATAR_CLOTH_CLEARANCE:1};const hook=m.onBeforeCompile,key=m.customProgramCacheKey;
    m.onBeforeCompile=(s,r)=>{hook.call(m,s,r);Object.assign(s.uniforms,uniforms);};m.customProgramCacheKey=()=>key.call(m)+'-cloth-contact-v2';m.needsUpdate=true;};
   n.material=Array.isArray(n.material)?n.material.map(m=>m.clone()):n.material.clone();materials(n).forEach(bind);
   const depth=n.customDepthMaterial?.clone()||new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});bind(depth);n.customDepthMaterial=depth;this.depths.push(depth);
   const original=n.getVertexPosition,owner=this;
   n.getVertexPosition=function(i,p){original.call(this,i,p);p.applyMatrix4(uniforms.avatarClothToModel.value);const attr=this.geometry.getAttribute('avatarClothAllowance');owner.contact(p,attr?new THREE.Vector4().fromBufferAttribute(attr,i):new THREE.Vector4());return p.applyMatrix4(uniforms.avatarClothFromModel.value);};
   this.records.push({node:n,uniforms,restToModel:avatar.model.matrixWorld.clone().invert().multiply(n.matrixWorld)});
  });
 }
 contact(p,allowance){
  const original=p.clone();
  const axis=new THREE.Vector3(),delta=new THREE.Vector3(),center=new THREE.Vector3();
  for(let pass=0;pass<2;pass++)for(let i=0;i<3;i++){
   const a=this.a[i],b=this.b[i];axis.set(b.x-a.x,b.y-a.y,b.z-a.z);delta.set(p.x-a.x,p.y-a.y,p.z-a.z);
   const t=THREE.MathUtils.clamp(delta.dot(axis)/Math.max(axis.lengthSq(),.000001),0,1);center.set(a.x,a.y,a.z).addScaledVector(axis,t);delta.subVectors(p,center);
   const distance=delta.length(),radius=Math.max(0,a.w+(b.w-a.w)*t-allowance.getComponent(i));if(distance<radius&&distance>.000001)p.addScaledVector(delta,radius/distance-1);
  }return p.lerp(original,1-allowance.w);
 }
 prepareGeometry(record){
  const g=record.node.geometry;if(g===record.geometry)return;record.geometry=g;
  const positions=g.attributes.position,values=new Float32Array(positions.count*4),p=new THREE.Vector3(),axis=new THREE.Vector3(),delta=new THREE.Vector3();
  const hipY=Math.max(...this.config.capsules.filter(c=>c.boneA!==c.boneB).map(c=>c.a[1]));
  for(let v=0;v<positions.count;v++){
   p.fromBufferAttribute(positions,v).applyMatrix4(record.restToModel);
   this.config.capsules.forEach((c,i)=>{axis.fromArray(c.b).sub(new THREE.Vector3(...c.a));delta.copy(p).sub(new THREE.Vector3(...c.a));const t=THREE.MathUtils.clamp(delta.dot(axis)/Math.max(axis.lengthSq(),.000001),0,1),distance=delta.addScaledVector(axis,-t).length();values[v*4+i]=Math.max(0,THREE.MathUtils.lerp(c.radiusA,c.radiusB,t)-distance);});
   // Waist and upper hips are fitted and already follow the body rig. Only
   // the free skirt below the hip joint needs a thigh contact correction.
   values[v*4+3]=1-THREE.MathUtils.smoothstep(p.y,hipY-.08,hipY+.015);
  }
  g.setAttribute('avatarClothAllowance',new THREE.Float32BufferAttribute(values,4));
 }
 moveGroup(group,pivot,rotation){
  const members=new Set(group),about=new THREE.Matrix4().makeTranslation(...pivot.toArray())
   .multiply(new THREE.Matrix4().makeRotationFromQuaternion(rotation)).multiply(new THREE.Matrix4().makeTranslation(-pivot.x,-pivot.y,-pivot.z));
  const roots=group.filter(n=>{for(let p=n.parent;p;p=p.parent)if(members.has(p))return false;return true;});
  const targets=roots.map(n=>about.clone().multiply(n.matrixWorld));
  roots.forEach((n,i)=>{n.matrix.copy(n.parent.matrixWorld).invert().multiply(targets[i]);n.matrix.decompose(n.position,n.quaternion,n.scale);n.matrixAutoUpdate=false;n.matrixWorldNeedsUpdate=true;});
  this.avatar.root.updateMatrixWorld(true);
 }
 hands(){
  const a=this.avatar,o=a.options,e=this.config.handEnvelope;
  if(!o||!e||o.heldProp()||!this.records.some(r=>r.node.visible))return;
  // Always start from the authored frame; collision corrections must not
  // accumulate when a standing pose is held for many animation frames.
  const arms=new Set(['upperArm','lowerArm','hand','finger'].flatMap(k=>Object.values(a.boneGroups[k]||{}).flat()));
  o.bones.forEach(({node},i)=>{if(!arms.has(node))return;const t=o.current[i];node.matrix.copy(t.m);node.matrix.decompose(node.position,node.quaternion,node.scale);node.matrixAutoUpdate=false;node.matrixWorldNeedsUpdate=true;});
  a.root.updateMatrixWorld(true);
  const hip=this.bones.get(e.bone),toRest=this.rest.get(e.bone).clone().invert().multiply(hip.matrixWorld.clone().invert()),fromRest=toRest.clone().invert();
  for(const side of ['l','r']){
   const upper=a.bones.upperArm[side],lower=a.bones.lowerArm[side],hand=a.bones.hand[side];if(!upper||!lower||!hand)continue;
   const position=n=>n.getWorldPosition(new THREE.Vector3()),original=position(hand),rotation=hand.getWorldQuaternion(new THREE.Quaternion());
   let correction=new THREE.Vector3();
   const fingers=(a.boneGroups.finger[side]||[]).filter(n=>/index|middle|ring|pinky/.test(n.userData.sourceName||n.name));
   const points=[original,...fingers.map(position)];
   for(const p of points){
    const local=p.clone().applyMatrix4(toRest);if(local.y<e.bottom-.018||local.y>e.top+.012)continue;
    const t=THREE.MathUtils.clamp((local.y-e.bottom)/(e.top-e.bottom),0,1),rx=THREE.MathUtils.lerp(e.radiusBottom[0],e.radiusTop[0],t)+.014,rz=THREE.MathUtils.lerp(e.radiusBottom[1],e.radiusTop[1],t)+.014;
    const x=local.x-e.centerXZ[0],z=local.z-e.centerXZ[1],d=Math.hypot(x/rx,z/rz);if(d>=1||d<.001)continue;
    const target=local.clone();target.x=e.centerXZ[0]+x/d;target.z=e.centerXZ[1]+z/d;target.applyMatrix4(fromRest).sub(p);
    if(target.lengthSq()>correction.lengthSq())correction=target;
   }
   if(correction.lengthSq()<1e-8)continue;
   const shoulder=position(upper),elbow=position(lower),target=original.clone().add(correction),l1=shoulder.distanceTo(elbow),l2=elbow.distanceTo(original);
   const direction=target.clone().sub(shoulder),distance=THREE.MathUtils.clamp(direction.length(),Math.abs(l1-l2)+.0001,l1+l2-.0001);direction.normalize();
   const x=(l1*l1-l2*l2+distance*distance)/(2*distance),y=Math.sqrt(Math.max(0,l1*l1-x*x));
   const bend=elbow.clone().sub(shoulder).addScaledVector(direction,-elbow.clone().sub(shoulder).dot(direction));
   if(bend.lengthSq()<1e-8)bend.set(side==='l'?1:-1,0,0);bend.normalize();
   const wantedElbow=shoulder.clone().addScaledVector(direction,x).addScaledVector(bend,y),wantedHand=shoulder.clone().addScaledVector(direction,distance);
   const group=k=>a.boneGroups[k][side]||[];
   this.moveGroup(['upperArm','lowerArm','hand','finger'].flatMap(group),shoulder,new THREE.Quaternion().setFromUnitVectors(elbow.sub(shoulder).normalize(),wantedElbow.clone().sub(shoulder).normalize()));
   const pivot=position(lower);
   this.moveGroup(['lowerArm','hand','finger'].flatMap(group),pivot,new THREE.Quaternion().setFromUnitVectors(position(hand).sub(pivot).normalize(),wantedHand.sub(pivot).normalize()));
   this.moveGroup(['hand','finger'].flatMap(group),position(hand),rotation.multiply(hand.getWorldQuaternion(new THREE.Quaternion()).invert()));
  }
 }
 update(){
  const {avatar}=this;avatar.model.updateMatrixWorld(true);this.inverse.copy(avatar.model.matrixWorld).invert();
  const point=(bone,xyz)=>new THREE.Vector3(...xyz).applyMatrix4(this.rest.get(bone)).applyMatrix4(this.bones.get(bone).matrixWorld).applyMatrix4(this.inverse);
  for(let i=0;i<this.config.capsules.length;i++){
   const c=this.config.capsules[i],a=point(c.boneA,c.a),b=point(c.boneB,c.b);
   // A collider whose two endpoints share the pelvis cannot model a joint.
   // It inflated the already fitted waist/butt into its coarse spherical
   // envelope. Keep contacts on articulated thighs, preserving the source hip.
   if(c.boneA===c.boneB){this.a[i].set(0,0,0,0);this.b[i].set(0,0,0,0);continue;}
   this.a[i].set(a.x,a.y,a.z,c.radiusA);this.b[i].set(b.x,b.y,b.z,c.radiusB);
  }
  for(const record of this.records){this.prepareGeometry(record);const {node,uniforms}=record;uniforms.avatarClothToModel.value.multiplyMatrices(this.inverse,node.matrixWorld);uniforms.avatarClothFromModel.value.copy(uniforms.avatarClothToModel.value).invert();}
 }
 dispose(){for(const m of this.depths)m.dispose();}
}
