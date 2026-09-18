'use strict';
const assert=require('node:assert/strict');
const {TOOLS,latestUserRequest,createAvatarTools}=require('../electron/avatar-tools.cjs');
const {permissions,permissionPatch,engineConfig,selectEngine,providerMenu,reasoningMenu}=require('../electron/agent-engines.cjs');
const {actionEngine,reasoningEngine,runtimeConfig,normalizeDelegate}=require('../electron/delegate.cjs');
(async()=>{
 assert.deepEqual(TOOLS.map(t=>t.name),['avatar_state','move_avatar','play_motion','dance_along','stop_dancing']);
 const actions=[],agent=createAvatarTools({avatarCommand:async(name,args)=>{actions.push({name,args});return {ok:true};}}),signal=new AbortController().signal;
 for(const name of ['shell','create_text_file','trash_file','read_current_page','read_file','fetch_url'])await assert.rejects(agent.execute(name,{},signal),/Invalid avatar/);
 await agent.execute('avatar_state',{},signal);await agent.execute('move_avatar',{character:'Sarah',destination:'upper-right'},signal);await agent.execute('play_motion',{character:'Tia',motion:'wave'},signal);assert.equal(actions.length,3);
 // Dancing along is a visual control like the rest: named character, nothing else.
 await agent.execute('dance_along',{character:'Sarah'},signal);await agent.execute('stop_dancing',{character:'Sarah'},signal);assert.equal(actions.length,5);
 assert.deepEqual(actions.at(-2),{name:'dance_along',args:{character:'Sarah'}});
 for(const name of ['dance_along','stop_dancing']){
  await assert.rejects(agent.execute(name,{},signal),/Invalid avatar/,'A character is required');
  await assert.rejects(agent.execute(name,{character:'Sarah',track:'anything'},signal),/Invalid avatar/,'No track argument: she hears, she does not fetch');
 }
 await assert.rejects(agent.execute('avatar_state',{path:'/tmp'},signal),/Invalid/);await assert.rejects(agent.execute('move_avatar',{character:'Tia',destination:'/tmp'},signal),/supported/);
 const cancelled=new AbortController();cancelled.abort();await assert.rejects(agent.execute("avatar_state",{},cancelled.signal));assert.equal(actions.length,5);
 const history=[{role:'user',text:'Old request'},{role:'assistant',text:'Done'},{role:'user',text:'Hi Sarah,'},{role:'user',text:'read this page.'}];assert.equal(latestUserRequest(history),'Hi Sarah, read this page.');
 assert.deepEqual(permissions({agentAccess:'auto_review'}),{codex:'auto_review',openclaw:'workspace',hermes:'workspace',grok:'workspace',enconvo:'workspace'});
 const saved={agentAccess:'full',agentPermissions:{codex:'workspace',hermes:'workspace'}};
 const changed=permissionPatch(saved,{grok:'workspace',hermes:'invalid',codex:'auto_review'});
 assert.deepEqual(changed,{codex:'auto_review',openclaw:'full',hermes:'workspace',grok:'workspace',enconvo:'full'});
 assert.equal(engineConfig({...saved,agentPermissions:changed},'codex').agentAccess,'auto_review');
 assert.equal(actionEngine({agentEngine:'basic'}),'codex','Legacy built-in config migrates to Codex, never a hidden built-in fallback');
 const patches=[],available={codex:true,openclaw:false,hermes:true,grok:true,enconvo:true};
 const menu=providerMenu(saved,{active:'hermes',available,update:p=>patches.push(p),openSettings(){}});
 assert.equal(menu.label,'Action Engine & Permissions');
 const engineItem=name=>menu.submenu.find(x=>x.submenu&&x.label.includes(name));
 assert.match(engineItem('Hermes').label,/✓ Hermes/);assert.equal(engineItem('OpenClaw').submenu[0].enabled,false);
 engineItem('Grok Build').submenu[0].click();assert.deepEqual(patches[0],{agentEngine:'grok',agentFollowReasoning:false});
 engineItem('Hermes').submenu.find(x=>x.label==='Allow requests for this task').click();assert.deepEqual(patches[1],{agentPermissions:{hermes:'full'}});
 const engines=['codex','openclaw','hermes','grok','enconvo'];
 for(const reasoning of engines)for(const action of engines){
  const config={...normalizeDelegate({},selectEngine(reasoning)),agentEngine:action,agentCodexModel:'action-model',agentRuntimeModels:{[action]:'action-model'}};
  assert.equal(actionEngine(config),reasoning,'Default follows native reasoning');
  config.agentFollowReasoning=false;assert.equal(actionEngine(config),action,'Explicit override is independent');assert.equal(reasoningEngine(config),reasoning);
  const runtime=runtimeConfig(config,action);if(reasoning!==action)assert.equal(action==='codex'?runtime.agentCodexModel:runtime.agentRuntimeModels[action],'action-model','Do not replace action model with another provider’s reasoning model');
  assert.equal(actionEngine({...config,...normalizeDelegate(config,selectEngine(reasoning))}),action,'Changing reasoning preserves action override');
 }
 const rm=reasoningMenu(saved,{active:'hermes',available,update:p=>patches.push(p),openSettings(){}});
 assert(rm.submenu.every(x=>!x.submenu),'Reasoning menu does not contain action permissions');rm.submenu[0].click();assert(!('agentEngine' in patches.at(-1)));
 for(const engine of engines){const config=normalizeDelegate({},selectEngine(engine));assert.equal(actionEngine(config),engine);}
 console.log('External-only action routing, independent permissions, legacy migration, provider menu, avatar-only bridge and cancellation passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
