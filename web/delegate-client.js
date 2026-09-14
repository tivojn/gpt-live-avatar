// GPT-Live sends delegation IDs, not the question. Use the locally collected
// transcript, including the unfinished input segment, and discard stale work.
export class DelegateClient {
  constructor(live,api,onStatus=()=>{}){
    Object.assign(this,{live,api,onStatus});this.seen=new Set();this.turn='';this.changedAt=0;
    live.addEventListener('event',({detail})=>{if(detail.type==='session.delegation.created'&&detail.delegation?.target==='client')this.created(detail.delegation.id);});
    live.addEventListener('transcript',({detail})=>{
      if(detail.role!=='user')return;
      if(this.turn&&this.turn!==detail.id&&this.pending)this.cancel();
      this.turn=detail.id;this.changedAt=performance.now();
    });
    live.addEventListener('state',({detail})=>{if(detail.state==='idle'){this.cancel();this.seen.clear();this.turn='';}});
  }
  cancel(){const p=this.pending;this.pending=null;if(p){clearTimeout(p.timer);void this.api.cancel(p.id);}this.onStatus('');}
  created(id){
    if(this.live.receiveOnly||this.live.reasoningMode!=='delegate'||typeof id!=='string'||this.seen.has(id))return;
    this.cancel();this.seen.add(id);if(this.seen.size>128)this.seen.delete(this.seen.values().next().value);
    const p={id,generation:this.live.generation,createdAt:performance.now()};this.pending=p;
    const run=async()=>{
      if(this.pending!==p)return;
      // Allow trailing transcription packets to arrive before reading context.
      if(performance.now()-this.changedAt<350&&performance.now()-p.createdAt<1800){p.timer=setTimeout(run,150);return;}
      this.onStatus('Thinking…');
      let result;try{result=await this.api.answer({id,history:this.live.conversation()});}catch{result={ok:false,error:'The reasoning connection was interrupted.'};}
      if(this.pending!==p||this.live.generation!==p.generation||this.live.state!=='connected')return;
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
