'use strict';
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {MAGIC,CHUNK,MAX_HEADER,aad,ProtectedPackage}=require('../electron/protected-assets.cjs');
const {loadDefaultAvatar}=require('./verify-release.cjs');
const repo=path.resolve(__dirname,'..'),out=path.join(repo,'build/protected');
const walk=p=>fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(p,e.name)):e.isFile()?[path.join(p,e.name)]:[]);
const hash=file=>new Promise((resolve,reject)=>{const h=crypto.createHash('sha256');fs.createReadStream(file).on('data',b=>h.update(b)).on('error',reject).on('end',()=>resolve(h.digest('hex')));});
async function pack(source,slug,tier,secrets,output=out,motionRevision=''){
 const manifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json'))),revision=manifest.assetRevision;
 if(!revision)throw Error('A current revision is required for '+slug);
 const id=slug+'-'+revision+'-'+tier+(motionRevision?'-'+motionRevision:''),keyId='characters-2026-09',key=Buffer.from(secrets.keys[keyId],'hex'),items=[];
 for(const file of walk(source).sort()){
  let name=path.relative(source,file).split(path.sep).join('/');
  if(tier==='motions'&&!name.startsWith('runtime/motions/'))continue;
  if(!/^(runtime\/|appearance\/|manifest.json$|keyframe.png$|source-audit.json$)/.test(name))continue;
  const match=name.match(/^runtime\/resident\/image-\d+-(\d+)\./),size=match?Number(match[1]):0;
  const target=size===4096?'best':size===2048?'balanced':'base';if(tier!=='motions'&&target!==tier)continue;
  if(name.startsWith('runtime/motions/')&&name.endsWith('.json')&&!name.endsWith('/library.json')&&fs.existsSync(file+'.deflate'))continue;
  let data;
  if(name.startsWith('runtime/motions/')&&name.endsWith('.json')&&!name.endsWith('/library.json')){data=zlib.deflateRawSync(fs.readFileSync(file),{level:9});name+='.deflate';}
  items.push({name,file,data,size:data?data.length:fs.statSync(file).size});
 }
 if(!items.length)return null;
 let offset=0;const doc={version:1,id,keyId,chunkSize:CHUNK,meta:{slug,tier,assetRevision:revision,...(motionRevision?{motionRevision}:{})},files:items.map(e=>{const entry={name:e.name,offset,size:e.size};offset+=e.size+Math.max(1,Math.ceil(e.size/CHUNK))*28;return entry;})};
 doc.mac=crypto.createHmac('sha256',key).update(JSON.stringify(doc)).digest('hex');
 const header=Buffer.from(JSON.stringify(doc));if(header.length>MAX_HEADER)throw Error('Package header too large');const prefix=Buffer.alloc(12);MAGIC.copy(prefix);prefix.writeUInt32LE(header.length,8);
 const file=path.join(output,id+'.gla'),fd=fs.openSync(file+'.tmp','w',0o600);try{
  fs.writeSync(fd,prefix);fs.writeSync(fd,header);
  for(const e of items){const input=e.data?null:fs.openSync(e.file,'r');try{for(let i=0;i<Math.max(1,Math.ceil(e.size/CHUNK));i++){
   const n=Math.min(CHUNK,Math.max(0,e.size-i*CHUNK)),b=e.data?e.data.subarray(i*CHUNK,i*CHUNK+n):Buffer.alloc(n);if(input!==null&&fs.readSync(input,b,0,n,i*CHUNK)!==n)throw Error('Source changed while packing.');
   const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);c.setAAD(aad(id,e.name,i,n));fs.writeSync(fd,iv);fs.writeSync(fd,c.update(b));fs.writeSync(fd,c.final());fs.writeSync(fd,c.getAuthTag());
  }}finally{if(input!==null)fs.closeSync(input);}}
 }finally{fs.closeSync(fd);}
 fs.renameSync(file+'.tmp',file);const check=new ProtectedPackage(file,secrets.keys);
 // Compare every entry to the source, including every authenticated chunk.
 for(const e of items){const original=e.data||fs.readFileSync(e.file);if(!check.read(e.name).equals(original))throw Error('Package round-trip mismatch: '+e.name);}
 const bytes=fs.statSync(file).size,parts=[],input=fs.openSync(file,'r'),partSize=64*1024*1024;
 try{for(let i=0,offset=0;offset<bytes;i++,offset+=partSize){const size=Math.min(partSize,bytes-offset),buffer=Buffer.alloc(size);if(fs.readSync(input,buffer,0,size,offset)!==size)throw Error('Incomplete package while splitting.');const part=path.basename(file)+'.p'+String(i).padStart(3,'0');fs.writeFileSync(path.join(output,part),buffer,{mode:0o600});parts.push({file:part,bytes:size,sha256:crypto.createHash('sha256').update(buffer).digest('hex')});}}finally{fs.closeSync(input);}
 return {file:path.basename(file),bytes,sha256:await hash(file),format:'gla-pack-v1',entries:items.length,parts};
}
async function main(){
 const starterAvatar=loadDefaultAvatar(repo),slugs=['tia','sarah','iselda','ming-mei','seraphim'];if(!slugs.includes(starterAvatar.slug))throw Error('Default avatar has no build source: '+starterAvatar.slug);
 fs.mkdirSync(out,{recursive:true,mode:0o700});const secretFile=path.join(out,'private-build.json');let secrets;
 if(fs.existsSync(secretFile))secrets=JSON.parse(fs.readFileSync(secretFile));else{const pair=crypto.generateKeyPairSync('ed25519');secrets={keys:{'characters-2026-09':crypto.randomBytes(32).toString('hex')},downloadToken:crypto.randomBytes(32).toString('base64url'),publicKey:pair.publicKey.export({type:'spki',format:'pem'}),privateKey:pair.privateKey.export({type:'pkcs8',format:'pem'})};fs.writeFileSync(secretFile,JSON.stringify(secrets),{mode:0o600});}
 const index={version:2,release:'2026-09-14-v1',avatars:{}};
 for(const slug of slugs){const source=fs.realpathSync(path.join(repo,'build/characters',slug)),manifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json'))),mac={};for(const tier of ['base','balanced','best']){const p=await pack(source,slug,tier,secrets);if(p)mac[tier]=p;console.log(slug,tier,p?.bytes||0);}index.avatars[slug]={name:manifest.name,assetRevision:manifest.assetRevision,bundledMac:slug===starterAvatar.slug,mac};}
 const bytes=Object.values(index.avatars).flatMap(a=>Object.values(a.mac)).reduce((n,p)=>n+p.bytes,0);if(bytes+2*1024*1024>10_000_000_000)throw Error('Protected release exceeds the 10 GB cap.');
 const payload=JSON.stringify(index),envelope={payload,signature:crypto.sign(null,Buffer.from(payload),secrets.privateKey).toString('base64')};fs.writeFileSync(path.join(out,'index.json'),JSON.stringify(envelope));
 fs.writeFileSync(path.join(out,'assets-runtime.json'),JSON.stringify({downloadToken:secrets.downloadToken,publicKey:secrets.publicKey}),{mode:0o600});
 const objects=Object.values(index.avatars).flatMap(a=>Object.values(a.mac)).flatMap(p=>p.parts);objects.push({file:'index.json',bytes:fs.statSync(path.join(out,'index.json')).size,sha256:await hash(path.join(out,'index.json'))});
 fs.writeFileSync(path.join(out,'inventory.json'),JSON.stringify({files:objects.length,bytes:bytes+fs.statSync(path.join(out,'index.json')).size,objects,index},null,2));
 const starter=path.join(out,'starter',starterAvatar.slug);fs.mkdirSync(starter,{recursive:true});fs.rmSync(path.join(starter,'base.gla'),{force:true});fs.linkSync(path.join(out,index.avatars[starterAvatar.slug].mac.base.file),path.join(starter,'base.gla'));
 console.log('Verified encrypted release:',bytes,'bytes. Private build keys are excluded from git and uploads.');
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={pack,hash};
