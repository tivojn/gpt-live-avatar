'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),asar=require('@electron/asar');
(async()=>{
 const repo=path.resolve(__dirname,'..'),bundle=process.argv[2]||path.join(repo,'dist/mac-arm64/GPT-Live Avatar.app'),resources=path.join(bundle,'Contents/Resources'),file=path.join(resources,'app.asar'),list=asar.listPackage(file),starter=require('../electron/default-avatar.json');
 assert(!list.some(n=>/\.(glb|gltf|blend|gla)$/i.test(n)),'No raw models in source archive');
 for(const name of ['agent-tools.cjs','agent-model.cjs','agent-browser.cjs','agent-web.cjs'])assert(!list.some(n=>n.endsWith('/'+name)),'Removed built-in agent code must not ship: '+name);
 const runtime=JSON.parse(fs.readFileSync(path.join(resources,'assets-runtime.json')));assert(!runtime.keys&&!runtime.privateKey);
 assert.equal(JSON.parse(asar.extractFile(file,'package.json')).version,require('../package.json').version);
 function files(p){return fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(p,e.name)):[path.join(p,e.name)]);}
 for(const f of [...files(path.join(repo,'electron')),...files(path.join(repo,'web'))])assert(fs.readFileSync(f).equals(asar.extractFile(file,path.relative(repo,f))),path.relative(repo,f)+' must match packaged source');
 const secrets=JSON.parse(fs.readFileSync(path.join(repo,'build/protected/private-build.json'))),archive=fs.readFileSync(file);
 for(const secret of [secrets.privateKey,...Object.values(secrets.keys)])for(const value of [secret,JSON.stringify(secret).slice(1,-1)])assert(!archive.includes(Buffer.from(value)),'No content or signing keys in packaged source');
 assert.deepEqual(JSON.parse(asar.extractFile(file,'electron/default-avatar.json')),starter,'Packaged default avatar must match source');
 const signed=JSON.parse(fs.readFileSync(path.join(resources,'assets-index.json')));assert(crypto.verify(null,Buffer.from(signed.payload),runtime.publicKey,Buffer.from(signed.signature,'base64')));
 const avatar=JSON.parse(signed.payload).avatars[starter.slug];assert(avatar?.mac?.base,'Signed catalogue includes the default avatar');
 const expected=[['base.gla',avatar.mac.base],...(avatar.motionUpdate?[['motions.gla',avatar.motionUpdate.package]]:[])],packs=files(path.join(resources,'avatars'));
 assert.deepEqual(packs.map(f=>path.relative(resources,f)).sort(),expected.map(([name])=>'avatars/'+starter.slug+'/'+name).sort(),'Only the selected encrypted starter may ship');
 for(const [name,entry] of expected){const pack=path.join(resources,'avatars',starter.slug,name),digest=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(pack))digest.update(chunk);assert.equal(digest.digest('hex'),entry.sha256,name+' matches signed checksum');assert.equal(fs.statSync(pack).size,entry.bytes,name+' matches signed size');}
 console.log('Exact source, signed catalogue, encrypted '+starter.name+' checksums, and absence of raw models/content/signing keys passed.');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
