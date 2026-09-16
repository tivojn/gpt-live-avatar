'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {AvatarAssets}=require('../electron/assets.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'avatar-revisions-'));
try {
  const bundledRoot=path.join(root,'bundle'),downloadsRoot=path.join(root,'download'),developmentRoot=path.join(root,'local');
  for(const base of [bundledRoot,downloadsRoot,developmentRoot]) {
    fs.mkdirSync(path.join(base,'sarah','runtime','resident'),{recursive:true});
    fs.writeFileSync(path.join(base,'sarah','manifest.json'),'{}');
  }
  fs.writeFileSync(path.join(downloadsRoot,'sarah','runtime','resident','image-0-4096.png'),'old revision');
  fs.writeFileSync(path.join(developmentRoot,'sarah','runtime','resident','image-0-1024.png'),'new revision');
  const doc={images:[{uri:'image-0-4096.png',extras:{openclamVariants:[{size:1024,uri:'image-0-1024.png'},{size:4096,uri:'image-0-4096.png'}]}}]};
  fs.writeFileSync(path.join(developmentRoot,'sarah','runtime','resident','model.gltf'),JSON.stringify(doc));
  const assets=new AvatarAssets({bundledRoot,downloadsRoot,developmentRoot,bundledIndexPath:path.join(root,'index.json')});
  assert.deepEqual(assets.roots('sarah'),[path.join(developmentRoot,'sarah')]);
  assert.equal(assets.hasTier('sarah','best'),false,'Old 4K maps must not overlay new texture indices');
  const result=JSON.parse(assets.residentDocument(assets.roots('sarah')));
  assert.equal(result.images[0].uri,'image-0-1024.png');
  assert.equal(result.images[0].extras.openclamVariants.length,1);
  assert(assets.avatars().some(a=>a.slug==='sarah'&&a.installed));
  fs.writeFileSync(path.join(developmentRoot,'sarah','manifest.json'),JSON.stringify({assetRevision:'new'}));
  assets.index={avatars:{sarah:{assetRevision:'old',mac:{best:{file:'old.zip',bytes:5}}}}};
  assert.equal(assets.matchingRevision('sarah'),false);
  assert.equal(assets.status('sarah').tiers.best.available,false,'Reject old remote tiers after a local upgrade');
  assets.index.avatars.sarah.assetRevision='new';
  assert.equal(assets.status('sarah').tiers.best.available,true);
  // Cached catalogues and old downloaded starters must not defeat an upgrade.
  const oldIndex={version:2,avatars:{sarah:{name:'Sarah',assetRevision:'old',mac:{}}}};
  const currentIndex={version:2,publishedAt:'2026-09-17T00:00:00Z',avatars:{sarah:{name:'Sarah',assetRevision:'new',mac:{}}}};
  fs.writeFileSync(path.join(downloadsRoot,'index.json'),JSON.stringify(oldIndex));
  fs.writeFileSync(path.join(root,'index.json'),JSON.stringify(currentIndex));
  const upgrade=new AvatarAssets({bundledRoot,downloadsRoot,bundledIndexPath:path.join(root,'index.json')});
  assert.equal(upgrade.loadIndexSync().avatars.sarah.assetRevision,'new','New bundled catalogue supersedes old cached catalogue offline');
  fs.writeFileSync(path.join(downloadsRoot,'sarah','base.gla'),'fixture');
  const revisions=new Map([[path.join(bundledRoot,'sarah','base.gla'),'new'],[path.join(downloadsRoot,'sarah','base.gla'),'old']]);
  upgrade.archive=file=>revisions.has(file)?{meta:{assetRevision:revisions.get(file)}}:null;
  upgrade.exists=()=>true;
  assert.equal(upgrade.roots('sarah')[0],path.join(bundledRoot,'sarah'),'Repaired bundle beats old download');
  revisions.set(path.join(downloadsRoot,'sarah','base.gla'),'new');
  assert.equal(upgrade.roots('sarah')[0],path.join(downloadsRoot,'sarah'),'Matching downloads retain precedence');
  const future={...currentIndex,publishedAt:'2026-09-18T00:00:00Z'};
  fs.writeFileSync(path.join(downloadsRoot,'index.json'),JSON.stringify(future));upgrade.index=null;
  assert.equal(upgrade.loadIndexSync().publishedAt,future.publishedAt,'Newer remote catalogue remains usable');
  console.log('Avatar revision isolation and existing-profile upgrade selection passed.');
}finally{fs.rmSync(root,{recursive:true,force:true});}
