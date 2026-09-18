'use strict';
// The in-app updater, with the network, the macOS tools and the helper process
// faked: every way an installer can be wrong must end with the download gone
// and the installed app untouched.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {Updater,bundleOf}=require('../electron/updater.cjs');
const BASE='https://downloads.example/releases/',installer=crypto.randomBytes(300000),sha=crypto.createHash('sha256').update(installer).digest('hex');
const release=(over={})=>({version:'0.3.0',downloadURL:BASE+'gpt-live-avatar-0.3.0-arm64.dmg',sha256:sha,bytes:installer.length,...over});
const body=(bytes,chunk=65536)=>{let i=0;return {getReader:()=>({read:async()=>i>=bytes.length?{done:true}:{done:false,value:bytes.subarray(i,i+=chunk)},cancel:async()=>{}})};};
const serve=bytes=>async()=>({ok:true,status:200,body:body(bytes)});
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'gla-updater-'));
 try{
  assert.equal(bundleOf('/Applications/GPT-Live Avatar.app/Contents/MacOS/GPT-Live Avatar'),'/Applications/GPT-Live Avatar.app');assert.equal(bundleOf('/usr/local/bin/node'),'');
  const make=(over={})=>new Updater({directory:path.join(temp,'updates'),currentVersion:'0.2.23',arch:'arm64',releaseBase:BASE,fetchImpl:serve(installer),home:temp,pid:4242,...over});
  // ---- what is refused before a single byte is requested
  let asked=0;const silent=make({fetchImpl:async()=>{asked++;return {ok:true,body:body(installer)};}});
  for(const [bad,why] of [[release({version:'0.2.23',downloadURL:BASE+'gpt-live-avatar-0.2.23-arm64.dmg'}),/not newer/],[release({downloadURL:'https://evil.example/gpt-live-avatar-0.3.0-arm64.dmg'}),/official release service/],
   [release({downloadURL:BASE+'gpt-live-avatar-0.3.1-arm64.dmg'}),/official release service/],[release({sha256:''}),/checksum/],[release({bytes:0}),/checksum/],[release({bytes:3*1024*1024*1024}),/checksum/]])
   await assert.rejects(silent.download(bad),why);
  assert.equal(asked,0,'nothing is fetched for a release that cannot be trusted');
  // ---- download: exact bytes and checksum, or nothing is kept
  const progress=[];const file=await make().download(release(),{onProgress:p=>progress.push(p.percent)});
  assert.deepEqual(fs.readFileSync(file),installer);assert.equal(progress.at(-1),100);assert(progress.length>2,'progress is reported as it downloads');assert(!fs.existsSync(file+'.part'));
  const tampered=Buffer.from(installer);tampered[1000]^=1;
  await assert.rejects(make({fetchImpl:serve(tampered)}).download(release()),/did not match the published checksum/);
  await assert.rejects(make({fetchImpl:serve(installer.subarray(0,1000))}).download(release()),/incomplete/);
  await assert.rejects(make({fetchImpl:serve(Buffer.concat([installer,Buffer.from('x')]))}).download(release()),/larger than the published/);
  await assert.rejects(make({fetchImpl:async()=>({ok:false,status:404,body:{cancel:async()=>{}}})}).download(release()),/HTTP 404/);
  assert.deepEqual(fs.readdirSync(path.join(temp,'updates')),[],'a rejected download leaves no file, partial or whole');
  // ---- verify: the image is ours only if every check says so
  const own={team:'TEAM123456',identifier:'com.adamcohen.gptliveavatar'};
  const tools=(over={})=>{const calls=[];const answers={team:own.team,identifier:own.identifier,gate:'accepted\nsource=Notarized Developer ID',version:'0.3.0',valid:true,...over};
   const run=async(cmd,args)=>{calls.push(cmd+' '+args.join(' '));
    if(cmd==='hdiutil'&&args[0]==='attach'){const mount=args[args.indexOf('-mountpoint')+1];if(answers.app!==false){fs.mkdirSync(path.join(mount,'GPT-Live Avatar.app/Contents'),{recursive:true});fs.writeFileSync(path.join(mount,'GPT-Live Avatar.app/Contents/Info.plist'),'');}return {stdout:'',stderr:''};}
    if(cmd==='hdiutil')return {stdout:'',stderr:''};
    if(cmd==='codesign'&&args[0]==='--verify'){if(!answers.valid)throw Error('invalid');return {stdout:'',stderr:''};}
    if(cmd==='codesign')return {stdout:'',stderr:`Identifier=${answers.identifier}\nTeamIdentifier=${answers.team}\n`};
    if(cmd==='spctl'){if(answers.gate==='rejected')throw Error('rejected');return {stdout:'',stderr:answers.gate};}
    if(cmd==='/usr/libexec/PlistBuddy')return {stdout:answers.version+'\n',stderr:''};
    if(cmd==='ditto'){fs.mkdirSync(args[1],{recursive:true});return {stdout:'',stderr:''};}
    throw Error('unexpected tool '+cmd);};return {run,calls};};
  for(const [over,why] of [[{app:false},/does not contain/],[{valid:false},/signature is not valid/],[{team:'OTHERTEAM1'},/not signed by the developer/],[{identifier:'com.someone.else'},/not signed by the developer/],
   [{gate:'rejected'},/notarized/],[{gate:'accepted\nsource=Developer ID'},/notarized/],[{version:'0.2.99'},/not the announced/]]){
   const t=tools(over),again=await make().download(release());
   await assert.rejects(make({run:t.run,identity:own}).verify(again,release()),why);
   assert(!fs.existsSync(again),'a refused installer is deleted: '+why);assert(t.calls.some(c=>c.startsWith('hdiutil detach')),'and its image is unmounted');
  }
  const good=tools(),kept=await make().download(release()),checker=make({run:good.run,identity:own}),verified=await checker.verify(kept,release());
  assert.equal(verified.version,'0.3.0');assert(good.calls.some(c=>/^hdiutil attach -nobrowse -readonly -noautoopen -mountpoint /.test(c)),'mounted read-only, out of sight');
  assert.deepEqual(good.calls.filter(c=>/^(codesign|spctl|\/usr)/.test(c)).map(c=>c.split(' ').slice(0,2).join(' ')),['codesign --verify','codesign -dv','spctl -a','/usr/libexec/PlistBuddy -c'],'signature, signer, Gatekeeper, then version');
  // an unsigned development run has no identity to compare against
  await assert.rejects(make({run:async()=>({stdout:'',stderr:'Identifier=x\nTeamIdentifier=not set\n'}),execPath:'/tmp/Dev.app/Contents/MacOS/Dev'}).ownIdentity(),/not signed/);
  // ---- stage and install: only the installed app, only where it can write, and the old bundle goes to the Trash
  await assert.rejects(make({run:good.run,identity:own,isPackaged:false}).stage({...verified,detach:async()=>{}}),/development run/);
  await assert.rejects(make({run:good.run,identity:own,isPackaged:true,execPath:'/opt/thing/bin/app'}).stage({...verified,detach:async()=>{}}),/cannot replace itself/);
  const apps=path.join(temp,'Applications');fs.mkdirSync(path.join(apps,'GPT-Live Avatar.app/Contents/MacOS'),{recursive:true});
  const spawned=[];let detached=0;const installerRun=make({run:good.run,identity:own,isPackaged:true,execPath:path.join(apps,'GPT-Live Avatar.app/Contents/MacOS/GPT-Live Avatar'),spawn:(cmd,args,options)=>{spawned.push({cmd,args,options});return {unref(){}};}});
  const staging=await installerRun.stage({...verified,detach:async()=>{detached++;}});
  assert.equal(staging.target,path.join(apps,'GPT-Live Avatar.app'));assert.equal(path.dirname(staging.staged),apps,'staged on the same volume, beside the app');assert.equal(detached,1,'the image is released once the copy is made');
  assert(good.calls.some(c=>c.startsWith('ditto ')));assert.equal(good.calls.filter(c=>c.startsWith('codesign --verify')).length,2,'the copy is verified again');
  fs.chmodSync(apps,0o555);await assert.rejects(installerRun.stage({...verified,detach:async()=>{}}),/cannot write to/);fs.chmodSync(apps,0o755);
  const done=await installerRun.install(staging);
  assert.equal(spawned.length,1);assert.equal(spawned[0].cmd,'/bin/sh');assert.deepEqual(spawned[0].args.slice(1,4),['4242',staging.target,staging.staged]);assert.equal(spawned[0].options.detached,true);
  assert(done.old.startsWith(path.join(temp,'.Trash','GPT-Live Avatar 0.2.23 ')),'the old app is kept in the Trash, not deleted');
  const script=fs.readFileSync(done.script,'utf8');assert.match(script,/kill -0 "\$pid"/,'waits for this app to quit');assert.match(script,/mv "\$old" "\$target"/,'puts the old app back if the new one cannot move in');assert.doesNotMatch(script,/rm -/,'never deletes');
  assert.equal(fs.statSync(done.script).mode&0o777,0o700);
  console.log('Updater: untrusted releases refused before download, exact-bytes and checksum downloads, signature/team/notarization/version verification, staged swap with the old app kept in the Trash.');
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
