// Local clothing ease, applied in the garment's authored rest space. Unlike a
// body cutout, this leaves skin intact when an animation lifts the hem.
const smooth=(x,a,b)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
export function garmentEase(character,name,x,y,z){
 if(character==='iselda'&&['Short Skirt','Long Skirt'].includes(name))return .008*smooth(y,.86,.94)*(1-smooth(y,1.00,1.04));
 if(character!=='sarah')return 0;
 if(/^Fem-A_Top_Ac_ChnCt(?:[._]|$)/.test(name))return .006;
 if(/^Fem-A_Bot_Ac_ChnPnts_1(?:[._]|$)/.test(name))return .007*smooth(y,.78,.93)*(1-smooth(y,1.025,1.065));
 if(name!=='Fem-A_Whl_Ac_VDress')return 0;
 return .022*(1-smooth(Math.abs(x),.035,.12))*smooth(y,.865,.91)*(1-smooth(y,1.01,1.12))*smooth(z,.015,.06);
}
export function fitGarment(character,node){
 const g=node.geometry,p=g?.attributes.position,n=g?.attributes.normal;
 if(!p?.count||!n||g.userData.avatarGarmentFit)return;
 const name=node.userData.sourceName||node.name;
 if(!(character==='iselda'&&['Short Skirt','Long Skirt'].includes(name))&&(character!=='sarah'||!(name==='Fem-A_Whl_Ac_VDress'||/^Fem-A_(?:Top_Ac_ChnCt|Bot_Ac_ChnPnts_1)(?:[._]|$)/.test(name))))return;
 const fitted=p.clone();let changed=0;
 for(let i=0;i<p.count;i++){
  const x=p.getX(i),y=p.getY(i),z=p.getZ(i),ease=garmentEase(character,name,x,y,z);if(!ease)continue;
  fitted.setXYZ(i,x+n.getX(i)*ease,y+n.getY(i)*ease,z+n.getZ(i)*ease);changed++;
 }
 g.setAttribute('position',fitted);g.computeBoundingBox();g.computeBoundingSphere();g.userData.avatarGarmentFit={version:1,vertices:changed};node.boundingBox=null;node.boundingSphere=null;
}
