'use strict';
// Owner-side uploader. Dry run by default; only encrypted inventory entries
// can be uploaded. No credentials, raw source files or full duplicate packs.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const {hash}=require('../build-protected-assets.cjs');
const {storageCapBytes:CAP}=require('../../electron/asset-download.json');
const directory=path.resolve(__dirname,'../../build/protected');
function plan(inventory,buckets,target){
 if(!Array.isArray(inventory.objects)||new Set(inventory.objects.map(x=>x.file)).size!==inventory.objects.length)throw Error('Invalid upload inventory.');
 for(const p of inventory.objects)if(!/^(index\.json|[-a-z0-9]+\.gla\.p\d{3})$/.test(p.file)||!Number.isSafeInteger(p.bytes)||p.bytes<=0||p.bytes>64*1024*1024||! /^[a-f0-9]{64}$/.test(p.sha256))throw Error('Only verified protected download parts are allowed.');
 let current=0;const existing=new Map();
 for(const b of buckets)for(const p of b.objects){if(typeof p.key!=='string'||!Number.isSafeInteger(p.size)||p.size<0||p.storage_class!=='Standard')throw Error('Cannot verify account storage or storage class.');current+=p.size;if(b.name===target)existing.set(p.key,p);}
 const missing=inventory.objects.filter(p=>!existing.has(p.file));
 // Include the old and new catalogue simultaneously for a conservative peak.
 const peak=current+missing.reduce((n,p)=>n+p.bytes,0)+(existing.has('index.json')?inventory.objects.find(p=>p.file==='index.json').bytes:0);
 if(peak>CAP)throw Error(`Upload blocked: ${peak} bytes would exceed the ${CAP}-byte storage cap. Retire a verified old release first.`);
 return {current,peak,existing,missing};
}
async function main(){
 const [account,bucket]=process.argv.slice(2);if(!/^[a-f0-9]{32}$/.test(account||'')||!/^gpt-live-avatar-protected$/.test(bucket||''))throw Error('Usage: node tools/cloud/upload-r2.cjs ACCOUNT_ID gpt-live-avatar-protected [--apply]');
 const inventory=JSON.parse(fs.readFileSync(path.join(directory,'inventory.json')));
 const token=process.env.CLOUDFLARE_API_TOKEN||JSON.parse(cp.execFileSync(process.env.WRANGLER_BIN||'wrangler',['auth','token','--json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']})).token;
 if(!token)throw Error('Sign in to Wrangler first.');
 const prefix=`https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets`;
 const delay=ms=>new Promise(r=>setTimeout(r,ms));
 async function request(suffix,init={}){
  for(let attempt=0;attempt<4;attempt++){
   let response;try{response=await fetch(prefix+suffix,{...init,body:typeof init.body==='function'?init.body():init.body,headers:{Authorization:'Bearer '+token,...init.headers},redirect:'error',signal:AbortSignal.timeout(5*60*1000)});}catch(e){if(attempt===3)throw e;await delay(1000*2**attempt);continue;}
   if(response.ok)return response;
   const status=response.status;await response.body?.cancel();if(attempt===3||![408,429,500,502,503,504,520,521,522,523,524].includes(status))throw Error(`Cloudflare request failed (HTTP ${status}).`);
   await delay(1000*2**attempt);
  }
 }
 async function json(suffix,init){const data=await (await request(suffix,init)).json();if(data.success!==true)throw Error('Cloudflare could not complete this storage request.');return data;}
 const list=await json(''),buckets=[];if(!Array.isArray(list.result?.buckets)||list.result_info?.is_truncated)throw Error('Cannot verify the complete account bucket inventory.');
 for(const b of list.result.buckets){if(b.jurisdiction&&b.jurisdiction!=='default')throw Error('Account has other storage jurisdictions; verify their usage before uploading.');let cursor='',objects=[];do{const result=await json('/'+encodeURIComponent(b.name)+'/objects'+(cursor?'?cursor='+encodeURIComponent(cursor):''));if(!Array.isArray(result.result))throw Error('Unexpected R2 object inventory.');objects.push(...result.result);const next=result.result_info?.is_truncated?result.result_info.cursor:'';if(result.result_info?.is_truncated&&(!next||next===cursor))throw Error('Incomplete R2 pagination.');cursor=next;}while(cursor);buckets.push({name:b.name,objects});}
 if(!buckets.some(b=>b.name===bucket))throw Error('Create the private Standard bucket after activating R2, then rerun.');
 const p=plan(inventory,buckets,bucket);console.log(JSON.stringify({mode:process.argv.includes('--apply')?'upload':'dry-run',objects:inventory.objects.length,releaseBytes:inventory.bytes,currentAccountBytes:p.current,maximumAccountBytes:p.peak,cap:CAP}));
 for(const item of inventory.objects){const file=path.join(directory,item.file);if(fs.statSync(file).size!==item.bytes||await hash(file)!==item.sha256)throw Error('Local package verification failed: '+item.file);}
 if(!process.argv.includes('--apply'))return;
 const remoteHash=async item=>{const r=await request('/'+bucket+'/objects/'+item.file);let bytes=0;const h=crypto.createHash('sha256');for await(const chunk of r.body){bytes+=chunk.length;if(bytes>item.bytes)throw Error('Remote size mismatch: '+item.file);h.update(chunk);}if(bytes!==item.bytes||h.digest('hex')!==item.sha256)throw Error('Remote verification failed: '+item.file);};
 let done=0;
 const upload=async item=>{
  const previous=p.existing.get(item.file);
  if(previous&&item.file!=='index.json'){if(previous.size!==item.bytes)throw Error('An immutable remote part has a different size. Build a new revision.');await remoteHash(item);}
  else{const response=await json('/'+bucket+'/objects/'+item.file,{method:'PUT',headers:{'Content-Type':'application/octet-stream','Content-Length':String(item.bytes),'cf-r2-storage-class':'Standard'},body:()=>fs.createReadStream(path.join(directory,item.file)),duplex:'half'});if(Number(response.result?.size)!==item.bytes||response.result?.storage_class!=='Standard')throw Error('Unexpected upload metadata.');await remoteHash(item);}
  console.log(`Verified ${++done}/${inventory.objects.length}: ${item.file}`);
 };
 const pending=inventory.objects.filter(x=>x.file!=='index.json');let next=0,failed=false;
 const workers=Array.from({length:4},async()=>{try{while(!failed&&next<pending.length){const item=pending[next++];await upload(item);}}catch(e){failed=true;throw e;}});
 const results=await Promise.allSettled(workers);const error=results.find(x=>x.status==='rejected');if(error)throw error.reason;
 await upload(inventory.objects.find(x=>x.file==='index.json'));
 fs.writeFileSync(path.join(directory,'r2-verified.json'),JSON.stringify({account,bucket,verifiedAt:new Date().toISOString(),files:inventory.objects.length,bytes:inventory.bytes,inventorySHA256:await hash(path.join(directory,'inventory.json'))},null,2));
 console.log('Every remote object matches its local SHA-256 checksum.');
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={plan};
