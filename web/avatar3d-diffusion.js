import * as THREE from '/vendor/three/three.module.js';

// Screen-space diffusion of skin's diffuse light only. Specular highlights,
// lashes and hair stay in the original image. Depth and skin coverage keep
// the filter from spreading across the silhouette or onto clothes.
// Method background: Jimenez et al., Separable Subsurface Scattering (2015).
const vertex=`varying vec2 vUv;
void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`;
const depth=`float distanceAt(vec2 uv){float z=texture2D(depthMap,uv).r;
return nearPlane*farPlane/(farPlane-z*(farPlane-nearPlane));}`;
const fragment=`varying vec2 vUv;
uniform sampler2D inputMap,depthMap,maskMap;
uniform vec2 stepUV;
uniform float nearPlane,farPlane,projectionScale,radius;
uniform vec3 channelVariance;
${depth}
void main(){
 vec4 center=texture2D(inputMap,vUv);float mask=texture2D(maskMap,vUv).a;
 if(mask<.5){gl_FragColor=center;return;}
 float d=distanceAt(vUv);
 // Radius is in scene units, so pinching never changes the skin's material.
 float localRadius=max(.001,(mask-.5)*.1)*radius;
 vec2 delta=stepUV*min(64.,localRadius*projectionScale/max(d,.01));
 vec3 sum=center.rgb*.04,weight=vec3(.04);
 for(int i=1;i<=6;i++){
  // More taps close to the origin resolve green/blue diffusion too. Uniform
  // red-radius steps otherwise leave narrow channels sharp and create halos.
  float offset=i==1?.04:i==2?.10:i==3?.22:i==4?.42:i==5?.70:1.;
  float area=i==1?.05:i==2?.09:i==3?.16:i==4?.24:i==5?.29:.15;
  float x=offset*3.;vec3 w=area*exp(-.5*x*x/channelVariance);
  for(int side=-1;side<=1;side+=2){
   vec2 uv=vUv+delta*offset*float(side);
   vec4 sampleColor=texture2D(inputMap,uv);
   float valid=texture2D(maskMap,uv).a;
   float edge=exp(-abs(distanceAt(uv)-d)/max(localRadius*.8,.0001));
   vec3 k=w*edge*smoothstep(.015,.7,valid);
   sum+=sampleColor.rgb*k;weight+=k;
  }
 }
 gl_FragColor=vec4(sum/weight,center.a);
}`;
const composite=`varying vec2 vUv;
uniform sampler2D beautyMap,diffuseMap,softMap,depthMap,albedoMap;
uniform highp sampler3D filmicMap;
uniform mat4 inverseProjection;
uniform vec2 pixelSize;
uniform float strength,aoStrength,aoRadius,projectionScale,exposure;
uniform bool effects;
vec3 positionAt(vec2 uv){vec4 p=inverseProjection*vec4(uv*2.-1.,texture2D(depthMap,uv).r*2.-1.,1.);return p.xyz/p.w;}
float occlusion(vec3 p,vec3 normal){
 float sum=0.;float pixels=clamp(aoRadius*projectionScale/max(-p.z,.01),2.,32.);
 for(int i=0;i<8;i++){
  float angle=float(i)*.785398163;vec2 direction=vec2(cos(angle),sin(angle));
  for(int j=1;j<=2;j++){
   vec3 delta=positionAt(vUv+direction*pixelSize*pixels*(float(j)*.5))-p;
   float distance=length(delta);
   float horizon=max(0.,dot(normal,delta/max(distance,.0001))-.12);
   sum+=horizon*(1.-smoothstep(aoRadius*.15,aoRadius,distance));
  }
 }
 return clamp(sum/8.,0.,.65);
}
void main(){
 vec4 beauty=texture2D(beautyMap,vUv);if(beauty.a<.00001){gl_FragColor=vec4(0.);return;}vec3 color=beauty.rgb;
 if(effects){
  vec4 diffuse=texture2D(diffuseMap,vUv);vec3 albedo=texture2D(albedoMap,vUv).rgb;
  vec3 raw=diffuse.rgb*albedo,soft=texture2D(softMap,vUv).rgb*albedo;
  vec3 p=positionAt(vUv);vec3 normal=normalize(cross(dFdx(p),dFdy(p)));
  float ao=diffuse.a>.1?occlusion(p,normal)*aoStrength:0.;
  float skin=smoothstep(.5,.65,diffuse.a);
  color=max(vec3(0.),color-raw*ao+(soft-raw)*strength*skin);
 }
 // Both targets are linear. Unpremultiply before the final display transform.
 vec3 linear=color/max(beauty.a,.00001)*exposure;
 vec3 coord=clamp((log2(max(linear,vec3(.000175)))-vec3(-12.473931188))/16.5,0.,1.);
 float size=float(textureSize(filmicMap,0).x);
 vec3 display=texture(filmicMap,coord*((size-1.)/size)+vec3(.5/size)).rgb;
 gl_FragColor=vec4(display,beauty.a);
 #include <premultiplied_alpha_fragment>
}`;

export class AvatarDiffusion {
 constructor(avatar,settings={}){
  this.avatar=avatar;this.capture={value:false};this.installed=new WeakMap();
  this.radius=settings.diffusionRadius??.25;this.strength=.4;this.aoStrength=settings.aoStrength??.35;this.aoRadius=.025;
  this.displayTransform=settings.displayTransform||'filmic';
  this.channelVariance=new THREE.Vector3(...(settings.channelVariance||[2.25,.09,.0225]));
 }
 async load(){
  if(this.filmic)return;
  if(!THREE.UniformsLib.LTC_FLOAT_1){
   const {RectAreaLightUniformsLib}=await import('/vendor/three/RectAreaLightUniformsLib.js');RectAreaLightUniformsLib.init();
  }
  const response=await fetch('/vendor/color/'+this.displayTransform+'.rgba16f');
  if(!response.ok)throw Error('The portrait display transform is unavailable.');
  const data=await response.arrayBuffer();
  // AgX's coupled color transform needs a finer grid for saturated colors.
  const size=this.displayTransform==='agx'?129:65;
  if(data.byteLength!==size*size*size*8)throw Error('The portrait display transform is incomplete.');
  if(this.avatar.disposed)return;
  this.filmic=new THREE.Data3DTexture(new Uint16Array(data),size,size,size);
  this.filmic.type=THREE.HalfFloatType;this.filmic.format=THREE.RGBAFormat;
  this.filmic.minFilter=this.filmic.magFilter=THREE.LinearFilter;this.filmic.unpackAlignment=1;this.filmic.needsUpdate=true;
 }
 bind(material,kind){
  const hook=material.onBeforeCompile,cache=material.customProgramCacheKey;
  if(this.installed.get(material)===hook)return;
  const compile=(shader,renderer)=>{
   hook.call(material,shader,renderer);
   if(shader.uniforms.avatarDiffusePass===this.capture)return;
   shader.uniforms.avatarDiffusePass=this.capture;
   shader.fragmentShader='uniform bool avatarDiffusePass;\nlayout(location=1) out highp vec4 avatarAlbedo;\n'+shader.fragmentShader;
   // The regular depth and alpha tests still run for every material.
   const map=this.avatar.appearance?.portrait?.skinScatter;
   if(kind==='skin'&&map){shader.uniforms.diffusionRadiusMap={value:map};shader.fragmentShader='uniform sampler2D diffusionRadiusMap;\n'+shader.fragmentShader;}
   const scale=map?'texture2D(diffusionRadiusMap,vMapUv).r':'.0235';
   const lit=kind==='skin'||kind==='iris';
   // Non-skin surfaces are only occluders in the diffusion pass. Keep their
   // authored alpha/depth and deformation, skip their full PBR lighting.
   if(!lit)shader.fragmentShader=shader.fragmentShader.replace('#include <alphatest_fragment>',
     `#include <alphatest_fragment>\nif(avatarDiffusePass){gl_FragColor=vec4(0.,0.,0.,${material.transparent?'diffuseColor.a':'0.'});avatarAlbedo=vec4(0.);return;}`);
   const output=kind==='skin'?`vec4(totalDiffuse/max(material.diffuseContribution,vec3(.001)),.5+min(.049,${scale})*10.)`:kind==='iris'?'vec4(totalDiffuse/max(material.diffuseContribution,vec3(.001)),0.25)':`vec4(0.0,0.0,0.0,${material.transparent?'gl_FragColor.a':'0.0'})`;
   shader.fragmentShader=shader.fragmentShader.replace('#include <tonemapping_fragment>',
    `avatarAlbedo=vec4(0.);if(avatarDiffusePass){gl_FragColor=${output};avatarAlbedo=vec4(${lit?'material.diffuseContribution':'vec3(0.)'},gl_FragColor.a);}\n#include <tonemapping_fragment>`);
  };
  material.onBeforeCompile=compile;this.installed.set(material,compile);
  material.customProgramCacheKey=()=>cache.call(material)+':diffusion:'+kind;
  material.needsUpdate=true;
 }
 targets(width,height,quality){
  if(this.width===width&&this.height===height&&this.effects===quality)return;
  this.release();this.width=width;this.height=height;this.effects=quality;
  const fxWidth=Math.ceil(width/2),fxHeight=Math.ceil(height/2);this.fxWidth=fxWidth;this.fxHeight=fxHeight;
  const make=()=>new THREE.WebGLRenderTarget(width,height,{type:THREE.HalfFloatType,samples:4});
  this.beauty=make();this.diffuse=quality?new THREE.WebGLRenderTarget(fxWidth,fxHeight,{type:THREE.HalfFloatType,count:2}):null;if(this.diffuse)this.diffuse.depthTexture=new THREE.DepthTexture(fxWidth,fxHeight,THREE.UnsignedIntType);
  this.ping=quality?new THREE.WebGLRenderTarget(fxWidth,fxHeight,{type:THREE.HalfFloatType,depthBuffer:false}):null;
  this.pong=this.ping?.clone();
  const uniforms={inputMap:{value:null},depthMap:{value:this.diffuse?.depthTexture||null},maskMap:{value:this.diffuse?.texture||null},
   stepUV:{value:new THREE.Vector2()},nearPlane:{value:0},farPlane:{value:0},projectionScale:{value:0},radius:{value:0},channelVariance:{value:this.channelVariance}};
  this.filter=new THREE.ShaderMaterial({uniforms,vertexShader:vertex,fragmentShader:fragment,depthTest:false,depthWrite:false,toneMapped:false});
  this.composite=new THREE.ShaderMaterial({uniforms:{beautyMap:{value:this.beauty.texture},diffuseMap:{value:this.diffuse?.texture||null},albedoMap:{value:this.diffuse?.textures[1]||null},softMap:{value:this.pong?.texture||null},strength:{value:this.strength},
   filmicMap:{value:this.filmic},effects:{value:true},exposure:{value:1},depthMap:{value:this.diffuse?.depthTexture||null},inverseProjection:{value:new THREE.Matrix4()},pixelSize:{value:new THREE.Vector2(1/fxWidth,1/fxHeight)},aoStrength:{value:0},aoRadius:{value:0},projectionScale:{value:0}},
   vertexShader:vertex,fragmentShader:composite,depthTest:false,depthWrite:false,premultipliedAlpha:true,toneMapped:false});
  this.quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),this.filter);this.scene=new THREE.Scene();this.scene.add(this.quad);this.camera=new THREE.Camera();
 }
 render(quality=true){
  const a=this.avatar,r=a.renderer,head=a.bones.head?.getWorldPosition(new THREE.Vector3());
  const distance=head?a.camera.position.distanceTo(head):10;
  const headPixels=a.headRadius*a.canvas.height*a.camera.projectionMatrix.elements[5]/Math.max(.1,distance);
  // Keep extra strand/skin sampling for a face-filling Best-quality portrait.
  // Full-body and group views use the existing 4x MSAA without multiplying
  // every surface and diffusion buffer by four.
  this.supersampling=quality&&a.canvas.width*a.canvas.height<=700000&&headPixels>(this.supersampling?130:180);
  const scale=this.supersampling?2:1;
  const width=a.canvas.width*scale,height=a.canvas.height*scale;
  this.targets(width,height,quality);
  const target=r.getRenderTarget(),auto=r.shadowMap.autoUpdate;
  const saved=[];
  try{
   r.setRenderTarget(this.beauty);r.render(a.scene,a.camera);
   if(quality){
   r.shadowMap.autoUpdate=false;this.capture.value=true;
   a.model.traverse(n=>{if(!n.isMesh)return;for(const m of Array.isArray(n.material)?n.material:[n.material]){
    if(saved.some(v=>v.m===m))continue;
    if(m.transparent){saved.push({m,blending:m.blending,blendSrc:m.blendSrc,blendDst:m.blendDst,blendSrcAlpha:m.blendSrcAlpha,blendDstAlpha:m.blendDstAlpha});
     // Transparent occluders attenuate skin coverage as well as diffuse RGB.
     m.blending=THREE.CustomBlending;m.blendSrc=THREE.SrcAlphaFactor;m.blendDst=THREE.OneMinusSrcAlphaFactor;
     m.blendSrcAlpha=THREE.ZeroFactor;m.blendDstAlpha=THREE.OneMinusSrcAlphaFactor;
    }
   }});
   r.setRenderTarget(this.diffuse);r.render(a.scene,a.camera);this.capture.value=false;
   const u=this.filter.uniforms;u.nearPlane.value=a.camera.near;u.farPlane.value=a.camera.far;
   u.projectionScale.value=this.fxHeight*.5*a.camera.projectionMatrix.elements[5];
   u.radius.value=this.radius*a.model.getWorldScale(new THREE.Vector3()).y;
   this.quad.material=this.filter;u.inputMap.value=this.diffuse.texture;u.stepUV.value.set(1/this.fxWidth,0);
   r.setRenderTarget(this.ping);r.render(this.scene,this.camera);
   u.inputMap.value=this.ping.texture;u.stepUV.value.set(0,1/this.fxHeight);r.setRenderTarget(this.pong);r.render(this.scene,this.camera);
   }
   this.quad.material=this.composite;this.composite.uniforms.strength.value=this.strength;
   const c=this.composite.uniforms;c.exposure.value=r.toneMappingExposure;c.inverseProjection.value.copy(a.camera.projectionMatrixInverse);
   c.effects.value=quality;c.aoStrength.value=this.aoStrength;c.aoRadius.value=this.aoRadius*a.model.getWorldScale(new THREE.Vector3()).y;c.projectionScale.value=this.fxHeight*.5*a.camera.projectionMatrix.elements[5];
   r.setRenderTarget(target);r.render(this.scene,this.camera);
  }finally{
   for(const {m,...state} of saved)Object.assign(m,state);
   this.capture.value=false;r.shadowMap.autoUpdate=auto;r.setRenderTarget(target);
  }
 }
 release(){for(const key of ['beauty','diffuse','ping','pong','filter','composite']){this[key]?.dispose();this[key]=null;}this.quad?.geometry.dispose();}
 dispose(){this.release();this.filmic?.dispose();this.filmic=null;}
}
