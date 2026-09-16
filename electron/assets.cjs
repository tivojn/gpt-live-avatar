'use strict';
// Signed cloud catalogue and encrypted avatar packages, cached without unpacking.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {pipeline}=require('node:stream/promises');
const {ProtectedPackage}=require('./protected-assets.cjs');

const DOWNLOAD_CONFIG=require('./asset-download.json');
const RELEASE_BASE=DOWNLOAD_CONFIG.baseURL||'';
const TIER_SIZES = { balanced: 2048, best: 4096 };
const TIER_LABELS = { motions:'Motion update', base: 'Avatar package (1K textures, meshes, motions)', balanced: 'Balanced: 2K textures', best: 'Best quality: 4K textures' };

class AvatarAssets {
  constructor({ bundledRoot, downloadsRoot, bundledIndexPath, developmentRoot, broadcast, runtimeConfigPath, safeStorage, baseURL=RELEASE_BASE, allowLocal=false, fetcher=globalThis.fetch }) {
    this.bundledRoot = bundledRoot; this.downloadsRoot = downloadsRoot; this.bundledIndexPath = bundledIndexPath;
    this.broadcast = broadcast || (() => {});
    // The desktop supplies Chromium networking; Node remains the fixture default.
    this.fetcher = fetcher;
    this.developmentRoot = developmentRoot;
    this.active = null; // { slug, tier, request, cancelled }
    this.progress = null;
    this.index = null;this.baseURL=baseURL;this.allowLocal=allowLocal;this.packages=new Map();
    try{this.runtime=JSON.parse(fs.readFileSync(runtimeConfigPath,'utf8'));}catch{this.runtime={};}
    this.safeStorage=safeStorage;this.keyFile=path.join(downloadsRoot,'content-keys.bin');
    if(safeStorage?.isEncryptionAvailable())try{this.runtime.keys=JSON.parse(safeStorage.decryptString(fs.readFileSync(this.keyFile)));}catch{}
  }
  async ensureKeys(){
    if(this.runtime.keys&&Object.keys(this.runtime.keys).length)return;
    if(!this.safeStorage?.isEncryptionAvailable())throw Error('macOS secure storage is unavailable. Unlock your login keychain and retry.');
    if(this.keyRequest)return this.keyRequest;
    this.keyRequest=(async()=>{
      if(!this.baseURL||(!this.allowLocal&&new URL(this.baseURL).protocol!=='https:'))throw Error('Protected downloads are not configured for this build.');
      const pair=await new Promise((resolve,reject)=>crypto.generateKeyPair('rsa',{modulusLength:2048},(e,publicKey,privateKey)=>e?reject(e):resolve({publicKey,privateKey})));
      const response=await this.fetcher(this.baseURL+'authorize',{method:'POST',headers:{Authorization:'Bearer '+this.runtime.downloadToken,'Content-Type':'application/json'},body:JSON.stringify({publicKey:pair.publicKey.export({type:'spki',format:'der'}).toString('base64')}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
      if(!response.ok){await response.body?.cancel();throw Error(`Could not unlock avatar downloads (HTTP ${response.status}). Please retry.`);}
      const body=await response.text();if(body.length>2048)throw Error('Invalid avatar authorization.');
      const keys=JSON.parse(crypto.privateDecrypt({key:pair.privateKey,oaepHash:'sha256',padding:crypto.constants.RSA_PKCS1_OAEP_PADDING},Buffer.from(JSON.parse(body).wrappedKeys,'base64')));
      if(!keys||!Object.keys(keys).length||Object.entries(keys).some(([id,key])=>!/^[-a-z0-9]+$/.test(id)||typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key)))throw Error('Invalid content keys.');
      await fsp.mkdir(this.downloadsRoot,{recursive:true});await fsp.writeFile(this.keyFile,this.safeStorage.encryptString(JSON.stringify(keys)),{mode:0o600});this.runtime.keys=keys;this.packages.clear();
    })().finally(()=>{this.keyRequest=null;});return this.keyRequest;
  }
  async unlockInstalled(){
    if(this.runtime.keys)return;
    let encrypted=false;for(const root of [this.bundledRoot,this.downloadsRoot])try{encrypted=encrypted||fs.readdirSync(root,{withFileTypes:true}).some(e=>e.isDirectory()&&fs.existsSync(path.join(root,e.name,'base.gla')));}catch{}
    if(encrypted)try{await this.ensureKeys();}catch(e){this.lastKeyError=e.message;}
  }

  // ---- catalogue
  loadIndexSync() {
    if (this.index) return this.index;
    for (const p of [path.join(this.downloadsRoot, 'index.json'), this.bundledIndexPath]) {
      try { const parsed = this.parseIndex(fs.readFileSync(p, 'utf8')); if (parsed && parsed.avatars && (!this.index || (Date.parse(parsed.publishedAt)||0) > (Date.parse(this.index.publishedAt)||0))) this.index = parsed; } catch {}
    }
    if (!this.index) this.index = { version: 1, avatars: {} };
    return this.index;
  }
  parseIndex(data){
    let doc=JSON.parse(data);
    if(this.runtime.publicKey){if(typeof doc.payload!=='string'||!crypto.verify(null,Buffer.from(doc.payload),this.runtime.publicKey,Buffer.from(doc.signature||'','base64')))throw Error('The cloud catalogue signature is invalid.');doc=JSON.parse(doc.payload);if(doc.version!==2)throw Error('Unsupported catalogue version.');}
    if(!doc||typeof doc.avatars!=='object'||Array.isArray(doc.avatars))throw Error('Invalid avatar catalogue.');
    for(const [slug,a] of Object.entries(doc.avatars)){if(!/^[a-z0-9_-]{1,40}$/.test(slug)||typeof a.name!=='string'||a.name.length>80||/[<>&"']/.test(a.name))throw Error('Invalid avatar entry.');if(a.motionUpdate&&!/^[-a-z0-9]+$/.test(a.motionUpdate.revision||''))throw Error('Invalid motion revision.');for(const [tier,p] of Object.entries({...a.mac,...(a.motionUpdate?{motions:a.motionUpdate.package}:{})})){if(!['base','balanced','best','motions'].includes(tier)||!/^[-a-z0-9]+\.gla$/.test(p.file)||p.format!=='gla-pack-v1'||!Number.isSafeInteger(p.bytes)||p.bytes<=12||p.bytes>10_000_000_000||! /^[a-f0-9]{64}$/.test(p.sha256))throw Error('Invalid protected download.');if(!Array.isArray(p.parts)||!p.parts.length||p.parts.length>160||p.parts.reduce((n,x)=>n+x.bytes,0)!==p.bytes||p.parts.some((x,i)=>x.file!==p.file+'.p'+String(i).padStart(3,'0')||!Number.isSafeInteger(x.bytes)||x.bytes<=0||x.bytes>64*1024*1024||! /^[a-f0-9]{64}$/.test(x.sha256)))throw Error('Invalid protected download parts.');}}
    return doc;
  }
  async refreshIndex() {
    try {
      const data = await this.fetchBuffer(this.baseURL + 'index.json', null, 15000);
      const parsed = this.parseIndex(data.toString('utf8'));
      if (parsed && parsed.avatars) {
        if ((Date.parse(parsed.publishedAt)||0) < (Date.parse(this.loadIndexSync().publishedAt)||0)) return this.index;
        await fsp.mkdir(this.downloadsRoot, { recursive: true });
        await fsp.writeFile(path.join(this.downloadsRoot, 'index.json'), data);
        this.index = parsed;
      }
    } catch (error) { this.lastIndexError = error.message; }
    return this.loadIndexSync();
  }

  // ---- locations
  roots(slug) {
    // A locally rebuilt package is a complete revision. Do not mix texture
    // indices from the previous downloaded model into its resident document.
    if (this.developmentRoot) {
      const local = path.join(this.developmentRoot, slug);
      if (this.exists(local,'manifest.json')) return [local];
    }
    const b=path.join(this.bundledRoot,slug),d=path.join(this.downloadsRoot,slug);
    const downloaded=this.archive(path.join(d,'base.gla')),bundled=this.archive(path.join(b,'base.gla'));
    const revision=this.loadIndexSync().avatars?.[slug]?.assetRevision;
    // A current installer must supersede an older downloaded starter. Keep
    // both encrypted files; matching texture/motion tiers are isolated below.
    const preferBundle=bundled&&bundled.meta.assetRevision===revision&&downloaded?.meta.assetRevision!==revision;
    const roots=fs.existsSync(path.join(d,'base.gla'))&&!preferBundle?[d,b]:[b,d];
    return roots.filter(dir=>this.exists(dir,'manifest.json')||fs.existsSync(path.join(dir,'runtime'))||['balanced','best','motions'].some(t=>fs.existsSync(path.join(dir,t+'.gla'))));
  }
  installed(slug) { return this.roots(slug).some(dir=>this.exists(dir,'manifest.json')); }
  manifest(slug) {
    try { return JSON.parse(this.read(this.resolve(this.roots(slug),'manifest.json'))); }
    catch { return {}; }
  }
  matchingRevision(slug) {
    const file = this.resolve(this.roots(slug), 'manifest.json');
    let revision;
    try { revision = JSON.parse(this.read(file)).assetRevision; } catch {}
    return !revision || revision === this.loadIndexSync().avatars?.[slug]?.assetRevision;
  }
  bundled(slug) { return this.exists(path.join(this.bundledRoot,slug),'manifest.json'); }
  locked(slug){return !this.runtime.keys&&[this.bundledRoot,this.downloadsRoot].some(root=>fs.existsSync(path.join(root,slug,'base.gla')));}
  archive(file){
    try{const stat=fs.statSync(file),cached=this.packages.get(file);if(cached&&cached.mtime===stat.mtimeMs&&cached.size===stat.size)return cached.pack;
      const pack=new ProtectedPackage(file,this.runtime.keys);this.packages.set(file,{pack,mtime:stat.mtimeMs,size:stat.size});return pack;
    }catch{return null;}
  }
  exists(root,rel){return Boolean(this.resolve([root],rel));}
  plaintextMatches(root,revision){
    if(!revision)return true;
    try{const own=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'))).assetRevision;return !own||own===revision;}catch{return !fs.existsSync(path.join(root,'manifest.json'));}
  }
  resolve(roots,rel){
    if(typeof rel!=='string'||rel.includes('\\')||path.isAbsolute(rel)||rel.split('/').some(x=>x==='..'))return null;
    let revision;
    for(const root of roots){const base=this.archive(path.join(root,'base.gla'));if(base){revision=base.meta.assetRevision;break;}try{revision=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'))).assetRevision;break;}catch{}}
    if(rel.startsWith('runtime/motions/')){
      const updates=roots.map(root=>this.archive(path.join(root,'motions.gla'))).filter(p=>p&&p.meta.assetRevision===revision);
      const current=updates.find(p=>p.meta.motionRevision===this.loadIndexSync().avatars?.[p.meta.slug]?.motionUpdate?.revision)||updates[0];
      if(current?.entries.has(rel))return {pack:current,name:rel};
    }
    for(const root of roots){
      for(const tier of ['base','balanced','best']){const pack=this.archive(path.join(root,tier+'.gla'));if(pack&&(!revision||pack.meta.assetRevision===revision)&&pack.entries.has(rel))return {pack,name:rel};}
      const target=path.resolve(root,rel);if(this.plaintextMatches(root,revision)&&target.startsWith(path.resolve(root)+path.sep)&&fs.existsSync(target))return target;
    }return null;
  }
  read(file){if(!file)throw Error('Missing avatar resource.');return typeof file==='string'?fs.readFileSync(file):file.pack.read(file.name);}
  size(file){return typeof file==='string'?fs.statSync(file).size:file.pack.entries.get(file.name).size;}
  stream(file,start,end){return typeof file==='string'?fs.createReadStream(file,{start,end}):file.pack.stream(file.name,start,end);}
  hasTier(slug, tier) {
    if (tier === 'base') return this.installed(slug);
    if(tier==='motions')return this.roots(slug).some(root=>{const p=this.archive(path.join(root,'motions.gla'));return p&&p.meta.assetRevision===this.manifest(slug).assetRevision&&p.meta.motionRevision===this.loadIndexSync().avatars?.[slug]?.motionUpdate?.revision;});
    const size = TIER_SIZES[tier]; if (!size) return false;
    if(this.roots(slug).some(root=>{const p=this.archive(path.join(root,tier+'.gla'));return p&&p.meta.assetRevision===this.manifest(slug).assetRevision;}))return true;
    return this.roots(slug).some(root => {
      if(!this.plaintextMatches(root,this.manifest(slug).assetRevision))return false;
      const dir = path.join(root, 'runtime', 'resident');
      try { return fs.readdirSync(dir).some(name => name.startsWith('image-') && name.includes(`-${size}.`)); } catch { return false; }
    });
  }
  status(slug) {
    const index = this.loadIndexSync(); const entry = (index.avatars || {})[slug] || {};
    const mac = {...entry.mac,...(entry.motionUpdate?{motions:entry.motionUpdate.package}:{})};
    const tiers = {};
    for (const tier of ['base', 'motions', 'balanced', 'best']) {
      if (tier === 'base' && this.bundled(slug) && this.matchingRevision(slug)) continue;
      const remote = mac[tier];
      if (!remote && tier !== 'base' && !this.hasTier(slug, tier)) continue;
      tiers[tier] = { removable:tier!=='motions'||fs.existsSync(path.join(this.downloadsRoot,slug,'motions.gla')),label: TIER_LABELS[tier], present: this.hasTier(slug, tier) && (tier!=='base'||this.matchingRevision(slug)), bytes: remote ? remote.bytes : 0, available: Boolean(remote) && (tier === 'base' || this.matchingRevision(slug)) };
    }
    return { slug, name: entry.name || this.manifest(slug).name || slug, bundled: this.bundled(slug), installed: this.installed(slug), locked:this.locked(slug), tiers,
      downloading: this.active && this.active.slug === slug ? this.progress : null };
  }
  avatars() {
    const index = this.loadIndexSync(); const slugs = new Set(Object.keys(index.avatars || {}));
    for (const root of [this.developmentRoot, this.bundledRoot, this.downloadsRoot].filter(Boolean)) { try { for (const d of fs.readdirSync(root)) if (this.exists(path.join(root,d),'manifest.json')) slugs.add(d); } catch {} }
    return [...slugs].filter(slug=>!['sgt-sara','sgt-sarah'].includes(slug)).map(slug => ({ slug, name: ((index.avatars || {})[slug] || {}).name || this.manifest(slug).name || slug, bundled: this.bundled(slug), installed: this.installed(slug) }));
  }

  // ---- model.gltf with only the texture variants that exist locally
  residentDocument(roots) {
    const file = this.resolve(roots, path.join('runtime', 'resident', 'model.gltf'));
    if (!file) return null;
    const doc = JSON.parse(this.read(file));
    const exists = name => Boolean(this.resolve(roots, path.join('runtime', 'resident', name)));
    for (const image of doc.images || []) {
      const variants = image.extras && Array.isArray(image.extras.openclamVariants) ? image.extras.openclamVariants : null;
      if (!variants) continue;
      const kept = variants.filter(v => exists(v.uri)).map(v => ({ ...v, compressed: v.compressed && exists(v.compressed) ? v.compressed : undefined }));
      if (kept.length) { image.extras.openclamVariants = kept; if (!exists(image.uri)) image.uri = kept[kept.length - 1].uri; }
    }
    return Buffer.from(JSON.stringify(doc));
  }

  // ---- downloads
  async response(url,signal){
    const u=new URL(url);if(!this.baseURL||(!this.allowLocal&&u.protocol!=='https:')||u.origin!==new URL(this.baseURL).origin)throw Error('Protected downloads are not configured for this build.');
    const response=await this.fetcher(url,{headers:{'Authorization':'Bearer '+(this.runtime.downloadToken||''),'User-Agent':'GPT-Live-Avatar'},signal,redirect:'error',cache:'no-store'});
    if(!response.ok){await response.body?.cancel();throw Error(response.status===429?'The download service has reached its safe daily limit. Please try tomorrow.':`Avatar download failed (HTTP ${response.status}).`);}return response;
  }
  async fetchBuffer(url,_unused,timeout=15000){
    const r=await this.response(url,AbortSignal.timeout(timeout));let size=0,parts=[];for await(const chunk of r.body){size+=chunk.length;if(size>2*1024*1024)throw Error('Catalogue exceeds its size limit.');parts.push(chunk);}return Buffer.concat(parts);
  }
  emit(patch) { this.progress = { ...(this.progress || {}), ...patch }; this.broadcast(this.progress); }
  async download(slug,tier){
    if(this.downloading)throw Error('Another download is running.');
    this.downloading=true;try{const result=await this.performDownload(slug,tier);if(tier==='base'&&this.loadIndexSync().avatars?.[slug]?.motionUpdate&&!this.hasTier(slug,'motions'))await this.performDownload(slug,'motions');return result;}finally{this.downloading=false;}
  }
  async performDownload(slug,tier){
    if(this.active)throw Error('Another download is running.');
    if(!/^[a-z0-9_-]{1,40}$/.test(slug)||!['base','balanced','best','motions'].includes(tier))throw Error('Invalid avatar selection.');
    const entry=this.loadIndexSync().avatars?.[slug],remote=tier==='motions'?entry?.motionUpdate?.package:entry?.mac?.[tier];if(!remote||remote.format!=='gla-pack-v1')throw Error('No protected package is published for this avatar.');
    if(tier!=='base'&&(!this.installed(slug)||!this.matchingRevision(slug)))throw Error('Download the matching avatar package first.');
    await this.ensureKeys();
    const dest=path.join(this.downloadsRoot,slug),tmp=path.join(this.downloadsRoot,'tmp',crypto.randomUUID()+'.partial');await fsp.mkdir(path.dirname(tmp),{recursive:true});await fsp.mkdir(dest,{recursive:true});
    const abort=new AbortController();this.active={slug,tier,abort,cancelled:false};this.emit({slug,tier,phase:'download',received:0,total:remote.bytes,percent:0,error:''});
    try{
      const hash=crypto.createHash('sha256');let bytes=0,last=0;const signal=AbortSignal.any([abort.signal,AbortSignal.timeout(20*60*1000)]);
      const chunks=async function*(){for(const part of remote.parts){const r=await this.response(this.baseURL+part.file,signal),partHash=crypto.createHash('sha256');let received=0;for await(const chunk of r.body){signal.throwIfAborted();bytes+=chunk.length;received+=chunk.length;if(received>part.bytes||bytes>remote.bytes)throw Error('Download is larger than its signed size.');hash.update(chunk);partHash.update(chunk);if(Date.now()-last>150){last=Date.now();this.emit({received:bytes,percent:Math.min(99,Math.floor(100*bytes/remote.bytes))});}yield chunk;}if(received!==part.bytes||partHash.digest('hex')!==part.sha256)throw Error('A download part failed verification. Please retry.');}}.bind(this);
      await pipeline(chunks(),fs.createWriteStream(tmp,{flags:'wx',mode:0o600}),{signal});
      this.emit({phase:'verify',percent:99});if(bytes!==remote.bytes||hash.digest('hex')!==remote.sha256)throw Error('The download failed its integrity check. Please retry.');
      const pack=new ProtectedPackage(tmp,this.runtime.keys);if(pack.meta.slug!==slug||pack.meta.tier!==tier||pack.meta.assetRevision!==entry.assetRevision)throw Error('The package does not match this avatar revision.');
      if(tier==='motions'&&pack.meta.motionRevision!==entry.motionUpdate.revision)throw Error('The motion update does not match this release.');
      if(tier==='base'){const manifest=JSON.parse(pack.read('manifest.json'));if(manifest.assetRevision!==entry.assetRevision||manifest.renderer!=='3d')throw Error('Invalid avatar manifest.');}
      abort.signal.throwIfAborted();await fsp.rename(tmp,path.join(dest,tier+'.gla'));this.packages.clear();this.emit({phase:'done',percent:100});
    }catch(e){await fsp.rm(tmp,{force:true}).catch(()=>{});this.emit({phase:'error',error:abort.signal.aborted?'Cancelled.':e.message});throw e;}
    finally{this.active=null;setTimeout(()=>{if(!this.active){this.progress=null;this.broadcast(null);}},1500);}
  }
  cancel(){if(this.active){this.active.cancelled=true;this.active.abort.abort();}}
  async remove(slug, tier) {
    if(!/^[a-z0-9_-]{1,40}$/.test(slug)||!['base','balanced','best','motions'].includes(tier))throw Error('Invalid avatar selection.');
    if (this.active && this.active.slug === slug) throw new Error('Wait for the download to finish.');
    const dest = path.join(this.downloadsRoot, slug);
    if (tier === 'base') { await fsp.rm(dest, { recursive: true, force: true }); return; }
    await fsp.rm(path.join(dest,tier+'.gla'),{force:true});this.packages.clear();
    if(tier==='motions')return;
    const size = TIER_SIZES[tier]; if (!size) return;
    const dir = path.join(dest, 'runtime', 'resident');
    try { for (const name of await fsp.readdir(dir)) if (name.startsWith('image-') && name.includes(`-${size}.`)) await fsp.rm(path.join(dir, name), { force: true }); } catch {}
  }
}

module.exports = { AvatarAssets, RELEASE_BASE, TIER_SIZES };
