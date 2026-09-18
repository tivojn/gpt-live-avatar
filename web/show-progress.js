// How far along a wait with no real progress signal probably is. A script is
// written in one non-streaming request (a local agent such as EnConvo thinks
// for a minute or two and then answers all at once), so the honest bar is an
// estimate from how long the last few scripts took: it climbs evenly to 90% at
// the usual time, then creeps, and never claims 100% before the answer is in.
const DEFAULT_MS=75000,KEEP=5;
export const usualMs=history=>{const list=(Array.isArray(history)?history:[]).filter(ms=>Number.isFinite(ms)&&ms>1000).slice(-KEEP).sort((a,b)=>a-b);
  return list.length?list[Math.floor((list.length-1)/2)]:DEFAULT_MS;};
export function estimateProgress(elapsedMs,usual=DEFAULT_MS){
  const e=Math.max(0,elapsedMs),u=Math.max(1000,usual);
  const fraction=e<=u?.9*e/u:.9+.09*(1-Math.exp(-(e-u)/u));
  return {fraction,percent:Math.min(99,Math.floor(fraction*100)),leftMs:Math.max(0,u-e),late:e>u*1.15};
}
// Durations are kept per length and provider: a short play from the API and a long one from a local agent are different waits.
export function remember(store,key,ms){
  let all={};try{all=JSON.parse(store.getItem('gla_show_write_ms')||'{}')||{};}catch{}
  all[key]=[...(Array.isArray(all[key])?all[key]:[]),Math.round(ms)].slice(-KEEP);
  try{store.setItem('gla_show_write_ms',JSON.stringify(all));}catch{}
}
export function recall(store,key){try{const all=JSON.parse(store.getItem('gla_show_write_ms')||'{}')||{};return Array.isArray(all[key])?all[key]:[];}catch{return [];}}
