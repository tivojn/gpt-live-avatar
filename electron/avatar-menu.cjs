'use strict';
// The right-click menu has one shape in both windows. The top is what you do
// now (talk, ask), the middle is what you choose (Perform, Look, Character,
// Agent, View), the bottom is the app itself (Settings, updates, version, Quit).
// Each group is built here so the solo avatar and a character in the Avatar
// Show window cannot drift apart.
const {musicMenu}=require('./music-menu.cjs');

// Motions, poses, outfits and the rest come from the avatar package's own catalogue.
function catalogueMenu(cat,send){
  if(!cat||typeof cat!=='object')return {motions:[],look:[]};
  const current=cat.current||{};
  const item=(kind,x,checked)=>({label:String(x.label||x.id).slice(0,60),type:checked===undefined?'normal':'radio',checked:Boolean(checked),click:send(`${kind}:${x.id}`)});
  const byCategory=new Map();
  for(const c of cat.clips||[]){const key=String(c.category||'Motions');if(!byCategory.has(key))byCategory.set(key,[]);byCategory.get(key).push(c);}
  const motions=[...byCategory.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([category,clips])=>({label:category,submenu:clips.slice(0,40).map(c=>item('motion',c))}));
  const look=[];
  if((cat.outfits||[]).length)look.push({label:'Outfit',submenu:cat.outfits.map(o=>item('outfit',o,current.outfit===o.id))});
  if((cat.poses||[]).length)look.push({label:'Pose',submenu:[{label:'Natural',type:'radio',checked:!current.pose,click:send('pose:')},...cat.poses.slice(0,60).map(p=>item('pose',p,current.pose===p.id))]});
  if((cat.props||[]).length)look.push({label:'Props',submenu:[{label:'None',type:'radio',checked:!current.prop,click:send('prop:')},...cat.props.map(p=>item('prop',p,current.prop===p.id))]});
  if((cat.accessories||[]).length)look.push({label:'Accessories',submenu:cat.accessories.map(x=>item('appearance:accessory',x,current.accessory===x.id))});
  if((cat.expressions||[]).length){
    const presets=cat.expressions.filter(x=>!x.id.startsWith('original-')),original=cat.expressions.filter(x=>x.id.startsWith('original-'));
    const sub=presets.map(x=>item('appearance:expression',x,(current.expression||'neutral')===x.id));
    for(const [prefix,label] of [['original-brow','Original brows'],['original-eye','Original eyes'],['original-mth','Original mouth']]){
      const choices=original.filter(x=>x.id.startsWith(prefix));
      if(choices.length)sub.push({label,submenu:choices.map(x=>item('appearance:expression',x,current.expression===x.id))});
    }
    look.push({label:'Expression',submenu:sub});
  }
  if((cat.lighting||[]).length)look.push({label:'Lighting',submenu:cat.lighting.map(x=>item('appearance:lighting',x,current.lighting===x.id))});
  const colors=new Map();
  for(const asset of cat.assets||[])if(asset.kind==='texture'){if(!colors.has(asset.slot))colors.set(asset.slot,[]);colors.get(asset.slot).push(asset);}
  if(colors.size)look.push({label:'Original colors',submenu:[...colors].map(([slot,choices])=>({
    label:slot.replace(/-/g,' ').replace(/^./,c=>c.toUpperCase()),submenu:[
      {label:'Original color',type:'radio',checked:!current['texture:'+slot],click:send('appearance:texture:'+slot+':')},
      ...choices.map(x=>item('appearance:texture:'+slot,x,current['texture:'+slot]===x.id)),
    ]}))});
  look.push({type:'separator'},{label:'Restore default look',click:send('appearance-reset')});
  return {motions,look};
}

// Perform: every way to make her move, and the one way to make her stop.
function performMenu(state,send,character){
  const {motions}=catalogueMenu(state.catalogue,send),music=musicMenu(state,send,character);
  const stop=music.at(-1),dance=music.at(-2),status=music.slice(0,-2);
  return {label:'Perform',submenu:[...status,...motions,...(motions.length?[{type:'separator'}]:[]),dance,{label:'Stay Still',click:send('stay')},stop]};
}
const lookMenu=(state,send)=>({label:'Look',submenu:catalogueMenu(state.catalogue,send).look});
// Which engine thinks and which one acts, with its permissions.
const agentMenu=(reasoning,permissions)=>({label:'Agent',submenu:[reasoning,permissions].filter(Boolean)});
const bubbleItems=(mode,send)=>[['auto','Bubble on Incoming Messages'],['always','Bubble Always On'],['off','Bubble Off']].map(([id,label])=>({label,type:'radio',checked:(mode||'auto')===id,click:send('bubble:'+id)}));

module.exports={catalogueMenu,performMenu,lookMenu,agentMenu,bubbleItems};
