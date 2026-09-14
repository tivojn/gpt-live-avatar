'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const { historyItems } = require('../electron/live-config.cjs');
const read = f => fs.readFileSync(path.join(__dirname, '../web', f), 'utf8').replace(/export /g, '');
const context = vm.createContext({ console, EventTarget, Event, CustomEvent, performance, setTimeout, clearTimeout });
vm.runInContext(read('bubble-policy.js') + '\nglobalThis.Policy = BubblePolicy;', context);
const policy = new context.Policy();
assert.equal(policy.visible(0), false);
policy.incoming(100); assert.equal(policy.visible(500), true); assert.equal(policy.visible(9200), false);
policy.setMode('always'); assert.equal(policy.visible(1e9), true, 'Always stays visible after idle or animation');
policy.setMode('off'); policy.incoming(1e9); policy.editor = true; assert.equal(policy.visible(1e9), false);
policy.setMode('auto'); policy.editor = false; assert.equal(policy.visible(1e9), false, 'Off clears stale incoming messages');
policy.incoming(1e9); assert.equal(policy.visible(1e9), true);
vm.runInContext(read('avatar3d-companion.js') + '\nglobalThis.reply = replyAvatarAction; globalThis.Companion = CompanionController;', context);
const clips = new Map([['joyful-sway', { id: 'joyful-sway', label: 'Joyful Sway', category: 'Dance' }], ['hip-hop-dance', { id: 'hip-hop-dance', label: 'Hip Hop Dance' }]]);
for (const reply of ["I'll do a little dance.", "Sure, I’ll do a quick dance for you!", "Let me do a short dance.", "I'll dance."]) {
  assert.equal(context.reply('could you do a dance please?', reply, undefined, clips), 'action:dance', reply);
}
assert.equal(context.reply('dance', "I'll show you a hip hop dance.", undefined, clips), 'clip:hip-hop-dance');
for (const reply of ["I can't dance.", 'Would you like a dance?', "If you like, I'll dance.", "I'll explain how to dance.", 'She said, “I will dance.”']) assert.equal(context.reply('dance', reply, undefined, clips), null, reply);
for(const [reply,action] of [["I'll smile widely.",'smile'],["I'll give you a big smile.",'smile'],["I'll laugh.",'laugh']])assert.equal(context.reply('show me your teeth',reply,undefined,clips),'action:'+action);
const companion = new context.Companion();
companion.consider('dance please', "I'll do a little dance.", undefined, 100, { clips, turnID: 'one' });
assert.equal(companion.takeReaction(101, clips), 'action:dance');
companion.consider('dance please', "I'll do a little dance. Here goes!", undefined, 102, { clips, turnID: 'one' });
assert.equal(companion.takeReaction(103, clips), null, 'One dance per reply, including continued transcript fragments');
const history = historyItems([{ role: 'system', text: 'bad' }, { role: 'user', text: 'Hello' }, { role: 'assistant', text: 'Hi' }]);
assert.deepEqual(history.map(x => x.role), ['user', 'assistant']);
assert.equal(history[1].content[0].type, 'output_text');
assert(Buffer.byteLength(JSON.stringify(historyItems(Array.from({ length: 200 }, () => ({ role: 'user', text: '你'.repeat(4000) }))))) < 8192);

class FakeChannel extends EventTarget {
  constructor() { super(); this.readyState = 'open'; this.sent = []; }
  send(data) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 'closed'; this.dispatchEvent(new Event('close')); }
}
class FakePeer extends EventTarget {
  constructor() { super(); this.connectionState = 'new'; this.iceGatheringState = 'complete'; this.tracks = []; }
  addTrack(track) { this.tracks.push(track); }
  addTransceiver(kind, options) { this.transceiver = { kind, ...options }; }
  createDataChannel() { return this.channel = new FakeChannel(); }
  async createOffer() { return { type: 'offer', sdp: 'offer' }; }
  async setLocalDescription(offer) { this.localDescription = offer; }
  async setRemoteDescription(answer) { this.answer = answer; }
  close() { this.connectionState = 'closed'; this.dispatchEvent(new Event('connectionstatechange')); }
}
let gets = 0;
const track = () => ({ enabled: true, stopped: false, stop() { this.stopped = true; } });
const stream = t => ({ getAudioTracks: () => [t], getTracks: () => [t] });
context.RTCPeerConnection = FakePeer;
context.AudioContext = class {
  async resume() {} async close() {}
  createMediaStreamDestination() { return { stream: stream(track()) }; }
  createConstantSource() { return { offset: { value: 1 }, connect() {}, start() {}, stop() {} }; }
};
context.navigator = { mediaDevices: { getUserMedia: async () => { gets++; return stream(track()); } } };
vm.runInContext(read('live-client.js') + '\nglobalThis.Client = LiveClient;', context);
(async () => {
  const calls = [];
  const client = new context.Client({ createSession: async (sdp, options) => { calls.push(options); return { ok: true, id: 'test', sdp: 'answer', voice: options.voice }; } });
  await client.start({ voice: 'marin', muted: true });
  client._onEvent(JSON.stringify({ type: 'session.started' }));
  assert.equal(client.state, 'connected'); assert.equal(client.microphone.getTracks()[0].enabled, false);
  client.remember('user', 'What is our plan?'); client.remember('assistant', 'Dance and chat.');
  const oldPeer = client.peer, oldTrack = client.microphone.getTracks()[0];
  await client.restart('ripple'); client._onEvent(JSON.stringify({ type: 'session.started' }));
  assert.equal(client.voice, 'ripple'); assert.equal(client.muted, true); assert(oldTrack.stopped);
  assert.equal(calls[1].history.length, 2); assert.equal(client.history[1].text, 'Dance and chat.');
  oldPeer.dispatchEvent(new Event('connectionstatechange')); assert.equal(client.state, 'connected', 'Old peer cannot stop replacement');
  client.suspendInput(true); client.setMuted(false); assert.equal(client.microphone.getTracks()[0].enabled, false);
  client.suspendInput(false); assert.equal(client.microphone.getTracks()[0].enabled, true);
  client.stop(); assert.equal(client.state, 'idle');
  const before = gets;
  await client.start({ receiveOnly: true, voice: 'quartz' });
  assert.equal(gets, before, 'Voice preview never opens microphone');
  assert.equal(client.peer.tracks.length, 1, 'Preview supplies silent frames without microphone capture'); client.stop();
  let release;
  const late = track(); context.navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { release = resolve; });
  const starting = client.start(); client.stop(); release(stream(late)); await starting;
  assert(late.stopped, 'Microphone granted after cancellation is released'); assert.equal(client.state, 'idle');
  console.log('Bubble, dance, history, reconnect, mute, preview and cancellation regressions passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
