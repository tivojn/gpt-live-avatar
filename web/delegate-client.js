// GPT-Live sends delegation IDs, not the question. Use the locally collected
// transcript, including the unfinished input segment, and discard stale work.
export class DelegateClient {
  constructor(live,api,onStatus=()=>{}){
    Object.assign(this,{live,api,onStatus});this.seen=new Set();this.turn='';this.changedAt=0;
    live.addEventListener('event',({detail})=>{if(detail.type==='session.delegation.created'&&detail.delegation?.target==='client')this.created(detail.delegation.id);});
    live.addEventListener('transcript',({detail})=>{
      if(detail.role!=='user')return;
      // A new user segment while a hand-off is pending: a real interruption cancels it, but the tail of the same sentence
      // (the transcript of "… avatar test dot txt" arriving after she already handed off "create a file named") must not.
      // It extends the wait, or, if the request already went out with half a sentence, sends it again with the whole one.
      if(this.turn&&this.turn!==detail.id&&this.pending){if(detail.continues)this.extend(this.pending);else this.cancel();}
      else if(this.pending?.started&&detail.continues&&!detail.final)this.extend(this.pending);
      this.turn=detail.id;this.changedAt=performance.now();
    });
    live.addEventListener('state',({detail})=>{if(detail.state==='idle'){this.cancel();this.seen.clear();this.turn='';}});
  }
  extend(p){
    if(!p.started||p.restarts>=2)return; // not sent yet: run() is still waiting for the transcript to settle
    p.restarts=(p.restarts||0)+1;p.started=false;p.attempt=(p.attempt||0)+1;void this.api.cancel(p.id);clearTimeout(p.timer);p.createdAt=performance.now();p.timer=setTimeout(p.run,350);
  }
  // The voice model is told too: GPT-Live-1 drops a delegation by itself, but Gemini keeps a function call open (and
  // Extended Thinking keeps the whole session "in progress") until it is answered, so a cancelled one must be closed.
  cancel(){const p=this.pending;this.pending=null;if(p){clearTimeout(p.timer);void this.api.cancel(p.id);this.live.cancelDelegation?.(p.id);}this.onStatus('');}
  created(id){
    if(this.live.receiveOnly||this.live.reasoningMode!=='delegate'||typeof id!=='string'||this.seen.has(id))return;
    this.cancel();this.seen.add(id);if(this.seen.size>128)this.seen.delete(this.seen.values().next().value);
    const p={id,generation:this.live.generation,createdAt:performance.now()};this.pending=p;
    const run=p.run=async()=>{
      if(this.pending!==p)return;
      // Allow trailing transcription packets to arrive before reading context.
      if(performance.now()-this.changedAt<350&&performance.now()-p.createdAt<1800){p.timer=setTimeout(run,150);return;}
      this.onStatus('Thinking…');p.started=true;const attempt=p.attempt||0,stale=()=>this.pending!==p||(p.attempt||0)!==attempt;
      const request={id,history:this.live.conversation(),turnId:this.turn};
      // The same confirmed music request may also cause a late model delegation.
      // Let the host return its deduplicated, verified local result first.
      let local;try{local=await this.localRequest?.(request);}catch(error){local={handled:true,ok:false,text:error.message};}
      if(stale()||this.live.generation!==p.generation||this.live.state!=='connected')return;
      if(local?.handled){
        this.pending=null;this.onStatus(local.ok?'':local.text||'Music control failed.');
        if(!local.cancelled)this.live.appendCommentary('Verified music-control result: '+String(local.text||'No result was returned.').slice(0,700)+'. Do not repeat the action.',id);
        return;
      }
      let result;try{result=await this.api.answer(request);}catch{result={ok:false,error:'The reasoning connection was interrupted.'};}
      if(stale()||this.live.generation!==p.generation||this.live.state!=='connected')return; // superseded by the same request sent again in full
      this.pending=null;this.onStatus(result.ok?'':result.error);
      if(!result.ok){this.live.appendCommentary('The reasoning assistant could not answer this request. Briefly explain that it failed and invite the user to try again. Do not invent an answer.',id);return;}
      // Each append must be under 500 tokens. A UTF-8 byte ceiling of 400
      // also bounds byte-level tokenizers; no private reasoning is injected.
      for(const content of commentaryChunks(result.text))if(!this.live.appendCommentary(content,id))break;
    };
    p.timer=setTimeout(run,350);
  }
}
export function commentaryChunks(text){
  const encoder=new TextEncoder(),chunks=[];let current='',bytes=0;
  for(const char of String(text||'').slice(0,12000)){const size=encoder.encode(char).length;if(bytes+size>400){chunks.push(current);current='';bytes=0;}current+=char;bytes+=size;}
  if(current)chunks.push(current);return chunks;
}
