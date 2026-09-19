'use strict';
// Instinct (TypeSafe Jev) without a network or a real key: request shape,
// thresholds, key storage, failure behaviour, and the companion contract.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {Instinct,replyRequest,interpretReply,listenRequest,interpretListen,ENDPOINT,MODEL}=require('../electron/instinct.cjs');
const output=path.resolve(__dirname,'../build/qa-instinct');fs.rmSync(output,{recursive:true,force:true});fs.mkdirSync(output,{recursive:true});
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const clips=[{id:'kung-fu-punch',label:'Kung Fu Punch',category:'Kung fu & fitness',aliases:['kung fu','功夫']},{id:'victory-cheer',label:'Victory Cheer',category:'Gestures'},
  {id:'joyful-sway',label:'Joyful Sway',category:'Dances',reactions:['celebration']},{id:'victory-fist-pump',label:'Victory Fist Pump',category:'Gestures',reactions:['celebration']},
  {id:'../evil',label:'x'},{id:'kung-fu-punch',label:'duplicate'}];
const checks=[];
(async()=>{
  const request=replyRequest({user:'Can you do kung fu?\u0000'+'x'.repeat(5000),reply:"Sure, I'll try a kung fu punch!",clips,character:'Tia'});
  const options=Object.keys(request.questions.what.criteria);
  assert.equal(request.model,MODEL);assert(options.includes('clip:kung-fu-punch'));assert(options.includes('action:go-upper-left'));assert(options.includes('none'));
  assert(!options.some(o=>o.includes('evil')));assert.equal(options.filter(o=>o==='clip:kung-fu-punch').length,1);assert(options.length<=255);
  assert(request.questions.what.criteria['clip:kung-fu-punch'].includes('功夫'));assert(request.state.user_said.length<=1200);assert(!request.state.user_said.includes('\u0000'));
  assert.equal(request.questions.performs.type,'noul');assert.equal(request.questions.reaction.type,'choice');
  const many=replyRequest({user:'',reply:'x',clips:Array.from({length:400},(_,i)=>({id:'clip-'+i,label:'Clip '+i}))});
  assert(Object.keys(many.questions.what.criteria).length<=255);
  checks.push('One request, three typed questions, only installed clips and finite actions as options, 255-option ceiling');

  const answer=(performs,choice,weight,reaction,confidence=.9)=>({performs:{type:'noul',noul:performs},what:{choice,confidence:weight,probabilities:{[choice]:weight,'clip:victory-cheer':.2,'clip:not-installed':.9}},reaction:reaction&&{choice:reaction,confidence}});
  assert.equal(interpretReply(answer(.93,'clip:kung-fu-punch',.88),clips).suggestion,'clip:kung-fu-punch');
  assert.equal(interpretReply(answer(.9,'action:wave',.8),clips).suggestion,'action:wave');
  assert.equal(interpretReply(answer(.05,'none',.97),clips).suggestion,'veto');
  assert.equal(interpretReply(answer(.4,'clip:kung-fu-punch',.9),clips).suggestion,undefined,'an unsure Jev leaves the local rules in charge');
  assert.equal(interpretReply(answer(.95,'clip:not-installed',.9),clips).suggestion,undefined);
  assert.equal(interpretReply(answer(.95,'action:rm-rf',.9),clips).suggestion,undefined);
  assert.equal(interpretReply(answer(.95,'none',.9),clips).suggestion,undefined);
  assert.equal(interpretReply(answer(.8,'clip:kung-fu-punch',.7),clips,{partial:true}).suggestion,undefined,'mid-sentence needs a near-certain choice');
  assert.equal(interpretReply(answer(.92,'clip:kung-fu-punch',.85),clips,{partial:true}).suggestion,'clip:kung-fu-punch');
  assert.equal(interpretReply(answer(.02,'none',.9),clips,{partial:true}).suggestion,undefined,'an unfinished sentence can never veto');
  const reacted=interpretReply(answer(.05,'none',.9,'celebration'),clips);
  assert.equal(reacted.reaction,'celebration');assert.deepEqual(Object.keys(reacted.ranking),['victory-cheer']);
  assert.equal(interpretReply(answer(.05,'none',.9,'celebration',.3),clips).reaction,undefined);
  assert.equal(interpretReply(answer(.05,'none',.9,'rage'),clips).reaction,undefined);
  assert.equal(interpretReply({},clips).suggestion,undefined,'a missing answer is not a no');assert.equal(interpretReply({performs:.01},clips).suggestion,undefined,'a veto needs both answers');assert.equal(interpretReply({performs:.01,what:{choice:'none',probabilities:{none:.9}}},clips).suggestion,'veto');assert.equal(interpretReply(null,clips,{partial:true}).suggestion,undefined);
  checks.push('Confidence gates: act, veto, or defer to local rules; partial replies may only act; unknown options are dropped');

  const faces=[{id:'concern',when:'Worried or sympathetic'},{id:'laugh',when:'Laughing at a joke'},{id:'smile',when:'Pleased'},{id:'neutral',when:'must not override the built-in way out'},{id:'BAD id',when:'x'},{id:'empty',when:''}];
  const hearing=listenRequest({history:[{role:'assistant',text:'How was your day?'},{role:'system',text:'x'}],partial:'Honestly my dog died this morning',character:'Tia',faces});
  assert.equal(hearing.state.earlier[1].speaker,'user');assert.deepEqual(Object.keys(hearing.questions.face.criteria),['concern','laugh','smile','neutral']);
  assert.match(hearing.questions.face.criteria.neutral,/nothing a listener/);
  assert.equal(interpretListen({face:{choice:'concern',confidence:.9}},faces).face,'concern');
  assert.equal(interpretListen({face:{choice:'laugh',confidence:.4}},faces).face,null,'unsure: keep a still face');
  assert.equal(interpretListen({face:{choice:'neutral',confidence:.99}},faces).face,null);
  assert.equal(interpretListen({face:{choice:'rage',confidence:.99}},faces).face,null,'only expressions the renderer offered');
  assert.equal(interpretListen({},faces).face,null);
  const kin=[{id:'sad',when:'Grieving',family:'sorrow'},{id:'concern',when:'Worried',family:'sorrow'},{id:'laugh',when:'Laughing',family:'joy'}];
  assert.equal(interpretListen({face:{choice:'sad',confidence:.55,probabilities:{sad:.52,concern:.4,laugh:.02,neutral:.06}}},kin).face,'sad','near-synonyms splitting the vote still count');
  assert.equal(interpretListen({face:{choice:'sad',confidence:.4,probabilities:{sad:.45,concern:.2,neutral:.35}}},kin).face,null,'not when neutral is a real contender');
  assert.equal(interpretListen({face:{choice:'sad',confidence:.4,probabilities:{sad:.45,laugh:.45,neutral:.05}}},kin).face,null,'not when the rivals disagree in kind');
  const felt=replyRequest({user:'I got the job!',reply:'That is wonderful!',clips,faces});
  assert.deepEqual(Object.keys(felt.questions.face.criteria),['concern','laugh','smile','neutral']);assert.equal(replyRequest({user:'',reply:'x',clips}).questions.face,undefined,'no faces offered, no question');
  assert.equal(interpretReply({...answer(.05,'none',.9),face:{choice:'smile',confidence:.8}},clips,{faces}).face,'smile');
  assert.equal(interpretReply({...answer(.05,'none',.9),face:{choice:'smile',confidence:.8}},clips,{partial:true,faces}).face,'smile','her face may change mid-sentence');
  checks.push('Facial expressions: Jev chooses only from the renderer\'s own list, unsure or neutral leaves her face still');

  // Every expression must reach at least one visible shape on every character.
  const rigs=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/face-channels.json'),'utf8'));
  const library=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(path.join(__dirname,'../web/avatar3d-expressions.js'),'utf8')).toString('base64'));
  assert(library.expressionNames.length>=20);
  for(const [slug,rig] of Object.entries(rigs))for(const name of library.expressionNames){
    const names=new Set(rig.channels),parts=library.resolveExpression(name,c=>c==='?independentEyes'?rig.independentEyes:names.has(c));
    assert(parts.length>0,`${slug} cannot show ${name}`);
    for(const part of parts)for(const [channel,value] of Object.entries(part.channels))assert(value>=0&&value<=1&&(channel.startsWith('?')||names.has(channel)),`${slug} ${name} ${channel}`);
  }
  assert.deepEqual(library.resolveExpression('playful',c=>c!=='?independentEyes'&&new Set(rigs.tia.channels).has(c)).filter(p=>p.channels.eyeBlinkLeft),[],'no wink on a rig whose eyes close together');
  const director=new library.FaceDirector({random:()=>.5}),sarah=new Set(rigs.sarah.channels),has=c=>c==='?independentEyes'||sarah.has(c);
  const run=(from,to,speaking=false)=>{let f;for(let t=from;t<=to;t+=16)f=director.frame(t,speaking);return f;};
  assert.equal(director.show('nonsense',0,has),false);assert.equal(director.show('concern',0,has),true);
  const apex=run(0,700),settled=run(700,4000);
  assert(apex.channels['Brow.sad.up']>.55&&apex.channels['Brow.sad.up']<.7,'onset reaches the apex quickly, at a modest weight');
  assert(settled.channels['Brow.sad.up']<apex.channels['Brow.sad.up']*.85&&settled.channels['Brow.sad.up']>.35,'then settles to a fainter trace instead of holding the peak');
  assert.equal(director.show('concern',4000,has),true);assert.equal(director.current.start,0,'the same feeling again extends, it does not restart');
  assert(director.current.until<=library.EXPRESSIONS.concern.max,'renewals are capped');
  director.show('laugh',5000,has);const chuckle=[];for(let t=5000;t<=6400;t+=16)chuckle.push(director.frame(t,false).channels['Mth.Sml.Op3']||0);
  assert(Math.max(...chuckle)>.08&&Math.max(...chuckle)<.35,'a laugh opens the mouth only a little');
  assert(chuckle.filter((v,i)=>i>0&&i<chuckle.length-1&&v>chuckle[i-1]&&v>chuckle[i+1]).length>=3,'and it chuckles rather than freezing open');
  assert.equal(chuckle.at(-1)<.02,true,'the chuckle is over within about a second');
  const talking=run(6400,7000,true);assert(talking.channels['Eye.happy']>.15&&!(talking.channels['Mth.Sml.Grn-1']>.25),'visemes keep her mouth while she talks');
  assert(!(talking.channels['Brow.sad.up']>.05),'the previous expression has faded');
  const tic=new library.FaceDirector({random:()=>.5});let winks=0,prev=0;
  for(let t=0;t<=20000;t+=16){if(t%600===0)tic.show('playful',t,has);const w=tic.frame(t).channels.eyeBlinkLeft||0;if(w>.5&&prev<=.5)winks++;prev=w;}
  assert(winks>=2&&winks<=3,'constant teasing gives a wink now and then, not a tic: '+winks);
  const cocked=[];for(let t=20000;t<=23000;t+=16)cocked.push(tic.frame(t).channels.browDownRight||0);assert(Math.max(...cocked)<.02,'and the cocked brow never stays');
  director.show('surprise',7000,has);director.show('sad',7300,has);assert.equal(director.showing(7300),'surprise','no flicker: a new feeling waits out the dwell');
  run(7300,8300);assert.equal(director.showing(8300),'sad','and then takes over');
  director.relax(8400);assert(director.current.until>8900,'but not within the first moment of a feeling');run(8300,9400);director.relax(9400);assert(director.current.until<=9900,'a confident neutral lets a lingering face go');
  const rest=run(9400,15000);assert.equal(director.active,false);assert.deepEqual(rest.channels,{});
  const a=new library.FaceDirector({random:()=>0}),b=new library.FaceDirector({random:()=>1});a.show('smile',0,has);b.show('smile',0,has);
  let fa,fb;for(let t=0;t<=800;t+=16){fa=a.frame(t);fb=b.frame(t);}assert(fb.channels['Mth.Sml.Cls.1']>fa.channels['Mth.Sml.Cls.1']*1.15,'no two smiles are the same size');
  const soft=new library.FaceDirector({random:()=>.5});soft.show('smile',0,has,{intensity:.8});let fs2;for(let t=0;t<=800;t+=16)fs2=soft.frame(t);assert(fs2.channels['Mth.Sml.Cls.1']<fa.channels['Mth.Sml.Cls.1']*1.05,'a listener mirrors more softly');
  assert.equal(library.textWeight===undefined,true);
  checks.push(`${library.expressionNames.length} expressions resolve on all ${Object.keys(rigs).length} characters; the director peaks, settles, chuckles, waits out flicker, caps renewals and comes to rest`);

  // Fake encryption is confined to this test, with a throwaway profile.
  const storage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(Buffer.from(s).toString('base64')),decryptString:b=>Buffer.from(b.toString(),'base64').toString()};
  const calls=[];let respond=()=>json({model:MODEL,answers:answer(.93,'clip:kung-fu-punch',.88,'none'),usage:{input_tokens:412,output_tokens:0}});
  let clock=1000,changes=0;
  const instinct=new Instinct({directory:path.join(output,'credentials'),safeStorage:storage,now:()=>clock,onChange:()=>changes++,
    fetchImpl:async(url,init)=>{calls.push({url,init,body:JSON.parse(init.body)});return respond(init);}});
  assert.equal(instinct.status().state,'off');assert.equal(await instinct.decide({kind:'reply',user:'hi',reply:'Sure, I will wave',clips}),null);assert.equal(calls.length,0,'no key, no request');
  await assert.rejects(instinct.setKey('short'),/valid TypeSafe/);
  respond=()=>json({error:'nope'},401);await assert.rejects(instinct.setKey('ts_live_0123456789abcdef'),/did not accept/);assert(!instinct.hasKey());
  respond=()=>json({model:MODEL,answers:{greeting:{type:'noul',noul:.99}},usage:{input_tokens:9}});await instinct.setKey('  ts_live_0123456789abcdef ');
  assert(instinct.hasKey());assert(!fs.readFileSync(instinct.file()).toString().includes('ts_live'));if(process.platform!=='win32')assert.equal(fs.statSync(instinct.file()).mode&0o777,0o600);assert.equal(changes,1);
  assert.equal(calls.at(-1).url,ENDPOINT);assert.equal(calls.at(-1).init.headers.Authorization,'Bearer ts_live_0123456789abcdef');assert.equal(calls.at(-1).init.redirect,'error');
  checks.push('Key validated against TypeSafe, stored encrypted with 0600, never sent anywhere else');

  respond=()=>json({model:MODEL,answers:answer(.93,'clip:kung-fu-punch',.88,'none'),usage:{input_tokens:412,output_tokens:0}});
  const decision=await instinct.decide({kind:'reply',user:'Can you do kung fu?',reply:"Sure, I'll try a kung fu punch!",clips,character:'Tia'});
  assert.equal(decision.suggestion,'clip:kung-fu-punch');assert.equal(instinct.status().answered,1);assert.equal(instinct.status().inputTokens,412);
  assert.equal(await instinct.decide({kind:'listen',partial:'too short'}),null);assert.equal(await instinct.decide({kind:'shell',reply:'x'}),null);assert.equal(await instinct.decide(null),null);
  const before=calls.length;respond=()=>json({},529);
  for(let i=0;i<3;i++)assert.equal(await instinct.decide({kind:'reply',user:'',reply:'Hello there',clips}),null);
  assert.equal(calls.length,before+3,'never retries inside a voice turn');assert.equal(instinct.status().state,'paused');
  assert.equal(await instinct.decide({kind:'reply',user:'',reply:'Hello there',clips}),null);assert.equal(calls.length,before+3,'paused: no traffic');
  clock+=31000;respond=()=>{throw Object.assign(Error('aborted'),{name:'TimeoutError'});};
  assert.equal(await instinct.decide({kind:'reply',user:'',reply:'Hello there',clips}),null);assert.match(instinct.status().lastError,/slower/);
  respond=()=>json({answers:null});assert.equal(await instinct.decide({kind:'reply',user:'',reply:'Hello there',clips}),null);
  respond=()=>json({},401);assert.equal(await instinct.decide({kind:'reply',user:'',reply:'Hello there',clips}),null);assert.equal(instinct.status().state,'bad-key');
  instinct.clearKey();assert.equal(instinct.status().state,'off');
  checks.push('Outages, timeouts, malformed answers and a revoked key all resolve to null, pause traffic, and never throw');

  // The companion contract: Instinct only fills parameters the rules already validate.
  const context={console};vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/avatar3d-companion.js'),'utf8').replace(/export /g,'')+'\nglobalThis.reply=replyAvatarAction;globalThis.Companion=CompanionController;',context);
  const installed=new Map(clips.slice(0,4).map(c=>[c.id,c]));
  assert.equal(context.reply('show me something triumphant','Watch this!',undefined,installed),null,'the rules alone miss it');
  assert.equal(context.reply('show me something triumphant','Watch this!','clip:victory-cheer',installed),'clip:victory-cheer');
  assert.equal(context.reply('x','Watch this!','clip:not-installed',installed),null);
  assert.equal(context.reply('dance please',"I'll do a little dance.",undefined,installed),'action:dance');
  assert.equal(context.reply('dance please',"I'll do a little dance.",'veto',installed),null);
  assert.equal(context.reply('wave',"I can't wave right now.",'action:wave',installed),null,'a spoken refusal still outranks Instinct');
  const companion=new context.Companion({random:()=>.99});
  companion.consider('I got the job!','That is wonderful news!','veto',100,{clips:installed,turnID:'a',reaction:'celebration',ranking:{'joyful-sway':.7,'victory-fist-pump':.1}});
  assert.equal(companion.takeReaction(101,installed),'joyful-sway','fit beats chance');
  const grieving=new context.Companion();
  grieving.consider('my dog died','I am so sorry.','veto',100,{clips:installed,turnID:'b',reaction:'celebration'});
  assert.equal(grieving.pendingReaction,null,'the bereavement veto still outranks Instinct');
  checks.push('Companion accepts validated suggestions, vetoes, reactions and rankings; refusals and grief still win');

  const source=fs.readFileSync(path.join(__dirname,'../web/instinct-client.js'),'utf8');
  const {InstinctClient}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  let now=0,asked=[],active=true,reply={ok:true,decision:{kind:'reply',suggestion:'clip:kung-fu-punch'}};
  const client=new InstinctClient({now:()=>now,active:()=>active,decide:async r=>{asked.push(r);return reply;}});
  assert.equal(await client.assistantPartial('t1','u','Sure,',{clips:installed}),null);assert.equal(asked.length,0,'too little text to judge');
  assert.equal((await client.assistantPartial('t1','u',"Sure, I'll try a kung fu",{clips:installed})).suggestion,'clip:kung-fu-punch');
  now+=2000;assert.equal(await client.assistantPartial('t1','u',"Sure, I'll try a kung fu punch for you right now",{clips:installed}),null);assert.equal(asked.length,1,'one early act per turn');
  assert.deepEqual(Object.keys(asked[0].clips[0]).sort(),['aliases','category','id','label']);
  reply={ok:true,decision:{kind:'reply'}};let long='I think that the history of';for(let i=0;i<8;i++){now+=1000;long+=' and another clause';await client.assistantPartial('t9','u',long,{clips:installed});}
  assert.equal(asked.length,5,'at most four early requests per turn');asked=[];
  const {textWeight}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  assert(textWeight('我今天升职了，太开心了')>=12&&textWeight('hello')===5,'Chinese counts by meaning, not by characters');
  reply={ok:true,decision:{kind:'listen',face:'beam'}};assert.equal((await client.userPartial('zh','我今天升职了，太开心了',{history:[]})).face,'beam','a short Chinese line is enough to judge');
  assert.equal(interpretListen({face:{choice:'neutral',confidence:.9}},faces).calm,true);assert.equal(interpretListen({face:{choice:'neutral',confidence:.5}},faces).calm,false);
  reply={ok:true,decision:{kind:'listen',face:'smile'}};
  assert.equal((await client.userPartial('u1','I just got the promotion today',{history:[]})).face,'smile');
  now+=300;assert.equal(await client.userPartial('u1','I just got the promotion today and I am so happy about it',{history:[]}),null,'paced');
  const slow=client.assistantFinal('t2','u','first',{clips:installed}),fast=client.assistantFinal('t2','u','first second',{clips:installed});
  assert.equal((await slow).superseded,true);assert.equal((await fast).superseded,undefined);
  active=false;assert.equal((await client.assistantFinal('t3','u','x',{clips:installed})).decision,null);
  reply={ok:false,error:'x'};active=true;assert.equal((await client.assistantFinal('t4','u','x',{clips:installed})).decision,null);
  checks.push('Renderer pacing: one request in flight, one early act per turn, newer finals supersede, failures mean local rules');

  for(const file of ['electron/main.cjs','electron/preload.cjs','web/avatar.html','web/settings.html'])assert(fs.readFileSync(path.join(__dirname,'..',file),'utf8').includes('instinct'),file);
  console.log('Instinct QA passed:\n- '+checks.join('\n- '));
})().catch(error=>{console.error(error);process.exit(1);});
