'use strict';
// Owner-side installer publisher for the private release service. Dry run by
// default. Uploads one Apple-signed, notarized DMG plus releases/latest.json to
// the existing protected bucket, then verifies the public gateway routes.
// The Cloudflare REST API caps objects at 300 MiB, so the DMG goes through S3
// multipart with a bucket-scoped Object Read & Write credential kept in
// build/protected/r2-writer-secret.json (same shape as r2-reader-secret.json,
// permission "object-read-write"). Nothing here prints a credential.
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {hash}=require('../build-protected-assets.cjs');
const {storageCapBytes:CAP,baseURL:BASE_URL}=require('../../electron/asset-download.json');
const {verifyRemoteObject,createScopedS3Reader,cloudflareToken,createCloudflareClient,accountInventory}=require('./upload-r2.cjs');
const {installerDetails}=require('../../electron/releases.cjs');
const repo=path.resolve(__dirname,'../..'),directory=path.join(repo,'build/protected');
const PREFIX='releases/',PART_BYTES=64*1024*1024,RETRIABLE=[408,429,500,502,503,504,520,521,522,523,524];
const INSTALLER=/^releases\/gpt-live-avatar-(\d+\.\d+\.\d+)-(arm64|x64)\.dmg$/;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const usage='Usage: node tools/cloud/publish-release.cjs STORAGE_ACCOUNT_ID gpt-live-avatar-protected [--apply] [--retire-previous] [--dmg PATH] [--notes FILE] [--verify-live]';

function releaseNotes(info){
 const lines=[String(info.description||'').trim()];
 if(Array.isArray(info.highlights)&&info.highlights.length)lines.push('',...info.highlights.map(h=>'- '+String(h).trim()));
 return lines.join('\n').trim();
}
function installerKey(version,arch){return PREFIX+'gpt-live-avatar-'+version+'-'+arch+'.dmg';}
// releases/latest.json: what electron/releases.cjs reads. Validated with the
// same parser the app uses so a bad document never reaches users.
function buildLatest({version,arch='arm64',sha256,bytes,title,notes,publishedAt=new Date().toISOString()}){
 if(!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))throw Error('Only final semantic versions can be published.');
 if(!/^[a-f0-9]{64}$/.test(sha256||'')||!Number.isSafeInteger(bytes)||bytes<=0)throw Error('Invalid installer checksum or size.');
 const url=BASE_URL+installerKey(version,arch),file='GPT-Live Avatar-'+version+'-'+arch+'.dmg';
 const doc={version,title:String(title||'GPT-Live Avatar '+version).slice(0,160),notes:String(notes||'').slice(0,10000),publishedAt,
  arch,url,sha256,bytes,installers:{[arch]:{file,url,sha256,bytes}}};
 const parsed=installerDetails(doc,{platform:'darwin',arch});
 if(parsed.downloadURL!==url||parsed.sha256!==sha256||parsed.version!==version)throw Error('The release document does not round-trip through the app parser. Is electron/asset-download.json the deployed gateway?');
 return doc;
}
// Storage-cap plan across the account. Installers are immutable per version;
// older installers can be retired to make room (--retire-previous).
function planRelease({buckets,target,key,bytes,latestBytes,retirePrevious=false}){
 let current=0;const existing=new Map();
 for(const b of buckets)for(const p of b.objects){if(typeof p.key!=='string'||!Number.isSafeInteger(p.size)||p.size<0||p.storage_class!=='Standard')throw Error('Cannot verify account storage or storage class.');current+=p.size;if(b.name===target)existing.set(p.key,p);}
 if(!buckets.some(b=>b.name===target))throw Error('The target bucket does not exist in this account.');
 const same=existing.get(key);
 if(same&&same.size!==bytes)throw Error('An installer for this version already exists with a different size. Installers are immutable; bump the version.');
 const previous=[...existing.values()].filter(p=>INSTALLER.test(p.key)&&p.key!==key);
 const previousBytes=previous.reduce((n,p)=>n+p.size,0);
 const upload=same?0:bytes;
 const latest=existing.get(PREFIX+'latest.json');
 // Old and new latest.json coexist briefly; the new installer is added before anything is removed when it fits.
 const peakWithout=current+upload+latestBytes+(latest?latest.size:0);
 let retireFirst=false,peak=peakWithout;
 if(peakWithout>CAP){
  if(!retirePrevious||!previous.length||peakWithout-previousBytes>CAP)throw Error(`Upload blocked: ${peakWithout} bytes would exceed the ${CAP}-byte storage cap.${previous.length&&!retirePrevious?' Rerun with --retire-previous to remove '+previous.map(p=>p.key).join(', ')+' first.':' Retire verified old assets first.'}`);
  retireFirst=true;peak=peakWithout-previousBytes;
 }
 return {current,peak,reuse:!!same,previous:previous.map(p=>p.key),previousBytes,retireFirst,retire:retirePrevious?previous.map(p=>p.key):[]};
}
async function readCredential(account,bucket,credentialsPath){
 let credentials;
 try{credentials=JSON.parse(await fsp.readFile(credentialsPath,'utf8'));}
 catch(error){if(error.code==='ENOENT')return null;throw Error('Cannot read the scoped R2 writer credential.');}
 const credential=value=>typeof value==='string'&&/^[\x21-\x7e]{16,256}$/.test(value);
 if(credentials?.account!==account||credentials?.bucket!==bucket||credentials?.permission!=='object-read-write'||!credential(credentials.accessKeyId)||!credential(credentials.secretAccessKey))throw Error('R2 writer credential must match this exact account and bucket and be object-read-write.');
 return credentials;
}
// S3-signed writes to the private bucket. Every request is re-signed on retry;
// bodies are buffers whose SHA-256 is sent so R2 rejects corrupted parts.
async function createS3Writer(account,bucket,{credentialsPath=path.join(directory,'r2-writer-secret.json'),fetcher=fetch,wait=delay,concurrency=4,partBytes=PART_BYTES}={}){
 const credentials=await readCredential(account,bucket,credentialsPath);if(!credentials)return null;
 const {AwsClient}=require('aws4fetch');
 const client=new AwsClient({accessKeyId:credentials.accessKeyId,secretAccessKey:credentials.secretAccessKey,service:'s3',region:'auto',retries:0});
 const objectURL=key=>`https://${account}.r2.cloudflarestorage.com/${bucket}/${key}`;
 async function send(make,expect=[200]){
  for(let attempt=0;attempt<4;attempt++){
   let response;
   try{response=await fetcher(await make(),{redirect:'manual',signal:AbortSignal.timeout(10*60*1000)});}
   catch{if(attempt===3)throw Error('R2 request interrupted after 4 attempts.');await wait(1000*2**attempt);continue;}
   if(expect.includes(response.status))return response;
   const status=response.status;try{await response.body?.cancel();}catch{}
   if(attempt===3||!RETRIABLE.includes(status))throw Error(`R2 request failed (HTTP ${status}).`);
   await wait(1000*2**attempt);
  }
 }
 const {createR2Reader}=await import('./r2-reader.mjs');
 const reader=createR2Reader({R2_STORAGE_ACCOUNT:account,R2_BUCKET:bucket,R2_READ_ACCESS_KEY_ID:credentials.accessKeyId,R2_READ_SECRET_ACCESS_KEY:credentials.secretAccessKey},request=>send(()=>request));
 return {
  get:key=>reader.get(key),
  async put(key,body,contentType){
   const digest=crypto.createHash('sha256').update(body).digest('hex');
   await (await send(()=>client.sign(objectURL(key),{method:'PUT',body,headers:{'Content-Type':contentType,'X-Amz-Content-Sha256':digest}}))).body?.cancel();
  },
  async delete(key){await (await send(()=>client.sign(objectURL(key),{method:'DELETE'}),[204,200])).body?.cancel();},
  async putLarge(key,file,bytes,contentType,{onPart}={}){
   const count=Math.ceil(bytes/partBytes);if(count<1)throw Error('Empty installer.');
   const created=await send(()=>client.sign(objectURL(key)+'?uploads',{method:'POST',headers:{'Content-Type':contentType}}));
   const uploadId=/<UploadId>([^<]+)<\/UploadId>/.exec(await created.text())?.[1];if(!uploadId)throw Error('R2 did not start the multipart upload.');
   const handle=await fsp.open(file,'r');const etags=new Array(count);
   try{
    let next=0,failed=false;
    const workers=Array.from({length:Math.min(concurrency,count)},async()=>{
     while(!failed&&next<count){
      const index=next++,offset=index*partBytes,length=Math.min(partBytes,bytes-offset),buffer=Buffer.alloc(length);
      try{
       let filled=0;while(filled<length){const {bytesRead}=await handle.read(buffer,filled,length-filled,offset+filled);if(!bytesRead)throw Error('The installer changed while uploading.');filled+=bytesRead;}
       const digest=crypto.createHash('sha256').update(buffer).digest('hex');
       const response=await send(()=>client.sign(objectURL(key)+'?partNumber='+(index+1)+'&uploadId='+encodeURIComponent(uploadId),{method:'PUT',body:buffer,headers:{'X-Amz-Content-Sha256':digest}}));
       const etag=response.headers.get('ETag');try{await response.body?.cancel();}catch{}
       if(!etag)throw Error('R2 returned no ETag for an upload part.');
       etags[index]=etag;onPart?.(index+1,count);
      }catch(error){failed=true;throw error;}
     }
    });
    const results=await Promise.allSettled(workers);const rejected=results.find(r=>r.status==='rejected');if(rejected)throw rejected.reason;
    const xml='<CompleteMultipartUpload>'+etags.map((etag,i)=>`<Part><PartNumber>${i+1}</PartNumber><ETag>${etag.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</ETag></Part>`).join('')+'</CompleteMultipartUpload>';
    const complete=await send(()=>client.sign(objectURL(key)+'?uploadId='+encodeURIComponent(uploadId),{method:'POST',body:xml,headers:{'Content-Type':'application/xml'}}));
    if(/<Error>/.test(await complete.text()))throw Error('R2 could not complete the multipart upload.');
   }catch(error){
    try{await send(()=>client.sign(objectURL(key)+'?uploadId='+encodeURIComponent(uploadId),{method:'DELETE'}),[204,200]);}catch{}
    throw error;
   }finally{await handle.close();}
  },
 };
}
async function verifyLive(doc,{fetcher=fetch,baseURL=BASE_URL}={}){
 const get=(url,init={})=>fetcher(url,{redirect:'error',signal:AbortSignal.timeout(30000),...init});
 const latest=await get(baseURL+PREFIX+'latest.json');
 if(latest.status===401){await latest.body?.cancel();throw Error('The deployed gateway has no public release routes yet. Run node tools/cloud/prepare-worker.cjs GATEWAY_ACCOUNT_ID and node tools/cloud/deploy.cjs --workers-free-confirmed, then rerun with --verify-live.');}
 if(!latest.ok)throw Error(`The live release listing failed (HTTP ${latest.status}).`);
 const live=await latest.json();
 if(live.version!==doc.version||live.sha256!==doc.sha256||live.url!==doc.url)throw Error('The live latest.json is not the release just published.');
 if(!installerDetails(live,{platform:'darwin',arch:doc.arch}).downloadURL)throw Error('The live latest.json does not offer this installer.');
 const head=await get(doc.url,{method:'HEAD'});await head.body?.cancel();
 if(head.status!==200||Number(head.headers.get('Content-Length'))!==doc.bytes)throw Error('The live installer is missing or has the wrong size.');
 const page=await get(baseURL+PREFIX);await page.body?.cancel();if(page.status!==200)throw Error('The release page is not being served.');
 const closed=await get(baseURL+'index.json');await closed.body?.cancel();if(closed.status!==401)throw Error('The gateway must keep rejecting unauthenticated catalogue reads.');
}
function parseArguments(argv){
 const [account,bucket]=argv;if(!/^[a-f0-9]{32}$/.test(account||'')||!/^gpt-live-avatar-protected$/.test(bucket||''))throw Error(usage);
 const flags={apply:false,retirePrevious:false,verifyLive:false,dmg:null,notes:null};
 for(let i=2;i<argv.length;i++){
  const a=argv[i];
  if(a==='--apply')flags.apply=true;else if(a==='--retire-previous')flags.retirePrevious=true;else if(a==='--verify-live')flags.verifyLive=true;
  else if(a==='--dmg'&&argv[i+1])flags.dmg=argv[++i];else if(a==='--notes'&&argv[i+1])flags.notes=argv[++i];else throw Error(usage);
 }
 return {account,bucket,...flags};
}
async function main(){
 const options=parseArguments(process.argv.slice(2));
 if(!/^https:\/\/[-a-z0-9.]+\/$/.test(BASE_URL||''))throw Error('electron/asset-download.json has no deployed HTTPS gateway.');
 const version=require(path.join(repo,'package.json')).version,info=require(path.join(repo,'electron/release-info.json'));
 if(info.version!==version)throw Error(`electron/release-info.json describes ${info.version}, not ${version}.`);
 const arch='arm64',dmg=path.resolve(options.dmg||path.join(repo,'dist',`GPT-Live Avatar-${version}-${arch}.dmg`));
 if(!fs.existsSync(dmg))throw Error('Build the signed installer first (npm run dmg): '+dmg);
 const bytes=fs.statSync(dmg).size,sha256=await hash(dmg),key=installerKey(version,arch);
 const notes=options.notes?fs.readFileSync(options.notes,'utf8').trim():releaseNotes(info);
 const doc=buildLatest({version,arch,sha256,bytes,title:info.title,notes}),latestBody=Buffer.from(JSON.stringify(doc,null,2)+'\n');
 if(options.verifyLive){await verifyLive(doc);console.log('The live gateway serves this release: '+doc.url);return;}
 const token=cloudflareToken(),client=createCloudflareClient(options.account,token),buckets=await accountInventory(client);
 const plan=planRelease({buckets,target:options.bucket,key,bytes,latestBytes:latestBody.length,retirePrevious:options.retirePrevious});
 const writer=await createS3Writer(options.account,options.bucket),s3Reader=await createScopedS3Reader(options.account,options.bucket);
 console.log(JSON.stringify({mode:options.apply?'publish':'dry-run',version,installer:path.basename(dmg),bytes,sha256,key,url:doc.url,reuseExistingInstaller:plan.reuse,retire:plan.retire,retireBeforeUpload:plan.retireFirst,currentAccountBytes:plan.current,maximumAccountBytes:plan.peak,cap:CAP,writerCredential:!!writer}));
 if(!options.apply)return;
 if(!writer)throw Error('Save build/protected/r2-writer-secret.json (bucket-scoped Object Read & Write, permission "object-read-write", mode 600) before publishing.');
 const remote=s3Reader||(item=>writer.get(item.file));
 const retire=async()=>{for(const old of plan.retire){await writer.delete(old);console.log('Retired '+old);}};
 if(plan.retireFirst){console.log('Retiring previous installers first; their download links stop working until this publish completes.');await retire();}
 if(plan.reuse)console.log('An installer with this name and size already exists; verifying it instead of uploading.');
 else{let shown=0;await writer.putLarge(key,dmg,bytes,'application/x-apple-diskimage',{onPart:(n,count)=>{if(++shown%4===0||shown===count)console.log(`Uploaded part ${shown}/${count}`);}});}
 await verifyRemoteObject({file:key,bytes,sha256},remote);console.log('Verified remote installer checksum.');
 await writer.put(PREFIX+'latest.json',latestBody,'application/json');
 await verifyRemoteObject({file:PREFIX+'latest.json',bytes:latestBody.length,sha256:crypto.createHash('sha256').update(latestBody).digest('hex')},remote);
 if(!plan.retireFirst)await retire();
 fs.writeFileSync(path.join(repo,'build',`SHA256SUMS-${version}.txt`),`${sha256}  ${doc.installers[arch].file}\n`);
 fs.writeFileSync(path.join(repo,'build',`published-release-${version}.json`),JSON.stringify({account:options.account,bucket:options.bucket,key,publishedAt:doc.publishedAt,bytes,sha256,url:doc.url,latest:doc},null,2)+'\n');
 await verifyLive(doc);
 console.log('Published and verified on the live gateway: '+doc.url);
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={releaseNotes,buildLatest,planRelease,createS3Writer,verifyLive,installerKey,parseArguments,PREFIX,PART_BYTES};
