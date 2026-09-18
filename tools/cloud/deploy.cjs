'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const {hash}=require('../build-protected-assets.cjs');
const repo=path.resolve(__dirname,'../..'),dir=path.join(repo,'build/protected');
(async()=>{
 if(!process.argv.includes('--workers-free-confirmed'))throw Error('Confirm this account is on Workers Free in Cloudflare before deploying. Paid Workers has no hard request cutoff.');
 const config=JSON.parse(fs.readFileSync(path.join(dir,'worker/wrangler.jsonc'))),verified=JSON.parse(fs.readFileSync(path.join(dir,'r2-verified.json')));
 const storageAccount=config.vars?.R2_STORAGE_ACCOUNT||config.account_id;
 if(verified.account!==storageAccount||verified.inventorySHA256!==await hash(path.join(dir,'inventory.json')))throw Error('Upload and verify this exact release in the selected storage account first.');
 let storageSecrets={};
 if(storageAccount!==config.account_id){
  const credentials=JSON.parse(fs.readFileSync(path.join(dir,'r2-reader-secret.json')));
  if(credentials.account!==storageAccount||credentials.bucket!==verified.bucket||credentials.permission!=='object-read-only'||!credentials.accessKeyId||!credentials.secretAccessKey)throw Error('A bucket-scoped read-only R2 credential is required.');
  storageSecrets={R2_READ_ACCESS_KEY_ID:credentials.accessKeyId,R2_READ_SECRET_ACCESS_KEY:credentials.secretAccessKey};
 }
 const cli=process.env.WRANGLER_BIN||'wrangler';
 const run=(args,input)=>cp.execFileSync(cli,[...args,'--config',path.join(dir,'worker/wrangler.jsonc')],{encoding:'utf8',input,stdio:['pipe','pipe','pipe']});
 const output=run(['deploy']),urls=output.match(/https:\/\/gpt-live-avatar-downloads\.[-a-z0-9]+\.workers\.dev/g);if(!urls?.length)throw Error('Deployment completed but the public gateway URL was not returned. Verify it before configuring the app.');
 const baseURL=urls.at(-1)+'/',privateBuild=JSON.parse(fs.readFileSync(path.join(dir,'private-build.json')));
 run(['secret','bulk'],JSON.stringify({DOWNLOAD_TOKEN:privateBuild.downloadToken,CONTENT_KEYS:JSON.stringify(privateBuild.keys),...storageSecrets}));
 const response=await fetch(baseURL+'index.json',{headers:{Authorization:'Bearer '+privateBuild.downloadToken},redirect:'error',signal:AbortSignal.timeout(15000)}),envelope=await response.json();
 if(!response.ok||!crypto.verify(null,Buffer.from(envelope.payload),privateBuild.publicKey,Buffer.from(envelope.signature,'base64')))throw Error('The live signed catalogue did not verify.');
 if(envelope.payload!==JSON.parse(fs.readFileSync(path.join(dir,'index.json'))).payload)throw Error('The live catalogue is not the uploaded release.');
 if((await fetch(baseURL+'index.json',{redirect:'error'})).status!==401)throw Error('The gateway must reject unauthenticated downloads.');
 // Public installer routes need no token; 404 before the first publish-release.cjs run, 200 afterwards.
 const releases=await fetch(baseURL+'releases/latest.json',{redirect:'error',signal:AbortSignal.timeout(15000)});await releases.body?.cancel();if(![200,404].includes(releases.status))throw Error('The public release route is not being served (HTTP '+releases.status+').');
 const inventory=JSON.parse(fs.readFileSync(path.join(dir,'inventory.json'))),part=inventory.objects.filter(p=>p.file!=='index.json').reduce((smallest,p)=>!smallest||p.bytes<smallest.bytes?p:smallest,null);
 const download=await fetch(baseURL+part.file,{headers:{Authorization:'Bearer '+privateBuild.downloadToken},redirect:'error',signal:AbortSignal.timeout(120000)});
 if(!download.ok)throw Error('The deployed gateway could not read an encrypted download part.');
 const digest=crypto.createHash('sha256');let bytes=0;for await(const chunk of download.body){digest.update(chunk);bytes+=chunk.length;}
 if(bytes!==part.bytes||digest.digest('hex')!==part.sha256)throw Error('The live encrypted download did not verify.');
 const target=path.join(repo,'electron/asset-download.json'),appConfig=JSON.parse(fs.readFileSync(target));appConfig.baseURL=baseURL;fs.writeFileSync(target,JSON.stringify(appConfig,null,2)+'\n');
 fs.writeFileSync(path.join(dir,'deployment.json'),JSON.stringify({account:config.account_id,storageAccount,baseURL,verifiedAt:new Date().toISOString(),billingPlan:'Workers Free',files:verified.files,bytes:verified.bytes},null,2));
 console.log('Verified the live gateway and configured the app: '+baseURL);
})().catch(e=>{console.error(e.stderr?'Cloudflare deployment failed; inspect the account configuration in the dashboard.':e.message);process.exitCode=1;});
