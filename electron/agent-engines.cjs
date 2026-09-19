'use strict';
const {PERMISSION_CHOICES,normalizePermission}=require('./agent-permissions.cjs');
const ENGINES=Object.freeze({codex:'Codex App Server',openclaw:'OpenClaw',hermes:'Hermes',grok:'Grok Build',enconvo:'EnConvo'});
const ACP_PERMISSIONS=Object.freeze([
 {value:'workspace',label:'Ask when the agent requests approval',description:'Show approval requests from this agent. Its own configured permissions still apply.'},
 {value:'full',label:'Allow requests for this task',description:'Allow each approval request for the current task. The agent keeps its own permissions; no permanent allowlist is changed.'},
]);
const permissionChoices=engine=>engine==='codex'?PERMISSION_CHOICES:ACP_PERMISSIONS;
function permissions(config){
 return Object.fromEntries(Object.keys(ENGINES).map(engine=>{
  const value=normalizePermission(config.agentPermissions?.[engine]??config.agentAccess);
  return [engine,engine==='codex'?value:value==='full'?'full':'workspace'];
 }));
}
function permissionPatch(config,patch){
 const values=permissions(config);
 for(const engine of Object.keys(ENGINES))if(permissionChoices(engine).some(c=>c.value===patch?.[engine]))values[engine]=patch[engine];
 return values;
}
function engineConfig(config,engine){return {...config,agentAccess:permissions(config)[engine]};}
function selectEngine(engine){
 if(!ENGINES[engine])throw Error('Unknown agent engine.');
 return {reasoningMode:'delegate',delegateProvider:engine==='codex'?'openai':engine,delegateAuth:engine==='codex'?'codex_app_server':'local_runtime'};
}
function installed(config){
 return Object.fromEntries(Object.keys(ENGINES).map(engine=>{try{
  if(engine==='codex')require('./codex-client.cjs').findCodex();
  else if(engine==='enconvo'){/* an HTTP service, not a binary: reachability is checked on connection */}
  else require('./acp-client.cjs').findRuntime(engine,config.agentRuntimePaths?.[engine]||'');
  return [engine,true];
 }catch{return [engine,false];}}));
}
// The two Agent submenus mirror Settings > Reasoning and Settings > Actions: the same choices, the same one ticked.
// The built-in reasoning belongs to the live voice system in use (GPT-Live reasoning or Gemini reasoning). It answers
// questions but cannot act on this Mac, so actions can only "follow" a reasoning provider that is itself an agent.
const builtInReasoning=config=>config.liveProvider==='gemini'?'Gemini reasoning':'GPT-Live reasoning';
function providerMenu(config,{active,update,openSettings,available=installed(config),following=null}){
 const values=permissions(config),on=config.agentEnabled!==false,canFollow=Boolean(following),follows=on&&canFollow&&config.agentFollowReasoning!==false;
 return {label:'Actions & Permissions',submenu:[
  {label:'Let avatars carry out my requests',type:'checkbox',checked:on,click:()=>update({agentEnabled:!on})},
  // Who does the work is said once: by the ticked "Follow reasoning agent · now X", or by the ✓ on an engine below.
  ...(on?[]:[{label:'Off: she will say she cannot do it',enabled:false}]),
  {type:'separator'},
  {label:canFollow?'Follow reasoning agent · now '+ENGINES[following]:'Follow reasoning agent · not possible with '+(config.reasoningMode==='delegate'?'this reasoning provider':builtInReasoning(config)),type:'checkbox',checked:follows,enabled:on&&canFollow,click:()=>update({agentFollowReasoning:!follows})},
  ...Object.entries(ENGINES).map(([engine,label])=>({label:(on&&active===engine?'✓ ':'')+label+(available[engine]?'':' · not installed'),enabled:on,submenu:[
   {label:'Use '+label+' for actions',type:'radio',checked:on&&active===engine,enabled:available[engine],click:()=>update({agentEngine:engine,agentFollowReasoning:false})},
   {type:'separator'},
   ...permissionChoices(engine).map(choice=>({label:choice.label,type:'radio',checked:values[engine]===choice.value,enabled:available[engine],click:()=>update({agentPermissions:{[engine]:choice.value}})})),
   ...(engine==='codex'?[]:[{type:'separator'},{label:'Agent’s own permissions also apply',enabled:false}]),
  ]})),
  {type:'separator'},{label:'Action settings…',click:openSettings},
 ]};
}
function reasoningMenu(config,{active,update,openSettings,available=installed(config)}){
 const delegating=config.reasoningMode==='delegate',names={openai:'OpenAI',xai:'xAI'};
 return {label:'Reasoning',submenu:[
  {label:builtInReasoning(config),type:'radio',checked:!delegating,click:()=>update({reasoningMode:'managed'})},
  {type:'separator'},{label:'Delegate harder questions to',enabled:false},
  ...Object.entries(ENGINES).map(([engine,label])=>({label:label+(available[engine]?'':' · not installed'),type:'radio',checked:delegating&&active===engine,enabled:available[engine],click:()=>update(selectEngine(engine))})),
  // a plain API provider chosen in Settings has no engine of its own: show it, ticked, rather than nothing ticked
  ...(delegating&&!active?[{label:(names[config.delegateProvider]||'Another provider')+' · set in Settings',type:'radio',checked:true,click:openSettings}]:[]),
  {type:'separator'},{label:'More reasoning options…',click:openSettings},
 ]};
}
module.exports={ENGINES,ACP_PERMISSIONS,permissionChoices,permissions,permissionPatch,engineConfig,selectEngine,installed,providerMenu,reasoningMenu};
