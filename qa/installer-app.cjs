'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process'),assert=require('assert/strict'),crypto=require('crypto');
const repo=path.resolve(__dirname,'..'),out=process.env.GLA_QA_OUTPUT||repo+'/build/qa-installer';fs.mkdirSync(out,{recursive:true});
const bundle=process.argv[2]||repo+'/dist/mac-arm64/GPT-Live Avatar.app',upgrade=process.argv.includes('--upgrade'),port=19453;
const profile=out+(upgrade?'/upgrade-profile':'/fresh-profile');fs.mkdirSync(profile,{recursive:true});
fs.writeFileSync(profile+'/config.json',JSON.stringify(upgrade?{avatar:'sarah',voice:'gleam',bubbleMode:'always',quality:'friendly',conversationSounds:false,avatarLooks:{sarah:{outfit:'tactical',body:'Ps007.stand',prop:''}}}:{quality:'friendly',bubbleMode:'always',conversationSounds:false}));
if(upgrade){
 const previous=process.env.GLA_QA_PREVIOUS_APP||'/Applications/GPT-Live Avatar.app';
 const resources=previous+'/Contents/Resources';
 fs.mkdirSync(profile+'/avatars/sarah',{recursive:true});
 fs.copyFileSync(resources+'/assets-index.json',profile+'/avatars/index.json');
 for(const name of ['base','motions'])fs.copyFileSync(resources+'/avatars/sarah/'+name+'.gla',profile+'/avatars/sarah/'+name+'.gla');
}
const wait=ms=>new Promise(r=>setTimeout(r,ms));async function until(fn,label){let last;const end=Date.now()+240000;while(Date.now()<end){try{const v=await fn();if(v)return v;}catch(e){last=e;}await wait(200);}throw Error('Timed out '+label+' '+(last?.message||''));}
let child,ws;
(async()=>{try{
 const env={...process.env};delete env.GLA_OPENAI_KEY;delete env.ELECTRON_RUN_AS_NODE;
 child=cp.spawn(bundle+'/Contents/MacOS/GPT-Live Avatar',['--user-data-dir='+profile,'--remote-debugging-port='+port,'--remote-debugging-address=127.0.0.1'],{env,stdio:['ignore','ignore',fs.openSync(out+'/app.log','a')]});
 const tab=await until(async()=>{const r=await fetch('http://127.0.0.1:'+port+'/json/list');return(await r.json()).find(t=>t.url.endsWith('/avatar.html'));},'packaged window');
 ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((r,e)=>{ws.onopen=r;ws.onerror=e;});let seq=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(!m.id)return;const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);};
 const send=(method,params)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
 const js=async code=>{const r=await send('Runtime.evaluate',{expression:'(async()=>{'+code+'})()',returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description);return r.result.value;};
 await until(()=>js("return window.gla_avatar?.resources?.ready&&gla_avatar.characterId==='sarah'&&gla_avatar.motion?.clips.size"),'Sarah');
 const info=await js("const s=await gla.getSettings();return {slug:s.avatar.slug,revision:s.avatar.manifest.assetRevision,roots:s.avatar.roots,modelURL:s.avatar.modelURL,motions:gla_avatar.motion.clips.size,hasKey:s.hasKey,outfit:gla_avatar.options.selection.outfit,voice:s.voice,input:!document.querySelector('#steerRow').hidden,tap:await gla.tap.available()};");
 assert.equal(info.revision,'sarah-wardrobe-v10');assert.equal(info.hasKey,false);assert.equal(info.input,true);assert.equal(info.tap,true);assert.equal(info.outfit,upgrade?'tactical':'casual');
 assert(fs.existsSync(profile+'/avatars/content-keys.bin'),'Fresh key authorization');
 const model=await js("return await (await fetch((await gla.getSettings()).avatar.modelURL)).json();");
 assert.equal(model.extras.avatarSarahPelvisWeights.version,1);
 const fingerprints=JSON.parse(fs.readFileSync(repo+'/qa/pelvis-payload.json')).payload.buffers;
 for(const name of ['pelvis-weight-restoration-v1.bin','pelvis-dress-weight-restoration-v1.bin']){
 const got=await js("const url=new URL("+JSON.stringify(name)+",new URL((await gla.getSettings()).avatar.modelURL,location.href));const data=await(await fetch(url)).arrayBuffer();return [...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(x=>x.toString(16).padStart(2,'0')).join('');");assert.equal(got,fingerprints[name]);}
 assert.equal((await fetch(new URL(info.modelURL,tab.url))).status,403);
 await js("await gla_avatar.motion.play('kung-fu-punch',{loop:false});");await wait(1000);assert.equal(await js("return document.querySelector('#bubble').classList.contains('hidden')"),true);
 await js('gla_avatar.motion.stop();');await wait(500);assert.equal(await js("return !document.querySelector('#steerRow').hidden"),true);
 const png=(await send('Page.captureScreenshot',{format:'png'})).data;fs.writeFileSync(out+(upgrade?'/upgrade.png':'/fresh.png'),Buffer.from(png,'base64'));
 if(!upgrade){const result=await js("return await gla.assets.download('tia','base');");assert(result.ok,result.error);await js("await gla.selectAvatar('tia');");await until(()=>js("return gla_avatar?.resources?.ready&&gla_avatar.characterId==='tia'"),'downloaded Tia');console.log('Fresh package: Sarah unlock and pelvis fingerprints; live Tia base/motion download passed.');}
 else console.log('Existing encrypted profile: new bundled Sarah wins, old textures isolated, tactical outfit preserved.');
 fs.writeFileSync(out+(upgrade?'/upgrade-report.json':'/fresh-report.json'),JSON.stringify({passed:true,bundle,info,pelvisBuffersVerified:true,externalModelBlocked:true},null,2));
 await js('gla.quit();');
 }finally{ws?.close();child?.kill();}})().catch(e=>{console.error(e);process.exitCode=1;});
