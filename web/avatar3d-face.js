import * as THREE from '/vendor/three/three.module.js';

// A small set of original Blender expressions supplements the speech rig.
// They remain GPU morphs, including normals, so smiling does not reskin the
// entire subdivided face on the CPU or leave closed-mouth lighting behind.
export class AvatarFace {
  constructor(avatar,appearance){this.avatar=avatar;this.appearance=appearance;this.channels=new Set();this.level=0;}
  async load(pack,bytes){
    if(!pack?.facialRig)return;
    if(!Array.isArray(pack.facialRig)||pack.facialRig.length>4)throw Error('Invalid facial rig.');
    for(const item of pack.facialRig){
      if(!['portraitSmile','portraitLaugh','portraitGrin','portraitJaw'].includes(item.channel))throw Error('Unknown facial channel.');
      if(this.channels.has(item.channel))continue;
      const records=this.appearance.decodeFace(await bytes(pack,item.file),false);
      if(this.avatar.disposed)return;
      const targets=[];
      for(const {mesh,indices,deltas,normals} of records){
        const g=mesh.geometry,count=g.attributes.position.count,old=mesh.morphTargetInfluences.slice();
        if(!g.morphTargetsRelative)throw Error('Facial rig requires relative morphs.');
        const positions=new Float32Array(count*3),normal=new Float32Array(count*3);
        for(let i=0;i<indices.length;i++)for(let k=0;k<3;k++){
          positions[indices[i]*3+k]=deltas[i*3+k];normal[indices[i]*3+k]=normals?.[i*3+k]||0;
        }
        const p=new THREE.BufferAttribute(positions,3),n=new THREE.BufferAttribute(normal,3);p.name=item.channel;n.name=item.channel;
        const pm=g.morphAttributes.position||(g.morphAttributes.position=[]),nm=g.morphAttributes.normal||(g.morphAttributes.normal=[]);
        while(nm.length<pm.length)nm.push(new THREE.BufferAttribute(new Float32Array(count*3),3));
        const index=pm.length;pm.push(p);nm.push(n);mesh.updateMorphTargets();
        old.forEach((v,i)=>{mesh.morphTargetInfluences[i]=v;});
        targets.push({mesh,index});
        if(!this.avatar.drivenMorphs.has(mesh))this.avatar.drivenMorphs.set(mesh,new Set());
        this.avatar.drivenMorphs.get(mesh).add(index);
        for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])material.needsUpdate=true;
      }
      this.avatar.channels.set(item.channel,targets);this.channels.add(item.channel);
    }
  }
  react(kind,now=performance.now()){
    const channel=kind==='laugh'?'portraitLaugh':'portraitSmile';
    if(!this.channels.has(channel))return false;
    this.reaction={channel,start:now,end:now+4500};return true;
  }
  expression(weights,selection,speaking,now=performance.now()){
    if(!this.channels.size)return;
    const manual=selection.expression&&selection.expression!=='neutral';
    if(selection.expression==='happy')weights.set('portraitSmile',Math.max(0,Math.min(1,Number(selection.expressionStrength??.7))));
    if(!manual){
      const smile=Math.max(weights.get('mouthSmileLeft')||0,weights.get('mouthSmileRight')||0)*2;
      if(smile>.52)weights.set('portraitSmile',Math.min(.85,(smile-.52)*1.8));
    }
    const r=this.reaction;
    if(r&&now<r.end){
      const envelope=Math.min(1,(now-r.start)/240,(r.end-now)/450);
      weights.set(r.channel,Math.max(weights.get(r.channel)||0,.9*Math.max(0,envelope)));
    }else this.reaction=null;
    for(const channel of this.channels){
      // Older appearance packs contain this custom sculpt. Keep it disabled
      // so Tia retains her original jaw proportions in every expression.
      if(channel==='portraitJaw'){weights.set(channel,0);continue;}
      // Preserve consonant closures and authored visemes during conversation.
      const target=(weights.get(channel)||0)*(speaking?.12:1);
      const dt=Math.min(100,Math.max(0,now-(this.at||now))),k=1-Math.exp(-dt/75);
      this[channel]=(this[channel]||0)+(target-(this[channel]||0))*k;
      weights.set(channel,this[channel]);
    }
    this.at=now;
    if([...this.channels].some(c=>c!=='portraitJaw'&&(weights.get(c)||0)>.2)){
      weights.delete('mouthSmileLeft');weights.delete('mouthSmileRight');weights.delete('jawOpen');
    }
  }
}
