'use strict';
// Avatar packages and texture tiers.
//
// The app ships a resource-friendly package per bundled avatar (512/1024
// textures, meshes, rig, motions). The 2K "balanced" and 4K "best" textures,
// and every non-bundled avatar, are downloaded on demand from the GitHub
// release and unpacked next to the bundle in the user's data folder. Both
// locations are overlaid when files are served, so a downloaded tier simply
// adds larger variants to the same resident model.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const RELEASE_BASE = 'https://github.com/tivojn/gpt-live-avatar/releases/download/assets-v1/';
const TIER_SIZES = { balanced: 2048, best: 4096 };
const TIER_LABELS = { base: 'Avatar package (1K textures, meshes, motions)', balanced: 'Balanced: 2K textures', best: 'Best quality: 4K textures' };

class AvatarAssets {
  constructor({ bundledRoot, downloadsRoot, bundledIndexPath, broadcast }) {
    this.bundledRoot = bundledRoot; this.downloadsRoot = downloadsRoot; this.bundledIndexPath = bundledIndexPath;
    this.broadcast = broadcast || (() => {});
    this.active = null; // { slug, tier, request, cancelled }
    this.progress = null;
    this.index = null;
  }

  // ---- catalogue
  loadIndexSync() {
    if (this.index) return this.index;
    for (const p of [path.join(this.downloadsRoot, 'index.json'), this.bundledIndexPath]) {
      try { const parsed = JSON.parse(fs.readFileSync(p, 'utf8')); if (parsed && parsed.avatars) { this.index = parsed; break; } } catch {}
    }
    if (!this.index) this.index = { version: 1, avatars: {} };
    return this.index;
  }
  async refreshIndex() {
    try {
      const data = await this.fetchBuffer(RELEASE_BASE + 'index.json', null, 15000);
      const parsed = JSON.parse(data.toString('utf8'));
      if (parsed && parsed.avatars) {
        await fsp.mkdir(this.downloadsRoot, { recursive: true });
        await fsp.writeFile(path.join(this.downloadsRoot, 'index.json'), JSON.stringify(parsed, null, 1));
        this.index = parsed;
      }
    } catch (error) { this.lastIndexError = error.message; }
    return this.loadIndexSync();
  }

  // ---- locations
  roots(slug) {
    return [path.join(this.bundledRoot, slug), path.join(this.downloadsRoot, slug)].filter(dir => fs.existsSync(path.join(dir, 'manifest.json')) || fs.existsSync(path.join(dir, 'runtime')));
  }
  installed(slug) { return this.roots(slug).some(dir => fs.existsSync(path.join(dir, 'manifest.json'))); }
  bundled(slug) { return fs.existsSync(path.join(this.bundledRoot, slug, 'manifest.json')); }
  resolve(roots, rel) {
    for (const root of roots) {
      const target = path.normalize(path.join(root, rel));
      if (!target.startsWith(path.normalize(root) + path.sep)) continue;
      if (fs.existsSync(target)) return target;
    }
    return null;
  }
  hasTier(slug, tier) {
    if (tier === 'base') return this.installed(slug);
    const size = TIER_SIZES[tier]; if (!size) return false;
    return this.roots(slug).some(root => {
      const dir = path.join(root, 'runtime', 'resident');
      try { return fs.readdirSync(dir).some(name => name.startsWith('image-') && name.includes(`-${size}.`)); } catch { return false; }
    });
  }
  status(slug) {
    const index = this.loadIndexSync(); const entry = (index.avatars || {})[slug] || {};
    const mac = entry.mac || {};
    const tiers = {};
    for (const tier of ['base', 'balanced', 'best']) {
      if (tier === 'base' && this.bundled(slug)) continue;
      const remote = mac[tier];
      if (!remote && tier !== 'base') continue;
      tiers[tier] = { label: TIER_LABELS[tier], present: this.hasTier(slug, tier), bytes: remote ? remote.bytes : 0, available: Boolean(remote) };
    }
    return { slug, name: entry.name || slug, bundled: this.bundled(slug), installed: this.installed(slug), tiers,
      downloading: this.active && this.active.slug === slug ? this.progress : null };
  }
  avatars() {
    const index = this.loadIndexSync(); const slugs = new Set(Object.keys(index.avatars || {}));
    for (const root of [this.bundledRoot, this.downloadsRoot]) { try { for (const d of fs.readdirSync(root)) if (fs.existsSync(path.join(root, d, 'manifest.json'))) slugs.add(d); } catch {} }
    return [...slugs].map(slug => ({ slug, name: ((index.avatars || {})[slug] || {}).name || slug, bundled: this.bundled(slug), installed: this.installed(slug) }));
  }

  // ---- model.gltf with only the texture variants that exist locally
  residentDocument(roots) {
    const file = this.resolve(roots, path.join('runtime', 'resident', 'model.gltf'));
    if (!file) return null;
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
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
  fetchBuffer(url, onChunk, timeout = 30000, redirects = 0) {
    return new Promise((resolve, reject) => {
      const request = https.get(url, { headers: { 'User-Agent': 'gpt-live-avatar' }, timeout }, response => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location && redirects < 6) {
          response.resume(); resolve(this.fetchBuffer(new URL(response.headers.location, url).href, onChunk, timeout, redirects + 1)); return;
        }
        if (response.statusCode !== 200) { response.resume(); reject(new Error(`HTTP ${response.statusCode} for ${path.basename(url)}`)); return; }
        const total = Number(response.headers['content-length']) || 0; const chunks = [];
        let received = 0;
        response.on('data', chunk => { received += chunk.length; if (onChunk) onChunk(chunk, received, total); else chunks.push(chunk); });
        response.on('end', () => resolve(onChunk ? null : Buffer.concat(chunks)));
        response.on('error', reject);
        if (this.active) this.active.request = request;
      });
      request.on('timeout', () => request.destroy(new Error('Download timed out.')));
      request.on('error', reject);
    });
  }
  emit(patch) { this.progress = { ...(this.progress || {}), ...patch }; this.broadcast(this.progress); }
  async download(slug, tier) {
    if (this.active) throw new Error('Another download is running.');
    const index = this.loadIndexSync(); const remote = (((index.avatars || {})[slug] || {}).mac || {})[tier];
    if (!remote) throw new Error(`No ${tier} package is published for ${slug}.`);
    const dest = path.join(this.downloadsRoot, slug); const tmpDir = path.join(this.downloadsRoot, 'tmp');
    await fsp.mkdir(dest, { recursive: true }); await fsp.mkdir(tmpDir, { recursive: true });
    const zipPath = path.join(tmpDir, remote.file);
    this.active = { slug, tier, request: null, cancelled: false };
    this.progress = { slug, tier, phase: 'download', received: 0, total: remote.bytes || 0, percent: 0, error: '' };
    this.broadcast(this.progress);
    try {
      const hash = crypto.createHash('sha256'); const out = fs.createWriteStream(zipPath);
      let lastEmit = 0;
      await this.fetchBuffer(RELEASE_BASE + remote.file, (chunk, received, total) => {
        hash.update(chunk); out.write(chunk);
        const size = total || remote.bytes || 0; const now = Date.now();
        if (now - lastEmit > 150) { lastEmit = now; this.emit({ received, total: size, percent: size ? Math.min(99, Math.floor(received / size * 100)) : 0 }); }
      });
      await new Promise((resolve, reject) => out.end(err => err ? reject(err) : resolve()));
      if (this.active.cancelled) throw new Error('Cancelled.');
      this.emit({ phase: 'verify', percent: 99 });
      const digest = hash.digest('hex');
      if (remote.sha256 && digest !== remote.sha256) throw new Error('The download was corrupted; please try again.');
      this.emit({ phase: 'extract' });
      await new Promise((resolve, reject) => {
        const child = spawn('/usr/bin/ditto', ['-x', '-k', zipPath, dest], { stdio: 'ignore' });
        child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Unpacking failed (${code}).`)));
      });
      await fsp.rm(zipPath, { force: true });
      this.emit({ phase: 'done', percent: 100 });
    } catch (error) {
      await fsp.rm(zipPath, { force: true }).catch(() => {});
      this.emit({ phase: 'error', error: error.message });
      throw error;
    } finally { this.active = null; setTimeout(() => { if (!this.active) { this.progress = null; this.broadcast(null); } }, 1500); }
  }
  cancel() { if (this.active) { this.active.cancelled = true; if (this.active.request) this.active.request.destroy(new Error('Cancelled.')); } }
  async remove(slug, tier) {
    if (this.active && this.active.slug === slug) throw new Error('Wait for the download to finish.');
    const dest = path.join(this.downloadsRoot, slug);
    if (tier === 'base') { await fsp.rm(dest, { recursive: true, force: true }); return; }
    const size = TIER_SIZES[tier]; if (!size) return;
    const dir = path.join(dest, 'runtime', 'resident');
    try { for (const name of await fsp.readdir(dir)) if (name.startsWith('image-') && name.includes(`-${size}.`)) await fsp.rm(path.join(dir, name), { force: true }); } catch {}
  }
}

module.exports = { AvatarAssets, RELEASE_BASE, TIER_SIZES };
