'use strict';
// Chunk-authenticated packages. Only the main process receives content keys;
// disk caches contain ciphertext, and streams authenticate before yielding.
const fs=require('node:fs'),crypto=require('node:crypto'),{Readable}=require('node:stream');
const MAGIC=Buffer.from('GLAPACK1'),CHUNK=1024*1024,MAX_HEADER=2*1024*1024;
const validName=n=>typeof n==='string'&&n.length<=500&&!n.startsWith('/')&&!n.includes('\\')&&n.split('/').every(p=>p&&p!=='.'&&p!=='..');
const aad=(id,name,index,size)=>Buffer.from(JSON.stringify([id,name,index,size]));
class ProtectedPackage {
 constructor(file,keys){
  this.file=file;const fd=fs.openSync(file,'r');try{
   const prefix=Buffer.alloc(12);if(fs.readSync(fd,prefix,0,12,0)!==12||!prefix.subarray(0,8).equals(MAGIC))throw Error('Invalid protected package.');
   const size=prefix.readUInt32LE(8);if(size<2||size>MAX_HEADER)throw Error('Invalid package header.');
   const raw=Buffer.alloc(size);if(fs.readSync(fd,raw,0,size,12)!==size)throw Error('Incomplete package header.');
   const doc=JSON.parse(raw),key=keys?.[doc.keyId];if(!key||!/^[a-f0-9]{64}$/i.test(key))throw Error('This app cannot unlock this avatar revision. Update the app.');
   if(doc.version!==1||doc.chunkSize!==CHUNK||!Array.isArray(doc.files)||doc.files.length>20000||typeof doc.id!=='string')throw Error('Unsupported package.');
   const {mac,...signed}=doc,expected=crypto.createHmac('sha256',Buffer.from(key,'hex')).update(JSON.stringify(signed)).digest('hex');
   if(typeof mac!=='string'||mac.length!==64||!crypto.timingSafeEqual(Buffer.from(mac),Buffer.from(expected)))throw Error('Package header authentication failed.');
   if(!doc.meta||!['base','balanced','best'].includes(doc.meta.tier)||!/^[-a-z0-9]+$/.test(doc.meta.slug)||typeof doc.meta.assetRevision!=='string')throw Error('Invalid package metadata.');
   this.key=Buffer.from(key,'hex');this.id=doc.id;this.meta=doc.meta;this.start=12+size;this.entries=new Map();let offset=0;
   for(const e of doc.files){
    if(!validName(e.name)||this.entries.has(e.name)||!Number.isSafeInteger(e.size)||e.size<0||e.size>512*1024*1024||e.offset!==offset)throw Error('Invalid package entry.');
    offset+=e.size+Math.max(1,Math.ceil(e.size/CHUNK))*28;this.entries.set(e.name,e);
   }
   if(this.start+offset!==fs.fstatSync(fd).size)throw Error('Truncated or oversized package.');
  }finally{fs.closeSync(fd);}
 }
 chunk(fd,e,index){
  const size=Math.min(CHUNK,Math.max(0,e.size-index*CHUNK));const block=Buffer.alloc(size+28);
  const off=this.start+e.offset+index*(CHUNK+28);if(fs.readSync(fd,block,0,block.length,off)!==block.length)throw Error('Incomplete avatar data.');
  const d=crypto.createDecipheriv('aes-256-gcm',this.key,block.subarray(0,12));d.setAAD(aad(this.id,e.name,index,size));d.setAuthTag(block.subarray(block.length-16));
  return Buffer.concat([d.update(block.subarray(12,block.length-16)),d.final()]);
 }
 read(name){const e=this.entries.get(name);if(!e)throw Error('Missing avatar resource.');const fd=fs.openSync(this.file,'r');try{const chunks=[];for(let i=0;i<Math.max(1,Math.ceil(e.size/CHUNK));i++)chunks.push(this.chunk(fd,e,i));return Buffer.concat(chunks,e.size);}finally{fs.closeSync(fd);}}
 stream(name,start=0,end){
  const e=this.entries.get(name);if(!e)throw Error('Missing avatar resource.');end=end??e.size-1;const self=this;
  return Readable.from((async function*(){const fd=fs.openSync(self.file,'r');try{for(let i=Math.floor(start/CHUNK);i<=Math.floor(Math.max(0,end)/CHUNK);i++){const b=self.chunk(fd,e,i);yield b.subarray(Math.max(0,start-i*CHUNK),Math.min(b.length,end-i*CHUNK+1));}}finally{fs.closeSync(fd);}})());
 }
}
module.exports={ProtectedPackage,MAGIC,CHUNK,MAX_HEADER,validName,aad};
