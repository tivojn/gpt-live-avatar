// Real desktop Avatar Show with a deterministic Playwright/Director substitute
// and silent voices. Exercises the full loop: brief the Director by text, the
// cue writes and prepares the show, the characters perform with theatre
// motions, the human reads from the prompter and passes a line to the
// standby, then the show is revised and replayed. Run: npx electron qa/show-app.cjs
const {app,BrowserWindow,safeStorage}=require('electron'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const repo=path.resolve(__dirname,'..'),out=path.join(repo,'build/qa-show');fs.mkdirSync(out,{recursive:true});app.setPath('userData',out+'/profile');fs.mkdirSync(app.getPath('userData'),{recursive:true});delete process.env.GLA_OPENAI_KEY;process.env.GLA_SHOW_MOTION_CONFIG=out+'/no-show-motion.json';
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
app.on('browser-window-created',(_e,w)=>w.webContents.on('console-message',d=>{if(d.level==='error')errors.push(d.message);}));require('../electron/main.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));async function until(fn,label,limit=120000){const end=Date.now()+limit;while(Date.now()<end){try{const value=await fn();if(value)return value;}catch{}await wait(80);}throw Error('Timeout '+label);}
app.whenReady().then(async()=>{try{
 const primary=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/avatar.html')),'primary');await until(()=>primary.webContents.executeJavaScript('Boolean(window.gla_avatar?.model)'),'primary ready');await primary.webContents.executeJavaScript('gla.group.open()');
 const win=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/group.html')),'group'),js=s=>win.webContents.executeJavaScript('(async()=>{'+s+'})()');
 await until(()=>js('return window.gla_group&&!gla_group.state.loading&&gla_group.actors.size===2&&Boolean(gla_group.show)'),'loaded');
 assert.match(win.getTitle(),/Avatar Show/);
 assert.equal(await js("return document.querySelector('#format').value"),'show');assert.equal(await js("return getComputedStyle(document.querySelector('#show')).display!=='none'&&getComputedStyle(document.querySelector('#start')).display==='none'"),true,'show panel replaces the improv controls');
 await js(`window.spoken=[];window.voiceDelay=150;gla_group.voice.speak=async(text,voice,onText)=>{window.spoken.push({text,voice});onText(text);await new Promise(r=>setTimeout(r,window.voiceDelay));return text;};document.querySelector('#humanName').value='Adam';document.querySelector('#join').checked=true;document.querySelector('#join').onchange();`);
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
 // Passing hands the line to Sarah, the standby, in her own voice.
 await js("document.querySelector('#prompterPass').click();");
 await until(()=>js('return window.spoken.length>=2'),'standby line');const second=await js('return window.spoken[1]');assert.equal(second.text,'Perhaps under the cushion, Majesty.');assert.equal(second.voice,await js("return document.querySelector('[data-voice=sarah]').value"));
 assert.match(await js("return document.querySelector('#transcript').textContent"),/Sarah takes the line for Pip the Jester/);
 // The second human line is spoken by Adam himself ("I said it").
 await until(()=>js("return !document.querySelector('#prompter').hidden&&document.querySelector('#prompterText').textContent.startsWith('At once')"),'second prompt');
 await js("document.querySelector('#prompterDone').click();");
 await until(()=>js("return gla_group.show.phase==='finished'"),'curtain call');
 const spoken=await js('return window.spoken.map(s=>s.text)');assert.deepEqual(spoken,['Where is my crown? The coronation starts at noon!','Perhaps under the cushion, Majesty.','Under the cushion, of course. Bring it here at once.','Then we crown the cat and call it a day.']);
 assert.match(await js("return document.querySelector('#transcript').textContent"),/Pip the Jester \(Adam\): At once, Majesty/);assert.match(await js("return document.querySelector('#showStatus').textContent"),/Curtain call. The standby covered 1 line/);
 assert.equal((await js('return gla_group.state')).running,false);assert.equal(await js("return document.querySelector('#prompter').hidden"),true);
 const last=await js('return gla_group.show.chat.at(-1)');assert.match(last.text,/end of “The Lost Crown”/);
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
 fs.writeFileSync(out+'/report.json',JSON.stringify({passed:true,checks:['show mode default','text briefing','cue phrase preparation','playwright long path','installed theatre motions','unavailable custom motion fallback','standby marking','prompter','pass to standby','I said it','curtain call feedback','revision with feedback','takeover','stop','format switch']},null,1));console.log('show app qa passed');
 }catch(e){console.error(e);console.error(errors);process.exitCode=1;}finally{app.exit(process.exitCode||0);}});
