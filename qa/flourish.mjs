// The wardrobe flourish, without a GPU: what it may show, that it never
// chooses anything, and that every way out puts her own look back.
import assert from 'node:assert/strict';
import { WardrobeFlourish, planLooks, flourishDelays } from '../web/avatar3d-flourish.js';

const seeded = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

// ---- timing: quick at first, easing out
const delays = flourishDelays(14);
assert.equal(delays.length, 14); assert.equal(delays[0], 90); assert.equal(delays.at(-1), 240);
assert(delays.every((d, i) => i === 0 || d >= delays[i - 1]), 'never speeds up again');
assert(delays.reduce((a, b) => a + b) < 2400, 'about two seconds in all');
assert.deepEqual(flourishDelays(1), [240]);

// ---- the plan
for (let seed = 1; seed < 60; seed++) {
  const looks = planLooks({ outfits: ['a', 'b', 'c'], accessories: ['x', 'none'], hair: ['h1'], current: { outfit: 'b' }, steps: 14, random: seeded(seed) });
  assert.equal(looks.length, 14);
  assert(looks.every((look, i) => i === 0 || look.outfit !== looks[i - 1].outfit), 'an outfit never repeats back to back');
  assert.notEqual(looks.at(-1).outfit, 'b', 'landing on her own outfit is always a change');
  assert(looks.some(look => look.hair === 'h1') && looks.some(look => look.hair === undefined), 'her own hair is one of the styles');
}
assert(planLooks({ outfits: ['only'], current: { outfit: 'only', accessory: 'ring' }, steps: 3 }).every(look => look.outfit === 'only' && look.accessory === 'ring'));
assert.equal(planLooks({ current: { outfit: 'kept' }, steps: 2 })[0].outfit, 'kept', 'a character with no outfit list keeps what she wears');

// ---- a stand-in character
function character({ outfits = ['dress', 'tactical', 'armor'], textures = true } = {}) {
  const material = name => ({ name, map: { uuid: 'base-' + name, channel: 0, offset: { copy() {} }, repeat: { copy() {} }, center: { copy() {} }, rotation: 0 } });
  const node = (name, mat) => ({ name, userData: {}, visible: true, parent: null, material: mat, children: [], traverse(fn) { fn(this); } });
  const mats = { skin: material('Skin'), dress: material('Dress'), tactical: material('Tactical'), armor: material('Armor'), bag: material('Bag') };
  const nodes = { body: node('Body', mats.skin), dress: node('DressMesh', mats.dress), tactical: node('TacticalMesh', mats.tactical), armor: node('ArmorMesh', mats.armor), bag: node('BagMesh', mats.bag), earrings: node('Earrings', null) };
  nodes.bag.visible = false;
  const calls = { visibility: [], select: 0, paint: [], hold: [], disposed: 0, init: 0 };
  const options = {
    selection: { outfit: 'dress', accessory: 'earrings', body: 'stand' },
    outfits: outfits.map(id => ({ id, nodes: [id === 'dress' ? 'DressMesh' : id === 'tactical' ? 'TacticalMesh' : 'ArmorMesh'], ...(id === 'armor' ? { retired: true } : {}) })),
    accessories: [{ id: 'earrings', nodes: ['Earrings'] }, { id: 'none', nodes: [] }],
    nodes: new Map(Object.values(nodes).map(n => [n.name, [n]])),
    select() { calls.select++; },
    applyVisibility(selection) {
      calls.visibility.push({ ...selection });
      for (const o of this.outfits) for (const name of o.nodes) this.nodes.get(name)[0].visible = o.id === selection.outfit && !o.retired;
      nodes.earrings.visible = selection.accessory === 'earrings';
    },
  };
  const item = (id, slot, mat) => ({ id, kind: 'texture', slot, material: mat, file: id + '.webp', pack: {} });
  const appearance = {
    items: textures ? [item('skin-1', 'skin', 'Skin'), item('skin-2', 'skin', 'Skin'), item('dress-1', 'dress', 'Dress'), item('dress-2', 'dress', 'Dress'), item('tac-1', 'tactical', 'Tactical'), item('armor-1', 'armor', 'Armor'), item('bag-1', 'bag', 'Bag')] : [],
    baseMaps: new Map(), bytes: async (_pack, file) => new TextEncoder().encode(file),
    paintTextures(_resources, options = {}) { calls.paint.push(options); for (const [m, map] of this.baseMaps) m.map = map; },
  };
  const avatar = { disposed: false, options, appearance, motion: { active: null }, renderer: { initTexture() { calls.init++; } },
    resources: { ready: true, hold(n = [], t = []) { calls.hold.push({ nodes: n.map(x => x.name), textures: t.map(x => x.uuid) }); } },
    model: { traverse(fn) { for (const n of Object.values(nodes)) fn(n); } } };
  options.applyVisibility(options.selection); calls.visibility.length = 0;
  const makeTexture = async bytes => ({ texture: { id: new TextDecoder().decode(bytes), offset: { copy() {} }, repeat: { copy() {} }, center: { copy() {} }, updateMatrix() {}, dispose() { calls.disposed++; } }, bitmap: { close() {} } });
  return { avatar, options, appearance, mats, nodes, calls, makeTexture };
}
// Drives update() the way the window does: one call per painted frame, shown() after a frame that was drawn.
function run(flourish, { from = 0, until = () => false, frame = 33 } = {}) {
  const frames = []; let now = from;
  for (let i = 0; i < 400 && flourish.state !== 'done'; i++, now += frame) {
    const alive = flourish.update(now); if (!alive) break;
    frames.push({ now, concealed: flourish.concealed, step: flourish.index }); if (!flourish.concealed) flourish.shown();
    if (until(flourish)) break;
  }
  return { frames, now };
}

// ---- an entrance, start to finish
{
  const c = character(), before = JSON.stringify(c.options.selection), original = new Map(Object.values(c.mats).map(m => [m, m.map]));
  const flourish = new WardrobeFlourish(c.avatar, { conceal: true, random: seeded(7), makeTexture: c.makeTexture });
  assert.equal(flourish.concealed, true, 'an entrance is out of sight from the first frame');
  assert.equal(flourish.update(0), true, 'and keeps the window painting while it gets ready');
  assert.equal(await flourish.prepare(), true);
  assert.equal(flourish.state, 'ready'); assert.equal(c.appearance.paintHeld, true);
  assert(flourish.looks.every(look => look.outfit !== 'armor'), 'a retired outfit is never shown');
  const used = new Set(flourish.looks.flatMap(look => look.textures.map(entry => entry.item.id)));
  assert(!used.has('bag-1') && !used.has('armor-1'), 'colours of things nobody sees are not loaded');
  assert(used.has('skin-1') || used.has('skin-2'), 'skin tones are part of it');
  for (const look of flourish.looks) for (const entry of look.textures) assert(entry.item.slot === 'skin' || entry.item.slot === look.outfit, `${entry.item.slot} colour with the ${look.outfit}`);
  assert.deepEqual(c.calls.hold[0].nodes.sort(), ['DressMesh', 'Earrings', 'TacticalMesh'], 'every live outfit is held resident, the retired one is not');
  assert(c.calls.hold[0].textures.includes('base-Skin'), 'so are the authored maps it paints over');
  assert.deepEqual(c.calls.visibility.at(-1), c.options.selection, 'planning leaves her as she was');

  const { frames } = run(flourish), shownAt = frames.findIndex(f => !f.concealed), first = frames.findIndex(f => f.step >= 0);
  assert(shownAt > 2, 'uploads and one render of each outfit happen out of sight'); assert.equal(c.calls.init, used.size);
  assert(frames.slice(0, shownAt).every(f => f.step === -1), 'no step is spent while she cannot be seen');
  assert(frames[first].now - frames[shownAt].now >= 250, 'she is seen as herself for a moment first');
  const steps = frames.filter((f, i) => f.step >= 0 && f.step !== frames[i - 1].step);
  assert.equal(steps.length, 14, 'every look gets a painted frame'); assert(steps.at(-1).now - steps[0].now < 2400);
  assert.equal(flourish.state, 'done'); assert.equal(flourish.concealed, false);
  assert.equal(c.appearance.paintHeld, false); assert(c.calls.paint.length >= 1, 'her own colours are painted back');
  for (const [m, map] of original) assert.equal(m.map, map, m.name + ' has its own map again');
  assert.deepEqual(c.calls.visibility.at(-1), JSON.parse(before)); assert.deepEqual(c.calls.hold.at(-1), { nodes: [], textures: [] }, 'the borrowed memory is returned');
  assert.equal(c.calls.disposed, used.size, 'and every flourish texture is freed');
  assert.equal(c.calls.select, 0); assert.equal(JSON.stringify(c.options.selection), before, 'nothing was ever selected, so nothing can be saved');
  assert.equal(flourish.update(1e6), false);
}
// ---- not yet drawn: it waits instead of playing to nobody
{
  const c = character(), flourish = new WardrobeFlourish(c.avatar, { random: seeded(3), makeTexture: c.makeTexture });
  assert.equal(flourish.concealed, false, 'a replay on a character already on screen hides nothing until the warm-up');
  await flourish.prepare(); c.avatar.resources.ready = false;
  for (let now = 0; now < 3000; now += 33) flourish.update(now);
  assert.equal(flourish.state, 'ready'); assert.equal(flourish.index, -1, 'held until her outfits are in memory');
  c.avatar.resources.ready = true;
  for (let now = 3000; now < 6000; now += 33) flourish.update(now); // never told a frame was shown
  assert.equal(flourish.index, -1, 'and until a frame of her has really been drawn');
  flourish.cancel(); assert.equal(flourish.state, 'done');
}
// ---- the ways out
for (const [why, interrupt] of [['she starts a motion', c => { c.avatar.motion.active = { id: 'wave' }; }], ['her outfit is changed from the menu', c => { c.options.selection = { ...c.options.selection, outfit: 'tactical' }; }],
  ['a prop is put in her hand', c => { c.options.selection = { ...c.options.selection, prop: 'sword' }; }]]) {
  const c = character(), flourish = new WardrobeFlourish(c.avatar, { random: seeded(11), makeTexture: c.makeTexture });
  await flourish.prepare(); const { now } = run(flourish, { until: f => f.index >= 3 });
  interrupt(c); assert.equal(flourish.update(now + 33), false, why);
  assert.equal(flourish.state, 'done'); assert.equal(c.appearance.paintHeld, false);
  assert.deepEqual(c.calls.visibility.at(-1), c.options.selection, why + ': she wears what is selected now, not what she wore before');
  assert.deepEqual(c.calls.hold.at(-1), { nodes: [], textures: [] });
}
{ // a colour chosen while it played is painted when it ends, not lost and not flashed over
  const c = character(), flourish = new WardrobeFlourish(c.avatar, { random: seeded(5), makeTexture: c.makeTexture });
  await flourish.prepare(); run(flourish, { until: f => f.index >= 2 });
  c.appearance.paintWaiting = true; const painted = c.calls.paint.length; flourish.cancel();
  assert(c.calls.paint.length > painted);
}
{ // stopped while still loading: nothing is left held, nothing is painted
  const c = character(), waiting = [], release = () => waiting.splice(0).forEach(go => go()); const slow = bytes => new Promise(resolve => waiting.push(() => resolve(c.makeTexture(bytes))));
  const flourish = new WardrobeFlourish(c.avatar, { conceal: true, random: seeded(2), makeTexture: slow }), preparing = flourish.prepare();
  await new Promise(resolve => setTimeout(resolve, 5)); flourish.dispose(); release();
  assert.equal(await preparing, false); assert.equal(flourish.concealed, false); assert.equal(c.appearance.paintHeld, false);
  assert.deepEqual(c.calls.hold.at(-1), { nodes: [], textures: [] });
}
{ // the character went away underneath it
  const c = character(), flourish = new WardrobeFlourish(c.avatar, { random: seeded(9), makeTexture: c.makeTexture });
  await flourish.prepare(); run(flourish, { until: f => f.index >= 1 }); c.avatar.disposed = true; const calls = c.calls.visibility.length;
  assert.equal(flourish.update(99999), false); assert.equal(c.calls.visibility.length, calls, 'a disposed character is not touched');
}
// ---- nothing to show
{
  const c = character({ outfits: ['dress'], textures: false }), flourish = new WardrobeFlourish(c.avatar, { conceal: true, makeTexture: c.makeTexture });
  assert.equal(await flourish.prepare(), false); assert.equal(flourish.concealed, false, 'she is not kept out of sight for nothing');
  assert.equal(c.calls.hold.length, 0); assert.equal(flourish.update(0), false);
}
console.log('Wardrobe flourish: eased timing, no repeats or retired outfits, only visible colour slots, concealed warm-up, waits to be seen, restores her look on every way out, never selects.');
