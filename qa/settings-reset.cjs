'use strict';
// "Reset this page to defaults" (electron/settings-reset.cjs): each Settings page puts back its own settings and only
// those; keys, sign-ins, the character on screen, her outfits and the window are never part of any page.
const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const {PAGES,LABELS,resetPage,isDefault}=require('../electron/settings-reset.cjs');
const {DEFAULT_MODELS}=require('../electron/delegate.cjs');
const defaults={voice:'gleam',groupVoices:{tia:'marin',sarah:'gleam'},quality:'balanced',opacity:1,bubble:true,bubbleMode:'auto',wardrobeFlourish:true,conversationSounds:true,liveProvider:'openai',geminiModel:'gemini-3.8-live-extended-thinking',geminiThinkingLevel:'low',
  backendModel:'gpt-5.6-luna',reasoningMode:'delegate',delegateProvider:'openai',delegateAuth:'api_key',showPlaywright:'openai:gpt-5.6-luna',agentEnabled:true,agentEngine:'codex',agentFollowReasoning:true,agentAccess:'full',agentCodexModel:'gpt-5.6-luna',agentFolder:'/Users/x/Downloads',instinctEnabled:true,instinctListening:true};
const extra={delegateModels:DEFAULT_MODELS,agentFolder:'/Users/x/Downloads',persona:{name:'Tia',text:'You are Tia.'}};
const messy={...defaults,avatar:'tia',avatarLooks:{tia:{outfit:'red'}},windowX:12,shortcuts:{recover:'X'},personaName:'Bob',persona:'grumpy',voice:'stone',groupVoices:{tia:'stone',sarah:'stone'},geminiVoices:{tia:'Puck'},
  quality:'best',opacity:.3,bubble:false,bubbleMode:'off',wardrobeFlourish:false,conversationSounds:false,liveProvider:'gemini',geminiModel:'gemini-3.8-live',geminiThinkingLevel:'high',
  backendModel:'x',reasoningMode:'managed',delegateProvider:'xai',delegateAuth:'oauth2',delegateModels:{'openai:api_key':'weird'},showPlaywright:'reasoning',
  agentEnabled:false,agentEngine:'grok',agentFollowReasoning:false,agentPermissions:{codex:'workspace',hermes:'workspace'},agentCodexModel:'odd',agentRuntimePaths:{hermes:'/nope'},agentRuntimeModels:{hermes:'m'},agentFolder:'/',
  characterAgents:{tia:{agentEnabled:false}},avatarAgentBindings:{tia:{hermes:'gone'}},instinctEnabled:false,instinctListening:false};

// every page with a button exists here, and no setting belongs to two pages
assert.deepEqual(Object.keys(PAGES),Object.keys(LABELS));const all=Object.values(PAGES).flat();assert.equal(new Set(all).size,all.length);
for(const page of Object.keys(PAGES)){
  assert.equal(isDefault(messy,page,defaults,extra),false,page+' is off its defaults');
  const next=resetPage(messy,page,defaults,extra);assert.equal(isDefault(next,page,defaults,extra),true,page+' is back');
  // and only that page moved
  for(const other of Object.keys(PAGES))if(other!==page)assert.equal(isDefault(next,other,defaults,extra),false,page+' must not reset '+other);
  for(const kept of ['avatar','avatarLooks','windowX','shortcuts'])assert.deepEqual(next[kept],messy[kept],page+' keeps '+kept);
}
// what each one puts back
let r=resetPage(messy,'voice',defaults,extra);assert.deepEqual([r.liveProvider,r.geminiModel,r.geminiThinkingLevel,r.conversationSounds],['openai','gemini-3.8-live-extended-thinking','low',true]);
r=resetPage(messy,'character',defaults,extra);assert.deepEqual([r.voice,r.groupVoices,r.geminiVoices,r.personaName,r.persona],['marin',{tia:'marin',sarah:'gleam'},{},'Tia','You are Tia.']);
r=resetPage(messy,'reasoning',defaults,extra);assert.deepEqual([r.reasoningMode,r.delegateProvider,r.delegateAuth,r.delegateModels['openai:api_key'],r.delegateModels['openai:codex_app_server'],r.showPlaywright],['delegate','openai','api_key','gpt-5.6-luna','','openai:gpt-5.6-luna']);
r=resetPage(messy,'actions',defaults,extra);assert.deepEqual([r.agentEnabled,r.agentEngine,r.agentFollowReasoning,r.agentPermissions,r.agentAccess,r.agentCodexModel,r.agentRuntimePaths,r.agentFolder],[true,'codex',true,undefined,'full','gpt-5.6-luna',{},'/Users/x/Downloads']);
r=resetPage(messy,'agents',defaults,extra);assert.deepEqual([r.characterAgents,r.avatarAgentBindings],[{},{}]);assert.equal(r.agentEngine,'grok','the defaults themselves belong to Actions');
// blank entries are the same as none: a table of "Runtime default" choices is on the defaults
assert.equal(isDefault({...resetPage(messy,'agents',defaults,extra),avatarAgentBindings:{tia:{hermes:''},sarah:{}}},'agents',defaults,extra),true);
assert.throws(()=>resetPage(messy,'keys',defaults,extra),/Unknown settings page/);
// nothing about keys or sign-ins is in any page
assert(!all.some(k=>/key|credential|token|signin/i.test(k)));
// the shipped defaults in main are the ones this test describes
const main=fs.readFileSync(path.join(__dirname,'../electron/main.cjs'),'utf8');
for(const text of ["reasoningMode: 'delegate', delegateProvider: 'openai', delegateAuth: 'api_key'","agentCodexModel: 'gpt-5.6-luna'","geminiModel: 'gemini-3.8-live-extended-thinking'","liveProvider: 'openai'","agentEnabled: true","agentFollowReasoning: true"])assert(main.includes(text),'main ships '+text);
console.log('settings-reset: each page resets its own settings and nothing else; keys, sign-ins, character and outfits are untouched.');
