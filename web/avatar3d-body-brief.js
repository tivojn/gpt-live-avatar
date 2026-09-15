// Derived body-surface cloth uses the same triangles, skin weights and relevant
// morphs as Sarah. A small post-skin thickness keeps fabric on the body surface.
const boundMaterials=new WeakSet();
export function bindSarahBodyBrief(node){
 if(!node.isSkinnedMesh||!node.userData.avatarBodyFittedUnderlayer)return;
 node.userData.avatarBodyBriefBound=true;
 const bind=m=>{
  if(boundMaterials.has(m))return m;
  // Material.copy does not preserve shader callbacks. Capture from the input
  // before cloning so appearance, diffusion and other decorators survive.
  const hook=m.onBeforeCompile,key=m.customProgramCacheKey,hookKey=hook.toString(),source=m.clone();
  source.onBeforeCompile=(s,r)=>{
   hook.call(source,s,r);
   s.vertexShader='varying vec3 avatarBriefRest;\n'+s.vertexShader;
   s.vertexShader=s.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\navatarBriefRest=position;');
   s.vertexShader=s.vertexShader.replace('#include <skinning_vertex>','#include <skinning_vertex>\ntransformed+=normalize(objectNormal)*.0015;');
   s.fragmentShader='varying vec3 avatarBriefRest;\n'+s.fragmentShader;
   s.fragmentShader=s.fragmentShader.replace('#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>
    float side=abs(avatarBriefRest.x);
    float front=smoothstep(.035,.078,avatarBriefRest.z);
    float briefLeg=.947+.109*pow(clamp((side-.020)/.115,0.,1.),.58);
    briefLeg+=.007*front*smoothstep(.025,.050,side)*(1.-smoothstep(.060,.110,side));
    float frontWaist=1.025+.043*smoothstep(0.,.13,side);
    float backWaist=1.061+.006*smoothstep(.03,.13,side);
    float briefWaist=mix(backWaist,frontWaist,front);
    if(avatarBriefRest.y<briefLeg||avatarBriefRest.y>briefWaist)discard;`);
  };
  // Three's default key reads this.onBeforeCompile. Preserve the original
  // decorator's source too, so different input shaders cannot share this key.
  source.customProgramCacheKey=()=>key.call(source)+'-body-fitted-brief-v2:'+hookKey;source.needsUpdate=true;boundMaterials.add(source);return source;
 };
 node.material=Array.isArray(node.material)?node.material.map(bind):bind(node.material);
}
