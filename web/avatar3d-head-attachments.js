import * as THREE from '/vendor/three/three.module.js';

const nameOf=n=>n.userData.sourceName||n.name;
const descendsFrom=(node,parent)=>{for(let p=node;p;p=p.parent)if(p===parent)return true;return false;};

// These exports bake the author's hair constraints into each pose, but leave
// the hair spline roots beside the head in the skeleton. Carry only the
// additional procedural head transform across; keep the baked hair animation.
export class AvatarHeadAttachments {
 constructor(avatar){
  this.avatar=avatar;this.roots=[];this.applied=false;this.headBefore=new THREE.Matrix4();
  if(!['ming-mei','iselda'].includes(avatar.characterId)||!avatar.bones.head)return;
  const roots=new Set(),head=avatar.bones.head;
  avatar.model.traverse(mesh=>{
   if(!mesh.isSkinnedMesh||!/hair/i.test(nameOf(mesh)))return;
   const joints=mesh.geometry.attributes.skinIndex,weights=mesh.geometry.attributes.skinWeight;
   if(!joints||!weights)return;
   const used=new Set();
   for(let i=0;i<joints.count;i++)for(let j=0;j<4;j++)if(weights.getComponent(i,j)>1e-5)used.add(joints.getComponent(i,j));
   for(const index of used){
    let node=mesh.skeleton.bones[index];
    if(!node||!/^spline_/i.test(nameOf(node))||descendsFrom(node,head))continue;
    while(node.parent?.isBone&&/^spline_/i.test(nameOf(node.parent)))node=node.parent;
    roots.add(node);
   }
  });
  this.roots=[...roots].map(node=>({node,local:new THREE.Matrix4(),world:new THREE.Matrix4(),auto:node.matrixAutoUpdate}));
 }
 restore(){
  if(!this.applied)return;
  for(const r of this.roots){r.node.matrix.copy(r.local);r.node.matrixAutoUpdate=r.auto;r.node.matrixWorldNeedsUpdate=true;}
  this.applied=false;
 }
 capture(){
  if(!this.roots.length)return;
  this.headBefore.copy(this.avatar.bones.head.matrixWorld);
  for(const r of this.roots){r.local.copy(r.node.matrix);r.world.copy(r.node.matrixWorld);r.auto=r.node.matrixAutoUpdate;}
 }
 apply(){
  if(!this.roots.length)return;
  const delta=this.avatar.bones.head.matrixWorld.clone().multiply(this.headBefore.clone().invert());
  for(const r of this.roots){
   r.node.matrix.copy(r.node.parent.matrixWorld).invert().multiply(delta).multiply(r.world);
   r.node.matrixAutoUpdate=false;r.node.matrixWorldNeedsUpdate=true;
  }
  this.applied=true;this.avatar.root.updateMatrixWorld(true);
 }
 dispose(){this.restore();this.roots=[];}
}
