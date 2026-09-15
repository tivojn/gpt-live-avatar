'use strict';
const DEFAULT_SHORTCUTS=Object.freeze({recover:'CommandOrControl+Shift+0',closeup:'CommandOrControl+Shift+9'});
function normalize(value){
 if(typeof value!=='string'||value.length>100)throw Error('Choose a key combination.');
 const aliases={cmd:'Command',command:'Command',ctrl:'Control',control:'Control',cmdorctrl:'CommandOrControl',commandorcontrol:'CommandOrControl',alt:'Alt',option:'Alt',shift:'Shift'};
 const parts=value.split('+'),key=parts.pop(),mods=parts.map(x=>aliases[x.toLowerCase()]);
 if(mods.some(x=>!x)||new Set(mods).size!==mods.length||!mods.some(x=>x!=='Shift')||!/^(?:[a-z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Up|Down|Left|Right|Home|End|PageUp|PageDown)$/i.test(key))throw Error('Use Command, Control or Option with a letter, number or function key.');
 const named=['Space','Up','Down','Left','Right','Home','End','PageUp','PageDown'].find(x=>x.toLowerCase()===key.toLowerCase());
 return [...['CommandOrControl','Command','Control','Alt','Shift'].filter(x=>mods.includes(x)),named||key.toUpperCase()].join('+');
}
function physical(value,platform=process.platform){return value.replace('CommandOrControl',platform==='darwin'?'Command':'Control');}
function validate(values){
 const result=Object.fromEntries(Object.keys(DEFAULT_SHORTCUTS).map(k=>[k,normalize(values[k])]));
 if(physical(result.recover)===physical(result.closeup))throw Error('Choose a different shortcut for each action.');
 return result;
}
class AvatarShortcuts{
 constructor(api,callbacks){this.api=api;this.callbacks=callbacks;this.values={...DEFAULT_SHORTCUTS};this.registered=[];this.paused=false;this.errors={};}
 clear(){for(const key of this.registered)this.api.unregister(key);this.registered=[];}
 register(){this.errors={};for(const [name,key] of Object.entries(this.values)){try{if(!this.api.register(key,this.callbacks[name]))throw Error();this.registered.push(key);}catch{this.errors[name]='This shortcut is already in use. Choose another combination.';}}}
 start(values){try{this.values=validate(values);}catch{this.values={...DEFAULT_SHORTCUTS};}this.register();}
 pause(value){if(this.paused===value)return;this.paused=value;this.clear();if(!value)this.register();}
 change(values){
  const next=validate(values),previous=this.values;this.clear();this.values=next;this.register();
  const error=Object.values(this.errors)[0];
  if(error){this.clear();this.values=previous;this.register();}
  if(this.paused)this.clear();
  if(error)throw Error(error);
  return {...this.values};
 }
}
module.exports={DEFAULT_SHORTCUTS,normalize,validate,AvatarShortcuts};
