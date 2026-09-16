'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const root = process.env.GLA_AUDIO_TAP_ROOT || path.resolve(__dirname, '..');
const { AudioTapOwner } = require(path.join(root, 'electron/audio-tap-owner.cjs'));
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
(async () => {
  const picks = [], starts = [];
  const tap = { stops: 0, stop() { this.stops++; }, pickPlayer() { const d = deferred(); picks.push(d); return d.promise; },
    start(target) { starts.push(target); return Promise.resolve({ token: 'tap-' + starts.length, channels: 2, sampleRate: 48000 }); } };
  const manager = new AudioTapOwner(tap);
  const old = manager.start(1, { player: 'spotify' });
  const next = manager.start(2, { player: 'music' });
  picks[1].resolve({ pid: 20, key: 'music', name: 'Music' });
  const opened = await next;
  assert(opened.ok); assert.equal(opened.token, 'tap-1');
  const stops = tap.stops;
  assert.equal(manager.stop(1), false, 'Old window cannot stop the new window while cleaning up');
  assert.equal(manager.stop(2, 'stale-token'), false, 'Old stream within the same window cannot stop a replacement');
  assert.equal(tap.stops, stops);
  picks[0].resolve({ pid: 10, key: 'spotify', name: 'Spotify' });
  assert.equal((await old).ok, false); assert.equal(starts.length, 1, 'Late source discovery cannot create a stale capture');
  assert.equal(manager.stop(2, opened.token), true);
  const pending = manager.start(2, { player: 'spotify' });
  assert.equal(manager.stop(2), true, 'Stop invalidates a pending source selection');
  picks[2].resolve({ pid: 10 });
  assert.equal((await pending).ok, false); assert.equal(starts.length, 1);
  const malformed = await manager.start(2, { pid: 2.5 });
  assert.equal(malformed.ok, false); assert.equal(starts.length, 1);

  // A late format result is stale even if the backend helper resolves rather
  // than rejects when superseded. It cannot replace the current stream token.
  const formats = [];
  tap.start = target => { starts.push(target); const d = deferred(); formats.push(d); return d.promise; };
  const firstFormat = manager.start(1, { pid: 10 });
  const secondFormat = manager.start(2, { pid: 20 });
  formats[1].resolve({ token: 'new-format', sampleRate: 48000, channels: 2 });
  assert((await secondFormat).ok);
  formats[0].resolve({ token: 'old-format', sampleRate: 48000, channels: 2 });
  assert.equal((await firstFormat).ok, false); assert.equal(manager.token, 'new-format');
  assert.equal(manager.stop(2, 'old-format'), false); assert.equal(manager.stop(2, 'new-format'), true);
  console.log('Audio ownership: source/format races, cross-window teardown, stale tokens and pending cancellation passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
