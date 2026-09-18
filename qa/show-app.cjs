// Real desktop Avatar Show with a deterministic Playwright/Director substitute
// and silent voices. Exercises the full loop: brief the Director by text, the
// cue writes and prepares the show, the characters perform with theatre
// motions, the human reads from the prompter and passes a line to the
// standby, then the show is revised and replayed. Run: npx electron qa/show-app.cjs
const {app,BrowserWindow,safeStorage}=require('electron'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
// Real native click-through state: the prompter's buttons must receive real clicks.
const ignoreState=new Map(),ignored=BrowserWindow.prototype.setIgnoreMouseEvents;BrowserWindow.prototype.setIgnoreMouseEvents=function(value,...args){ignoreState.set(this.id,Boolean(value));return ignored.call(this,value,...args);};
const repo=path.resolve(__dirname,'..'),out=path.join(repo,'build/qa-show');fs.mkdirSync(out,{recursive:true});app.setPath('userData',out+'/profile');app.setPath('videos',out+'/movies');fs.rmSync(out+'/movies',{recursive:true,force:true});fs.mkdirSync(app.getPath('userData'),{recursive:true});delete process.env.GLA_OPENAI_KEY;process.env.GLA_SHOW_MOTION_CONFIG=out+'/no-show-motion.json';
fs.writeFileSync(app.getPath('userData')+'/config.json',JSON.stringify({avatar:'tia',quality:'balanced'}));fs.mkdirSync(app.getPath('userData')+'/avatars',{recursive:true});for(const slug of ['tia','sarah','iselda','ming-mei','seraphim']){const link=app.getPath('userData')+'/avatars/'+slug;if(!fs.existsSync(link))fs.symlinkSync(repo+'/build/characters/'+slug,link);}
app.whenReady().then(()=>fs.writeFileSync(app.getPath('userData')+'/openai-key.bin',safeStorage.encryptString('sk-local-qa-placeholder')));
const replies=[],errors=[];
const script=(title,userLine)=>({title,synopsis:'The royal crown vanishes minutes before the coronation.',cast:[{slug:'tia',role:'Queen Amara'}],userRole:{role:'Pip the Jester'},
 wantedMotions:[{id:'juggle-torches',label:'Juggle',prompt:'a jester juggles three invisible balls with quick hands',duration:4,fallback:'madness-drift',expression:{smile:.8}}],
 scenes:[{title:'The throne room',setting:'Morning light.',lines:[
  {speaker:'tia',text:'Where is my crown? The coronation starts at noon!',motion:'accuse-point',expression:{anger:.7}},
  {speaker:'user',text:userLine},
  {speaker:'tia',text:'Under the cushion, of course. Bring it here at once.',motion:'juggle-torches',expression:{smile:.5}},
  {speaker:'user',text:'At once, Majesty. Unless the cat has claimed it.'},
  {speaker:'tia',text:'Then we crown the cat and call it a day.',motion:'bow-courtly',expression:{smile:.9}}]}]});
require('../electron/delegate.cjs').DelegateBackend.prototype.answer=async(owner,id,config,history,instructions,options={})=>{
 replies.push({id,history,instructions,options,persona:config.personaName});
 if(config.personaName==='Playwright'){const revised=/Previous script \(JSON\)/.test(history[0].text);return {text:'```json\n'+JSON.stringify(script(revised?'The Lost Crown, Revised':'The Lost Crown',revised?'Perhaps the cat took it, Majesty.':'Perhaps under the cushion, Majesty.'))+'\n```',provider:'qa',model:'qa'};}
 const last=history[history.length-1]?.text||'';
 return {text:/ready|start|go ahead|places/i.test(last)?'A comedy about a lost crown with you as the jester. Places, everyone!':'Lovely idea. Should the show be a comedy, and would you like to play a role?',provider:'qa',model:'qa'};
};
// Live voice sessions (steering notes) are simulated at the network edge; the app's own IPC and session code run for real.
const steerSessions=[],actualFetch=global.fetch;global.fetch=async(url,options={})=>{const address=String(url);if(!address.startsWith('https://api.openai.com/'))return actualFetch(url,options);const body=options.body?JSON.parse(options.body):null;
 if(address.endsWith('/live/sessions')){steerSessions.push(body);return new Response(JSON.stringify({id:'test-live-'+steerSessions.length,transport:{type:'webrtc',sdp:'test-answer'}}),{headers:{'Content-Type':'application/json'}});}
 return new Response(JSON.stringify({data:[]}),{headers:{'Content-Type':'application/json'}});};
app.on('browser-window-created',(_e,w)=>w.webContents.on('console-message',d=>{if(d.level==='error')errors.push(d.message);}));require('../electron/main.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));async function until(fn,label,limit=120000){const end=Date.now()+limit;while(Date.now()<end){try{const value=await fn();if(value)return value;}catch{}await wait(80);}throw Error('Timeout '+label);}
app.whenReady().then(async()=>{try{
 const primary=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/avatar.html')),'primary');await until(()=>primary.webContents.executeJavaScript('Boolean(window.gla_avatar?.model)'),'primary ready');await primary.webContents.executeJavaScript('gla.group.open()');
 const win=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/group.html')),'group'),js=s=>win.webContents.executeJavaScript('(async()=>{'+s+'})()');
 await until(()=>js('return window.gla_group&&!gla_group.state.loading&&gla_group.actors.size===2&&Boolean(gla_group.show)'),'loaded');
 assert.match(win.getTitle(),/Avatar Show/);assert.equal(await js("return document.querySelector('#join').checked"),false,'act-a-role is off by default');
 assert.equal(await js("return Boolean(document.querySelector('.panel header .light.close')&&document.querySelector('.panel header .light.minimize')&&document.querySelector('.panel .panel-resize'))"),true,'the panel is the window: traffic lights and a resize corner');
 // The panel remembers where it was put and how big it is.
 await js("const p=document.querySelector('.panel');p.style.left='120px';p.style.top='90px';p.style.width='500px';const h=p.querySelector('header strong');h.dispatchEvent(new PointerEvent('pointerdown',{button:0,pointerId:1,clientX:130,clientY:100,bubbles:true}));h.dispatchEvent(new PointerEvent('pointerup',{pointerId:1,bubbles:true}));");
 const remembered=JSON.parse(await js("return localStorage.getItem('gla-together-panel-v1')"));assert.equal(Math.round(remembered.x),120);assert.equal(Math.round(remembered.w),500);
 // Folding and unfolding: the yellow light folds; a visible + Expand button, the light, or a click on the header unfolds.
 await js("document.querySelector('#minimize').click();");const folded=await js("return {min:document.querySelector('.panel').classList.contains('minimized'),glyph:getComputedStyle(document.querySelector('#minimize'),'::after').content,hit:(()=>{const r=document.querySelector('#minimize').getBoundingClientRect();return r.width>=24&&document.elementFromPoint(r.left+3,r.top+r.height/2)?.id||'none';})()}");
 assert.equal(folded.min&&/\+/.test(folded.glyph),true,'folded: the yellow light shows a plus: '+JSON.stringify(folded));assert.equal(folded.hit,'minimize','the light has a generous hit area: '+JSON.stringify(folded));
 await js("document.querySelector('#minimize').click();");assert.equal(await js("return document.querySelector('.panel').classList.contains('minimized')"),false,'unfolded from the light');
 await js("document.querySelector('#minimize').click();document.querySelector('.panel header strong').click();");assert.equal(await js("return document.querySelector('.panel').classList.contains('minimized')"),false,'unfolded from a header click');
 assert.equal(await js("return document.querySelector('#format').value"),'show');assert.equal(await js("return getComputedStyle(document.querySelector('#show')).display!=='none'&&getComputedStyle(document.querySelector('#start')).display==='none'"),true,'show panel replaces the improv controls');
 await js(`window.spoken=[];window.voiceDelay=150;gla_group.voice.speak=async(text,voice,onText,delivery,context)=>{window.spoken.push({text,voice,note:context?.note||''});onText(text);await new Promise(r=>setTimeout(r,window.voiceDelay));return text;};document.querySelector('#humanName').value='Adam';document.querySelector('#join').checked=true;document.querySelector('#join').onchange();document.querySelector('#showRecord').checked=true;`);
 assert.deepEqual([...await js('return [...gla_group.actors.keys()]')].sort(),['sarah','tia']);
 // Brief the Director by text; the cue phrase starts the whole preparation.
 await js("document.querySelector('#showText').value='A comedy about a lost crown. I will play the jester.';document.querySelector('#showSend').click();");
 await until(()=>js('return gla_group.show.chat.length===2'),'director reply');assert.equal(replies[0].persona,'Director');assert(replies[0].instructions.includes('Adam wants to act one role'),replies[0].instructions);assert(replies[0].instructions.includes('Sarah is the standby'));
 assert.equal((await js('return gla_group.show.chat'))[1].text,'Lovely idea. Should the show be a comedy, and would you like to play a role?');
 fs.writeFileSync(out+'/planning.png',(await win.webContents.capturePage()).toPNG());
 await js("document.querySelector('#showText').value='Yes, a comedy. I am ready.';document.querySelector('#showSend').click();");
 await until(()=>js("return gla_group.show.phase==='ready'"),'prepared');
 const chat=await js('return gla_group.show.chat');assert.equal(chat[3].text,'A comedy about a lost crown with you as the jester.','cue phrase is stripped from the caption');
 const playwright=replies.find(r=>r.persona==='Playwright');assert(playwright.options.long,'the Playwright uses the long reasoning path');assert(playwright.history[0].text.includes('accuse-point — Accuse [Theatre]'));assert(playwright.history[0].text.includes('Director: Lovely idea'));
 const shown=await js('return gla_group.show.script');assert.equal(shown.title,'The Lost Crown');assert.deepEqual(shown.userRole,{name:'Adam',role:'Pip the Jester',understudy:'sarah',understudyName:'Sarah'});assert.equal(shown.wantedMotions.length,1);
 assert.match(await js("return document.querySelector('#showStatus').textContent"),/Starting in 8 seconds/);
 assert(await js("return document.querySelector('.actor.standby .name')?.textContent")==='Sarah','the standby is marked on stage');
 assert.match(await js("return document.querySelector('#showScriptBody').textContent"),/Pip the Jester \(Adam\): Perhaps under the cushion, Majesty\./);
 fs.writeFileSync(out+'/ready.png',(await win.webContents.capturePage()).toPNG());
 // Performance: the queen speaks with a theatre motion, then the prompter waits for Adam.
 await until(()=>js("return gla_group.show.phase==='performing'"),'curtain up',20000);
 await until(()=>js("return !document.querySelector('#prompter').hidden"),'prompter');
 assert.equal(await js("return document.querySelector('#prompterText').textContent"),'Perhaps under the cushion, Majesty.');assert.match(await js("return document.querySelector('#prompterRole').textContent"),/Pip the Jester/);
 assert.equal((await js('return gla_group.state')).speaker,'_human');assert.equal(await js('return window.spoken.length'),1);assert.equal(await js('return window.spoken[0].voice'),await js("return document.querySelector('[data-voice=tia]').value"));
 assert.equal(await js("return gla_group.actors.get('tia').avatar.motion.active?.id||''"),'accuse-point','the theatre motion plays with the line');
 fs.writeFileSync(out+'/prompter.png',(await win.webContents.capturePage()).toPNG());
 // A private note to one character through her own composer: the show is not interrupted, only her later lines carry it.
 await js("const t=gla_group.actors.get('tia');t.askInput.value='Be furious about it';t.askInput.form.requestSubmit();");
 assert.deepEqual(await js("return gla_group.show.castNotes"),{tia:['Be furious about it']});assert.equal(await js('return gla_group.show.phase'),'performing','the show goes on');assert.equal((await js('return gla_group.state')).running,true);
 assert.match(await js("return gla_group.actors.get('tia').askTip.textContent"),/Steer Tia: press the mic or type a private note/,'the bubble tells the user how to steer');
 // A voice note goes through a live session in her own voice: she listens in real time, acknowledges in one sentence, the note lands, the show resumes.
 await js(`Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>new MediaStream()});
  window.RTCPeerConnection=class extends EventTarget {constructor(){super();this.iceGatheringState='complete';this.connectionState='new'}addTrack(){}createDataChannel(){const c=new EventTarget();c.readyState='open';c.sent=[];c.send=raw=>c.sent.push(JSON.parse(raw));c.close=()=>{};return this.channel=c}async createOffer(){return {sdp:'test-offer',type:'offer'}}async setLocalDescription(d){this.localDescription=d}async setRemoteDescription(){setTimeout(()=>this.channel.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({type:'session.started'})})),10)}close(){}};
  void gla_group.show.steerVoice('sarah');`);
 let steerDiag=null;try{await until(async()=>{steerDiag=await js("return {state:gla_group.show.steering?.state||null,held:gla_group.show.held,status:document.querySelector('#showStatus').textContent,running:gla_group.show.steering?.session?.running,client:Boolean(gla_group.show.steering?.session?.client),live:gla_group.show.steering?.session?.client?.state}");return steerDiag.state==='listening';},'she is listening live',15000);}catch(e){console.error('steer diagnostics',JSON.stringify(steerDiag));throw e;}assert.equal(await js('return gla_group.show.held'),true,'the show holds while the note is given');
 const steerSession=JSON.stringify(steerSessions.at(-1));assert(steerSession.includes('"voice":"'+await js("return document.querySelector('[data-voice=sarah]').value")+'"'),'her own voice: '+steerSession.slice(0,200));assert.match(steerSession,/You are Sarah/,'her own name in the session instructions');
 assert.match(await js("return gla_group.actors.get('sarah').askTip.textContent"),/Sarah is listening live/);
 await js("gla_group.show.steering.session.client._onEvent(JSON.stringify({type:'session.input_transcript.delta',start_ms:0,end_ms:400,delta:'Say your lines in Cantonese from now on'}));");
 await until(()=>js("return gla_group.show.steering?.state==='listening'&&gla_group.actors.get('sarah').message.includes('Cantonese')"),'live partial shows in her bubble');
 await js("document.querySelector('.actor[data-slug=sarah] .actor-ask-form').requestSubmit();");
 await until(()=>js("return gla_group.show.steering?.state==='taking'"),'Done asks her to acknowledge');assert.match(await js("return document.querySelector('#showStatus').textContent"),/taking your note/);
 await js("const c=gla_group.show.steering.session.client;c._onEvent(JSON.stringify({type:'session.output_transcript.delta',start_ms:2000,end_ms:2400,delta:'Got it, Cantonese it is.'}));");
 await until(()=>js("return !gla_group.show.steering&&!gla_group.show.held"),'note applied and the show resumes',6000);
 assert.deepEqual(await js('return gla_group.show.castNotes.sarah'),['Say your lines in Cantonese from now on']);assert.equal(await js("return gla_group.actors.get('sarah').message"),'Got it, Cantonese it is.','her acknowledgement is shown');
 // The mic is an icon button with a label; no live Director, so no hang-up control.
 assert.equal(await js("return document.querySelector('#showMic svg')!==null&&document.querySelector('#showMic span').textContent"),'Talk to the Director');assert.equal(await js("return document.querySelector('#showHangup').hidden"),true);
 // A real OS-level click on the prompter: the window must not be click-through while the mouse is over it.
 const pass=await js("const r=document.querySelector('#prompterPass').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}");
 win.webContents.sendInputEvent({type:'mouseMove',...pass});await until(()=>ignoreState.get(win.id)===false,'prompter is a click target',5000);
 await js('window.voiceDelay=1200');win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...pass});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...pass});
 await until(()=>js('return window.spoken.length>=2'),'standby line');
 assert.equal(await js('return gla_group.show.recording'),true,'recording while performing');
 assert.equal(await js("return !document.querySelector('#headPause').hidden&&!document.querySelector('#headStop').hidden"),true,'header shows Pause and Stop during the show');
 await js("document.querySelector('#headPause').click();");await until(()=>js("return gla_group.show.held&&document.querySelector('#headPause').textContent==='Resume'&&document.querySelector('#showPause').textContent==='Resume'"),'paused from the header');
 await js("document.querySelector('#showPause').click();");await until(()=>js("return !gla_group.show.held&&document.querySelector('#showPause').textContent==='Pause'"),'resumed from the button');
 // A note called out mid-show holds after the current line, reaches the cast, and the show continues by itself.
 await js("document.querySelector('#showText').value='Can you do this in an Irish accent?';document.querySelector('#showSend').click();");
 await until(()=>js('return gla_group.show.held===true'),'the show holds for the note');assert.deepEqual(await js('return gla_group.show.notes'),['Can you do this in an Irish accent?']);
 assert.match(await js("return document.querySelector('#showStatus').textContent"),/Note for the cast/);assert.equal(await js('return window.spoken.length'),2,'nothing new is spoken while holding');
 await until(()=>js('return gla_group.show.held===false'),'and continues without a live Director',8000);await js('window.voiceDelay=150');
 const second=await js('return window.spoken[1]');assert.equal(second.text,'Perhaps under the cushion, Majesty.');assert.equal(second.voice,await js("return document.querySelector('[data-voice=sarah]').value"));
 assert.match(await js("return document.querySelector('#transcript').textContent"),/Sarah takes the line for Pip the Jester/);
 // A note called out mid-show holds after the current line, reaches the cast, and the show continues by itself.
 await until(()=>js("return !document.querySelector('#prompter').hidden&&document.querySelector('#prompterText').textContent.startsWith('At once')"),'second prompt');
 await js("document.querySelector('#prompterDone').click();");

 await until(()=>js("return gla_group.show.phase==='finished'"),'curtain call');
 const spoken=await js('return window.spoken.map(s=>s.text)');assert.deepEqual(spoken,['Where is my crown? The coronation starts at noon!','Perhaps under the cushion, Majesty.','Under the cushion, of course. Bring it here at once.','Then we crown the cat and call it a day.']);
 assert.equal(await js('return gla_group.show.held'),false);const noteLog=await js('return window.spoken.map(s=>s.note)');
 assert.equal(noteLog[0],'');assert.match(noteLog[1],/Cantonese/,'Sarah carries her own voice note');assert.doesNotMatch(noteLog[1],/furious/,'Sarah never hears Tia\'s private note');assert.match(noteLog[2],/Irish accent.*Be furious/);assert.doesNotMatch(noteLog[2],/Cantonese/,'Tia never hears Sarah\'s');assert.match(noteLog[3],/Irish accent.*Be furious/);
 assert.match(await js("return document.querySelector('#transcript').textContent"),/Pip the Jester \(Adam\): At once, Majesty/);assert.match(await js("return document.querySelector('#showStatus').textContent"),/Curtain call. The standby covered 1 line/);
 assert.equal((await js('return gla_group.state')).running,false);assert.equal(await js("return document.querySelector('#prompter').hidden"),true);
 await until(()=>js('return Boolean(gla_group.show.savedRecording)'),'recording saved',30000);
 const saved=await js('return gla_group.show.savedRecording');assert(saved.startsWith(out+'/movies/GPT-Live Avatar Shows/The Lost Crown '),saved);assert.match(saved,/\.mp4$/);
 const head=fs.readFileSync(saved).subarray(0,64);assert(head.includes('ftyp'),'an MP4 container');assert(fs.statSync(saved).size>50000,'has video data: '+fs.statSync(saved).size);
 assert.equal(await js("return document.querySelector('#showReveal').hidden"),false);assert.match(await js("return document.querySelector('#showStatus').textContent"),/Recording saved/);
 await js("document.querySelector('#showRecord').checked=false;");
 const last=await js('return gla_group.show.chat.filter(l=>!/Recording saved/.test(l.text)).at(-1)');assert.match(last.text,/end of “The Lost Crown”/);
 fs.writeFileSync(out+'/curtain-call.png',(await win.webContents.capturePage()).toPNG());
 // Feedback revises the script through the Playwright and replays; takeover covers every remaining human line.
 await js("document.querySelector('#showText').value='Make the jester blame the cat. Ready!';document.querySelector('#showSend').click();");
 await until(()=>js("return gla_group.show.script?.title==='The Lost Crown, Revised'"),'revised script');
 const revision=replies.filter(r=>r.persona==='Playwright')[1];assert(revision.history[0].text.includes('Feedback to apply: Make the jester blame the cat. Ready!'),'feedback reaches the Playwright');
 await until(()=>js("return !document.querySelector('#prompter').hidden"),'revised prompter',30000);assert.equal(await js("return document.querySelector('#prompterText').textContent"),'Perhaps the cat took it, Majesty.');
 await js("document.querySelector('#prompterTakeover').click();");
 await until(()=>js("return gla_group.show.phase==='finished'"),'revised curtain call');
 const replay=await js('return window.spoken.slice(4).map(s=>s.text)');assert.deepEqual(replay,['Where is my crown? The coronation starts at noon!','Perhaps the cat took it, Majesty.','Under the cushion, of course. Bring it here at once.','At once, Majesty. Unless the cat has claimed it.','Then we crown the cat and call it a day.']);
 assert.match(await js("return document.querySelector('#showStatus').textContent"),/covered 2 lines/);
 // Stop mid-performance from the panel; Escape also rests everyone.
 await js("document.querySelector('#showStart').click();");await until(()=>js("return gla_group.show.phase==='performing'&&window.spoken.length>=10"),'replay');await js("document.querySelector('#showStop').click();");
 assert.equal(await js('return gla_group.show.phase'),'finished');assert.equal((await js('return gla_group.state')).running,false);await wait(400);const stoppedAt=await js('return window.spoken.length');await wait(600);assert.equal(await js('return window.spoken.length'),stoppedAt,'no lines after stop');
 // Switching back to an improv format hides the show and keeps Together working.
 await js("document.querySelector('#format').value='chat';document.querySelector('#format').onchange();");assert.equal(await js("return getComputedStyle(document.querySelector('#show')).display"),'none');assert.equal(await js("return document.querySelector('#joinLabel').textContent"),'Join as yourself');
 await js('await gla.group.close();');await wait(300);assert(primary.isVisible());assert.deepEqual(errors,[]);
 fs.writeFileSync(out+'/report.json',JSON.stringify({passed:true,checks:['show mode default','text briefing','cue phrase preparation','playwright long path','installed theatre motions','unavailable custom motion fallback','standby marking','prompter','pass to standby','real click on prompter','I said it','mid-show note holds and resumes','pause and resume button','header pause and stop during the show','private steering note to one character','live voice steering in her own voice','MP4 recording saved','panel as window: lights, resize, remembered position','fold and unfold','curtain call feedback','revision with feedback','takeover','stop','format switch']},null,1));console.log('show app qa passed');
 }catch(e){console.error(e);console.error(errors);process.exitCode=1;}finally{app.exit(process.exitCode||0);}});
