'use strict';
// Update checks read releases/latest.json from the private Cloudflare Worker
// that already serves protected downloads (no GitHub account or public
// repository required). The GitHub releases API remains a fallback only while
// that service cannot be reached.
const DOWNLOAD_CONFIG = require('./asset-download.json');
const GITHUB_REPOSITORY = 'https://github.com/tivojn/gpt-live-avatar';
const GITHUB_RELEASES = GITHUB_REPOSITORY + '/releases';
const GITHUB_API = 'https://api.github.com/repos/tivojn/gpt-live-avatar/releases/latest';
const RELEASE_BASE = /^https:\/\/[-a-z0-9.]+\/$/.test(DOWNLOAD_CONFIG.baseURL || '') ? DOWNLOAD_CONFIG.baseURL + 'releases/' : null;
const LATEST_URL = RELEASE_BASE ? RELEASE_BASE + 'latest.json' : null;
const REPOSITORY = GITHUB_REPOSITORY;
const RELEASES = RELEASE_BASE || GITHUB_RELEASES;

function versionParts(value) {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(String(value));
  if (!match || match.slice(1, 4).some(n => !Number.isSafeInteger(Number(n)))) throw Error('Invalid release version.');
  const pre = match[4]?.split('.') || [];
  if (pre.some(n => /^\d+$/.test(n) && (n.length > 1 && n[0] === '0' || !Number.isSafeInteger(Number(n))))) throw Error('Invalid release version.');
  return { numbers: match.slice(1, 4).map(Number), pre };
}
function compareVersions(left, right) {
  const a = versionParts(left), b = versionParts(right);
  for (let i = 0; i < 3; i++) if (a.numbers[i] !== b.numbers[i]) return a.numbers[i] > b.numbers[i] ? 1 : -1;
  if (!a.pre.length || !b.pre.length) return a.pre.length === b.pre.length ? 0 : a.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i], y = b.pre[i];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    if (nx && ny) return Number(x) > Number(y) ? 1 : -1;
    if (nx !== ny) return nx ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}
// One installer per platform and architecture. `key` names the entry inside
// releases/latest.json and the installer file on the release service. macOS
// keys stay the bare architecture so documents published for 0.2.22 and later,
// and the apps that read them, keep working unchanged.
const INSTALLER_TARGETS = {
  darwin: { arm64: { key: 'arm64', extension: 'dmg' }, x64: { key: 'x64', extension: 'dmg' } },
  win32: { x64: { key: 'win-x64', extension: 'exe' } },
};
function installerTarget(platform, arch) {
  const target = INSTALLER_TARGETS[platform]?.[arch];
  return target ? { ...target, name: version => 'gpt-live-avatar-' + version + '-' + target.key + '.' + target.extension } : null;
}
// releases/latest.json as written by tools/cloud/publish-release.cjs.
function installerDetails(doc, { arch = process.arch, platform = process.platform } = {}) {
  const unsupported = () => Error('The release service returned an unsupported release.');
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || typeof doc.version !== 'string' || /^v/.test(doc.version)) throw unsupported();
  let parts; try { parts = versionParts(doc.version); } catch { throw unsupported(); }
  if (parts.pre.length) throw unsupported();
  const version = doc.version;
  const installers = doc.installers && typeof doc.installers === 'object' && !Array.isArray(doc.installers) ? doc.installers : {};
  let downloadURL = null, sha256 = null, bytes = null;
  const target = installerTarget(platform, arch);
  if (RELEASE_BASE && target) {
    // The flat url/arch fields are the pre-0.2.27, macOS-only shape of this document.
    const entry = installers[target.key] || (platform === 'darwin' && doc.arch === arch ? doc : null);
    // Only an installer on the configured release service, named for this exact version and target.
    if (entry && typeof entry === 'object' && entry.url === RELEASE_BASE + target.name(version) &&
        /^[a-f0-9]{64}$/.test(entry.sha256 || '') && Number.isSafeInteger(entry.bytes) && entry.bytes > 0) {
      downloadURL = entry.url; sha256 = entry.sha256; bytes = entry.bytes;
    }
  }
  return { version, title: String(doc.title || 'GPT-Live Avatar ' + version).slice(0, 160),
    notes: String(doc.notes || 'See the release page for details.').slice(0, 10000),
    publishedAt: typeof doc.publishedAt === 'string' ? doc.publishedAt.slice(0, 40) : null,
    releaseURL: RELEASE_BASE, downloadURL, sha256, bytes };
}
// Legacy GitHub releases API document.
function releaseDetails(doc, { arch = process.arch, platform = process.platform } = {}) {
  if (!doc || doc.draft || doc.prerelease || typeof doc.tag_name !== 'string' || versionParts(doc.tag_name).pre.length) throw Error('GitHub returned an unsupported release.');
  const tag = doc.tag_name;
  const page = GITHUB_RELEASES + '/tag/' + tag;
  if (doc.html_url !== page) throw Error('The release link could not be verified.');
  let downloadURL = null;
  const target = installerTarget(platform, arch);
  if (target) {
    const suffix = '-' + target.key + '.' + target.extension;
    const asset = (Array.isArray(doc.assets) ? doc.assets : []).find(a => {
      if (a.state !== 'uploaded' || typeof a.name !== 'string' || !a.name.endsWith(suffix)) return false;
      const prefix = GITHUB_RELEASES + '/download/' + tag + '/';
      if (typeof a.browser_download_url !== 'string' || !a.browser_download_url.startsWith(prefix)) return false;
      try {
        const url = new URL(a.browser_download_url);
        return !url.search && !url.hash && decodeURIComponent(url.pathname.slice(new URL(prefix).pathname.length)) === a.name && !/[\/\\]/.test(a.name);
      } catch { return false; }
    });
    if (asset) downloadURL = asset.browser_download_url;
  }
  return { version: tag.replace(/^v/, ''), title: String(doc.name || tag).slice(0, 160),
    notes: String(doc.body || 'See the release page for details.').slice(0, 10000),
    releaseURL: page, downloadURL };
}
async function readJSON(response) {
  const reader = response.body.getReader(); let size = 0; const chunks = [];
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength;
      if (size > 1024 * 1024) throw Error('The release response was too large.'); chunks.push(Buffer.from(value)); }
  } finally { await reader.cancel().catch(() => {}); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
const timeout = signal => signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000);
async function serviceRelease({ signal, fetchImpl, arch, platform }) {
  let response;
  try { response = await fetchImpl(LATEST_URL, { headers: { Accept: 'application/json' }, redirect: 'error', signal: timeout(signal) }); }
  catch (error) { if (signal?.aborted) throw error; throw Object.assign(Error('The update service could not be reached. Please try again later.'), { cause: error }); }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 404) throw Error('No public release is available yet. Try again later.');
    throw Error('The update service could not be reached. Please try again later.');
  }
  let doc; try { doc = await readJSON(response); } catch (error) { if (/too large/.test(error.message)) throw error; throw Error('The release service returned an unsupported release.'); }
  return installerDetails(doc, { arch, platform });
}
async function githubRelease({ signal, fetchImpl, arch, platform }) {
  const response = await fetchImpl(GITHUB_API, { headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, redirect: 'error', signal: timeout(signal) });
  if (!response.ok) {
    await response.body?.cancel();
    if ([403, 429].includes(response.status)) throw Error('GitHub is temporarily limiting update checks. Try again later, or open Releases.');
    if (response.status === 404) throw Error('No public release is available yet. Try again later.');
    throw Error('GitHub could not be reached. Please try again later.');
  }
  return releaseDetails(await readJSON(response), { arch, platform });
}
async function latestRelease({ signal, fetchImpl = fetch, arch, platform } = {}) {
  if (!LATEST_URL) return githubRelease({ signal, fetchImpl, arch, platform });
  try { return await serviceRelease({ signal, fetchImpl, arch, platform }); }
  catch (serviceError) {
    if (signal?.aborted) throw serviceError;
    // The release service is authoritative; GitHub only covers an outage or a not-yet-published service.
    try { return await githubRelease({ signal, fetchImpl, arch, platform }); }
    catch (githubError) { if (signal?.aborted) throw githubError; throw serviceError; }
  }
}
module.exports = { REPOSITORY, RELEASES, GITHUB_RELEASES, RELEASE_BASE, LATEST_URL, INSTALLER_TARGETS, installerTarget, compareVersions, installerDetails, releaseDetails, latestRelease };
