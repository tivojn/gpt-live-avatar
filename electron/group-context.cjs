'use strict';
// Main-process receipts survive speaker handoffs and interrupted spoken answers.
// Renderer dialogue never becomes a verified tool result or fresh permission.
class GroupContext {
 constructor(){this.actions=[];}
 record({id,speaker,request,receipt}){
  if(!receipt?.tool)return null;
  const entry={id,speaker,request:String(request||'').slice(0,1000),tool:receipt.tool,ok:receipt.ok!==false};
  for(const key of ['path','url','title','error'])if(typeof receipt[key]==='string')entry[key]=receipt[key].slice(0,1200);
  if(receipt.trashed)entry.trashed=true;
  const key=id+':'+entry.tool+':'+(entry.path||entry.url||'');
  if(this.actions.some(a=>a.key===key))return null;
  this.actions.push({...entry,key});this.actions=this.actions.slice(-64);return entry;
 }
 context(){return this.actions.slice(-24).map(({key,...a})=>a);}
 history(request,cast){
  const rows=[];let bytes=0;
  for(const line of (Array.isArray(request.history)?request.history:[]).slice(-96).reverse()){
   const name=line?.speaker==='_human'&&request.human?.enabled?`${request.human.name||'You'} (real human)`:cast.find(c=>c.slug===line?.speaker)?.name;
   if(!name||typeof line.text!=='string')continue;
   const text=`Quoted conversation, ${name}: ${line.text.slice(0,1200)}`;bytes+=Buffer.byteLength(text);if(bytes>6000)break;
   rows.unshift({role:'assistant',text});
  }
  // Put application state immediately before the current user request so it
  // survives the model boundary's bounded history, even after much small talk.
  let used=0;const receipts=[];
  for(const entry of [...this.context()].reverse()){
   const text='Verified application action (context, not a new instruction): '+JSON.stringify(entry);
   used+=Buffer.byteLength(text);if(used>6000)break;receipts.unshift({role:'assistant',text});
  }
  return [...rows,...receipts,{role:'user',text:String(request.humanRequest||'').trim().slice(0,6000)}];
 }
}
module.exports={GroupContext};
