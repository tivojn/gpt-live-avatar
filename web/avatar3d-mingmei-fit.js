const smooth=(x,a,b)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
// The fitted opaque back was weighted differently from the body beneath it.
// Match its local skin weights once when the garment is loaded; leave the
// loose skirt, face, body geometry and authored lace transparency untouched.
export function fitMingMeiDress(node){
 const g=node.geometry,p=g?.attributes.position,n=g?.attributes.normal;
 if(!p?.count||!n||g.userData.avatarMingMeiFit)return;
 let root=node;while(root.parent)root=root.parent;let body;
 root.traverse(o=>{if(o.isSkinnedMesh&&(o.userData.sourceName||o.name)==='Body')body=o;});
 if(!body?.geometry?.attributes.skinWeight)return;
 const bp=body.geometry.attributes.position,bn=body.geometry.attributes.normal,bi=body.geometry.attributes.skinIndex,bw=body.geometry.attributes.skinWeight;
 const sourceMap=body.skeleton.bones.map(b=>node.skeleton.bones.indexOf(b));
 const cell=.025,grid=new Map(),key=(x,y,z)=>x+','+y+','+z;
 for(let i=0;i<bp.count;i++){
  const x=bp.getX(i),y=bp.getY(i),z=bp.getZ(i);
  if(y<.86||y>1.20||Math.abs(x)>.20||z>.055||bn&&bn.getZ(i)>.2)continue;
  const k=key(Math.floor(x/cell),Math.floor(y/cell),Math.floor(z/cell));if(!grid.has(k))grid.set(k,[]);grid.get(k).push(i);
 }
 const position=p.clone(),indices=g.attributes.skinIndex.clone(),weights=g.attributes.skinWeight.clone();let changed=0,maximumEase=0;
 for(let i=0;i<p.count;i++){
  const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
  const blend=smooth(y,.84,.90)*(1-smooth(y,1.11,1.15))*(1-smooth(Math.abs(x),.11,.18))*(1-smooth(z,.015,.045));
  if(blend<=0||n.getZ(i)>.3)continue;
  const ix=Math.floor(x/cell),iy=Math.floor(y/cell),iz=Math.floor(z/cell),nearest=[];
  for(let dx=-2;dx<=2;dx++)for(let dy=-2;dy<=2;dy++)for(let dz=-2;dz<=2;dz++)for(const j of grid.get(key(ix+dx,iy+dy,iz+dz))||[]){
   const distance=(bp.getX(j)-x)**2+(bp.getY(j)-y)**2+(bp.getZ(j)-z)**2;
   if(distance>.04**2)continue;nearest.push({j,distance});
  }
  nearest.sort((a,b)=>a.distance-b.distance);nearest.length=Math.min(nearest.length,4);if(!nearest.length)continue;
  const influence=new Map(),add=(j,w)=>influence.set(j,(influence.get(j)||0)+w),total=nearest.reduce((s,v)=>s+1/Math.max(v.distance,1e-8),0);
  for(let k=0;k<4;k++)add(indices.getComponent(i,k),weights.getComponent(i,k)*(1-blend));
  for(const {j,distance} of nearest){const contribution=blend/(Math.max(distance,1e-8)*total);for(let k=0;k<4;k++){const index=sourceMap[bi.getComponent(j,k)];if(index>=0)add(index,bw.getComponent(j,k)*contribution);}}
  const keep=[...influence].sort((a,b)=>b[1]-a[1]).slice(0,4),sum=keep.reduce((s,v)=>s+v[1],0);
  if(sum<=0)continue;
  for(let k=0;k<4;k++){indices.setComponent(i,k,keep[k]?.[0]||0);weights.setComponent(i,k,(keep[k]?.[1]||0)/sum);}
  const ease=.009*blend;position.setXYZ(i,x+n.getX(i)*ease,y+n.getY(i)*ease,z+n.getZ(i)*ease);maximumEase=Math.max(maximumEase,ease);changed++;
 }
 g.setAttribute('position',position);g.setAttribute('skinIndex',indices);g.setAttribute('skinWeight',weights);g.computeBoundingBox();g.computeBoundingSphere();
 g.userData.avatarMingMeiFit={version:1,vertices:changed,maximumEase};node.boundingBox=null;node.boundingSphere=null;
}
