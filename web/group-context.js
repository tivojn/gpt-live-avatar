// Resolve spoken vocatives without mistaking a filename or an ordinary mention
// of another character for the listener. All callers use the same rule.
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function address(text,cast=[]){
 const raw=String(text||'').trim();
 const filler='(?:(?:hi|hey|hello|okay|ok|well|uh|um|oh|please|你好|嗨|嘿)[\\s,，.!！:：]*)*';
 for(const c of [...cast].sort((a,b)=>(b.name||b.slug).length-(a.name||a.slug).length)){
  const name=escape(c.name||c.slug).replace(/[- ]/g,'[- ]?');
  const end="(?!['’]s\\b|[\\p{L}\\p{N}_]|\\.[a-z0-9]|\\s+dot\\b)";
  const match=raw.match(new RegExp('^'+filler+name+end,'iu'));if(match)return {slug:c.slug,text:raw.slice(match[0].length).replace(/^[\s,，.!！?？:：]+/,'')};
 }
 // A separated name at the end is a common spoken correction: "... , Tia".
 for(const c of cast){const name=escape(c.name||c.slug).replace(/[- ]/g,'[- ]?');
  const match=raw.match(new RegExp('[,，。.!！?？]\\s*(?:please\\s+)?'+name+'[.!！?？\\s]*$','iu'));if(match)return {slug:c.slug,text:raw.slice(0,match.index)};
 }
 return null;
}
export function addressedSpeaker(text,cast){return address(text,cast)?.slug||null;}
export function addressedText(text,cast){return address(text,cast)?.text||String(text||'');}
export function playbackEcho(text,candidates=[]){
 const normalize=s=>String(s||'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
 const value=normalize(text);if(value.length<28)return false;
 return candidates.some(s=>{const other=normalize(s);return other.length>=value.length&&other.includes(value);});
}
export function quotedContext(history,cast,human,limit=10000){
 const rows=[];let chars=0;
 for(const line of [...history].reverse()){
  const name=line.speaker==='_human'?`${human?.name||'You'} (real human)`:cast.find(c=>c.slug===line.speaker)?.name;
  if(!name||!line.text)continue;const row=`${name}${line.interrupted?' (interrupted)':''}: ${String(line.text).slice(0,1800)}`;
  if(chars+row.length>limit)break;rows.unshift(row);chars+=row.length;
 }
 return rows.join('\n');
}
