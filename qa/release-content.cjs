'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),asar=require('@electron/asar');
(async()=>{
 const repo=path.resolve(__dirname,'..'),bundle=process.argv[2]||path.join(repo,'dist/mac-arm64/GPT-Live Avatar.app'),resources=path.join(bundle,'Contents/Resources'),file=path.join(resources,'app.asar'),list=asar.listPackage(file);
 assert(!list.some(n=>/\.(glb|gltf|blend|gla)$/i.test(n)),'No raw models in source archive');
 const runtime=JSON.parse(fs.readFileSync(path.join(resources,'assets-runtime.json')));assert(!runtime.keys&&!runtime.privateKey);
 assert.equal(JSON.parse(asar.extractFile(file,'package.json')).version,require('../package.json').version);
 function files(p){return fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(p,e.name)):[path.join(p,e.name)]);}
 for(const f of [...files(path.join(repo,'electron')),...files(path.join(repo,'web'))])assert(fs.readFileSync(f).equals(asar.extractFile(file,path.relative(repo,f))),path.relative(repo,f)+' must match packaged source');
 const secrets=JSON.parse(fs.readFileSync(path.join(repo,'build/protected/private-build.json'))),archive=fs.readFileSync(file);
 for(const secret of [secrets.privateKey,...Object.values(secrets.keys)])for(const value of [secret,JSON.stringify(secret).slice(1,-1)])assert(!archive.includes(Buffer.from(value)),'No content or signing keys in packaged source');
 const packs=files(path.join(resources,'avatars'));assert.deepEqual(packs.map(f=>path.relative(resources,f)),['avatars/tia/base.gla']);const signed=JSON.parse(fs.readFileSync(path.join(resources,'assets-index.json')));assert(crypto.verify(null,Buffer.from(signed.payload),runtime.publicKey,Buffer.from(signed.signature,'base64')));
 const tier=JSON.parse(signed.payload).avatars.tia.mac.base,digest=crypto.createHash('sha256');for await(const b of fs.createReadStream(packs[0]))digest.update(b);assert.equal(digest.digest('hex'),tier.sha256);assert.equal(fs.statSync(packs[0]).size,tier.bytes);
 console.log('Exact source, signed catalogue, encrypted Tia checksum, and absence of raw models/content/signing keys passed.');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
