'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const root = process.env.GLA_SOURCE_ROOT || path.resolve(__dirname, '..');
const { musicMenu } = require(path.join(root, 'electron/music-menu.cjs'));
const events = [];
const send = action => () => events.push(action);
const { flat } = require('./menu-flat.cjs');
const item = (menu, label) => flat(menu).find(x => x.label === label);
const dance = menu => item(menu, 'Dance Along to Current Song');
const stop = menu => item(menu, 'Stop');

const idle = musicMenu({ hasKey: false, agentEnabled: false }, send, 'sarah');
assert.equal(dance(idle).enabled, true, 'Music needs neither a voice API key nor an external agent');
assert.equal(dance(idle).enabled, true);
assert.equal(dance(idle).checked, false);
assert.equal(stop(idle).enabled, false);
dance(idle).click();
assert.deepEqual(events, ['music:dance']);

const session = { source: 'Spotify', targets: [{ id: 'sarah', mode: 'dance' }, { id: 'tia', mode: 'dance' }] };
const sarah = musicMenu({ music: session }, send, 'sarah');
assert.equal(dance(sarah).checked, true);
assert.equal(sarah.some(x => x.label.includes('Sing')), false, 'no sing-along entry any more');
assert.equal(sarah[0].label, 'Dance-along · Spotify');
assert.equal(stop(sarah).enabled, true);
const tia = musicMenu({ music: session }, send, 'tia');
assert.equal(dance(tia).checked, true);
assert.equal(tia[0].label, 'Dance-along · Spotify');
stop(tia).click(); assert.equal(events.at(-1), 'stop-performing');
const other = musicMenu({ music: session }, send, 'iselda');
assert.equal(dance(other).checked, false);
assert.equal(stop(other).enabled, false);
assert.equal(other.some(x => x.label.includes('Spotify')), false);

const pending = musicMenu({ musicPending: true }, send, 'sarah');
assert.equal(pending[0].label, 'Getting music ready…');
assert.equal(dance(pending).enabled, false);
assert.equal(stop(pending).enabled, true, 'An in-flight music start can be cancelled');
const loading = musicMenu({ musicAvailable: false }, send, 'sarah');
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
const avatarMenu = require(path.join(root, 'electron/avatar-menu.cjs'));
const soloContext = { ...avatarMenu, avatarWindow, Menu: { buildFromTemplate: template => ({ popup: () => { built = template; } }) },
  config: { agentEnabled: false }, avatarInfo: () => ({ name: 'Sarah' }), avatarReasoningMenu: () => ({ label: 'Reasoning' }), avatarPermissionsMenu: () => ({ label: 'Permissions' }),
  assets: null, VOICES: [], voicePreview: { state: 'idle' }, avatarShortcuts: null, DEFAULT_SHORTCUTS: {}, appInfo: { menu: () => [] }, app: { name: 'Test' },
  openSettingsWindow() {}, requestAvatarRecovery() {}, requestAvatarCloseup() {}, groupManager: { open() {} } };
vm.runInNewContext(mainSource.slice(mainSource.indexOf('function showAvatarMenu(state) {'), mainSource.indexOf('// A live session may only run while she is on screen.')), soloContext);
soloContext.showAvatarMenu({ character: 'sarah', music: session });
// The menu reads top to bottom as: what you do now, what you choose, the app itself.
const rows = template => Array.from(template).filter(x => x.type !== 'separator' && x.visible !== false).map(x => x.label);
assert.deepEqual(rows(built), ['Start Conversation', 'Ask Sarah…', 'Perform', 'Look', 'Character', 'Agent', 'View', 'Avatar Show · Playwright & Director…', 'Settings…', 'Quit Test']);
assert.deepEqual(rows(item(built, 'Perform').submenu), ['Dance-along · Spotify', 'Dance Along to Current Song', 'Stay Still', 'Stop'], 'every way to move, and the way to stop, in one place');
assert.deepEqual(rows(item(built, 'View').submenu), ['Bubble on Incoming Messages', 'Bubble Always On', 'Bubble Off', 'Avatar Close-up', 'Bring Avatar Back']);
assert.equal(built.find(x => x.label === 'Mute Microphone').visible, false, 'conversation controls appear only while talking');
soloContext.showAvatarMenu({ character: 'sarah', live: 'connected' });
assert.deepEqual(rows(built).slice(0, 4), ['End Conversation', 'Mute Microphone', 'Stop Talking', 'Ask Sarah…']);
assert.equal(item(built, 'Ask Sarah…').enabled, true, 'a live conversation can always be steered by text');
soloContext.showAvatarMenu({ character: 'sarah', music: session });
dance(built).click(); stop(built).click();
assert.deepEqual(soloEvents, [['gla:menu-action', 'music:dance'], ['gla:menu-action', 'stop-performing']]);
assert.equal(stop(built).enabled, true);

const handlers = new Map(), groupEvents = [];
let groupWindow;
class Window {
  constructor() { groupWindow = this; this.webContents = { id: 2, on() {}, send: (...args) => groupEvents.push(args) }; }
  setVisibleOnAllWorkspaces() {} setAlwaysOnTop() {} loadURL() {} once() {} on() {} show() {} focus() {} destroy() {} isDestroyed() { return false; }
}
const groupContext = { module: { exports: {} }, __dirname: path.join(root, 'electron'), setInterval: () => 1, clearInterval() {},
  require: id => id === 'electron' ? { BrowserWindow: Window, ipcMain: { handle: (name, fn) => handlers.set(name, fn), on() {} }, screen: { getPrimaryDisplay: () => ({ workArea: {} }), getDisplayMatching: () => ({ workArea: {} }) }, Menu: { buildFromTemplate: template => ({ popup: ({ callback }) => { built = template; callback(); } }) } }
    : id === './avatar-menu.cjs' ? avatarMenu : id === './group-context.cjs' ? { GroupContext: class {} } : id === './delegate.cjs' ? {} : require(id) };
vm.runInNewContext(fs.readFileSync(path.join(root, 'electron/group.cjs'), 'utf8'), groupContext);
const group = groupContext.module.exports.setupGroup({ origin: 'http://localhost', getAvatar: () => null, getSettings: () => ({ avatars: [{ slug: 'sarah', installed: true }, { slug: 'tia', installed: true }] }), getConfig: () => ({ agentEnabled: false }), info: config => ({ ok: true, name: config.avatar === 'tia' ? 'Tia' : 'Sarah' }), avatarReasoningMenu: () => ({ label: 'Reasoning' }), avatarPermissionsMenu: () => ({ label: 'Permissions' }), shortcuts: () => ({}), backend: { cancel() {} } });
group.open();
(async () => {
  const result = await handlers.get('gla:group:menu')({ sender: groupWindow.webContents }, { slug: 'tia', music: session });
  assert.equal(result.ok, true);
  assert.equal(dance(built).checked, true);
  assert.deepEqual(rows(built).slice(2), ['Perform', 'Look', 'Agent', 'View', 'Settings…'], 'a character in the show window uses the same groups');
  assert.deepEqual(rows(item(built, 'View').submenu).slice(0, 2), ['Follow cursor', 'Face the audience']);
  dance(built).click(); stop(built).click();
  assert.deepEqual(JSON.parse(JSON.stringify(groupEvents)), [
    ['gla:group:menu-action', { slug: 'tia', action: 'music:dance' }],
    ['gla:group:menu-action', { slug: 'tia', action: 'stop-performing' }],
  ]);
  group.dispose();
  console.log('Actual native solo and Together menu builders dispatch music actions to the correct renderer and character.');
})().catch(error => { console.error(error); process.exitCode = 1; });
