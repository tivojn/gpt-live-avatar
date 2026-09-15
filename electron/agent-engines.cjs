'use strict';
const {PERMISSION_CHOICES,normalizePermission}=require('./agent-permissions.cjs');
const ENGINES=Object.freeze({codex:'Codex App Server',openclaw:'OpenClaw',hermes:'Hermes',grok:'Grok Build'});
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
 return {reasoningMode:'delegate',delegateProvider:engine==='codex'?'openai':engine,delegateAuth:engine==='codex'?'codex_app_server':'local_runtime',agentEngine:engine};
}
function installed(config){
 return Object.fromEntries(Object.keys(ENGINES).map(engine=>{try{
  if(engine==='codex')require('./codex-client.cjs').findCodex();
  else require('./acp-client.cjs').findRuntime(engine,config.agentRuntimePaths?.[engine]||'');
  return [engine,true];
 }catch{return [engine,false];}}));
}
function providerMenu(config,{active,update,openSettings,available=installed(config)}){
 const values=permissions(config);
 return {label:'Delegate Reasoning Provider',submenu:[
  ...Object.entries(ENGINES).map(([engine,label])=>({label:(active===engine?'✓ ':'')+label+(available[engine]?'':' · not installed'),submenu:[
   {label:'Use '+label,type:'radio',checked:active===engine,enabled:available[engine],click:()=>update(selectEngine(engine))},
   {type:'separator'},
   ...permissionChoices(engine).map(choice=>({label:choice.label,type:'radio',checked:values[engine]===choice.value,enabled:available[engine],click:()=>update({agentPermissions:{[engine]:choice.value}})})),
   ...(engine==='codex'?[]:[{type:'separator'},{label:'Agent’s own permissions also apply',enabled:false}]),
  ]})),
  {type:'separator'},{label:'More reasoning options…',click:openSettings},
 ]};
}
module.exports={ENGINES,ACP_PERMISSIONS,permissionChoices,permissions,permissionPatch,engineConfig,selectEngine,installed,providerMenu};
