'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = process.env.GLA_AUDIO_TAP_ROOT || path.resolve(__dirname, '..');
let TapSource;
const context = { sampleRate: 48000, currentTime: 0, Float32Array,
  AudioWorkletProcessor: class { constructor() { this.events = []; this.port = { postMessage: e => this.events.push(e) }; } },
  registerProcessor: (_name, constructor) => { TapSource = constructor; } };
vm.runInNewContext(fs.readFileSync(path.join(root, 'web/tap-source-worklet.js'), 'utf8'), context);
const create = () => new TapSource({ processorOptions: { channels: 2 } });
function quantum(tap, time) {
  context.currentTime = time;
  const output = [new Float32Array(128), new Float32Array(128)]; tap.process([], [output]); return output;
}
function frames(n, left = 0, right = 0) {
  const buffer = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { buffer[i * 2] = typeof left === 'function' ? left(i) : left; buffer[i * 2 + 1] = typeof right === 'function' ? right(i) : right; }
  return buffer;
}
const tap = create();
const ramp = frames(1920, i => i + 1, i => 10000 + i);
tap.push(ramp.subarray(0, 3)); tap.push(ramp.subarray(3, 901)); tap.push(ramp.subarray(901));
assert.equal(tap.filled, 1920); assert(tap.started, 'Startup needs 40 ms, not the old 90 ms');
const first = quantum(tap, .1);
assert.deepEqual([...first[0]], Array.from({ length: 128 }, (_, i) => i + 1));
assert.deepEqual([...first[1]], Array.from({ length: 128 }, (_, i) => 10000 + i), 'Arbitrary float chunks retain stereo order');
for (let i = 1; i < 15; i++) quantum(tap, .1 + i * 128 / 48000);
quantum(tap, .5);
assert.equal(tap.filled, 0); assert.equal(tap.started, false);
assert(tap.events.at(-1).starved > 0);
tap.push(frames(128, 1, -1));
assert(quantum(tap, .6)[0].every(value => value === 0), 'Underflow re-buffers instead of chattering one frame at a time');
assert.equal(tap.filled, 128);
tap.port.onmessage({ data: { type: 'flush' } });
assert.equal(tap.filled, 0); assert.equal(tap.tail.length, 0); assert.equal(tap.started, false);

const overflow = create();
overflow.push(frames(4000, 1, 2));
overflow.push(frames(10000, i => i, i => -i));
assert.equal(overflow.filled, 1920); assert.equal(overflow.skipped, 12080);
const latest = quantum(overflow, 1);
assert.equal(latest[0][0], 8080); assert.equal(latest[1][0], -8080, 'Overflow retains the newest complete stereo frames');

// A silent source can keep its buffer full forever. It must not appear audible
// just because packets arrive. Exercise the actual output/health path.
function feedOneSecond(signal) {
  const p = create(); p.push(frames(1920, signal, signal));
  for (let i = 0; i < 377; i++) {
    p.push(frames(128, signal, signal)); quantum(p, i * 128 / 48000);
  }
  return p;
}
const silent = feedOneSecond(0);
assert(silent.events.length >= 2);
assert(silent.events.every(e => e.buffered > 0 && e.receivedFrames > 0 && e.rms === 0 && e.peak === 0 && e.audibleSeconds === 0), 'Silent PCM is never reported as audible');
const audible = feedOneSecond(.2);
assert(audible.events.every(e => Math.abs(e.rms - .2) < 1e-6 && Math.abs(e.peak - .2) < 1e-6 && e.audibleSeconds >= .49));
assert(audible.events.every(e => e.starved === 0 && e.skipped === 0), '40 ms cushion sustains continuous audio with no skips');
const jittered = create();
jittered.push(frames(1920, .1, -.1));
let arrival = 0, packet = 0;
for (let i = 0; i < 752; i++) {
  const time = i * 128 / 48000;
  while (time >= arrival) {
    jittered.push(frames(960, .1, -.1));
    arrival += packet++ % 2 ? .03 : .01;
  }
  quantum(jittered, time);
}
assert(jittered.events.every(e => e.starved === 0 && e.skipped === 0), '40 ms cushion absorbs alternating 10/30 ms network delivery without starving');
const contaminated = create(); contaminated.push(frames(1920, NaN, Infinity));
assert(quantum(contaminated, 2).every(ch => ch.every(value => value === 0)), 'Invalid floats cannot poison the energy meter');
console.log('Tap worklet: 40 ms startup, stereo framing, live-edge overflow, silence energy, recovery and continuous audio passed.');
