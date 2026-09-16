import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
// Exercises production loading, clip classification, play and update.
// GLA_REPO allows this test to validate a staged module before integration.
const root=process.env.GLA_REPO||path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const modulePath=process.argv[2]||path.join(root,'web/avatar3d-motion.js');
const threeURL=pathToFileURL(path.join(root,'web/vendor/three/three.module.js')).href;
const T=await import(threeURL);
const source=fs.readFileSync(modulePath,'utf8').replace("'/vendor/three/three.module.js'",JSON.stringify(threeURL));
const {Avatar3DMotion}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const rows=m=>[0,1,2].flatMap(r=>[0,1,2,3].map(c=>m.elements[c*4+r]));
function parts(m){const p=new T.Vector3(),q=new T.Quaternion(),s=new T.Vector3();m.decompose(p,q,s);return {m,p,q,s,residual:new T.Matrix4()};}
const fingerNames=['index1.l','index1.r'];
async function fixture({animated,named=true,userGrip=false}){
 const model=new T.Object3D(),names=['torso',...fingerNames];
 const bones=names.map(name=>{const node=new T.Bone();node.name=name;model.add(node);return {name,node,rest:{m:new T.Matrix4()},world:new T.Matrix4()};});
 const current=bones.map(()=>parts(new T.Matrix4()));
 if(userGrip)current[1]=parts(new T.Matrix4().makeRotationX(.95));
 const entries=new Map(['l','r'].flatMap(side=>[
  ['fist.'+side,{group:side==='l'?'leftHand':'rightHand',deltas:{['index1.'+side]:true},angle:1.2}],
  ['Hnd.'+side+'.pose1',{group:side==='l'?'leftHand':'rightHand',deltas:{['index1.'+side]:true},angle:.3}]
 ]));
 let written;
 const options={bones,current,selection:userGrip?{leftHand:'chosen'}:{},avatar:{},poses:entries,
  write:value=>{written=value;},applyPose:()=>{},
  targetFor:pose=>bones.map(({name})=>parts(new T.Matrix4().makeRotationX(Object.hasOwn(pose.deltas,name)?pose.angle:0)))
 };
 const motion=new Avatar3DMotion(options);
 motion.clips.set('test',{id:'test',url:'https://test.invalid/test.json',...(named?{leftHand:'fist.l',rightHand:'fist.r'}:{})});
 const frames=Array.from({length:31},(_,i)=>[
  ...rows(new T.Matrix4().makeRotationY(i/30*.4)),
  ...rows(new T.Matrix4().makeRotationX(animated?i/30*.6:0)),
  ...rows(new T.Matrix4().makeRotationX(animated?i/30*.8:0))
 ]);
 const data={version:1,id:'test',bones:names,frames,fps:30,loop:false};
 const original=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify(data));
 try{await motion.play('test',{now:0});}finally{globalThis.fetch=original;}
 assert.equal(motion.active.clip.animatesFingers,animated);
 motion.update(500);
 const angle=i=>new T.Euler().setFromQuaternion(written[i].q).x;
 const close=(value,expected,label)=>assert.ok(Math.abs(value-expected)<1e-6,`${label}: ${value} != ${expected}`);
 close(new T.Euler().setFromQuaternion(written[0].q).y,.2,'body track is untouched');
 close(angle(1),userGrip?.95:animated?.3:named?1.2:.3,'left finger');
 close(angle(2),animated?.4:named?1.2:.3,'right finger');
}
await fixture({animated:true});
await fixture({animated:true,named:false});
await fixture({animated:true,userGrip:true});
await fixture({animated:false});
await fixture({animated:false,named:false});
console.log('PASS: animated fingers survive catalog grips; explicit grips and static-source fallback remain valid; body track preserved.');
