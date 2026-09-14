// GPT-Live extension: retain all authored morphs on the CPU, upload only the
// currently used layers. The original morph dictionaries and weights stay intact.
// Pure helpers are separate so deformation equivalence can be tested exactly.
export function activeMorphLayers(influences) {
 const indices=[];
 for(let i=0;i<influences.length;i++)if(influences[i]!==0)indices.push(i);
 return indices;
}
export function copyMorphLayer(data,offset,stride,position,normal,color) {
 const count=position?.count||normal?.count||color?.count||0;
 for(let j=0;j<count;j++){
  let k=offset+j*stride;if(position){data[k]=position.getX(j);data[k+1]=position.getY(j);data[k+2]=position.getZ(j);}
  if(normal){data[k+4]=normal.getX(j);data[k+5]=normal.getY(j);data[k+6]=normal.getZ(j);}
  if(color){data[k+8]=color.getX(j);data[k+9]=color.getY(j);data[k+10]=color.getZ(j);data[k+11]=color.itemSize===4?color.getW(j):1;}
 }
}
export function morphCapacity(object,geometry,authoredCount){
 if(!geometry.userData.avatarMorphStreaming||object.isInstancedMesh)return authoredCount;
 const used=activeMorphLayers(object.morphTargetInfluences||[]).length;
 const capacity=Math.min(authoredCount,Math.max(geometry.userData.avatarMorphCapacity||8,Math.ceil(used/8)*8));
 geometry.userData.avatarMorphCapacity=capacity;return capacity;
}
