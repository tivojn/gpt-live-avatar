import * as THREE from '/vendor/three/three.module.js';
import { AvatarDiffusion } from '/avatar3d-diffusion.js';

const diffuseMarker='reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution );';
const surface=m=>m.userData.avatarPortrait||({Top_Tia01A_M:'skin',Hed_Hair_21A_Ponytail02_M:'hair',Hed_clr_M:'cornea',Hed_Eye_M:'iris'}[m.name.replace('Hair-','Hair_')]);
// Per-character calibration keeps the authored view and anatomy independent.
// Head offsets are measured in each source rig's units; face geometry stays intact.
const portraitSettings={
  tia:{displayTransform:'filmic',headOffset:.10050046,exposure:1.2,softExposure:1.35,hairEnvironment:.14,keyColor:0xfff0e9,rim:3,diffusionRadius:.16,channelVariance:[2.25,.027777778,.006944444],skinTint:[.42548996,.002338724,0]},
  sarah:{displayTransform:'filmic',headOffset:.10050046,exposure:1.2,softExposure:1.35,hairEnvironment:.05,hairSpecular:.06,hairTransport:.25,keyColor:0xfff0e9,rim:2.5,diffusionRadius:.16,channelVariance:[2.25,.027777778,.006944444],skinTint:[.42548996,.004867622,0]},
  iselda:{displayTransform:'filmic',headOffset:.0921685,exposure:1.5,softExposure:1.65,hairEnvironment:.2,keyColor:0xfff4fc,rim:4},
  'ming-mei':{displayTransform:'filmic',headOffset:.080164785,exposure:1.5,softExposure:1.65,hairEnvironment:.5,keyColor:0xfff4fc,rim:4,diffusionRadius:.14},
  seraphim:{displayTransform:'agx',headOffset:.10050046,exposure:1.2,softExposure:1.32,hairEnvironment:.065,keyColor:0xffe9e2,rim:2.5,diffusionRadius:.15,aoStrength:.5,channelVariance:[2.25,.027777778,.006944444]},
};
const restoredKeys=['roughness','metalness','specularIntensity','envMap','envMapIntensity','ior','aoMap','aoMapIntensity','alphaTest','shadowSide','opacity',
  'transmission','transparent','depthWrite','blending','blendSrc','blendDst','blendSrcAlpha','blendDstAlpha','forceSinglePass','vertexColors','alphaToCoverage','premultipliedAlpha'];

// Portrait materials remain ordinary skinned/morphable PBR materials. The
// extra shadow pass and transparency ordering are independent of the crop.
export class AvatarPortrait {
  constructor(avatar,appearance) {
    this.avatar=avatar;this.appearance=appearance;this.materials=new Map();this.meshes=[];this.maps=[];
    this.sorting={count:0,milliseconds:0};this.center=new THREE.Vector3();
    this.authored=[...appearance.materials.keys()].some(m=>m.userData.avatarPortraitProfile==='authored');
    this.calibration=portraitSettings[avatar.characterId];
    if(this.calibration)this.diffusion=new AvatarDiffusion(avatar,this.calibration);
    this.clothingHooks=new Map([...appearance.materials.keys()].filter(m=>!surface(m)).map(m=>[m,{onBeforeCompile:m.onBeforeCompile,customProgramCacheKey:m.customProgramCacheKey}]));
    this.hairCenter={value:new THREE.Vector3()};
    avatar.model.traverse(n=>{
      if(!n.isMesh)return;
      const materials=Array.isArray(n.material)?n.material:[n.material];
      for(const m of materials)if(surface(m)&&!this.materials.has(m))this.materials.set(m,{
        kind:surface(m),onBeforeCompile:m.onBeforeCompile,customProgramCacheKey:m.customProgramCacheKey,
        roughness:m.roughness,metalness:m.metalness,specularIntensity:m.specularIntensity,normalScale:m.normalScale?.clone(),
        envMapIntensity:m.envMapIntensity,envRotation:m.envMapRotation?.clone(),ior:m.ior,aoMap:m.aoMap,aoMapIntensity:m.aoMapIntensity,alphaTest:m.alphaTest,shadowSide:m.shadowSide,
        ...Object.fromEntries(restoredKeys.map(k=>[k,m[k]])),color:m.color.clone(),
      });
      const record={node:n,cast:n.castShadow,receive:n.receiveShadow,onBeforeRender:n.onBeforeRender,depth:n.customDepthMaterial,renderOrder:n.renderOrder};
      if(materials.some(m=>surface(m)==='hair')) {
        record.hair=true;
        record.shadow=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking,alphaTest:.55,side:THREE.DoubleSide});
        // WebGLShadowMap copies alphaTest from the visible material, even
        // onto a custom depth material. Keep the dense strand mask explicit
        // so wisps don't become opaque, speckled shadows on the face.
        record.shadow.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <alphatest_fragment>','if (diffuseColor.a < 0.55) discard;');};
        record.shadow.customProgramCacheKey=()=> 'avatar-hair-shadow-v1';
      }
      this.meshes.push(record);
    });
    this.combineHair();
  }

  combineHair(){
    const records=this.meshes.filter(r=>r.hair),nodes=records.map(r=>r.node),first=nodes[0];
    // Contact deforms hair after skinning and also owns CPU vertex queries.
    // The rigid-hair merge below cannot discard that attribute or controller.
    if(nodes.some(n=>n.geometry.hasAttribute('avatarHairRest')||(Array.isArray(n.material)?n.material:[n.material]).some(m=>m.defines?.AVATAR_HAIR_CONTACT)))return;
    const attrs=['position','normal','uv','skinIndex','skinWeight'];
    // Merge only compatible sections. Other avatars retain their own rigs.
    if(nodes.length<2||nodes.some(n=>!n.isSkinnedMesh||n.material!==first.material||n.parent!==first.parent||!n.matrix.equals(first.matrix)||
      !n.bindMatrix.equals(first.bindMatrix)||n.skeleton.bones.length!==first.skeleton.bones.length||
      n.skeleton.bones.some((b,i)=>b!==first.skeleton.bones[i])||!n.geometry.index||
      Object.keys(n.geometry.morphAttributes).length||attrs.some(k=>!n.geometry.attributes[k])))return;
    const count=nodes.reduce((sum,n)=>sum+n.geometry.attributes.position.count,0),g=new THREE.BufferGeometry();
    for(const k of attrs){
      const size=first.geometry.attributes[k].itemSize,Type=k==='skinIndex'?Uint16Array:Float32Array,array=new Type(count*size);let offset=0;
      for(const node of nodes){const at=node.geometry.attributes[k];for(let i=0;i<at.count;i++)for(let c=0;c<size;c++)array[(offset+i)*size+c]=at.getComponent(i,c);offset+=at.count;}
      g.setAttribute(k,new THREE.BufferAttribute(array,size));
    }
    const indices=new Uint32Array(nodes.reduce((sum,n)=>sum+n.geometry.index.count,0));let offset=0,base=0;
    for(const n of nodes){for(let i=0;i<n.geometry.index.count;i++)indices[offset+i]=base+n.geometry.index.getX(i);offset+=n.geometry.index.count;base+=n.geometry.attributes.position.count;}
    g.setIndex(new THREE.BufferAttribute(indices,1));
    const mesh=new THREE.SkinnedMesh(g,first.material);mesh.name='Portrait hair';mesh.bind(first.skeleton,first.bindMatrix);
    if(first.userData.avatarPreserveVolume)this.avatar.volumeSkin?.bind(mesh);
    mesh.position.copy(first.position);mesh.quaternion.copy(first.quaternion);mesh.scale.copy(first.scale);mesh.frustumCulled=false;
    first.parent.add(mesh);mesh.visible=false;
    this.unifiedHair={mesh,nodes,record:{node:mesh,hair:true,shadow:records[0].shadow}};
  }

  syncHair(){
    const u=this.unifiedHair;if(!u)return;
    const on=this.active&&u.nodes.every(n=>n.visible);
    // Keep original nodes visible to wardrobe/bounds bookkeeping while their
    // draw layer is disabled. Partial wardrobe selections fall back cleanly.
    for(const n of u.nodes)on?n.layers.disable(0):n.layers.enable(0);
    u.mesh.visible=on;u.mesh.material=u.nodes[0].material;u.mesh.castShadow=true;u.mesh.receiveShadow=true;u.mesh.customDepthMaterial=u.record.shadow;
  }

  async load(pack,bytes) {
    if(!pack?.portrait)return;
    const loaded=[];
    try {
      for(const key of ['skinAO','skinScatter']) {
        const data=await bytes(pack,pack.portrait[key]);
        const image=await createImageBitmap(new Blob([data]),{premultiplyAlpha:'none',colorSpaceConversion:'none'});
        if(image.width>2048||image.height>2048){image.close();throw Error('Portrait map is too large.');}
        const texture=new THREE.Texture(image);texture.flipY=false;texture.needsUpdate=true;
        loaded.push({key,texture,image});
      }
      if(this.avatar.disposed){for(const r of loaded){r.texture.dispose();r.image.close();}return;}
      for(const r of this.maps){r.texture.dispose();r.image.close();}
      this.maps=loaded;this.skinAO=loaded[0].texture;this.skinScatter=loaded[1].texture;
      await this.diffusion?.load();
    }catch(error){for(const r of loaded){r.texture.dispose();r.image.close();}throw error;}
  }

  studioEnvironment() {
    if(this.studioTarget)return this.studioTarget.texture;
    // Broad photographic light sources produce continuous strand highlights
    // and readable corneal reflections. The backdrop remains transparent;
    // this scene is used only for material illumination and reflections.
    const scene=new THREE.Scene();scene.background=new THREE.Color(.055,.06,.075);
    const panel=(color,power,position,size)=>{
      const material=new THREE.MeshBasicMaterial({color:new THREE.Color(color).multiplyScalar(power),side:THREE.DoubleSide});
      const mesh=new THREE.Mesh(new THREE.PlaneGeometry(...size),material);
      mesh.position.set(...position);mesh.lookAt(0,0,0);scene.add(mesh);
    };
    panel(0xfff1e5,12,[-2.2,2.8,3],[3.5,4]);
    panel(0xe5efff,5,[2.5,1.5,2],[2,3]);
    panel(0xffffff,16,[.7,2,-2.4],[2,3]);
    const generator=new THREE.PMREMGenerator(this.avatar.renderer);
    this.studioTarget=generator.fromScene(scene,.03);generator.dispose();
    scene.traverse(n=>{n.geometry?.dispose();n.material?.dispose();});
    return this.studioTarget.texture;
  }

  configure(style,profile) {
    this.active=style!=='classic';
    const a=this.avatar;
    for(const [m,b] of this.materials) {
      for(const key of restoredKeys)m[key]=b[key];m.color.copy(b.color);
      if(b.envRotation)m.envMapRotation.copy(b.envRotation);
      if(b.normalScale)m.normalScale.copy(b.normalScale);
      m.onBeforeCompile=b.onBeforeCompile;m.customProgramCacheKey=b.customProgramCacheKey;
      if(this.authored&&b.kind==='hair'){
        m.transparent=true;m.depthWrite=false;m.alphaTest=.025;m.alphaToCoverage=false;
      }
      if(!this.active){m.needsUpdate=true;continue;}
      if(b.kind==='hair') {
        // New packs preserve the original strand roughness and reflection
        // maps. Tia keeps her individually calibrated portrait material.
        m.metalness=this.authored?(m.userData.avatarSourceMetallic||0):0;
        m.specularIntensity=this.authored?(m.userData.avatarSourceSpecular??.3):.45;
        // Metallic-tinted authoring shaders need less environment reflection
        // than very dark dielectric strands to avoid a silver veil.
        m.envMapIntensity=this.authored?(m.specularIntensity<.12?.9:.28):.65;
        m.forceSinglePass=true;m.vertexColors=false;
        if(this.authored)m.normalScale.multiplyScalar(.5);else m.normalScale.set(.3,.3);m.alphaTest=.02;
        if(this.authored){
          // Composite ordered strands after the eye reflections, so an
          // independently sorted cornea cannot shine over the fringe.
          m.transparent=true;m.depthWrite=false;m.alphaTest=.025;m.alphaToCoverage=false;
        }
        m.onBeforeCompile=shader=>{
          b.onBeforeCompile.call(m,shader,a.renderer);
          // Shade the hair volume rather than each flat card independently.
          // The reference point follows the head through the same skeleton.
          shader.uniforms.portraitHairCenter=this.hairCenter;
          shader.vertexShader='varying vec3 portraitRound;\nuniform vec3 portraitHairCenter;\n'+shader.vertexShader;
          shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',
            '#include <project_vertex>\nportraitRound=mat3(viewMatrix)*((modelMatrix*vec4(transformed,1.0)).xyz-portraitHairCenter);');
          shader.fragmentShader='varying vec3 portraitRound;\n'+shader.fragmentShader;
          shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',
            '#include <normal_fragment_maps>\nnormal=normalize(mix(normal,normalize(portraitRound),'+(this.authored?'0.25':'0.6')+'));');
          shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',
            '#include <roughnessmap_fragment>\nroughnessFactor = max('+(this.authored?'0.045':'0.38')+', roughnessFactor);');
        };
        m.customProgramCacheKey=()=> 'avatar-portrait-hair-v3:'+this.authored;
      } else if(b.kind==='scalp') {
        // The scalp belongs underneath the transparent strands. Writing
        // its depth prevents it from being composited as a shiny headband.
        m.transparent=false;m.depthWrite=true;m.alphaTest=.15;
        m.roughness=.7;m.metalness=0;m.specularIntensity=.2;m.envMapIntensity=.5;
      } else if(b.kind==='lash') {
        m.transparent=true;m.depthWrite=false;m.alphaTest=.025;
        m.roughness=.95;m.metalness=0;m.specularIntensity=.05;m.envMapIntensity=.2;
      } else if(b.kind==='skin') {
        m.shadowSide=THREE.FrontSide;
        m.aoMap=this.skinAO||b.aoMap;m.aoMapIntensity=this.authored?.3:.6;m.specularIntensity=this.authored?(m.userData.avatarSourceSpecular??b.specularIntensity):.65;
        if(!this.authored)m.normalScale.set(.7,.7);
        m.onBeforeCompile=shader=>{
          b.onBeforeCompile.call(m,shader,a.renderer);
          const original=THREE.ShaderChunk.lights_physical_pars_fragment;
          if(!original.includes(diffuseMarker))throw Error('Portrait skin shader does not match the renderer.');
          // A wavelength-dependent approximation of skin diffusion.
          // The authored scattering map controls its local strength. Unlike
          // an additive rim, this preserves shading and obeys light shadows.
          const scatter=this.skinScatter?'texture2D(avatarScatterMap,vMapUv).r':'0.5';
          if(this.skinScatter){shader.uniforms.avatarScatterMap={value:this.skinScatter};shader.fragmentShader='uniform sampler2D avatarScatterMap;\n'+shader.fragmentShader;}
          const replacement=`float skinNL=dot(geometryNormal,directLight.direction);
            vec3 skinWrap=vec3(0.24,0.08,0.04);
            vec3 skinDiffusion=clamp((vec3(skinNL)+skinWrap)/(vec3(1.0)+skinWrap),0.0,1.0);
            float skinWeight=mix(0.45,0.8,${scatter});
            reflectedLight.directDiffuse += mix(vec3(saturate(skinNL)),skinDiffusion,skinWeight)
              * directLight.color * BRDF_Lambert(material.diffuseContribution);`;
          shader.fragmentShader=shader.fragmentShader.replace('#include <lights_physical_pars_fragment>',original.replace(diffuseMarker,replacement));
          shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',
            '#include <roughnessmap_fragment>\nroughnessFactor = max('+(this.authored?'0.12':'0.36')+', roughnessFactor);');
        };
        m.customProgramCacheKey=()=> 'avatar-portrait-skin-v1:'+Boolean(this.skinScatter);
      } else if(b.kind==='iris') {
        m.roughness=1;m.metalness=0;m.specularIntensity=0;
        if(!this.authored)m.onBeforeCompile=shader=>{
          b.onBeforeCompile.call(m,shader,a.renderer);
          shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',
            '#include <map_fragment>\nfloat irisLuma=dot(diffuseColor.rgb,vec3(0.2126,0.7152,0.0722));\n diffuseColor.rgb*=1.0+3.2*(1.0-smoothstep(0.025,0.14,irisLuma));');
        };m.customProgramCacheKey=()=> 'avatar-iris-v3:'+this.authored;
      } else if(b.kind==='cornea') {
        // The transparent desktop is absent from screen-space refraction.
        // Add the cornea's reflection while leaving the underlying iris and
        // compositor alpha intact, instead of refracting an empty buffer.
        m.ior=1.376;m.roughness=.025;m.envMapIntensity=.7;m.transmission=0;m.color.set(0);
        if(this.authored){m.envMapIntensity=.2;m.specularIntensity=.45;}
        m.transparent=true;m.depthWrite=false;m.blending=THREE.CustomBlending;
        m.blendSrc=THREE.OneFactor;m.blendDst=THREE.OneFactor;m.blendSrcAlpha=THREE.ZeroFactor;m.blendDstAlpha=THREE.OneFactor;
      }
      if(this.calibration&&b.kind==='skin'){
        // The diffusion pass handles transport; stacking the older wrapped
        // diffuse approximation on top double-counts red light at the edges.
        m.onBeforeCompile=b.onBeforeCompile;m.customProgramCacheKey=b.customProgramCacheKey;
      }
      m.needsUpdate=true;
    }
    if(this.active) {
      const lights=this.appearance.lights.children;
      [1.9,.32,.4,.45,.12].forEach((intensity,i)=>{lights[i].intensity=intensity;});lights[0].color.set(0xffefe0);
      if(this.authored){
        // These packs retain their author's skin mixes and iris colors. Use
        // the source's AgX family of view transform, without Tia's dark-iris
        // compensation or strong rounding of her separate hair cards.
        a.renderer.toneMapping=THREE.AgXToneMapping;
        lights[0].color.set(0xfffaf5);
      }
      a.renderer.toneMappingExposure=style==='soft'?.98:.92;
      if(this.authored){a.renderer.toneMappingExposure=style==='soft'?1.6:1.5;lights[0].intensity=style==='soft'?.65:1;}
      a.scene.environmentIntensity=style==='soft'?.6:.5;
      if(this.authored){a.scene.environment=this.studioEnvironment();a.scene.environmentRotation.set(0,0,0);a.scene.environmentIntensity=style==='soft'?1.15:1;}
      if(this.authored)for(const [m,b] of this.materials)if(['hair','cornea'].includes(b.kind)){
        // Three overrides envMapIntensity with scene.environmentIntensity
        // when envMap is null. Bind the studio map explicitly so the hair
        // and cornea can retain their separately calibrated reflections.
        m.envMap=a.scene.environment;m.needsUpdate=true;
      }
      this.key=lights[0];this.key.castShadow=true;
      this.key.shadow.bias=-.0004;this.key.shadow.normalBias=.004;
      a.scene.add(this.key.target);
    }
    if(this.calibration)this.configureAuthoredPortrait(style);
    for(const r of this.meshes) {
      const m=Array.isArray(r.node.material)?r.node.material[0]:r.node.material;
      r.node.renderOrder=this.authored&&r.hair?10:r.renderOrder;
      r.node.castShadow=this.active?surface(m)!=='cornea':r.cast;
      r.node.receiveShadow=this.active?surface(m)!=='cornea':r.receive;
      if(r.hair)r.node.customDepthMaterial=this.active?r.shadow:r.depth;
    }
    this.syncHair();
    this.quality(profile);
  }

  bindDiffusion() {
    if(this.diffusion)for(const m of this.appearance.materials.keys())this.diffusion.bind(m,surface(m));
  }

  configureAuthoredPortrait(style) {
    const a=this.avatar,settings=this.calibration;
    if(!this.portraitLights){
      this.portraitLights=new THREE.Group();a.scene.add(this.portraitLights);
      // Broad sources soften facial and strand highlights. The small panel
      // gives the cornea a legible catchlight without whitening the iris.
      // A lower, larger key reaches upright faces and a broad independent
      // fill opens eye sockets. Keep four sources and one shadow map.
      for(const [x,y,z,w,h,power] of [[-1.45,.85,2,2,2.2,2.9],[1.6,.15,1.8,2,2,1.35],[.6,.9,-1,1,1,settings.rim*.65],[-.25,.15,1,.24,.28,14]]){
        const light=new THREE.RectAreaLight(0xffffff,power,w,h);light.position.set(x,y,z);light.lookAt(0,0,0);this.portraitLights.add(light);
      }
    }
    this.portraitLights.visible=this.active;
    for(const [m,hooks] of this.clothingHooks)Object.assign(m,hooks);
    if(!this.active)return;
    a.renderer.toneMappingExposure=style==='soft'?settings.softExposure:settings.exposure;
    this.portraitLights.children[0].color.set(settings.keyColor);
    a.scene.environmentIntensity=.28;
    [.5,.05,.1,.05,.02].forEach((intensity,i)=>{this.appearance.lights.children[i].intensity=intensity;});
    for(const [m,b] of this.materials){
      if(b.kind==='hair'){
        m.normalScale.copy(b.normalScale);m.envMapIntensity=settings.hairEnvironment;
        // Scattering is not metalness. Metallic hair plus the studio panels
        // produced the silver bands across Sarah's blonde cards. Keep a
        // broad, restrained dielectric highlight without changing her color.
        if(settings.hairTransport!==undefined){m.metalness=0;m.roughness=.65;m.specularIntensity=settings.hairSpecular??.15;}
        m.onBeforeCompile=(shader,renderer)=>{
          b.onBeforeCompile.call(m,shader,renderer);
          // Filter subpixel normal variation instead of rounding hair cards
          // toward a sphere, which changed the fringe's apparent color.
          shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',
            '#include <normal_fragment_maps>\nfloat variance=max(dot(dFdx(normal),dFdx(normal)),dot(dFdy(normal),dFdy(normal)));roughnessFactor=sqrt(roughnessFactor*roughnessFactor+min(.2,variance*.5));');
        };
        m.customProgramCacheKey=()=>b.customProgramCacheKey.call(m)+':authored-strands-v1';
      }else if(b.kind==='skin'&&settings.skinTint&&this.skinScatter){
        // The older packs stored the chosen albedo before the author's
        // scattering-mask color mix. Apply that same mix to every selected
        // skin color without replacing the user's choice or its identifier.
        m.onBeforeCompile=(shader,renderer)=>{
          b.onBeforeCompile.call(m,shader,renderer);
          shader.uniforms.avatarSourceSkinMask={value:this.skinScatter};shader.uniforms.avatarSourceSkinTint={value:new THREE.Vector3(...settings.skinTint)};
          shader.fragmentShader='uniform sampler2D avatarSourceSkinMask;uniform vec3 avatarSourceSkinTint;\n'+shader.fragmentShader;
          shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','#include <map_fragment>\ndiffuseColor.rgb=mix(diffuseColor.rgb,avatarSourceSkinTint,texture2D(avatarSourceSkinMask,vMapUv).r);');
        };
        m.customProgramCacheKey=()=>b.customProgramCacheKey.call(m)+':source-skin-tint-v1';
      }else if(b.kind==='cornea'){
        m.specularIntensity=1;m.ior=1.5;m.opacity=.06;
        m.envMap=this.appearance.environmentTarget?.texture||a.scene.environment;m.envMapIntensity=.2;
      }
    }
    for(const m of this.appearance.materials.keys()){
      if(!m.isMeshStandardMaterial)continue;
      const hook=m.onBeforeCompile,cache=m.customProgramCacheKey;
      m.onBeforeCompile=(shader,renderer)=>{
        hook.call(m,shader,renderer);
        // Only the key uses its matching shadow. Applying that shadow to
        // the fill and rim also blacked out light arriving from other sides.
        // Every rectangular light uses the same surface/view lookup. Evaluate it
        // once per fragment; keep the original area-light integration intact.
        let physical=THREE.ShaderChunk.lights_physical_pars_fragment;
        physical='vec4 avatarLtc1,avatarLtc2; bool avatarLtcReady=false;\n'+physical;
        physical=physical.replace('vec2 uv = LTC_Uv( normal, viewDir, roughness );\n\t\tvec4 t1 = texture2D( ltc_1, uv );\n\t\tvec4 t2 = texture2D( ltc_2, uv );',
          'if(!avatarLtcReady){vec2 uv=LTC_Uv(normal,viewDir,roughness);avatarLtc1=texture2D(ltc_1,uv);avatarLtc2=texture2D(ltc_2,uv);avatarLtcReady=true;}\nvec4 t1=avatarLtc1;vec4 t2=avatarLtc2;');
        shader.fragmentShader=shader.fragmentShader.replace('#include <lights_physical_pars_fragment>',physical);
        shader.fragmentShader=shader.fragmentShader.replace('#include <shadowmap_pars_fragment>','#include <shadowmap_pars_fragment>\n#include <shadowmask_pars_fragment>');
        // The avatar owns these four rectangular lights; the key is created
        // first. Three unrolls this loop, so the shadow is sampled once.
        const lighting=THREE.ShaderChunk.lights_fragment_begin.replace('rectAreaLight = rectAreaLights[ i ];',
          'rectAreaLight = rectAreaLights[ i ];\n#if UNROLLED_LOOP_INDEX == 0\nrectAreaLight.color *= mix(1.,getShadowMask(),.8);\n#endif');
        shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_begin>',lighting);
      };
      m.customProgramCacheKey=()=>cache.call(m)+':authored-area-shadow-v4';m.needsUpdate=true;
    }
  }

  quality(profile='balanced') {
    this.profile=profile;
    // The resource-friendly preset needs cheaper lighting as well as smaller
    // textures. Approximate each studio panel by its incident light at the
    // head; Balanced/Best retain the original rectangular sources.
    if(this.portraitLights){
      if(!this.fastPortraitLights){this.fastPortraitLights=new THREE.Group();this.avatar.scene.add(this.fastPortraitLights);}
      if(!this.fastPortraitLights.children.length)for(const source of this.portraitLights.children){
        const light=new THREE.DirectionalLight();light.target=new THREE.Object3D();this.fastPortraitLights.add(light,light.target);light.userData.source=source;
      }
      for(const light of this.fastPortraitLights.children)if(light.isLight){const source=light.userData.source;light.color.copy(source.color);light.position.copy(source.position);light.intensity=source.intensity*source.width*source.height/Math.max(.1,source.position.lengthSq());}
      this.portraitLights.visible=this.active&&profile!=='eco';this.fastPortraitLights.visible=this.active&&profile==='eco';
    }
    const enabled=this.active&&profile!=='eco';
    const renderer=this.avatar.renderer;
    if(renderer.shadowMap.enabled!==enabled){renderer.shadowMap.enabled=enabled;this.avatar.model.traverse(n=>{for(const m of Array.isArray(n.material)?n.material:[n.material])if(m)m.needsUpdate=true;});}
    // Variance shadows showed large polygon-shaped self-shadow artifacts on
    // animated limbs. Filtered depth shadows preserve smooth skin in motion.
    renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    if(this.key){
      const size=profile==='quality'?2048:1024;
      this.key.shadow.radius=profile==='quality'?8:4;this.key.shadow.blurSamples=profile==='quality'?16:8;
      if(this.key.shadow.mapSize.x!==size){this.key.shadow.mapSize.set(size,size);this.key.shadow.map?.dispose();this.key.shadow.mapPass?.dispose();this.key.shadow.map=null;this.key.shadow.mapPass=null;}
    }
  }

  beforeRender() {
    this.syncHair();
    if(!this.active){
      if(this.authored)for(const r of this.meshes)if(r.hair&&r.node.visible)this.sortHair(r,this.avatar.camera,r.node.geometry);
      return;
    }
    const a=this.avatar;
    if(this.portraitLights&&a.bones.head){
      const scale=a.model.getWorldScale(new THREE.Vector3()).y;
      a.bones.head.getWorldPosition(this.portraitLights.position);
      this.portraitLights.position.y+=this.calibration.headOffset*scale;
      this.portraitLights.scale.setScalar(scale);
      // Studio illumination follows the viewing direction continuously, like
      // a portrait softbox beside the lens. Orbiting no longer leaves the
      // visible face on the unlit side of a world-fixed lighting setup.
      this.portraitLights.quaternion.copy(a.camera.quaternion);
      a.scene.environmentRotation.setFromQuaternion(a.camera.quaternion);
      for(const [m,b] of this.materials)if(m.envMap&&['hair','cornea'].includes(b.kind))m.envMapRotation.copy(a.scene.environmentRotation);
      if(this.fastPortraitLights){this.fastPortraitLights.position.copy(this.portraitLights.position);this.fastPortraitLights.scale.copy(this.portraitLights.scale);this.fastPortraitLights.quaternion.copy(this.portraitLights.quaternion);}
    }
    if(a.headCenter&&a.bones.head){
      if(!this.hairCenterLocal)this.hairCenterLocal=a.headCenter.clone().applyMatrix4(a.bones.head.matrixWorld.clone().invert());
      this.hairCenter.value.copy(this.hairCenterLocal).applyMatrix4(a.bones.head.matrixWorld);
    }
    if(this.key&&a.bounds) {
      const bounds=a.restBounds||a.bounds,height=Math.max(.1,bounds.max.y-bounds.min.y),span=height*.77;
      if(a.bones.hips)a.bones.hips.getWorldPosition(this.center);else bounds.getCenter(this.center);
      this.center.y+=height*.08;
      this.key.target.position.copy(this.center);
      const direction=this.portraitLights?this.portraitLights.children[0].position.clone().normalize().applyQuaternion(this.portraitLights.quaternion):new THREE.Vector3(-2.15,2.42,3.43).normalize();
      this.key.position.copy(this.center).addScaledVector(direction,height*2.8);
      const c=this.key.shadow.camera;c.left=-span;c.right=span;c.top=span;c.bottom=-span;c.near=height*.1;c.far=height*5;c.updateProjectionMatrix();
      this.key.target.updateMatrixWorld();
    }
    for(const r of this.unifiedHair?.mesh.visible?[this.unifiedHair.record]:this.meshes)if(r.hair){
      r.shadow.map=r.node.material.map;r.shadow.needsUpdate=r.shadow.map!==r.lastMap;r.lastMap=r.shadow.map;
      if(this.authored)r.node.renderOrder=10;
      if(r.node.visible)this.sortHair(r,a.camera,r.node.geometry);
    }
  }

  sortHair(record,camera,geometry) {
    const n=record.node,ix=geometry.index;
    if(!ix||ix.count%3||geometry.groups.length>1)return;
    let c=record.order;
    const head=this.avatar.bones.head||n;
    const inverse=new THREE.Matrix4().copy(head.matrixWorld).invert();
    const now=performance.now(),fresh=!c||c.geometry!==geometry;
    // Contact bends the tails relative to the head as the chest moves. A
    // camera-only cache would keep sorting their former, rigid positions.
    const contact=geometry.hasAttribute('avatarHairRest')&&this.avatar.bones.chest
      ? inverse.clone().multiply(this.avatar.bones.chest.matrixWorld) : null;
    const deformed=Boolean(contact&&(!c?.contact||contact.elements.some((v,i)=>Math.abs(v-c.contact.elements[i])>1e-5)));
    const direction=camera.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverse).normalize();
    if(!fresh&&(now-c.lastAt<65||(!deformed&&direction.distanceToSquared(c.direction)<.00015)))return;
    const started=now;
    if(fresh){
      c=record.order={geometry,source:ix.array.slice(),positions:new Float32Array(geometry.attributes.position.count*3),
        centers:new Float32Array(ix.count),z:new Float32Array(ix.count/3),counts:new Uint32Array(512),offsets:new Uint32Array(512),
        direction:new THREE.Vector3(Infinity,0,0),lastAt:-Infinity,contact:null};
    }
    if(fresh||deformed){
      const {source,positions,centers}=c,p=new THREE.Vector3();
      const matrix=inverse.clone().multiply(n.matrixWorld);n.skeleton?.update();
      for(let i=0;i<positions.length/3;i++){n.getVertexPosition(i,p).applyMatrix4(matrix);p.toArray(positions,i*3);}
      for(let t=0;t<ix.count/3;t++)for(let k=0;k<3;k++)centers[t*3+k]=(positions[source[t*3]*3+k]+positions[source[t*3+1]*3+k]+positions[source[t*3+2]*3+k])/3;
      c.contact=contact?.clone()||null;
    }
    c.direction.copy(direction);c.lastAt=now;
    const e=new THREE.Matrix4().multiplyMatrices(camera.matrixWorldInverse,head.matrixWorld).elements;
    let low=Infinity,high=-Infinity;
    for(let t=0;t<c.z.length;t++){
      const z=e[2]*c.centers[t*3]+e[6]*c.centers[t*3+1]+e[10]*c.centers[t*3+2];c.z[t]=z;low=Math.min(low,z);high=Math.max(high,z);
    }
    // Stable linear-time depth bins avoid a large comparison sort while
    // retaining sub-millimetre ordering at normal head sizes.
    const scale=511/Math.max(1e-6,high-low);c.counts.fill(0);
    for(let t=0;t<c.z.length;t++){c.z[t]=Math.min(511,Math.floor((c.z[t]-low)*scale));c.counts[c.z[t]]++;}
    let offset=0;for(let i=0;i<512;i++){c.offsets[i]=offset;offset+=c.counts[i];}
    for(let t=0;t<c.z.length;t++){const target=c.offsets[c.z[t]]++*3;for(let k=0;k<3;k++)ix.array[target+k]=c.source[t*3+k];}
    ix.needsUpdate=true;this.sorting.count++;this.sorting.milliseconds+=performance.now()-started;
  }

  dispose() {
    this.diffusion?.dispose();
    this.portraitLights?.removeFromParent();
    this.studioTarget?.dispose();this.studioTarget=null;
    if(this.unifiedHair){for(const n of this.unifiedHair.nodes)n.layers.enable(0);this.unifiedHair.mesh.removeFromParent();this.unifiedHair.mesh.geometry.dispose();this.unifiedHair=null;}
    for(const r of this.maps){r.texture.dispose();r.image.close();}
    for(const r of this.meshes){r.node.onBeforeRender=r.onBeforeRender;r.shadow?.dispose();}
    this.fastPortraitLights?.removeFromParent();
    this.key?.shadow.dispose();this.key?.target.removeFromParent();this.maps=[];this.meshes=[];
  }
}
