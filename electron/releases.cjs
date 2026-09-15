'use strict';
const REPOSITORY = 'https://github.com/tivojn/gpt-live-avatar';
const RELEASES = REPOSITORY + '/releases';
const API = 'https://api.github.com/repos/tivojn/gpt-live-avatar/releases/latest';

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
function releaseDetails(doc, { arch = process.arch, platform = process.platform } = {}) {
  if (!doc || doc.draft || doc.prerelease || typeof doc.tag_name !== 'string' || versionParts(doc.tag_name).pre.length) throw Error('GitHub returned an unsupported release.');
  const tag = doc.tag_name;
  const page = RELEASES + '/tag/' + tag;
  if (doc.html_url !== page) throw Error('The release link could not be verified.');
  let downloadURL = null;
  if (platform === 'darwin' && ['arm64', 'x64'].includes(arch)) {
    const asset = (Array.isArray(doc.assets) ? doc.assets : []).find(a => {
      if (a.state !== 'uploaded' || typeof a.name !== 'string' || !a.name.endsWith('-' + arch + '.dmg')) return false;
      const prefix = RELEASES + '/download/' + tag + '/';
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
async function latestRelease({ signal, fetchImpl = fetch, arch, platform } = {}) {
  const response = await fetchImpl(API, { headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000) });
  if (!response.ok) {
    await response.body?.cancel();
    if ([403, 429].includes(response.status)) throw Error('GitHub is temporarily limiting update checks. Try again later, or open Releases.');
    if (response.status === 404) throw Error('No public release is available yet. Try again later.');
    throw Error('GitHub could not be reached. Please try again later.');
  }
  const reader = response.body.getReader(); let size = 0; const chunks = [];
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength;
      if (size > 1024 * 1024) throw Error('The release response was too large.'); chunks.push(Buffer.from(value)); }
  } finally { await reader.cancel().catch(() => {}); }
  return releaseDetails(JSON.parse(Buffer.concat(chunks).toString('utf8')), { arch, platform });
}
module.exports = { REPOSITORY, RELEASES, compareVersions, releaseDetails, latestRelease };
