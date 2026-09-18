import * as THREE from '/vendor/three/three.module.js';

// A pose-space corrective sampled from the source body's localized Blender
// Corrective Smooth result. The same continuous field moves skin and clothing.
// This does not edit bind geometry, weights, bone transforms or motion timing.
const nameOf = bone => bone.userData.sourceName || bone.name;
const smooth = THREE.MathUtils.smoothstep;
const key = (x,y,z) => `${x},${y},${z}`;

function installShaders() {
  if (THREE.ShaderChunk.avatar_hip_corrective_ready) return;
  THREE.ShaderChunk.avatar_hip_corrective_ready = true;
  THREE.ShaderChunk.skinning_pars_vertex += `
#if defined(USE_SKINNING) && defined(AVATAR_HIP_CORRECTIVE)
attribute vec3 avatarHipOffset;
attribute vec4 avatarHipRotation;
uniform float avatarHipGain;
uniform mat4 avatarHipFrame;
vec3 avatarHipRotate(vec4 q, vec3 p) { return p + 2. * cross(q.xyz, cross(q.xyz,p) + q.w*p); }
#endif`;
  THREE.ShaderChunk.skinning_vertex += `
#if defined(USE_SKINNING) && defined(AVATAR_HIP_CORRECTIVE)
transformed += avatarHipGain * (bindMatrixInverse * avatarHipFrame * vec4(avatarHipOffset,0.)).xyz;
#endif`;
  THREE.ShaderChunk.skinnormal_vertex += `
#if defined(USE_SKINNING) && defined(AVATAR_HIP_CORRECTIVE)
mat3 hipBasis = mat3(bindMatrixInverse * avatarHipFrame);
hipBasis = mat3(normalize(hipBasis[0]),normalize(hipBasis[1]),normalize(hipBasis[2]));
vec4 hipRotation = normalize(mix(vec4(0.,0.,0.,1.),avatarHipRotation,avatarHipGain));
objectNormal = hipBasis * avatarHipRotate(hipRotation, transpose(hipBasis) * objectNormal);
#ifdef USE_TANGENT
objectTangent = hipBasis * avatarHipRotate(hipRotation, transpose(hipBasis) * objectTangent);
#endif
#endif`;
}

export class AvatarHipCorrective {
  constructor(avatar) {
    this.avatar=avatar; this.data=null; this.meshes=[]; this.depths=[];
    this.geometries=new WeakMap(); this.materials=new WeakMap(); this.bound=new WeakSet();
    this.uniforms={avatarHipGain:{value:0},avatarHipFrame:{value:new THREE.Matrix4()}};
    this.point=new THREE.Vector3(); this.matrix=new THREE.Matrix4();
    this.rootQ=new THREE.Quaternion(); this.hipQ=new THREE.Quaternion();
    installShaders();
    avatar.model.traverse(node=>{if(node.isSkinnedMesh)this.meshes.push(node);});
  }

  register(data) {
    if (!data) return;
    if (this.data) return; // One shared hip shape per avatar, independent of clip cache eviction.
    const finite = (v,n) => Array.isArray(v)&&v.length===n&&v.every(x=>Number.isFinite(x)&&Math.abs(x)<100);
    if(data.version!==1||data.kind!=='hip-surface-v1'||!finite(data.root,16)
      ||!Array.isArray(data.hips)||data.hips.length!==2||!data.hips.every(q=>finite(q,4))
      ||!Array.isArray(data.samples)||data.samples.length<100||data.samples.length>30000
      ||!data.samples.every(p=>finite(p,10))||data.radius!==.035)throw Error('Invalid hip corrective');
    const bones=this.avatar.options.bones;
    this.root=bones.find(b=>b.name==='root.x')?.node;
    this.hips=['l','r'].map(side=>bones.find(b=>b.name==='c_thigh_twist.'+side)?.node);
    if(!this.root||this.hips.some(b=>!b))throw Error('Hip corrective does not match the rig');
    this.referenceInverse=new THREE.Matrix4().fromArray(data.root).invert();
    this.referenceHips=data.hips.map(q=>new THREE.Quaternion().fromArray(q).normalize());
    this.grid=new Map();this.cell=data.radius;
    for(const p of data.samples){const k=key(...p.slice(0,3).map(x=>Math.floor(x/this.cell)));if(!this.grid.has(k))this.grid.set(k,[]);this.grid.get(k).push(p);}
    this.data=data;
    this.update();
  }

  update() {
    if(!this.data)return;
    this.root.getWorldQuaternion(this.rootQ).invert();
    let angle=0;
    for(let i=0;i<2;i++){
      this.hips[i].getWorldQuaternion(this.hipQ).premultiply(this.rootQ);
      angle=Math.max(angle,this.hipQ.angleTo(this.referenceHips[i]));
    }
    // Pose distance naturally fades during entry, exit, reverse and interruptions.
    // Normal standing and forward sitting remain exactly on the original path.
    this.uniforms.avatarHipGain.value=1-smooth(angle,THREE.MathUtils.degToRad(15),THREE.MathUtils.degToRad(50));
    this.uniforms.avatarHipFrame.value.multiplyMatrices(this.root.matrixWorld,this.referenceInverse);
  }

  prepareGeometry(node) {
    const g=node.geometry,previous=this.geometries.get(node);
    if(previous?.geometry===g)return previous;
    const p=g.attributes.position,j=g.attributes.skinIndex,w=g.attributes.skinWeight;
    const record={geometry:g,offset:null,rotation:null,count:0};
    if(!p||!j||!w)return record;
    const offsets=new Float32Array(p.count*3),rotations=new Float32Array(p.count*4);
    const supported=node.skeleton.bones.map(b=>nameOf(b)==='root.x'||nameOf(b).startsWith('c_thigh'));
    const q=new THREE.Quaternion(),radius=this.data.radius,radius2=radius*radius;
    for(let i=0;i<p.count;i++){
      rotations[i*4+3]=1;
      let influence=0;for(let c=0;c<4;c++)if(supported[j.getComponent(i,c)])influence+=w.getComponent(i,c);
      if(influence<.1)continue;
      this.point.fromBufferAttribute(p,i).applyMatrix4(node.bindMatrix);
      const {x,y,z}=this.point;
      if(y<.76||y>1.27)continue;
      const bx=Math.floor(x/this.cell),by=Math.floor(y/this.cell),bz=Math.floor(z/this.cell);
      let total=0,dx=0,dy=0,dz=0,qx=0,qy=0,qz=0,qw=0;
      for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++)for(let c=-1;c<=1;c++){
        for(const s of this.grid.get(key(bx+a,by+b,bz+c))||[]){
          const d=(s[0]-x)**2+(s[1]-y)**2+(s[2]-z)**2;if(d>=radius2)continue;
          const r=Math.sqrt(d)/radius,weight=(1-r)**4*(4*r+1);
          total+=weight;dx+=s[3]*weight;dy+=s[4]*weight;dz+=s[5]*weight;
          qx+=s[6]*weight;qy+=s[7]*weight;qz+=s[8]*weight;qw+=s[9]*weight;
        }
      }
      if(total<1e-12)continue;
      offsets.set([dx/total,dy/total,dz/total],i*3);
      q.set(qx,qy,qz,qw).normalize().toArray(rotations,i*4);record.count++;
    }
    {
      // Shared skin materials also render other primitives; give those a zero field.
      record.offset=new THREE.Float32BufferAttribute(offsets,3);record.rotation=new THREE.Float32BufferAttribute(rotations,4);
      g.setAttribute('avatarHipOffset',record.offset);g.setAttribute('avatarHipRotation',record.rotation);
    }
    this.geometries.set(node,record);return record;
  }

  bindMaterial(material) {
    if(!material||this.materials.get(material)===material.onBeforeCompile)return;
    const before=material.onBeforeCompile,cacheKey=material.customProgramCacheKey(),uniforms=this.uniforms;
    const hook=function(shader,renderer){before.call(this,shader,renderer);Object.assign(shader.uniforms,uniforms);};
    material.onBeforeCompile=hook;material.customProgramCacheKey=()=>cacheKey+'|hip-corrective-v1';
    material.defines={...material.defines,AVATAR_HIP_CORRECTIVE:1};material.needsUpdate=true;
    this.materials.set(material,hook);
  }

  bindCPU(node) {
    if(this.bound.has(node))return;
    this.bound.add(node);
    const original=node.applyBoneTransform,owner=this,offset=new THREE.Vector3(),matrix=new THREE.Matrix4();
    node.applyBoneTransform=function(index,target){
      original.call(this,index,target);
      const gain=owner.uniforms.avatarHipGain.value;if(!gain)return target;
      const attribute=owner.prepareGeometry(this).offset;if(!attribute)return target;
      offset.fromBufferAttribute(attribute,index);
      matrix.multiplyMatrices(this.bindMatrixInverse,owner.uniforms.avatarHipFrame.value);
      const e=matrix.elements,x=offset.x,y=offset.y,z=offset.z;
      offset.set(e[0]*x+e[4]*y+e[8]*z,e[1]*x+e[5]*y+e[9]*z,e[2]*x+e[6]*y+e[10]*z);
      return target.addScaledVector(offset,gain);
    };
  }

  beforeRender() {
    if(!this.data)return;
    this.update();
    for(const node of this.meshes){
      if(!this.prepareGeometry(node).count)continue;
      this.bindCPU(node);
      for(const m of Array.isArray(node.material)?node.material:[node.material])this.bindMaterial(m);
      if(!node.customDepthMaterial){node.customDepthMaterial=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});this.depths.push(node.customDepthMaterial);}
      this.bindMaterial(node.customDepthMaterial);this.bindMaterial(node.customDistanceMaterial);
    }
  }

  dispose(){for(const m of this.depths)m.dispose();this.meshes.length=0;this.grid?.clear();this.data=null;}
}
