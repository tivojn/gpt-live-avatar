'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),http=require('node:http'),assert=require('node:assert/strict');
const {pack,hash}=require('../tools/build-protected-assets.cjs'),{ProtectedPackage}=require('../electron/protected-assets.cjs'),{AvatarAssets}=require('../electron/assets.cjs');
(async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'gla-protected-'));let server;try{
 const source=path.join(root,'source'),output=path.join(root,'output'),downloads=path.join(root,'downloads'),bundled=path.join(root,'bundle');for(const p of [source,output,downloads,bundled])fs.mkdirSync(p,{recursive:true});
 fs.mkdirSync(path.join(source,'runtime/resident'),{recursive:true});fs.writeFileSync(path.join(source,'manifest.json'),JSON.stringify({name:'Fixture',renderer:'3d',assetRevision:'test-v1'}));const original=crypto.randomBytes(2*1024*1024+40);fs.writeFileSync(path.join(source,'runtime/resident/mesh.bin'),original);fs.writeFileSync(path.join(source,'runtime/resident/model.gltf'),'{}');
 const keys={'characters-2026-09':crypto.randomBytes(32).toString('hex')},remote=await pack(source,'fixture','base',{keys},output),file=path.join(output,remote.file),reader=new ProtectedPackage(file,keys);assert(reader.read('runtime/resident/mesh.bin').equals(original));
 const chunks=[];for await(const b of reader.stream('runtime/resident/mesh.bin',1048500,1048700))chunks.push(b);assert(Buffer.concat(chunks).equals(original.subarray(1048500,1048701)),'Range crosses authenticated chunk boundary');
 const changed=fs.readFileSync(file);changed[changed.length-20]^=1;const bad=path.join(output,'bad.gla');fs.writeFileSync(bad,changed);assert.throws(()=>new ProtectedPackage(bad,keys).read('runtime/resident/model.gltf'));
 assert.throws(()=>new ProtectedPackage(file,{'characters-2026-09':crypto.randomBytes(32).toString('hex')}),/authentication/);
 const pair=crypto.generateKeyPairSync('ed25519'),publicKey=pair.publicKey.export({type:'spki',format:'pem'}),catalogue={version:2,avatars:{fixture:{name:'Fixture',assetRevision:'test-v1',mac:{base:remote}}}},payload=JSON.stringify(catalogue),envelope=JSON.stringify({payload,signature:crypto.sign(null,Buffer.from(payload),pair.privateKey).toString('base64')});
 const config=path.join(root,'keys.json');fs.writeFileSync(config,JSON.stringify({keys,publicKey,downloadToken:'test-token'}));const index=path.join(root,'index.json');fs.writeFileSync(index,envelope);let corrupt=false,slow=false;
 server=http.createServer((req,res)=>{if(req.headers.authorization!=='Bearer test-token'){res.writeHead(401);res.end();return;}if(req.url==='/index.json'){res.end(envelope);return;}const p=remote.parts.find(x=>'/'+x.file===req.url);if(!p){res.writeHead(404);res.end();return;}const b=fs.readFileSync(path.join(output,p.file));if(corrupt)b[b.length-1]^=1;if(slow){res.write(b.subarray(0,50));const timer=setTimeout(()=>res.end(b.subarray(50)),1000);res.on('close',()=>clearTimeout(timer));}else res.end(b);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const assets=new AvatarAssets({bundledRoot:bundled,downloadsRoot:downloads,bundledIndexPath:index,runtimeConfigPath:config,baseURL:'http://127.0.0.1:'+server.address().port+'/',allowLocal:true});await assets.refreshIndex();await assets.download('fixture','base');assert(assets.installed('fixture'));assert.equal(assets.manifest('fixture').assetRevision,'test-v1');assert.deepEqual(fs.readdirSync(path.join(downloads,'fixture')),['base.gla']);assert(assets.read(assets.resolve(assets.roots('fixture'),'runtime/resident/mesh.bin')).equals(original));
 // Every protected network path uses the supplied transport, including the
 // device-key grant. Real fixture bytes still pass the normal signed checks.
 assert.equal(assets.fetcher,globalThis.fetch,'Node tools keep the default fetch');
 const injectedConfig=path.join(root,'injected-runtime.json');fs.writeFileSync(injectedConfig,JSON.stringify({publicKey,downloadToken:'test-token'}));
 const requestsSeen=[],baseURL='http://127.0.0.1:'+server.address().port+'/';
 const fetcher=async(url,init)=>{
  const pathname=new URL(url).pathname;
  assert.equal(new URL(url).origin,new URL(baseURL).origin);
  assert.equal(init.redirect,'error','The transport must not follow redirects');
  assert.equal(init.cache,'no-store','Protected content bypasses and is not saved in the HTTP cache');
  assert(init.signal instanceof AbortSignal,'Timeout/cancellation reaches the transport');
  assert.equal(init.headers.Authorization||init.headers.authorization,'Bearer test-token');
  requestsSeen.push({pathname,method:init.method||'GET'});
  if(pathname==='/authorize'){
   assert.equal(init.method,'POST');
   const device=crypto.createPublicKey({key:Buffer.from(JSON.parse(init.body).publicKey,'base64'),type:'spki',format:'der'});
   const wrappedKeys=crypto.publicEncrypt({key:device,oaepHash:'sha256',padding:crypto.constants.RSA_PKCS1_OAEP_PADDING},Buffer.from(JSON.stringify(keys))).toString('base64');
   return new Response(JSON.stringify({wrappedKeys}));
  }
  return globalThis.fetch(url,init);
 };
 const injected=new AvatarAssets({bundledRoot:bundled,downloadsRoot:path.join(root,'injected-downloads'),bundledIndexPath:index,runtimeConfigPath:injectedConfig,baseURL,allowLocal:true,fetcher,
  safeStorage:{isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()}});
 assert.equal(injected.fetcher,fetcher);await injected.refreshIndex();await injected.download('fixture','base');
 assert(injected.read(injected.resolve(injected.roots('fixture'),'runtime/resident/mesh.bin')).equals(original));
 assert.equal(requestsSeen.filter(r=>r.pathname==='/authorize'&&r.method==='POST').length,1);
 assert(requestsSeen.some(r=>r.pathname==='/index.json'));
 assert(remote.parts.every(p=>requestsSeen.some(r=>r.pathname==='/'+p.file)));
 const callsBeforeInvalid=requestsSeen.length;
 await assert.rejects(injected.response('https://outside.example/part.gla.p000',new AbortController().signal),/not configured/);
 assert.equal(requestsSeen.length,callsBeforeInvalid,'Origin rejection happens before the transport');
 console.log('Injected asset transport covers authorization, catalogue and verified downloads, preserving no-store, redirect, origin and abort options.');
 const before=await hash(path.join(downloads,'fixture/base.gla'));corrupt=true;await assert.rejects(assets.download('fixture','base'),/verification/);assert.equal(await hash(path.join(downloads,'fixture/base.gla')),before,'A corrupt download preserves the installed revision');corrupt=false;slow=true;const pending=assets.download('fixture','base');setTimeout(()=>assets.cancel(),30);await assert.rejects(pending);assert.equal(await hash(path.join(downloads,'fixture/base.gla')),before);assert.deepEqual(fs.readdirSync(path.join(downloads,'tmp')),[]);
 // A motion-only update preserves the model/texture revision and cannot
 // override other files. Existing clients can still use the unchanged mac tiers.
 slow=false;fs.mkdirSync(path.join(source,'runtime/motions'),{recursive:true});fs.writeFileSync(path.join(source,'runtime/motions/library.json'),JSON.stringify({clips:[],motionRevision:'motion-v1'}));
 const motion=await pack(source,'fixture','motions',{keys},output,'motion-v1'),motionPack=new ProtectedPackage(path.join(output,motion.file),keys);
 assert([...motionPack.entries.keys()].every(n=>n.startsWith('runtime/motions/')));assert.equal(motionPack.meta.assetRevision,'test-v1');
 catalogue.avatars.fixture.motionUpdate={revision:'motion-v1',package:motion};
 const signedMotion=JSON.stringify(catalogue),newEnvelope=JSON.stringify({payload:signedMotion,signature:crypto.sign(null,Buffer.from(signedMotion),pair.privateKey).toString('base64')});
 assets.index=assets.parseIndex(newEnvelope);assert(!assets.hasTier('fixture','motions'));
 const response=assets.response.bind(assets);assets.response=async url=>{const part=motion.parts.find(p=>url.endsWith('/'+p.file));return part?new Response(fs.readFileSync(path.join(output,part.file))):response(url);};
 await assets.download('fixture','motions');assert(assets.hasTier('fixture','motions'));assert.equal(JSON.parse(assets.read(assets.resolve(assets.roots('fixture'),'runtime/motions/library.json'))).motionRevision,'motion-v1');
 assert.equal(await hash(path.join(downloads,'fixture/base.gla')),before,'Motion update does not redownload or alter the model');
 assert(assets.read(assets.resolve(assets.roots('fixture'),'runtime/resident/mesh.bin')).equals(original));
 await assets.remove('fixture','motions');assert(!assets.hasTier('fixture','motions'));await assets.download('fixture','base');assert(assets.hasTier('fixture','motions'),'First avatar download also gets current motions');
 assets.index.avatars.fixture.motionUpdate.revision='motion-v2';await assert.rejects(assets.download('fixture','motions'),/does not match/);assets.index.avatars.fixture.motionUpdate.revision='motion-v1';
 // A bundled starter may have only the motion update in its download folder.
 const starter=path.join(bundled,'fixture');fs.mkdirSync(starter,{recursive:true});
 fs.renameSync(path.join(downloads,'fixture/base.gla'),path.join(starter,'base.gla'));assets.packages.clear();
 assert(assets.hasTier('fixture','motions'),'Motion-only cache remains visible with a bundled base');
 assert.equal(JSON.parse(assets.read(assets.resolve(assets.roots('fixture'),'runtime/motions/library.json'))).motionRevision,'motion-v1');
 fs.renameSync(path.join(starter,'base.gla'),path.join(downloads,'fixture/base.gla'));assets.packages.clear();
 console.log('Motion-only overlays, revision checks, atomic install, removal and automatic first-download updates passed.');
 const invalid=JSON.parse(envelope);invalid.payload=invalid.payload.replace('Fixture','Hacked');assert.throws(()=>assets.parseIndex(JSON.stringify(invalid)),/signature/);
 const stale=path.join(bundled,'fixture');fs.mkdirSync(path.join(stale,'runtime/resident'),{recursive:true});fs.writeFileSync(path.join(stale,'manifest.json'),JSON.stringify({assetRevision:'old'}));fs.writeFileSync(path.join(stale,'runtime/resident/image-0-4096.png'),'stale');assert.equal(assets.resolve(assets.roots('fixture'),'runtime/resident/image-0-4096.png'),null,'Old plaintext textures cannot overlay an encrypted revision');assert.equal(assets.hasTier('fixture','best'),false);
 const {createWorker}=await import('../tools/cloud/worker.mjs');const worker=createWorker(envelope,remote.parts);let reads=0;const env={DOWNLOAD_TOKEN:'test-token',AVATAR_ASSETS:{get:async()=>{reads++;return {size:remote.parts[0].bytes,body:'data'};}}},url='https://downloads.example/'+remote.parts[0].file,auth={Authorization:'Bearer test-token'};
 assert.equal((await worker.fetch(new Request(url),env)).status,401);assert.equal((await worker.fetch(new Request(url,{method:'HEAD',headers:auth}),env)).status,200);assert.equal(reads,0);const partResponse=await worker.fetch(new Request(url,{headers:auth}),env);assert.equal(partResponse.status,200);assert.equal(partResponse.headers.get('Vary'),'Authorization');assert.equal(reads,1);await worker.fetch(new Request('https://downloads.example/not-found',{headers:auth}),env);assert.equal(reads,1);const catalogueResponse=await worker.fetch(new Request('https://downloads.example/index.json',{headers:auth}),env);assert.equal(catalogueResponse.headers.get('Vary'),'Authorization');assert.equal(reads,1);
 console.log('Encrypted round trips, authenticated ranges, tampering, signed catalogues, download integrity, cancellation, atomic replacement and one-read gateway passed.');
 const {plan}=require('../tools/cloud/upload-r2.cjs');const storage={objects:[...remote.parts,{file:'index.json',bytes:100,sha256:'0'.repeat(64)}]};
 assert.equal(plan(storage,[{name:'bucket',objects:[]}],'bucket').missing.length,storage.objects.length);
 assert.throws(()=>plan(storage,[{name:'another-bucket',objects:[{key:'other',size:10_000_000_000,storage_class:'Standard'}]}],'bucket'),/cap/);
 assert.throws(()=>plan({objects:[{file:'private-build.json',bytes:100,sha256:'0'.repeat(64)}]},[],'bucket'),/protected/);
 const device=crypto.generateKeyPairSync('rsa',{modulusLength:2048});env.CONTENT_KEYS=JSON.stringify(keys);
 const grant=await worker.fetch(new Request('https://downloads.example/authorize',{method:'POST',headers:auth,body:JSON.stringify({publicKey:device.publicKey.export({type:'spki',format:'der'}).toString('base64')})}),env);
 assert.equal(grant.status,200);const grantBody=await grant.json();assert.deepEqual(JSON.parse(crypto.privateDecrypt({key:device.privateKey,oaepHash:'sha256',padding:crypto.constants.RSA_PKCS1_OAEP_PADDING},Buffer.from(grantBody.wrappedKeys,'base64'))),keys);assert.equal(reads,1,'Key authorization does not read R2');
 assert.equal((await worker.fetch(new Request('https://downloads.example/authorize',{method:'POST',headers:auth,body:'x'.repeat(2049)}),env)).status,413);
 console.log('Account-wide storage cap, upload allowlist and device-wrapped content key authorization passed.');
 const {createR2Reader}=await import('../tools/cloud/r2-reader.mjs');let requests=0,lastRequest,storageStatus=200;
 const cross=createR2Reader({R2_STORAGE_ACCOUNT:'a'.repeat(32),R2_BUCKET:'test-private',R2_READ_ACCESS_KEY_ID:'test-access',R2_READ_SECRET_ACCESS_KEY:'test-secret'},async request=>{requests++;lastRequest=request;return new Response('data',{status:storageStatus,headers:{'Content-Length':'4'}});});
 const object=await cross.get('fixture-base.gla.p000');assert.equal(object.size,4);assert.equal(requests,1);assert.equal(lastRequest.method,'GET');assert.equal(lastRequest.redirect,'manual');assert.equal(new URL(lastRequest.url).search,'');assert.match(lastRequest.headers.get('Authorization'),/^AWS4-HMAC-SHA256 /);assert.equal(await new Response(object.body).text(),'data');
 storageStatus=503;await assert.rejects(cross.get('fixture-base.gla.p000'));assert.equal(requests,2,'Transient failures never cause hidden R2 retries');await assert.rejects(cross.get('../secret'));assert.equal(requests,2,'Invalid paths never reach storage');
 console.log('Private cross-account S3 signing, streaming, no redirects and one-read failure limit passed.');
 }finally{server?.close();fs.rmSync(root,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
