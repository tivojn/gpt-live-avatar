'use strict';
// The host exposes visual controls only. Native agent runtimes own all file,
// shell, browser and computer tools, their credentials and their permissions.
const shape=(name,description,properties={})=>({type:'function',name,description,strict:true,parameters:{type:'object',properties,required:Object.keys(properties),additionalProperties:false}});
const str=description=>({type:'string',description});
const TOOLS=[
 shape('avatar_state','Get visible avatars and their installed motion IDs before choosing an exact motion.'),
 shape('move_avatar','Move a visible character across the screen. Screen positions are unrelated to file folders.',{character:str('Visible character name or slug.'),destination:{type:'string',enum:['upper-left','upper-right','lower-left','lower-right','center','left','right','top','bottom']}}),
 shape('play_motion','Play an installed motion on a visible character. Get avatar_state first for exact IDs.',{character:str('Visible character name or slug.'),motion:str('Exact installed motion ID.')}),
];
function latestUserRequest(history){
 const items=Array.isArray(history)?history.slice(-48):[];
 const end=items.findLastIndex(x=>x?.role==='user'&&typeof x.text==='string');
 if(end<0)return '';let start=end;
 while(start>0&&items[start-1]?.role==='user'&&typeof items[start-1].text==='string')start--;
 return items.slice(start,end+1).map(x=>x.text.trim()).filter(Boolean).join(' ');
}
function createAvatarTools({avatarCommand,progress=()=>{}}){
 return {tools:TOOLS,execute:async(name,args,signal)=>{
  signal.throwIfAborted();
  const def=TOOLS.find(t=>t.name===name);
  if(!def||!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).some(k=>!Object.hasOwn(def.parameters.properties,k))||def.parameters.required.some(k=>typeof args[k]!=='string'||args[k].length>160))throw Error('Invalid avatar tool arguments.');
  if(name==='move_avatar'&&!def.parameters.properties.destination.enum.includes(args.destination))throw Error('Choose a supported screen destination.');
  progress({tool:name,state:'working'});
  const result=await avatarCommand(name==='avatar_state'?'state':name,args,signal);
  signal.throwIfAborted();progress({tool:name,state:result?.ok===false?'error':'done'});
  return result;
 }};
}
module.exports={TOOLS,latestUserRequest,createAvatarTools};
