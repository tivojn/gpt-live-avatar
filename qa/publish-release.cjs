'use strict';
// Local-only publisher checks. No real credentials, Wrangler or cloud requests.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {releaseNotes,buildLatest,planRelease,createS3Writer,verifyLive,installerKey,parseArguments,PREFIX}=require('../tools/cloud/publish-release.cjs');
const {installerDetails}=require('../electron/releases.cjs');
const {baseURL,storageCapBytes:CAP}=require('../electron/asset-download.json');
const account='0123456789abcdef0123456789abcdef',bucket='gpt-live-avatar-protected';
let checks=0;
async function check(name,run){await run();checks++;console.log('PASS '+name);}
(async()=>{
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'gla-publisher-'));
 try{
  await check('release notes come from release-info.json',async()=>{
   assert.equal(releaseNotes({description:'Desc ',highlights:[' One','Two']}),'Desc\n\n- One\n- Two');
   assert.equal(releaseNotes({description:'Only'}),'Only');
  });
  const sha=crypto.createHash('sha256').update('installer').digest('hex');
  await check('latest.json round-trips through the app parser',async()=>{
   const doc=buildLatest({version:'0.2.22',sha256:sha,bytes:1047191904,title:'T',notes:'N',publishedAt:'2026-09-18T00:00:00.000Z'});
   assert.equal(doc.url,baseURL+'releases/gpt-live-avatar-0.2.22-arm64.dmg');assert.equal(doc.installers.arm64.file,'GPT-Live Avatar-0.2.22-arm64.dmg');
   const parsed=installerDetails(doc,{platform:'darwin',arch:'arm64'});assert.equal(parsed.downloadURL,doc.url);assert.equal(parsed.sha256,sha);
   assert.deepEqual(Object.keys(doc),['version','title','notes','publishedAt','arch','url','sha256','bytes','installers']);
   for(const version of ['v0.2.22','0.2.22-rc.1','0.2','../x'])assert.throws(()=>buildLatest({version,sha256:sha,bytes:1}),/final semantic/);
   assert.throws(()=>buildLatest({version:'0.2.22',sha256:'bad',bytes:1}),/checksum/);
  });
  const key=installerKey('0.2.22','arm64'),bytes=1_000_000_000,std=(k,size)=>({key:k,size,storage_class:'Standard'});
  await check('storage-cap plan keeps installers immutable and retires older ones only when asked',async()=>{
   const buckets=[{name:bucket,objects:[std('a.gla.p000',1000),std(PREFIX+'gpt-live-avatar-0.2.21-arm64.dmg',900_000_000),std(PREFIX+'latest.json',500)]},{name:'other',objects:[std('x',1)]}];
   const fits=planRelease({buckets,target:bucket,key,bytes,latestBytes:600});
   assert.equal(fits.current,900_001_501);assert.equal(fits.peak,900_001_501+bytes+600+500);assert.equal(fits.reuse,false);assert.deepEqual(fits.previous,[PREFIX+'gpt-live-avatar-0.2.21-arm64.dmg']);assert.deepEqual(fits.retire,[]);assert.equal(fits.retireFirst,false);
   const later=planRelease({buckets,target:bucket,key,bytes,latestBytes:600,retirePrevious:true});assert.deepEqual(later.retire,fits.previous);assert.equal(later.retireFirst,false,'Retire after publishing when the new installer fits');
   const reuse=planRelease({buckets:[{name:bucket,objects:[std(key,bytes)]}],target:bucket,key,bytes,latestBytes:600});assert.equal(reuse.reuse,true);assert.equal(reuse.peak,bytes+600);
   assert.throws(()=>planRelease({buckets:[{name:bucket,objects:[std(key,bytes-1)]}],target:bucket,key,bytes,latestBytes:600}),/immutable/);
   const full=[{name:bucket,objects:[std('parts',CAP-1_500_000_000),std(PREFIX+'gpt-live-avatar-0.2.21-arm64.dmg',900_000_000)]}];
   assert.throws(()=>planRelease({buckets:full,target:bucket,key,bytes,latestBytes:600}),/--retire-previous/);
   const tight=planRelease({buckets:full,target:bucket,key,bytes,latestBytes:600,retirePrevious:true});assert.equal(tight.retireFirst,true);assert.equal(tight.peak,CAP-1_500_000_000+bytes+600);
   assert.throws(()=>planRelease({buckets:[{name:bucket,objects:[std('parts',CAP)]}],target:bucket,key,bytes,latestBytes:600,retirePrevious:true}),/Retire verified old assets/);
   assert.throws(()=>planRelease({buckets:[{name:bucket,objects:[{key:'x',size:1,storage_class:'InfrequentAccess'}]}],target:bucket,key,bytes,latestBytes:1}),/storage class/);
   assert.throws(()=>planRelease({buckets:[{name:'other',objects:[]}],target:bucket,key,bytes,latestBytes:1}),/does not exist/);
  });
  await check('missing or wrongly scoped writer credentials never upload',async()=>{
   assert.equal(await createS3Writer(account,bucket,{credentialsPath:path.join(temporary,'missing.json')}),null);
   const wrong=path.join(temporary,'wrong.json');fs.writeFileSync(wrong,JSON.stringify({account,bucket,permission:'object-read-only',accessKeyId:'a'.repeat(20),secretAccessKey:'b'.repeat(40)}));
   await assert.rejects(createS3Writer(account,bucket,{credentialsPath:wrong}),/object-read-write/);
  });
  const credentialsPath=path.join(temporary,'writer.json');fs.writeFileSync(credentialsPath,JSON.stringify({account,bucket,permission:'object-read-write',accessKeyId:'AKIAFIXTURE0000000000',secretAccessKey:'fixture-secret-fixture-secret-fixture'}));
  const partBytes=64*1024,installer=crypto.randomBytes(partBytes*3+4321),file=path.join(temporary,'GPT-Live Avatar-0.2.22-arm64.dmg');fs.writeFileSync(file,installer);
  const origin=`https://${account}.r2.cloudflarestorage.com/${bucket}/`;
  function mockBucket({failPart=null,flakyPart=null}={}){
   const state={parts:new Map(),requests:[],aborted:false,completed:null,objects:new Map(),deleted:[],flaked:false};
   const fetcher=async(request,init)=>{
    assert(request instanceof Request);assert.equal(init.redirect,'manual');assert(request.headers.get('Authorization')?.startsWith('AWS4-HMAC-SHA256 '),'Requests are SigV4 signed');
    assert(!request.headers.get('Authorization').includes('fixture-secret'),'The secret never leaves the signer');
    const url=new URL(request.url);state.requests.push(request.method+' '+url.pathname+url.search);
    assert(url.href.startsWith(origin));const name=url.pathname.slice(('/'+bucket+'/').length);
    if(request.method==='POST'&&url.searchParams.has('uploads'))return new Response(`<?xml version="1.0"?><InitiateMultipartUploadResult><Bucket>${bucket}</Bucket><Key>${name}</Key><UploadId>upload-1</UploadId></InitiateMultipartUploadResult>`);
    if(request.method==='PUT'&&url.searchParams.has('partNumber')){
     assert.equal(url.searchParams.get('uploadId'),'upload-1');const number=Number(url.searchParams.get('partNumber')),body=Buffer.from(await request.arrayBuffer());
     assert.equal(request.headers.get('x-amz-content-sha256'),crypto.createHash('sha256').update(body).digest('hex'),'Each part carries its own checksum');
     if(failPart===number)return new Response('',{status:400});
     if(flakyPart===number&&!state.flaked){state.flaked=true;return new Response('',{status:503});}
     state.parts.set(number,body);return new Response(null,{headers:{ETag:'"etag-'+number+'"'}});
    }
    if(request.method==='POST'&&url.searchParams.has('uploadId')){state.completed=await request.text();const ordered=[...state.parts.keys()].sort((a,b)=>a-b).map(n=>state.parts.get(n));state.objects.set(name,Buffer.concat(ordered));return new Response('<CompleteMultipartUploadResult/>');}
    if(request.method==='DELETE'&&url.searchParams.has('uploadId')){state.aborted=true;return new Response(null,{status:204});}
    if(request.method==='DELETE'){state.deleted.push(name);state.objects.delete(name);return new Response(null,{status:204});}
    if(request.method==='PUT'){const body=Buffer.from(await request.arrayBuffer());assert.equal(request.headers.get('x-amz-content-sha256'),crypto.createHash('sha256').update(body).digest('hex'));state.objects.set(name,body);return new Response(null,{headers:{ETag:'"x"'}});}
    if(request.method==='GET'){const body=state.objects.get(name);if(!body)return new Response('',{status:404});return new Response(body,{headers:{'Content-Length':String(body.length)}});}
    return new Response('',{status:405});
   };
   return {state,fetcher};
  }
  await check('multipart upload sends every part with checksums, completes in order and reads back',async()=>{
   const {state,fetcher}=mockBucket();const waits=[];
   const writer=await createS3Writer(account,bucket,{credentialsPath,fetcher,partBytes,concurrency:2,wait:async ms=>waits.push(ms)});
   const progress=[];await writer.putLarge(key,file,installer.length,'application/x-apple-diskimage',{onPart:(n,count)=>progress.push([n,count])});
   assert.equal(state.parts.size,4);assert.deepEqual(progress.map(p=>p[1]),[4,4,4,4]);
   assert.equal(state.completed,'<CompleteMultipartUpload>'+[1,2,3,4].map(n=>`<Part><PartNumber>${n}</PartNumber><ETag>"etag-${n}"</ETag></Part>`).join('')+'</CompleteMultipartUpload>');
   assert(state.objects.get(key).equals(installer),'Reassembled object equals the installer');assert.equal(state.aborted,false);assert.deepEqual(waits,[]);
   const read=await writer.get(key);assert.equal(read.size,installer.length);assert(Buffer.from(await new Response(read.body).arrayBuffer()).equals(installer));
   await writer.put(PREFIX+'latest.json',Buffer.from('{}'),'application/json');assert.equal(state.objects.get(PREFIX+'latest.json').toString(),'{}');
   await writer.delete(PREFIX+'gpt-live-avatar-0.2.21-arm64.dmg');assert.deepEqual(state.deleted,[PREFIX+'gpt-live-avatar-0.2.21-arm64.dmg']);
  });
  await check('a failed part aborts the multipart upload',async()=>{
   const {state,fetcher}=mockBucket({failPart:3});
   const writer=await createS3Writer(account,bucket,{credentialsPath,fetcher,partBytes,concurrency:1,wait:async()=>{}});
   await assert.rejects(writer.putLarge(key,file,installer.length,'application/x-apple-diskimage'),/HTTP 400/);
   assert.equal(state.aborted,true);assert.equal(state.completed,null);assert(!state.objects.has(key));
  });
  await check('transient part failures are retried with backoff',async()=>{
   const {state,fetcher}=mockBucket({flakyPart:2});const waits=[];
   const writer=await createS3Writer(account,bucket,{credentialsPath,fetcher,partBytes,concurrency:1,wait:async ms=>waits.push(ms)});
   await writer.putLarge(key,file,installer.length,'application/x-apple-diskimage');
   assert.deepEqual(waits,[1000]);assert(state.objects.get(key).equals(installer));
  });
  const doc=buildLatest({version:'0.2.22',sha256:sha,bytes:installer.length,title:'T',notes:'N'});
  await check('live verification checks the public routes and the still-closed catalogue',async()=>{
   const live=(latest,{head=200,length=installer.length,page=200,catalogue=401}={})=>async(url,init={})=>{
    if(url===baseURL+'releases/latest.json')return latest instanceof Response?latest:new Response(JSON.stringify(latest));
    if(url===doc.url){assert.equal(init.method,'HEAD');return new Response(null,{status:head,headers:{'Content-Length':String(length)}});}
    if(url===baseURL+'releases/')return new Response('<!doctype html>',{status:page});
    if(url===baseURL+'index.json')return new Response('',{status:catalogue});
    throw Error('Unexpected URL '+url);
   };
   await verifyLive(doc,{fetcher:live(doc)});
   await assert.rejects(verifyLive(doc,{fetcher:live(new Response('',{status:401}))}),/prepare-worker/);
   await assert.rejects(verifyLive(doc,{fetcher:live({...doc,sha256:'b'.repeat(64)})}),/not the release just published/);
   await assert.rejects(verifyLive(doc,{fetcher:live(doc,{length:1})}),/wrong size/);
   await assert.rejects(verifyLive(doc,{fetcher:live(doc,{catalogue:200})}),/rejecting unauthenticated/);
  });
  await check('argument parsing',async()=>{
   assert.deepEqual(parseArguments([account,bucket]),{account,bucket,apply:false,retirePrevious:false,verifyLive:false,dmg:null,notes:null});
   assert.deepEqual(parseArguments([account,bucket,'--apply','--retire-previous','--dmg','x.dmg','--notes','n.md','--verify-live']),{account,bucket,apply:true,retirePrevious:true,verifyLive:true,dmg:'x.dmg',notes:'n.md'});
   assert.throws(()=>parseArguments(['bad',bucket]),/Usage/);assert.throws(()=>parseArguments([account,'other']),/Usage/);assert.throws(()=>parseArguments([account,bucket,'--force']),/Usage/);
  });
 }finally{fs.rmSync(temporary,{recursive:true,force:true});}
 console.log(`Release publisher verification: ${checks} local checks passed.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
