'use strict';
// Windows: does the PACKAGED app come up? Plain Node, no Electron needed:
//   node qa/windows-packaged-check.cjs ["path\to\GPT-Live Avatar.exe"]
// Starts the built app (dist/win-unpacked by default) with a throwaway profile and a local DevTools port,
// and asks its own pages: did the bundled avatar unlock and load, is she drawn, do Settings open, did
// anything fail to load. No keys, no live call, nothing spent. It stops only the process it started.
const {spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),exe=process.argv[2]||path.join(root,'dist','win-unpacked','GPT-Live Avatar.exe');
const out=path.join(root,'build','qa-packaged'),profile=path.join(out,'profile'),port=9300+Math.floor(Math.random()*400);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check,ms){const end=Date.now()+ms;while(Date.now()<end){try{const v=await check();if(v)return v;}catch{}await wait(400);}return null;}
function page(target){
 const socket=new WebSocket(target.webSocketDebuggerUrl),pending=new Map();let id=0;
 socket.onmessage=event=>{const m=JSON.parse(event.data);const p=pending.get(m.id);if(p){pending.delete(m.id);p(m);}};
 const open=new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=()=>reject(Error('DevTools socket failed'));});
 return {async evaluate(expression){await open;const n=++id;const reply=await new Promise(resolve=>{pending.set(n,resolve);socket.send(JSON.stringify({id:n,method:'Runtime.evaluate',params:{expression:'(async()=>{'+expression+'})()',awaitPromise:true,returnByValue:true}}));});
   if(reply.result?.exceptionDetails)throw Error(reply.result.exceptionDetails.exception?.description||'evaluation failed');return reply.result?.result?.value;},close(){try{socket.close();}catch{}}};
}
(async()=>{
 if(!fs.existsSync(exe)){console.error('Not built: '+exe+'\nRun: npm run pack:win');process.exit(2);}
 fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(profile,{recursive:true});
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.GLA_OPENAI_KEY;
 const child=spawn(exe,['--user-data-dir='+profile,'--remote-debugging-port='+port],{env,stdio:'ignore',windowsHide:false});
 const report={exe:path.relative(root,exe),checks:{}},fail=[];let exited=null;child.on('exit',code=>{exited=code;});
 const check=(name,ok,detail)=>{report.checks[name]={ok:Boolean(ok),detail};if(!ok)fail.push(name);console.log((ok?'ok   ':'FAIL ')+name+(detail!==undefined?'  '+JSON.stringify(detail).slice(0,300):''));};
 try{
  const targets=()=>fetch('http://127.0.0.1:'+port+'/json').then(r=>r.json());
  const solo=await until(async()=>(await targets()).find(t=>t.type==='page'&&/\/avatar\.html/.test(t.url)),40000);
  check('avatar window exists',solo,exited===null?undefined:'the app exited with '+exited);if(!solo)return;
  const avatar=page(solo);
  const ready=await until(()=>avatar.evaluate("return Boolean(window.gla_avatar?.options)&&(document.querySelector('#status')?.textContent||'ready')"),90000);
  check('bundled avatar unlocked and loaded',ready,ready);
  const info=await avatar.evaluate("const s=await gla.getSettings(),a=s.avatar||{};return {ok:a.ok,name:a.name,problem:a.problem,clips:a.clips,bundled:s.tiers?.bundled,locked:s.tiers?.locked}").catch(e=>({error:e.message}));
  check('avatar package',info.ok===true&&!info.problem,info);
  await wait(3000);
  const drawn=await avatar.evaluate(`const a=window.gla_avatar,c=a?.canvas;if(!c)return {error:'no canvas'};const f0=a.renderer.info.render.frame;await new Promise(r=>setTimeout(r,1000));const f1=a.renderer.info.render.frame;
   const share=await new Promise(res=>requestAnimationFrame(()=>requestAnimationFrame(()=>{const t=document.createElement('canvas');t.width=c.width;t.height=c.height;const g=t.getContext('2d');g.drawImage(c,0,0);const d=g.getImageData(0,0,t.width,t.height).data;let n=0;for(let i=3;i<d.length;i+=16)if(d[i]>200)n++;res(+(n*4/(t.width*t.height)).toFixed(3));})));
   const x=a.renderer.getContext().getExtension('WEBGL_debug_renderer_info');return {framesPerSecond:f1-f0,opaqueShare:share,gpu:x?a.renderer.getContext().getParameter(x.UNMASKED_RENDERER_WEBGL):'?',window:[innerWidth,innerHeight],dpr:devicePixelRatio}`).catch(e=>({error:e.message}));
  check('she is drawn and the loop runs',drawn.framesPerSecond>5&&drawn.opaqueShare>.02,drawn);
  const failed=await avatar.evaluate("return performance.getEntriesByType('resource').filter(e=>e.responseStatus>=400).map(e=>e.responseStatus+' '+new URL(e.name).pathname).slice(0,12)").catch(()=>[]);
  check('no failed requests',failed.length===0,failed);
  await avatar.evaluate('gla.openSettings?.()').catch(()=>{});
  const st=await until(async()=>(await targets()).find(t=>t.type==='page'&&/\/settings\.html/.test(t.url)),15000);
  check('Settings opens',st);
  if(st){const settings=page(st);await wait(1500);const panes=await settings.evaluate("const m=document.querySelector('main');return {fits:m.scrollHeight<=m.clientHeight+1,panes:document.querySelectorAll('nav [data-pane],aside [data-pane]').length,font:getComputedStyle(document.body).fontFamily.slice(0,60)}").catch(e=>({error:e.message}));check('Settings lays out',!panes.error,panes);settings.close();}
  avatar.close();
 }catch(error){check('check ran',false,String(error.message).slice(0,300));}
 finally{
  if(exited===null){try{process.kill(child.pid);}catch{}}
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,1));
  console.log(fail.length?'\nPackaged app: '+fail.length+' check(s) failed.':'\nPackaged app starts, unlocks the bundled avatar, draws her and opens Settings.');
  process.exit(fail.length?1:0);
 }
})();
