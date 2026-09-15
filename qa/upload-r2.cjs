'use strict';
// Local-only uploader checks. No real credentials, Wrangler, or cloud requests.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {verifyRemoteObject,createScopedS3Reader}=require('../tools/cloud/upload-r2.cjs');
const payload=Buffer.from('A streamed checksum must restart after interruption. '.repeat(2048));
const item={file:'fixture-base.gla.p000',bytes:payload.length,sha256:crypto.createHash('sha256').update(payload).digest('hex')};
const body=data=>new Response(data).body;
let checks=0;
async function check(name,run){await run();checks++;console.log('PASS '+name);}
(async()=>{
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'gla-uploader-'));
 let server;
 try{
  await check('real HTTP body disconnects discard partial hashes and retry whole GETs',async()=>{
   let reads=0;const delays=[],pending=new Map();
   server=http.createServer((req,res)=>{
    const index=++reads;
    res.writeHead(200,{'Content-Length':String(payload.length)});
    if(index<=2){pending.set(index,res);res.write(payload.subarray(0,913));}
    else res.end(payload);
   });
   await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
   const url='http://127.0.0.1:'+server.address().port;
   let fetches=0;
   await verifyRemoteObject(item,async()=>{
    const index=++fetches,response=await fetch(url);
    // Destroy only after fetch returned headers, so this exercises body retry.
    if(index<=2)setTimeout(()=>pending.get(index).destroy(),10);
    return response;
   },{wait:async ms=>delays.push(ms)});
   assert.equal(fetches,3);assert.equal(reads,3);assert.deepEqual(delays,[1000,2000]);
   server.closeAllConnections();await new Promise(resolve=>server.close(resolve));server=null;
  });
  for(const name of ['TimeoutError','AbortError'])await check(name+' while reading retries from byte zero',async()=>{
   let reads=0;const delays=[];
   await verifyRemoteObject(item,async()=>({body:++reads===1?(async function*(){yield payload.subarray(0,703);throw new DOMException('interrupted',name);})():body(payload)}),{wait:async ms=>delays.push(ms)});
   assert.equal(reads,2);assert.deepEqual(delays,[1000]);
  });
  await check('socket-cause exhaustion is bounded and sanitized',async()=>{
   let reads=0;const delays=[];
   const promise=verifyRemoteObject(item,async()=>{reads++;return {body:(async function*(){yield payload.subarray(0,13);throw Object.assign(new TypeError('private-signed-request'),{cause:{code:'UND_ERR_SOCKET'}});})()};},{wait:async ms=>delays.push(ms)});
   await assert.rejects(promise,error=>/after 4 attempts/.test(error.message)&&!error.message.includes('private-signed-request'));
   assert.equal(reads,4);assert.deepEqual(delays,[1000,2000,4000]);
  });
  const corrupt=Buffer.from(payload);corrupt[101]^=1;
  for(const [name,data] of [['hash mismatch',corrupt],['short clean EOF',payload.subarray(0,-1)],['oversized object',Buffer.concat([payload,Buffer.from('x')])]])await check(name+' stays fatal without retry',async()=>{
   let reads=0;
   await assert.rejects(verifyRemoteObject(item,async()=>{reads++;return {body:body(data)};},{wait:async()=>assert.fail('integrity errors must not retry')}),/Remote (verification failed|size mismatch)/);
   assert.equal(reads,1);
  });
  await check('unrelated stream error stays fatal',async()=>{
   const error=new RangeError('unexpected application error');let reads=0;
   await assert.rejects(verifyRemoteObject(item,async()=>{reads++;return {body:(async function*(){throw error;})()};},{wait:async()=>assert.fail('unexpected errors must not retry')}),e=>e===error);
   assert.equal(reads,1);
  });
  await check('header failures are not multiplied by body retries',async()=>{
   const error=new DOMException('already retried by readObject','TimeoutError');let reads=0;
   await assert.rejects(verifyRemoteObject(item,async()=>{reads++;throw error;},{wait:async()=>assert.fail('request already owns retries')}),e=>e===error);
   assert.equal(reads,1);
  });
  const account='a'.repeat(32),bucket='gpt-live-avatar-protected',credentialsPath=path.join(temporary,'reader.json');
  const valid={account,bucket,permission:'object-read-only',accessKeyId:'b'.repeat(32),secretAccessKey:'c'.repeat(64)};
  const noFetch=async()=>assert.fail('invalid/absent credentials must not issue requests');
  await check('absent scoped credential permits API fallback',async()=>assert.equal(await createScopedS3Reader(account,bucket,{credentialsPath,fetcher:noFetch}),null));
  await check('malformed or mismatched scoped credentials fail before network',async()=>{
   fs.writeFileSync(credentialsPath,'private-invalid-json');
   await assert.rejects(createScopedS3Reader(account,bucket,{credentialsPath,fetcher:noFetch}),error=>error.message==='Cannot read the scoped R2 checksum credential.');
   for(const change of [{account:'d'.repeat(32)},{bucket:'other-private'},{permission:'admin'},{accessKeyId:''},{secretAccessKey:'bad\nvalue'},null]){
    fs.writeFileSync(credentialsPath,JSON.stringify(change===null?null:{...valid,...change}));
    await assert.rejects(createScopedS3Reader(account,bucket,{credentialsPath,fetcher:noFetch}),/match this exact account and bucket and be object-read-only/);
   }
  });
  fs.writeFileSync(credentialsPath,JSON.stringify(valid));
  await check('scoped S3 is signed GET with manual redirect and verifies SHA',async()=>{
   let requests=0;
   const reader=await createScopedS3Reader(account,bucket,{credentialsPath,fetcher:async(request,init)=>{
    requests++;assert.equal(request.method,'GET');assert.equal(request.redirect,'manual');assert.equal(init.redirect,'manual');assert(init.signal instanceof AbortSignal);
    assert.equal(request.url,`https://${account}.r2.cloudflarestorage.com/${bucket}/${item.file}`);
    assert.match(request.headers.get('Authorization'),/^AWS4-HMAC-SHA256 /);
    return new Response(payload,{headers:{'Content-Length':String(payload.length)}});
   }});
   await verifyRemoteObject(item,reader);assert.equal(requests,1);
  });
  await check('S3 transient HTTP failure retries at the request layer',async()=>{
   let requests=0;const waits=[];
   const reader=await createScopedS3Reader(account,bucket,{credentialsPath,wait:async ms=>waits.push(ms),fetcher:async()=>++requests===1?new Response('temporary',{status:503}):new Response(payload,{headers:{'Content-Length':String(payload.length)}})});
   await verifyRemoteObject(item,reader);assert.equal(requests,2);assert.deepEqual(waits,[1000]);
  });
  await check('S3 redirects are never followed or retried',async()=>{
   let requests=0;
   const reader=await createScopedS3Reader(account,bucket,{credentialsPath,wait:async()=>assert.fail('redirect cannot retry'),fetcher:async()=>{requests++;return new Response(null,{status:302,headers:{Location:'https://example.invalid/'}});}});
   await assert.rejects(verifyRemoteObject(item,reader),/HTTP 302/);assert.equal(requests,1);
  });
  await check('S3 declared size mismatch stays fatal',async()=>{
   let requests=0;
   const reader=await createScopedS3Reader(account,bucket,{credentialsPath,fetcher:async()=>{requests++;return new Response(payload,{headers:{'Content-Length':String(payload.length+1)}});}});
   await assert.rejects(verifyRemoteObject(item,reader,{wait:async()=>assert.fail('size mismatch cannot retry')}),/Remote size mismatch/);assert.equal(requests,1);
  });
  await check('S3 header transport exhaustion has four total requests and no credential output',async()=>{
   let requests=0;const waits=[];
   const reader=await createScopedS3Reader(account,bucket,{credentialsPath,wait:async ms=>waits.push(ms),fetcher:async()=>{requests++;throw Error('private-key='+valid.secretAccessKey);}});
   await assert.rejects(verifyRemoteObject(item,reader,{wait:async()=>assert.fail('must not multiply header retries')}),error=>error.message==='R2 checksum request interrupted after 4 attempts.');
   assert.equal(requests,4);assert.deepEqual(waits,[1000,2000,4000]);
  });
  await check('S3 body interruptions reuse bounded checksum retry',async()=>{
   let requests=0;const waits=[];
   const reader=await createScopedS3Reader(account,bucket,{credentialsPath,fetcher:async()=>{
    requests++;if(requests===1){const stream=new ReadableStream({start(controller){controller.enqueue(payload.subarray(0,19));queueMicrotask(()=>controller.error(new DOMException('time limit','TimeoutError')));}});return new Response(stream,{headers:{'Content-Length':String(payload.length)}});}
    return new Response(payload,{headers:{'Content-Length':String(payload.length)}});
   }});
   await verifyRemoteObject(item,reader,{wait:async ms=>waits.push(ms)});assert.equal(requests,2);assert.deepEqual(waits,[1000]);
  });
  console.log(`Uploader verification: ${checks} local checks passed.`);
 }finally{if(server){server.closeAllConnections();server.close();}fs.rmSync(temporary,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
