'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const root = process.env.GLA_SOURCE_ROOT || path.resolve(__dirname, '..');
const { musicMenu } = require(path.join(root, 'electron/music-menu.cjs'));
const events = [];
const send = action => () => events.push(action);
const item = (menu, label) => menu.find(x => x.label === label);
const sing = menu => item(menu, 'Sing Along to Current Song');
const dance = menu => item(menu, 'Dance Along to Current Song');
const stop = menu => item(menu, 'Stop Singing & Dancing');

const idle = musicMenu({ hasKey: false, agentEnabled: false }, send, 'sarah');
assert.equal(sing(idle).enabled, true, 'Music needs neither a voice API key nor an external agent');
assert.equal(dance(idle).enabled, true);
assert.equal(sing(idle).checked, false);
assert.equal(dance(idle).checked, false);
assert.equal(stop(idle).enabled, false);
sing(idle).click(); dance(idle).click();
assert.deepEqual(events, ['music:sing', 'music:dance']);

const session = { source: 'Spotify', targets: [{ id: 'sarah', mode: 'sing' }, { id: 'tia', mode: 'dance' }] };
const sarah = musicMenu({ music: session }, send, 'sarah');
assert.equal(sing(sarah).checked, true);
assert.equal(dance(sarah).checked, false);
assert.equal(sarah[0].label, 'Sing-along · Spotify');
assert.equal(stop(sarah).enabled, true);
const tia = musicMenu({ music: session }, send, 'tia');
assert.equal(sing(tia).checked, false);
assert.equal(dance(tia).checked, true);
assert.equal(tia[0].label, 'Dance-along · Spotify');
stop(tia).click(); assert.equal(events.at(-1), 'stop-performing');
const other = musicMenu({ music: session }, send, 'iselda');
assert.equal(sing(other).checked, false, 'Another avatar’s performance is not this avatar’s status');
assert.equal(dance(other).checked, false);
assert.equal(stop(other).enabled, false);
assert.equal(other.some(x => x.label.includes('Spotify')), false);

const pending = musicMenu({ musicPending: true }, send, 'sarah');
assert.equal(pending[0].label, 'Getting music ready…');
assert.equal(sing(pending).enabled, false);
assert.equal(dance(pending).enabled, false);
assert.equal(stop(pending).enabled, true, 'An in-flight music start can be cancelled');
const loading = musicMenu({ musicAvailable: false }, send, 'sarah');
assert.equal(sing(loading).enabled, false);
assert.equal(dance(loading).enabled, false);
assert.equal(stop(musicMenu({ performing: true }, send, 'sarah')).enabled, true, 'A one-shot dance can also be stopped');
assert.doesNotThrow(() => musicMenu({ music: { targets: 'invalid', source: {} } }, send, 'sarah'));
console.log('Music menu: solo/group dispatch, per-avatar mode/status, stop/cancel, readiness and agent-independent access passed.');

// Exercise the actual Electron menu builders with stub windows, so a menu
// regression cannot silently send a group action to the solo avatar.
const fs = require('node:fs');
const vm = require('node:vm');
const mainSource = fs.readFileSync(path.join(root, 'electron/main.cjs'), 'utf8');
let built;
const soloEvents = [];
const avatarWindow = { isDestroyed: () => false, webContents: { send: (...args) => soloEvents.push(args) } };
const soloContext = { musicMenu, avatarWindow, Menu: { buildFromTemplate: template => ({ popup: () => { built = template; } }) },
  config: { agentEnabled: false }, avatarInfo: () => ({ name: 'Sarah' }), avatarReasoningMenu: () => ({ label: 'Reasoning' }), avatarPermissionsMenu: () => ({ label: 'Permissions' }),
  assets: null, VOICES: [], voicePreview: { state: 'idle' }, avatarCatalogueMenu: () => [], avatarShortcuts: null, DEFAULT_SHORTCUTS: {}, appInfo: { menu: () => [] }, app: { name: 'Test' },
  openSettingsWindow() {}, requestAvatarRecovery() {}, requestAvatarCloseup() {}, groupManager: { open() {} } };
vm.runInNewContext(mainSource.slice(mainSource.indexOf('function showAvatarMenu(state) {'), mainSource.indexOf('// Outfits, poses, props and motions')), soloContext);
soloContext.showAvatarMenu({ character: 'sarah', music: session });
sing(built).click(); dance(built).click(); stop(built).click();
assert.deepEqual(soloEvents, [['gla:menu-action', 'music:sing'], ['gla:menu-action', 'music:dance'], ['gla:menu-action', 'stop-performing']]);
assert.equal(stop(built).enabled, true);

const handlers = new Map(), groupEvents = [];
let groupWindow;
class Window {
  constructor() { groupWindow = this; this.webContents = { id: 2, on() {}, send: (...args) => groupEvents.push(args) }; }
  setVisibleOnAllWorkspaces() {} setAlwaysOnTop() {} loadURL() {} once() {} on() {} show() {} focus() {} destroy() {} isDestroyed() { return false; }
}
const groupContext = { module: { exports: {} }, __dirname: path.join(root, 'electron'), setInterval: () => 1, clearInterval() {},
  require: id => id === 'electron' ? { BrowserWindow: Window, ipcMain: { handle: (name, fn) => handlers.set(name, fn), on() {} }, screen: { getPrimaryDisplay: () => ({ workArea: {} }), getDisplayMatching: () => ({ workArea: {} }) }, Menu: { buildFromTemplate: template => ({ popup: ({ callback }) => { built = template; callback(); } }) } }
    : id === './music-menu.cjs' ? { musicMenu } : id === './group-context.cjs' ? { GroupContext: class {} } : id === './delegate.cjs' ? {} : require(id) };
vm.runInNewContext(fs.readFileSync(path.join(root, 'electron/group.cjs'), 'utf8'), groupContext);
const group = groupContext.module.exports.setupGroup({ origin: 'http://localhost', getAvatar: () => null, getSettings: () => ({ avatars: [{ slug: 'sarah', installed: true }, { slug: 'tia', installed: true }] }), getConfig: () => ({ agentEnabled: false }), info: config => ({ ok: true, name: config.avatar === 'tia' ? 'Tia' : 'Sarah' }), avatarReasoningMenu: () => ({ label: 'Reasoning' }), avatarPermissionsMenu: () => ({ label: 'Permissions' }), avatarCatalogueMenu: () => [], shortcuts: () => ({}), backend: { cancel() {} } });
group.open();
(async () => {
  const result = await handlers.get('gla:group:menu')({ sender: groupWindow.webContents }, { slug: 'tia', music: session });
  assert.equal(result.ok, true);
  assert.equal(dance(built).checked, true);
  assert.equal(sing(built).checked, false);
  sing(built).click(); dance(built).click(); stop(built).click();
  assert.deepEqual(JSON.parse(JSON.stringify(groupEvents)), [
    ['gla:group:menu-action', { slug: 'tia', action: 'music:sing' }],
    ['gla:group:menu-action', { slug: 'tia', action: 'music:dance' }],
    ['gla:group:menu-action', { slug: 'tia', action: 'stop-performing' }],
  ]);
  group.dispose();
  console.log('Actual native solo and Together menu builders dispatch music actions to the correct renderer and character.');
})().catch(error => { console.error(error); process.exitCode = 1; });
