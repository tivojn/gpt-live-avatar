'use strict';
const {spawn}=require('node:child_process'),path=require('node:path');
const {verifyRelease,verifyPackage}=require('./verify-release.cjs');
const repo=path.resolve(__dirname,'..'),profile=path.join(repo,'build/dev-profile');
(async()=>{
 const {starter,packages}=await verifyRelease(repo);
 for(const p of packages)await verifyPackage(path.join(repo,'build/assets/bundle',starter.slug,p.name),p.entry,p.label+' development');
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.GLA_OPENAI_KEY;
 console.log('Verified the '+starter.name+' starter. Starting with separate development settings at '+profile+'. Enter your own voice key in Settings.');
 const child=spawn(require('electron'),[repo,'--user-data-dir='+profile],{stdio:'inherit',env});
 child.on('error',error=>{console.error(error.message);process.exitCode=1;});
 child.on('exit',(code,signal)=>{process.exitCode=code??(signal?1:0);});
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
