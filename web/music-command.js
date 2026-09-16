// Recognize only a direct human request. Never feed avatar replies, song lyrics,
// documents, or partial speech transcripts to this router.
const clean = value => String(value || '').normalize('NFKC').replace(/[’‘]/g,"'").replace(/[‐‑–—]/g,'-').replace(/sing\s+(?:a\s+long)/gi,'sing along').replace(/dance\s+(?:a\s+long)/gi,'dance along').replace(/sing\s*-\s*along/gi,'sing along').replace(/dance\s*-\s*along/gi,'dance along').replace(/\s+/g,' ').trim();
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const aliases = list => (list || []).flatMap(item => typeof item === 'string' ? [{name:item,id:item}] : [item.name,item.slug,item.id].filter(Boolean).map(name=>({name,id:item.slug||item.id||item.name}))).sort((a,b)=>b.name.length-a.name.length);

export function musicCommand(text,{characters=[],character=''}={}) {
 let t=clean(text),target=character,player='';
 if(!t||t.length>500||/["“”`]/.test(t))return null;
 // Questions about the feature, reported speech, and negated requests must not
 // silently activate capture. A genuine stop request has its own positive verb.
 if(/\b(don't|do not|never|not yet|shouldn't|should not|can't|cannot)\b/i.test(t))return null;
 t=t.replace(/^(?:hi|hey|hello)\s*[,!]?\s*/i,'');
 const all=/^(?:everyone|everybody|all of you|you all)\s*[,!:]?\s*/i;
 if(all.test(t)){target='all';t=t.replace(all,'');}
 else for(const name of aliases(characters)) {
  const lead=new RegExp('^'+escape(name.name)+'(?:\\b|(?=\\s|[,!:]))\\s*[,!:]?\\s*','i');
  if(lead.test(t)){target=name.id;t=t.replace(lead,'');break;}
 }
 // Remove the small, ordinary request wrappers. Do not strip arbitrary text:
 // “tell me about singing along” must remain an informational question.
 for(let i=0;i<3;i++)t=t.replace(/^(?:please\s+|(?:can|could|would|will)\s+you\s+(?:please\s+)?|(?:i\s+(?:want|need|would like)|i'd like)\s+you\s+to\s+|let's\s+|let us\s+)/i,'');
 t=t.replace(/[.!?。！？]+$/g,'').trim().replace(/(?:[, ]+(?:please|thanks|thank you|now|for me))+$/i,'').trim();
 for(const name of aliases(characters)) {
  const tail=new RegExp('(?:,\\s*|\\s+)'+escape(name.name)+'$','i');
  if(tail.test(t)){target=name.id;t=t.replace(tail,'').trim();break;}
 }
 const selected=t.match(/\s+(?:on|from|in)\s+(spotify|apple music|music)(?:\s+(?:app|player))?$/i);
 if(selected){player=/spotify/i.test(selected[1])?'spotify':'music';t=t.slice(0,selected.index).trim();}
 t=t.replace(/\s+(?:right now|now|please)$/i,'').trim();
 t=t.replace(/^(?:start|begin|keep|continue)\s+(?:to\s+)?(singing|dancing|sing|dance)(?=\s)/i,(_m,v)=>/^sing/i.test(v)?'sing':'dance');
 t=t.replace(/^sing along and dance(?: along)?/i,'sing and dance along').replace(/^dance along and sing(?: along)?/i,'dance and sing along');
 let action,mode;
 if(/^(?:stop|end|quit|finish)\s+(?:the\s+)?(?:singing(?:\s+along)?|dancing(?:\s+along)?|sing[ -]?along|dance[ -]?along)(?:\s+(?:and|&)\s+(?:singing(?:\s+along)?|dancing(?:\s+along)?))?$/i.test(t)||/^(?:stop|end)\s+(?:the\s+)?(?:music\s+)?performance$/i.test(t))action='stop_singing';
 else {
  const along=/^(sing(?:\s+(?:and|&)\s+dance)?|dance(?:\s+(?:and|&)\s+sing)?)\s+along(?:\s+(?:(?:with|to)\s+)?(?:me|us|it|(?:the|this|that|current|playing|a)\s+(?:(?:current|playing)\s+)?(?:song|music|track|tune)|whatever(?:'s| is)\s+playing|what(?:'s| is)\s+playing)(?:\s+(?:(?:that(?:'s| is)|which is|is)\s+)?(?:playing(?:\s+now)?|on))?)?$/i;
  const toSong=/^(sing(?:\s+(?:and|&)\s+dance)?|dance(?:\s+(?:and|&)\s+sing)?)\s+(?:(?:with|to)\s+)?(?:the|this|that|current|playing)\s+(?:(?:current|playing)\s+)?(?:song|music|track|tune)(?:\s+(?:(?:that(?:'s| is)|which is|is)\s+)?(?:playing(?:\s+now)?|on))?$/i;
  const m=t.match(along)||t.match(toSong);
  if(m){mode=/sing/i.test(m[1])?'sing':'dance';action=mode==='sing'?'sing_along':'dance_along';}
 }
 // Direct multilingual commands share exactly the same execution path.
 if(!action&&/^(?:请|麻烦)?(?:跟着|随着|随|跟随)(?:这首歌|歌曲|音乐|歌)(?:一起)?(?:唱|唱歌|唱一下)(?:吧)?$|^(?:请)?(?:跟唱|一起跟唱)(?:这首歌)?(?:吧)?$/.test(t)){action='sing_along';mode='sing';}
 if(!action&&/^(?:请|麻烦)?(?:跟着|随着|随|跟随)(?:这首歌|歌曲|音乐|歌)(?:一起)?(?:跳舞|跳)(?:吧)?$/.test(t)){action='dance_along';mode='dance';}
 if(!action&&/^(?:停止|别再)(?:跟唱|唱歌|跳舞)(?:了)?$/.test(t))action='stop_singing';
 if(!action)return null;
 return {action,mode:mode||'stop',args:{character:target,...(player?{player}:{})}};
}

export function musicCommandMessage(command,result){
 if(command.action==='stop_singing')return result.stopped===false?'Already stopped.':'Stopped singing and dancing along.';
 const track=String(result.track||'').trim(),source=String(result.listeningTo||result.source||'the music player').trim();
 return `${command.mode==='dance'?'Dancing':'Lip-syncing and dancing'} along${track?' to '+track:' with '+source}.`;
}

export class MusicCommandRouter {
 constructor({execute,characters=()=>[],character=()=>'',before=()=>{},onResult=()=>{}}){Object.assign(this,{execute,characters,character,before,onResult});this.generation=0;this.seen=new Map();this.latest=null;}
 parse(text,meta={}){return musicCommand(text,{characters:this.characters(),character:meta.character||this.character()});}
 run(text,meta={}){
  const command=this.parse(text,meta);if(!command)return Promise.resolve({handled:false});
  const id=meta.id||'',key=id+'\0'+String(meta.character||command.args.character);
  if(id&&this.seen.has(key))return this.seen.get(key);
  const generation=++this.generation,cancelled=()=>generation!==this.generation||Boolean(meta.cancelled?.());
  const operation=(async()=>{
   let outcome;
   try{
    await this.before(command,meta);
    if(cancelled())return {handled:true,cancelled:true,command};
    const result=await this.execute(command.action,command.args,cancelled);
    if(cancelled())return {handled:true,cancelled:true,command};
    if(!result||result.ok!==true)throw Error(result?.error||'The music performance did not start.');
    outcome={handled:true,ok:true,command,result,text:musicCommandMessage(command,result)};
   }catch(error){
    if(cancelled())return {handled:true,cancelled:true,command};
    outcome={handled:true,ok:false,command,text:String(error?.message||error||'The music performance failed.')};
   }
   this.latest={id,text:clean(text),outcome};await this.onResult(outcome,meta);return outcome;
  })();
  if(id){this.seen.set(key,operation);while(this.seen.size>64)this.seen.delete(this.seen.keys().next().value);}
  return operation;
 }
 resultFor(id){if(!id)return undefined;const prefix=String(id)+'\0';for(const [key,result] of this.seen)if(key.startsWith(prefix))return result;}
 cancel(){this.generation++;}
}
