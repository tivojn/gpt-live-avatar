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
  console.log('Avatar revision isolation passed.');
}finally{fs.rmSync(root,{recursive:true,force:true});}
