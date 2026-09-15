import * as THREE from '/vendor/three/three.module.js';

// A narrow depth allowance for skin that penetrates fitted clothing. The mask
// uses the current skinned garment, its alpha cutouts and the actual camera.
// A rear panel cannot erase the front of the body: their depths must be close.
// Rest-space bounds keep hands and other foreground body parts unaffected.
const configurations={
 sarah:{garments:['Fem-A_Bot_Ac_BknBrzl_1','Fem-A_Whl_Ac_VDress'],skin:['Top_Sara01A_M.001','Bot_Ac_BknBrzl'],min:[-.25,.82,-1],max:[.25,1.13,1],depth:.035},
 iselda:{garments:['Short Skirt','Long Skirt'],skin:['skin'],min:[-.25,.50,-1],max:[.25,1.09,1],depth:.035},
};
const materials=n=>Array.isArray(n.material)?n.material:[n.material];
export class AvatarClothOcclusion {
 constructor(avatar){
  this.avatar=avatar;this.config=configurations[avatar.characterId];this.garments=[];this.cache=new Map();
  this.enabled={value:false};this.texture={value:null};this.size=new THREE.Vector2();
  if(!this.config||!avatar.renderer.extensions.has('EXT_color_buffer_float'))return;
  const c=this.config;
  this.target=new THREE.WebGLRenderTarget(1,1,{type:THREE.FloatType,minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
  this.texture.value=this.target.texture;
  const seen=new Set();
  avatar.model.traverse(n=>{
   if(!n.isSkinnedMesh)return;
   // The repaired brief follows the skin exactly; it never masks the body.
   // The outer dress orders both skin and the brief beneath its fabric.
   if(c.garments.includes(n.userData.sourceName||n.name)&&!n.userData.avatarBodyFittedUnderlayer)this.garments.push(n);
   for(const m of materials(n)){
    if(!c.skin.includes(m.name)||seen.has(m)||(m.name==='Bot_Ac_BknBrzl'&&!n.userData.avatarBodyFittedUnderlayer))continue;seen.add(m);
    const allowance=m.name==='Bot_Ac_BknBrzl'?.008:c.depth;
    const hook=m.onBeforeCompile,key=m.customProgramCacheKey;
    m.onBeforeCompile=(s,r)=>{
     hook.call(m,s,r);
     Object.assign(s.uniforms,{avatarClothMaskOn:this.enabled,avatarClothMask:this.texture});
     s.vertexShader='varying vec3 avatarClothBodyRest;varying vec4 avatarClothBodyClip;varying float avatarClothBodyDepth;\n'+s.vertexShader;
     s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\navatarClothBodyRest=position;');
     s.vertexShader=s.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\navatarClothBodyClip=gl_Position;avatarClothBodyDepth=-mvPosition.z;');
     s.fragmentShader='varying vec3 avatarClothBodyRest;varying vec4 avatarClothBodyClip;varying float avatarClothBodyDepth;uniform bool avatarClothMaskOn;uniform sampler2D avatarClothMask;\n'+s.fragmentShader;
     const vector=v=>'vec3('+v.map(n=>Number(n).toFixed(5)).join(',')+')';
     s.fragmentShader=s.fragmentShader.replace('#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>
      if(avatarClothMaskOn&&all(greaterThan(avatarClothBodyRest,${vector(c.min)}))&&all(lessThan(avatarClothBodyRest,${vector(c.max)}))){
       vec2 uv=avatarClothBodyClip.xy/avatarClothBodyClip.w*.5+.5;
       vec4 cloth=texture2D(avatarClothMask,uv);
       float gap=cloth.r-avatarClothBodyDepth;
       if(cloth.a>.5&&gap>0.&&gap<${allowance.toFixed(5)})discard;
      }`);
    };
    m.customProgramCacheKey=()=>key.call(m)+'-cloth-occlusion-v1';m.needsUpdate=true;
   }
  });
 }
 maskMaterial(source){
  let record=this.cache.get(source);
  if(!record){
   const material=source.clone();record={material,version:-1};this.cache.set(source,record);
   material.onBeforeCompile=(s,r)=>{
    source.onBeforeCompile.call(source,s,r);
    s.vertexShader='varying float avatarGarmentDepth;\n'+s.vertexShader;
    s.vertexShader=s.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\navatarGarmentDepth=-mvPosition.z;');
    s.fragmentShader='varying float avatarGarmentDepth;\n'+s.fragmentShader;
    s.fragmentShader=s.fragmentShader.replace('#include <dithering_fragment>','#include <dithering_fragment>\ngl_FragColor=vec4(avatarGarmentDepth,0.,0.,1.);');
   };
   material.customProgramCacheKey=()=>source.customProgramCacheKey.call(source)+'-cloth-depth-v1';
  }
  const m=record.material;
  if(record.version!==source.version||record.hook!==source.onBeforeCompile){
   // Keep morph/dual-quaternion/contact hooks identical to the visible cloth.
   m.copy(source);m.transparent=false;m.depthWrite=true;m.depthTest=true;m.colorWrite=true;m.side=THREE.DoubleSide;
   m.defines={...source.defines};m.needsUpdate=true;record.version=source.version;record.hook=source.onBeforeCompile;
  }
  m.map=source.map;m.alphaMap=source.alphaMap;m.alphaTest=source.alphaTest;m.opacity=source.opacity;
  return m;
 }
 beforeRender(){
  this.enabled.value=false;
  if(!this.target)return;
  const a=this.avatar,r=a.renderer;
  const clothes=this.garments.filter(n=>n.visible&&n.geometry.attributes.position?.count&&materials(n).some(m=>m.visible));
  if(!clothes.length)return;
  r.getDrawingBufferSize(this.size);
  if(this.target.width!==this.size.x||this.target.height!==this.size.y)this.target.setSize(this.size.x,this.size.y);
  const selected=new Set(clothes),visible=new Map(),originalMaterials=new Map();
  const target=r.getRenderTarget(),clear=r.getClearColor(new THREE.Color()),alpha=r.getClearAlpha(),shadows=r.shadowMap.enabled;
  try{
   a.scene.traverse(n=>{if(n.isMesh){visible.set(n,n.visible);n.visible=selected.has(n);}});
   for(const n of clothes){originalMaterials.set(n,n.material);n.material=Array.isArray(n.material)?n.material.map(m=>this.maskMaterial(m)):this.maskMaterial(n.material);}
   r.shadowMap.enabled=false;r.setRenderTarget(this.target);r.setClearColor(0,0);r.clear();r.render(a.scene,a.camera);
   this.enabled.value=true;
  }finally{
   for(const [n,m]of originalMaterials)n.material=m;
   for(const [n,v]of visible)n.visible=v;
   r.setRenderTarget(target);r.setClearColor(clear,alpha);r.shadowMap.enabled=shadows;
  }
 }
 dispose(){this.target?.dispose();for(const {material}of this.cache.values())material.dispose();this.cache.clear();}
}
