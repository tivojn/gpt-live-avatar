'use strict';
// The update flow in the real updates window and menu row: check, download
// with progress, verify, Install and Relaunch. The release feed and the
// updater are stand-ins (qa/updater.cjs covers the real checks), so nothing is
// downloaded or installed. Run: npx electron qa/update-app.cjs
const {app,BrowserWindow}=require('electron'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'build/qa-update-app');fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(out,'profile'));
const {createAppInfo}=require('../electron/app-info.cjs');
app.on('window-all-closed',()=>{}); // the test closes its only window mid-download; that must not end the run
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label,ms=20000){const end=Date.now()+ms;while(Date.now()<end){const v=await fn();if(v)return v;await wait(60);}throw Error('Timed out: '+label);}
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css'};
const server=http.createServer((req,res)=>{const file=path.join(root,'web',path.basename(req.url.split('?')[0]));if(!fs.existsSync(file)){res.writeHead(404);return res.end();}res.writeHead(200,{'Content-Type':TYPES[path.extname(file)]||'application/octet-stream'});res.end(fs.readFileSync(file));});
const release={version:'0.3.0',title:'GPT-Live Avatar 0.3.0',notes:'Everything is better.',releaseURL:'https://downloads.example/releases/',downloadURL:'https://downloads.example/releases/gpt-live-avatar-0.3.0-arm64.dmg',sha256:'a'.repeat(64),bytes:1000};
app.whenReady().then(async()=>{let info;try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const page=()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/app-info.html'));
 const js=code=>page().webContents.executeJavaScript('(async()=>{'+code+'})()');
 const text=id=>js(`return document.getElementById('${id}').textContent`),hidden=id=>js(`return document.getElementById('${id}').hidden`);
 const row=()=>info.menu()[0];
 // ---- an installable release, a slow download, the window closed half way
 const calls=[],opened=[];let gate,quits=0;
 const updater={download:async(r,{onProgress})=>{calls.push('download '+r.version);for(const percent of [10,40]){onProgress({percent});await wait(120);}await new Promise(r=>gate=r);for(const percent of [70,100]){onProgress({percent});await wait(60);}return '/tmp/fake.dmg';},
  verify:async(file,r)=>{calls.push('verify '+file);await wait(150);return {version:r.version,detach:async()=>calls.push('detach')};},stage:async v=>{calls.push('stage '+v.version);return {target:'/Applications/GPT-Live Avatar.app',staged:'/Applications/.staged.app',version:v.version};},install:async s=>{calls.push('install '+s.version);}};
 info=createAppInfo({origin,version:'0.2.23',fetchRelease:async()=>release,updater,quit:()=>{quits++;},openExternal:async url=>{opened.push(url);}});
 assert.deepEqual(info.menu().map(i=>i.label),['Check for Updates…','GPT-Live Avatar 0.2.23']);assert.equal(info.menu()[1].enabled,false,'the version is always in view, and is not a button');
 info.open(true);await until(()=>page(),'window');await until(async()=>await text('status')==='Version 0.3.0 is available','available');
 assert.match(await text('update-detail'),/checksum, its signature and Apple’s notarization/);assert.equal(await hidden('download'),false);assert.equal(await hidden('install'),true);assert.equal(row().label,'Update to 0.3.0…');
 await js("document.getElementById('download').click();return 1");
 await until(async()=>/^Downloading version 0\.3\.0… 40%$/.test(await text('status')),'progress in the window');
 assert.equal(await hidden('progress'),false);assert.equal(await js("return document.getElementById('progress-bar').style.width"),'40%');assert.equal(await hidden('check'),true,'nothing can start a check over a running download');assert.equal(row().label,'Downloading 0.3.0… 40%');
 page().close();await until(()=>!page(),'closed');await until(()=>gate,'the download is waiting');gate();
 await until(()=>row().label==='Install 0.3.0 and Relaunch','the download and verification finish with the window closed');assert.deepEqual(calls,['download 0.3.0','verify /tmp/fake.dmg']);
 assert.equal(typeof row().click,'function','the ready row installs on its own click');
 info.open(true);await until(()=>page(),'reopened');await until(async()=>await text('status')==='Version 0.3.0 is ready to install','ready survives reopening, and a check does not discard it');
 assert.equal(await hidden('install'),false);assert.equal(await js("return document.getElementById('install').textContent"),'Install and Relaunch');assert.equal(await hidden('download'),true);
 fs.writeFileSync(out+'/ready.png',(await page().webContents.capturePage()).toPNG());
 assert.equal(quits,0,'nothing installs until the button is pressed');
 await js("document.getElementById('install').click();return 1");await until(()=>quits===1,'install then quit');assert.deepEqual(calls.slice(2),['stage 0.3.0','install 0.3.0']);
 info.dispose();for(const w of BrowserWindow.getAllWindows())w.destroy();
 // ---- a refused installer returns to "available" with the reason; the app is left alone
 const refused=Object.assign(Error('The update is not signed by the developer of this app.'),{refused:true});let staged=0;
 info=createAppInfo({origin,version:'0.2.23',fetchRelease:async()=>release,quit:()=>{quits++;},openExternal:async url=>{opened.push(url);},updater:{download:async()=>'/tmp/fake.dmg',verify:async()=>{throw refused;},stage:async()=>{staged++;},install:async()=>{}}});
 info.open(true);await until(()=>page(),'window 2');await until(async()=>await text('status')==='Version 0.3.0 is available','available 2');
 await js("document.getElementById('download').click();return 1");await until(async()=>await text('update-detail')==='The update is not signed by the developer of this app.','the reason is shown');
 assert.equal(await text('status'),'Version 0.3.0 is available');assert.equal(await js("return document.getElementById('update-detail').classList.contains('problem')"),true);assert.equal(await hidden('install'),true);assert.equal(staged,0);assert.equal(quits,1);assert.equal(row().label,'Update to 0.3.0…');
 info.dispose();for(const w of BrowserWindow.getAllWindows())w.destroy();
 // ---- a release without a published checksum cannot be installed from here: the button opens the download page instead
 let touched=0;info=createAppInfo({origin,version:'0.2.23',fetchRelease:async()=>({...release,sha256:null,bytes:null}),quit:()=>{},openExternal:async url=>{opened.push(url);},updater:{download:async()=>{touched++;},verify:async()=>{touched++;}}});
 info.open(true);await until(()=>page(),'window 3');await until(async()=>await text('status')==='Version 0.3.0 is available','available 3');assert.match(await text('update-detail'),/replace the app in Applications/);
 await js("document.getElementById('download').click();return 1");await until(()=>opened.length===1,'opens the installer in the browser');assert.equal(opened[0],release.downloadURL);assert.equal(touched,0);
 console.log('Update flow QA passed: version row, progress in window and menu, a closed window does not orphan the download, Install and Relaunch only on the click, refusals explained, no in-app install without a checksum.');
}catch(e){console.error(e);process.exitCode=1;}finally{try{info?.dispose();}catch{}server.close();app.exit(process.exitCode||0);}});
