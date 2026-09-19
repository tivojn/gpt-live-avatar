'use strict';
// Agent settings per character. Settings > Reasoning and Settings > Actions are
// the defaults for everyone; a character may carry her own copy of any of them
// (config.characterAgents[slug]) and is on "the defaults" until something is
// changed for her. Everything that decides how a request is reasoned about or
// carried out asks effective(config, slug) instead of reading config directly.
//
// What can differ per character: the reasoning mode and provider, whether she
// may act at all, her action engine (or that it follows her reasoning), and the
// permission level she gives each engine. Keys, sign-ins, where an engine runs,
// the live voice system and the Avatar Show script writer stay global.
const {ENGINES,permissions,permissionPatch}=require('./agent-engines.cjs');
const {normalizeDelegate,reasoningEngine,actionEngine,selected}=require('./delegate.cjs');
const FIELDS=['reasoningMode','delegateProvider','delegateAuth','agentEnabled','agentEngine','agentFollowReasoning','agentPermissions'];
const slugOK=slug=>typeof slug==='string'&&/^[a-z0-9_-]{1,40}$/.test(slug);

const own=(config,slug)=>slugOK(slug)&&config.characterAgents&&typeof config.characterAgents[slug]==='object'&&config.characterAgents[slug]||null;
const isCustom=(config,slug)=>Boolean(own(config,slug));
// The settings that apply to this character: the defaults, with her own on top.
function effective(config,slug){
  const mine=own(config,slug);if(!mine)return config;
  const merged={...config};for(const key of FIELDS)if(key!=='agentPermissions'&&mine[key]!==undefined)merged[key]=mine[key];
  if(mine.agentPermissions)merged.agentPermissions=permissionPatch(config,mine.agentPermissions);
  return {...merged,...normalizeDelegate(merged)};
}
// One change for one character. The first change copies what applies to her now, so nothing else shifts under her.
function customise(config,slug,patch={}){
  if(!slugOK(slug))throw Error('Unknown character.');
  const now=effective(config,slug),next={reasoningMode:now.reasoningMode==='delegate'?'delegate':'managed',delegateProvider:now.delegateProvider,delegateAuth:now.delegateAuth,
    agentEnabled:now.agentEnabled!==false,agentEngine:ENGINES[now.agentEngine]?now.agentEngine:'codex',agentFollowReasoning:now.agentFollowReasoning!==false,agentPermissions:permissions(now)};
  if(['managed','delegate'].includes(patch.reasoningMode)||patch.delegateProvider||patch.delegateAuth)Object.assign(next,(({reasoningMode,delegateProvider,delegateAuth})=>({reasoningMode,delegateProvider,delegateAuth}))(normalizeDelegate({...config,...next},patch)));
  if(typeof patch.agentEnabled==='boolean')next.agentEnabled=patch.agentEnabled;
  if(ENGINES[patch.agentEngine])next.agentEngine=patch.agentEngine;
  if(typeof patch.agentFollowReasoning==='boolean')next.agentFollowReasoning=patch.agentFollowReasoning;
  if(patch.agentPermissions&&typeof patch.agentPermissions==='object')next.agentPermissions=permissionPatch({...config,agentPermissions:next.agentPermissions},patch.agentPermissions);
  return {...config,characterAgents:{...config.characterAgents,[slug]:next}};
}
function useDefaults(config,slug){const rest={...config.characterAgents};delete rest[slug];return {...config,characterAgents:rest};}
// Entries for characters that no longer exist, or that are not objects, are dropped when the config is read.
function clean(config,slugs){
  const kept={};for(const [slug,value] of Object.entries(config.characterAgents&&typeof config.characterAgents==='object'?config.characterAgents:{}))
    if(slugOK(slug)&&value&&typeof value==='object'&&(!slugs||slugs.includes(slug)))kept[slug]=customise({...config,characterAgents:{}},slug,value).characterAgents[slug];
  return kept;
}
const providerName=c=>{const engine=reasoningEngine(c);return engine?ENGINES[engine]:c.reasoningMode==='delegate'?({openai:'OpenAI',xai:'xAI'})[selected(c).provider]||'Delegate':c.liveProvider==='gemini'?'Gemini reasoning':'GPT-Live reasoning';};
// One line for a list: "Hermes · actions follow" / "Gemini reasoning · actions by Codex App Server" / "… · actions off".
function summary(config,slug){
  const c=effective(config,slug),follows=c.agentEnabled!==false&&c.agentFollowReasoning!==false&&Boolean(reasoningEngine(c));
  return {custom:isCustom(config,slug),reasoningMode:c.reasoningMode==='delegate'?'delegate':'managed',canFollow:Boolean(reasoningEngine(c)),provider:selected(c).provider,auth:selected(c).auth,reasoning:providerName(c),reasoningEngine:reasoningEngine(c),actions:c.agentEnabled===false?'off':follows?'follow':actionEngine(c),actionEngine:c.agentEnabled===false?null:actionEngine(c),permission:c.agentEnabled===false?null:permissions(c)[actionEngine(c)],
    text:providerName(c)+' · '+(c.agentEnabled===false?'actions off':follows?'actions follow':'actions by '+ENGINES[actionEngine(c)])};
}
module.exports={FIELDS,effective,customise,useDefaults,isCustom,clean,summary};
