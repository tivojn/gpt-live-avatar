'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = process.env.GLA_SOURCE_ROOT || path.resolve(__dirname, '..');
const soloSource = fs.readFileSync(path.join(root, 'web/avatar.html'), 'utf8');
const groupSource = fs.readFileSync(path.join(root, 'web/group.js'), 'utf8');
function element() {
  const classes = new Set();
  return { hidden: false, textContent: '', style: {}, offsetWidth: 270, offsetHeight: 80,
    classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); }, contains: name => classes.has(name) },
    setAttribute() {}, contains(node) { return node?.parent === this; } };
}
function fixture() {
  const bubble = element(), outside = {}, input = { parent: bubble };
  const document = { activeElement: outside };
  const controls = new Map(); let blurs = 0, onBlur = () => {};
  input.blur = () => { blurs++; document.activeElement = outside; onBlur(); };
  return { bubble, outside, input, document, controls, get blurs() { return blurs; }, onBlur(fn) { onBlur = fn; },
    $: id => { if (!controls.has(id)) controls.set(id, element()); return controls.get(id); } };
}
const f = fixture(); let music = null, stopCalls = 0;
const solo = { ...f, document: f.document, window: { gla_sing_stop: () => { stopCalls++; return true; } },
  currentTask: () => null, displayText: text => text, paintStatus() {}, bubbleMode: () => 'auto',
  bubblePolicy: { setMode() {}, visible: () => true, meaningful: () => true }, live: { state: 'connected' }, singing: () => music,
  avatar: { motion: { active: null } }, performance: { now: () => 100 }, currentCharacter: () => 'Sarah', agentUI: { isBusy: () => false } };
vm.createContext(solo);
const sync = soloSource.slice(soloSource.indexOf('const syncBubble = () => {'), soloSource.indexOf('const openComposer ='));
const stop = soloSource.slice(soloSource.indexOf('const stopPerforming = () => {'), soloSource.indexOf('const showBubble ='));
vm.runInContext('let wasPerforming=false, composerOpen=false, questionOpen=false, composerResult=null;\n' + sync + '\n' + stop + '\nglobalThis.refresh=syncBubble;globalThis.stopNow=stopPerforming;', solo);
const state = expression => vm.runInContext(expression, solo);
f.onBlur(() => solo.refresh()); // focus loss really can re-enter the host update
state('composerOpen=true'); f.document.activeElement = f.input; solo.refresh();
assert.equal(f.bubble.classList.contains('hidden'), false);
assert.equal(f.$('#steerRow').hidden,false,'Visible live bubble has input');
solo.live.state='idle';solo.refresh();assert.equal(f.$('#steerRow').hidden,false,'Input remains after conversation ends');
music = {}; solo.refresh();
assert.equal(state('composerOpen'), false); assert.equal(f.blurs, 1, 'First performance closes the old editor without recursive blur');
assert.equal(f.bubble.classList.contains('hidden'), true, 'Automatic status stays out of the performance');
state('composerOpen=true'); f.document.activeElement = f.outside; solo.refresh();
assert.equal(f.bubble.classList.contains('hidden'), false, 'Explicit input is visible before focus enters it');
f.document.activeElement = f.input; solo.refresh();
assert.equal(f.blurs, 1, 'Repeated music frames do not close a newly opened composer');
state('composerOpen=false;questionOpen=true'); f.document.activeElement = f.outside; solo.refresh();
assert.equal(f.bubble.classList.contains('hidden'), false, 'Incoming question is visible without prior focus');
music = null; solo.refresh(); f.document.activeElement = f.input; music = {}; solo.refresh();
assert.equal(f.blurs, 1, 'Starting music never blurs an open question');
state('questionOpen=false'); music = null;
assert.equal(solo.stopNow(), true); assert.equal(stopCalls, 1, 'Stop reaches pending sing startup even before a session exists');

const g = fixture(); let groupMusic = null;
const actor = { slug: 'sarah', info: { name: 'Sarah' }, avatar: { motion: { active: null } }, bubble: g.bubble,
  bubbleText: element(), composerOpen: true, questionOpen: false, message: 'Dancing along', x: 0, y: 100, h: 700, w: 480 };
const group = { document: g.document, window: { gla_sing_sample: () => groupMusic }, performance: { now: () => 100 },
  shortenHomePaths: value => value, catalogue: {}, updateComposer() {}, speaker: '', running: false, innerWidth: 1600 };
vm.createContext(group);
const refresh = groupSource.slice(groupSource.indexOf('function refreshBubble(actor){'), groupSource.indexOf("function stop(message="));
vm.runInContext(refresh + '\nglobalThis.refresh=refreshBubble;', group);
g.onBlur(() => group.refresh(actor)); g.document.activeElement = g.input;
group.refresh(actor); assert.equal(g.bubble.hidden, false);
groupMusic = { speaking: false }; group.refresh(actor);
assert.equal(actor.composerOpen, false); assert.equal(g.blurs, 1); assert.equal(g.bubble.hidden, true);
actor.composerOpen = true; g.document.activeElement = g.outside; group.refresh(actor);
assert.equal(g.bubble.hidden, false, 'Group composer avoids hidden-before-focus deadlock');
g.document.activeElement = g.input; group.refresh(actor); assert.equal(g.blurs, 1);
actor.composerOpen = false; actor.questionOpen = true; g.document.activeElement = g.outside; group.refresh(actor);
assert.equal(g.bubble.hidden, false, 'Group questions remain visible during a song');
groupMusic = null; group.refresh(actor); groupMusic = {}; g.document.activeElement = g.input; group.refresh(actor);
assert.equal(g.blurs, 1, 'Group performance start preserves the question field');
console.log('Music bubbles: transition blur, recursive refresh, explicit input before focus, question access and pending cancellation passed.');
