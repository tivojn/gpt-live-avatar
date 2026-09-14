'use strict';
const assert=require('node:assert/strict');
const {CodexAgent}=require('../electron/codex-agent.cjs');
class FakeClient{
 constructor(callbacks){Object.assign(this,callbacks);this.calls=[];this.n=0;}
 async start(){}
 async request(method,p){this.calls.push({method,p});
  if(method==='account/read')return {account:{type:'chatgpt'}};
  if(method==='thread/start')return {thread:{id:'thread-'+(++this.n)}};
  if(method==='turn/start'){this.turn=p;return {turn:{id:'turn-'+this.n}};}
  return {};
 }
 close(){}
}
(async()=>{
 let client;const receipts=[],asks=[];const agent=new CodexAgent({clientFactory:o=>client=new FakeClient(o),approve:async p=>{asks.push(p);return false;}});
 const config={agentFolder:'/tmp/avatar-qa'},request='Sarah, run Python to create a test file.',history=[{role:'assistant',text:'Tia created earlier.txt.'},{role:'user',text:request}];
 const tools={execute:async(name,args,signal)=>{signal.throwIfAborted();return {ok:true,character:args.character};}};
 const work=agent.answer(1,'one',config,history,request,'Sarah',tools,r=>receipts.push(r));await new Promise(r=>setImmediate(r));
 const start=client.calls.find(x=>x.method==='thread/start');assert.equal(start.p.sandbox,'workspace-write');assert.equal(start.p.approvalPolicy,'on-request');assert.equal(start.p.model,'gpt-5.6-sol');assert(start.p.developerInstructions.includes('Sarah'));assert(start.p.dynamicTools.some(t=>t.name==='play_motion'));
 const threadId='thread-1',turnId='turn-1';
 const response=await client.onRequest('item/tool/call',{threadId,turnId,tool:'move_avatar',arguments:{character:'Sarah',destination:'upper-right'}});assert(response.success);assert(response.contentItems[0].text.includes('Sarah'));
 const approval=await client.onRequest('item/commandExecution/requestApproval',{threadId,turnId,command:'rm sensitive-file'});assert.equal(approval.decision,'decline');assert.equal(asks.length,1);
 client.onEvent('item/completed',{threadId,item:{type:'commandExecution',id:'c1',command:'python3 task.py',exitCode:0,aggregatedOutput:'Created example.txt'}});
 client.onEvent('item/completed',{threadId,item:{type:'fileChange',changes:[{path:'/tmp/avatar-qa/example.txt',kind:'add'}],status:'completed'}});
 client.onEvent('item/completed',{threadId,item:{type:'agentMessage',id:'m1',phase:'commentary',text:'Working.'}});
 client.onEvent('item/completed',{threadId,item:{type:'agentMessage',id:'m2',phase:'final_answer',text:'I’m Sarah. Created and verified example.txt.'}});
 client.onEvent('turn/completed',{threadId,turn:{status:'completed'}});
 const result=await work;assert.equal(result.character,'Sarah');assert.equal(result.text,'I’m Sarah. Created and verified example.txt.');assert(receipts.some(r=>r.path?.endsWith('example.txt')));assert.equal(new Set(receipts.map(r=>r.callId)).size,receipts.length);
 const interrupted=agent.answer(1,'two',config,history,request,'Tia',tools);interrupted.catch(()=>{});await new Promise(r=>setImmediate(r));agent.cancel(1,'two');await assert.rejects(interrupted,/cancelled/);assert(client.calls.some(c=>c.method==='turn/interrupt'));assert.equal(agent.jobs.size,0);
 await assert.rejects(client.onRequest('item/tool/call',{threadId:'thread-2',tool:'move_avatar',arguments:{}}),/no longer active/);
 agent.close();console.log('Codex identity, shell/file receipts, dynamic avatar tools, explicit approval, final-only replies, cancellation and stale-tool rejection passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
