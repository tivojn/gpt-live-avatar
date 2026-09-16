'use strict';
// Avatar Show: the Playwright turns a Director briefing into a validated
// stage script. Everything here is pure (no Electron, no network) so the
// prompt, the parser and the casting rules are unit-testable.
const EXPRESSIONS=['smile','sad','surprise','anger'];
const LENGTHS={short:'about 12 to 16 lines in one or two scenes',medium:'about 20 to 28 lines in two or three scenes',long:'about 32 to 44 lines in three or four scenes'};
const MAX_WANTED=3;
const clean=(s,max)=>typeof s==='string'?s.replace(/\s+/g,' ').trim().slice(0,max):'';
const idOK=s=>typeof s==='string'&&/^[a-z0-9][a-z0-9_-]{0,39}$/.test(s);
const number=(v,min,max,fallback)=>{const n=Number(v);return Number.isFinite(n)?Math.min(max,Math.max(min,n)):fallback;};

// Performers and the standby. A real human role always keeps one installed
// character free to step in, so the show never stalls on a forgotten line.
function castPlan({characters=[],user={},understudy=''}={}){
 const cast=characters.filter(c=>c&&idOK(c.slug)&&clean(c.name,60));
 if(!cast.length)throw Error('Choose at least one character for the show.');
 if(!user.enabled)return {performers:cast,understudy:null,user:null};
 if(cast.length<2)throw Error('With you in a role, choose at least two characters: one performer and one standby.');
 const standby=cast.find(c=>c.slug===understudy)||cast[cast.length-1];
 return {performers:cast.filter(c=>c!==standby),understudy:standby,user:{name:clean(user.name,40)||'You',role:clean(user.role,80)}};
}
function motionCatalogue(characters=[]){
 const merged=new Map();
 for(const c of characters)for(const clip of Array.isArray(c.clips)?c.clips:[]){
  if(!idOK(clip?.id))continue;const entry=merged.get(clip.id)||{id:clip.id,label:clean(clip.label,60)||clip.id,category:clean(clip.category,40)||'Motions',owners:new Set()};
  entry.owners.add(c.slug);merged.set(clip.id,entry);
 }
 return [...merged.values()].map(e=>({id:e.id,label:e.label,category:e.category,missing:characters.map(c=>c.slug).filter(s=>!e.owners.has(s))})).slice(0,160);
}
function transcriptText(transcript,max=6000){
 const lines=(Array.isArray(transcript)?transcript:[]).slice(-60).map(x=>{const who=x?.role==='director'?'Director':x?.role==='user'?'User':'';const text=clean(x?.text,800);return who&&text?who+': '+text:'';}).filter(Boolean);
 return lines.join('\n').slice(-max);
}
function playwrightRequest(request={}){
 const id=String(request.id||'');if(!/^[a-z0-9_-]{1,100}$/i.test(id))throw Error('Invalid script request.');
 const plan=castPlan(request),catalogue=motionCatalogue(request.characters),theme=clean(request.brief?.theme,600),notes=clean(request.brief?.notes,1200),transcript=transcriptText(request.brief?.transcript);
 if(!theme&&!transcript&&!notes)throw Error('Tell the Director what the show is about first.');
 const performers=plan.performers.map(c=>`- ${c.name} (slug "${c.slug}")${clean(c.persona,200)?': '+clean(c.persona,200):''}`).join('\n');
 const motions=catalogue.map(m=>`${m.id} — ${m.label} [${m.category}]${m.missing.length?' (not installed for: '+m.missing.join(', ')+')':''}`).join('\n');
 const length=LENGTHS[request.length]||LENGTHS.medium;
 const userPart=plan.user?`A real human, ${plan.user.name}, acts one role${plan.user.role?' ('+plan.user.role+')':''}. Use speaker "user" for their lines. Give them only a few lines: 3 to 5 in a short play, at most about a fifth of all lines otherwise, and exactly the number the brief asks for when it names one. Spread them through the play, each at most 20 words, easy to read aloud, and never dependent on improvisation. The other roles carry the story. ${plan.understudy.name} (slug "${plan.understudy.slug}") is the standby who steps in for the human; do not give the standby a role of their own and do not list them in the cast.`:'The audience only watches; do not use speaker "user".';
 const previous=request.previous&&typeof request.previous==='object'?`\n\nPrevious script (JSON):\n${JSON.stringify(request.previous).slice(0,20000)}\n\nFeedback to apply: ${clean(request.feedback,1500)||'Improve pacing and clarity.'}\nRevise the previous script according to the feedback. Keep what already works, keep the same cast slugs, and return the complete revised script.`:'';
 const text=`Show brief from the Director conversation.\nTheme: ${theme||'(see conversation)'}\n${notes?'Notes: '+notes+'\n':''}${transcript?'Conversation:\n'+transcript+'\n':''}\nPerformers (installed animated characters):\n${performers}\n${userPart}\n\nInstalled motion clips (id — label [category]):\n${motions||'(none)'}\n\nLength: ${length}.${previous}\n\nReturn the script now as JSON only.`;
 const instructions=`You are the Playwright of Avatar Show, a small theatre of animated 3D desktop characters. Each character speaks its lines with a text-to-speech voice, can play one installed motion clip per line and can show a facial expression (smile, sad, surprise, anger with intensity 0 to 1). Write a complete, performable short play from the brief: a clear title, a one-paragraph synopsis, a role for every performer (invent fitting character names for the roles), and scenes made of lines. Every line has: speaker (a performer slug, or "user" for the real human role when one exists), text (1 to 3 spoken sentences, natural dialogue, no stage directions inside the text), optional motion (an installed clip id chosen for that moment, on roughly half of the lines, never invented), optional expression (object with some of smile, sad, surprise, anger as numbers 0 to 1), optional note (a short stage direction for the Director). Lines of one speaker never mention motion ids or slugs in the spoken text. Write the dialogue in the language the user used in the brief (default English); role names may match that language. If the play truly needs a motion that is not installed, you may add up to ${MAX_WANTED} entries to wantedMotions, each with a new id (lowercase letters, digits, hyphens), a short label, a Meshy text-to-motion prompt describing one person who stays facing the camera with feet planted (no turning, no walking away, expressive arms, head and upper body), a duration in seconds (3 to 6), aliases (a few words, may include Chinese), an expression object, and fallback set to the closest installed id; lines may reference a wanted id in motion. Output strictly one JSON object with keys title, synopsis, cast (array of {slug, role}), userRole (null, or {name, role} when the human acts), scenes (array of {title, setting, lines}), wantedMotions (array, possibly empty). No markdown, no commentary before or after the JSON.`;
 return {id,history:[{role:'user',text}],instructions,plan,catalogue};
}
function extractJSON(text){
 let s=String(text||'').trim();const fence=s.match(/```(?:json)?\s*([\s\S]*?)```/i);if(fence)s=fence[1].trim();
 const start=s.indexOf('{'),end=s.lastIndexOf('}');if(start<0||end<=start)throw Error('The Playwright returned no script. Please try again.');
 try{return JSON.parse(s.slice(start,end+1));}catch{throw Error('The Playwright returned an unreadable script. Please try again.');}
}
function parseScript(text,request={}){
 const raw=typeof text==='string'?extractJSON(text):text;if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('The script is not an object.');
 const plan=castPlan(request),catalogue=motionCatalogue(request.characters),installed=new Set(catalogue.map(m=>m.id)),performers=new Map(plan.performers.map(c=>[c.slug,c]));
 const wanted=[];const seen=new Set();
 for(const w of Array.isArray(raw.wantedMotions)?raw.wantedMotions.slice(0,MAX_WANTED):[]){
  if(!idOK(w?.id)||installed.has(w.id)||seen.has(w.id))continue;seen.add(w.id);
  const expression={};for(const key of EXPRESSIONS){const v=Number(w.expression?.[key]);if(Number.isFinite(v)&&v>0)expression[key]=Math.min(1,v);}
  wanted.push({id:w.id,label:clean(w.label,40)||w.id,prompt:clean(w.prompt,600),duration:number(w.duration,3,6,4),aliases:(Array.isArray(w.aliases)?w.aliases:[]).map(a=>clean(a,30)).filter(Boolean).slice(0,6),expression,fallback:installed.has(w.fallback)?w.fallback:''});
 }
 const wantedIds=new Set(wanted.map(w=>w.id));
 const cast=[];for(const c of Array.isArray(raw.cast)?raw.cast:[]){if(performers.has(c?.slug)&&!cast.some(x=>x.slug===c.slug))cast.push({slug:c.slug,name:performers.get(c.slug).name,role:clean(c.role,80)||performers.get(c.slug).name});}
 for(const c of performers.values())if(!cast.some(x=>x.slug===c.slug))cast.push({slug:c.slug,name:c.name,role:c.name});
 const userRole=plan.user?{name:plan.user.name,role:clean(raw.userRole?.role,80)||plan.user.role||plan.user.name,understudy:plan.understudy.slug,understudyName:plan.understudy.name}:null;
 const scenes=[];let count=0;
 for(const s of Array.isArray(raw.scenes)?raw.scenes.slice(0,12):[]){
  const lines=[];
  for(const l of Array.isArray(s?.lines)?s.lines:[]){
   const speaker=l?.speaker==='user'?(userRole?'user':''):performers.has(l?.speaker)?l.speaker:'';const spoken=clean(l?.text,400);
   if(!speaker||!spoken||count>=120)continue;
   const motion=idOK(l.motion)&&(installed.has(l.motion)||wantedIds.has(l.motion))?l.motion:'';
   const expression={};for(const key of EXPRESSIONS){const v=Number(l.expression?.[key]);if(Number.isFinite(v)&&v>0)expression[key]=Math.min(1,Math.round(v*100)/100);}
   lines.push({speaker,text:spoken,motion,expression,note:clean(l.note,200)});count++;
  }
  if(lines.length)scenes.push({title:clean(s.title,120)||'Scene '+(scenes.length+1),setting:clean(s.setting,300),lines});
 }
 if(count<2)throw Error('The script has too few lines. Ask the Director to try again.');
 if(userRole&&!scenes.some(s=>s.lines.some(l=>l.speaker==='user')))userRole.silent=true;
 const used=new Set(scenes.flatMap(s=>s.lines.map(l=>l.motion)).filter(Boolean));
 return {version:1,title:clean(raw.title,120)||'Untitled show',synopsis:clean(raw.synopsis,700),cast,userRole,scenes,wantedMotions:wanted.filter(w=>used.has(w.id)),lineCount:count};
}
// The performance order, with the standby resolved for human lines.
function cueSheet(script){
 const cues=[];script.scenes.forEach((scene,si)=>scene.lines.forEach((line,li)=>cues.push({scene:si,index:li,sceneTitle:scene.title,...line,understudy:line.speaker==='user'?script.userRole?.understudy||'':''})));
 return cues;
}
function scriptSummary(script){
 if(!script)return 'No script yet.';
 const roles=script.cast.map(c=>`${c.name} as ${c.role}`).concat(script.userRole?[`${script.userRole.name} (the real human) as ${script.userRole.role}; standby ${script.userRole.understudyName}`]:[]).join('; ');
 return `"${script.title}": ${script.synopsis} Cast: ${roles}. ${script.scenes.length} scene(s), ${script.lineCount} lines.${script.wantedMotions.length?' Motions to prepare: '+script.wantedMotions.map(w=>w.label).join(', ')+'.':''}`;
}
module.exports={EXPRESSIONS,LENGTHS,MAX_WANTED,castPlan,motionCatalogue,playwrightRequest,parseScript,extractJSON,cueSheet,scriptSummary,transcriptText,clean};
