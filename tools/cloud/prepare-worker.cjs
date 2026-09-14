'use strict';
const fs=require('node:fs'),path=require('node:path');
const repo=path.resolve(__dirname,'../..'),dir=path.join(repo,'build/protected'),target=path.join(dir,'worker');
const account=process.argv[2];if(!/^[a-f0-9]{32}$/.test(account||''))throw Error('Provide the confirmed Cloudflare account ID.');
fs.mkdirSync(target,{recursive:true});const inventory=JSON.parse(fs.readFileSync(path.join(dir,'inventory.json')));
fs.copyFileSync(path.join(__dirname,'worker.mjs'),path.join(target,'worker.mjs'));
fs.writeFileSync(path.join(target,'index.mjs'),`import {createWorker} from './worker.mjs';\nexport default createWorker(${JSON.stringify(fs.readFileSync(path.join(dir,'index.json'),'utf8'))},${JSON.stringify(inventory.objects)});\n`);
fs.writeFileSync(path.join(target,'wrangler.jsonc'),JSON.stringify({name:'gpt-live-avatar-downloads',account_id:account,main:'index.mjs',compatibility_date:'2026-09-14',workers_dev:true,preview_urls:false,observability:{enabled:false},r2_buckets:[{binding:'AVATAR_ASSETS',bucket_name:'gpt-live-avatar-protected'}]},null,2));
console.log('Prepared the download gateway. No account resources were changed.');
