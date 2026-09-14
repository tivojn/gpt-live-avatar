import {avatarIntent,motionIntent} from '/avatar3d-companion.js';
export function groupAction(text,cast,fallback){
 const raw=String(text||'').trim(),sorted=[...cast].sort((a,b)=>b.name.length-a.name.length);
 let target=sorted.find(c=>new RegExp('^(?:(?:hey|hi|hello)\\s+)?'+c.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b[,，:]?\\s+','i').test(raw));
 const body=target?raw.replace(new RegExp('^(?:(?:hey|hi|hello)\\s+)?'+target.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b[,，:]?\\s+','i'),''):raw;
 target=target||sorted.find(c=>c.slug===fallback)||sorted[0];if(!target)return null;
 const action=avatarIntent(body)||motionIntent(body,target.clips);return action?{slug:target.slug,action}:null;
}
