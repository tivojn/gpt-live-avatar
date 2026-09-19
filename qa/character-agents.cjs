'use strict';
// Agent settings per character (electron/character-agents.cjs): the defaults
// apply until something is changed for her, a change touches only her, and
// everything that answers or acts reads her effective settings.
const assert=require('assert/strict');
const {effective,customise,useDefaults,isCustom,clean,summary}=require('../electron/character-agents.cjs');
const {reasoningEngine,actionEngine}=require('../electron/delegate.cjs');
const {permissions}=require('../electron/agent-engines.cjs');
const defaults={avatar:'tia',liveProvider:'gemini',reasoningMode:'delegate',delegateProvider:'hermes',delegateAuth:'local_runtime',agentEnabled:true,agentEngine:'grok',agentFollowReasoning:true};

// 1. nobody has settings of her own: the defaults, the very same object
assert.equal(effective(defaults,'tia'),defaults);assert.equal(isCustom(defaults,'tia'),false);
assert.deepEqual((({custom,text,actions})=>({custom,text,actions}))(summary(defaults,'tia')),{custom:false,text:'Hermes · actions follow',actions:'follow'});

// 2. "her own settings" with nothing changed is a copy of what applied to her: nothing shifts
let c=customise(defaults,'tia',{});
assert.equal(isCustom(c,'tia'),true);assert.equal(reasoningEngine(effective(c,'tia')),'hermes');assert.equal(actionEngine(effective(c,'tia')),'hermes');
assert.equal(summary(c,'tia').text,'Hermes · actions follow');

// 3. one change is hers alone; the defaults and everyone else stay
c=customise(c,'tia',{reasoningMode:'delegate',delegateProvider:'enconvo',delegateAuth:'local_runtime'});
assert.equal(reasoningEngine(effective(c,'tia')),'enconvo');assert.equal(actionEngine(effective(c,'tia')),'enconvo','her actions follow HER reasoning');
assert.equal(reasoningEngine(effective(c,'sarah')),'hermes');assert.equal(c.delegateProvider,'hermes');
// and a later change of the defaults does not move her
const moved={...c,delegateProvider:'openclaw'};
assert.equal(reasoningEngine(effective(moved,'tia')),'enconvo');assert.equal(reasoningEngine(effective(moved,'sarah')),'openclaw');

// 4. built-in reasoning cannot act: her actions fall to her own engine, and the summary says which
c=customise(c,'tia',{reasoningMode:'managed'});
let s=summary(c,'tia');assert.equal(s.reasoningMode,'managed');assert.equal(s.canFollow,false);assert.equal(s.reasoning,'Gemini reasoning');assert.equal(s.actionEngine,'grok');assert.equal(s.text,'Gemini reasoning · actions by Grok Build');
assert.equal(summary({...c,liveProvider:'openai'},'tia').reasoning,'GPT-Live reasoning');
c=customise(c,'tia',{agentEngine:'codex',agentFollowReasoning:false});assert.equal(summary(c,'tia').text,'Gemini reasoning · actions by Codex App Server');

// 5. actions off for her only
c=customise(c,'tia',{agentEnabled:false});
assert.equal(effective(c,'tia').agentEnabled,false);assert.equal(effective(c,'sarah').agentEnabled,true);
s=summary(c,'tia');assert.equal(s.actions,'off');assert.equal(s.actionEngine,null);assert.match(s.text,/actions off$/);

// 6. an API provider for her reasoning; a sign-in kind that does not exist for it is corrected
c=customise(c,'tia',{reasoningMode:'delegate',delegateProvider:'xai',delegateAuth:'codex_app_server'});
s=summary(c,'tia');assert.equal(s.provider,'xai');assert.equal(s.auth,'api_key');assert.equal(s.reasoning,'xAI');assert.equal(s.canFollow,false);

// 7. her permission for an engine is hers; other engines and other characters keep the defaults
const before=permissions(defaults);
c=customise(defaults,'ming-mei',{agentPermissions:{codex:'workspace',hermes:'workspace'}});
assert.equal(before.codex,'full');assert.equal(permissions(effective(c,'ming-mei')).codex,'workspace');assert.equal(permissions(effective(c,'ming-mei')).hermes,'workspace');
assert.equal(permissions(effective(c,'tia')).codex,'full');assert.equal(permissions(effective(c,'ming-mei')).grok,before.grok);assert.equal(permissions(c).codex,'full','the defaults are untouched');
// a level that does not exist (or one that only Codex has, given to another engine) changes nothing
c=customise(c,'ming-mei',{agentPermissions:{codex:'everything-please',hermes:'auto_review'}});
assert.equal(permissions(effective(c,'ming-mei')).codex,'workspace');assert.equal(permissions(effective(c,'ming-mei')).hermes,'workspace');

// 8. back to the defaults
c=useDefaults(customise(defaults,'tia',{agentEnabled:false}),'tia');assert.equal(isCustom(c,'tia'),false);assert.equal(effective(c,'tia').agentEnabled,true);

// 9. what is read from disk is cleaned: unknown characters, junk values and unknown fields go
const dirty={...defaults,characterAgents:{tia:{agentEnabled:false,agentEngine:'rm -rf',evil:'x'},ghost:{agentEnabled:false},'../x':{agentEnabled:false},sarah:'nope'}};
const kept=clean(dirty,['tia','sarah']);
assert.deepEqual(Object.keys(kept),['tia']);assert.equal(kept.tia.agentEnabled,false);assert.equal(kept.tia.agentEngine,'grok','an unknown engine falls back to the default one');assert.equal('evil' in kept.tia,false);
assert.throws(()=>customise(defaults,'../x',{}),/Unknown character/);

// 10. The agent manager itself: a task is carried out with the settings of the character who was asked,
// not with the defaults and not with those of whoever is on screen. Engines are stubbed; nothing real runs.
(async()=>{
 const Module=require('module'),load=Module._load;
 Module._load=function(request,...rest){return request==='electron'?{ipcMain:{handle(){},on(){}},BrowserWindow:{},dialog:{},net:{},webContents:{fromId:()=>null}}:load.call(this,request,...rest);};
 const ran=[];
 for(const [file,name,engine] of [['codex-agent.cjs','CodexAgent','codex'],['enconvo-agent.cjs','EnconvoAgent','enconvo'],['acp-agent.cjs','AcpAgent',null]]){
  require('../electron/'+file)[name].prototype.answer=async function(_owner,_id,config,_history,_latest,speaker){ran.push({engine:engine||this.engine,speaker,access:config.agentAccess});return {text:'done',receipts:[]};};}
 const {setupAgent}=require('../electron/agent.cjs');Module._load=load;
 let store={avatar:'sarah',personaName:'Sarah',agentEnabled:true,agentEngine:'codex',agentFollowReasoning:false,reasoningMode:'managed'};
 store=customise(store,'tia',{agentEngine:'enconvo',agentPermissions:{enconvo:'workspace'}});store=customise(store,'ming-mei',{agentEnabled:false});
 const manager=setupAgent({origin:'http://localhost',getConfig:slug=>slug?effective(store,slug):store,backend:{cancel(){}}});
 const sender={id:1,isDestroyed:()=>false,send(){}},ask=(character,id)=>manager.answer(sender,{id,character,history:[{role:'user',text:'please do it '+id}]});
 await ask('Sarah','a');await ask('Tia','b');
 assert.deepEqual(ran,[{engine:'codex',speaker:'Sarah',access:'full'},{engine:'enconvo',speaker:'Tia',access:'workspace'}],'each with her own engine and her own permission for it');
 await assert.rejects(ask('Ming-Mei','c'),/Enable agent actions for Ming-Mei/,'and the one whose actions are off is refused by name, while the defaults are on');
 assert.equal(ran.length,2);
 console.log('character-agents: all checks passed');
})().catch(e=>{console.error(e);process.exit(1);});
