'use strict';
// Owner-side cleanup of superseded packs. Dry run by default. The gateway only
// serves objects named in the live signed inventory, so anything else in the
// bucket is unreachable by every app version and only costs storage. This
// removes exactly that remainder: never a live object, never an installer under
// releases/, and only packs that still have a verified local copy in
// build/protected (so a removed pack can always be uploaded again).
// Deletion in R2 is permanent; run with --apply only when the listed keys are
// the ones you mean to remove.
const fs=require('node:fs'),path=require('node:path');
const {hash}=require('../build-protected-assets.cjs');
const {cloudflareToken,createCloudflareClient,accountInventory}=require('./upload-r2.cjs');
const directory=path.resolve(__dirname,'../../build/protected');
const usage='Usage: node tools/cloud/prune-r2.cjs STORAGE_ACCOUNT_ID gpt-live-avatar-protected [--apply]';
const size=o=>o.size||o.bytes||0,key=o=>o.key||o.name||'';

// What may go: not live, not an installer, a pack part by name, and its pack is still on this Mac.
function plan(inventory,objects,hasLocal=name=>fs.existsSync(path.join(directory,name))){
 const live=new Set(inventory.objects.map(o=>o.file)),remove=[],keep=[];
 for(const o of objects){
  const name=key(o),pack=name.replace(/\.p\d{3}$/,'');
  if(live.has(name)||name.startsWith('releases/')||!/^[-a-z0-9.]+\.gla(\.p\d{3})?$/.test(name)){keep.push({key:name,bytes:size(o),why:live.has(name)?'live':'not a superseded pack'});continue;}
  if(!hasLocal(pack)){keep.push({key:name,bytes:size(o),why:'no local copy'});continue;}
  remove.push({key:name,bytes:size(o)});
 }
 return {remove,keep,removeBytes:remove.reduce((n,o)=>n+o.bytes,0),liveMissing:[...live].filter(name=>!objects.some(o=>key(o)===name))};
}
async function main(){
 const [account,bucket]=process.argv.slice(2);if(!/^[a-f0-9]{32}$/.test(account||'')||bucket!=='gpt-live-avatar-protected')throw Error(usage);
 const inventory=JSON.parse(fs.readFileSync(path.join(directory,'inventory.json'))),verified=JSON.parse(fs.readFileSync(path.join(directory,'r2-verified.json')));
 if(verified.account!==account||verified.inventorySHA256!==await hash(path.join(directory,'inventory.json')))throw Error('The local inventory is not the one verified in this account. Upload and verify the current release first.');
 const {request,json}=createCloudflareClient(account,cloudflareToken());
 const target=(await accountInventory({json})).find(b=>b.name===bucket);if(!target)throw Error('Bucket not found.');
 const p=plan(inventory,target.objects);
 if(p.liveMissing.length)throw Error('The bucket is missing live objects ('+p.liveMissing.slice(0,3).join(', ')+'). Nothing was removed.');
 const before=target.objects.reduce((n,o)=>n+size(o),0);
 console.log(JSON.stringify({mode:process.argv.includes('--apply')?'delete':'dry-run',objects:p.remove.length,removeBytes:p.removeBytes,bucketBytes:before,afterBytes:before-p.removeBytes,keptNotLive:p.keep.filter(k=>k.why!=='live')}));
 for(const o of p.remove)console.log((o.bytes/1e6).toFixed(0).padStart(6)+' MB  '+o.key);
 if(!process.argv.includes('--apply')){console.log('Dry run: nothing was removed. Add --apply to delete these '+p.remove.length+' objects permanently.');return;}
 let done=0;for(const o of p.remove){await (await request('/'+bucket+'/objects/'+o.key,{method:'DELETE'})).body?.cancel();console.log('Removed '+(++done)+'/'+p.remove.length+': '+o.key);}
 const after=(await accountInventory({json})).find(b=>b.name===bucket),missing=inventory.objects.filter(i=>!after.objects.some(o=>key(o)===i.file));
 if(missing.length)throw Error('Live objects are missing after cleanup: '+missing.map(m=>m.file).join(', '));
 console.log('Removed '+done+' superseded objects. All '+inventory.objects.length+' live objects are present; the bucket now holds '+(after.objects.reduce((n,o)=>n+size(o),0)/1e9).toFixed(2)+' GB.');
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={plan};
