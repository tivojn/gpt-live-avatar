// Avatar Show performance. Runs a validated script cue by cue on a stage
// object that owns the voices, motions and the human's teleprompter. The
// player itself is UI-free so the takeover rules can be tested in Node.
export function cueSheet(script){
 const cues=[];(script?.scenes||[]).forEach((scene,si)=>(scene.lines||[]).forEach((line,li)=>cues.push({scene:si,index:li,sceneTitle:scene.title||'',...line,understudy:line.speaker==='user'?script.userRole?.understudy||'':''})));
 return cues;
}
export class ShowPlayer {
 constructor(stage){this.stage=stage;this.running=false;this.generation=0;this.pendingHuman=null;this.takenOver=false;}
 // External controls while a human line is pending.
 pass(){this.pendingHuman?.({result:'pass'});}
 takeover(){this.pendingHuman?.({result:'takeover'});}
 done(text=''){this.pendingHuman?.({result:'spoken',text});}
 stop(){if(!this.running)return;this.running=false;this.generation++;this.pendingHuman?.({result:'stop'});this.stage.stop?.();}
 async run(script,{timeoutMs=25000,resolveMotion=id=>id}={}){
  if(this.running)throw Error('A show is already running.');
  const cues=cueSheet(script);if(!cues.length)throw Error('The script has no lines.');
  const generation=++this.generation,current=()=>generation===this.generation;
  this.running=true;this.takenOver=false;const lines=[];let passes=0,scene=-1,finished=false;
  try{
   for(let i=0;i<cues.length;i++){
    if(!current())break;const cue=cues[i];
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
    if(cue.move){try{await this.stage.move?.(performer,cue.move);}catch{}if(!current())break;}
    const motion=cue.motion?resolveMotion(cue.motion,performer):'';
    if(motion||Object.keys(cue.expression||{}).length)await this.stage.motion?.(performer,motion,cue.expression||{});
    if(!current())break;
    try{heard=await this.stage.speak(cue,performer);}catch(e){if(!current())break;await this.stage.status?.(e.message||'The voice could not deliver that line.');}
    if(!current())break;
    this.stage.clear?.(performer);
    const text=cue.text,delivered=String(heard||'').trim();lines.push({speaker:performer,text,delivered,cue,forUser});this.stage.line?.({speaker:performer,text,delivered,cue,forUser});
   }
   finished=current();
  }finally{if(current()){this.running=false;this.pendingHuman=null;}}
  return {finished,lines,passes,takenOver:this.takenOver};
 }
}
