// Launch the real app with an isolated profile, no API key and no live call.
// Run: npx electron qa/app-smoke.cjs [repo directory]
const {app,BrowserWindow,Menu}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const repo=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const output=path.join(repo,'build/sarah/qa-native');fs.mkdirSync(output,{recursive:true});
app.setPath('userData',path.join(output,'profile'));fs.mkdirSync(app.getPath('userData'),{recursive:true});
delete process.env.GLA_OPENAI_KEY;
fs.writeFileSync(path.join(app.getPath('userData'),'config.json'),JSON.stringify({avatarDir:path.join(repo,'build/sarah/complete'),personaName:'Sarah',quality:'best',bubbleMode:'always'}));
let template;
const original=Menu.buildFromTemplate;
Menu.buildFromTemplate=function(value){const menu=original.call(Menu,value);menu.popup=()=>{template=value;};return menu;};
const errors=[];
app.on('browser-window-created',(_event,win)=>{
  win.webContents.setBackgroundThrottling(false);
  win.webContents.on('console-message',d=>{if(d.level==='error')errors.push(d.message);});
});
require(path.join(repo,'electron/main.cjs'));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(test){const end=Date.now()+60000;while(Date.now()<end){const value=await test();if(value)return value;await wait(200);}throw Error('App smoke test timed out');}
app.whenReady().then(async()=>{
  try {
    const win=await until(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/avatar.html')));
    const js=code=>win.webContents.executeJavaScript(code);
    await until(async()=>{try{return await js("window.gla_debug?.().clips===62 && !document.querySelector('#status').textContent.startsWith('Loading')");}catch{return false;}});
    const info=await js('gla.getSettings()');assert.equal(info.avatar.name,'Sarah');assert(info.avatar.appearanceURL);
    const capture=async()=>{template=null;await js("document.querySelector('#bubble').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true}))");await until(()=>template);return template;};
    let menu=await capture();
    for(const label of ['Outfit','Props','Accessories','Expression','Lighting','Original colors'])assert(menu.some(x=>x.label===label),label);
    assert.equal(menu.find(x=>x.label==='Outfit').submenu.length,5);
    const colors=menu.find(x=>x.label==='Original colors').submenu;
    assert.equal(colors.reduce((n,x)=>n+x.submenu.length-1,0),74);
    win.webContents.send('gla:menu-action','outfit:casual');
    win.webContents.send('gla:menu-action','appearance:expression:original-mth-sml-cls-1');
    win.webContents.send('gla:menu-action','appearance:texture:dress:sarah-original/dress-022');
    await wait(2000);menu=await capture();
    assert(menu.find(x=>x.label==='Outfit').submenu.find(x=>x.label.startsWith('Tie top, chain')).checked);
    win.webContents.reload();
    await wait(1000);await until(async()=>{try{return await js("window.gla_debug?.().clips===62 && !document.querySelector('#status').textContent.startsWith('Loading')");}catch{return false;}});
    menu=await capture();assert(menu.find(x=>x.label==='Outfit').submenu.find(x=>x.label.startsWith('Tie top, chain')).checked,'Wardrobe survives reload');
    await wait(1500);
    const visible=await until(()=>js('gla_visibleBox()'));
    fs.writeFileSync(path.join(output,'app.png'),(await win.webContents.capturePage()).toPNG());
    console.log('Painted avatar bounds:',visible);
    assert(visible.w>60&&visible.h>240,'Avatar painted into app canvas');
    const debug=await js('gla_debug()');assert.equal(debug.live,'idle');
    fs.writeFileSync(path.join(output,'app.png'),(await win.webContents.capturePage()).toPNG());
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({passed:true,quality:info.quality,menus:menu.map(x=>x.label).filter(Boolean),colors:74,visible,errors},null,2));
    assert.deepEqual(errors,[]);console.log('Real app: Sarah loaded at best quality, native menus and saved selection passed.');
  }catch(error){console.error(error);console.error('Renderer errors:',errors);process.exitCode=1;}
  app.quit();
});
