'use strict';
// Avatar Show · Playwright & Director: script parsing, casting rules,
// spoken cues, the performance sequencer with a standby, the Director
// prompt and the motion pipeline's availability report. Run: node qa/show.cjs
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const root=path.join(__dirname,'..');
const script=require(path.join(root,'electron/show-script.cjs'));
const {directorInstructions,showContext,CUE}=require(path.join(root,'electron/show.cjs'));
const {ShowMotionPipeline,frontFacing}=require(path.join(root,'electron/show-motions.cjs'));
const esm=file=>import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(path.join(root,'web',file),'utf8').replace(/from '\/(show-[a-z-]+\.js)'/g,(_m,f)=>`from 'data:text/javascript;base64,${Buffer.from(fs.readFileSync(path.join(root,'web',f),'utf8')).toString('base64')}'`)).toString('base64'));

const clips=[{id:'bow-courtly',label:'Courtly Bow',category:'Theatre'},{id:'plead-beg',label:'Plead',category:'Theatre'},{id:'wave',label:'Wave',category:'Greetings'}];
const characters=[{slug:'tia',name:'Tia',voice:'marin',clips},{slug:'sarah',name:'Sarah',voice:'gleam',clips},{slug:'iselda',name:'Iselda',voice:'quartz',clips:clips.slice(0,2)}];

(async()=>{
 // ---------------------------------------------------------------- casting
 assert.throws(()=>script.castPlan({characters:[]}),/at least one/);
 assert.throws(()=>script.castPlan({characters:[characters[0]],user:{enabled:true,name:'Adam'}}),/two characters/);
 let plan=script.castPlan({characters,user:{enabled:true,name:'Adam'},understudy:'sarah'});
 assert.equal(plan.understudy.slug,'sarah');assert.deepEqual(plan.performers.map(c=>c.slug),['tia','iselda']);assert.equal(plan.user.name,'Adam');
 plan=script.castPlan({characters,user:{enabled:true,name:''}});assert.equal(plan.understudy.slug,'iselda');assert.equal(plan.user.name,'You');
 plan=script.castPlan({characters,user:{enabled:false}});assert.equal(plan.understudy,null);assert.equal(plan.performers.length,3);
 const catalogue=script.motionCatalogue(characters);
 assert.equal(catalogue.length,3);assert.deepEqual(catalogue.find(m=>m.id==='wave').missing,['iselda']);
 // Not for the stage: a heart made with the hands, and walk clips (a walk on the spot is a treadmill; crossing is what `move` is for).
 const social=[...clips,{id:'heart-gesture',label:'Overhead Heart',category:'Gestures'},{id:'stage-walk',label:'Runway Walk',category:'Walking'},{id:'hip-hop-dance',label:'Hip Hop Dance',category:'Dances'}];
 assert.deepEqual(script.motionCatalogue([{slug:'tia',name:'Tia',clips:social}]).map(m=>m.id),['bow-courtly','plead-beg','wave','hip-hop-dance']);
 const prudish=script.parseScript(JSON.stringify({title:'T',synopsis:'s',cast:[{slug:'tia',role:'The Host'}],scenes:[{title:'A',setting:'x',lines:[{speaker:'tia',text:'I love you all.',motion:'heart-gesture'},{speaker:'tia',text:'Watch me cross.',motion:'stage-walk'},{speaker:'tia',text:'And now I dance.',motion:'hip-hop-dance'}]}],wantedMotions:[]}),{characters:[{slug:'tia',name:'Tia',clips:social}]});
 assert.deepEqual(prudish.scenes[0].lines.map(l=>l.motion||''),['','','hip-hop-dance'],'a heart or a walk clip the Playwright asks for anyway is dropped, the line stays');

 // ------------------------------------------------------------- playwright
 {const {playwrightModel,playwrightChoices,PLAYWRIGHT_DEFAULT}=require(path.join(root,'electron/show.cjs'));
  assert.equal(PLAYWRIGHT_DEFAULT,'openai:gpt-5.6-luna');assert.equal(playwrightModel({}),'gpt-5.6-luna','scripts are written by a direct API model unless told otherwise');
  assert.equal(playwrightModel({showPlaywright:'reasoning'}),'','"reasoning" follows the reasoning provider');assert.equal(playwrightModel({showPlaywright:'openai:gpt-6-astra'}),'gpt-6-astra');
  assert.equal(playwrightModel({showPlaywright:'openai:made-up'}),'gpt-5.6-luna');assert.equal(playwrightModel({showPlaywright:42}),'gpt-5.6-luna');
  assert.equal(playwrightChoices()[0],PLAYWRIGHT_DEFAULT);assert.equal(playwrightChoices().at(-1),'reasoning');}
 assert.throws(()=>script.playwrightRequest({id:'bad id',characters}),/Invalid/);
 assert.throws(()=>script.playwrightRequest({id:'show-1',characters,brief:{}}),/what the show is about/);
 const request=script.playwrightRequest({id:'show-1',characters,user:{enabled:true,name:'Adam'},understudy:'sarah',length:'short',brief:{theme:'A lost crown',transcript:[{role:'user',text:'Make it funny'},{role:'director',text:'Sure!'}]}});
 assert.equal(request.id,'show-1');assert.match(request.instructions,/Playwright/);assert.match(request.history[0].text,/lost crown/);assert.match(request.history[0].text,/User: Make it funny/);
 assert.match(request.history[0].text,/Sarah \(slug "sarah"\) is the standby/);assert.match(request.history[0].text,/bow-courtly — Courtly Bow \[Theatre\]/);assert.match(request.history[0].text,/wave .*not installed for: iselda/);
 assert.ok(!/- Sarah \(slug/.test(request.history[0].text),'standby is not a performer');
 // Motions are for what a character is literally doing, never decoration for talk; and "very short" beats the panel's length.
 assert.match(request.instructions,/Most lines have none/);assert.match(request.instructions,/never emphasis or decoration for talk/);assert.ok(!/roughly half of the lines/.test(request.instructions));
 assert.match(request.history[0].text,/Length: about 12 to 16 lines[^\n]*the conversation wins/);

 // ---------------------------------------------------------------- parsing
 const raw={title:'The Lost Crown',synopsis:'A crown goes missing.',cast:[{slug:'tia',role:'Queen'},{slug:'iselda',role:'Guard'},{slug:'sarah',role:'Should be ignored'}],userRole:{role:'Jester'},
  wantedMotions:[{id:'juggle-air',label:'Juggle',prompt:'juggling three invisible balls',duration:4,fallback:'wave',expression:{smile:.8}},{id:'bow-courtly',label:'dup of installed'},{id:'Bad Id',label:'x'},{id:'unused-motion',label:'Unused',prompt:'x'}],
  scenes:[{title:'Throne room',setting:'Morning.',lines:[{speaker:'tia',text:'Where is my crown?',motion:'plead-beg',expression:{surprise:1.4,anger:.2},delivery:'sharp, rising panic',move:'center'},{speaker:'user',text:'Perhaps under the cushion, Majesty.'},{speaker:'iselda',text:'I will search at once!',motion:'juggle-air',note:'eager',move:'backstage'},{speaker:'ghost',text:'ignored speaker'},{speaker:'sarah',text:'ignored: standby has no role'},{speaker:'tia',text:'Hurry.',motion:'not-installed'}]},{title:'Empty scene',lines:[]}]};
 const parsed=script.parseScript('Here is the script:\n```json\n'+JSON.stringify(raw)+'\n```',{characters,user:{enabled:true,name:'Adam'},understudy:'sarah'});
 assert.equal(parsed.title,'The Lost Crown');assert.equal(parsed.scenes.length,1);assert.equal(parsed.lineCount,4);
 assert.deepEqual(parsed.cast.map(c=>c.slug+':'+c.role),['tia:Queen','iselda:Guard']);
 assert.deepEqual(parsed.userRole,{name:'Adam',role:'Jester',understudy:'sarah',understudyName:'Sarah'});
 assert.deepEqual(parsed.scenes[0].lines[0].expression,{surprise:1,anger:.2});assert.equal(parsed.scenes[0].lines[3].motion,'','unknown motions are dropped');
 assert.equal(parsed.scenes[0].lines[0].delivery,'sharp, rising panic');assert.equal(parsed.scenes[0].lines[0].move,'center');assert.equal(parsed.scenes[0].lines[2].move,'','unknown stage points are dropped');assert.equal(parsed.scenes[0].lines[2].delivery,'');
 assert.equal(parsed.scenes[0].lines[2].motion,'juggle-air');assert.deepEqual(parsed.wantedMotions.map(w=>w.id),['juggle-air'],'only wanted motions that are used survive');
 assert.equal(parsed.wantedMotions[0].fallback,'wave');assert.match(parsed.wantedMotions[0].prompt,/juggling/);
 const cues=script.cueSheet(parsed);assert.equal(cues.length,4);assert.equal(cues[1].understudy,'sarah');assert.equal(cues[0].understudy,'');
 assert.match(script.scriptSummary(parsed),/Adam \(the real human\) as Jester; standby Sarah/);assert.match(script.scriptSummary(parsed),/Motions to prepare: Juggle/);
 assert.throws(()=>script.parseScript('no json here',{characters}),/no script/);
 assert.throws(()=>script.parseScript({title:'x',scenes:[{lines:[{speaker:'tia',text:'only one'}]}]},{characters}),/too few lines/);
 const watched=script.parseScript({title:'Solo',scenes:[{lines:[{speaker:'tia',text:'One.'},{speaker:'user',text:'ignored: audience only'},{speaker:'sarah',text:'Two.'}]}]},{characters,user:{enabled:false}});
 assert.equal(watched.userRole,null);assert.equal(watched.lineCount,2);assert.equal(watched.cast.length,3);

 // -------------------------------------------------------------- Director
 const context={characters:characters.map(({slug,name,voice})=>({slug,name,voice})),user:{enabled:true,name:'Adam',role:'Jester'},understudy:'sarah',phase:'finished',script:script.scriptSummary(parsed),theme:'A lost crown',length:'short',motions:'Theatre (2), Greetings (1)',pipeline:{available:false,problems:['Meshy API key']},prepared:'juggle-air → wave'};
 const text=directorInstructions(context,{live:true});
 assert.match(text,/Director of Avatar Show/);assert.match(text,/Tia \(tia\)/);assert.match(text,/Adam.*Jester/);assert.match(text,/standby/i);assert.match(text,/Places, everyone!/);assert.match(text,/not configured/);assert.match(text,/phase: finished/);
 assert.equal(CUE,'Places, everyone!');assert.equal(showContext({}).phase,"planning");assert.equal(showContext({}).user.name,"You");
 assert.doesNotThrow(()=>directorInstructions(null));assert.doesNotThrow(()=>directorInstructions({characters:'nope',user:5}));

 // -------------------------------------------------------- motion pipeline
 const work=fs.mkdtempSync(path.join(os.tmpdir(),'show-qa-'));
 const pipeline=new ShowMotionPipeline({root:work,configFile:path.join(work,'missing.json'),characterDir:()=>'',workDir:work,env:{PATH:'/nonexistent',HOME:work}});
 const status=pipeline.status();
 assert.equal(status.available,false);assert.ok(status.problems.some(p=>/Meshy API key/.test(p)),status.problems.join('; '));assert.ok(status.problems.some(p=>/donor character/.test(p)));
 await assert.rejects(pipeline.generate({id:'x-y',prompt:'p'},{}),/not available/);
 fs.writeFileSync(path.join(work,'cfg.json'),JSON.stringify({meshyApiKey:'k',rigTaskId:'r',blender:'/nonexistent/Blender',uv:'/nonexistent/uv',blend:'/nonexistent.blend'}));
 const configured=new ShowMotionPipeline({root:work,configFile:path.join(work,'cfg.json'),characterDir:()=>'',workDir:work,env:{PATH:'/nonexistent',HOME:work}}).status();
 assert.equal(configured.meshy,true);assert.ok(configured.problems.some(p=>/Blender/.test(p)));
 assert.ok(configured.problems.some(p=>/motion tools/.test(p)),'a root without show-motion.py cannot prepare motions');
 // A packaged app ships the tools beside the bundle and writes its clips into
 // user data, so the Director can prepare custom motions outside a checkout.
 const shipped=path.join(work,'GPT-Live Avatar.app','Contents','Resources');
 fs.mkdirSync(path.join(shipped,'tools'),{recursive:true});fs.writeFileSync(path.join(shipped,'tools','show-motion.py'),'#');
 const packaged=new ShowMotionPipeline({root:path.join(shipped,'app.asar'),toolsDir:path.join(shipped,'tools'),configFile:path.join(work,'cfg.json'),characterDir:()=>'',workDir:work,env:{PATH:'/nonexistent',HOME:work}}).status();
 assert.ok(!packaged.problems.some(p=>/motion tools/.test(p)),'a packaged app finds the motion tools shipped beside it');
 assert.equal(packaged.workDir,work,'a packaged app never writes inside its own bundle');
 assert.ok(!new ShowMotionPipeline({root,configFile:path.join(work,'cfg.json'),characterDir:()=>'',workDir:work,env:{PATH:'/nonexistent',HOME:work}}).status().problems.some(p=>/motion tools/.test(p)),'the repository root has the tool');
 assert.match(frontFacing('waves happily'),/facing the camera/);assert.match(frontFacing('waves happily',true),/never turn/i);
 await assert.rejects(pipeline.run('/nonexistent/binary',[],{}),/Could not start/);
 fs.rmSync(work,{recursive:true,force:true});

 // ------------------------------------------------------------------ cues
 const cuesMod=await esm('show-cues.js');
 assert.equal(cuesMod.userCue("I'll pass",'performing'),'pass');assert.equal(cuesMod.userCue('pass','performing'),'pass');assert.equal(cuesMod.userCue('我忘词了','performing'),'pass');assert.equal(cuesMod.userCue('跳过这句','performing'),'pass');
 assert.equal(cuesMod.userCue('please take over the rest for me','performing'),'takeover');assert.equal(cuesMod.userCue('剩下的替我','performing'),'takeover');
 assert.equal(cuesMod.userCue('stop the show','performing'),'stop');assert.equal(cuesMod.userCue('不演了','performing'),'stop');
 assert.equal(cuesMod.userCue('Where is my crown?','performing'),'','ordinary lines are not cues');
 assert.equal(cuesMod.userCue('okay, continue','performing'),'continue');assert.equal(cuesMod.userCue('Go ahead','performing'),'continue');assert.equal(cuesMod.userCue('继续','performing'),'continue');assert.equal(cuesMod.userCue('Can you do this in an Irish accent?','performing'),'','a note is not a cue');assert.equal(cuesMod.userCue('Pause please','performing'),'pause');assert.equal(cuesMod.userCue('等一下','performing'),'pause');assert.equal(cuesMod.userCue('please pause the music while I think','performing'),'','a sentence about pausing is a note');
 assert.equal(cuesMod.userCue("let's start the show",'ready'),'start');assert.equal(cuesMod.userCue('开演','ready'),'start');assert.equal(cuesMod.userCue('again please','finished'),'start');
 assert.equal(cuesMod.userCue('please prepare the show','planning'),'prepare');assert.equal(cuesMod.userCue('写个剧本吧','planning'),'prepare');assert.equal(cuesMod.userCue('开始准备','planning'),'prepare');
 assert.equal(cuesMod.userCue('I want a comedy about cats','planning'),'','ideas are not cues');assert.equal(cuesMod.userCue('start the show','planning'),'prepare','starting from scratch prepares first');
 assert.equal(cuesMod.userCue("Okay, let's go!",'planning'),'prepare');assert.equal(cuesMod.userCue("let's go with a comedy about a lost hat",'planning'),'','"let\'s go with…" is still the briefing');assert.equal(cuesMod.userCue('how do we start the show?','planning'),'prepare','an explicit "start the show" still counts');
 assert.equal(cuesMod.directorCue('Wonderful. Places, everyone!'),true);assert.equal(cuesMod.directorCue('Let us discuss places'),false);
 assert.equal(cuesMod.stripCue('Wonderful. Places, everyone!'),'Wonderful.');
 assert.equal(cuesMod.lineCoverage('perhaps under the cushion majesty','Perhaps under the cushion, Majesty.'),1);
 assert.ok(cuesMod.lineCoverage('under the cushion','Perhaps under the cushion, Majesty.')>.5);assert.equal(cuesMod.lineCoverage('','x'),0);assert.equal(cuesMod.lineCoverage('hello','Perhaps under the cushion, Majesty.'),0);
 assert.ok(cuesMod.lineCoverage('王冠在坐垫下面','也许王冠在坐垫下面，际下。')>.6);

 // ---------------------------------------------------------------- player
 const {ShowPlayer,cueSheet}=await esm('show-player.js');
 assert.deepEqual(cueSheet(parsed).map(c=>c.speaker),['tia','user','iselda','tia']);
 const log=[];const stage=(human)=>({
  scene:(s,i)=>{log.push('scene:'+i);},floor:({speaker,listener})=>{log.push(`floor:${speaker}>${listener||'-'}`);},
  motion:(slug,id,expression)=>{log.push(`motion:${slug}:${id||'-'}:${Object.keys(expression).join(',')||'-'}`);},
  move:async(slug,destination)=>{log.push(`move:${slug}:${destination}`);},speak:async(cue,slug)=>{log.push(`speak:${slug}:${cue.text}${cue.delivery?' ('+cue.delivery+')':''}`);return 'heard '+cue.text;},clear:slug=>{log.push('clear:'+slug);},
  human:async(cue)=>{log.push('human:'+cue.text);return human(cue);},understudy:(cue,slug,reason)=>{log.push(`understudy:${slug}:${reason}`);},
  line:l=>{log.push(`line:${l.speaker}${l.forUser?'*':''}:${l.text}`);},status:m=>{log.push('status:'+m);},stop:()=>{log.push('stop');},
 });
 let result=await new ShowPlayer(stage(async()=>({result:'spoken',text:'Under the cushion!'}))).run(parsed,{resolveMotion:id=>id==='juggle-air'?'wave':id});
 assert.equal(result.finished,true);assert.equal(result.passes,0);assert.equal(result.lines.length,4);
 assert.deepEqual(log,['scene:0','floor:tia>user','move:tia:center','speak:tia:Where is my crown? (sharp, rising panic)','motion:tia:plead-beg:surprise,anger','clear:tia','line:tia:Where is my crown?','floor:user>iselda','human:Perhaps under the cushion, Majesty.','line:user:Under the cushion!','floor:iselda>tia','motion:iselda:wave:-','speak:iselda:I will search at once!','clear:iselda','line:iselda:I will search at once!','floor:tia>-','speak:tia:Hurry.','clear:tia','line:tia:Hurry.']);
 // The line carries the walk: the voice starts while the actor is still
 // crossing, the gesture waits for the feet to stop, and every cue hands the
 // voice the part it plays, the room it stands in and the line it answers.
 const beats=[],seen=[];let crossing=false;
 const walkStage={
  scene:()=>{},floor:()=>{},clear:()=>{},line:()=>{},status:()=>{},stop:()=>{},understudy:()=>{},human:async()=>({result:'pass'}),
  move:async()=>{crossing=true;beats.push('walk-start');await new Promise(r=>setTimeout(r,40));crossing=false;beats.push('walk-end');},
  motion:()=>{beats.push('gesture'+(crossing?'-while-walking':'-on-arrival'));},
  speak:async(cue,slug,context)=>{beats.push('speak'+(crossing?'-while-walking':'-standing-still'));seen.push(context);return 'ok';},
 };
 await new ShowPlayer(walkStage).run({title:'T',cast:[{slug:'tia',name:'Tia',role:'The Queen'},{slug:'iselda',name:'Iselda',role:'The Steward'}],scenes:[{title:'The hall',lines:[{speaker:'tia',text:'One.',move:'center',motion:'wave'},{speaker:'iselda',text:'Two.'}]}]});
 assert.deepEqual(beats,['walk-start','speak-while-walking','walk-end','gesture-on-arrival','speak-standing-still'],'the actor speaks while crossing and gestures on arrival');
 // A line with no motion of its own gets talking hands (or a shift of stance) from the stage; a line with one does not.
 {const talked=[];await new ShowPlayer({...walkStage,move:undefined,talk:(slug,cue)=>talked.push(slug+':'+cue.text)}).run({title:'T',cast:[{slug:'tia',name:'Tia',role:'A'},{slug:'iselda',name:'Iselda',role:'B'}],scenes:[{title:'S',lines:[{speaker:'tia',text:'Hello.',motion:'wave'},{speaker:'iselda',text:'Plain talk.'},{speaker:'tia',text:'Smiling talk.',expression:{smile:.6}}]}]});
  assert.deepEqual(talked,['iselda:Plain talk.','tia:Smiling talk.']);}
 assert.deepEqual(seen[0],{role:'The Queen',scene:'The hall',to:'The Steward',after:'',note:''},'the voice is told who it plays, where it stands and who it addresses');
 assert.equal(seen[1].after,'The Queen: One.','the voice hears the line it answers');
 log.length=0;result=await new ShowPlayer(stage(async()=>({result:'pass'}))).run(parsed);
 assert.equal(result.passes,1);assert.ok(log.includes('understudy:sarah:pass'));assert.ok(log.includes('speak:sarah:Perhaps under the cushion, Majesty.'));assert.ok(log.includes('line:sarah*:Perhaps under the cushion, Majesty.'));
 // Timeout falls back to a pass; an explicit button pass wins over a slow human.
 log.length=0;const slow=new ShowPlayer(stage(()=>new Promise(()=>{})));const run=slow.run(parsed);await new Promise(r=>setTimeout(r,20));slow.pass();result=await run;
 assert.equal(result.finished,true);assert.equal(result.passes,1);
 // Takeover hands every remaining human line to the standby.
 const twoUser=script.parseScript({title:'T',scenes:[{lines:[{speaker:'user',text:'One.'},{speaker:'tia',text:'Two.'},{speaker:'user',text:'Three.'}]}]},{characters,user:{enabled:true,name:'Adam'},understudy:'sarah'});
 log.length=0;let asked=0;result=await new ShowPlayer(stage(async()=>{asked++;return {result:'takeover'};})).run(twoUser);
 assert.equal(asked,1,'after takeover the human is not asked again');assert.equal(result.takenOver,true);assert.equal(result.passes,2);assert.ok(log.includes('speak:sarah:Three.'));
 // Stop during a line ends the run without a curtain call.
 log.length=0;const stopper=new ShowPlayer({...stage(async()=>({result:'pass'})),speak:async(cue,slug)=>{log.push('speak:'+slug);stopper.stop();return '';}});
 result=await stopper.run(twoUser);assert.equal(result.finished,false);assert.ok(log.includes('stop'));assert.equal(stopper.running,false);
 await assert.rejects(new ShowPlayer(stage()).run({scenes:[]}),/no lines/);
 // A hold between cues: the current line finishes, the next waits for resume, and stop releases a held show.
 log.length=0;const holds=[];let held=null;
 const holdStage={...stage(async()=>({result:'pass'})),paused:v=>holds.push(v),speak:async(cue,slug)=>{log.push('speak:'+slug+':'+cue.text);if(cue.text==='Two.'){held.pause();held.pause();}return '';}};
 held=new ShowPlayer(holdStage);const holdRun=held.run(twoUser);
 await new Promise(r=>setTimeout(r,60));assert.equal(held.paused,true);assert.deepEqual(holds,[true]);assert.ok(log.includes('speak:tia:Two.'));assert.ok(!log.some(l=>l.startsWith('speak:sarah:Three')),'the next line waits');
 held.resume();result=await holdRun;assert.equal(result.finished,true);assert.ok(log.includes('speak:sarah:Three.'));assert.deepEqual(holds,[true,false]);assert.equal(held.paused,false);
 log.length=0;const heldStop=new ShowPlayer({...holdStage,speak:async(cue,slug)=>{log.push('speak:'+slug);if(slug==='tia')heldStop.pause();return '';}});const stopRun=heldStop.run(twoUser);
 await new Promise(r=>setTimeout(r,40));assert.equal(heldStop.paused,true);heldStop.stop();result=await stopRun;assert.equal(result.finished,false);assert.equal(heldStop.paused,false);
 // The hold is announced when it takes effect (after the line under way), not when it is requested: that is when a recording pauses.
 log.length=0;let effect=null;const effectStage={...holdStage,paused:v=>log.push('paused:'+v),held:()=>log.push('held'),speak:async(cue,slug)=>{log.push('speak:'+slug+':'+cue.text);if(cue.text==='Two.'){effect.pause();log.push('after-request');}return '';}};
 effect=new ShowPlayer(effectStage);const effectRun=effect.run(twoUser);await new Promise(r=>setTimeout(r,60));
 const beatsSeen=log.filter(l=>/paused|held|after-request|speak/.test(l));assert.deepEqual(beatsSeen.slice(beatsSeen.indexOf('speak:tia:Two.'),beatsSeen.indexOf('speak:tia:Two.')+4),['speak:tia:Two.','paused:true','after-request','held'],'held fires once the line has finished');
 effect.resume();result=await effectRun;assert.equal(result.finished,true);
 // Three failed lines in a row end the show instead of spending every remaining line in silence.
 log.length=0;let attempts=0;const failing=new ShowPlayer({...stage(async()=>({result:'pass'})),speak:async()=>{attempts++;throw Error('no voice');}});
 result=await failing.run(parsed);assert.equal(result.finished,false);assert.match(result.aborted,/three lines in a row/);assert.equal(attempts,3);assert.ok(log.includes('stop'));assert.equal(failing.running,false);
 attempts=0;const flaky=new ShowPlayer({...stage(async()=>({result:'pass'})),speak:async(cue)=>{attempts++;if(attempts%2)throw Error('no voice');return 'ok';}});
 result=await flaky.run(parsed);assert.equal(result.finished,true,'isolated failures do not end the show');assert.equal(result.aborted,'');
 console.log('show qa ok');
})().catch(e=>{console.error(e);process.exit(1);});

// Recording: the file's audio is held back by the live playback lag so the
// recorded mouth lines up with the recorded voice (web/show-recorder.js).
{
 const recorder=fs.readFileSync(path.join(root,'web/show-recorder.js'),'utf8'),show=fs.readFileSync(path.join(root,'web/show.js'),'utf8');
 assert.match(recorder,/import \{LIP_SYNC_DELAY\} from '\/lip-sync\.js'/,'recorder knows the lip-sync delay line');
 assert.match(recorder,/addAudio\(stream,output=null\)[\s\S]*createDelay\(1\)[\s\S]*source\.connect\(delay\);delay\.connect\(this\.destination\)/,'every recorded voice passes through a delay line');
 assert.match(recorder,/syncDelays\(\)\{[\s\S]*playbackLag|lagFor\(output\)\{const lag=output\?\.playbackLag\?\.\(\)/,'the delay follows the speaker output lag');
 assert.match(recorder,/if\(!this\.active\|\|this\.paused\)return;\n\s*this\.syncDelays\(\);/,'the lag is re-read every recorded frame');
 assert.match(show,/stream:\(stream,output\)=>recorder\?\.addAudio\(stream,output\)/,'the Director voice hands its output to the recorder');
 assert.match(show,/function recordAudio\(stream,output\)\{recorder\?\.addAudio\(stream,output\);\}/,'cast voices hand their output to the recorder');
 assert.match(fs.readFileSync(path.join(root,'web/group.js'),'utf8'),/tap\(stream,voice\.output\)/,'audio taps receive the speaking output');
 assert.match(fs.readFileSync(path.join(root,'web/show-director.js'),'utf8'),/this\.emit\('stream',detail\.stream,this\.output\)/,'the Director emits its output with the stream');
}
console.log('Recorded voices are delayed to match the on-screen mouth.');
