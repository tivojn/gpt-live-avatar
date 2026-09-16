import * as THREE from '/vendor/three/three.module.js';

// Preserve-volume armatures use dual-quaternion blending (Kavan et al., 2008).
// Keep affine/stretching bones on the existing matrix path. CPU vertex queries
// use the same deformation as the GPU, including frame and hit-test bounds.
const functions=`
#if defined(USE_SKINNING) && defined(AVATAR_DQ_SKIN)
#ifdef AVATAR_DQ_ARM_ONLY
attribute float avatarVolumeWeight;
#endif
bool avatarRigid(mat4 m){
 vec3 x=m[0].xyz,y=m[1].xyz,z=m[2].xyz;
 return abs(dot(x,x)-1.)<.002&&abs(dot(y,y)-1.)<.002&&abs(dot(z,z)-1.)<.002
  &&abs(dot(x,y))<.002&&abs(dot(x,z))<.002&&abs(dot(y,z))<.002&&dot(cross(x,y),z)>0.;
}
vec4 avatarQuaternion(mat4 m){
 float t=m[0][0]+m[1][1]+m[2][2],s;vec4 q;
 if(t>0.){s=2.*sqrt(1.+t);q=vec4((m[1][2]-m[2][1])/s,(m[2][0]-m[0][2])/s,(m[0][1]-m[1][0])/s,s*.25);}
 else if(m[0][0]>m[1][1]&&m[0][0]>m[2][2]){s=2.*sqrt(1.+m[0][0]-m[1][1]-m[2][2]);q=vec4(s*.25,(m[1][0]+m[0][1])/s,(m[2][0]+m[0][2])/s,(m[1][2]-m[2][1])/s);}
 else if(m[1][1]>m[2][2]){s=2.*sqrt(1.+m[1][1]-m[0][0]-m[2][2]);q=vec4((m[1][0]+m[0][1])/s,s*.25,(m[2][1]+m[1][2])/s,(m[2][0]-m[0][2])/s);}
 else{s=2.*sqrt(1.+m[2][2]-m[0][0]-m[1][1]);q=vec4((m[2][0]+m[0][2])/s,(m[2][1]+m[1][2])/s,s*.25,(m[0][1]-m[1][0])/s);}
 return normalize(q);
}
vec4 avatarDual(vec4 q,vec3 t){return .5*vec4(q.w*t+cross(t,q.xyz),-dot(t,q.xyz));}
vec3 avatarRotate(vec4 q,vec3 p){return p+2.*cross(q.xyz,cross(q.xyz,p)+q.w*p);}
#endif
`;
function shaders(){
 if(THREE.ShaderChunk.avatar_dq_ready)return;
 THREE.ShaderChunk.avatar_dq_ready=true;
 THREE.ShaderChunk.skinning_pars_vertex+=functions;
 THREE.ShaderChunk.skinbase_vertex+=`
#if defined(USE_SKINNING) && defined(AVATAR_DQ_SKIN)
 bool avatarUseDQ=(skinWeight.x==0.||avatarRigid(boneMatX))&&(skinWeight.y==0.||avatarRigid(boneMatY))
  &&(skinWeight.z==0.||avatarRigid(boneMatZ))&&(skinWeight.w==0.||avatarRigid(boneMatW));
 #ifdef AVATAR_DQ_ARM_ONLY
 avatarUseDQ=avatarUseDQ&&avatarVolumeWeight>0.;
 #endif
 vec4 avatarReal=vec4(0.,0.,0.,1.),avatarD=vec4(0.);
 if(avatarUseDQ){
  vec4 qx=avatarQuaternion(boneMatX),qy=avatarQuaternion(boneMatY),qz=avatarQuaternion(boneMatZ),qw=avatarQuaternion(boneMatW);
  vec4 ref=qx;float weight=skinWeight.x;
  if(skinWeight.y>weight){ref=qy;weight=skinWeight.y;}if(skinWeight.z>weight){ref=qz;weight=skinWeight.z;}if(skinWeight.w>weight)ref=qw;
  qx*=dot(ref,qx)<-0.000001?-1.:1.;qy*=dot(ref,qy)<-0.000001?-1.:1.;qz*=dot(ref,qz)<-0.000001?-1.:1.;qw*=dot(ref,qw)<-0.000001?-1.:1.;
  avatarReal=qx*skinWeight.x+qy*skinWeight.y+qz*skinWeight.z+qw*skinWeight.w;
  avatarD=avatarDual(qx,boneMatX[3].xyz)*skinWeight.x+avatarDual(qy,boneMatY[3].xyz)*skinWeight.y
   +avatarDual(qz,boneMatZ[3].xyz)*skinWeight.z+avatarDual(qw,boneMatW[3].xyz)*skinWeight.w;
  float lengthQ=max(length(avatarReal),.000001);avatarReal/=lengthQ;avatarD/=lengthQ;
  avatarD-=avatarReal*dot(avatarReal,avatarD);
 }
#endif`;
 for(const [chunk,dq] of Object.entries({
  skinning_vertex:`vec3 p=(bindMatrix*vec4(transformed,1.)).xyz;
   vec3 t=2.*(avatarReal.w*avatarD.xyz-avatarD.w*avatarReal.xyz+cross(avatarReal.xyz,avatarD.xyz));
   transformed=(bindMatrixInverse*vec4(avatarRotate(avatarReal,p)+t,1.)).xyz;`,
  skinnormal_vertex:`objectNormal=mat3(bindMatrixInverse)*avatarRotate(avatarReal,mat3(bindMatrix)*objectNormal);
   #ifdef USE_TANGENT
    objectTangent=mat3(bindMatrixInverse)*avatarRotate(avatarReal,mat3(bindMatrix)*objectTangent);
   #endif`,
 })){
  const old=THREE.ShaderChunk[chunk];
  const source=chunk==='skinning_vertex'?'vec3 avatarSource=transformed;':'vec3 avatarSource=objectNormal;\n#ifdef USE_TANGENT\nvec3 avatarSourceTangent=objectTangent;\n#endif';
  const matrix=chunk==='skinning_vertex'?'vec3 avatarMatrix=transformed;transformed=avatarSource;':'vec3 avatarMatrix=objectNormal;objectNormal=avatarSource;\n#ifdef USE_TANGENT\nvec3 avatarMatrixTangent=objectTangent;objectTangent=avatarSourceTangent;\n#endif';
  const mix=chunk==='skinning_vertex'?'transformed=mix(avatarMatrix,transformed,avatarVolumeWeight);':'objectNormal=mix(avatarMatrix,objectNormal,avatarVolumeWeight);\n#ifdef USE_TANGENT\nobjectTangent=mix(avatarMatrixTangent,objectTangent,avatarVolumeWeight);\n#endif';
  const masked=`${source}\n${old}\n${matrix}\n${dq}\n${mix}`;
  THREE.ShaderChunk[chunk]=`#if defined(USE_SKINNING) && defined(AVATAR_DQ_SKIN)\nif(avatarUseDQ){\n#ifdef AVATAR_DQ_ARM_ONLY\nif(avatarVolumeWeight<1.){\n${masked}\n}else{\n${dq}\n}\n#else\n${dq}\n#endif\n}else{\n${old}\n}\n#else\n${old}\n#endif`;
 }
}
function rigid(m){
 const a=m.elements,x=new THREE.Vector3(a[0],a[1],a[2]),y=new THREE.Vector3(a[4],a[5],a[6]),z=new THREE.Vector3(a[8],a[9],a[10]);
 return Math.abs(x.lengthSq()-1)<.002&&Math.abs(y.lengthSq()-1)<.002&&Math.abs(z.lengthSq()-1)<.002
  &&Math.abs(x.dot(y))<.002&&Math.abs(x.dot(z))<.002&&Math.abs(y.dot(z))<.002&&x.cross(y).dot(z)>0;
}
export class AvatarVolumeSkin {
 constructor(avatar,names=[],{armOnly=false}={}){
  this.avatar=avatar;this.names=new Set(names);this.meshes=[];this.depths=[];this.armOnly=armOnly;this.geometries=new WeakMap();
  this.armBones=new Set(['upperArm','lowerArm','hand','finger'].flatMap(key=>Object.values(avatar.boneGroups?.[key]||{}).flat()));
  shaders();
  avatar.model.traverse(node=>{if(this.names.has(node.userData.sourceName))this.bind(node);});
 }
 bind(node){
  if(!node.isSkinnedMesh||node.userData.avatarPreserveVolume)return;
  node.userData.avatarPreserveVolume=true;this.meshes.push(node);
  const defines={AVATAR_DQ_SKIN:1,...(this.armOnly?{AVATAR_DQ_ARM_ONLY:1}:{})};
  for(const m of Array.isArray(node.material)?node.material:[node.material]){m.defines={...m.defines,...defines};m.needsUpdate=true;}
  this.prepareGeometry(node);
  const original=node.applyBoneTransform,m=new THREE.Matrix4(),q=new THREE.Quaternion(),t=new THREE.Vector3(),cross=new THREE.Vector3(),real=new THREE.Vector4(),dual=new THREE.Vector4();
  const owner=this,linear=new THREE.Vector3();
  const rotations=Array.from({length:4},()=>new THREE.Quaternion()),translations=Array.from({length:4},()=>new THREE.Vector3());
  node.applyBoneTransform=function(index,target){
   const indices=this.geometry.attributes.skinIndex,weights=this.geometry.attributes.skinWeight;if(!indices||!weights)return original.call(this,index,target);
   const gain=owner.armOnly?owner.prepareGeometry(this).getX(index):1;
   if(gain<=0)return original.call(this,index,target);
   if(gain<1)original.call(this,index,linear.copy(target));
   let reference=0,maxWeight=-1;
   for(let i=0;i<4;i++){
    const weight=weights.getComponent(index,i),j=indices.getComponent(index,i);
    m.multiplyMatrices(this.skeleton.bones[j].matrixWorld,this.skeleton.boneInverses[j]);
    if(weight>0&&!rigid(m))return original.call(this,index,target);
    rotations[i].setFromRotationMatrix(m).normalize();translations[i].setFromMatrixPosition(m);
    if(weight>maxWeight){reference=i;maxWeight=weight;}
   }
   real.set(0,0,0,0);dual.set(0,0,0,0);
   for(let i=0;i<4;i++){
    q.copy(rotations[i]);const weight=weights.getComponent(index,i)*(q.dot(rotations[reference])<-.000001?-1:1);t.copy(translations[i]);cross.set(q.x,q.y,q.z);const dot=t.dot(cross);cross.crossVectors(t,cross);
    real.x+=q.x*weight;real.y+=q.y*weight;real.z+=q.z*weight;real.w+=q.w*weight;
    dual.x+=.5*(q.w*t.x+cross.x)*weight;dual.y+=.5*(q.w*t.y+cross.y)*weight;dual.z+=.5*(q.w*t.z+cross.z)*weight;dual.w-=.5*dot*weight;
   }
   const length=Math.max(real.length(),.000001);real.divideScalar(length);dual.divideScalar(length);const dot=real.dot(dual);dual.addScaledVector(real,-dot);
   cross.set(real.x,real.y,real.z).cross(new THREE.Vector3(dual.x,dual.y,dual.z));
   t.set(2*(real.w*dual.x-dual.w*real.x+cross.x),2*(real.w*dual.y-dual.w*real.y+cross.y),2*(real.w*dual.z-dual.w*real.z+cross.z));
   target.applyMatrix4(this.bindMatrix).applyQuaternion(q.set(real.x,real.y,real.z,real.w)).add(t).applyMatrix4(this.bindMatrixInverse);
   return gain<1?target.lerp(linear,1-gain):target;
  };
  if(!node.customDepthMaterial){node.customDepthMaterial=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});this.depths.push(node.customDepthMaterial);}
  node.customDepthMaterial.defines={...node.customDepthMaterial.defines,...defines};
 }
 prepareGeometry(node){
  if(!this.armOnly)return null;
  const g=node.geometry,weights=g.attributes.skinWeight,indices=g.attributes.skinIndex;
  if(this.geometries.get(node)===g)return g.getAttribute('avatarVolumeWeight');
  const values=new Float32Array(g.attributes.position?.count||0);
  if(weights&&indices)for(let i=0;i<values.length;i++){
   let weight=0;for(let k=0;k<4;k++)if(this.armBones.has(node.skeleton.bones[indices.getComponent(i,k)]))weight+=weights.getComponent(i,k);
   // Fade the correction at the shoulder seam; facial and torso vertices
   // without arm influence retain their original deformation exactly.
   values[i]=THREE.MathUtils.smoothstep(weight,0,.8);
  }
  const attribute=new THREE.Float32BufferAttribute(values,1);g.setAttribute('avatarVolumeWeight',attribute);this.geometries.set(node,g);return attribute;
 }
 beforeRender(){
  for(const node of this.meshes){
   this.prepareGeometry(node);
   if(node.customDepthMaterial&&!node.customDepthMaterial.defines?.AVATAR_DQ_SKIN){
    node.customDepthMaterial.defines={...node.customDepthMaterial.defines,AVATAR_DQ_SKIN:1,...(this.armOnly?{AVATAR_DQ_ARM_ONLY:1}:{})};node.customDepthMaterial.needsUpdate=true;
   }
  }
 }
 dispose(){for(const d of this.depths)d.dispose();}
}
