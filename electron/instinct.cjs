'use strict';
// Instinct: optional System One decisions from TypeSafe Jev. GPT-Live keeps
// the conversation; Jev only answers typed questions about the transcript in
// roughly a third of a second: "did she just commit to a motion, and which
// installed clip?", "how does the user sound right now?". Every answer is one
// of the options this file lists, and every clip is checked against the
// installed library again by the renderer, so transcript text can at worst
// pick a wrong animation. Without a key, or when Jev is slow, uncertain or
// failing, the local rules in avatar3d-companion.js decide exactly as before.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');

const ENDPOINT='https://api.typesafe.ai/v1/systemone',MODEL='jev-latest';
const REPLY_TIMEOUT=900,LISTEN_TIMEOUT=700,PAUSE_AFTER_FAILURES=30000,MAX_CLIPS=200;

// The same finite capabilities the companion accepts from a reply.
const ACTIONS=Object.freeze({
  wave:'Wave hello or goodbye with one hand',
  heart:'Make a heart shape with her hands',
  sit:'Sit down and stay seated',
  stand:'Stand back up from sitting',
  dance:'Dance, when no particular dance style is named',
  'random-dance':'Pick any dance at random, when asked to surprise or choose for herself',
  'random-motion':'Pick any motion at random, when asked to surprise with any move',
  smile:'Give a big visible smile on request',
  laugh:'Laugh visibly on request',
  closer:'Step closer to the viewer or camera',
  back:'Step back, further away from the viewer',
  come:'Walk over to the user or to their mouse cursor once',
  follow:'Keep following the mouse cursor around the screen',
  stay:'Stop moving, stop following, stay where she is',
  'walk-around':'Wander or stroll around the screen',
  'run-around':'Run or jog around the screen',
  'go-upper-left':'Walk to the upper left corner of the screen','go-upper-right':'Walk to the upper right corner of the screen',
  'go-lower-left':'Walk to the lower left corner of the screen','go-lower-right':'Walk to the lower right corner of the screen',
  'go-top':'Walk to the top edge of the screen','go-bottom':'Walk to the bottom edge of the screen',
  'go-left':'Walk to the left side of the screen','go-right':'Walk to the right side of the screen',
  'go-center':'Walk to the center of the screen',
});
const REACTIONS=Object.freeze({
  affection:'The assistant expresses love or fondness for the user, or sends the user a hug',
  celebration:'The assistant congratulates or celebrates good news or an achievement',
  amusement:'The assistant is laughing or finds something funny',
  greeting:'The assistant is saying hello or welcoming the user back',
  gratitude:'The assistant is sincerely thanking the user',
  agreement:'The assistant tells the user that their opinion or statement is correct. Saying yes to a request is not agreement',
  curiosity:'The assistant is intrigued and wondering about something',
  empathy:'The assistant is comforting the user about something hard, sad or frightening',
  none:'An ordinary informative reply, accepting or acknowledging a request, or anything sad, grave, medical or about loss where body language would be inappropriate',
});
// Facial expressions come from the renderer (web/avatar3d-expressions.js is the
// one list); main only checks their shape and adds the way out.
const NEUTRAL_FACE={listen:'A plain question, request, instruction or factual statement; nothing a listener would react to',
  reply:'A plain informative, practical or task-focused reply with no particular feeling'};
function cleanFaces(faces){
  const criteria={},family={};
  for(const face of Array.isArray(faces)?faces.slice(0,40):[]){
    const id=typeof face?.id==='string'&&/^[a-z][a-z-]{1,23}$/.test(face.id)&&face.id!=='neutral'?face.id:'',when=text(face?.when,160);
    if(!id||!when)continue;criteria[id]=when;family[id]=typeof face.family==='string'&&/^[a-z]{1,16}$/.test(face.family)?face.family:id;
  }
  return {criteria,family};
}
// Measured on jev-1.13: the right face often scores only .5 to .58 because a
// near-synonym (sad/concern, surprise/shock) takes the rest. So a clear choice
// passes alone, and a split one passes when its family is clear and neutral is not in play.
function chosenFace(answer,faces){
  const {criteria,family}=cleanFaces(faces),top=typeof answer?.choice==='string'?answer.choice:'';
  if(!Object.hasOwn(criteria,top))return null;
  if(probability(answer.confidence)>=.6)return top;
  const p=answer.probabilities||{},kin=Object.keys(criteria).filter(id=>family[id]===family[top]).reduce((sum,id)=>sum+probability(p[id]),0);
  return probability(p[top])>=.35&&kin>=.7&&probability(p.neutral)<=.15?top:null;
}

const text=(value,limit)=>String(value??'').normalize('NFKC').replace(/[\u0000-\u0008\u000b-\u001f]/g,' ').replace(/\s+/g,' ').trim().slice(0,limit);
const textWeight=value=>{let n=0;for(const ch of String(value||''))n+=/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(ch)?3:1;return n;}; // one CJK character says about a short word
const probability=value=>Number.isFinite(value)?Math.min(1,Math.max(0,value)):0;
// A noul answer is {type:'noul',noul:0.93}. null = Jev did not answer it.
const noul=answer=>Number.isFinite(answer?.noul)?probability(answer.noul):Number.isFinite(answer)?probability(answer):null;
// Jev is sure nothing is being felt: the renderer lets a lingering face go.
const calmFace=answer=>answer?.choice==='neutral'&&probability(answer.confidence)>=.7;
function cleanClips(clips){
  const seen=new Set(),out=[];
  for(const clip of Array.isArray(clips)?clips:[]){
    const id=typeof clip?.id==='string'&&/^[a-z0-9][a-z0-9_-]{0,63}$/.test(clip.id)?clip.id:'';
    if(!id||seen.has(id))continue;seen.add(id);
    out.push({id,label:text(clip.label,80)||id.replace(/-/g,' '),category:text(clip.category,40),
      aliases:(Array.isArray(clip.aliases)?clip.aliases:[]).map(a=>text(a,40)).filter(Boolean).slice(0,6)});
    if(out.length>=MAX_CLIPS)break;
  }
  return out;
}

// One request carries every question; Jev evaluates them in parallel against
// the same state, so asking for the reaction as well costs no extra time.
function replyRequest({user,reply,clips,character,faces}){
  const criteria={};
  for(const clip of cleanClips(clips))criteria['clip:'+clip.id]=`Installed animation "${clip.label}"${clip.category?` (${clip.category})`:''}${clip.aliases.length?`. Also called: ${clip.aliases.join(', ')}`:''}`;
  for(const [id,what] of Object.entries(ACTIONS))criteria['action:'+id]=what;
  criteria.none='She performs nothing physical in this reply, or what she promises matches none of the other options';
  return {model:MODEL,
    state:{situation:`${text(character,40)||'The assistant'} is a 3D avatar on the user's screen with a real animated body. This is the latest exchange of a voice conversation.`,
      user_said:text(user,1200),assistant_replied:text(reply,2000)},
    questions:{
      performs:{type:'noul',instructions:'In assistant_replied, does the assistant herself commit to doing something with her body right now: a movement, gesture, dance, pose, walking somewhere, following, coming closer, sitting, or stopping and staying in place? Answer no when she declines or says she cannot, when the action is hypothetical, conditional, quoted, in the past or planned for later, when she only explains, describes or asks about it, and when the only action is talking, singing, thinking or working on a task.'},
      what:{type:'choice',instructions:'Which one option is the physical action the assistant says she is performing right now in assistant_replied? When she agrees to perform without naming it, such as "watch this" or "here goes", choose the option that best matches what user_said asked for.',criteria},
      reaction:{type:'choice',instructions:'Which body-language reaction fits the feeling the assistant expresses in assistant_replied?',criteria:{...REACTIONS}},
      ...(Object.keys(cleanFaces(faces).criteria).length?{face:{type:'choice',instructions:'Which facial expression is on the assistant\'s own face while she says assistant_replied? Choose from how she feels in her words, not from how the user feels.',criteria:{...cleanFaces(faces).criteria,neutral:NEUTRAL_FACE.reply}}}:{}),
    }};
}
// final: a finished reply may act or veto. partial: a reply still being
// spoken may only act, and only when Jev is nearly certain, which lets the
// motion start with her words instead of after the transcript settles.
function interpretReply(answers,clips,{partial=false,faces}={}){
  const installed=new Set(cleanClips(clips).map(c=>'clip:'+c.id));
  const asked=noul(answers?.performs),performs=asked??0,what=answers?.what||{},choice=typeof what.choice==='string'?what.choice:'';
  const weight=probability(what.probabilities?.[choice]);
  const valid=installed.has(choice)||choice.startsWith('action:')&&Object.hasOwn(ACTIONS,choice.slice(7));
  const out={performs,choice:valid?choice:'',weight,suggestion:undefined,reaction:undefined,ranking:undefined,face:chosenFace(answers?.face,faces),calm:calmFace(answers?.face)};
  // Tuned on real jev-1.13 answers (qa/instinct-live.cjs): true commitments
  // score .6 to .92 and the choice is the sharper signal, so both must agree.
  const nothing=probability(what.probabilities?.none);
  if(valid&&performs>=.5&&weight>=(partial?.85:.6))out.suggestion=choice; // mid-sentence, the choice must be near certain
  else if(!partial&&asked!==null&&performs<=.2&&nothing>=.7)out.suggestion='veto';
  if(partial)return out;
  const reaction=answers?.reaction||{};
  if(typeof reaction.choice==='string'&&Object.hasOwn(REACTIONS,reaction.choice)&&probability(reaction.confidence)>=.75)out.reaction=reaction.choice;
  // Lets the companion prefer the clip that fits this reply over a coin toss.
  out.ranking=Object.fromEntries(Object.entries(what.probabilities||{}).filter(([id,p])=>installed.has(id)&&Number.isFinite(p)).map(([id,p])=>[id.slice(5),probability(p)]));
  return out;
}

function listenRequest({history,partial,character,faces}){
  return {model:MODEL,
    state:{situation:`The user is speaking aloud to ${text(character,40)||'the assistant'}, a warm and attentive friend who is listening. user_is_saying may be an unfinished sentence.`,
      earlier:(Array.isArray(history)?history:[]).slice(-4).map(turn=>({speaker:turn?.role==='assistant'?'assistant':'user',said:text(turn?.text,400)})),
      user_is_saying:text(partial,1200)},
    questions:{
      face:{type:'choice',instructions:'Which facial expression would the listening friend naturally show at this moment, in response to user_is_saying? Choose the listener\'s reaction, which can differ from the speaker\'s own feeling: grief is met with sadness or concern, a joke with a laugh, an injustice done to the user with anger on their behalf.',criteria:{...cleanFaces(faces).criteria,neutral:NEUTRAL_FACE.listen}},
    }};
}
function interpretListen(answers,faces){
  const answer=answers?.face||{};
  return {face:chosenFace(answer,faces),calm:calmFace(answer),read:typeof answer.choice==='string'?answer.choice:'',confidence:probability(answer.confidence)};
}

class Instinct{
  constructor({directory,safeStorage,fetchImpl=fetch,onChange=()=>{},now=()=>Date.now()}){
    Object.assign(this,{directory,safeStorage,fetch:fetchImpl,onChange,now});
    this.failures=0;this.pausedUntil=0;this.badKey=false;this.keyGeneration=0;
    this.stats={calls:0,answered:0,inputTokens:0,lastLatencyMs:null,lastError:''};
  }
  file(){return path.join(this.directory,'typesafe-key.bin');}
  hasKey(){return fs.existsSync(this.file());}
  readKey(){
    try{const raw=fs.readFileSync(this.file());return this.safeStorage.isEncryptionAvailable()?this.safeStorage.decryptString(raw):raw.toString('utf8');}catch{return '';}
  }
  async setKey(key){
    const generation=++this.keyGeneration;
    if(typeof key!=='string'||!/^[\x21-\x7e]{16,512}$/.test(key.trim()))throw Error('Enter a valid TypeSafe API key.');key=key.trim();
    let r;try{r=await this.post(key,{model:MODEL,state:'hello there',questions:{greeting:{type:'noul',instructions:'Is this a greeting?'}}},20000);}catch{throw Error('Could not reach TypeSafe to validate the key.');}
    await r.body?.cancel();
    if(r.status===401||r.status===403)throw Error('TypeSafe did not accept this key. Jev is in early access; check console.typesafe.ai.');
    if(!r.ok&&r.status!==429&&r.status!==529)throw Error(`TypeSafe key validation failed (HTTP ${r.status}).`);
    if(generation!==this.keyGeneration)throw Error('Key entry was cancelled.');
    fs.mkdirSync(this.directory,{recursive:true,mode:0o700});
    const tmp=this.file()+'.'+crypto.randomUUID()+'.tmp';
    fs.writeFileSync(tmp,this.safeStorage.isEncryptionAvailable()?this.safeStorage.encryptString(key):Buffer.from(key,'utf8'),{mode:0o600});fs.renameSync(tmp,this.file());
    this.failures=0;this.pausedUntil=0;this.badKey=false;this.stats.lastError='';this.onChange();
  }
  clearKey(){++this.keyGeneration;try{fs.unlinkSync(this.file());}catch{}this.badKey=false;this.onChange();}
  status(){
    const hasKey=this.hasKey();
    return {hasKey,state:!hasKey?'off':this.badKey?'bad-key':this.now()<this.pausedUntil?'paused':'ready',...this.stats};
  }
  post(key,payload,timeout){
    return this.fetch(ENDPOINT,{method:'POST',redirect:'error',signal:AbortSignal.timeout(timeout),
      headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(payload)});
  }
  // Resolves to answers or null. It never throws and never retries: a voice
  // turn must not wait on a second provider, so a miss falls back to rules.
  async ask(payload,timeout){
    if(this.badKey||this.now()<this.pausedUntil)return null;
    const key=this.readKey();if(!key)return null;
    const started=this.now();this.stats.calls++;
    try{
      const r=await this.post(key,payload,timeout);
      if(r.status===401||r.status===403){await r.body?.cancel();this.badKey=true;this.stats.lastError='TypeSafe rejected the saved key.';this.onChange();return null;}
      if(!r.ok){await r.body?.cancel();throw Error(`TypeSafe HTTP ${r.status}`);}
      const body=await r.json();
      if(!body||typeof body.answers!=='object'||!body.answers)throw Error('TypeSafe returned no answers.');
      this.failures=0;this.stats.answered++;this.stats.lastLatencyMs=this.now()-started;this.stats.lastError='';
      this.stats.inputTokens+=Number.isFinite(body.usage?.input_tokens)?body.usage.input_tokens:0;
      return body.answers;
    }catch(error){
      this.stats.lastError=error?.name==='TimeoutError'?'Jev was slower than the voice turn allows.':text(error?.message,160);
      if(++this.failures>=3){this.failures=0;this.pausedUntil=this.now()+PAUSE_AFTER_FAILURES;}
      return null;
    }
  }
  async decide(request){
    if(!request||typeof request!=='object')return null;
    // The first request on a new connection costs about a second; pay it while
    // the voice session is connecting rather than on her first promise.
    if(request.kind==='warm')return await this.ask({model:MODEL,state:'hello there',questions:{greeting:{type:'noul',instructions:'Is this a greeting?'}}},5000)?{kind:'warm'}:null;
    if(request.kind==='listen'){
      if(textWeight(text(request.partial,1200))<12)return null;
      const answers=await this.ask(listenRequest(request),LISTEN_TIMEOUT);
      return answers&&{kind:'listen',...interpretListen(answers,request.faces)};
    }
    if(request.kind!=='reply'||!text(request.reply,2000))return null;
    const answers=await this.ask(replyRequest(request),REPLY_TIMEOUT);
    return answers&&{kind:'reply',...interpretReply(answers,request.clips,{partial:request.partial===true,faces:request.faces})};
  }
}

module.exports={Instinct,replyRequest,interpretReply,listenRequest,interpretListen,cleanClips,cleanFaces,ACTIONS,REACTIONS,ENDPOINT,MODEL};
