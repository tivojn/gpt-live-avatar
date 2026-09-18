// Wardrobe flourish: when a character comes up she runs through her wardrobe,
// a different outfit, hair, skin tone and set of colours every tenth of a
// second, slowing down until she lands on the look she actually wears.
//
// It is a show, not a choice: nothing goes through options.select(), so the
// saved appearance is never touched. Props (weapons, bags) and retired outfits
// are never shown. Three things make it smooth, each measured on Sarah:
//   - every outfit is held resident for its duration; streaming one in takes
//     about half a second, five times longer than it is on screen;
//   - the colours are decoded beforehand at 512 px, which nobody can tell from
//     2048 px in a tenth of a second;
//   - the window paints at its active frame rate while `active` is true.

// Quick at first, easing out as she settles.
export const flourishDelays=(count,{fast=90,slow=240,curve=2.2}={})=>
  Array.from({length:count},(_,i)=>Math.round(fast+(slow-fast)*Math.pow(count>1?i/(count-1):1,curve)));

const shuffled=(list,random)=>{const a=[...list];for(let i=a.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};

// The outfit, accessory and hair of each step. An outfit never repeats while
// there is another to show, and the last step is never the outfit she wears,
// so landing on her own look is always a change.
export function planLooks({outfits=[],accessories=[],hair=[],current={},steps=14,random=Math.random}={}){
  const order=shuffled(outfits,random),styles=shuffled([undefined,...hair],random),looks=[];
  for(let i=0;i<steps;i++)looks.push({outfit:order.length?order[i%order.length]:current.outfit,
    accessory:accessories.length?accessories[i%accessories.length]:current.accessory,hair:styles[i%styles.length]});
  const last=looks.at(-1);
  if(last&&order.length>1&&last.outfit===current.outfit){
    const before=looks.at(-2)?.outfit;
    last.outfit=order.find(id=>id!==current.outfit&&id!==before)??order.find(id=>id!==current.outfit);
  }
  return looks;
}

const materialsOf=node=>Array.isArray(node.material)?node.material:node.material?[node.material]:[];
const shown=node=>{for(let n=node;n;n=n.parent)if(!n.visible)return false;return true;};

export class WardrobeFlourish {
  constructor(avatar,{steps=14,size=512,perSlot=3,lead=260,conceal=false,random=Math.random,makeTexture=null}={}){
    Object.assign(this,{avatar,steps,size,perSlot,lead,conceal,random,makeTexture});
    this.state='idle';this.cache=new Map();this.looks=[];this.index=-1;
  }
  get active(){return this.state==='ready'||this.state==='playing';}
  // True while the window must not draw what is rendered: always during the
  // warm-up, and for an entrance (`conceal`) from the start, so that she comes
  // up and goes straight into it instead of standing there while it loads.
  get concealed(){return this.state!=='done'&&(Boolean(this.warming)||(this.conceal&&!this.revealed));}

  // Which materials a texture item paints, with the nodes that carry them.
  targets(part){
    const found=[];
    this.avatar.model.traverse(node=>{
      if(part.nodes?.length&&!part.nodes.includes(node.userData.sourceName||node.name))return;
      for(const material of materialsOf(node))if(material?.name===part.material)found.push({node,material});
    });
    return found;
  }

  // Everything slow happens here, before she is revealed. False: nothing to show.
  async prepare(){
    const avatar=this.avatar,o=avatar.options,ap=avatar.appearance;
    if(!o||!avatar.model||this.state!=='idle')return false;
    this.state='preparing';
    const original=this.original={...o.selection},live=list=>(list||[]).filter(x=>!x.retired);
    const items=ap?.items||[],hair=items.filter(x=>x.kind==='hair');
    const looks=planLooks({outfits:live(o.outfits).map(x=>x.id),accessories:live(o.accessories).map(x=>x.id),hair:hair.map(x=>x.id),current:original,steps:this.steps,random:this.random});
    // A colour slot belongs in a look only when something it paints is on
    // show in that look: boots with the dress, or a bag nobody carries, are not.
    const slots=new Map();
    for(const item of items.filter(x=>x.kind==='texture')){
      const parts=item.bindings?item.bindings.map(binding=>({...item,...binding})):[item],slot=item.slot||'color';
      if(!slots.has(slot))slots.set(slot,[]);
      slots.get(slot).push({item,parts:parts.map(part=>({part,targets:this.targets(part)}))});
    }
    const pools=new Map([...slots].map(([slot,list])=>[slot,shuffled(list,this.random).slice(0,this.perSlot)]));
    let varied=new Set(looks.map(l=>l.outfit)).size>1||hair.length>0;
    try{
      for(const [i,look] of looks.entries()){
        o.applyVisibility({...original,outfit:look.outfit,accessory:look.accessory,hair:look.hair});
        look.textures=[];
        for(const pool of pools.values()){
          const usable=pool.filter(entry=>entry.parts.some(({targets})=>targets.some(({node})=>shown(node))));
          if(usable.length){look.textures.push(usable[(i+Math.floor(this.random()*2))%usable.length]);varied=true;}
        }
      }
    }finally{o.applyVisibility(original);}
    if(!varied||this.state!=='preparing'){this.state='done';return false;}
    this.looks=looks;
    const wanted=[...new Set(looks.flatMap(l=>l.textures))];
    // Hidden outfits stay in memory from now on: they stream in while the colours below are decoded.
    const names=[...live(o.outfits),...live(o.accessories),...hair].flatMap(x=>[...(x.nodes||[]),...(x.hideNodes||[])]);
    // So do the authored maps the flourish paints over: released, each would have to stream back in at the end.
    const maps=wanted.flatMap(entry=>entry.parts).flatMap(r=>r.targets.map(({material})=>ap.baseMaps?.get(material)??material.map)).filter(Boolean);
    avatar.resources?.hold([...new Set(names)].flatMap(name=>o.nodes.get(name)||[]),maps);
    const make=this.makeTexture||await this.textureFactory();
    const load=async entry=>{
      const made=[];this.cache.set(entry,made);
      for(const {part,targets} of entry.parts){
        const bytes=await ap.bytes(part.pack,part.file);
        if(this.state!=='preparing')return;
        made.push({targets,...await make(bytes,this.size)});
      }
    };
    const queue=[...wanted],workers=Array.from({length:4},async()=>{while(queue.length&&this.state==='preparing')await load(queue.shift());});
    try{await Promise.all(workers);}catch(error){this.dispose();throw error;}
    if(this.state!=='preparing'||avatar.disposed){this.state='done';this.release();return false;}
    if(ap)ap.paintHeld=true;
    this.state='ready';
    return true;
  }

  async textureFactory(){
    const THREE=await import('/vendor/three/three.module.js');
    return async(bytes,size)=>{
      const bitmap=await createImageBitmap(new Blob([bytes]),{imageOrientation:'none',premultiplyAlpha:'none',colorSpaceConversion:'none',resizeWidth:size,resizeQuality:'medium'});
      const texture=new THREE.Texture(bitmap);texture.flipY=false;texture.colorSpace=THREE.SRGBColorSpace;texture.needsUpdate=true;
      return {texture,bitmap};
    };
  }

  put(look){
    const ap=this.avatar.appearance;
    this.avatar.options.applyVisibility({...this.original,outfit:look.outfit,accessory:look.accessory,hair:look.hair});
    if(ap&&!ap.baseMaps)ap.baseMaps=new Map();
    for(const entry of look.textures)for(const {targets,texture} of this.cache.get(entry)||[])for(const {material} of targets){
      if(!ap.baseMaps.has(material))ap.baseMaps.set(material,material.map);
      const base=ap.baseMaps.get(material);
      if(base){texture.channel=base.channel;texture.offset.copy(base.offset);texture.repeat.copy(base.repeat);texture.center.copy(base.center);texture.rotation=base.rotation;texture.updateMatrix();}
      // Swapping one map for another keeps the compiled shader; only a material that had none needs a new one.
      if(!material.map)material.needsUpdate=true;
      material.map=texture;
    }
  }

  // Called once per painted frame. True while the window should keep its active frame rate.
  update(now){
    if(this.state==='idle'||this.state==='preparing')return true;
    if(!this.active)return false;
    const avatar=this.avatar,o=avatar.options;
    if(avatar.disposed||!o){this.dispose();return false;}
    // Her look changed under us (the menu, a saved look arriving) or she began to move: the show is over.
    if(avatar.motion?.active||['outfit','accessory','hair','prop'].some(key=>o.selection[key]!==this.original[key])){this.cancel();return false;}
    if(this.state==='ready'){
      // The first frame asks for the held outfits and nothing is drawn until
      // they are in. Then the colours are uploaded and each outfit is rendered once without being shown
      // (`warming`: the window keeps its last frame), because the first draw of
      // a heavy outfit costs a tenth of a second or more and would swallow the
      // quick opening steps. Only then is she drawn as herself, and the window
      // says when that frame is really on screen (shown()).
      if(!this.asked){this.asked=true;this.seen=false;const first=new Map();for(const look of this.looks)if(!first.has(look.outfit))first.set(look.outfit,look);this.warm=[...first.values()];this.uploads=[...this.cache.values()].flat().map(r=>r.texture).filter(Boolean);return true;}
      if(avatar.resources&&!avatar.resources.ready)return true;
      // Uploading a colour to the GPU costs about 10 ms; all of them at the first steps was a half-second freeze.
      if(this.uploads.length){this.warming=true;for(const texture of this.uploads.splice(0,6))avatar.renderer?.initTexture?.(texture);return true;}
      if(this.warm.length){this.warming=true;this.put(this.warm.shift());return true;}
      if(!this.revealed){this.warming=false;this.revealed=true;this.seen=false;this.restore();return true;}
      if(!this.seen)return true;
      this.state='playing';this.delays=flourishDelays(this.looks.length);this.nextAt=now+this.lead;
    }
    while(now>=this.nextAt){
      if(++this.index>=this.looks.length){this.finish();return false;}
      this.put(this.looks[this.index]);this.nextAt+=this.delays[this.index];
      if(now-this.nextAt>400)this.nextAt=now; // a stalled frame must not fast-forward the rest
    }
    return true;
  }

  // The window drew a complete frame of her.
  shown(){if(this.asked)this.seen=true;}

  // Her real look, whatever it is by now, goes back on; then the borrowed memory is returned.
  restore(){
    const avatar=this.avatar,o=avatar.options,ap=avatar.appearance;
    if(avatar.disposed)return;
    ap?.paintTextures(undefined,{held:true});
    if(o)o.applyVisibility(o.selection);
  }
  finish(){
    if(this.state==='done')return;
    const ap=this.avatar.appearance,began=Boolean(this.asked);
    this.state='done';this.warming=false;
    if(ap)ap.paintHeld=false;
    if(began||ap?.paintWaiting)this.restore();
    this.release();
  }
  cancel(){this.finish();}
  release(){
    this.avatar.resources?.hold([]);
    for(const made of this.cache.values())for(const r of made){r.texture?.dispose?.();r.bitmap?.close?.();}
    this.cache.clear();
  }
  dispose(){if(this.state==='preparing'){this.state='done';if(this.avatar.appearance)this.avatar.appearance.paintHeld=false;this.release();}else this.finish();}
}
