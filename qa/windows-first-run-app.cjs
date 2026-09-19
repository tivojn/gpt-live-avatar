'use strict';
// First run on another platform (written for the Windows port): the real app, an isolated profile, no keys, no live call.
// It does not assert a look; it REPORTS what this platform does, so the port is driven by facts:
// window flags and bounds, whether the window is really transparent, what the GPU is, whether she loads and is painted,
// console errors, and pictures of the app's own windows. Run: electron qa/windows-first-run-app.cjs
const {app,BrowserWindow,screen}=require('electron'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const repo=path.resolve(__dirname,'..'),out=path.join(repo,'build','qa-first-run');fs.rmSync(path.join(out,'profile'),{recursive:true,force:true});fs.mkdirSync(path.join(out,'profile'),{recursive:true});
app.setPath('userData',path.join(out,'profile'));delete process.env.GLA_OPENAI_KEY;
const noFlourish=process.argv.includes('--no-flourish');
fs.writeFileSync(path.join(out,'profile','config.json'),JSON.stringify({wardrobeFlourish:!noFlourish,quality:'balanced',bubbleMode:'always',agentEnabled:false,instinctEnabled:false,conversationSounds:false}));
const report={platform:process.platform,arch:process.arch,os:os.release(),electron:process.versions.electron,chrome:process.versions.chrome,steps:[],errors:[],warnings:[]};
const step=(name,value)=>{report.steps.push({name,at:Date.now()-t0,value});};const t0=Date.now();
process.on('uncaughtException',e=>{report.errors.push('main: '+(e.stack||e.message).slice(0,600));});
report.windowLog=[];
app.on('browser-window-created',(_e,w)=>{const log=why=>{if(report.windowLog.length<40){const b=w.getBounds();report.windowLog.push([Date.now()-t0,why,b.x,b.y,b.width,b.height]);}};setImmediate(()=>log('created'));for(const ev of ['move','resize','show'])w.on(ev,()=>log(ev));
  w.webContents.setBackgroundThrottling(false);w.webContents.on('console-message',d=>{if(d.level==='error')report.errors.push(String(d.message).slice(0,300));else if(d.level==='warning'&&report.warnings.length<12)report.warnings.push(String(d.message).slice(0,200));});
  w.webContents.on('render-process-gone',(_e2,d)=>report.errors.push('renderer gone: '+d.reason));});
try{require(path.join(repo,'electron','main.cjs'));}catch(e){report.errors.push('main.cjs threw on load: '+(e.stack||e.message).slice(0,800));}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label,ms){const end=Date.now()+ms;while(Date.now()<end){try{const r=await fn();if(r)return r;}catch{}await wait(200);}step('TIMED OUT: '+label);return null;}
const finish=()=>{try{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,1));}catch{}app.exit(report.errors.length?1:0);};
setTimeout(()=>{step('hard stop after 150 s');finish();},150000);
app.whenReady().then(async()=>{try{
 // every request of the app's own pages that did not succeed, and how long the slow ones took
 const {session}=require('electron'),bad=[],slow=[];session.defaultSession.webRequest.onCompleted(d=>{const u=d.url.replace(/^https?:\/\/[^/]+/,'');if(d.statusCode>=400&&bad.length<25)bad.push(d.statusCode+' '+u.slice(0,140));});
 session.defaultSession.webRequest.onErrorOccurred(d=>{if(bad.length<25)bad.push(d.error+' '+d.url.replace(/^https?:\/\/[^/]+/,'').slice(0,140));});report.failedRequests=bad;
 step('displays',screen.getAllDisplays().map(d=>({bounds:d.bounds,workArea:d.workArea,scale:d.scaleFactor})));
 try{const g=await app.getGPUInfo('basic');step('gpu',(g.gpuDevice||[]).map(d=>({vendor:d.vendorId,device:d.deviceId,active:d.active,driver:d.driverVersion})));}catch(e){step('gpu info failed',e.message);}
 step('gpu features',app.getGPUFeatureStatus());
 const solo=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/avatar.html')),'avatar window',30000);if(!solo){finish();return;}
 const js=code=>solo.webContents.executeJavaScript('(async()=>{'+code+'})()');
 step('window',{bounds:solo.getBounds(),alwaysOnTop:solo.isAlwaysOnTop(),visible:solo.isVisible(),resizable:solo.isResizable(),focusable:solo.isFocusable(),hasShadow:solo.hasShadow?.(),bg:solo.getBackgroundColor?.()});
 const ready=await until(()=>js(`return Boolean(window.gla_avatar?.options)&&document.querySelector('#status').textContent`),'avatar ready',45000);step('status when ready',ready);
 step('page status',await js("return document.querySelector('#status')?.textContent"));
 step('avatar package',await js("const a=(await gla.getSettings()).avatar||{};return {ok:a.ok,name:a.name,slug:a.slug,problem:a.problem,fallbackFor:a.fallbackFor,clips:a.clips,manifestURL:a.manifestURL,modelURL:a.modelURL,tiers:(await gla.getSettings()).tiers}").catch(e=>'failed: '+e.message));
 step('page events',await js("return (window.gla_debug?gla_debug().events||[]:[]).slice(-14).map(e=>Array.isArray(e)?e.slice(0,3).join(' '):String(e)).map(x=>x.slice(0,160))").catch(e=>'failed: '+e.message));
 step('first overflow',await js('return window.gla_overflow||null'));
 step('geometry',await js("const a=gla_avatar,l=a.layout(),v=a.options?.visiblePoints()||[],j=a.jointBounds(),d=gla_debug();const xs=v.map(p=>p.x),ys=v.map(p=>p.y);return {inner:[innerWidth,innerHeight],outer:[outerWidth,outerHeight],dpr:devicePixelRatio,bounds:l.bounds.map(n=>+n.toFixed(1)),face:(l.faceBounds||[]).map(n=>+n.toFixed(1)),visibleCount:v.length,visibleBox:v.length?[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)].map(n=>+n.toFixed(1)):null,joints:j&&[j.x,j.y,j.width,j.height].map(n=>+n.toFixed(1)),prop:a.options?.selection?.prop||null,companion:d.companionState,settingsWindow:[(await gla.getSettings()).windowWidth,(await gla.getSettings()).windowHeight]}").catch(e=>'failed: '+e.message));
 // a timeline of the first 16 s after she is ready: window bounds, stage, motion, flourish, and a few snapshots
 {const line=[];for(let i=0;i<12;i++){const d=await js("const d=gla_debug(),f=window.gla_flourish?.();return {win:d.window,stage:d.stage&&{scale:d.stage.scale,anchor:d.stage.anchor},motion:d.motionActive||'',flourish:f&&(f.state+':'+f.step+(f.concealed?':concealed':'')),ignoring:d.interaction.ignoring}").catch(()=>null);
   const b=solo.getBounds();line.push([Date.now()-t0,[b.x,b.y,b.width,b.height],d]);if([4,12,24].includes(i))fs.writeFileSync(path.join(out,'t'+i+'.png'),(await solo.webContents.capturePage()).toPNG());await wait(500);}
  report.timeline=line.filter((row,i,a)=>i===0||JSON.stringify(row.slice(1))!==JSON.stringify(a[i-1].slice(1)));}
 step('debug',await js('const d=window.gla_debug?gla_debug():{};return {state:d.state,fps:d.fps,quality:d.quality,renderer:d.renderer,clips:d.clips,avatar:d.avatar}').catch(e=>'gla_debug failed: '+e.message));
 step('webgl',await js(`const c=document.createElement('canvas'),g=c.getContext('webgl2');if(!g)return 'no webgl2';const x=g.getExtension('WEBGL_debug_renderer_info');return {renderer:x?g.getParameter(x.UNMASKED_RENDERER_WEBGL):'?',maxTex:g.getParameter(g.MAX_TEXTURE_SIZE)}`));
 // The 3D layer from inside the page: does the loop advance, and does the canvas hold her right after a frame is drawn?
 // (A window capture can miss a GPU layer on some platforms; this tells "not captured" from "not painted".)
 step('canvas',await js(`const a=window.gla_avatar,c=a?.canvas||document.querySelector('canvas');if(!c)return 'no canvas';const r=c.getBoundingClientRect(),cs=getComputedStyle(c);
  const f0=a.renderer.info.render.frame;await new Promise(r=>setTimeout(r,1000));const f1=a.renderer.info.render.frame;
  const px=await new Promise(res=>requestAnimationFrame(()=>requestAnimationFrame(()=>{const t=document.createElement('canvas');t.width=c.width;t.height=c.height;const g=t.getContext('2d');g.drawImage(c,0,0);const d=g.getImageData(0,0,t.width,t.height).data;let n=0;for(let i=3;i<d.length;i+=16)if(d[i]>200)n++;res(+(n*4/(t.width*t.height)).toFixed(3));})));
  return {buffer:[c.width,c.height],css:[Math.round(r.width),Math.round(r.height)],visibility:cs.visibility,opacity:cs.opacity,display:cs.display,framesPerSecond:f1-f0,opaqueShareInCanvas:px,dpr:devicePixelRatio,hidden:document.hidden,visibilityState:document.visibilityState,calls:a.renderer.info.render.calls,triangles:a.renderer.info.render.triangles}`).catch(e=>'failed: '+e.message));
 // Is the window really see-through, and is she painted? Corners of the capture must be transparent; somewhere in the middle must be opaque.
 const shot=await solo.webContents.capturePage(),size=shot.getSize(),bmp=shot.toBitmap();fs.writeFileSync(path.join(out,'avatar.png'),shot.toPNG());
 const alpha=(x,y)=>bmp[(y*size.width+x)*4+3];let opaque=0,minX=1e9,minY=1e9,maxX=-1,maxY=-1;
 for(let y=0;y<size.height;y+=2)for(let x=0;x<size.width;x+=2)if(alpha(x,y)>200){opaque++;if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;}
 step('capture',{size,cornerAlpha:[alpha(1,1),alpha(size.width-2,1),alpha(1,size.height-2),alpha(size.width-2,size.height-2)],opaqueShare:+(opaque*4/(size.width*size.height)).toFixed(3),painted:opaque?{x:minX,y:minY,w:maxX-minX,h:maxY-minY}:null});
 // the right-click menu builds (it is native: only its template can be checked from here)
 step('menu',await js('try{await gla.showMenu({});return "opened"}catch(e){return "failed: "+e.message}'));await wait(300);
 // Settings opens and lays out
 await js('gla.openSettings?.()').catch(()=>{});const st=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/settings.html')),'settings window',15000);
 if(st){await wait(1500);step('settings',{bounds:st.getBounds(),font:await st.webContents.executeJavaScript("getComputedStyle(document.body).fontFamily+' -> '+(document.fonts?[...document.fonts].length:0)"),panesFit:await st.webContents.executeJavaScript("(()=>{const m=document.querySelector('main');return [m.scrollHeight,m.clientHeight]})()")});
  fs.writeFileSync(path.join(out,'settings.png'),(await st.webContents.capturePage()).toPNG());}
 step('done');
}catch(e){report.errors.push('probe: '+(e.stack||e.message).slice(0,600));}finally{finish();}});
