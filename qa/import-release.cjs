'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {importRelease}=require('../tools/import-release.cjs');
const {verifyRelease}=require('../tools/verify-release.cjs');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'avatar-import-')),pair=crypto.generateKeyPairSync('ed25519'),runtime={downloadToken:'fixture-download-only',publicKey:pair.publicKey.export({type:'spki',format:'pem'})};
 const names={tia:'Tia',sarah:'Sarah'};
 function clone(name,slug='sarah'){const repo=path.join(root,name);fs.mkdirSync(path.join(repo,'electron'),{recursive:true});fs.writeFileSync(path.join(repo,'electron/default-avatar.json'),JSON.stringify({slug,name:names[slug]}));fs.writeFileSync(path.join(repo,'electron/asset-download.json'),JSON.stringify({baseURL:'https://fixture.invalid/'}));return repo;}
 function sign(resources,index){const payload=JSON.stringify(index);fs.writeFileSync(path.join(resources,'assets-index.json'),JSON.stringify({payload,signature:crypto.sign(null,Buffer.from(payload),pair.privateKey).toString('base64')}));}
 function packageEntry(bytes){return {format:'gla-pack-v1',bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};}
 function fixture(name,slugs,motions=true,catalogueSlugs=slugs){
  const bundle=path.join(root,name+'.app'),resources=path.join(bundle,'Contents/Resources'),index={version:2,avatars:{}};fs.mkdirSync(resources,{recursive:true});
  fs.writeFileSync(path.join(resources,'assets-runtime.json'),JSON.stringify(runtime));fs.writeFileSync(path.join(resources,'personal-secret.bin'),'must not copy');
  for(const slug of catalogueSlugs){const base=Buffer.from('opaque encrypted '+slug+' base fixture'),motion=Buffer.from('opaque encrypted '+slug+' motion fixture');index.avatars[slug]={name:names[slug],mac:{base:packageEntry(base)},...(motions?{motionUpdate:{revision:'motion-v1',package:packageEntry(motion)}}:{})};if(slugs.includes(slug)){const folder=path.join(resources,'avatars',slug);fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'base.gla'),base);if(motions)fs.writeFileSync(path.join(folder,'motions.gla'),motion);}}
  sign(resources,index);return {bundle,resources,index};
 }
 try{
  const current=fixture('Current',['sarah'],true,['tia','sarah']),destination=clone('current-clone'),result=await importRelease(current.bundle,destination);
  assert.equal(result.characters,2);assert.equal(result.defaultStarterAvailable,true);assert.deepEqual(result.bundled,[{slug:'sarah',name:'Sarah'}]);assert.equal(result.requiredStarter.slug,'sarah');
  for(const file of ['base.gla','motions.gla']){const source=path.join(current.resources,'avatars/sarah',file),output=path.join(destination,'build/protected/starter/sarah',file),development=path.join(destination,'build/assets/bundle/sarah',file);assert(fs.readFileSync(output).equals(fs.readFileSync(source)));assert.equal(fs.statSync(output).ino,fs.statSync(development).ino,'Development reuses the exact encrypted package');}
  assert(!fs.existsSync(path.join(destination,'build/protected/personal-secret.bin')));assert(!fs.existsSync(path.join(destination,'build/assets/bundle/tia')),'Default import never invents another starter');
  assert.equal((await verifyRelease(destination)).starter.slug,'sarah');await importRelease(current.bundle,destination);
  const legacy=fixture('Legacy',['tia'],false,['tia','sarah']),legacyClone=clone('legacy-clone'),legacyResult=await importRelease(legacy.bundle,legacyClone);
  assert.equal(legacyResult.defaultStarterAvailable,false,'Legacy import explicitly reports missing current starter');assert.deepEqual(legacyResult.bundled,[{slug:'tia',name:'Tia'}]);assert(fs.existsSync(path.join(legacyClone,'build/protected/starter/tia/base.gla')));assert(!fs.existsSync(path.join(legacyClone,'build/protected/starter/sarah')),'Tia ciphertext must never be relabeled Sarah');await assert.rejects(verifyRelease(legacyClone),/Sarah starter is missing/);
  fs.writeFileSync(path.join(legacyClone,'electron/default-avatar.json'),JSON.stringify({slug:'tia',name:'Tia'}));assert.equal((await verifyRelease(legacyClone)).starter.slug,'tia','Verifier follows metadata rather than a hardcoded name');
  const mixed=fixture('Mixed',['tia','sarah']),mixedClone=clone('mixed-clone'),mixedResult=await importRelease(mixed.bundle,mixedClone);assert.deepEqual(mixedResult.bundled.map(s=>s.slug),['sarah','tia']);assert.equal(mixedResult.defaultStarterAvailable,true);for(const slug of ['sarah','tia'])assert.equal(fs.statSync(path.join(mixedClone,'build/protected/starter',slug,'base.gla')).ino,fs.statSync(path.join(mixedClone,'build/assets/bundle',slug,'base.gla')).ino);
  const oldest=fixture('Oldest',['tia'],false),oldestClone=clone('oldest-clone');await importRelease(oldest.bundle,oldestClone);await assert.rejects(verifyRelease(oldestClone),/no Sarah entry/);
  async function rejectsWithoutCopy(name,pattern){const target=clone(name);await assert.rejects(importRelease(current.bundle,target),pattern);assert(!fs.existsSync(path.join(target,'build')),'Failed validation must not copy any resources');}
  const baseFile=path.join(current.resources,'avatars/sarah/base.gla'),base=fs.readFileSync(baseFile),motionFile=path.join(current.resources,'avatars/sarah/motions.gla'),motion=fs.readFileSync(motionFile),runtimeFile=path.join(current.resources,'assets-runtime.json');
  fs.writeFileSync(motionFile,Buffer.alloc(motion.length));await rejectsWithoutCopy('bad-motion',/motion checksum/);fs.writeFileSync(motionFile,motion);
  fs.unlinkSync(motionFile);await rejectsWithoutCopy('missing-motion',/motion starter is missing/);fs.writeFileSync(motionFile,motion);
  fs.writeFileSync(baseFile,Buffer.alloc(base.length));await rejectsWithoutCopy('bad-base',/Sarah checksum/);fs.writeFileSync(baseFile,base);
  fs.writeFileSync(runtimeFile,JSON.stringify({...runtime,keys:{example:'never import content keys'}}));await rejectsWithoutCopy('secret-rejected',/private or unsupported/);fs.writeFileSync(runtimeFile,JSON.stringify(runtime));
  const signedFile=path.join(current.resources,'assets-index.json'),signed=fs.readFileSync(signedFile);fs.writeFileSync(signedFile,JSON.stringify({payload:JSON.stringify(current.index),signature:Buffer.alloc(64).toString('base64')}));await rejectsWithoutCopy('signature-rejected',/signature/);fs.writeFileSync(signedFile,signed);
  const protectedBase=path.join(destination,'build/protected/starter/sarah/base.gla');fs.writeFileSync(protectedBase,Buffer.alloc(base.length));await assert.rejects(verifyRelease(destination),/Sarah checksum/);fs.writeFileSync(protectedBase,base);
  fs.writeFileSync(path.join(destination,'build/protected/assets-runtime.json'),'existing developer configuration');await assert.rejects(importRelease(current.bundle,destination),/Different resources/);assert.equal(fs.readFileSync(path.join(destination,'build/protected/assets-runtime.json'),'utf8'),'existing developer configuration');
  const conflict=clone('development-conflict'),conflictFile=path.join(conflict,'build/assets/bundle/sarah/motions.gla');fs.mkdirSync(path.dirname(conflictFile),{recursive:true});fs.writeFileSync(conflictFile,'independent developer package');await assert.rejects(importRelease(current.bundle,conflict),/Different resources/);assert(!fs.existsSync(path.join(conflict,'build/protected')),'Development conflict is checked before copying protected resources');assert.equal(fs.readFileSync(conflictFile,'utf8'),'independent developer package');
  console.log('Release import: Sarah default, legacy/multiple starter identity, metadata-driven build verification, complete checksums, shared encrypted development resources, no secrets, and conflict preservation passed.');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
