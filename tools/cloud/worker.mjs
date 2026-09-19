// Deploy only on a confirmed Workers Free account for a hard request cutoff.
// One allowed GET performs at most one R2 read; no public bucket URL exists.
// releases/ is the only unauthenticated surface: the installers (the
// Apple-signed macOS DMG and the Windows .exe), their metadata (latest.json)
// and a small landing page. The signed catalogue (index.json), key wrapping
// and encrypted parts stay token-authenticated.
import { createR2Reader } from './r2-reader.mjs';
export const RELEASE_PREFIX='releases/';
// Keys must match electron/releases.cjs INSTALLER_TARGETS.
export const INSTALLER_TARGETS=[
 {key:'arm64',extension:'dmg',contentType:'application/x-apple-diskimage',label:'macOS (Apple silicon)',system:'macOS'},
 {key:'x64',extension:'dmg',contentType:'application/x-apple-diskimage',label:'macOS (Intel)',system:'macOS'},
 {key:'win-x64',extension:'exe',contentType:'application/octet-stream',label:'Windows (64-bit)',system:'Windows'},
];
export const INSTALLER_NAME=/^gpt-live-avatar-((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))-(arm64|x64|win-x64)\.(dmg|exe)$/;
const escapeHTML=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
function releasePage(doc,origin){
 const version=typeof doc.version==='string'&&/^\d+\.\d+\.\d+$/.test(doc.version)?doc.version:'';
 const installers=[];
 for(const target of INSTALLER_TARGETS){
  // The flat fields are the pre-0.2.27, macOS-only shape of this document.
  const entry=doc.installers?.[target.key]||(doc.arch===target.key&&target.extension==='dmg'?doc:null);
  const name='gpt-live-avatar-'+version+'-'+target.key+'.'+target.extension;
  // Only same-origin installer names are linked, whatever the metadata says.
  if(version&&entry&&entry.url===origin+'/'+RELEASE_PREFIX+name&&/^[a-f0-9]{64}$/.test(entry.sha256||''))installers.push({label:target.label,system:target.system,url:entry.url,sha256:entry.sha256,bytes:Number.isSafeInteger(entry.bytes)?entry.bytes:null});
 }
 const systems=[...new Set(installers.map(i=>i.system))];
 const title=escapeHTML(String(doc.title||'GPT-Live Avatar '+version).slice(0,160)),notes=escapeHTML(String(doc.notes||'').slice(0,10000)),date=typeof doc.publishedAt==='string'?escapeHTML(doc.publishedAt.slice(0,10)):'';
 return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GPT-Live Avatar ${escapeHTML(version)}</title>
<style>body{margin:0;background:#f7f8fc;color:#252737;font:15px/1.55 -apple-system,BlinkMacSystemFont,sans-serif}main{max-width:680px;margin:auto;padding:36px 24px}h1{font-size:28px;margin:0 0 4px}p.meta{color:#707585;margin:0 0 20px}a.dl{display:inline-block;background:#383e61;color:#fff;text-decoration:none;border-radius:9px;padding:10px 16px;margin:6px 8px 6px 0}code{font-size:12px;overflow-wrap:anywhere}pre{white-space:pre-wrap;background:#fff;border:1px solid #e2e4ed;border-radius:12px;padding:16px}</style>
<main><h1>${title}</h1><p class="meta">Version ${escapeHTML(version)}${date?' · '+date:''}${systems.length?' · '+systems.map(s=>s==='macOS'?'macOS 14 or newer':'Windows 10 or newer').join(' · '):''}</p>
${installers.length?installers.map(i=>`<p><a class="dl" href="${escapeHTML(i.url)}">Download for ${i.label}</a>${i.bytes?' <span class="meta">'+(i.bytes/1e9).toFixed(2)+' GB</span>':''}<br><code>SHA-256 ${i.sha256}</code></p>`).join(''):'<p>No installer is attached to this release.</p>'}
${systems.includes('macOS')?'<p>macOS: open the DMG, copy GPT-Live Avatar to Applications and launch it. Verify with <code>shasum -a 256</code> if you wish. Existing installs update themselves: right-click any avatar → Check for Updates…</p>':''}
${systems.includes('Windows')?'<p>Windows: run the installer. It is not code-signed yet, so Windows SmartScreen will warn you: choose <b>More info</b> → <b>Run anyway</b>, or check the SHA-256 above with <code>certutil -hashfile &lt;file&gt; SHA256</code> first. Installing from inside the app is not available on Windows yet; right-click any avatar → Check for Updates… links to the new installer.</p>':''}
${notes?'<pre>'+notes+'</pre>':''}</main>
`;
}
export function createWorker(catalogue,objects){
 const allowed=new Map(objects.map(p=>[p.file,p]));
 async function serveRelease(request,env,url,name,fail){
  if(url.search)return fail(404,'Not found.');
  if(!['GET','HEAD'].includes(request.method))return fail(405,'Method not allowed.');
  const rest=name.slice(RELEASE_PREFIX.length),installer=INSTALLER_NAME.exec(rest);
  // The extension must be the one that target actually ships.
  const target=installer?INSTALLER_TARGETS.find(t=>t.key===installer[2]&&t.extension===installer[3]):null;
  if(rest!==''&&rest!=='latest.json'&&!target)return fail(404,'Not found.');
  if(target&&request.headers.has('Range'))return fail(416,'Retry this download in full.');
  const storage=env.AVATAR_ASSETS||createR2Reader(env);if(!storage)return fail(503,'Downloads are not activated.');
  let object;
  try{object=await storage.get(target?name:RELEASE_PREFIX+'latest.json');}
  catch(error){if(error.status!==404){console.error('Release storage read failed:', error.message);return fail(503,'Please try this download again later.');}object=null;}
  if(!object)return fail(404,target?'Not found.':'No release has been published yet.');
  const cancel=async()=>{try{await object.body?.cancel?.();}catch{}};
  if(target){
   const headers={'Content-Type':target.contentType,'Content-Length':String(object.size),'Content-Disposition':'attachment; filename="GPT-Live Avatar-'+installer[1]+'-'+target.key+'.'+target.extension+'"','Cache-Control':'public, max-age=86400, immutable','X-Content-Type-Options':'nosniff'};
   if(request.method==='HEAD'){await cancel();return new Response(null,{headers});}
   return new Response(object.body,{headers});
  }
  if(object.size>65536){await cancel();return fail(503,'This release listing is temporarily unavailable.');}
  if(rest==='latest.json'){
   const headers={'Content-Type':'application/json','Content-Length':String(object.size),'Cache-Control':'public, max-age=300','X-Content-Type-Options':'nosniff'};
   if(request.method==='HEAD'){await cancel();return new Response(null,{headers});}
   return new Response(object.body,{headers});
  }
  let doc;
  try{doc=JSON.parse(await new Response(object.body).text());if(!doc||typeof doc!=='object')throw Error('invalid');}catch{return fail(503,'This release listing is temporarily unavailable.');}
  const headers={'Content-Type':'text/html; charset=utf-8','Cache-Control':'public, max-age=300','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'"};
  return new Response(request.method==='HEAD'?null:releasePage(doc,url.origin),{headers});
 }
 return {async fetch(request,env){
  const fail=(code,message)=>new Response(message,{status:code,headers:{'Cache-Control':'no-store'}});
  const url=new URL(request.url),name=url.pathname.slice(1);
  if(name.startsWith(RELEASE_PREFIX))return serveRelease(request,env,url,name,fail);
  if(!env.DOWNLOAD_TOKEN||request.headers.get('Authorization')!=='Bearer '+env.DOWNLOAD_TOKEN)return fail(401,'Open this download in GPT-Live Avatar.');
  if(url.search||!/^[-a-z0-9.]+$/.test(name))return fail(404,'Not found.');
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
