'use strict';
const path = require('node:path');
const releaseInfo = require('./release-info.json');
const { REPOSITORY, RELEASES, compareVersions, latestRelease } = require('./releases.cjs');
const { Updater } = require('./updater.cjs');

function createAppInfo({ origin, fetchRelease = latestRelease, openExternal, version, updater, quit } = {}) {
  const { app, BrowserWindow, ipcMain, shell, net } = require('electron');
  version ||= app.getVersion();
  updater ||= new Updater({ directory: path.join(app.getPath('userData'), 'updates'), currentVersion: version, isPackaged: app.isPackaged, fetchImpl: (url, init) => net.fetch(url, init) });
  quit ||= () => app.quit();
  openExternal ||= url => shell.openExternal(url);
  let window = null, pending = null, abort = null, generation = 0;
  let update = { state: 'idle' };
  const details = releaseInfo.version === version ? releaseInfo : { title: 'GPT-Live Avatar', description: releaseInfo.description, highlights: [] };
  const snapshot = () => ({ version, platform: process.platform, architecture: process.platform !== 'darwin' ? (process.platform === 'win32' ? 'Windows · ' : '') + process.arch : process.arch === 'arm64' ? 'Apple silicon' : process.arch === 'x64' ? 'Intel' : process.arch,
    date: details.date || '', title: details.title, description: details.description, highlights: details.highlights, update: { ...update, installable: canInstall() } });
  const publish = () => { if (window && !window.isDestroyed()) window.webContents.send('gla:app-info:changed', snapshot()); };
  // A quiet check (once, shortly after launch) only ever turns the menu row into
  // “Update to …”; a failure stays silent instead of greeting the user with an error.
  const busy = () => ['downloading', 'verifying', 'ready', 'installing'].includes(update.state);
  async function check({ quiet = false } = {}) {
    if (pending) return pending;
    if (busy()) return; // a check must not throw away an update that is on its way
    const own = ++generation; abort = new AbortController(); update = { state: 'checking' }; publish();
    pending = (async () => {
      try {
        const latest = await fetchRelease({ signal: abort.signal });
        if (own !== generation) return;
        const comparison = compareVersions(latest.version, version);
        update = { state: comparison > 0 ? 'available' : comparison < 0 ? 'ahead' : 'current', ...latest };
      } catch (error) {
        if (own !== generation) return;
        update = quiet ? { state: 'idle' } : { state: 'error', message: error.name === 'TimeoutError' ? 'The update check timed out. Please try again.' :
          /^(GitHub |No public |The release |The update)/.test(error.message) ? error.message : 'Could not check for updates. Check your connection and try again.' };
      } finally { if (own === generation) { pending = null; abort = null; publish(); } }
    })();
    return pending;
  }
  // The release the user is acting on. Each step is theirs to start; a refusal
  // returns to "available" with the reason, and the download is already gone.
  let transfer = null, verified = null, transfers = 0; // its own counter: closing the window must not orphan a download
  // electron/updater.cjs is entirely macOS tooling (hdiutil, codesign, spctl,
  // ditto), so it must never run elsewhere: off macOS the user is offered the
  // official installer to run themselves, however complete latest.json is.
  const canInstall = () => process.platform === 'darwin' && Boolean(update.downloadURL && update.sha256);
  async function download() {
    if (update.state !== 'available' || !canInstall() || transfer) return;
    const release = { ...update }, own = ++transfers; transfer = new AbortController();
    const fail = error => { if (own === transfers) { update = { ...release, state: 'available', problem: error?.refused ? error.message : error?.name === 'AbortError' ? '' : 'The update could not be downloaded. Check your connection and try again.' }; publish(); } };
    try {
      update = { ...release, state: 'downloading', percent: 0, problem: '' }; publish();
      const file = await updater.download(release, { signal: transfer.signal, onProgress: p => { if (own === transfers && p.percent !== update.percent) { update = { ...update, percent: p.percent }; publish(); } } });
      if (own !== transfers) return;
      update = { ...release, state: 'verifying', problem: '' }; publish();
      verified = await updater.verify(file, release);
      if (own !== transfers) { await verified.detach(); verified = null; return; }
      update = { ...release, state: 'ready', problem: '' }; publish();
    } catch (error) { verified = null; fail(error); } finally { transfer = null; }
  }
  async function install() {
    if (update.state !== 'ready' || !verified) return;
    const release = { ...update }, image = verified; verified = null;
    try {
      update = { ...release, state: 'installing' }; publish();
      await updater.install(await updater.stage(image));
      quit();
    } catch (error) { update = { ...release, state: 'available', problem: error?.refused ? error.message : 'The update could not be installed. The app was left as it is.' }; publish(); }
  }
  function open(checkNow = false) {
    if (!window || window.isDestroyed()) {
      window = new BrowserWindow({ width: 540, height: 690, minWidth: 440, minHeight: 500, title: 'GPT-Live Avatar · Version and updates',
        backgroundColor: '#f7f8fc', show: false, autoHideMenuBar: true,
        webPreferences: { preload: path.join(__dirname, 'app-info-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
      window.once('ready-to-show', () => { window?.show(); });
      window.on('closed', () => { window = null; generation++; abort?.abort(); abort = null; pending = null; if (update.state === 'checking') update = { state: 'idle' }; });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', event => event.preventDefault());
      void window.loadURL(origin + '/app-info.html');
    } else { if (window.isMinimized()) window.restore(); window.show(); window.focus(); }
    if (checkNow && !busy()) void check();
  }
  const guard = handler => (event, ...args) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.sender.getURL() !== origin + '/app-info.html') throw Error('Untrusted app information request.');
    return handler(...args);
  };
  ipcMain.handle('gla:app-info:get', guard(snapshot));
  ipcMain.handle('gla:app-info:check', guard(async () => { await check(); return snapshot(); }));
  ipcMain.handle('gla:app-info:download', guard(async () => { void download(); return snapshot(); }));
  ipcMain.handle('gla:app-info:install', guard(async () => { void install(); return snapshot(); }));
  ipcMain.handle('gla:app-info:open', guard(async kind => {
    const url = kind === 'download' && update.state === 'available' && !canInstall() ? update.downloadURL :
      kind === 'release' ? update.releaseURL || RELEASES : kind === 'repository' ? REPOSITORY : null;
    if (!url) throw Error('That release action is unavailable.');
    await openExternal(url); return true;
  }));
  const quietTimer = setTimeout(() => { if (update.state === 'idle') void check({ quiet: true }); }, 20000); quietTimer.unref?.();
  // The version is always in view; what used to be About (what is new, licence,
  // links) lives in the same window as the update check.
  const row = () => update.state === 'ready' ? { label: `Install ${update.version} and Relaunch`, click: () => void install() } :
    update.state === 'downloading' ? { label: `Downloading ${update.version}… ${update.percent}%`, click: () => open() } :
    update.state === 'verifying' ? { label: `Verifying ${update.version}…`, click: () => open() } :
    update.state === 'installing' ? { label: `Installing ${update.version}…`, enabled: false } :
    update.state === 'available' ? { label: `Update to ${update.version}…`, click: () => open() } : { label: 'Check for Updates…', click: () => open(true) };
  return { menu: () => [row(),
    { label: `GPT-Live Avatar ${version}`, enabled: false }], open,
    dispose() { clearTimeout(quietTimer); generation++; abort?.abort(); transfers++; transfer?.abort(); void verified?.detach(); window?.destroy(); for (const name of ['get', 'check', 'open', 'download', 'install']) ipcMain.removeHandler('gla:app-info:' + name); } };
}
module.exports = { createAppInfo };
