'use strict';
const assert=require('node:assert/strict');
const {compareVersions,releaseDetails,installerDetails,latestRelease,RELEASES,GITHUB_RELEASES,RELEASE_BASE,LATEST_URL}=require('../electron/releases.cjs');
const {baseURL}=require('../electron/asset-download.json');
(async()=>{
 for(const [a,b,expected] of [['0.2.10','0.2.9',1],['0.3.0','0.2.99',1],['1.0.0','1.0.0+build',0],['1.0.0-beta.2','1.0.0-beta.11',-1],['1.0.0-rc.1','1.0.0',-1],['0.2.8','0.2.9',-1]])assert.equal(compareVersions(a,b),expected);
 for(const v of ['../latest','v0.2.9/path','1.0','01.2.3','1.2.3-01'])assert.throws(()=>compareVersions(v,'0.2.9'));
 // The release service (private Worker + R2) is authoritative and needs no GitHub.
 assert.equal(RELEASE_BASE,baseURL+'releases/');assert.equal(RELEASES,RELEASE_BASE);assert.equal(LATEST_URL,RELEASE_BASE+'latest.json');
 const sha='a'.repeat(64),dmg=RELEASE_BASE+'gpt-live-avatar-0.2.10-arm64.dmg';
 const latest={version:'0.2.10',title:'Update',notes:'New release',publishedAt:'2026-09-18T00:00:00.000Z',arch:'arm64',url:dmg,sha256:sha,bytes:1047191904,installers:{arm64:{file:'GPT-Live Avatar-0.2.10-arm64.dmg',url:dmg,sha256:sha,bytes:1047191904}}};
 const arm=installerDetails(latest,{platform:'darwin',arch:'arm64'});
 assert.equal(arm.downloadURL,dmg);assert.equal(arm.sha256,sha);assert.equal(arm.bytes,1047191904);assert.equal(arm.releaseURL,RELEASE_BASE);assert.equal(arm.version,'0.2.10');assert.equal(arm.notes,'New release');
 assert.equal(installerDetails(latest,{platform:'darwin',arch:'x64'}).downloadURL,null,'No Intel installer is offered without one');
 assert.equal(installerDetails(latest,{platform:'win32',arch:'arm64'}).downloadURL,null,'Windows on ARM has no installer of its own');
 assert.equal(installerDetails(latest,{platform:'win32',arch:'x64'}).downloadURL,null,'A macOS-only release offers Windows nothing');
 assert.equal(installerDetails(latest,{platform:'linux',arch:'x64'}).downloadURL,null);
 assert.equal(installerDetails({...latest,installers:undefined},{platform:'darwin',arch:'arm64'}).downloadURL,dmg,'Flat url/arch fields work alone');
 // Windows: its own key and its own file name, alongside the macOS installer.
 const exe=RELEASE_BASE+'gpt-live-avatar-0.2.10-win-x64.exe',esha='c'.repeat(64);
 const both={...latest,installers:{...latest.installers,'win-x64':{file:'GPT-Live Avatar-0.2.10-win-x64.exe',url:exe,sha256:esha,bytes:797000000}}};
 const win=installerDetails(both,{platform:'win32',arch:'x64'});
 assert.equal(win.downloadURL,exe);assert.equal(win.sha256,esha);assert.equal(win.bytes,797000000);assert.equal(win.version,'0.2.10');
 assert.equal(installerDetails(both,{platform:'darwin',arch:'arm64'}).downloadURL,dmg,'Publishing Windows leaves the macOS installer offered');
 assert.equal(installerDetails({...both,installers:{'win-x64':both.installers['win-x64']},arch:undefined,url:undefined,sha256:undefined}, {platform:'darwin',arch:'arm64'}).downloadURL,null,'A Windows-only release offers macOS nothing');
 assert.equal(installerDetails({...both,arch:'win-x64',url:exe,sha256:esha,installers:undefined},{platform:'win32',arch:'x64'}).downloadURL,null,'The flat legacy fields never describe a Windows installer');
 for(const url of ['https://evil.test/gpt-live-avatar-0.2.10-win-x64.exe',RELEASE_BASE+'gpt-live-avatar-0.2.10-x64.dmg',RELEASE_BASE+'gpt-live-avatar-0.2.11-win-x64.exe',RELEASE_BASE+'gpt-live-avatar-0.2.10-win-x64.exe.exe'])
  assert.equal(installerDetails({...both,installers:{'win-x64':{...both.installers['win-x64'],url}}},{platform:'win32',arch:'x64'}).downloadURL,null,'Only the exact Windows installer for this version is linked: '+url);
 assert.equal(installerDetails({...both,installers:{'win-x64':{...both.installers['win-x64'],sha256:'nope'}}},{platform:'win32',arch:'x64'}).downloadURL,null,'A checksum is mandatory on Windows too');
 for(const bad of [{...latest,version:'v0.2.10'},{...latest,version:'0.2.10-beta.1'},{...latest,version:'../x'},{version:5},null,[]])assert.throws(()=>installerDetails(bad,{platform:'darwin',arch:'arm64'}),/unsupported release/);
 for(const url of ['https://evil.test/gpt-live-avatar-0.2.10-arm64.dmg',RELEASE_BASE+'gpt-live-avatar-0.2.11-arm64.dmg',RELEASE_BASE+'gpt-live-avatar-0.2.10-x64.dmg',RELEASE_BASE+'../gpt-live-avatar-0.2.10-arm64.dmg'])
  assert.equal(installerDetails({...latest,url,installers:{arm64:{...latest.installers.arm64,url}}},{platform:'darwin',arch:'arm64'}).downloadURL,null,'Only same-service installers named for the version are linked: '+url);
 assert.equal(installerDetails({...latest,installers:{arm64:{...latest.installers.arm64,sha256:'nope'}}},{platform:'darwin',arch:'arm64'}).downloadURL,null,'A checksum is mandatory');
 // Legacy GitHub document parsing is unchanged.
 const doc={tag_name:'v0.2.10',name:'Update',html_url:GITHUB_RELEASES+'/tag/v0.2.10',body:'New release',assets:[{name:'GPT-Live Avatar-0.2.10-arm64.dmg',state:'uploaded',browser_download_url:GITHUB_RELEASES+'/download/v0.2.10/GPT-Live.Avatar-0.2.10-arm64.dmg'}]};
 assert.equal(releaseDetails(doc,{platform:'darwin',arch:'arm64'}).downloadURL,null);
 doc.assets[0].name='GPT-Live.Avatar-0.2.10-arm64.dmg';assert(releaseDetails(doc,{platform:'darwin',arch:'arm64'}).downloadURL);
 assert.equal(releaseDetails(doc,{platform:'darwin',arch:'x64'}).downloadURL,null);
 assert.equal(releaseDetails(doc,{platform:'win32',arch:'x64'}).downloadURL,null,'A DMG is never offered to Windows');
 const winAsset={name:'gpt-live-avatar-0.2.10-win-x64.exe',state:'uploaded',browser_download_url:GITHUB_RELEASES+'/download/v0.2.10/gpt-live-avatar-0.2.10-win-x64.exe'};
 const winDoc={...doc,assets:[...doc.assets,winAsset]};
 assert.equal(releaseDetails(winDoc,{platform:'win32',arch:'x64'}).downloadURL,winAsset.browser_download_url,'The GitHub fallback finds the Windows installer');
 assert(releaseDetails(winDoc,{platform:'darwin',arch:'arm64'}).downloadURL,'and still finds the macOS one');
 assert.throws(()=>releaseDetails({...doc,html_url:'https://untrusted.test/release'}));assert.throws(()=>releaseDetails({...doc,draft:true}));
 // Fetch order: the service first; GitHub only when the service fails.
 const github={...doc,tag_name:'v0.2.9',html_url:GITHUB_RELEASES+'/tag/v0.2.9',assets:[]};
 const fetcher=(service,fallback)=>{const calls=[];const impl=async(url,init)=>{calls.push(url);assert.equal(init.redirect,'error');assert(init.signal);const r=url===LATEST_URL?service:fallback;if(typeof r==='function')return r();return r instanceof Response?r:new Response(JSON.stringify(r));};impl.calls=calls;return impl;};
 let f=fetcher(latest,github);const fromService=await latestRelease({platform:'darwin',arch:'arm64',fetchImpl:f});
 assert.equal(fromService.version,'0.2.10');assert.equal(fromService.downloadURL,dmg);assert.deepEqual(f.calls,[LATEST_URL],'A healthy service never contacts GitHub');
 f=fetcher(()=>{throw new TypeError('fetch failed');},github);const fallback=await latestRelease({platform:'darwin',arch:'arm64',fetchImpl:f});
 assert.equal(fallback.version,'0.2.9');assert.equal(fallback.releaseURL,GITHUB_RELEASES+'/tag/v0.2.9');assert.equal(f.calls.length,2,'An unreachable service falls back to GitHub');
 f=fetcher(new Response('',{status:404}),github);assert.equal((await latestRelease({platform:'darwin',arch:'arm64',fetchImpl:f})).version,'0.2.9','A not-yet-published service falls back');
 f=fetcher(new Response('',{status:503}),new Response('',{status:404}));await assert.rejects(latestRelease({fetchImpl:f}),/The update service could not be reached/,'Both failing reports the service, not GitHub');
 f=fetcher(new Response('',{status:404}),new Response('',{status:404}));await assert.rejects(latestRelease({fetchImpl:f}),/No public release/);
 f=fetcher(new Response('',{status:404}),new Response('',{status:429}));await assert.rejects(latestRelease({fetchImpl:f}),/No public release/);
 f=fetcher(new Response('a'.repeat(1024*1024+1)),new Response('',{status:500}));await assert.rejects(latestRelease({fetchImpl:f}),/too large/);
 f=fetcher(new Response('not json'),new Response('',{status:500}));await assert.rejects(latestRelease({fetchImpl:f}),/unsupported release/);
 const controller=new AbortController();controller.abort();
 f=fetcher(()=>{throw new DOMException('aborted','AbortError');},github);await assert.rejects(latestRelease({fetchImpl:f,signal:controller.signal}),{name:'AbortError'});assert.equal(f.calls.length,1,'A cancelled check never continues to GitHub');
 assert.equal(require('../electron/release-info.json').version,require('../package.json').version);
 console.log('Release comparison, service-first update checks, GitHub fallback, verified installer links, architecture selection and response bounds passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
