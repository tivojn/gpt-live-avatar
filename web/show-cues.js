// Spoken and typed cues for Avatar Show. The Director's live voice and the
// real human both drive the show with a few phrases; everything else is
// ordinary conversation for the Director.
export const CUE='Places, everyone!';
const PASS=/\b(?:i(?:'|\u2019)?ll|i will|i)\s+pass\b|\bpass(?: this| my)? (?:line|turn)\b|\bskip (?:my|this) line\b|^\s*pass[.!]?\s*$|\u6211(?:\u653e\u5f03|\u8df3\u8fc7|\u8fc7)(?:\u8fd9\u53e5|\u8fd9\u6bb5|\u5427)?|\u8df3\u8fc7(?:\u8fd9\u53e5|\u6211)?|\u66ff\u6211(?:\u8bf4|\u6f14)|\u6211\u5fd8\u8bcd\u4e86|\u5e2e\u6211\u8bf4/i;
const TAKEOVER=/\btake over (?:the rest|for me|my (?:role|part))\b|\b(?:understudy|standby)\b.*\b(?:rest|finish)\b|\u63a5\u7ba1(?:\u5269\u4e0b|\u540e\u9762)?|\u5269\u4e0b\u7684(?:\u66ff\u6211|\u4f60\u6765)/i;
const STOP=/\b(?:stop|end|cancel) the (?:show|play|performance)\b|\bstop the show\b|\u505c\u6b62(?:\u6f14\u51fa|\u8868\u6f14)|\u4e0d\u6f14\u4e86|\u7ed3\u675f(?:\u6f14\u51fa|\u8868\u6f14)/i;
const PREPARE=/\b(?:prepare|write|create|make|build|generate|start|begin|do|revise|rewrite|redo|update|fix|change) (?:the |a |our |my )?(?:show|play|script|performance)\b|\u4fee\u6539(?:\u5267\u672c|\u4e00\u4e0b)|\u91cd\u5199|\u6539(?:\u4e00\u4e0b|\u6539)?\u5267\u672c|\blet(?:'|\u2019)?s (?:go|start|begin|do it)\b|\bplaces,? everyone\b|\u5f00\u59cb(?:\u51c6\u5907|\u5199\u5267\u672c|\u6f14\u51fa|\u8868\u6f14|\u5427)|\u51c6\u5907(?:\u6f14\u51fa|\u4e00\u4e0b|\u5267\u672c|\u597d\u4e86)|\u5199(?:\u4e00\u4e2a|\u4e2a)?\u5267\u672c|\u6392\u7ec3|\u5c31\u8fd9\u6837(?:\u5f00\u59cb|\u5427)/i;
const START=/\b(?:start|begin|run|play|perform) (?:the |our )?(?:show|play|performance)\b|\bcurtain up\b|\baction!?\s*$|\u5f00\u6f14|\u5f00\u59cb\u6f14|\u5f00\u59cb\u8868\u6f14|\u6f14\u51fa\u5f00\u59cb/i;
const AGAIN=/\b(?:again|once more|replay|encore)\b|\u518d(?:\u6765|\u6f14|\u6765\u4e00\u6b21|\u6f14\u4e00\u904d)|\u91cd\u6f14/i;
export function userCue(text,phase='planning'){
 const t=String(text||'').trim();if(!t)return '';
 if(phase==='performing')return PASS.test(t)?(TAKEOVER.test(t)?'takeover':'pass'):TAKEOVER.test(t)?'takeover':STOP.test(t)?'stop':'';
 if(phase==='ready'||phase==='finished'){if(START.test(t)||phase==='finished'&&AGAIN.test(t))return 'start';}
 if(phase==='planning'||phase==='finished'||phase==='ready'){if(PREPARE.test(t))return 'prepare';}
 return '';
}
// The Director ends a briefing with the cue phrase; anything else it says is
// conversation. The phrase is stripped from captions so it is never spoken
// twice by a replayed transcript.
export function directorCue(text){return /places,?\s*everyone/i.test(String(text||''));}
export function stripCue(text){return String(text||'').replace(/\s*places,?\s*everyone[!.\u3002\uff01]*/ig,'').trim();}
// How much of a scripted line the human actually delivered, 0..1, so a half
// spoken line still counts as performed and a stray noise does not.
export function lineCoverage(heard,expected){
 const words=s=>String(s||'').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,' ').split(/\s+/).filter(Boolean);
 const h=words(heard),e=words(expected);if(!e.length)return h.length?1:0;
 if(!h.length)return 0;
 const cjk=/[\u3400-\u9fff]/.test(expected);
 if(cjk){const target=String(expected).replace(/[^\u3400-\u9fff]/g,''),got=String(heard).replace(/[^\u3400-\u9fff]/g,'');if(!target.length)return h.length?1:0;let hit=0;for(const ch of new Set(target))if(got.includes(ch))hit+=[...target].filter(x=>x===ch).length;return Math.min(1,hit/target.length);}
 const bag=new Map();for(const w of e)bag.set(w,(bag.get(w)||0)+1);let hit=0;for(const w of h){const n=bag.get(w)||0;if(n>0){bag.set(w,n-1);hit++;}}
 return Math.min(1,hit/e.length);
}
