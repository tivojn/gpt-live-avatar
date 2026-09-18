'use strict';
// Gemini Live, main-process side: which model and voice, the setup message, the
// hand-off wording, key checks and the single-use token. The network is faked;
// the API key must only ever travel in the x-goog-api-key header.
const assert=require('node:assert/strict');
const g=require('../electron/gemini-live.cjs');
const KEY='AQ.Ab8_example-key.with-dots_0123456789';
(async()=>{
 // ---- choices fall back to something valid
 assert.deepEqual(g.choice({}),{model:'gemini-3.8-live',thinking:false,voice:'Aoede',thinkingLevel:'low'});
 assert.deepEqual(g.choice({geminiModel:'gemini-3.8-live-extended-thinking',geminiVoice:'Kore',geminiThinkingLevel:'high'}),{model:'gemini-3.8-live-extended-thinking',thinking:true,voice:'Kore',thinkingLevel:'high'});
 assert.equal(g.choice({geminiModel:'gpt-live-1',geminiVoice:'marin',geminiThinkingLevel:'minimal'}).model,'gemini-3.8-live','MINIMAL is not a level this model accepts');
 assert.equal(g.choice({geminiThinkingLevel:'minimal'}).thinkingLevel,'low');
 assert(g.validKey(KEY)&&g.validKey('AIza'+'x'.repeat(35)));assert(!g.validKey('short')&&!g.validKey('has space in it 0123456789')&&!g.validKey(null));
 // ---- the setup message
 const config={geminiModel:'gemini-3.8-live',geminiVoice:'Leda'};
 let {setup}=g.buildSetup({config,instructions:'You are Tia.',history:[{role:'user',text:'Hi'},{role:'assistant',text:'Hello!'},{role:'system',text:'x'}]});
 assert.equal(setup.model,'models/gemini-3.8-live');assert.deepEqual(setup.generationConfig.responseModalities,['AUDIO']);
 assert.equal(setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName,'Leda');assert(!('thinkingConfig' in setup.generationConfig),'the standard model does not take a thinking level');
 assert.match(setup.systemInstruction.parts[0].text,/^You are Tia\.\n\nThe conversation so far[^\n]*\nUser: Hi\nYou: Hello!$/);
 const fn=setup.tools[0].functionDeclarations[0];assert.equal(fn.name,g.TOOL);assert.equal(fn.behavior,'NON_BLOCKING','Extended Thinking refuses blocking tools; one declaration serves both models');assert.deepEqual(fn.parameters.required,['request']);
 assert.deepEqual(setup.inputAudioTranscription,{});assert.deepEqual(setup.outputAudioTranscription,{});assert.deepEqual(setup.sessionResumption,{});assert('slidingWindow' in setup.contextWindowCompression);
 ({setup}=g.buildSetup({config:{geminiModel:'gemini-3.8-live-extended-thinking',geminiThinkingLevel:'medium'},instructions:'x',delegate:false,resumeHandle:'h-1'}));
 assert.deepEqual(setup.generationConfig.thinkingConfig,{thinkingLevel:'MEDIUM'});assert(!('tools' in setup),'nothing to hand off to, no function');assert.deepEqual(setup.sessionResumption,{handle:'h-1'});
 assert.equal(g.historyText([]),'');
 // ---- the hand-off wording follows what is behind it
 let policy=g.handOffPolicy({});assert.match(policy,/one function, ask_assistant/);assert.match(policy,/careful reasoning/);assert(!/real task/.test(policy));assert.match(policy,/Let me check/);
 policy=g.handOffPolicy({agent:true,engine:'enconvo',thinking:true});assert.match(policy,/agent engine \(enconvo\)/);assert.match(policy,/any real task/);assert.match(policy,/reason out yourself/);assert(!/careful reasoning, detailed facts/.test(policy),'a thinking model is not told to hand off reasoning');
 // ---- key check and model list
 const calls=[];const net=routes=>async(url,init={})=>{calls.push({url,init});const hit=routes.find(r=>url.includes(r[0]));const [,status,body]=hit||[,404,{error:{message:'not found'}}];return {ok:status>=200&&status<300,status,json:async()=>typeof body==='function'?body(url):body};};
 let models=await g.availableModels(KEY,net([['/models',200,url=>url.includes('pageToken=p2')?{models:[{name:'models/gemini-3.8-live-extended-thinking'}]}:{models:[{name:'models/gemini-3.8-flash'},{name:'models/gemini-3.8-live'}],nextPageToken:'p2'}]]));
 assert.deepEqual(models,['gemini-3.8-live','gemini-3.8-live-extended-thinking']);
 for(const call of calls){assert.equal(call.init.headers['x-goog-api-key'],KEY);assert(!call.url.includes(KEY),'the key is never put in a URL');assert.equal(call.init.redirect,'error');}
 await assert.rejects(g.availableModels(KEY,net([['/models',400,{error:{message:'API key not valid. Please pass a valid API key.',status:'INVALID_ARGUMENT'}}]])),/rejected this Gemini API key/);
 await assert.rejects(g.availableModels(KEY,net([['/models',429,{error:{message:'quota'}}]])),/rate or quota/);
 await assert.rejects(g.availableModels(KEY,async()=>{throw Object.assign(Error('x'),{name:'TimeoutError'});}),/did not answer in time/);
 // ---- the token: one use, one model, short-lived, and no key in what the renderer gets
 calls.length=0;const now=Date.UTC(2026,8,19,12,0,0);
 const sealed=g.buildSetup({config:{geminiModel:'gemini-3.8-live'},instructions:'You are Tia.'});
 let token=await g.createToken({key:KEY,setup:sealed,now,fetchImpl:net([['/auth_tokens',200,{name:'auth_tokens/abc123XYZ'}]])});
 assert.equal(token,'auth_tokens/abc123XYZ');const sent=JSON.parse(calls[0].init.body);assert.equal(calls[0].init.method,'POST');
 assert.deepEqual(Object.keys(sent).sort(),['bidiGenerateContentSetup','expireTime','newSessionExpireTime','uses'],'REST field names; Google rejects the SDKs’ "liveConnectConstraints", and no fieldMask means the token’s setup is the whole truth');
 assert.equal(sent.uses,1);assert.equal(sent.newSessionExpireTime,'2026-09-19T12:02:00.000Z');assert.equal(sent.expireTime,'2026-09-19T12:30:00.000Z');
 assert.deepEqual(sent.bidiGenerateContentSetup,sealed.setup,'the whole setup is sealed into the token, bare (not wrapped in {setup})');assert.match(sent.bidiGenerateContentSetup.systemInstruction.parts[0].text,/You are Tia/);
 assert.equal(await g.createToken({key:KEY,setup:sealed,fetchImpl:net([['/auth_tokens',200,{token:{name:'auth_tokens/other-shape'}}]])}),'auth_tokens/other-shape');
 await assert.rejects(g.createToken({key:KEY,setup:sealed,fetchImpl:net([['/auth_tokens',200,{}]])}),/did not return a session token/);
 await assert.rejects(g.createToken({key:'',setup:sealed}),/Add your Gemini API key/);await assert.rejects(g.createToken({key:KEY,setup:{setup:{model:'models/gpt-live-1'}}}),/supported Gemini Live model/);
 const session=await g.createSession({key:KEY,config:{geminiModel:'gemini-3.8-live-extended-thinking'},instructions:'x',history:[],delegate:true,fetchImpl:net([['/auth_tokens',200,{name:'auth_tokens/a/b+c'}]])});
 assert.equal(session.provider,'gemini');assert.equal(session.thinking,true);assert.equal(session.tool,'ask_assistant');
 assert.deepEqual(session.urls.map(u=>u.split('?')[0].split('.').slice(-3,-2)[0]),['v1beta','v1alpha'],'v1beta first, the older constrained endpoint as a fallback');
 assert(session.urls.every(u=>u.endsWith('?access_token=auth_tokens%2Fa%2Fb%2Bc')&&u.includes('BidiGenerateContentConstrained')));assert(!JSON.stringify(session).includes(KEY),'the renderer never sees the API key');
 console.log('Gemini Live (main): model, voice and thinking choices, setup message, hand-off wording, key check, single-use token, key only in a header.');
})().catch(e=>{console.error(e);process.exitCode=1;});
