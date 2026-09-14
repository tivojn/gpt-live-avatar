const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const output=path.resolve(__dirname,'../build/qa-props'),profile=path.join(output,'profile');
app.setPath('userData',profile);
const saved=JSON.parse(fs.readFileSync(path.join(profile,'config.json'),'utf8'));
assert(saved.avatarLooks?.tia&&saved.avatarLooks?.sarah,'Run props-app.cjs first');
require('../electron/main.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{try{
 let win;for(let i=0;i<100&&!win;i++){win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/avatar.html'));await wait(100);}
 const js=code=>win.webContents.executeJavaScript(`(async()=>{${code}})()`);
 const results=[];
 for(const slug of ['sarah','tia']){
  await js(`await gla.selectAvatar('${slug}');`);
  let ready=false;for(let i=0;i<900&&!ready;i++){ready=await js(`return Boolean(window.gla_avatar?.options && !document.querySelector('#status').textContent.startsWith('Loading') && (await gla.getSettings()).avatar.slug==='${slug}');`);await wait(100);}
  assert(ready,slug+' loaded');await wait(1000);
  const value=await js('const s=await gla.getSettings();return {selection:gla_avatar.options.selection,settings:s,origin:location.origin};');
  for(const [key,expected] of Object.entries(saved.avatarLooks[slug]))assert.equal(value.selection[key],expected,slug+' '+key+' survives full process restart');
  assert.equal(value.settings.windowWidth,saved.windowWidth);assert.equal(value.settings.windowHeight,saved.windowHeight);
  results.push({slug,selection:value.selection,origin:value.origin});
 }
 fs.writeFileSync(path.join(output,'restart.json'),JSON.stringify({passed:true,results},null,2));console.log('Both avatar appearances and compact window dimensions survive a full app restart.');
}catch(error){console.error(error);process.exitCode=1;}app.exit(process.exitCode||0);});
