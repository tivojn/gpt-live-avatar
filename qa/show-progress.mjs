// The script-writing bar is an estimate (there is no real progress signal from a
// non-streaming request), so what matters is that it is honest: it follows how
// long scripts really took, never goes backwards, and never claims to be done.
import assert from 'node:assert/strict';
import { estimateProgress, usualMs, remember, recall } from '../web/show-progress.js';

assert.equal(usualMs([]), 75000, 'a first script is assumed to take a bit over a minute');
assert.equal(usualMs([101000]), 101000);
assert.equal(usualMs([20000, 101000, 95000]), 95000, 'the median, so one odd run does not move it');
assert.equal(usualMs([1, 2, 3, 4, 5, 60000, 61000, 62000, 63000, 64000]), 62000, 'only the last five count');
assert.equal(usualMs([NaN, 300, 'x']), 75000, 'nonsense and sub-second cancels are ignored');

let last = -1;
for (let t = 0; t <= 600000; t += 500) { const p = estimateProgress(t, 100000); assert(p.fraction >= last, 'never goes backwards'); assert(p.percent <= 99, 'never done before the answer is in'); last = p.fraction; }
assert.equal(estimateProgress(0, 100000).percent, 0);
assert.equal(estimateProgress(50000, 100000).percent, 45);
assert.equal(estimateProgress(100000, 100000).percent, 90, 'ninety at the usual time');
assert.deepEqual([estimateProgress(40000, 100000).leftMs, estimateProgress(40000, 100000).late], [60000, false]);
assert.equal(estimateProgress(100000, 100000).late, false); assert.equal(estimateProgress(130000, 100000).late, true, 'says so when it runs long');
assert(estimateProgress(300000, 100000).percent >= 97 && estimateProgress(300000, 100000).leftMs === 0);

const bag = new Map(), store = { getItem: k => bag.get(k) ?? null, setItem: (k, v) => bag.set(k, v) };
for (const ms of [1000.4, 2000, 3000, 4000, 5000, 6000]) remember(store, 'short', ms);
remember(store, 'long:revise', 90000);
assert.deepEqual(recall(store, 'short'), [2000, 3000, 4000, 5000, 6000]); assert.deepEqual(recall(store, 'long:revise'), [90000]); assert.deepEqual(recall(store, 'medium'), []);
bag.set('gla_show_write_ms', '{broken'); assert.deepEqual(recall(store, 'short'), []); remember(store, 'short', 7000); assert.deepEqual(recall(store, 'short'), [7000]);
const locked = { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } }; assert.deepEqual(recall(locked, 'short'), []); remember(locked, 'short', 1);
console.log('Show progress: median of recent runs per length, even climb to 90% at the usual time, creeps after, never 100% early, survives broken storage.');
