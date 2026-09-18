'use strict';
// Validate first-launch defaults in real solo/group renderers; no API key or mic.
// GLA_QA_OUTPUT can select an ignored/private artifact directory.
const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const savedTia=process.argv.includes('--saved-tia');
const repo=path.resolve(__dirname,'..'),out=process.env.GLA_QA_OUTPUT||fs.mkdtempSync(path.join(os.tmpdir(),'gla-appearance-defaults-')),profile=path.join(out,'profile');
const starter=require('../electron/default-avatar.json'),defaults=require('../electron/default-appearance.json'),voices=require('../electron/default-voices.json');
assert.equal(starter.slug,'sarah');assert.equal(starter.name,'Sarah');assert.equal(starter.voice,'gleam');assert.equal(defaults.sarah.outfit,'casual');
fs.mkdirSync(path.join(profile,'avatars'),{recursive:true});app.setPath('userData',profile);delete process.env.GLA_OPENAI_KEY;
// Deliberately omit avatar, persona and voice: this must exercise fresh defaults.
fs.writeFileSync(path.join(profile,'config.json'),JSON.stringify({quality:'balanced',conversationSounds:false,...(savedTia?{avatar:'tia'}:{})}));
for(const slug of Object.keys(defaults)){const dest=path.join(profile,'avatars',slug);if(!fs.existsSync(dest))fs.symlinkSync(path.join(repo,'build/characters',slug),dest);}
const moduleAssets=require('../electron/assets.cjs'),Original=moduleAssets.AvatarAssets;
moduleAssets.AvatarAssets=class extends Original{constructor(opts){super({...opts,developmentRoot:undefined,bundledRoot:path.join(out,'empty-bundled'),fetcher:async()=>{throw Error('Network disabled in appearance QA.');}});}};
const errors=[];app.on('browser-window-created',(_e,w)=>{w.webContents.on('console-message',d=>{if(d.level==='error')errors.push(d.message);});w.webContents.on('render-process-gone',(_e,d)=>errors.push('Renderer exited: '+d.reason));});
app.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest((detail,done)=>done({cancel:! /^(?:file:|data:|blob:|devtools:|http:\/\/(?:127\.0\.0\.1|localhost):)/.test(detail.url)})));
require('../electron/main.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms)),run=(w,s)=>w.webContents.executeJavaScript('(async()=>{'+s+'})()');
async function until(fn,label){const end=Date.now()+120000;let last;while(Date.now()<end){try{const result=await fn();if(result)return result;}catch(e){last=e;}await wait(100);}throw Error(label+(last?': '+last.message:''));}
async function ready(w,slug){await until(()=>run(w,`const s=await gla.getSettings();return s.avatar.slug===${JSON.stringify(slug)}&&window.gla_avatar?.resources.ready&&gla_avatar.characterId===${JSON.stringify(slug)}&&gla_avatar.appearance?.indexURL===s.avatar.appearanceURL&&!window.gla_flourish?.();`),slug+' ready and her wardrobe flourish over');await wait(350);}
const inspect=`const a=gla_avatar,s=await gla.getSettings(),o=a.options;const visible=name=>(o.nodes.get(name)||[]).some(n=>{for(let p=n;p;p=p.parent)if(!p.visible)return false;return true;});return {slug:s.avatar.slug,name:s.avatar.name,personaName:s.personaName,voice:s.voice,selection:o.selection,pose:o.poses.get(o.selection.body)?.label,outfit:o.outfits.find(x=>x.id===o.selection.outfit),visible:Object.fromEntries(['Fem-A_Top_Ac_Tshtt','Fem-A_Top_Ac_ChnCt','Fem-A_Bot_Ac_ChnPnts_1','Fem-A_Bot_Ac_ChnPnts_2','Fem-A_Fot_Ac_Sndlhl'].map(n=>[n,visible(n)]))};`;
function sarahLook(info){assert.equal(info.slug,'sarah');assert.equal(info.name,'Sarah');assert.equal(info.personaName,'Sarah');assert.equal(info.voice,'gleam');assert.equal(info.selection.outfit,'casual');assert(!info.selection.prop,'Sarah starts without props');for(const n of ['Fem-A_Top_Ac_Tshtt','Fem-A_Bot_Ac_ChnPnts_1','Fem-A_Bot_Ac_ChnPnts_2','Fem-A_Fot_Ac_Sndlhl'])assert.equal(info.visible[n],true,n+' is visible');assert.equal(info.visible['Fem-A_Top_Ac_ChnCt'],false,'The coat is hidden');}
let solo,group,report={passed:false,out};
app.whenReady().then(async()=>{try{
 solo=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/avatar.html')),'solo');await ready(solo,savedTia?'tia':starter.slug);
 if(savedTia){const saved=await run(solo,inspect);assert.equal(saved.slug,'tia');assert.equal(saved.personaName,'Tia');assert.equal(saved.voice,voices.tia);assert.equal(saved.pose,'Standing · 6');assert(!saved.selection.prop);assert.deepEqual(errors,[]);report={...report,passed:true,savedTia:saved,errors};console.log('Saved Tia without persona/voice fields preserves Tia, Marin, Standing 6 and no props. '+out);return;}
 const fresh=await run(solo,inspect);sarahLook(fresh);report.freshDefault=fresh;
 fs.writeFileSync(path.join(out,'sarah-fresh-default.png'),Buffer.from((await run(solo,'return gla_avatar.snapshot(1000)')).split(',')[1],'base64'));
 await run(solo,"await gla.selectAvatar('tia')");await ready(solo,'tia');const tia=await run(solo,inspect);assert.equal(tia.voice,voices.tia);assert.equal(tia.pose,'Standing · 6');assert(!tia.selection.prop);report.explicitTia=tia;
 fs.writeFileSync(path.join(out,'tia-standing-six.png'),Buffer.from((await run(solo,'return gla_avatar.snapshot(1000)')).split(',')[1],'base64'));
 await run(solo,"await gla.selectAvatar('sarah')");await ready(solo,'sarah');sarahLook(await run(solo,inspect));
 await run(solo,'gla.group.open()');group=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/group.html')),'group');await until(()=>run(group,'return window.gla_group&&!gla_group.state.loading'),'group ready');
 await run(group,"document.querySelectorAll('.choice input').forEach(i=>i.checked=true);await gla_group.loadCast();document.querySelector('#minimize').click();");await wait(1500);
 const rows=await run(group,"return [...gla_group.actors.values()].map(a=>({slug:a.slug,selection:a.avatar.options.selection,pose:a.avatar.options.poses.get(a.avatar.options.selection.body)?.label,voice:document.querySelector('[data-voice=\"'+a.slug+'\"]').value}));");assert.equal(rows.length,5);
 for(const row of rows){assert(!row.selection.prop,row.slug+' has no prop');assert.equal(row.voice,voices[row.slug]);for(const [key,value]of Object.entries(defaults[row.slug]))if(value&&key!=='playTransitions'&&key!=='followCursor')assert.equal(row.selection[key],value,row.slug+' '+key);}
 assert.equal(rows.find(r=>r.slug==='tia').pose,'Standing · 6');assert.equal(rows.find(r=>r.slug==='sarah').selection.outfit,'casual');
 fs.writeFileSync(path.join(out,'five-defaults.png'),(await group.webContents.capturePage()).toPNG());
 group.close();group=null;await ready(solo,'sarah');
 const soloVoices=[];for(const row of rows){const settings=await run(solo,'return await gla.selectAvatar('+JSON.stringify(row.slug)+')');assert.equal(settings.voice,voices[row.slug],row.slug+' solo voice follows the character');soloVoices.push({slug:row.slug,voice:settings.voice});await ready(solo,row.slug);}
 await run(solo,"await gla.selectAvatar('sarah')");await ready(solo,'sarah');sarahLook(await run(solo,inspect));assert.deepEqual(errors,[]);
 report={...report,passed:true,group:rows,soloVoices,errors};console.log('Fresh Sarah: Gleam, visible long pants/top/sandals, coat and props off; explicit Tia Standing 6; five group appearances/voices passed. '+out);
 }catch(e){report.error=e.stack;report.errors=errors;console.error(e.stack);process.exitCode=1;for(const [label,w] of [['solo',solo],['group',group]])if(w&&!w.isDestroyed())fs.writeFileSync(path.join(out,label+'-failure.png'),(await w.webContents.capturePage()).toPNG());}
 finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));app.exit(process.exitCode||0);}
});
