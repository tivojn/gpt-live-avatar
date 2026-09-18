const {app,BrowserWindow,safeStorage}=require('electron'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const repo=path.resolve(__dirname,'..'),out=repo+'/build/qa-group-controls';fs.mkdirSync(out,{recursive:true});app.setPath('userData',out+'/profile');fs.mkdirSync(app.getPath('userData')+'/avatars',{recursive:true});delete process.env.GLA_OPENAI_KEY;fs.writeFileSync(app.getPath('userData')+'/config.json',JSON.stringify({avatar:'tia',quality:'balanced'}));for(const slug of ['tia','sarah','iselda','ming-mei','seraphim']){const link=app.getPath('userData')+'/avatars/'+slug;if(!fs.existsSync(link))fs.symlinkSync(repo+'/build/characters/'+slug,link);}app.whenReady().then(()=>fs.writeFileSync(app.getPath('userData')+'/openai-key.bin',safeStorage.encryptString('sk-local-qa-placeholder')));
const errors=[];app.on('browser-window-created',(_e,w)=>w.webContents.on('console-message',d=>{if(d.level==='error')errors.push(d.message);}));require('../electron/main.cjs');const wait=ms=>new Promise(r=>setTimeout(r,ms));async function until(fn,label){const end=Date.now()+90000;while(Date.now()<end){try{const x=await fn();if(x)return x;}catch{}await wait(80);}throw Error('Timeout '+label);}
app.whenReady().then(async()=>{try{const primary=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/avatar.html')),'primary');await until(()=>primary.webContents.executeJavaScript('Boolean(gla_avatar?.model)'),'ready');await primary.webContents.executeJavaScript('gla.group.open()');const win=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/group.html')),'group'),js=s=>win.webContents.executeJavaScript('(async()=>{'+s+'})()');await until(()=>js('return window.gla_group&&!gla_group.state.loading'),'group ready');await js(`localStorage.removeItem('gla-together-panel-v1');const p=document.querySelector('.panel');p.classList.remove('minimized');Object.assign(p.style,{left:'400px',top:'16px',width:'610px',height:'auto'});document.querySelector('#minimize').textContent='Minimize';`);

 assert.equal(await primary.webContents.executeJavaScript('!!gla_avatar'),false,'Hidden solo renderer is released');
 await js(`gla_group.liveGroup.start=async function(config){this.running=true;this.cast=config.cast;this.sample=()=>({rms:.035,relative:.5});this.emit('floor',{speaker:'tia',listener:'sarah'});};await gla_group.start();`);

 // Move and resize only the controls, then minimize them without stopping live talk.
 const panelRect=()=>js(`const r=document.querySelector('.panel').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};`);
 const panelBefore=await panelRect(),actorBefore=await js(`return [...gla_group.actors.values()].map(a=>[a.x,a.y,a.w,a.h]);`);
 const grip={x:Math.round(panelBefore.x+35),y:Math.round(panelBefore.y+28)};
 win.webContents.sendInputEvent({type:'mouseDown',...grip,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseMove',x:grip.x-80,y:grip.y+65,button:'left'});win.webContents.sendInputEvent({type:'mouseUp',x:grip.x-80,y:grip.y+65,button:'left',clickCount:1});await wait(100);
 const panelMoved=await panelRect();assert(panelMoved.x<panelBefore.x-40&&panelMoved.y>panelBefore.y+40,'The Together header drags the panel');
 const resizePoint=await js(`const r=document.querySelector('.panel-resize').getBoundingClientRect();return {x:Math.round(r.right-3),y:Math.round(r.bottom-3)};`);
 win.webContents.sendInputEvent({type:'mouseDown',...resizePoint,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseMove',x:resizePoint.x+90,y:resizePoint.y+80,button:'left'});win.webContents.sendInputEvent({type:'mouseUp',x:resizePoint.x+90,y:resizePoint.y+80,button:'left',clickCount:1});await wait(100);
 const panelSized=await panelRect();assert(panelSized.w>panelMoved.w+50&&panelSized.h>panelMoved.h+40,'Corner grip resizes the panel');
 await js(`document.querySelector('#minimize').click();`);const minimized=await panelRect();assert(minimized.h<90&&minimized.h<panelSized.h,'Minimize leaves only the title bar');assert(await js('return gla_group.liveGroup.running'),'Minimizing keeps live talk connected');
 await js(`document.querySelector('#minimize').click();`);const restored=await panelRect();assert.equal(restored.w,panelSized.w);assert.equal(restored.h,panelSized.h);assert.deepEqual(await js(`return [...gla_group.actors.values()].map(a=>[a.x,a.y,a.w,a.h]);`),actorBefore,'Panel manipulation never moves characters');
 const voices=await js(`return [...document.querySelectorAll('[data-voice]')].map(v=>({slug:v.dataset.voice,voice:v.value}));`);assert(voices.every(v=>['marin','quartz','gleam','willow','bossa','delta'].includes(v.voice)),'All five defaults have feminine presentation');
 await js(`document.querySelector('#minimize').click();`);

 const point=await js(`const a=gla_group.actors.get('tia'),m=a.hitMask.pixels;for(let y=Math.floor(m.height*.4);y<m.height*.8;y++)for(let x=0;x<m.width;x++)if(m.data[(y*m.width+x)*4+3]>200){const p={x:Math.round(a.x+(x+.5)*a.w/m.width),y:Math.round(a.y+(y+.5)*a.h/m.height)};if(gla_group.actorAt({clientX:p.x,clientY:p.y})===a.el)return p;}throw Error('No Tia silhouette');`);
 const snapshot=()=>js(`return [...gla_group.actors.values()].map(a=>({slug:a.slug,x:a.x,y:a.y,w:a.w,h:a.h,yaw:a.yaw,orbit:a.userOrbit,selection:a.avatar.options.selection}));`);
 const initial=await snapshot();
 win.webContents.sendInputEvent({type:'mouseMove',...point});win.webContents.sendInputEvent({type:'mouseWheel',...point,deltaX:60,deltaY:0});await wait(500);
 const rotated=await snapshot();assert(Math.abs(rotated[0].yaw-initial[0].yaw)>.2,'Two-finger swipe rotates Tia');assert.equal(rotated[0].w,initial[0].w);assert.deepEqual(rotated[1].selection,initial[1].selection);assert.equal(rotated[1].w,initial[1].w);
 // Pinching remains attached to the same actor through the full gesture even
 // when changing the silhouette moves transparent pixels under the cursor.
 const pinchPoint=await until(()=>js(`const a=gla_group.actors.get('tia'),m=a.hitMask.pixels;for(let y=Math.floor(m.height*.4);y<m.height*.7;y++)for(let x=0;x<m.width;x++)if(m.data[(y*m.width+x)*4+3]>200)return {x:Math.round(a.x+(x+.5)*a.w/m.width),y:Math.round(a.y+(y+.5)*a.h/m.height)};`),'pinch silhouette');
 win.webContents.sendInputEvent({type:'mouseWheel',...pinchPoint,deltaX:0,deltaY:30,modifiers:['control']});await wait(500);
 const resized=await snapshot();assert.notEqual(resized[0].w,rotated[0].w,'Pinch resizes selected actor');assert.equal(resized[1].w,rotated[1].w);assert.equal(resized[0].orbit.yaw,rotated[0].orbit.yaw,'Pinch does not rotate');
 const target=await until(()=>js(`const a=gla_group.actors.get('tia'),m=a.hitMask.pixels;for(let y=Math.floor(m.height*.5);y<m.height*.8;y++)for(let x=0;x<m.width;x++)if(m.data[(y*m.width+x)*4+3]>200)return {x:Math.round(a.x+(x+.5)*a.w/m.width),y:Math.round(a.y+(y+.5)*a.h/m.height)};`),'drag silhouette');
 win.webContents.sendInputEvent({type:'mouseDown',...target,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseMove',x:target.x+45,y:target.y,button:'left'});win.webContents.sendInputEvent({type:'mouseUp',x:target.x+45,y:target.y,button:'left',clickCount:1});await wait(250);
 const moved=await snapshot();assert(moved[0].x>resized[0].x+20,'Drag follows the hand to the right');assert.equal(moved[1].x,resized[1].x);
 const sarahBefore=JSON.stringify(moved[1].selection);
 await js(`const a=gla_group.actors.get('tia');window.propID=a.avatar.options.props[0].id;await gla_group.actorMenuAction({slug:'tia',action:'prop:'+propID});`);await wait(1200);
 assert.equal(await js('return gla_group.actors.get("tia").avatar.options.selection.prop'),await js('return propID'));assert.equal(JSON.stringify((await snapshot())[1].selection),sarahBefore,'Menu affects only the selected avatar');
 assert(await js('return gla_group.state.running&&gla_group.liveGroup.running'),'Manipulation must not stop live talk');
 assert(await js('return gla_group.actorCatalogue(gla_group.actors.get("tia")).assets.some(a=>a.kind==="texture")'),'Original colors are present');
 await js(`await gla_group.actorMenuAction({slug:'tia',action:'bubble:always'});`);await wait(100);
 assert.equal(await js(`return gla_group.actors.get('tia').bubbleText.textContent`),'Speaking…');
 await js(`gla_group.liveGroup.emit('floor',{speaker:'sarah',listener:'tia'});`);await wait(100);
 assert.equal(await js(`return gla_group.actors.get('tia').bubbleText.textContent`),'Listening');
 await js(`await gla_group.actorMenuAction({slug:'tia',action:'bubble:off'});`);await wait(100);
 assert.equal(await js(`return gla_group.actors.get('tia').bubble.hidden`),true);
 await js(`await gla_group.actorMenuAction({slug:'tia',action:'bubble:auto'});`);await wait(100);
 assert.equal(await js(`return gla_group.actors.get('tia').bubbleText.textContent`),'');
 await js(`await gla.setSettings({quality:'friendly'});`);
 await until(()=>js(`return [...gla_group.actors.values()].every(a=>a.avatar.options.selection.performance==='eco'&&a.avatar.appearance.portrait.fastPortraitLights?.visible)`),'live quality change');
 assert(await js('return gla_group.state.running&&gla_group.liveGroup.running'),'Changing rendering quality keeps the live session');
 await js(`await gla.setSettings({quality:'balanced'});`);
 await until(()=>js(`return [...gla_group.actors.values()].every(a=>a.avatar.options.selection.performance==='balanced'&&!a.avatar.appearance.portrait.fastPortraitLights?.visible)`),'studio lighting restored');
 const framing=await js(`const a=gla_group.actors.get('tia').avatar;const samples=[];for(let n=0;n<60;n++){a.render(performance.now()+n*34,{projectedHeight:gla_group.actors.get('tia').h,reduce:true,bodyMotion:false,fitContent:true,stableFitContent:true,viseme:n%2?'aa':'sil',speaking:!!(n%2),cameraFocus:true,audienceContact:true});if(n>40)samples.push([a.camera.view.offsetX,a.camera.view.offsetY,a.camera.view.width,a.camera.view.height]);}return samples;`);for(const sample of framing)assert(sample.every((v,i)=>Math.abs(v-framing[0][i])<.01),'Speech does not change the body framing');
 await js(`document.querySelector('#minimize').click();for(const a of gla_group.actors.values())await a.avatar.resources.pending;`);await wait(1000);
 fs.writeFileSync(out+'/live-manipulation.png',(await win.webContents.capturePage()).toPNG());
 await js(`await gla_group.actorMenuAction({slug:'tia',action:'face-audience'});await gla_group.actorMenuAction({slug:'tia',action:'recover'});gla_group.stop();await gla.group.close();`);
 await until(()=>primary.webContents.executeJavaScript('Boolean(gla_avatar?.resources?.ready)'),'solo returns');
 assert.deepEqual(errors,[]);fs.writeFileSync(out+'/report.json',JSON.stringify({passed:true,rotation:true,pinch:true,dragRight:true,isolatedMenu:true,liveContinues:true,soloSuspendsAndReturns:true,initial,rotated,resized,moved,errors},null,2));console.log('Independent live controls and solo memory suspension/resume passed');
 }catch(e){console.error(e);console.error(errors);const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/group.html'));if(w){fs.writeFileSync(out+'/failure.png',(await w.webContents.capturePage()).toPNG());console.log(await w.webContents.executeJavaScript('JSON.stringify([...gla_group.actors.values()].map(a=>({slug:a.slug,w:a.w,h:a.h,camera:a.avatar.camera.view,fit:a.avatar.stableContentView})))'));}process.exitCode=1;}finally{app.exit(process.exitCode||0);}});
