'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const root = process.env.GLA_AUDIO_TAP_ROOT || path.resolve(__dirname, '..');
const children = [], scripts = [];
let players = {}, scriptFailure = false;
function child() {
  const process = new EventEmitter();
  process.stdout = new EventEmitter(); process.stderr = new EventEmitter();
  process.stdin = { end() { process.ended = true; } };
  process.kill = () => { process.killed = true; };
  children.push(process); return process;
}
const sandbox = { module: { exports: {} }, exports: {}, Buffer, setTimeout, clearTimeout,
  process: { platform: 'darwin' }, require(name) {
    if (name === 'node:fs') return { accessSync() {}, constants: { X_OK: 1 } };
    if (name === 'node:child_process') return { spawn: child, execFile(_bin, args, _opts, cb) {
      const script = args[1]; scripts.push(script);
      const app = script.includes('Spotify') ? 'spotify' : 'music';
      const state = players[app];
      if (scriptFailure) return cb(new Error('Automation denied'));
      const out = script.includes('System Events') ? String(Boolean(state)) : script.includes('player state')
        ? state : script.includes('name of current track') ? app + ' song|Artist|12.5' : '';
      cb(null, out);
    } };
    return require(name);
  } };
vm.runInNewContext(fs.readFileSync(path.join(root, 'electron/audio-tap.cjs'), 'utf8'), sandbox);
const { AudioTap, nowPlaying, playerCommand } = sandbox.module.exports;
const header = Buffer.from(JSON.stringify({ sampleRate: 48000, channels: 2, format: 'f32', interleaved: true }) + '\n');
const floats = values => Buffer.from(new Float32Array(values).buffer);
const response = () => Object.assign(new EventEmitter(), { writableLength: 0, writableEnded: false, chunks: [],
  write(bytes) { this.chunks.push(Buffer.from(bytes)); return true; }, end() { this.writableEnded = true; } });
(async () => {
  players = { spotify: 'paused', music: 'playing' };
  assert.equal((await nowPlaying()).player, 'music', 'A paused first player cannot hide a playing second player');
  assert.equal((await nowPlaying('spotify')).playing, false, 'Explicit paused player remains explicit');
  assert.equal(await nowPlaying('unknown'), null);
  assert.equal(await playerCommand('', 'pause'), 'music');
  assert(scripts.at(-1).includes('Music'), 'Automatic pause targets active player');
  assert.equal(await playerCommand('spotify', 'play'), 'spotify');
  players = { music: 'playing' };
  assert.equal(await nowPlaying('spotify'), null);
  assert.equal(await playerCommand('spotify', 'play'), null, 'Explicit absent player never falls through to Music');
  const tap = new AudioTap('/fake/tap');
  const processes = [
    { pid: 100, bundleId: 'com.spotify.client', name: 'Spotify', playing: true },
    { pid: 200, bundleId: 'com.apple.Music', name: 'Music', playing: true },
    { pid: 300, bundleId: 'com.google.Chrome.helper', name: 'Browser', playing: true }];
  tap.list = async () => ({ ok: true, processes });
  players = { spotify: 'paused', music: 'playing' };
  assert.equal((await tap.pickPlayer()).key, 'music');
  assert.equal(await tap.pickPlayer('spotify'), null, 'Core Audio may remain active while Spotify is paused');
  assert.equal(await tap.pickPlayer('unknown'), null, 'Unknown explicit player cannot capture a different app');
  players = {};
  tap.list = async () => ({ ok: true, processes: [processes[2]] });
  assert.equal(await tap.pickPlayer('spotify'), null);
  assert.equal((await tap.pickPlayer()).pid, 300, 'Unspecified browser source still works');
  tap.list = async () => ({ ok: true, processes });
  scriptFailure = true;
  assert.equal((await tap.pickPlayer('spotify')).pid, 100, 'Audio remains usable if metadata automation is unavailable');
  assert.equal(await playerCommand('spotify', 'pause'), null, 'Failed control is not reported as success');
  scriptFailure = false;

  const firstPromise = tap.start({ pid: 100 }).catch(error => error);
  const first = children.at(-1);
  const secondPromise = tap.start({ pid: 200 });
  const second = children.at(-1);
  assert.match((await firstPromise).message, /stopped/);
  first.emit('close'); first.emit('error', new Error('late failure'));
  second.stdout.emit('data', header.subarray(0, 7));
  second.stdout.emit('data', header.subarray(7));
  const format = await secondPromise;
  assert.equal(tap.state().target.pid, 200, 'Late old callbacks cannot tear down the newer session');
  assert.equal(format.sampleRate, 48000);
  const listener = response();
  assert.equal(tap.attach('bad', listener), false);
  assert.equal(tap.attach(format.token, listener), true);
  const data = floats([1, 10, 2, 20, 3, 30]);
  second.stdout.emit('data', data.subarray(0, 3));
  second.stdout.emit('data', data.subarray(3, 11));
  second.stdout.emit('data', data.subarray(11));
  assert.deepEqual(Buffer.concat(listener.chunks), data, 'Odd byte boundaries preserve float and stereo frame alignment');
  listener.chunks = [];
  listener.writableLength = 1e6;
  const skipped = floats([4, 40, 5, 50]);
  second.stdout.emit('data', skipped.subarray(0, 9));
  second.stdout.emit('data', skipped.subarray(9));
  listener.writableLength = 0;
  second.stdout.emit('data', floats([6, 60]));
  assert.deepEqual(Buffer.concat(listener.chunks), floats([6, 60]), 'Backpressure drops full frames only');
  listener.chunks = [];
  const huge = Buffer.alloc(100000, 7);
  second.stdout.emit('data', huge);
  assert.equal(listener.chunks[0].length, 65536, 'Single oversized chunks cannot create an unlimited stale queue');
  assert.equal(listener.chunks[0].length % 8, 0);
  const replacement = response();
  tap.attach(format.token, replacement);
  assert(listener.writableEnded);
  listener.emit('close');
  assert.equal(tap.response, replacement, 'An old HTTP close cannot detach a new response');
  first.stdout.emit('data', floats([9, 90]));
  assert.equal(replacement.chunks.length, 0, 'A superseded helper cannot feed the new stream');
  tap.stop();
  assert(replacement.writableEnded);
  assert.equal(tap.state().running, false);

  const stopped = tap.start({ pid: 100 }).catch(error => error);
  tap.stop(); assert.match((await stopped).message, /stopped/, 'Stop during readiness always settles');
  const invalid = tap.start({ pid: 100 }).catch(error => error);
  children.at(-1).stdout.emit('data', Buffer.from('{"channels":0,"sampleRate":0}\n'));
  assert.match((await invalid).message, /unsupported/); assert.equal(tap.state().running, false);
  const failed = tap.start({ pid: 100 }).catch(error => error);
  children.at(-1).stderr.emit('data', Buffer.from('Permission denied'));
  children.at(-1).emit('close'); assert.match((await failed).message, /Permission denied/);
  console.log('Audio tap: active/explicit players, command failures, overlapping start/stop, framed PCM and bounded backpressure passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
