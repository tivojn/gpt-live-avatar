import {avatarIntent,motionIntent} from '/avatar3d-companion.js';
import {addressedSpeaker,addressedText} from '/group-context.js';
export function groupAction(text,cast,fallback){
 const raw=String(text||'').trim(),sorted=[...cast].sort((a,b)=>b.name.length-a.name.length);
 const target=sorted.find(c=>c.slug===addressedSpeaker(raw,cast))||sorted.find(c=>c.slug===fallback)||sorted[0];if(!target)return null;
 const body=addressedText(raw,cast);
 const action=avatarIntent(body)||motionIntent(body,target.clips);return action?{slug:target.slug,action}:null;
}
