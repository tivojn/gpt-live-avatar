'use strict';
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const repository=path.resolve(__dirname,'..');
function loadDefaultAvatar(repo=repository){
 const avatar=JSON.parse(fs.readFileSync(path.join(repo,'electron/default-avatar.json'),'utf8'));
 if(!/^[a-z0-9_-]{1,40}$/.test(avatar.slug||'')||typeof avatar.name!=='string'||!avatar.name.trim())throw Error('Invalid default-avatar metadata.');
 return avatar;
}
async function hash(file){const digest=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))digest.update(chunk);return digest.digest('hex');}
async function readCatalogue(runtimeFile,indexFile){
 const runtime=JSON.parse(await fsp.readFile(runtimeFile,'utf8'));
 if(Object.keys(runtime).some(key=>!['publicKey','downloadToken'].includes(key))||!runtime.publicKey||typeof runtime.downloadToken!=='string'||!runtime.downloadToken)throw Error('Unexpected runtime configuration. Refusing private or unsupported fields.');
 const envelope=JSON.parse(await fsp.readFile(indexFile,'utf8'));
 if(typeof envelope.payload!=='string'||!crypto.verify(null,Buffer.from(envelope.payload),runtime.publicKey,Buffer.from(envelope.signature||'','base64')))throw Error('Release catalogue signature did not verify.');
 const index=JSON.parse(envelope.payload);
 if(index.version!==2||!index.avatars||typeof index.avatars!=='object'||Array.isArray(index.avatars))throw Error('Unsupported encrypted release catalogue.');
 return {runtime,index};
}
async function verifyPackage(file,entry,label){
 if(entry?.format!=='gla-pack-v1'||!Number.isSafeInteger(entry.bytes)||entry.bytes<=0||!/^[a-f0-9]{64}$/.test(entry.sha256||''))throw Error('Unsupported encrypted '+label+' catalogue.');
 if(!fs.existsSync(file))throw Error('The encrypted '+label+' starter is missing. Import an official installer that includes this avatar.');
 if((await fsp.stat(file)).size!==entry.bytes||await hash(file)!==entry.sha256)throw Error('Encrypted '+label+' checksum did not match the signed catalogue.');
}
async function verifyRelease(repo=repository){
 const root=path.join(repo,'build/protected'),starter=loadDefaultAvatar(repo),config=JSON.parse(fs.readFileSync(path.join(repo,'electron/asset-download.json'),'utf8'));
 const {index}=await readCatalogue(path.join(root,'assets-runtime.json'),path.join(root,'index.json'));
 const avatar=index.avatars[starter.slug];
 if(!avatar)throw Error('The signed release has no '+starter.name+' entry. Import a current official installer.');
 const packages=[{name:'base.gla',entry:avatar.mac?.base,label:starter.name}];
 if(avatar.motionUpdate)packages.push({name:'motions.gla',entry:avatar.motionUpdate.package,label:starter.name+' motion'});
 for(const p of packages)await verifyPackage(path.join(root,'starter',starter.slug,p.name),p.entry,p.label);
 if(!config.baseURL||!/^https:\/\/[-a-z0-9.]+\/$/.test(config.baseURL))throw Error('R2 migration is not activated. Configure and test the live gateway before building a release installer.');
 return {starter,index,packages};
}
if(require.main===module)verifyRelease().then(({starter})=>console.log('Verified release configuration: encrypted '+starter.name+' starter checksums, signed catalogue, HTTPS downloads, no model content keys in the installer.')).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={loadDefaultAvatar,readCatalogue,verifyPackage,verifyRelease,hash};
