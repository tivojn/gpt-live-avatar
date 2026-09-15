'use strict';
const assert=require('node:assert/strict');
const {compareVersions,releaseDetails,latestRelease,RELEASES}=require('../electron/releases.cjs');
(async()=>{
 for(const [a,b,expected] of [['0.2.10','0.2.9',1],['0.3.0','0.2.99',1],['1.0.0','1.0.0+build',0],['1.0.0-beta.2','1.0.0-beta.11',-1],['1.0.0-rc.1','1.0.0',-1],['0.2.8','0.2.9',-1]])assert.equal(compareVersions(a,b),expected);
 for(const v of ['../latest','v0.2.9/path','1.0','01.2.3','1.2.3-01'])assert.throws(()=>compareVersions(v,'0.2.9'));
 const doc={tag_name:'v0.2.10',name:'Update',html_url:RELEASES+'/tag/v0.2.10',body:'New release',assets:[{name:'GPT-Live Avatar-0.2.10-arm64.dmg',state:'uploaded',browser_download_url:RELEASES+'/download/v0.2.10/GPT-Live.Avatar-0.2.10-arm64.dmg'}]};
 assert.equal(releaseDetails(doc,{platform:'darwin',arch:'arm64'}).downloadURL,null);
 doc.assets[0].name='GPT-Live.Avatar-0.2.10-arm64.dmg';assert(releaseDetails(doc,{platform:'darwin',arch:'arm64'}).downloadURL);
 assert.equal(releaseDetails(doc,{platform:'darwin',arch:'x64'}).downloadURL,null);
 assert.throws(()=>releaseDetails({...doc,html_url:'https://untrusted.test/release'}));assert.throws(()=>releaseDetails({...doc,draft:true}));
 const valid=await latestRelease({platform:'darwin',arch:'arm64',fetchImpl:async()=>new Response(JSON.stringify(doc))});assert.equal(valid.version,'0.2.10');
 await assert.rejects(latestRelease({fetchImpl:async()=>new Response('',{status:429})}),/limiting/);
 await assert.rejects(latestRelease({fetchImpl:async()=>new Response('a'.repeat(1024*1024+1))}),/too large/);
 assert.equal(require('../electron/release-info.json').version,require('../package.json').version);
 console.log('Release comparison, verified links, architecture selection, rate limits and response bounds passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
