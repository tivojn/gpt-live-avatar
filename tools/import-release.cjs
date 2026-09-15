'use strict';
// Reuse only the client resources shipped in an official app. Never copy a
// user's profile, Cloudflare credentials, private-build.json or decrypted models.
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
async function hash(file){const h=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))h.update(chunk);return h.digest('hex');}
async function importRelease(bundle,repo=path.resolve(__dirname,'..')){
 const resources=path.join(path.resolve(bundle),'Contents/Resources');
 const runtimeFile=path.join(resources,'assets-runtime.json'),indexFile=path.join(resources,'assets-index.json'),starter=path.join(resources,'avatars/tia/base.gla');
 for(const file of [runtimeFile,indexFile,starter])if(!fs.existsSync(file))throw Error('Missing release resource: '+path.basename(file)+'. Use the official v0.2.6 or newer Mac app, not a source folder.');
 const runtime=JSON.parse(await fsp.readFile(runtimeFile,'utf8'));
 if(Object.keys(runtime).some(k=>!['publicKey','downloadToken'].includes(k))||!runtime.publicKey||typeof runtime.downloadToken!=='string'||!runtime.downloadToken)throw Error('Unexpected runtime configuration. Refusing to copy private or unsupported fields.');
 const envelope=JSON.parse(await fsp.readFile(indexFile,'utf8'));
 if(typeof envelope.payload!=='string'||!crypto.verify(null,Buffer.from(envelope.payload),runtime.publicKey,Buffer.from(envelope.signature||'','base64')))throw Error('Release catalogue signature did not verify.');
 const index=JSON.parse(envelope.payload),entry=index.avatars?.tia?.mac?.base;
 if(index.version!==2||entry?.format!=='gla-pack-v1'||!Number.isSafeInteger(entry.bytes)||!/^[a-f0-9]{64}$/.test(entry.sha256||''))throw Error('Unsupported encrypted Tia catalogue.');
 if((await fsp.stat(starter)).size!==entry.bytes||await hash(starter)!==entry.sha256)throw Error('Encrypted Tia checksum did not match the signed catalogue.');
 const starters=[{file:starter,name:'base.gla',bytes:entry.bytes}];
 const motion=index.avatars.tia.motionUpdate?.package;
 if(motion){
  const file=path.join(resources,'avatars/tia/motions.gla');
  if(motion.format!=='gla-pack-v1'||!Number.isSafeInteger(motion.bytes)||!/^[a-f0-9]{64}$/.test(motion.sha256||'')||!fs.existsSync(file)||(await fsp.stat(file)).size!==motion.bytes||await hash(file)!==motion.sha256)throw Error('Encrypted Tia motion checksum did not match the signed catalogue.');
  starters.push({file,name:'motions.gla',bytes:motion.bytes});
 }
 const copies=[
  [runtimeFile,path.join(repo,'build/protected/assets-runtime.json')],
  [indexFile,path.join(repo,'build/protected/index.json')],
  ...starters.map(s=>[s.file,path.join(repo,'build/protected/starter/tia',s.name)]),
 ];
 const developments=starters.map(s=>[s.file,path.join(repo,'build/assets/bundle/tia',s.name)]);
 // Validate every existing destination before changing anything. Maintainer
 // resources and an independently authored package must not be overwritten.
 for(const [source,destination] of [...copies,...developments])if(fs.existsSync(destination)&&await hash(source)!==await hash(destination))throw Error('Different resources already exist at '+path.relative(repo,destination)+'. Use a fresh clone, or back up and move that existing resource first.');
 for(const [source,destination] of copies){
  if(fs.existsSync(destination))continue;
  await fsp.mkdir(path.dirname(destination),{recursive:true});
  const temporary=destination+'.import-'+process.pid;
  try{await fsp.copyFile(source,temporary,fs.constants.COPYFILE_EXCL);await fsp.chmod(temporary,0o600);await fsp.rename(temporary,destination);}finally{await fsp.rm(temporary,{force:true});}
 }
 // The development server reads build/assets/bundle; packaging reads starter.
 // A hard link shares encrypted bytes without duplicating the large package.
 for(const s of starters){const development=path.join(repo,'build/assets/bundle/tia',s.name);if(!fs.existsSync(development)){await fsp.mkdir(path.dirname(development),{recursive:true});await fsp.link(path.join(repo,'build/protected/starter/tia',s.name),development);}}
 return {starterBytes:starters.reduce((n,s)=>n+s.bytes,0),characters:Object.keys(index.avatars).length};
}
if(require.main===module){const bundle=process.argv[2]||'/Applications/GPT-Live Avatar.app';importRelease(bundle).then(result=>console.log('Imported verified client resources and encrypted Tia ('+Math.round(result.starterBytes/1048576)+' MiB). '+result.characters+' characters are in the catalogue. No personal settings or server secrets were copied.\nNext: npm run start:isolated')).catch(error=>{console.error(error.message);process.exitCode=1;});}
module.exports={importRelease};
