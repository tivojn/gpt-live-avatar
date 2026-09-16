import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
// Run with node qa/motion-drift.mjs. Optional module path tests a staged patch.
const root=process.env.GLA_REPO||path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const modulePath=process.argv[2]||path.join(root,'web/avatar3d-motion.js');
const threeURL=pathToFileURL(path.join(root,'web/vendor/three/three.module.js')).href;
const T=await import(threeURL);
const source=fs.readFileSync(modulePath,'utf8').replace("'/vendor/three/three.module.js'",JSON.stringify(threeURL));
const {Avatar3DMotion}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const rows=m=>[0,1,2].flatMap(r=>[0,1,2,3].map(c=>m.elements[c*4+r]));
const affine=values=>new T.Matrix4().set(...values,0,0,0,1);
const maxError=(a,b)=>Math.max(...a.map((x,i)=>Math.abs(x-b[i])));
const close=(a,b,message)=>assert.ok(maxError(a,b)<2e-6,message+' error='+maxError(a,b));
const worldMap=(model,bones,frame)=>{
 bones.forEach((b,i)=>{b.node.matrix.copy(affine(frame.slice(i*12,i*12+12)));b.node.matrixAutoUpdate=false;});
 model.updateMatrixWorld(true);
 const inverse=model.matrixWorld.clone().invert();
 return bones.map(b=>inverse.clone().multiply(b.node.matrixWorld));
};
async function fixture({hierarchy=false,transformed=false,walking=false,nestedAnchor=false}={}){
 const model=new T.Object3D();model.position.set(7,8,9);model.rotation.y=.7;model.scale.setScalar(1.5);
 const parentA=new T.Object3D(),parentB=new T.Object3D();model.add(parentA,parentB);
 if(transformed){parentA.rotation.set(.24,.6,-.3);parentA.scale.set(1.7,.8,1.2);parentB.rotation.set(-.16,-.9,.2);parentB.scale.set(.6,1.3,.9);parentB.position.set(2,0,-1);}
 const pelvis=new T.Bone();pelvis.name=nestedAnchor?'master':'root.x';parentA.add(pelvis);pelvis.position.set(.2,1,.1);
 const chest=new T.Bone();chest.name=nestedAnchor?'root.x':'spine.x';(hierarchy?pelvis:parentB).add(chest);chest.position.set(.1,.6,.1);
 const hand=new T.Bone();hand.name='hand.l';chest.add(hand);hand.position.set(.5,.2,0);
 model.updateMatrixWorld(true);
 const raw=[pelvis,chest,hand],inverse=model.matrixWorld.clone().invert();
 const bones=raw.map(node=>({name:node.name,node,world:inverse.clone().multiply(node.matrixWorld),rest:{m:node.matrix.clone()}}));
 // Deliberately non-topological data order: prepare() must map by bone name.
 const order=[2,0,1],motionBones=order.map(i=>bones[i].name),original=[];
 const net=new T.Vector3(.8,0,-.65),height=.17;
 for(let f=0;f<7;f++){
  const share=f/6;
  const locals=bones.map((b,i)=>{
   const m=b.rest.m.clone();
   if(i===0||(!hierarchy&&i===1)){
    const parent= b.world.clone().multiply(b.rest.m.clone().invert());
    const shift=net.clone().multiplyScalar(share).add(new T.Vector3(0,height*share,0)).applyMatrix3(new T.Matrix3().setFromMatrix4(parent.invert()));
    m.elements[12]+=shift.x;m.elements[13]+=shift.y;m.elements[14]+=shift.z;
   }
   if(i===2)m.multiply(new T.Matrix4().makeRotationZ(Math.sin(share*Math.PI)*.4));
   return m;
  });
  original.push(locals.flatMap(rows));
 }
 const data={version:1,id:'test',bones:motionBones,frames:original.map(f=>order.flatMap(i=>f.slice(i*12,i*12+12))),fps:30,bounds:[[-3,-3,-3],[3,3,3]],retargeting:{forwardSpeed:walking?.8:0}};
 const fetchOriginal=globalThis.fetch;
 globalThis.fetch=async()=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
 const motion=new Avatar3DMotion({bones});motion.clips.set('test',{id:'test',url:'https://test.invalid/test.json'});
 let clip;try{clip=await motion.prepare('test');}finally{globalThis.fetch=fetchOriginal;}
 for(let f=0;f<original.length;f++){
  const mapped=clip.indices.flatMap(i=>Array.from(clip.frames[f].subarray(i*12,i*12+12)));
  const before=worldMap(model,bones,original[f]),after=worldMap(model,bones,mapped);
  const expectedOffset=walking?new T.Vector3():net.clone().multiplyScalar(-f/6);
  for(let i=0;i<bones.length;i++){
   const expected=new T.Matrix4().makeTranslation(...expectedOffset.toArray()).multiply(before[i]);
   close(after[i].elements,expected.elements,`rigid common shift ${JSON.stringify({hierarchy,transformed,walking,nestedAnchor})} frame=${f} bone=${bones[i].name}`);
  }
  if(hierarchy)close(mapped.slice(12),original[f].slice(12),'descendants local transforms unchanged');
  close(mapped.slice(24),original[f].slice(24),'finger/hand descendant unchanged');
 }
 const start=worldMap(model,bones,clip.indices.flatMap(i=>Array.from(clip.frames[0].subarray(i*12,i*12+12))))[0];
 const end=worldMap(model,bones,clip.indices.flatMap(i=>Array.from(clip.frames.at(-1).subarray(i*12,i*12+12))))[0];
 const delta=new T.Vector3().setFromMatrixPosition(end).sub(new T.Vector3().setFromMatrixPosition(start));
 close(delta.toArray(),walking?[net.x,height,net.z]:[0,height,0],'root closes horizontally, preserves jump height');
 const originalBounds=new T.Box3(new T.Vector3(-3,-3,-3),new T.Vector3(3,3,3));
 assert.ok(clip.bounds.containsBox(originalBounds),'must preserve original bounds');
 if(!walking)assert.ok(clip.bounds.clone().expandByScalar(2e-6).containsBox(originalBounds.clone().translate(net.clone().negate())),'must include translated end bounds');
 return {hierarchy,transformed,walking,nestedAnchor};
}
const passed=[];
for(const settings of [{},{hierarchy:true},{transformed:true},{hierarchy:true,transformed:true},{walking:true},{walking:true,transformed:true},{hierarchy:true,transformed:true,nestedAnchor:true}])passed.push(await fixture(settings));
console.log(JSON.stringify({ok:true,passed},null,2));
