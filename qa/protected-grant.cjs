'use strict';
// Exercise the actual macOS keychain-backed store, not a crypto mock.
const {app,safeStorage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),http=require('node:http'),assert=require('node:assert/strict');
const {AvatarAssets}=require('../electron/assets.cjs'),{pack}=require('../tools/build-protected-assets.cjs');
app.whenReady().then(async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'gla-key-grant-'));let server;try{
 assert(safeStorage.isEncryptionAvailable(),'macOS encrypted storage must be available');
 const source=path.join(root,'source'),output=path.join(root,'output');fs.mkdirSync(path.join(source,'runtime/resident'),{recursive:true});fs.mkdirSync(output);
 fs.writeFileSync(path.join(source,'manifest.json'),JSON.stringify({name:'Fixture',renderer:'3d',assetRevision:'v1'}));fs.writeFileSync(path.join(source,'runtime/resident/model.gltf'),'{}');
 const keys={'characters-2026-09':crypto.randomBytes(32).toString('hex')},remote=await pack(source,'fixture','base',{keys},output),pair=crypto.generateKeyPairSync('ed25519');
 const payload=JSON.stringify({version:2,avatars:{fixture:{name:'Fixture',assetRevision:'v1',mac:{base:remote}}}}),envelope=JSON.stringify({payload,signature:crypto.sign(null,Buffer.from(payload),pair.privateKey).toString('base64')});
 const config=path.join(root,'runtime.json'),index=path.join(root,'index.json');fs.writeFileSync(config,JSON.stringify({downloadToken:'test-token',publicKey:pair.publicKey.export({type:'spki',format:'pem'})}));fs.writeFileSync(index,envelope);
 const {createWorker}=await import('../tools/cloud/worker.mjs');let authorizations=0;const worker=createWorker(envelope,remote.parts),env={DOWNLOAD_TOKEN:'test-token',CONTENT_KEYS:JSON.stringify(keys),AVATAR_ASSETS:{get:async name=>({size:fs.statSync(path.join(output,name)).size,body:fs.readFileSync(path.join(output,name))})}};
 server=http.createServer(async(req,res)=>{try{let body='';for await(const part of req)body+=part;if(req.url==='/authorize')authorizations++;const response=await worker.fetch(new Request('https://test.example'+req.url,{method:req.method,headers:req.headers,...(body?{body}: {})}),env);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch{res.writeHead(500);res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const options={bundledRoot:path.join(root,'bundle'),downloadsRoot:path.join(root,'downloads'),bundledIndexPath:index,runtimeConfigPath:config,safeStorage,baseURL:'http://127.0.0.1:'+server.address().port+'/',allowLocal:true};
 const first=new AvatarAssets(options);await Promise.all([first.ensureKeys(),first.ensureKeys()]);assert.equal(authorizations,1,'Concurrent requests share one authorization');assert(!fs.readFileSync(first.keyFile).includes(Buffer.from(Object.values(keys)[0])),'Content key is never stored as plaintext');
 await first.download('fixture','base');assert(first.installed('fixture'));await new Promise(r=>server.close(r));server=null;
 const offline=new AvatarAssets(options);assert(offline.installed('fixture'));assert.equal(offline.manifest('fixture').assetRevision,'v1');await offline.ensureKeys();assert.equal(authorizations,1,'Offline restart unlocks from macOS storage');
 console.log('Live key wrapping, macOS encrypted storage, encrypted download and offline restart passed.');
 }catch(e){console.error(e);process.exitCode=1;}finally{server?.close();fs.rmSync(root,{recursive:true,force:true});app.exit(process.exitCode||0);}});
