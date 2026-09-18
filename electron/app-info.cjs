'use strict';
const path = require('node:path');
const releaseInfo = require('./release-info.json');
const { REPOSITORY, RELEASES, compareVersions, latestRelease } = require('./releases.cjs');

function createAppInfo({ origin, fetchRelease = latestRelease, openExternal, version } = {}) {
  const { app, BrowserWindow, ipcMain, shell } = require('electron');
  version ||= app.getVersion();
  openExternal ||= url => shell.openExternal(url);
  let window = null, pending = null, abort = null, generation = 0;
  let update = { state: 'idle' };
  const details = releaseInfo.version === version ? releaseInfo : { title: 'GPT-Live Avatar', description: releaseInfo.description, highlights: [] };
  const snapshot = () => ({ version, architecture: process.arch === 'arm64' ? 'Apple silicon' : process.arch === 'x64' ? 'Intel' : process.arch,
    date: details.date || '', title: details.title, description: details.description, highlights: details.highlights, update });
  const publish = () => { if (window && !window.isDestroyed()) window.webContents.send('gla:app-info:changed', snapshot()); };
  // A quiet check (once, shortly after launch) only ever turns the menu row into
  // “Update to …”; a failure stays silent instead of greeting the user with an error.
  async function check({ quiet = false } = {}) {
    if (pending) return pending;
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
    if (checkNow) void check();
  }
  const guard = handler => (event, ...args) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.sender.getURL() !== origin + '/app-info.html') throw Error('Untrusted app information request.');
    return handler(...args);
  };
  ipcMain.handle('gla:app-info:get', guard(snapshot));
  ipcMain.handle('gla:app-info:check', guard(async () => { await check(); return snapshot(); }));
  ipcMain.handle('gla:app-info:open', guard(async kind => {
    const url = kind === 'download' && update.state === 'available' ? update.downloadURL :
      kind === 'release' ? update.releaseURL || RELEASES : kind === 'repository' ? REPOSITORY : null;
    if (!url) throw Error('That release action is unavailable.');
    await openExternal(url); return true;
  }));
  const quietTimer = setTimeout(() => { if (update.state === 'idle') void check({ quiet: true }); }, 20000); quietTimer.unref?.();
  // The version is always in view; what used to be About (what is new, licence,
  // links) lives in the same window as the update check.
  return { menu: () => [{ label: update.state === 'available' ? `Update to ${update.version}…` : 'Check for Updates…', click: () => open(update.state !== 'available') },
    { label: `GPT-Live Avatar ${version}`, enabled: false }], open,
    dispose() { clearTimeout(quietTimer); generation++; abort?.abort(); window?.destroy(); for (const name of ['get', 'check', 'open']) ipcMain.removeHandler('gla:app-info:' + name); } };
}
module.exports = { createAppInfo };
