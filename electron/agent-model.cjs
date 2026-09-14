'use strict';
// Same authenticated model boundary as ordinary delegation, with bounded tool turns.
async function readTurn(response,chat=false){
 const reader=response.body?.getReader();if(!reader)throw Error('The agent returned no response.');
 const decoder=new TextDecoder();let buffer='',bytes=0,text='',output=[],complete=false;const calls=new Map(),items=new Map();
 const event=frame=>{const raw=frame.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(!raw)return;if(raw==='[DONE]')return;const d=JSON.parse(raw);
  if(d.error||['error','response.failed','response.incomplete'].includes(d.type))throw Error('The agent could not complete this step.');
  if(d.type==='response.output_text.delta')text+=d.delta||'';
  if(d.type==='response.output_item.done'&&d.item)items.set(d.output_index,d.item);
  if(d.type==='response.completed'){complete=true;output=d.response?.output||[];}
  const c=d.choices?.[0];if(c){text+=c.delta?.content||'';for(const t of c.delta?.tool_calls||[]){const v=calls.get(t.index)||{id:'',type:'function',function:{name:'',arguments:''}};v.id+=t.id||'';v.function.name+=t.function?.name||'';v.function.arguments+=t.function?.arguments||'';calls.set(t.index,v);}if(c.finish_reason){if(!['stop','tool_calls'].includes(c.finish_reason))throw Error('The agent reached its response limit.');complete=true;}}
 };
 try{while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>2*1024*1024)throw Error('The agent response exceeded its size limit.');buffer+=decoder.decode(value,{stream:true});buffer=buffer.replace(/\r\n/g,'\n');let end;while((end=buffer.indexOf('\n\n'))>=0){event(buffer.slice(0,end));buffer=buffer.slice(end+2);}}if(buffer.trim())event(buffer);}finally{await reader.cancel().catch(()=>{});}
 if(!complete)throw Error('The agent connection ended before the step finished.');
 if(!output.length)output=[...items.entries()].sort((a,b)=>a[0]-b[0]).map(([,item])=>item);
 if(!text)text=output.flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('');
 return {text,output,calls:chat?[...calls.values()].map(c=>({id:c.id,name:c.function.name,arguments:c.function.arguments})):output.filter(x=>x.type==='function_call').map(c=>({id:c.call_id,name:c.name,arguments:c.arguments})),chatMessage:{role:'assistant',content:text||null,...(calls.size?{tool_calls:[...calls.values()]}:{})}};
}
async function runAgent({fetchImpl,url,headers,body,signal,agent,provider,model}){
 const chat=provider==='xai';let count=0;const receipts=[],memo=new Map();
 body.tools=chat?agent.tools.map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.parameters}})):agent.tools;
 body.parallel_tool_calls=false;
 if(!chat)body.include=['reasoning.encrypted_content'];
 for(let round=0;round<8;round++){
  signal.throwIfAborted();const response=await fetchImpl(url,{method:'POST',headers,body:JSON.stringify(body),redirect:'error',signal});
  if(!response.ok){await response.body?.cancel();throw Error(`Agent model request failed (HTTP ${response.status}).`);}
  const turn=await readTurn(response,chat);signal.throwIfAborted();
  if(!turn.calls.length){if(!turn.text.trim())throw Error('The agent returned no answer.');return {text:turn.text.slice(0,12000),provider,model,receipts};}
  if(chat)body.messages.push(turn.chatMessage);else body.input.push(...turn.output);
  for(const call of turn.calls){
   if(++count>16)throw Error('Stopped after 16 tool steps. Please split this task into smaller requests.');signal.throwIfAborted();
   let result;try{if(!agent.tools.some(t=>t.name===call.name))throw Error('That tool is unavailable.');const args=JSON.parse(call.arguments);const key=call.name+':'+JSON.stringify(args);
    if(memo.has(key))result=memo.get(key);else{result=await agent.execute(call.name,args,signal);memo.set(key,result);}
   }catch(e){if(signal.aborted)throw e;result={ok:false,error:String(e.message).slice(0,400)};}
   receipts.push({tool:call.name,ok:result.ok!==false,...(result.path?{path:result.path}:{}),...(result.url?{url:result.url,title:result.title}:{}),...(result.error?{error:result.error}:{})});
   signal.throwIfAborted();const serialized=JSON.stringify(result).slice(0,45000);
   if(chat)body.messages.push({role:'tool',tool_call_id:call.id,content:serialized});else body.input.push({type:'function_call_output',call_id:call.id,output:serialized});
  }
 }
 throw Error('Stopped after eight reasoning steps. Please continue with a smaller request.');
}
module.exports={readTurn,runAgent};
