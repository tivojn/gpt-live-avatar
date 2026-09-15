'use strict';
const assert=require('node:assert/strict');
const {TOOLS,latestUserRequest,createAvatarTools}=require('../electron/avatar-tools.cjs');
const {permissions,permissionPatch,engineConfig,selectEngine,providerMenu}=require('../electron/agent-engines.cjs');
const {actionEngine,normalizeDelegate}=require('../electron/delegate.cjs');
(async()=>{
 assert.deepEqual(TOOLS.map(t=>t.name),['avatar_state','move_avatar','play_motion']);
 const actions=[],agent=createAvatarTools({avatarCommand:async(name,args)=>{actions.push({name,args});return {ok:true};}}),signal=new AbortController().signal;
 for(const name of ['shell','create_text_file','trash_file','read_current_page','read_file','fetch_url'])await assert.rejects(agent.execute(name,{},signal),/Invalid avatar/);
 await agent.execute('avatar_state',{},signal);await agent.execute('move_avatar',{character:'Sarah',destination:'upper-right'},signal);await agent.execute('play_motion',{character:'Tia',motion:'wave'},signal);assert.equal(actions.length,3);
 await assert.rejects(agent.execute('avatar_state',{path:'/tmp'},signal),/Invalid/);await assert.rejects(agent.execute('move_avatar',{character:'Tia',destination:'/tmp'},signal),/supported/);
 const cancelled=new AbortController();cancelled.abort();await assert.rejects(agent.execute('avatar_state',{},cancelled.signal));assert.equal(actions.length,3);
 const history=[{role:'user',text:'Old request'},{role:'assistant',text:'Done'},{role:'user',text:'Hi Sarah,'},{role:'user',text:'read this page.'}];assert.equal(latestUserRequest(history),'Hi Sarah, read this page.');
 assert.deepEqual(permissions({agentAccess:'auto_review'}),{codex:'auto_review',openclaw:'workspace',hermes:'workspace',grok:'workspace'});
 const saved={agentAccess:'full',agentPermissions:{codex:'workspace',hermes:'workspace'}};
 const changed=permissionPatch(saved,{grok:'workspace',hermes:'invalid',codex:'auto_review'});
 assert.deepEqual(changed,{codex:'auto_review',openclaw:'full',hermes:'workspace',grok:'workspace'});
 assert.equal(engineConfig({...saved,agentPermissions:changed},'codex').agentAccess,'auto_review');
 assert.equal(actionEngine({agentEngine:'basic'}),'codex','Legacy built-in config migrates to Codex, never a hidden built-in fallback');
 const patches=[],available={codex:true,openclaw:false,hermes:true,grok:true};
 const menu=providerMenu(saved,{active:'hermes',available,update:p=>patches.push(p),openSettings(){}});
 assert.equal(menu.label,'Delegate Reasoning Provider');assert.match(menu.submenu[2].label,/✓ Hermes/);assert.equal(menu.submenu[1].submenu[0].enabled,false);
 menu.submenu[3].submenu[0].click();assert.equal(actionEngine(normalizeDelegate({},patches[0])),'grok');
 menu.submenu[2].submenu.find(x=>x.label==='Allow requests for this task').click();assert.deepEqual(patches[1],{agentPermissions:{hermes:'full'}});
 for(const engine of ['codex','openclaw','hermes','grok']){const config=normalizeDelegate({},selectEngine(engine));assert.equal(actionEngine(config),engine);}
 console.log('External-only action routing, independent permissions, legacy migration, provider menu, avatar-only bridge and cancellation passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
