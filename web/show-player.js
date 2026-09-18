// Avatar Show performance. Runs a validated script cue by cue on a stage
// object that owns the voices, motions and the human's teleprompter. The
// player itself is UI-free so the takeover rules can be tested in Node.
export function cueSheet(script){
 const cues=[];(script?.scenes||[]).forEach((scene,si)=>(scene.lines||[]).forEach((line,li)=>cues.push({scene:si,index:li,sceneTitle:scene.title||'',...line,understudy:line.speaker==='user'?script.userRole?.understudy||'':''})));
 return cues;
}
export class ShowPlayer {
 constructor(stage){this.stage=stage;this.running=false;this.generation=0;this.pendingHuman=null;this.takenOver=false;this.gate=null;}
 // Hold between cues (the current line finishes first); resume continues from the next cue.
 pause(){if(!this.running||this.gate)return;let open;this.gate={promise:new Promise(r=>{open=r;}),open};this.stage.paused?.(true);}
 resume(){const gate=this.gate;if(!gate)return;this.gate=null;gate.open();this.stage.paused?.(false);}
 get paused(){return Boolean(this.gate);}
 // External controls while a human line is pending.
 pass(){this.pendingHuman?.({result:'pass'});}
 takeover(){this.pendingHuman?.({result:'takeover'});}
 done(text=''){this.pendingHuman?.({result:'spoken',text});}
 stop(){if(!this.running)return;this.running=false;this.generation++;this.pendingHuman?.({result:'stop'});const gate=this.gate;this.gate=null;gate?.open();this.stage.stop?.();}
 async run(script,{timeoutMs=25000,resolveMotion=id=>id}={}){
  if(this.running)throw Error('A show is already running.');
  const cues=cueSheet(script);if(!cues.length)throw Error('The script has no lines.');
  const generation=++this.generation,current=()=>generation===this.generation;
  this.running=true;this.takenOver=false;const lines=[];let passes=0,scene=-1,finished=false,aborted='',failures=0;
  // A voice acts far better when it knows who it is, where it stands, who it
  // is speaking to and what was just said to it, so every cue carries a short
  // scene note into its session.
  const roles=new Map((script?.cast||[]).map(c=>[c.slug,c.role||c.name||c.slug]));
  if(script?.userRole)roles.set('user',script.userRole.role||script.userRole.name||'the visitor');
  const sceneOf=c=>{const s=script?.scenes?.[c.scene];return [c.sceneTitle||s?.title||'',s?.setting||''].filter(Boolean).join(' - ');};
  const speakerAt=i=>{const c=cues[i];if(!c)return '';return c.speaker==='user'?(this.takenOver?c.understudy:'user'):c.speaker;};
  const cueContext=(i,who)=>{const c=cues[i];if(!c)return null;const prev=cues[i-1];
   return {role:roles.get(who)||who,scene:sceneOf(c),to:roles.get(speakerAt(i+1))||'',
    after:prev?(roles.get(prev.speaker)||prev.speaker)+': '+prev.text:'',note:c.note||''};};
  try{
   for(let i=0;i<cues.length;i++){
    if(!current())break;const cue=cues[i];
    // A hold takes effect here, once the line under way has finished.
    if(this.gate){this.stage.held?.();await this.gate.promise;if(!current())break;}
    if(cue.scene!==scene){scene=cue.scene;await this.stage.scene?.(script.scenes[scene],scene);if(!current())break;}
    const nextCue=cues[i+1];const next=nextCue?(nextCue.speaker==='user'?(this.takenOver?nextCue.understudy:'user'):nextCue.speaker):'';
    let performer=cue.speaker,forUser=false,heard='';
    if(cue.speaker==='user'&&!this.takenOver){
     this.stage.floor?.({speaker:'user',listener:next,cue});
     const answer=await new Promise(resolve=>{let settled=false;const finish=value=>{if(settled)return;settled=true;this.pendingHuman=null;resolve(value||{result:'pass'});};this.pendingHuman=finish;Promise.resolve(this.stage.human(cue,{timeoutMs})).then(finish,()=>finish({result:'pass'}));});
     if(!current())break;
     if(answer.result==='stop'){this.stop();break;}
     if(answer.result==='spoken'){const text=String(answer.text||'').trim()||cue.text;lines.push({speaker:'user',text,cue});this.stage.line?.({speaker:'user',text,cue});continue;}
     if(answer.result==='takeover')this.takenOver=true;
     passes++;performer=cue.understudy;forUser=true;
     if(!performer){lines.push({speaker:'user',text:cue.text,cue,skipped:true});this.stage.line?.({speaker:'user',text:cue.text,cue,skipped:true});continue;}
     await this.stage.understudy?.(cue,performer,answer.result);if(!current())break;
    }else if(cue.speaker==='user'){performer=cue.understudy;forUser=true;if(!performer)continue;passes++;}
    this.stage.floor?.({speaker:performer,listener:next,cue});
    // An actor does not cross the stage in silence and only then begin: the
    // line carries the walk. The move runs underneath the speech, and the
    // cue's gesture waits for the feet to stop so a gait and a gesture never
    // fight over the same body.
    const gesture=()=>{const motion=cue.motion?resolveMotion(cue.motion,performer):'';
     if(motion||Object.keys(cue.expression||{}).length)return this.stage.motion?.(performer,motion,cue.expression||{});};
    const walking=cue.move?Promise.resolve(this.stage.move?.(performer,cue.move)).catch(()=>{}):null;
    const staging=Promise.resolve(walking?walking.then(gesture):gesture()).catch(()=>{});
    if(!current())break;
    const speaking=this.stage.speak(cue,performer,cueContext(i,performer));
    // Open the next cue's voice session while this line is still being spoken,
    // so the stage does not stand silent through a connection handshake.
    if(nextCue&&next&&next!=='user')this.stage.prepare?.(nextCue,next,cueContext(i+1,next));
    try{heard=await speaking;failures=0;}catch(e){if(!current())break;await this.stage.status?.(e.message||'The voice could not deliver that line.');
     // With the voices down, line after line would spend its timeout in silence: three in a row ends the show.
     if(++failures>=3){aborted='The voices failed three lines in a row, so the show was stopped. Check the connection and play it again.';this.stop();break;}}
    await staging;
    if(!current())break;
    this.stage.clear?.(performer);
    const text=cue.text,delivered=String(heard||'').trim();lines.push({speaker:performer,text,delivered,cue,forUser});this.stage.line?.({speaker:performer,text,delivered,cue,forUser});
   }
   finished=current();
  }finally{if(current()){this.running=false;this.pendingHuman=null;}}
  return {finished,lines,passes,takenOver:this.takenOver,aborted};
 }
}
