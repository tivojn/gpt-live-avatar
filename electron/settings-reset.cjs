'use strict';
// "Reset this page to defaults" for Settings. Each page owns a fixed list of
// settings; resetting a page puts exactly those back to the values the app
// ships with and touches nothing else. Never reset from here: API keys and
// account sign-ins (they have their own Remove / Sign out), which character is
// on screen, her outfits, the window's place and size.
//
// The shipped values for Live Voice System, Reasoning, Actions and Agents were
// taken from the developer's working setup on 2026-09-19. Agents ships with
// nobody customised and no engine agent assigned: those names (an EnConvo
// agent id, a Hermes profile) exist only on the Mac that made them, and an
// assignment to an agent that is not there fails every task.
const PAGES=Object.freeze({
  voice:['liveProvider','geminiModel','geminiThinkingLevel','conversationSounds'],
  character:['characterVoices','persona'], // the voice of every character on both systems; the name and personality of the one on screen
  appearance:['quality','opacity','bubbleMode','bubble','wardrobeFlourish'],
  reasoning:['reasoningMode','delegateProvider','delegateAuth','delegateModels','backendModel','showPlaywright'],
  actions:['agentEnabled','agentEngine','agentFollowReasoning','agentPermissions','agentCodexModel','agentRuntimePaths','agentRuntimeModels','agentFolder'],
  agents:['characterAgents','avatarAgentBindings'],
  instinct:['instinctEnabled','instinctListening'],
});
const LABELS=Object.freeze({voice:'Live Voice System',character:'Character',appearance:'Appearance',reasoning:'Reasoning',actions:'Actions',agents:'Agents',instinct:'Instinct'});
// The config with one page back on the shipped values. `defaults` is main's DEFAULTS; `extra` carries what is not a plain
// value there: the shipped reasoning models, the default persona of the character on screen, the home Downloads folder.
function resetPage(config,page,defaults,extra={}){
  if(!Object.hasOwn(PAGES,page))throw Error('Unknown settings page.');
  const next={...config};
  for(const key of PAGES[page]){
    if(key==='characterVoices'){next.groupVoices={...defaults.groupVoices};next.geminiVoices={};next.voice=defaults.groupVoices[config.avatar]||defaults.voice;}
    else if(key==='persona'){if(extra.persona){next.personaName=extra.persona.name;next.persona=extra.persona.text;}}
    else if(key==='delegateModels')next.delegateModels={...extra.delegateModels};
    else if(key==='agentPermissions'){next.agentPermissions=undefined;next.agentAccess=defaults.agentAccess;}
    else if(key==='agentFolder')next.agentFolder=extra.agentFolder||defaults.agentFolder;
    else if(['agentRuntimePaths','agentRuntimeModels','avatarAgentBindings','characterAgents'].includes(key))next[key]={};
    else next[key]=defaults[key];
  }
  return next;
}
// Whether a page already is on the shipped values (the button is then disabled: nothing to reset).
function isDefault(config,page,defaults,extra={}){
  // blank entries count as none ("Runtime default" chosen in a table is the default), in any order, at any depth
  const prune=v=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,prune(x)]).filter(([,x])=>x!==''&&x!==undefined&&x!==null&&!(typeof x==='object'&&!Array.isArray(x)&&!Object.keys(x).length)).sort(([a],[b])=>a<b?-1:1)):v;
  const reset=resetPage(config,page,defaults,extra),norm=v=>JSON.stringify(prune(v===undefined?{}:v)??null);
  const keys=PAGES[page].flatMap(k=>k==='characterVoices'?['groupVoices','geminiVoices']:k==='persona'?['personaName','persona']:k==='agentPermissions'?[]:[k]);
  return keys.every(k=>norm(reset[k])===norm(config[k]))&&(!PAGES[page].includes('agentPermissions')||Object.values(config.agentPermissions||{}).every(v=>v===defaults.agentAccess));
}
module.exports={PAGES,LABELS,resetPage,isDefault};
