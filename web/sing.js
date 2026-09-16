// Lip-sync from audio the avatar is not speaking itself.
//
// Two sources, split on whether the audio can be decoded.
//
//   local    - a file on disk. Decodable, so it goes through the real engine:
//              the bundled recognizer classifies it live, exactly as it does a
//              GPT-Live stream. Speech or song, any language, no precompute.
//
//   tap      - whatever another app is playing right now, captured from Core
//              Audio below the player's decoder. DRM stops a file being read,
//              not a speaker being fed, so Spotify and Music go through the
//              same live recognizer as a local file. Nothing is precomputed and
//              nothing is reproduced: the user already hears the player, so
//              this path is analysis only.
//
//   external - a player whose audio cannot be captured at all. Precomputed
//              visemes are synced to the player's PLAYHEAD. Reuses the engine's
//              VisemeTimeline (its 0.16 s staleness rule and 128-frame cap are
//              part of the contract) but skips the worklet.
//
// A learned local detector decides when vocals are present. Stereo centre
// cleanup helps the phoneme model, but is not perfect singer separation.
// The original mix independently drives tempo; dance-only keeps the mouth idle.
import {SpeechOutput, VisemeTimeline, LIP_SYNC_DELAY, silentSpeech} from '/lip-sync.js';
import {createVocalDetector} from '/vocal-detector.js';

const SYNC='http://127.0.0.1:8787';
const LEAD=0.04, LOOKAHEAD=2, DRIFT=0.12;
const SILENCE_STOP=6;        // seconds of nothing before she stops on her own
const ENERGY={aa:.95,oh:.85,E:.75,ou:.7,ih:.6,RR:.5,CH:.5,nn:.45,DD:.45,kk:.45,SS:.4,TH:.4,FF:.35,PP:.3,sil:0};
const clock=()=>performance.now()/1000;

/* ------------------------------------------------------------ external mode */
class ScriptedSpeech {
  constructor(frames){this.frames=frames;this.timeline=new VisemeTimeline();this.anchor=null;this.i=0;this._muted=false;}
  get muted(){return this._muted;}
  set muted(v){this._muted=Boolean(v);if(this._muted)this.timeline.clear();}
  at(o){return this.anchor.clock+(o-this.anchor.position);}
  anchorTo(position){
    const fresh={clock:clock(),position};
    const slipped=this.anchor&&Math.abs(this.at(position)-fresh.clock)>DRIFT, first=!this.anchor;
    this.anchor=fresh;
    if(slipped||first){this.timeline.clear();const i=this.frames.findIndex(f=>f.t>=position);this.i=i<0?this.frames.length:i;}
  }
  pump(){
    if(!this.anchor)return;
    const horizon=clock()+LOOKAHEAD; let pushed=0;
    while(this.i<this.frames.length&&pushed<48){
      const f=this.frames[this.i], time=this.at(f.t)-LEAD;
      if(time>horizon)break;
      this.timeline.push({time,viseme:f.v}); this.i++; pushed++;
    }
  }
  sample(){
    if(this._muted)return{rms:0,relative:0,viseme:'sil',visemeWeights:{},speaking:false,lipSyncSource:'audio-model'};
    const viseme=this.timeline.sample(clock()), relative=ENERGY[viseme]??.6;
    return {rms:relative*.05,relative,viseme,visemeWeights:viseme==='sil'?{}:{[viseme]:1},
            speaking:viseme!=='sil',lipSyncSource:'audio-model'};
  }
  close(){this.timeline.clear();this.anchor=null;}
}

/* --------------------------------------------------------------- beat clock */
// Tempo from the SHAPE of the onset envelope, not from the gaps between hits.
//
// Timing individual onsets and averaging the gaps is the obvious approach and
// it does not work: one missed kick doubles the estimate, one ghost snare
// halves it, and the same song comes back as 113 BPM on one listen and 67 on
// the next. The gaps are a handful of noisy samples and the median of them
// inherits every mistake.
//
// Autocorrelating the whole envelope instead asks a steadier question - at what
// spacing does this music repeat? - and every onset in the window votes on the
// answer, so a few wrong ones cannot carry it.
//
// Autocorrelation cannot tell a beat from half or double a beat, because both
// genuinely repeat, and a log-Gaussian preference around 120 BPM (Ellis 2007)
// only leans against the mistake - measured against real tracks it still
// returned 200 for a 100 BPM song and 65 for a 130 BPM one, wrong by an octave
// in both directions.
//
// So the octave is not guessed, it is normalised: whatever periodicity wins is
// folded by halving or doubling into the band a listener would call the beat.
// That is also the honest answer for the thing it drives - nobody dances at 200
// BPM to a 100 BPM song, they dance on the half notes.
const ENV_RATE=40, ENV_LEN=ENV_RATE*8;              // 8 s of onset envelope
const MIN_BPM=55, MAX_BPM=210, PREFERRED_BPM=120, OCTAVE_WIDTH=1.1;
const FOLD_LOW=70, FOLD_HIGH=140;                   // where "the" pulse is heard

function foldTempo(bpm){
  let folded=bpm;
  while(folded<FOLD_LOW)folded*=2;
  while(folded>=FOLD_HIGH)folded/=2;
  return folded;
}

class BeatClock {
  constructor(context,source){
    this.analyser=context.createAnalyser();
    // No smoothing: smoothing is a low-pass on exactly the transients we want.
    this.analyser.fftSize=1024; this.analyser.smoothingTimeConstant=0;
    source.connect(this.analyser);
    this.bins=new Uint8Array(this.analyser.frequencyBinCount);
    this.previous=new Uint8Array(this.analyser.frequencyBinCount);
    this.envelope=new Float32Array(ENV_LEN); this.write=0; this.filled=0;
    this.period=null; this.confidence=0; this.nextBeat=0; this.beat=false; this.lastEstimate=0;
    this.timer=setInterval(()=>this.step(),1000/ENV_RATE);
  }

  step(){
    this.analyser.getByteFrequencyData(this.bins);
    // Positive spectral flux across bass through low mids: kick, snare and the
    // attack of a bass line, without the cymbal wash that blurs the pulse.
    let flux=0;
    for(let i=1;i<48;i++){const rise=this.bins[i]-this.previous[i]; if(rise>0)flux+=rise;}
    this.previous.set(this.bins);
    this.envelope[this.write]=flux;
    this.write=(this.write+1)%ENV_LEN;
    this.filled=Math.min(ENV_LEN,this.filled+1);

    const now=clock();
    // Re-estimate twice a second once there is enough history to mean anything.
    if(this.filled>=ENV_RATE*4&&now-this.lastEstimate>.5){this.lastEstimate=now; this.estimate();}

    if(!this.period)return;
    if(!this.nextBeat)this.nextBeat=now+this.period;
    if(now>=this.nextBeat){this.beat=true; this.nextBeat+=this.period;}

    // Keep the clock married to the music: a loud frame near a predicted beat
    // pulls the prediction towards it, so phase survives a tempo that drifts.
    if(flux>this.loud()){
      const error=now-(this.nextBeat-this.period);
      if(Math.abs(error)<this.period*.25)this.nextBeat+=error*.12;
    }
  }

  loud(){
    let sum=0; for(let i=0;i<this.filled;i++)sum+=this.envelope[i];
    return (sum/this.filled)*2.2;
  }

  estimate(){
    const n=this.filled, start=(this.write-n+ENV_LEN)%ENV_LEN;
    const series=new Float32Array(n);
    let mean=0;
    for(let i=0;i<n;i++){series[i]=this.envelope[(start+i)%ENV_LEN]; mean+=series[i];}
    mean/=n;
    // Centre it, so a constantly loud passage does not read as correlation.
    for(let i=0;i<n;i++)series[i]-=mean;

    let energy=0; for(let i=0;i<n;i++)energy+=series[i]*series[i];
    if(energy<=0)return;

    const minLag=Math.floor(ENV_RATE*60/MAX_BPM), maxLag=Math.ceil(ENV_RATE*60/MIN_BPM);
    const preferredLag=ENV_RATE*60/PREFERRED_BPM;
    let bestLag=0, bestScore=0, total=0;
    for(let lag=minLag;lag<=Math.min(maxLag,n-ENV_RATE);lag++){
      let sum=0;
      for(let i=lag;i<n;i++)sum+=series[i]*series[i-lag];
      const correlation=sum/energy;
      if(correlation<=0)continue;
      const octaves=Math.log2(lag/preferredLag);
      const score=correlation*Math.exp(-.5*(octaves/OCTAVE_WIDTH)**2);
      total+=score;
      if(score>bestScore){bestScore=score; bestLag=lag;}
    }
    if(!bestLag)return;

    // How much the winner stands out; a flat field means the music has no beat
    // worth following (speech, ambient, applause) and the old value is kept.
    const sharpness=bestScore/(total/(maxLag-minLag+1));
    if(sharpness<2.2)return;

    const found=60/foldTempo(60/(bestLag/ENV_RATE));
    this.confidence=sharpness;
    // Ease towards a new tempo unless it is a real change, so the dance does
    // not twitch on every re-estimate.
    if(!this.period||Math.abs(found-this.period)>this.period*.12){this.period=found; this.nextBeat=0;}
    else this.period+=(found-this.period)*.25;
  }

  // Continuous 0..1 phase, so motion can ride the pulse instead of jumping.
  phase(){ return this.period?1-Math.min(1,Math.max(0,(this.nextBeat-clock())/this.period)):0; }
  took(){ const b=this.beat; this.beat=false; return b; }
  close(){clearInterval(this.timer); try{this.analyser.disconnect();}catch{}}
}

// No audio in the graph on the external path, so there is nothing to detect a
// beat from. Accept a stated tempo and drive the same pacing logic.
class FixedBeats {
  constructor(bpm){this.period=60/bpm;this.next=clock()+this.period;this.flag=false;
    this.timer=setInterval(()=>{const t=clock();if(t>=this.next){this.flag=true;this.next=t+this.period;}},25);}
  phase(){return ((clock()-this.next)/this.period+1)%1;}
  took(){const f=this.flag;this.flag=false;return f;}
  close(){clearInterval(this.timer);}
}

/* ------------------------------------------------------- motion + expression */
// Everything here goes through the app's own API: gla_play for clips,
// setPlaybackRate to pace them, and a wrapper over motion.expression so the
// face swells with the voice instead of sitting at one authored value.
class Performance {
  constructor(beats, speech, target){
    this.target=target;
    this.beats=beats; this.speech=speech; this.restore=null; this.applied=null;
    this.pulse=0;
    const avatar=this.target.avatar, motion=avatar?.motion;
    if(motion&&!motion.__singWrapped){
      const original=motion.expression.bind(motion);
      motion.expression=(now,reduce)=>{
        const base=original(now,reduce);
        if(reduce)return base;
        const energy=this.speech?.sample?.().relative||0;
        const smile=Math.min(1,(base.smile||0)+.18+.35*energy+.15*this.pulse);
        const surprise=Math.min(1,(base.surprise||0)+.25*this.pulse*energy);
        return {...base,smile,surprise};
      };
      motion.__singWrapped=true;
      this.restore=()=>{motion.expression=original;delete motion.__singWrapped;};
    }
    this.timer=setInterval(()=>this.step(),60);
  }
  async start(){
    if(this.closed||this.starting)return;
    const motion=this.target.avatar?.motion;
    if(!motion?.clips?.size)return;
    const pool=[...motion.clips.values()].filter(c=>/dance|dancing|sway|swing|groove/i.test(c.id+' '+(c.category||'')));
    const pick=pool[Math.floor(Math.random()*pool.length)]?.id;
    this.lastStart=clock();
    if(!pick)throw Error('This character has no dance motions installed.');
    this.starting=true;
    try{const result=await this.target.play(pick);if(this.closed)throw cancelled();if(result===false||motion.active?.id!==pick)throw Error('The dance motion was interrupted.');}
    finally{this.starting=false;}
  }
  step(){
    this.pulse*=.82;
    if(this.beats.took())this.pulse=1;
    const motion=this.target.avatar?.motion, active=motion?.active;
    // Most clips are one-shot. A song is not, so re-cue as each one lands.
    if(!active&&clock()-(this.lastStart||0)>1.2){this.applied=null;void this.start().catch(error=>console.warn('[sing] motion:',error.message));return;}
    const period=this.beats.period;
    if(!active||!period||!motion.setPlaybackRate)return;
    // Match the clip's loop to a whole number of beats, nearest its own length,
    // so a sway lands on the pulse rather than drifting against it.
    const duration=(active.clip.frames.length-1)/active.clip.fps;
    const beats=Math.max(1,Math.round(duration/period));
    const rate=Math.max(.5,Math.min(2,duration/(beats*period)));
    if(this.applied===null||Math.abs(rate-this.applied)>.04){
      motion.setPlaybackRate(rate); this.applied=rate;
    }
  }
  close(){
    this.closed=true;clearInterval(this.timer); this.restore?.(); this.restore=null;
    this.target.cancel?.();
    try{this.target.avatar?.motion?.setPlaybackRate(1);this.target.avatar?.motion?.stop();}catch{}
  }
}

/* ------------------------------------------------------------ vocal isolation */
// Shared by every path that has a real waveform. Returns the node the
// recognizer should listen to.
// The recognizer publishes a decision roughly every 32 ms and the mouth used to
// wear every one of them. Measured against a real track that came to 18 shape
// changes a second, half of them held for a single frame: a tremble, not
// speech, which articulates at four to eight. So a shape now has to prove
// itself before it is worn, and once worn it is kept for a minimum time. This
// is deliberately not a smoothing filter - averaging two visemes gives a third,
// wrong mouth. It is a decision that refuses to be rushed.
// 70 ms lands the mouth at four to five shape changes a second against a real
// vocal, which is where human articulation actually sits. 90 ms was measured
// too: it looked calm but dropped to 2.4, which reads as underreacting.
function steadyMouth(speech, voiceAllowed=()=>true){
  const read=speech.sample.bind(speech);
  speech.sample=()=>{
    const raw=read();
    if(!voiceAllowed()||raw.rms<.001)return silentSpeech();
    return {...raw,speaking:raw.viseme!=='sil'};
  };
  return speech;
}

async function vocalChain(context, source, {gate=1, onVoice=null}={}){
  await context.audioWorklet.addModule('/vocal-worklet.js');
  const centre=new AudioWorkletNode(context,'vocal-center',{
    numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],
    channelCount:2,channelCountMode:'explicit',channelInterpretation:'discrete'});
  centre.parameters.get('gate').value=gate;
  if(onVoice)centre.port.onmessage=({data})=>{if(data?.type==='voice')onVoice(data);};
  // Centre extraction keeps bass and kick too, since those are centred as
  // well. Band-limit to where a voice lives before handing it over.
  const hp=context.createBiquadFilter(); hp.type='highpass'; hp.frequency.value=160; hp.Q.value=.7;
  const lp=context.createBiquadFilter(); lp.type='lowpass';  lp.frequency.value=6000;
  const lift=context.createGain(); lift.gain.value=2.2;    // isolation costs level
  source.connect(centre); centre.connect(hp); hp.connect(lp); lp.connect(lift);
  return lift;
}

/* --------------------------------------------------------------- local mode */
async function buildLocal(context, buffer, speech, isolate){
  const source=context.createBufferSource(); source.buffer=buffer;

  // What you HEAR: the whole song. Delayed by LIP_SYNC_DELAY because the
  // engine assumes everything entering speech.input is heard that much later.
  const mixDelay=context.createDelay(.5); mixDelay.delayTime.value=LIP_SYNC_DELAY;
  source.connect(mixDelay); mixDelay.connect(context.destination);

  const recognised=(isolate&&buffer.numberOfChannels>1)?await vocalChain(context,source):source;
  recognised.connect(speech.input);

  // Only the vocal reaches the analyser, so jaw energy follows the singer.
  speech.monitor=false; speech.updateVolume();
  return source;
}

/* ------------------------------------------------------------------ session */
let session=null, revision=0, pending=false, pendingTargets=[], transition=Promise.resolve(), failed=null;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const cancelled=()=>new DOMException('Music request cancelled.','AbortError');
function targetsFor(character){
  const targets=window.gla_sing_targets?.(character);
  if(!targets?.length)throw Error('That character is not visible.');
  return targets;
}
function removeTargets(character){
  if(!session)return false;
  const targets=character?targetsFor(character):[...session.targets.values()].map(x=>x.target);
  for(const target of targets){session.targets.get(target.id)?.performance?.close();session.targets.delete(target.id);}
  return true;
}
function teardown(){
  const old=session;session=null;
  if(!old)return;
  old.abort?.abort();clearInterval(old.watchdog);
  for(const entry of old.targets.values())entry.performance?.close();
  old.beats?.close();old.vocal?.close?.();
  try{old.source?.stop();}catch{}
  old.speech?.close();void old.context?.close();
  if(old.mode==='tap')void window.gla?.tap?.stop(old.tapToken);
}
function pendingFor(character){
  if(!pending)return false;
  if(!character)return true;
  const ids=new Set(targetsFor(character).map(t=>t.id));
  return pendingTargets.some(id=>ids.has(id));
}
function stop(character){
  const cancelPending=pendingFor(character);
  const hadSession=Boolean(session);
  let removed=false;
  if(character&&session){
    const ids=targetsFor(character).map(t=>t.id);
    removed=ids.some(id=>session.targets.has(id));
    removeTargets(character);
  }
  if(!character||cancelPending){revision++;pending=false;pendingTargets=[];}
  if(character&&session?.targets.size)return removed||cancelPending;
  if(character&&!removed&&!cancelPending)return false;
  teardown();
  if(cancelPending&&!hadSession)void window.gla?.tap?.stop();
  return removed||cancelPending||(!character&&hadSession);
}
async function addTargets(next,targets,mode='sing',valid=()=>true){
  const created=[],changed=[];
  try{
    for(const target of targets){
      if(session!==next||!valid())throw cancelled();
      let previous=next.targets.get(target.id);
      if(previous&&(previous.target.avatar!==target.avatar||previous.target.avatar.disposed)){previous.performance?.close();next.targets.delete(target.id);previous=null;}
      if(previous){changed.push([previous,previous.mode]);previous.mode=mode;continue;}
      const entry={target,mode};next.targets.set(target.id,entry);created.push(entry);
      const speech={sample:()=>modeFor(next,target.id)==='sing'?sampleSession(next):silentSpeech()};
      entry.performance=new Performance(next.beats,speech,target);
      await entry.performance.start();
      if(session!==next||!valid()||next.targets.get(target.id)!==entry)throw cancelled();
    }
  }catch(error){
    for(const entry of created){if(next.targets.get(entry.target.id)===entry){entry.performance?.close();next.targets.delete(entry.target.id);}}
    for(const [entry,oldMode] of changed)if(next.targets.get(entry.target.id)===entry)entry.mode=oldMode;
    throw error;
  }
}
const modeFor=(next,id)=>next.targets.get(id)?.mode;
function sampleSession(next){
  if(!next||next.mode==='tap'&&!(next.health?.rms>.0003))return silentSpeech();
  return next.speech?.sample?.()||silentSpeech();
}
async function pumpTap(url,node,channels,alive,signal){
  const response=await fetch(url,{cache:'no-store',signal});
  if(!response.ok||!response.body)throw Error('The audio stream did not open.');
  const reader=response.body.getReader(),align=4*channels;let tail=new Uint8Array(0);
  try{
    while(alive()){
      const {done,value}=await reader.read();if(done)break;
      let bytes=value;
      if(tail.length){const merged=new Uint8Array(tail.length+value.length);merged.set(tail);merged.set(value,tail.length);bytes=merged;}
      const usable=bytes.length-bytes.length%align;tail=bytes.slice(usable);if(!usable)continue;
      const floats=new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+usable));
      node.port.postMessage({type:'pcm',data:floats},[floats.buffer]);
    }
  }finally{try{await reader.cancel();}catch{}}
}
async function startTap(options,token){
  const check=()=>{if(token!==revision)throw cancelled();};
  if(!window.gla?.tap)throw Error('Listening to other apps is not available in this build.');
  const targets=options.targets||targetsFor(options.character);check();
  const opened=await window.gla.tap.start({player:options.player,pid:options.pid});
  if(token!==revision){if(opened?.token)await window.gla.tap.stop(opened.token);throw cancelled();}
  if(!opened?.ok)throw Error(opened?.error||'Start a song in Spotify, Music, or your browser first.');
  let next={mode:'tap',owner:'app',generation:'tap:'+token,targets:new Map(),abort:new AbortController(),
    pid:options.pid,tapToken:opened.token,label:opened.source||'audio',player:opened.player||null,health:{buffered:0,rms:0,peak:0,receivedFrames:0},
    voice:{},heard:clock(),token};
  session=next;
  try{
    const context=next.context=new AudioContext({sampleRate:opened.sampleRate});
    await context.resume();check();
    const speech=next.speech=new SpeechOutput(context,{analysisOnly:true,onError:m=>console.warn('[sing]',m)});
    if(!await speech.ready)throw Error('The lip-sync model could not load.');check();
    await context.audioWorklet.addModule('/tap-source-worklet.js');check();
    const tap=new AudioWorkletNode(context,'tap-source',{numberOfInputs:0,numberOfOutputs:1,
      outputChannelCount:[opened.channels],processorOptions:{channels:opened.channels}});
    tap.port.onmessage=event=>{if(event.data?.type==='health')Object.assign(next.health,event.data);};
    const sink=context.createGain();sink.gain.value=0;tap.connect(sink);sink.connect(context.destination);
    const recognised=await vocalChain(context,tap,{gate:0});check();
    next.vocal=await createVocalDetector(context,tap,{enhancedSource:recognised,signal:next.abort.signal,onState:data=>Object.assign(next.voice,data)});check();
    recognised.connect(speech.input);speech.monitor=false;speech.updateVolume();steadyMouth(speech,()=>next.vocal.allowed());
    next.beats=new BeatClock(context,tap);
    void pumpTap(opened.url,tap,opened.channels,()=>session===next,next.abort.signal)
      .catch(error=>{if(error.name!=='AbortError')console.warn('[sing] stream ended:',error.message);})
      .finally(()=>{if(session===next)teardown();});
    // A buffer containing zero PCM is not evidence of audible music.
    const deadline=clock()+5;
    while(clock()<deadline){check();if(session!==next)throw Error('The music audio stream stopped.');if(next.health.peak>.0005)break;await wait(50);}
    if(!(next.health.peak>.0005))throw Error('No sound is reaching the avatar. Start the music and check macOS audio capture permission.');
    check();await addTargets(next,targets,options.mode||'sing',()=>token===revision);check();
    let checking=false;
    next.watchdog=setInterval(async()=>{
      if(session!==next||checking)return;checking=true;
      try{
        if(next.health.rms>.0003)next.heard=clock();
        const playing=next.player?await window.gla.tap.playing(next.player).catch(()=>null):null;
        if(session===next&&((playing&&playing.playing===false)||clock()-next.heard>SILENCE_STOP))teardown();
        for(const [id,entry] of next.targets)if(entry.target.avatar.disposed){entry.performance?.close();next.targets.delete(id);}
        if(session===next&&!next.targets.size)teardown();
      }finally{checking=false;}
    },500);
    return status();
  }catch(error){if(session===next)teardown();throw error;}
}
function status(){
  if(!session)return null;
  return {mode:session.mode,generation:session.generation,source:session.label||null,voice:session.voice||null,
    tempo:session.beats?.period?Math.round(60/session.beats.period):null,
    tempoConfidence:session.beats?.confidence?+session.beats.confidence.toFixed(1):null,
    clip:[...session.targets.values()][0]?.target.avatar.motion.active?.id||null,health:session.health||null,
    targets:[...session.targets.values()].map(x=>({id:x.target.id,mode:x.mode}))};
}
async function start(options={}){
  const targets=options.targets||targetsFor(options.character);
  const token=++revision;pending=true;pendingTargets=targets.map(t=>t.id);
  const job=transition.catch(()=>{}).then(async()=>{
    if(token!==revision)throw cancelled();
    if(session?.mode==='tap'&&(!options.player||options.player===session.player)&&(options.pid===undefined||options.pid===session.pid)){
      const next=session;await addTargets(next,options.targets||targetsFor(options.character),options.mode||'sing',()=>token===revision);
      if(token!==revision||session!==next)throw cancelled();return status();
    }
    teardown();return startTap(options,token);
  });
  transition=job;
  try{return await job;}finally{if(token===revision){pending=false;pendingTargets=[];}}
}
window.gla_sing=status;
window.gla_sing_pending=pendingFor;
window.gla_sing_along=start;
window.gla_sing_stop=stop;
window.gla_sing_sample=character=>{
  if(!session)return null;
  const entry=session.targets.get(character)||[...session.targets.values()].find(x=>x.target.name?.toLowerCase()===String(character).toLowerCase());
  return entry?.mode==='sing'?sampleSession(session):entry?silentSpeech():null;
};
window.gla_sing_command=async(action,args={},isCancelled=()=>false)=>{
  const targets=targetsFor(args.character);
  if(isCancelled())throw cancelled();
  if(action==='stop_singing'){stop(args.character);return {ok:true,character:args.character,stopped:true};}
  const mode=action==='dance_along'?'dance':'sing';
  const result=await start({mode,targets,player:args.player});
  if(isCancelled()){stop(args.character);throw cancelled();}
  const playing=await window.gla.tap.playing(args.player).catch(()=>null);
  return {ok:true,character:args.character,mode,source:result.source,listeningTo:result.source,track:playing?.playing?playing.title:null,artist:playing?.playing?playing.artist:null,tempo:result.tempo};
};
window.gla_now_playing=()=>window.gla?.tap?.playing();
window.gla_players=()=>window.gla?.tap?.list();
addEventListener('pagehide',()=>stop());

// Retain the developer's optional local sync source. It never owns live voice.
async function tick(){
  if(pending||session?.owner==='app'||!window.gla_sing_targets)return;
  let state;try{state=await(await fetch(SYNC+'/state',{cache:'no-store'})).json();}catch{return;}
  if(session&&(state.mode==='off'||state.generation!==session.generation))teardown();
  if(state.mode==='off'||failed===state.generation)return;
  if(!session){
    const token=++revision;pending=true;
    const next={mode:state.mode,owner:'sync',generation:state.generation,targets:new Map()};session=next;
    try{
      const targets=targetsFor();
      if(state.mode==='local'){
        const context=next.context=new AudioContext();await context.resume();
        const speech=next.speech=new SpeechOutput(context);await speech.ready;
        const bytes=await(await fetch(SYNC+state.audio)).arrayBuffer();const buffer=await context.decodeAudioData(bytes);
        next.source=await buildLocal(context,buffer,speech,state.vocals);next.beats=new BeatClock(context,next.source);
        next.source.onended=()=>{if(session===next)teardown();};next.source.start();
      }else if(state.mode==='external'){
        const frames=(await(await fetch(SYNC+state.track)).json()).frames;
        next.speech=new ScriptedSpeech(frames);next.beats=new FixedBeats(state.bpm||100);
      }else throw Error('Unknown sync source.');
      if(token!==revision)throw cancelled();
      if(state.motion)await addTargets(next,targets);else for(const target of targets)next.targets.set(target.id,{target,mode:'sing'});
    }catch(error){failed=state.generation;if(session===next)teardown();console.warn('[sing]',error.message);}
    finally{if(token===revision)pending=false;}
  }
  if(session?.mode==='external'&&Number.isFinite(state.position))session.speech.anchorTo(state.position);
}
setInterval(tick,500);
setInterval(()=>{if(session?.mode==='external')session.speech.pump();},50);
