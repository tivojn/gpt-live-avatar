'use strict';
// Owner-only selective repack. Arguments are slug=new-immutable-revision.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {pack,hash}=require('./build-protected-assets.cjs');
async function main(){
 const repo=path.resolve(__dirname,'..'),out=path.join(repo,'build/protected');
 const selections=process.argv.slice(2).map(arg=>{const [slug,revision]=arg.split('=');if(!['sarah','iselda','ming-mei'].includes(slug)||!/^[-a-z0-9]{1,80}$/.test(revision||''))throw Error('Use sarah=REVISION, iselda=REVISION or ming-mei=REVISION');return {slug,revision};});
 if(!selections.length||new Set(selections.map(s=>s.slug)).size!==selections.length)throw Error('Choose distinct characters to repack.');
 const secrets=JSON.parse(fs.readFileSync(path.join(out,'private-build.json'))),previous=JSON.parse(fs.readFileSync(path.join(out,'index.json')));
 if(!crypto.verify(null,Buffer.from(previous.payload),secrets.publicKey,Buffer.from(previous.signature,'base64')))throw Error('Invalid current catalogue.');
 const index=JSON.parse(previous.payload);
 for(const {slug,revision}of selections){
  if(index.avatars[slug].assetRevision===revision||fs.readdirSync(out).some(f=>f.startsWith(slug+'-'+revision+'-')))throw Error('Revision is already used: '+slug+' '+revision);
  const source=path.join(repo,'build/characters',slug),manifestPath=path.join(source,'manifest.json'),manifest=JSON.parse(fs.readFileSync(manifestPath));
  const resident=JSON.parse(fs.readFileSync(path.join(source,'runtime/resident/model.gltf')));
  if(!resident.extras?.avatarWardrobeRepairs?.length)throw Error('Wardrobe geometry has not been repaired: '+slug);
  manifest.assetRevision=revision;fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
  const library=JSON.parse(fs.readFileSync(path.join(source,'runtime/motions/library.json'))),mac={};
  for(const tier of ['base','balanced','best']){const entry=await pack(source,slug,tier,secrets,out);if(entry)mac[tier]=entry;console.log(slug,tier,entry?.bytes||0);}
  const motion=await pack(source,slug,'motions',secrets,out,library.motionRevision);
  index.avatars[slug]={...index.avatars[slug],assetRevision:revision,mac,motionUpdate:{revision:library.motionRevision,package:motion}};
 }
 index.release='wardrobe-'+require('../package.json').version;
 const packs=Object.values(index.avatars).flatMap(a=>[...Object.values(a.mac),...(a.motionUpdate?[a.motionUpdate.package]:[])]),bytes=packs.reduce((n,p)=>n+p.bytes,0);
 if(bytes+2*1024*1024>require('../electron/asset-download.json').storageCapBytes)throw Error('Release exceeds storage cap.');
 const payload=JSON.stringify(index),envelope={payload,signature:crypto.sign(null,Buffer.from(payload),secrets.privateKey).toString('base64')};fs.writeFileSync(path.join(out,'index.json'),JSON.stringify(envelope));
 const objects=packs.flatMap(p=>p.parts);objects.push({file:'index.json',bytes:fs.statSync(path.join(out,'index.json')).size,sha256:await hash(path.join(out,'index.json'))});
 fs.writeFileSync(path.join(out,'inventory.json'),JSON.stringify({files:objects.length,bytes:objects.reduce((n,p)=>n+p.bytes,0),objects,index},null,2));
 console.log('Selected wardrobe packages verified; unchanged avatars retained.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
