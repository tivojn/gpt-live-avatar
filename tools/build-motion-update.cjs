'use strict';
// Publish only motion data. Existing signed mesh/texture packages and their
// download URLs stay intact, so older app versions remain usable.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {pack,hash}=require('./build-protected-assets.cjs');
async function main(){
 const revision=process.argv[2];if(!/^[-a-z0-9]{1,80}$/.test(revision||''))throw Error('Provide a new motion revision.');
 const repo=path.resolve(__dirname,'..'),out=path.join(repo,'build/protected');
 const secrets=JSON.parse(fs.readFileSync(path.join(out,'private-build.json'))),previous=JSON.parse(fs.readFileSync(path.join(out,'index.json')));
 if(!crypto.verify(null,Buffer.from(previous.payload),secrets.publicKey,Buffer.from(previous.signature,'base64')))throw Error('Existing catalogue signature is invalid.');
 const index=JSON.parse(previous.payload);index.release=revision;
 for(const [slug,avatar] of Object.entries(index.avatars)){
  const source=path.join(repo,'build/characters',slug),manifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json'))),library=JSON.parse(fs.readFileSync(path.join(source,'runtime/motions/library.json')));
  if(manifest.assetRevision!==avatar.assetRevision||library.motionRevision!==revision)throw Error('Source revision mismatch: '+slug);
  const entry=await pack(source,slug,'motions',secrets,out,revision);if(!entry)throw Error('No motions for '+slug);
  avatar.motionUpdate={revision,package:entry};console.log(slug,entry.bytes,'encrypted motion bytes');
 }
 const packs=Object.values(index.avatars).flatMap(a=>[...Object.values(a.mac),a.motionUpdate.package]),bytes=packs.reduce((n,p)=>n+p.bytes,0);
 if(bytes+2*1024*1024>require('../electron/asset-download.json').storageCapBytes)throw Error('Motion update exceeds the storage cap.');
 const payload=JSON.stringify(index),envelope={payload,signature:crypto.sign(null,Buffer.from(payload),secrets.privateKey).toString('base64')};
 fs.writeFileSync(path.join(out,'index.json'),JSON.stringify(envelope));
 const objects=packs.flatMap(p=>p.parts);objects.push({file:'index.json',bytes:fs.statSync(path.join(out,'index.json')).size,sha256:await hash(path.join(out,'index.json'))});
 fs.writeFileSync(path.join(out,'inventory.json'),JSON.stringify({files:objects.length,bytes:objects.reduce((n,p)=>n+p.bytes,0),objects,index},null,2));
 const starter=path.join(out,'starter/tia/motions.gla');fs.rmSync(starter,{force:true});fs.linkSync(path.join(out,index.avatars.tia.motionUpdate.package.file),starter);
 console.log('Motion overlay verified; existing base and texture packages retained.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
