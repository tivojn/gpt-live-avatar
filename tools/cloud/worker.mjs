// Deploy only on a confirmed Workers Free account for a hard request cutoff.
// One allowed GET performs at most one R2 read; no public bucket URL exists.
import { createR2Reader } from './r2-reader.mjs';
export function createWorker(catalogue,objects){
 const allowed=new Map(objects.map(p=>[p.file,p]));
 return {async fetch(request,env){
  const fail=(code,message)=>new Response(message,{status:code,headers:{'Cache-Control':'no-store'}});
  if(!env.DOWNLOAD_TOKEN||request.headers.get('Authorization')!=='Bearer '+env.DOWNLOAD_TOKEN)return fail(401,'Open this download in GPT-Live Avatar.');
  const url=new URL(request.url),name=url.pathname.slice(1);if(url.search||!/^[-a-z0-9.]+$/.test(name))return fail(404,'Not found.');
  if(name==='authorize'&&request.method==='POST'){
   if(!env.CONTENT_KEYS)return fail(503,'Avatar authorization is not activated.');
   try{
    if(Number(request.headers.get('Content-Length'))>2048)return fail(413,'Request too large.');
    const reader=request.body?.getReader();if(!reader)return fail(400,'Invalid authorization request.');let bytes=0,parts=[];
    try{while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>2048){await reader.cancel();return fail(413,'Request too large.');}parts.push(value);}}finally{reader.releaseLock();}
    const body=new Uint8Array(bytes);let offset=0;for(const p of parts){body.set(p,offset);offset+=p.length;}
    const publicKey=JSON.parse(new TextDecoder().decode(body)).publicKey;if(typeof publicKey!=='string'||publicKey.length>600)return fail(400,'Invalid public key.');
    const key=await crypto.subtle.importKey('spki',Uint8Array.from(atob(publicKey),c=>c.charCodeAt(0)),{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);
    if(key.algorithm.modulusLength!==2048)return fail(400,'Invalid public key.');
    const wrapped=await crypto.subtle.encrypt({name:'RSA-OAEP'},key,new TextEncoder().encode(env.CONTENT_KEYS));
    return new Response(JSON.stringify({wrappedKeys:btoa(String.fromCharCode(...new Uint8Array(wrapped)))}),{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
   }catch{return fail(400,'Invalid authorization request.');}
  }
  if(!['GET','HEAD'].includes(request.method))return fail(405,'Method not allowed.');
  if(name==='index.json')return new Response(request.method==='HEAD'?null:catalogue,{headers:{'Content-Type':'application/json','Cache-Control':'private, max-age=300','Vary':'Authorization'}});
  const entry=allowed.get(name);if(!entry||name==='index.json')return fail(404,'Not found.');
  const headers={'Content-Type':'application/octet-stream','Content-Length':String(entry.bytes),'ETag':'"'+entry.sha256+'"','Cache-Control':'private, max-age=86400','Vary':'Authorization','X-Content-Type-Options':'nosniff'};
  if(request.method==='HEAD')return new Response(null,{headers});
  if(request.headers.has('Range'))return fail(416,'Retry this download part in full.');
  const storage=env.AVATAR_ASSETS||createR2Reader(env);if(!storage)return fail(503,'Downloads are not activated.');
  try{const object=await storage.get(name);if(!object||object.size!==entry.bytes){await object?.body?.cancel();return fail(503,'This download is temporarily unavailable.');}return new Response(object.body,{headers});}catch(error){console.error('Protected storage read failed:', error.message);return fail(503,'Please try this download again later.');}
 }};
}
