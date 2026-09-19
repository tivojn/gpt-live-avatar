'use strict';
// Fetch the starter avatar's encrypted packs that the signed catalogue names, for a clone that has the
// catalogue and the runtime file but no (or an outdated) starter: what tools/import-release.cjs does from an
// installed macOS app, done from the download service instead, so it also works on Windows.
//   electron tools/fetch-starter.cjs
// It uses the app's own downloader (electron/assets.cjs): every part and the whole pack are checked against the
// signed catalogue, the pack must open with this profile's keys and carry the catalogue's revision. About
// 650 MB and a dozen requests against the service's daily limit; packs that already match are not fetched again.
// Result: build/protected/starter/<slug>/{base,motions}.gla (what verify-release and the installer use) and
// hard links to them in build/assets/bundle/<slug> (what a development run uses). Nothing is printed of the
// runtime file's contents.
const {app,safeStorage,net}=require('electron'),fs=require('node:fs'),path=require('node:path');
const repo=path.resolve(__dirname,'..'),{AvatarAssets}=require(path.join(repo,'electron','assets.cjs')),{verifyPackage,readCatalogue,loadDefaultAvatar}=require('./verify-release.cjs');
const work=path.join(repo,'build','fetch-starter');app.setPath('userData',path.join(work,'profile'));
app.whenReady().then(async()=>{
 let code=0;
 try{
  const root=path.join(repo,'build','protected'),starter=loadDefaultAvatar(repo),slug=starter.slug,dest=path.join(root,'starter',slug);
  const {index}=await readCatalogue(path.join(root,'assets-runtime.json'),path.join(root,'index.json')),entry=index.avatars[slug];
  const wanted=[['base',entry.mac.base],...(entry.motionUpdate?[['motions',entry.motionUpdate.package]]:[])];
  const matches=async(tier,e)=>{try{await verifyPackage(path.join(dest,tier+'.gla'),e,tier);return true;}catch{return false;}};
  const missing=[];for(const [tier,e] of wanted)if(!await matches(tier,e))missing.push(tier);
  if(!missing.length)console.log(starter.name+': the starter packs already match the signed catalogue.');
  else{
   console.log(starter.name+' '+entry.assetRevision+': fetching '+missing.join(' and ')+' ('+Math.round(wanted.filter(w=>missing.includes(w[0])).reduce((n,w)=>n+w[1].bytes,0)/1e6)+' MB).');
   fs.mkdirSync(path.join(work,'empty'),{recursive:true});let shown=-1;
   const assets=new AvatarAssets({bundledRoot:path.join(work,'empty'),downloadsRoot:path.join(work,'avatars'),bundledIndexPath:path.join(root,'index.json'),runtimeConfigPath:path.join(root,'assets-runtime.json'),safeStorage,fetcher:net.fetch.bind(net),
    broadcast:p=>{if(p&&p.phase==='download'&&p.percent>=shown+10){shown=p.percent-p.percent%10;console.log('  '+p.tier+' '+shown+'%');}if(p&&p.phase==='done')shown=-1;}});
   await assets.unlockInstalled();
   // A base download brings the matching motion update with it.
   if(missing.includes('base')||!fs.existsSync(path.join(work,'avatars',slug,'base.gla')))await assets.download(slug,'base');
   if(missing.includes('motions')&&!fs.existsSync(path.join(work,'avatars',slug,'motions.gla')))await assets.download(slug,'motions');
   fs.mkdirSync(dest,{recursive:true});
   for(const [tier,e] of wanted){
    const from=path.join(work,'avatars',slug,tier+'.gla'),to=path.join(dest,tier+'.gla');if(!fs.existsSync(from))continue;
    await verifyPackage(from,e,tier);
    if(fs.existsSync(to))fs.renameSync(to,to+'.superseded-'+Date.now()); // kept, never deleted: the caller decides
    try{fs.renameSync(from,to);}catch{fs.copyFileSync(from,to);fs.rmSync(from,{force:true});}
   }
  }
  // A development run reads build/assets/bundle/<slug>: same files, no second copy.
  const bundle=path.join(repo,'build','assets','bundle',slug);fs.mkdirSync(bundle,{recursive:true});
  for(const [tier,e] of wanted){
   const to=path.join(bundle,tier+'.gla'),from=path.join(dest,tier+'.gla');
   if(fs.existsSync(to)){const same=fs.statSync(to).ino===fs.statSync(from).ino&&fs.statSync(to).size===e.bytes;if(same)continue;fs.renameSync(to,to+'.superseded-'+Date.now());}
   try{fs.linkSync(from,to);}catch{fs.copyFileSync(from,to);}
  }
  for(const [tier,e] of wanted)await verifyPackage(path.join(dest,tier+'.gla'),e,tier);
  console.log('Starter packs are in place and match the signed catalogue: '+path.relative(repo,dest));
 }catch(error){console.error('fetch-starter: '+(error&&error.message||error));code=1;}
 finally{fs.rmSync(path.join(work,'avatars','tmp'),{recursive:true,force:true});app.exit(code);}
});
