'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {AcpAgent}=require('../electron/acp-agent.cjs');
const {findRuntime}=require('../electron/acp-client.cjs');
const {hermesProfiles,assignedAgent}=require('../electron/runtime-agents.cjs');
const {createAvatarTools}=require('../electron/avatar-tools.cjs');
const {runtimeTools}=require('../electron/runtime-tools.cjs');
const {normalizeDelegate,reasoningEngine,actionEngine,DelegateBackend,selected}=require('../electron/delegate.cjs');
const tick=()=>new Promise(r=>setImmediate(r));
class Client{
 constructor(o){Object.assign(this,o);this.calls=[];this.closed=false;}
 async start(){return {protocolVersion:1,agentInfo:{version:'test'},agentCapabilities:{}};}
 async request(method,p){this.calls.push({method,p});if(method==='session/new')return {sessionId:'s1',models:{currentModelId:'provider:default',availableModels:[{modelId:'provider:model/v2'}]}};if(method==='session/prompt')return new Promise((r,j)=>{this.done=r;this.reject=j;});return {};}
 notify(method,p){this.calls.push({method,p});if(method==='session/cancel')this.reject?.(Error('cancelled'));}
 close(){this.closed=true;this.reject?.(Error('closed'));}
 event(update){this.onEvent('session/update',{sessionId:'s1',update});}
}
(async()=>{
 const codex={...normalizeDelegate({}, {reasoningMode:'delegate',delegateProvider:'openai',delegateAuth:'codex_app_server'}),agentEngine:'hermes'};
 assert.equal(actionEngine(codex),'codex');
 let config={...codex,...normalizeDelegate(codex,{delegateProvider:'hermes',delegateModel:'openrouter:z-ai/glm-5.1'})};
 assert.equal(selected(config).model,'openrouter:z-ai/glm-5.1');assert.equal(reasoningEngine(config),'hermes');assert.equal(actionEngine(config),'hermes');
 const back={...config,...normalizeDelegate(config,{delegateProvider:'openai'})};assert.equal(selected(back).auth,'api_key');assert.equal(back.delegateModels['hermes:local_runtime'],'openrouter:z-ai/glm-5.1');
 assert.equal(actionEngine({...config,reasoningMode:'managed',agentEngine:'openclaw'}),'openclaw');
 let seen;const backend=new DelegateBackend({auth:{bearer(){throw Error('Credentials must remain in the selected runtime');}},codex:{answer:async(...args)=>{seen=args;return {text:'Hermes'};},status:async engine=>({models:[engine+':model']})}});
 assert.equal((await backend.answer(1,'route',config,[{role:'user',text:'hello'}])).text,'Hermes');assert.equal(seen[2].agentRuntimeModels.hermes,'openrouter:z-ai/glm-5.1');assert.deepEqual(await backend.models(config),['hermes:model']);
 assert.throws(()=>findRuntime('bad'),/Unknown/);assert.throws(()=>findRuntime('hermes','/does/not/exist'),/saved path/);
 const profiles=fs.mkdtempSync(path.join(os.tmpdir(),'gla-profiles-'));
 try{
  fs.mkdirSync(path.join(profiles,'profiles/tia'),{recursive:true});fs.mkdirSync(path.join(profiles,'profiles/removed'),{recursive:true});fs.mkdirSync(path.join(profiles,'profiles/.deleted/removed'),{recursive:true});fs.writeFileSync(path.join(profiles,'active_profile'),'tia');
  assert.deepEqual(hermesProfiles(profiles).map(a=>[a.id,a.isDefault]),[['default',false],['tia',true]]);
  assert.equal(assignedAgent('hermes',{avatarAgentBindings:{'ming-mei':{hermes:'tia'}}},'Ming-Mei'),'tia');
 }finally{fs.rmSync(profiles,{recursive:true,force:true});}
 for(const engine of ['hermes','openclaw','grok']){
  let client,approvals=0;const progress=[],receipts=[];
  const a=new AcpAgent({engine,discover:async()=>({installed:true,agents:[{id:'default',isDefault:true},{id:'tia'}]}),clientFactory:o=>client=new Client(o),approve:async()=>{approvals++;return false;}});
  const cfg={agentEnabled:true,agentAccess:'workspace',agentFolder:os.tmpdir(),agentRuntimeModels:{[engine]:'provider:model/v2'},avatarAgentBindings:{sarah:{[engine]:'tia'}}};
  assert.deepEqual((await a.status(cfg)).models,['provider:model/v2']);assert(client.closed);
  await assert.rejects(a.answer(1,'off',{...cfg,agentEnabled:false},[],'hello','Tia'),/Enable actions/);
  const work=a.answer(1,'x',cfg,[{role:'assistant',text:'Tia created original.txt'},{role:'user',text:'Sarah read that file'}],'Sarah read that file','Sarah',null,r=>receipts.push(r),p=>progress.push(p));await tick();
  assert.equal(client.agent,'tia');if(engine==='openclaw')assert.match(client.calls.find(c=>c.method==='session/new').p._meta.sessionKey,/^agent:tia:gpt-live-avatar:/);
  assert(client.calls.some(c=>c.method==='session/set_model'&&c.p.modelId==='provider:model/v2'));const prompt=client.calls.find(c=>c.method==='session/prompt').p.prompt[0].text;assert(prompt.includes('Sarah')&&prompt.includes('original.txt'));
  client.event({sessionUpdate:'agent_thought_chunk',content:{type:'text',text:'private thought'}});assert.equal(progress.length,0);
  client.event({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Checking the file.'}});
  client.event({sessionUpdate:'tool_call',toolCallId:'t',title:'read file',kind:'read',status:'in_progress'});
  client.event({sessionUpdate:'tool_call_update',toolCallId:'t',status:'completed',locations:[{path:'/tmp/original.txt'}]});
  client.event({sessionUpdate:'tool_call_update',toolCallId:'t',status:'completed'});assert.equal(receipts.length,1);
  const denied=await client.onRequest('session/request_permission',{sessionId:'s1',toolCall:{title:'edit'},options:[{optionId:'once',kind:'allow_once'},{optionId:'forever',kind:'allow_always'}]});assert.equal(denied.outcome.outcome,'cancelled');assert.equal(approvals,1);
  client.event({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'Sarah: verified.'}});client.done({stopReason:'end_turn'});const result=await work;assert.equal(result.text,'Sarah: verified.');assert.equal(result.character,'Sarah');assert.equal(result.engine,engine);assert(client.closed);assert.equal(a.jobs.size,0);
  const cancelled=a.answer(1,'y',{...cfg,agentAccess:'full'},[],'check','Sarah');cancelled.catch(()=>{});await tick();
  const allowed=await client.onRequest('session/request_permission',{sessionId:'s1',options:[{optionId:'once',kind:'allow_once'},{optionId:'forever',kind:'allow_always'}]});assert.equal(allowed.outcome.optionId,'once');
  a.cancel(1,'unrelated');assert.equal(a.jobs.size,1);a.cancel(1,'y');await assert.rejects(cancelled,/cancelled/);assert(client.calls.some(c=>c.method==='session/cancel'));assert(client.closed);
  await assert.rejects(client.onRequest('session/request_permission',{sessionId:'s1',options:[]}),/Unavailable/);
  await assert.rejects(a.answer(1,'missing',{...cfg,avatarAgentBindings:{sarah:{[engine]:'deleted'}}},[],'hello','Sarah'),/no longer exists/);assert.equal(a.jobs.size,0);assert(client.closed);
  const parallelTia=a.answer(9,'parallel-tia',cfg,[],'first','Tia');parallelTia.catch(()=>{});const tiaClient=client;
  const parallelSarah=a.answer(9,'parallel-sarah',cfg,[],'second','Sarah');parallelSarah.catch(()=>{});const sarahClient=client;
  await tick();assert.equal(a.jobs.size,2,engine+' supports simultaneous characters');assert(!tiaClient.closed&&!sarahClient.closed);
  a.cancel(9,'parallel-tia');await assert.rejects(parallelTia,/cancelled/);assert.equal(a.jobs.size,1);assert(!sarahClient.closed);
  const replacement=a.answer(9,'replacement',cfg,[],'third','Sarah');replacement.catch(()=>{});await assert.rejects(parallelSarah,/cancelled/);await tick();assert.equal(a.jobs.size,1);a.cancelAll();await assert.rejects(replacement,/cancelled/);assert.equal(a.jobs.size,0);

 }
 const requested=createAvatarTools({config:{agentFolder:os.tmpdir()},request:'Sarah, play your boxing warmup.',avatarCommand:async()=>({ok:true})});assert.equal((await requested.execute('play_motion',{character:'Sarah',motion:'boxing-warmup'},new AbortController().signal)).ok,true);
 const abort=new AbortController(),executed=[],tool={tools:[{name:'play_motion'}],execute:async(name,args)=>{executed.push(args);return {ok:true};}};
 const bridge=await runtimeTools(tool,abort.signal);const url=bridge.instructions.match(/HTTP POST (http:\/\/\S+)/)[1];
 assert.equal((await fetch(url,{method:'POST',body:'{}'})).status,403);
 assert.equal((await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://untrusted.test'},body:'{}'})).status,403);
 assert.equal((await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tool:'shell',args:{}})})).status,400);
 assert.equal((await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tool:'play_motion',args:{motion:'wave'}})})).status,200);assert.equal(executed.length,1);
 abort.abort();await assert.rejects(fetch(url));bridge.close();
 console.log('Runtime routing, independent models/credentials, ACP progress/receipts, approval denial, cancellation, actions-off gate and request-scoped tool endpoint passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
