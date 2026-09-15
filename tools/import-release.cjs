'use strict';
// Reuse only the client resources shipped in an official app. Never copy a
// user's profile, Cloudflare credentials, private-build.json or decrypted models.
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path');
const {loadDefaultAvatar,readCatalogue,verifyPackage,hash}=require('./verify-release.cjs');
async function importRelease(bundle,repo=path.resolve(__dirname,'..')){
 const requiredStarter=loadDefaultAvatar(repo),resources=path.join(path.resolve(bundle),'Contents/Resources');
 const runtimeFile=path.join(resources,'assets-runtime.json'),indexFile=path.join(resources,'assets-index.json'),avatarRoot=path.join(resources,'avatars');
 for(const file of [runtimeFile,indexFile,avatarRoot])if(!fs.existsSync(file))throw Error('Missing release resource: '+path.basename(file)+'. Use an official v0.2.6 or newer Mac app, not a source folder.');
 const {index}=await readCatalogue(runtimeFile,indexFile),starters=[];
 // Discover what the installer actually contains. Older official installers
 // bundle Tia; never relabel that ciphertext as the current default avatar.
 for(const directory of (await fsp.readdir(avatarRoot,{withFileTypes:true})).filter(e=>e.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name))){
  const slug=directory.name;if(!/^[a-z0-9_-]{1,40}$/.test(slug))throw Error('Invalid bundled avatar directory.');
  const avatar=index.avatars[slug],name=avatar?.name||slug;
  const files=[{name:'base.gla',entry:avatar?.mac?.base,label:name}];
  if(avatar?.motionUpdate)files.push({name:'motions.gla',entry:avatar.motionUpdate.package,label:name+' motion'});
  for(const entry of files){const file=path.join(avatarRoot,slug,entry.name);await verifyPackage(file,entry.entry,entry.label);starters.push({slug,avatarName:name,file,name:entry.name,bytes:entry.entry.bytes});}
 }
 if(!starters.length)throw Error('No encrypted avatar starter was found in this installer.');
 const copies=[
  [runtimeFile,path.join(repo,'build/protected/assets-runtime.json')],
  [indexFile,path.join(repo,'build/protected/index.json')],
  ...starters.map(s=>[s.file,path.join(repo,'build/protected/starter',s.slug,s.name)]),
 ];
 const developments=starters.map(s=>[s.file,path.join(repo,'build/assets/bundle',s.slug,s.name)]);
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
 // Hard links share encrypted bytes without duplicating large packages.
 for(const s of starters){const development=path.join(repo,'build/assets/bundle',s.slug,s.name);if(!fs.existsSync(development)){await fsp.mkdir(path.dirname(development),{recursive:true});await fsp.link(path.join(repo,'build/protected/starter',s.slug,s.name),development);}}
 const bundled=starters.filter(s=>s.name==='base.gla').map(s=>({slug:s.slug,name:s.avatarName}));
 return {starterBytes:starters.reduce((n,s)=>n+s.bytes,0),characters:Object.keys(index.avatars).length,bundled,requiredStarter:{slug:requiredStarter.slug,name:requiredStarter.name},defaultStarterAvailable:bundled.some(s=>s.slug===requiredStarter.slug)};
}
if(require.main===module){const bundle=process.argv[2]||'/Applications/GPT-Live Avatar.app';importRelease(bundle).then(result=>{
 console.log('Imported verified client resources and encrypted '+result.bundled.map(s=>s.name).join(', ')+' ('+Math.round(result.starterBytes/1048576)+' MiB). '+result.characters+' characters are in the catalogue. No personal settings or server secrets were copied.');
 console.log(result.defaultStarterAvailable?'Next: npm run start:isolated':'This older installer does not include '+result.requiredStarter.name+', the default avatar for this source version. The imported starter keeps its original identity. Use a fresh clone with a current official '+result.requiredStarter.name+' installer before starting or packaging this version.');
}).catch(error=>{console.error(error.message);process.exitCode=1;});}
module.exports={importRelease};
