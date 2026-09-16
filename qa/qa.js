'use strict';
// Static checks: syntax of every script, the renderer contract the avatar page
// relies on, and the settings surface the main process exposes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
for (const f of ['electron/main.cjs', 'electron/preload.cjs', 'electron/group.cjs', 'electron/show.cjs', 'electron/show-script.cjs', 'electron/show-motions.cjs']) new vm.Script(read(f), { filename: f });
const page = read('web/avatar.html');
const script = page.match(/<script type="module">([\s\S]*?)<\/script>\s*<\/body>/)[1];
assert.doesNotThrow(() => new vm.Script(script.replace(/^\s*import .*$/gm, '').replace(/await gla\.getSettings\(\)/, 'null'), { filename: 'avatar.html' }));
// The avatar page and main process agree on the settings keys and IPC names.
const preload = read('electron/preload.cjs'); const main = read('electron/main.cjs') + read('electron/group.cjs') + read('electron/agent.cjs') + read('electron/show.cjs');
for (const channel of preload.match(/'gla:[a-z:-]+'/g)) assert(main.includes(channel), `main handles ${channel}`);
for (const key of ['backendModel', 'voice', 'quality', 'avatarDir', 'personaName', 'persona', 'opacity', 'bubble']) assert(main.includes(`'${key}'`), `settings key ${key}`);
// The renderer contract: absolute module paths must be served from the web root.
for (const f of ['avatar3d.js', 'avatar3d-options.js', 'avatar3d-motion.js', 'avatar3d-companion.js', 'avatar3d-resources.js', 'vendor/three/three.module.js', 'vendor/three/basis_transcoder.wasm']) assert(fs.existsSync(path.join(root, 'web', f)), f);
// Voice list matches OpenAI's documented GPT-Live voices plus the default.
assert.deepEqual(main.match(/const VOICES = \[([^\]]+)\]/)[1].match(/'[a-z]+'/g).map(v => v.slice(1, -1)).sort(), ['beacon', 'bossa', 'cinder', 'delta', 'gleam', 'marin', 'meridian', 'quartz', 'ripple', 'stone', 'tempo', 'vesper', 'willow']);
// Motion replies drive clips: the companion's reply matcher recognises the canonical phrasing.
const companion = read('web/avatar3d-companion.js').replace(/export /g, '');
const ctx = { console }; vm.createContext(ctx); vm.runInContext(companion + '\nglobalThis.r = replyAvatarAction;', ctx);
const clips = new Map([['kung-fu-punch', { id: 'kung-fu-punch', label: 'Kung Fu Punch', aliases: ['kung fu'] }]]);
assert.equal(ctx.r('do a kung fu punch', "Sure, I'll do a kung fu punch.", undefined, clips), 'clip:kung-fu-punch');
assert.equal(ctx.r('can you sit', "Sure, I'll sit down now.", undefined, clips), 'action:sit');
console.log('gpt-live-avatar QA passed.');
