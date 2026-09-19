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
 await js(solo,"await gla.openSettings('actions');return 1");
 const st=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/settings.html')),'settings');
 await until(()=>js(st,"return Boolean(document.querySelector('#chip-voice')?.textContent)"),'rendered');
 const selected=()=>js(st,"return document.querySelector('#tabs [aria-selected=true]').dataset.pane");
 assert.equal(await selected(),'actions','opened on the requested pane');
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
 assert.equal(chips.voice,'Needs an OpenAI API key');assert.match(chips.character,/^Sarah · Gleam · \d+ motions$/,'the character chip names her voice');assert.equal(chips.actions,'On · EnConvo');assert.match(chips.agents,/^EnConvo · /);assert.match(chips.instinct,/built-in rules/);
 assert.equal(await js(st,"return document.querySelector('#dot-voice').className"),'dot bad');assert.equal(await js(st,"return document.querySelector('#dot-actions').className"),'dot ok');
 assert.match(await js(st,"return document.querySelector('#appVersion').textContent"),/^Version \d/);
 assert.deepEqual(await js(st,"gla_settings_pane('agents');return [...document.querySelectorAll('#agentBindingsTable th')].filter(t=>getComputedStyle(t).display!=='none').map(t=>t.textContent)"),['Character','EnConvo agent'],'only the engine in use has a column');
 // Save model: a change applies itself and says so; there are no Save buttons left to forget.
 assert.deepEqual(await js(st,"return ['saveDelegateModel','codexSaveModel','runtimeSavePath','runtimeSaveModel'].filter(id=>document.getElementById(id))"),[]);
 const tickOn=()=>js(st,"return document.querySelector('#savedTick').classList.contains('on')");
 await js(st,"gla_settings_pane('appearance');const b=document.querySelector('#bubbleMode');b.value='always';b.dispatchEvent(new Event('change'));return 1");
 await until(tickOn,'Saved tick after a select');assert.equal((await js(st,'return (await gla.getSettings()).bubbleMode')),'always');
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
