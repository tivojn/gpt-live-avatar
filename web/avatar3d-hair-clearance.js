import * as THREE from '/vendor/three/three.module.js';

const nameOf=n=>n.userData.sourceName||n.name;
const shader=`
#ifdef AVATAR_HAIR_CONTACT
attribute vec4 avatarHairRest;
uniform mat4 avatarHairToModel,avatarHairFromModel,avatarHairToRest,avatarHairFromRest;
uniform vec4 avatarHairBands[6];
vec3 avatarHairContact(vec3 p,vec4 authored){
 vec3 q=(avatarHairToRest*vec4(p,1.)).xyz;
 float y=q.y;
 if(y<avatarHairBands[0].x||y>avatarHairBands[5].x)return p;
 vec4 band=avatarHairBands[0];
 for(int i=0;i<5;i++)if(y>=avatarHairBands[i].x&&y<=avatarHairBands[i+1].x){
  float f=(y-avatarHairBands[i].x)/max(.00001,avatarHairBands[i+1].x-avatarHairBands[i].x);
  band=mix(avatarHairBands[i],avatarHairBands[i+1],f);
 }
 float side=authored.w;
 if(abs(q.x)>=band.y||abs(side)<.5)return p;
 float edge=sqrt(max(0.,1.-q.x*q.x/(band.y*band.y)));
 float surface=band.z+sign(side)*band.w*edge;
 float correction=max(0.,(surface-q.z)*sign(side)-abs(side)+1.);
 correction*=smoothstep(avatarHairBands[0].x,avatarHairBands[0].x+.045,y)*(1.-smoothstep(avatarHairBands[5].x-.04,avatarHairBands[5].x,y));
 q.z+=sign(side)*correction;
 return (avatarHairFromRest*vec4(q,1.)).xyz;
}
#endif
`;

// Long rigidly head-bound locks can travel through the whole torso between
// frames. Radial capsule projection then ejects the back hair out the front.
// Keep each lock on its authored side of a fitted torso envelope instead.
// Six ellipse bands and one chest transform cost no per-frame CPU vertex work.
export class AvatarHairClearance{
 constructor(avatar){
  this.avatar=avatar;this.records=[];this.depths=[];this.boundMaterials=new WeakSet();
  if(avatar.characterId!=='sarah'||!avatar.bones.chest||!avatar.bones.neck||!avatar.bones.hips)return;
  avatar.model.updateMatrixWorld(true);
  const inv=avatar.model.matrixWorld.clone().invert(),all=[];
  avatar.model.traverse(n=>{if(n.isSkinnedMesh)all.push(n);});
  const hair=all.filter(n=>/hair/i.test(nameOf(n))),body=all.filter(n=>!/(hair|dress|pants|pnts|coat|top|fot|bag|weap)/i.test(nameOf(n))).sort((a,b)=>b.geometry.attributes.position.count-a.geometry.attributes.position.count)[0];
  if(!body||!hair.length)return;
  this.chest=avatar.bones.chest;this.restChest=this.chest.matrixWorld.clone();this.restModel=avatar.model.matrixWorld.clone();
  this.toRest=new THREE.Matrix4();this.fromRest=new THREE.Matrix4();
  const at=n=>n.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
  const lo=at(avatar.bones.hips).y-.035,hi=at(avatar.bones.neck).y-.008,span=hi-lo;
  const samples=Array.from({length:6},(_,i)=>({y:lo+span*i/5,x:0,zmin:Infinity,zmax:-Infinity,n:0}));
  const pos=body.geometry.attributes.position,indices=body.geometry.attributes.skinIndex,weights=body.geometry.attributes.skinWeight,p=new THREE.Vector3();
  const torso=new Set(body.skeleton.bones.map((n,i)=>/^(c_)?(root|spine|neck|hips|pelvis|breast)/i.test(nameOf(n))?i:-1));
  for(let i=0;i<pos.count;i++){
   let w=0;for(let j=0;j<4;j++)if(torso.has(indices.getComponent(i,j)))w+=weights.getComponent(i,j);if(w<.65)continue;
   p.fromBufferAttribute(pos,i);body.applyBoneTransform(i,p);p.applyMatrix4(body.matrixWorld).applyMatrix4(inv);
   for(const s of samples)if(Math.abs(p.y-s.y)<span*.11){s.n++;s.x=Math.max(s.x,Math.abs(p.x));s.zmin=Math.min(s.zmin,p.z);s.zmax=Math.max(s.zmax,p.z);}
  }
  if(samples.some(s=>s.n<12))return;
  this.bands=samples.map(s=>new THREE.Vector4(s.y,s.x+.01,(s.zmin+s.zmax)/2,(s.zmax-s.zmin)/2+.008));
  this.inverseModel=inv;
  const declarations=THREE.ShaderChunk.skinning_pars_vertex;
  if(!declarations.includes('uniform mat4 avatarHairToModel')){
   THREE.ShaderChunk.skinning_pars_vertex+=shader;
   THREE.ShaderChunk.project_vertex=`\n#ifdef AVATAR_HAIR_CONTACT\ntransformed=(avatarHairFromModel*vec4(avatarHairContact((avatarHairToModel*vec4(transformed,1.)).xyz,avatarHairRest),1.)).xyz;\n#endif\n`+THREE.ShaderChunk.project_vertex;
  }
  const shared=new Map(),commonUniforms={avatarHairToModel:{value:new THREE.Matrix4()},avatarHairFromModel:{value:new THREE.Matrix4()},avatarHairToRest:{value:this.toRest},avatarHairFromRest:{value:this.fromRest},avatarHairBands:{value:this.bands}};
  for(const node of hair){
   const uniforms=commonUniforms;
   const bind=m=>{if(this.boundMaterials.has(m))return;this.boundMaterials.add(m);const hook=m.onBeforeCompile,key=m.customProgramCacheKey;m.defines={...m.defines,AVATAR_HAIR_CONTACT:1};m.onBeforeCompile=(s,r)=>{hook.call(m,s,r);Object.assign(s.uniforms,uniforms);};m.customProgramCacheKey=()=>key.call(m)+'-hair-contact-v1';m.needsUpdate=true;};
   const material=m=>{if(!shared.has(m)){const clone=m.clone();bind(clone);shared.set(m,clone);}return shared.get(m);};node.material=Array.isArray(node.material)?node.material.map(material):material(node.material);
   const depth=node.customDepthMaterial?.clone()||new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});bind(depth);node.customDepthMaterial=depth;this.depths.push(depth);
   const record={node,uniforms,bind,restToModel:inv.clone().multiply(node.matrixWorld)};this.records.push(record);
   const original=node.getVertexPosition,owner=this;
   node.getVertexPosition=function(i,v){original.call(this,i,v);const attr=this.geometry.getAttribute('avatarHairRest');if(!attr)return v;v.applyMatrix4(uniforms.avatarHairToModel.value);owner.contact(v,new THREE.Vector4().fromBufferAttribute(attr,i));return v.applyMatrix4(uniforms.avatarHairFromModel.value);};
  }
  this.update();
 }
 band(y){const b=this.bands;if(y<b[0].x||y>b[5].x)return null;for(let i=0;i<5;i++)if(y<=b[i+1].x)return b[i].clone().lerp(b[i+1],(y-b[i].x)/(b[i+1].x-b[i].x));return null;}
 prepare(r){
  const g=r.node.geometry;if(g===r.geometry)return;r.geometry=g;const pos=g.attributes.position,data=new Float32Array(pos.count*4),p=new THREE.Vector3();
  for(let i=0;i<pos.count;i++){
   p.fromBufferAttribute(pos,i).applyMatrix4(r.restToModel);const b=this.band(THREE.MathUtils.clamp(p.y,this.bands[0].x,this.bands[5].x));let side=0;
   if(b&&p.y<=this.bands[5].x){side=p.z>=b.z?1:-1;const edge=Math.sqrt(Math.max(0,1-p.x*p.x/(b.y*b.y))),surface=b.z+side*b.w*edge;side*=1+Math.max(0,(surface-p.z)*side);}
   data.set([p.x,p.y,p.z,side],i*4);
  }
  g.setAttribute('avatarHairRest',new THREE.Float32BufferAttribute(data,4));
 }
 contact(p,rest){
  const q=p.clone().applyMatrix4(this.toRest),b=this.band(q.y);if(!b||Math.abs(q.x)>=b.y||Math.abs(rest.w)<.5)return p;
  const side=Math.sign(rest.w),edge=Math.sqrt(Math.max(0,1-q.x*q.x/(b.y*b.y))),surface=b.z+side*b.w*edge;
  const blend=THREE.MathUtils.smoothstep(q.y,this.bands[0].x,this.bands[0].x+.045)*(1-THREE.MathUtils.smoothstep(q.y,this.bands[5].x-.04,this.bands[5].x));q.z+=side*Math.max(0,(surface-q.z)*side-Math.abs(rest.w)+1)*blend;return p.copy(q).applyMatrix4(this.fromRest);
 }
 update(){
  if(!this.records.length)return;const a=this.avatar;a.model.updateMatrixWorld(true);this.inverseModel.copy(a.model.matrixWorld).invert();
  this.fromRest.copy(this.inverseModel).multiply(this.chest.matrixWorld).multiply(this.restChest.clone().invert()).multiply(this.restModel);this.toRest.copy(this.fromRest).invert();
  // Portrait lighting creates its own alpha-tested shadow material after
  // this contact controller is constructed. Apply the same displacement there
  // so the hair's shadow cannot remain on the other side of the body.
  for(const shadow of a.appearance?.portrait?.meshes||[]){const r=this.records.find(r=>r.node===shadow.node);if(r&&shadow.shadow)r.bind(shadow.shadow);}
  for(const r of this.records){this.prepare(r);r.uniforms.avatarHairToModel.value.multiplyMatrices(this.inverseModel,r.node.matrixWorld);r.uniforms.avatarHairFromModel.value.copy(r.uniforms.avatarHairToModel.value).invert();}
 }
 dispose(){for(const m of this.depths)m.dispose();}
}
