'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {importRelease}=require('../tools/import-release.cjs');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'avatar-import-')),bundle=path.join(root,'Fixture.app'),resources=path.join(bundle,'Contents/Resources'),destination=path.join(root,'clone');
 try{
  fs.mkdirSync(path.join(resources,'avatars/tia'),{recursive:true});
  const starter=path.join(resources,'avatars/tia/base.gla'),bytes=Buffer.from('opaque encrypted fixture');fs.writeFileSync(starter,bytes);
  const pair=crypto.generateKeyPairSync('ed25519'),runtime={downloadToken:'fixture-download-only',publicKey:pair.publicKey.export({type:'spki',format:'pem'})};
  const payload=JSON.stringify({version:2,avatars:{tia:{mac:{base:{format:'gla-pack-v1',bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}}}}});
  fs.writeFileSync(path.join(resources,'assets-index.json'),JSON.stringify({payload,signature:crypto.sign(null,Buffer.from(payload),pair.privateKey).toString('base64')}));
  const runtimeFile=path.join(resources,'assets-runtime.json');fs.writeFileSync(runtimeFile,JSON.stringify(runtime));
  fs.writeFileSync(path.join(resources,'personal-secret.bin'),'must not copy');
  assert.equal((await importRelease(bundle,destination)).characters,1);
  const output=path.join(destination,'build/protected/starter/tia/base.gla'),development=path.join(destination,'build/assets/bundle/tia/base.gla');
  assert(fs.readFileSync(output).equals(bytes));assert.equal(fs.statSync(output).ino,fs.statSync(development).ino);assert(!fs.existsSync(path.join(destination,'build/protected/personal-secret.bin')));
  await importRelease(bundle,destination);assert(fs.readFileSync(output).equals(bytes),'Identical re-import is safe');
  const motions=Buffer.from('opaque encrypted motion fixture'),motionFile=path.join(resources,'avatars/tia/motions.gla');fs.writeFileSync(motionFile,motions);
  const updated=JSON.parse(payload);updated.avatars.tia.motionUpdate={revision:'motion-v1',package:{format:'gla-pack-v1',bytes:motions.length,sha256:crypto.createHash('sha256').update(motions).digest('hex')}};
  const newPayload=JSON.stringify(updated);fs.writeFileSync(path.join(resources,'assets-index.json'),JSON.stringify({payload:newPayload,signature:crypto.sign(null,Buffer.from(newPayload),pair.privateKey).toString('base64')}));
  const newClone=path.join(root,'motion-clone');await importRelease(bundle,newClone);
  const mo=path.join(newClone,'build/protected/starter/tia/motions.gla'),md=path.join(newClone,'build/assets/bundle/tia/motions.gla');assert(fs.readFileSync(mo).equals(motions));assert.equal(fs.statSync(mo).ino,fs.statSync(md).ino);
  fs.writeFileSync(motionFile,Buffer.alloc(motions.length));await assert.rejects(importRelease(bundle,path.join(root,'bad-motion')),/motion checksum/);assert(!fs.existsSync(path.join(root,'bad-motion')));fs.writeFileSync(motionFile,motions);
  fs.writeFileSync(runtimeFile,JSON.stringify({...runtime,keys:{example:'never import content keys'}}));await assert.rejects(importRelease(bundle,path.join(root,'secret-rejected')),/private or unsupported/);assert(!fs.existsSync(path.join(root,'secret-rejected')));fs.writeFileSync(runtimeFile,JSON.stringify(runtime));
  fs.writeFileSync(starter,Buffer.alloc(bytes.length));await assert.rejects(importRelease(bundle,path.join(root,'tamper-rejected')),/checksum/);assert(fs.readFileSync(output).equals(bytes));fs.writeFileSync(starter,bytes);
  fs.writeFileSync(path.join(destination,'build/protected/assets-runtime.json'),'existing developer configuration');await assert.rejects(importRelease(bundle,destination),/Different resources/);assert.equal(fs.readFileSync(path.join(destination,'build/protected/assets-runtime.json'),'utf8'),'existing developer configuration');
  console.log('Release import: ciphertext integrity, shared development starter, idempotency, no personal/secret files and conflict preservation passed.');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
