'use strict';
// Settings in the real app: sidebar panes, deep links from the menus, the
// status chips, and the save model (everything applies as you change it and
// says "Saved"; secrets and the voice keep an explicit step).
// Run: npx electron qa/settings-app.cjs
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'build/qa-settings-app'),profile=path.join(out,'profile');
fs.rmSync(profile,{recursive:true,force:true});fs.mkdirSync(profile+'/avatars',{recursive:true});app.setPath('userData',profile);
fs.symlinkSync(root+'/build/characters/sarah',profile+'/avatars/sarah');
fs.writeFileSync(profile+'/config.json',JSON.stringify({avatar:'sarah',quality:'friendly',bubbleMode:'off',agentEnabled:true,agentEngine:'enconvo',agentFollowReasoning:false,avatarLooks:{sarah:{}}}));
const errors=[];app.on('browser-window-created',(_e,w)=>w.webContents.on('console-message',d=>{if(d.level==='error')errors.push(d.message);}));
require('../electron/main.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label,ms=60000){const end=Date.now()+ms;while(Date.now()<end){const v=await fn();if(v)return v;await wait(120);}throw Error('Timed out: '+label);}
const js=(w,code)=>w.webContents.executeJavaScript('(async()=>{'+code+'})()');
app.whenReady().then(async()=>{try{
 const solo=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/avatar.html')),'solo');await until(()=>js(solo,'return Boolean(window.gla_avatar?.resources?.ready)'),'avatar');
 // A deep link from the menus lands on its pane; the window's address stays plain for everything that looks it up.
 // (a first launch without a key opens Settings by itself, on a plain address: close it so the deep link opens a fresh window)
 for(const w of BrowserWindow.getAllWindows())if(w.webContents.getURL().includes('/settings.html'))w.destroy();
 await js(solo,"await gla.openSettings('actions');return 1");
 const st=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/settings.html')),'settings');
 await until(()=>js(st,"return Boolean(document.querySelector('#chip-voice')?.textContent)"),'rendered');
 const selected=()=>js(st,"return document.querySelector('#tabs [aria-selected=true]').dataset.pane");
 assert.equal(await selected(),'actions','opened on the requested pane');
 // Opened on a pane, the window's address ends in #actions. Every agent check made from Settings (Check agent connection,
 // Refresh installed agents, the per-character agent lists) must still be accepted as coming from the app.
 assert.match(st.webContents.getURL(),/\/settings\.html#actions$/);
 for(const call of ["gla.agent.runtimeStatus('enconvo')","gla.agent.runtimeStatus('openclaw')","gla.agent.inventory()"]){const result=await js(st,'return '+call);assert.notEqual(result?.error,'Unavailable outside the app.',call+' from a deep-linked Settings window');}
 await js(solo,"await gla.openSettings('reasoning');return 1");await until(async()=>await selected()==='reasoning','an open window follows a second deep link');
 // One pane at a time, all of them reachable, arrow keys walk the list.
 const panes=await js(st,"return [...document.querySelectorAll('#tabs .tab')].map(t=>t.dataset.pane)");
 assert.deepEqual(panes,['voice','character','appearance','reasoning','actions','agents','instinct','shortcuts']);
 for(const pane of panes){await js(st,`document.querySelector('#tab-${pane}').click();return 1`);assert.deepEqual(await js(st,"return [...document.querySelectorAll('.pane')].filter(p=>!p.hidden).map(p=>p.id)"),['pane-'+pane]);}
 await js(st,"const t=document.querySelector('#tab-voice');t.click();t.focus();t.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));return 1");
 assert.equal(await selected(),'character');assert.equal(await js(st,'return document.activeElement.id'),'tab-character');
 await js(st,"document.querySelector('#tab-voice').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true}));return 1");assert.equal(await selected(),'shortcuts','the list wraps');
 // Status at a glance: a chip per pane and the same verdict as a dot beside its name.
 const chips=await js(st,"return Object.fromEntries([...document.querySelectorAll('.chip')].map(c=>[c.id.slice(5),c.textContent]))");
 assert.equal(chips.voice,'Needs an OpenAI API key');assert.match(chips.character,/^Sarah · Gleam · \d+ motions$/,'the character chip names her voice');
 assert.deepEqual(await js(st,"const o=[...document.querySelector('#voice').options].map(x=>x.textContent);return [o.length,o[0],o.find(x=>x.startsWith('Stone')),o.find(x=>x.startsWith('Beacon'))]"),[13,'Marin · female · default','Stone · male','Beacon'],'gender where it is known, nothing where it is not');assert.equal(chips.actions,'On · EnConvo');assert.equal(chips.agents,'Everyone on the defaults');assert.match(chips.instinct,/built-in rules/);
 assert.equal(await js(st,"return document.querySelector('#dot-voice').className"),'dot bad');assert.equal(await js(st,"return document.querySelector('#dot-actions').className"),'dot ok');
 assert.match(await js(st,"return document.querySelector('#appVersion').textContent"),/^Version \d/);
 // Agents: one row per character. On the defaults her row shows what the defaults are, greyed; "Her own" unlocks it, and a change is hers alone.
 assert.deepEqual(await js(st,"gla_settings_pane('agents');return [...document.querySelectorAll('#agentBindingsTable th')].map(t=>t.textContent)"),['Character','Her own','Reasoning','Actions','Permission','Her agent']);
 const row=()=>js(st,"const r=document.querySelector('#agentBindings tr[data-character=sarah]');return [...r.querySelectorAll('input,select')].map(x=>[x.type==='checkbox'?x.checked:x.value,x.disabled])");
 const defaultRow=await row();assert.deepEqual(defaultRow.slice(0,3).map(x=>x[1]),[false,true,true],'only the switch is live on the defaults');assert.deepEqual(defaultRow.slice(0,3).map(x=>x[0]),[false,'managed','enconvo'],'greyed, her row shows what the defaults are');
 assert.deepEqual(await js(st,"const o=document.querySelector('select[aria-label=\"Sarah actions\"] option[value=follow]');return [o.textContent,o.disabled]"),['Follow her reasoning · not possible',true],'built-in reasoning cannot be followed');
 await js(st,"const x=document.querySelector('#agentBindings tr[data-character=sarah] input');x.checked=true;x.dispatchEvent(new Event('change'));return 1");
 await until(async()=>(await row())[1][1]===false,'her row unlocked');assert.equal((await js(st,'return (await gla.getSettings()).agentSummaries.sarah.text')),'GPT-Live reasoning · actions by EnConvo','her copy is what applied to her');
 await js(st,"const x=document.querySelector('select[aria-label=\"Sarah reasoning\"]');x.value='hermes';x.dispatchEvent(new Event('change'));return 1");
 await until(async()=>(await js(st,'return (await gla.getSettings()).agentSummaries.sarah.reasoningEngine'))==='hermes','her reasoning saved');
 {const mine=await js(st,'const s=await gla.getSettings();return [s.reasoningMode||"managed",s.agentSummaries.sarah.text,s.agentSummaries.sarah.canFollow,Object.values(s.agentSummaries).filter(x=>x.custom).length]');
  assert.deepEqual(mine,['managed','Hermes · actions by EnConvo',true,1],'the defaults and everyone else are untouched');}
 await until(()=>js(st,"return document.querySelector('select[aria-label=\"Sarah actions\"] option[value=follow]').textContent==='Follow · Hermes'"),'who would be followed is named');
 await js(st,"const x=document.querySelector('select[aria-label=\"Sarah actions\"]');x.value='follow';x.dispatchEvent(new Event('change'));return 1");
 await until(async()=>(await js(st,'return (await gla.getSettings()).agentSummaries.sarah.text'))==='Hermes · actions follow','her actions follow her reasoning');
 assert.equal(await js(st,"return document.querySelector('#agentBindings tr[data-character=sarah] td:last-child select').dataset.engine"),'hermes','the agent picker is for the engine that acts for her');
 await js(st,"const x=document.querySelector('select[aria-label=\"Sarah permission\"]');x.value='workspace';x.dispatchEvent(new Event('change'));return 1");
 await until(async()=>(await js(st,'return (await gla.getSettings()).agentSummaries.sarah.permission'))==='workspace','her permission for Hermes saved');assert.equal(await js(st,'return (await gla.getSettings()).agentPermissions.hermes'),'full','the default permission stays');
 assert.equal(await js(st,"return document.querySelector('#chip-agents').textContent"),'Sarah · own settings');
 await wait(300);fs.writeFileSync(out+'/agents.png',(await st.webContents.capturePage()).toPNG());
 {const fit=await js(st,"const m=document.querySelector('main')||document.body,t=document.querySelector('#agentBindingsTable');return [t.scrollWidth<=t.parentElement.clientWidth+1,document.documentElement.scrollWidth<=innerWidth+1]");assert.deepEqual(fit,[true,true],'the table fits the pane without scrolling sideways');}
 await js(st,"const x=document.querySelector('select[aria-label=\"Sarah actions\"]');x.value='off';x.dispatchEvent(new Event('change'));return 1");
 await until(async()=>(await js(st,'return (await gla.getSettings()).agentSummaries.sarah.actions'))==='off','her actions off');assert.equal(await js(st,'return (await gla.getSettings()).agentEnabled'),true,'still on by default');
 assert.equal(await js(st,"return document.querySelector('#agentBindings tr[data-character=sarah] td:last-child').textContent"),'—','no agent to choose when she does not act');
 await js(st,"const x=document.querySelector('#agentBindings tr[data-character=sarah] input');x.checked=false;x.dispatchEvent(new Event('change'));return 1");
 await until(async()=>(await js(st,'return (await gla.getSettings()).agentSummaries.sarah.custom'))===false,'back on the defaults');assert.equal((await row())[1][1],true);
 // Save model: a change applies itself and says so; there are no Save buttons left to forget.
 assert.deepEqual(await js(st,"return ['saveDelegateModel','codexSaveModel','runtimeSavePath','runtimeSaveModel'].filter(id=>document.getElementById(id))"),[]);
 const tickOn=()=>js(st,"return document.querySelector('#savedTick').classList.contains('on')");
 await js(st,"gla_settings_pane('appearance');const b=document.querySelector('#bubbleMode');b.value='always';b.dispatchEvent(new Event('change'));return 1");
 await until(tickOn,'Saved tick after a select');assert.equal((await js(st,'return (await gla.getSettings()).bubbleMode')),'always');
 // "Follow reasoning agent" says who that is: the option, its note and the chip all name the provider being followed
 await js(st,"await gla.setSettings({reasoningMode:'delegate',delegateProvider:'hermes',delegateAuth:'local_runtime',agentEnabled:true,agentFollowReasoning:true});gla_settings_pane('actions');return 1");
 await until(()=>js(st,"return document.querySelector('#agentEngine').value==='follow'&&/now Hermes/.test(document.querySelector('#agentEngine').selectedOptions[0].textContent)"),'the option names Hermes');
 assert.deepEqual(await js(st,"return [document.querySelector('#agentEngine').selectedOptions[0].textContent,/^Actions are carried out by Hermes, because Hermes is your reasoning provider/.test(document.querySelector('#sharedCodexEngine').textContent),document.querySelector('#chip-actions').textContent]"),['Follow reasoning agent · now Hermes (default)',true,'On · Hermes']);
 await js(st,"await gla.setSettings({reasoningMode:'delegate',delegateProvider:'enconvo',delegateAuth:'local_runtime'});return 1");await until(()=>js(st,"return /now EnConvo/.test(document.querySelector('#agentEngine').selectedOptions[0].textContent)&&document.querySelector('#chip-actions').textContent==='On · EnConvo'"),'changing the reasoning provider moves the name with it');
 await js(st,"await gla.setSettings({reasoningMode:'managed',agentEnabled:true,agentEngine:'enconvo',agentFollowReasoning:false});gla_settings_pane('appearance');return 1");
 // The wardrobe flourish switch: on unless turned off, saved as it changes, and the avatar's menu row follows it.
 assert.equal(await js(st,"return document.querySelector('#wardrobeFlourish').checked"),true);assert.equal(await js(st,"return document.querySelector('#wardrobeFlourish').closest('.pane').id"),'pane-appearance');
 await js(st,"document.querySelector('#wardrobeFlourish').click();return 1");await until(async()=>(await js(st,'return (await gla.getSettings()).wardrobeFlourish'))===false,'flourish off is saved');
 assert.equal(JSON.parse(fs.readFileSync(profile+'/config.json')).wardrobeFlourish,false);
 await js(st,"document.querySelector('#wardrobeFlourish').click();return 1");await until(async()=>(await js(st,'return (await gla.getSettings()).wardrobeFlourish'))===true,'and back on');
 // The Avatar Show script writer has its own model under Reasoning: OpenAI Luna unless told to follow the reasoning provider.
 assert.deepEqual(await js(st,"const s=document.querySelector('#showPlaywright');return [s.closest('.pane').id,s.value,[...s.options].map(o=>o.value)]"),['pane-reasoning','openai:gpt-5.6-luna',['openai:gpt-5.6-luna','openai:gpt-5.6-sol','openai:gpt-5.6-terra','openai:gpt-6-astra','reasoning']]);
 await js(st,"gla_settings_pane('reasoning');const s=document.querySelector('#showPlaywright');s.value='reasoning';s.dispatchEvent(new Event('change'));return 1");
 await until(async()=>(await js(st,'return (await gla.getSettings()).showPlaywright'))==='reasoning','script writer follows reasoning');assert.match(await js(st,"return document.querySelector('#showPlaywrightNote').textContent"),/a minute or two per script/);
 assert.equal((await js(st,"return (await gla.setSettings({showPlaywright:'openai:not-a-model'})).showPlaywright")),'reasoning','an unknown writer is refused');
 await js(st,"const s=document.querySelector('#showPlaywright');s.value='openai:gpt-5.6-luna';s.dispatchEvent(new Event('change'));return 1");await until(async()=>(await js(st,'return (await gla.getSettings()).showPlaywright'))==='openai:gpt-5.6-luna','and back');
 await until(async()=>!(await tickOn()),'the tick fades');
 await js(st,"gla_settings_pane('actions');const p=document.querySelector('#runtimePath');p.value='http://localhost:54535/';p.dispatchEvent(new Event('change'));return 1");
 await until(async()=>(await js(st,'return (await gla.getSettings()).agentRuntimePaths?.enconvo'))==='http://localhost:54535','the agent address saves on change, trailing slash removed');
 await js(st,"const p=document.querySelector('#runtimePath');p.value='https://example.com';p.dispatchEvent(new Event('change'));return 1");await wait(400);
 assert.equal(await js(st,'return (await gla.getSettings()).agentRuntimePaths.enconvo'),'http://localhost:54535','a value that is not the local EnConvo API is refused');
 assert.match(await js(st,"return document.querySelector('#runtimeState').textContent"),/EnConvo local API origin/);assert.equal(await js(st,"return document.querySelector('#runtimeState').className"),'state bad');
 await js(st,"gla_settings_pane('reasoning');const m=document.querySelector('#reasoningMode');m.value='delegate';m.dispatchEvent(new Event('change'));return 1");
 await until(()=>js(st,"return !document.querySelector('#delegateOptions').hidden"),'delegate options');
 await js(st,"const p=document.querySelector('#delegateProvider');p.value='openai';p.dispatchEvent(new Event('change'));return 1");await until(()=>js(st,"return document.querySelector('#delegateModel').options.length>2"),'model choices');
 const pick=await js(st,"const m=document.querySelector('#delegateModel');const o=[...m.options].map(o=>o.value).find(v=>v&&v!=='__custom__'&&v!==m.value);m.value=o;await m.onchange();return o");
 assert.equal(await js(st,'return (await gla.getSettings()).delegate.model'),pick,'choosing a model applies it');
 await js(st,"const m=document.querySelector('#delegateModel');m.value='__custom__';await m.onchange();const c=document.querySelector('#delegateModelCustom');c.value='not a model!';await c.onchange();return 1");
 assert.equal(await js(st,'return (await gla.getSettings()).delegate.model'),pick,'an invalid custom ID is not saved');assert.match(await js(st,"return document.querySelector('#delegateTestState').textContent"),/valid model ID/);
 await js(st,"const c=document.querySelector('#delegateModelCustom');c.value='my-org/custom-model-1';await c.onchange();return 1");assert.equal(await js(st,'return (await gla.getSettings()).delegate.model'),'my-org/custom-model-1');
 // The voice is the deliberate exception: audition first, then commit (committing reconnects a live conversation).
 await js(st,"gla_settings_pane('voice');return 1");assert.equal(await js(st,"return document.querySelector('#useVoice').disabled"),true,'nothing to commit yet');
 const before=await js(st,'return (await gla.getSettings()).voice');
 await js(st,"const v=document.querySelector('#voice');v.value=[...v.options].map(o=>o.value).find(x=>x!==v.value);v.dispatchEvent(new Event('change'));return 1");
 assert.equal(await js(st,'return (await gla.getSettings()).voice'),before,'choosing a voice does not apply it');assert.equal(await js(st,"return document.querySelector('#useVoice').disabled"),false);
 await js(st,"document.querySelector('#useVoice').click();return 1");await until(async()=>(await js(st,'return (await gla.getSettings()).voice'))!==before,'Use voice commits');
 fs.mkdirSync(out,{recursive:true});fs.writeFileSync(out+'/settings.png',(await st.webContents.capturePage()).toPNG());
 assert.deepEqual(errors,[]);console.log('Settings QA passed: panes, deep links, keyboard, status chips, apply-on-change with a Saved tick, refused values, and the two-step voice.');
}catch(e){console.error(e);console.error(errors);process.exitCode=1;}finally{app.exit(process.exitCode||0);}});
