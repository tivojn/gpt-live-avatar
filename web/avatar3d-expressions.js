// A shared vocabulary of facial expressions and how each face rig shows them.
// The five characters speak four shape dialects (Auto-Rig "Brow.sad.up",
// Iselda "Brows Worried", Ming-Mei "Mouth smile big-", ARKit/VRM names, Tia's authored
// portrait morphs). Every slot lists alternatives best first; the first one a
// rig fully has is used, and a rig with none simply skips that slot. Weights
// were set by looking at rendered faces, not by formula (docs/INSTINCT.md).
const both = (left, right, value) => ({ [left]: value, [right]: value });
const smileARKit = value => ({ ...both('mouthSmileLeft', 'mouthSmileRight', value), ...both('cheekSquintLeft', 'cheekSquintRight', value * .5) });
const SLOT = {
  smileClosed: v => [{ 'Mth.Sml.Cls.1': v }, { 'Smile closed': v }, { 'Mouth smile closed': v }, { portraitSmile: v }, { smile: v }, smileARKit(v)],
  smileWide: v => [{ 'Mth.Sml.Cls.2': v }, { 'Smile Wide Closed': v }, { 'Mouth smile big-': v }, { portraitSmile: v }, { smile: v }, smileARKit(v)],
  grin: v => [{ 'Mth.Sml.Grn-1': v }, { 'Smile Parted': v }, { 'Mouth smile teeth-': v }, { portraitGrin: v }, { smile: v, jawOpen: v * .12 }, { ...smileARKit(v), jawOpen: v * .12 }],
  laugh: v => [{ 'Mth.Sml.Op3': v }, { 'Smile Wide Open': v }, { 'Mouth smile teeth-': v, 'Mouth open-': v * .5 }, { portraitLaugh: v }, { smile: v, jawOpen: v * .3 }, { ...smileARKit(v), jawOpen: v * .3 }],
  frown: v => [{ 'Mouth Sad': v }, { 'Mouth sad': v }, { sorrow: v }, both('mouthFrownLeft', 'mouthFrownRight', v)],
  pucker: v => [{ 'Mth.Puc-1': v }, { 'Mouth Pucker 2': v }, { 'Pucker-': v }, { mouthPucker: v }],
  biteLip: v => [{ 'Mth.BitLi-1': v }, { 'Smile Bite-Lip': v }, { 'Mouth smile bite lip-': v }, { mouthRollLower: v, ...smileARKit(v * .4) }],
  tongue: v => [{ 'Mth.Sml.Tng.1': v }, { tongueOut: v, jawOpen: v * .3, ...smileARKit(v * .5) }],
  press: v => [both('mouthPressLeft', 'mouthPressRight', v), { 'Mouth Closed': v }, { 'Mouth closed': v }],
  agape: v => [{ 'Mth.Op-2': v }, { 'Mouth Open': v * .7 }, { 'Mouth open-': v * .7 }, { jawOpen: v * .45 }],
  sneer: v => [both('noseSneerLeft', 'noseSneerRight', v), { Sneer: v }, { 'Sneer-': v }],
  browSad: v => [{ 'Brow.sad.up': v }, { 'Brows Worried': v }, { 'Brows Sad': v }, { 'Brow sad': v }, { browInnerUp: v }],
  browUp: v => [{ 'Brow.surprised': v }, { 'Brows Up': v }, { browInnerUp: v * .6, ...both('browOuterUpLeft', 'browOuterUpRight', v) }],
  browLift: v => [{ 'Brow.up': v }, { 'Brows Up': v * .6 }, both('browOuterUpLeft', 'browOuterUpRight', v * .7)],
  browLow: v => [{ 'Brow.low': v }, { 'Brows Frown': v }, both('browDownLeft', 'browDownRight', v)],
  browKnit: v => [{ 'Brow.frown': v }, { 'Brows Frown': v }, { browInnerUp: v * .3, ...both('browDownLeft', 'browDownRight', v * .7) }],
  browAngry: v => [{ 'Brow.angry': v }, { 'Brows Angry': v }, both('browDownLeft', 'browDownRight', v)],
  browCock: v => [{ browOuterUpLeft: v, browDownRight: v * .5 }],
  eyeHappy: v => [{ 'Eye.happy': v }, both('eyeSquintLeft', 'eyeSquintRight', v * 1.4), both('eyeBlinkLeft', 'eyeBlinkRight', v * .5)],
  eyeWide: v => [{ 'Eye.wide': v }, { 'Eyes Wide': v }, { 'Eyes wide': v }, both('eyeWideLeft', 'eyeWideRight', v)],
  eyeShock: v => [{ 'Eye.shock': v }, { 'Eyes Wide': v }, { 'Eyes wide': v }, both('eyeWideLeft', 'eyeWideRight', v)],
  eyeLow: v => [{ 'Eye.low.lid': v }, { 'Eyes Part-closed': v }, both('eyeBlinkLeft', 'eyeBlinkRight', v * .45), { blink: v * .45 }],
  eyeAngry: v => [{ 'Eye.angry': v }, both('eyeSquintLeft', 'eyeSquintRight', v)],
  eyeNarrow: v => [{ 'Eye.low.lid': v * .8 }, { 'Eyes Part-closed': v * .7 }, both('eyeSquintLeft', 'eyeSquintRight', v), both('eyeBlinkLeft', 'eyeBlinkRight', v * .35)],
  wink: v => [{ eyeBlinkLeft: v, '?independentEyes': 0 }], // Tia's two blink names drive one shared morph
};
const face = (s, m = false) => ({ any: s, mouth: m });
const slot = (name, value) => face(SLOT[name](value), ['smileClosed', 'smileWide', 'grin', 'laugh', 'frown', 'pucker', 'biteLip', 'tongue', 'press', 'agape'].includes(name));

// when: what Jev reads to choose it. family: near-synonyms share Jev's
// probability, so they are counted together. mood: what the renderer's generic
// mood gets (sad also lowers the resting smile).
// Timing follows how a face really moves: a quick onset, a brief apex, then it
// settles to a fainter trace (sustain) and lets go slowly. hold is how long it
// lasts unless renewed; max caps renewals. Weights are deliberately modest: a
// companion's face should read as a reaction, not a performance.
const E = (family, when, timing, mood, parts) => ({ family, when, apex: 900, sustain: .55, hold: 3500, max: Math.round((timing.hold || 3500) * 1.8), rest: Math.round((timing.hold || 3500) * .5), ...timing, mood, parts });
export const EXPRESSIONS = Object.freeze({
  smile: E('joy', 'Pleased, friendly, content; mild good news or a kind remark', { hold: 3500 }, { smile: .55 }, [slot('smileClosed', .6), slot('eyeHappy', .15)]),
  beam: E('joy', 'Delighted, thrilled, celebrating great news or a win', { hold: 4000, apex: 1200 }, { smile: .8 }, [slot('grin', .6), slot('eyeHappy', .28), slot('browLift', .2)]),
  // A laugh is a smile with squeezed eyes and a short chuckle, never a held open mouth.
  laugh: E('joy', 'Laughing at a joke, a punchline or something absurd', { hold: 2600, apex: 1100, sustain: .5, max: 4000 }, { smile: .8 }, [slot('grin', .6), slot('eyeHappy', .35), { ...slot('laugh', .32), shake: [120, 1150, 4.5] }]),
  affection: E('joy', 'Tender, touched, loving, grateful from the heart', { hold: 4000, sustain: .65 }, { smile: .5 }, [slot('smileWide', .45), slot('eyeHappy', .28), slot('browSad', .15)]),
  proud: E('joy', 'Proud, smug, pleased with herself, accepting praise for her skill', { hold: 3200 }, { smile: .45 }, [slot('smileClosed', .45), slot('eyeLow', .28), slot('browLift', .35)]),
  flirty: E('joy', 'Flirting, coy, charmed by a compliment about her looks', { rest: 7000, hold: 3000 }, { smile: .45 }, [slot('smileClosed', .4), { ...slot('biteLip', .5), pulse: [300, 1500] }, slot('eyeLow', .28), slot('browLift', .2)]),
  // A cocked brow is a gesture, not a mood: it flashes and goes, renewals do not stretch it, and it rests before repeating.
  playful: E('play', 'Teasing, cheeky, mischievous, sharing an inside joke', { rest: 7200, hold: 2400, apex: 600, sustain: .2, max: 2400 }, { smile: .55 }, [slot('smileClosed', .6), { ...slot('wink', 1), pulse: [250, 800] }, { ...slot('browCock', .35), pulse: [0, 1400] }]),
  silly: E('play', 'Goofing around, being a clown, childish fun', { rest: 7000, hold: 2400 }, { smile: .5 }, [slot('smileClosed', .5), { ...slot('tongue', .6), pulse: [200, 1200] }, slot('eyeHappy', .25), slot('browLift', .3)]),
  pout: E('play', 'Sulking playfully, mock-hurt, begging, blowing a kiss', { rest: 6000, hold: 2600 }, {}, [slot('pucker', .7), slot('browSad', .4), slot('eyeLow', .12)]),
  concern: E('sorrow', 'Worried or sympathetic about something hard, painful or frightening', { hold: 6000, sustain: .75, max: 14000 }, { sad: .8 }, [slot('browSad', .65), slot('eyeLow', .1), slot('frown', .2)]),
  sad: E('sorrow', 'Sad, grieving, heartbroken, sharing a loss', { hold: 6500, sustain: .8, max: 14000 }, { sad: 1 }, [slot('browSad', .8), slot('eyeLow', .28), slot('frown', .4)]),
  apologetic: E('sorrow', 'Sorry, embarrassed, admitting a mistake, sheepish', { hold: 3200 }, { sad: .4 }, [slot('browSad', .5), slot('press', .4), slot('eyeLow', .2)]),
  // Startle is the fastest expression on a face and the first to leave it.
  surprise: E('startle', 'Surprised by unexpected news, impressed, amazed', { rest: 6000, hold: 2200, apex: 600, sustain: .35, max: 3500 }, { surprise: .4 }, [slot('browUp', .7), slot('eyeWide', .6), slot('agape', .22)]),
  shock: E('startle', 'Shocked, alarmed, horrified, cannot believe it', { rest: 6000, hold: 2600, apex: 700, sustain: .4, max: 4000 }, { surprise: .7 }, [slot('browUp', .85), slot('eyeShock', .7), slot('agape', .38)]),
  curious: E('doubt', 'Curious, intrigued, asking or hearing an interesting question', { rest: 7000, hold: 2600, apex: 700, sustain: .3, max: 3500 }, {}, [{ ...slot('browCock', .5), pulse: [0, 1600] }, slot('browLift', .38), slot('eyeWide', .15), slot('smileClosed', .15)]),
  thinking: E('doubt', 'Thinking it over, unsure, searching for the answer', { hold: 3000, sustain: .7 }, {}, [slot('browKnit', .55), slot('eyeNarrow', .3), slot('press', .35)]),
  skeptical: E('doubt', 'Doubtful, unconvinced, that sounds wrong or exaggerated', { rest: 7000, hold: 2600, apex: 800, sustain: .35, max: 3500 }, {}, [{ ...slot('browCock', .6), pulse: [0, 1800] }, slot('browKnit', .3), slot('eyeNarrow', .45), slot('press', .3)]),
  stern: E('displeasure', 'Serious, firm, disapproving, giving a warning', { hold: 3000, sustain: .7 }, { sad: .3 }, [slot('browLow', .7), slot('eyeNarrow', .35), slot('frown', .2), slot('press', .35)]),
  angry: E('displeasure', 'Angry or indignant, for example on the user\'s behalf about an injustice', { hold: 3000, sustain: .6 }, { anger: .5, sad: .3 }, [slot('browAngry', .65), slot('eyeAngry', .5), slot('press', .3)]),
  disgust: E('displeasure', 'Grossed out, repulsed, eww', { rest: 6000, hold: 2400, apex: 700, sustain: .4 }, { sad: .3 }, [slot('sneer', .7), slot('browKnit', .6), slot('eyeNarrow', .5), slot('frown', .45)]),
  sleepy: E('sleepy', 'Tired, bored, drowsy, it is very late', { hold: 4500, sustain: .85 }, { sad: .2 }, [slot('eyeLow', .55), slot('browSad', .15)]),
});
export const expressionNames = Object.freeze(Object.keys(EXPRESSIONS));

// The shapes one rig uses for one expression: [{channels, mouth, pulse, shake}].
export function resolveExpression(name, has) {
  const recipe = EXPRESSIONS[name]; if (!recipe) return [];
  return recipe.parts.map(part => ({ channels: part.any.find(option => Object.keys(option).every(has)) || null, mouth: part.mouth, pulse: part.pulse, shake: part.shake }))
    .filter(part => part.channels);
}

const DWELL = 1100; // a face does not flicker between feelings faster than this
// One expression leads at a time; the previous one fades while the next rises.
export class FaceDirector {
  constructor({ random = Math.random } = {}) { this.random = random; this.levels = new Map(); this.lastStart = new Map(); this.current = null; this.next = null; this.at = 0; this.raw = null; }
  // intensity: a listener mirrors more softly than a speaker feels.
  show(name, now, has, { intensity = 1 } = {}) {
    const recipe = EXPRESSIONS[name]; if (!recipe) return false;
    const parts = resolveExpression(name, has); if (!parts.length) return false;
    const lead = this.current && now < this.current.until ? this.current : null;
    if (lead?.name === name) { // the same feeling again extends it; it never restarts the apex or a wink
      lead.until = Math.min(lead.start + recipe.max, Math.max(lead.until, now + recipe.hold * .6)); this.next = null; return true;
    }
    if (lead && now - lead.start < DWELL) { this.next = { name, has, intensity }; return true; }
    // The same gesture again and again reads as a tic: one showing, then a rest.
    if (now - (this.lastStart.get(name) ?? -Infinity) < recipe.rest) return true;
    this.lastStart.set(name, now);
    this.next = null;
    this.current = { name, start: now, until: now + recipe.hold };
    // No two smiles are the same size.
    this.levels.set(name, { level: this.levels.get(name)?.level || 0, parts, start: now, gain: intensity * (.88 + .24 * this.random()) });
    return true;
  }
  // Jev is sure nothing is being felt now: let go early instead of holding a stale face.
  relax(now) { this.next = null; if (this.current && now - this.current.start > DWELL) this.current.until = Math.min(this.current.until, now + 500); }
  clear() { this.current = null; this.next = null; this.raw = null; this.lastStart.clear(); }
  showing(now) { return this.current && now < this.current.until ? this.current.name : null; }
  get active() { return Boolean(this.raw) || Boolean(this.next) || this.levels.size > 0; }
  // speaking: visemes own the mouth, so mouth shapes yield to them.
  frame(now, speaking = false) {
    if (this.next && (!this.current || now - this.current.start >= DWELL)) { const { name, has, intensity } = this.next; this.next = null; this.show(name, now, has, { intensity }); }
    const dt = Math.min(100, Math.max(0, now - (this.at || now))); this.at = now;
    const lead = this.showing(now), channels = {}, mood = { smile: 0, sad: 0, surprise: 0, anger: 0 };
    for (const [name, state] of this.levels) {
      const recipe = EXPRESSIONS[name], t = now - state.start, leading = name === lead;
      const target = !leading ? 0 : t < recipe.apex ? 1 : recipe.sustain;
      const tau = !leading ? 420 : target > state.level ? 150 : 750; // quick onset, slow settle, unhurried release
      state.level += (target - state.level) * (1 - Math.exp(-dt / tau));
      if (!leading && state.level < .01) { this.levels.delete(name); continue; }
      for (const part of state.parts) {
        let gain = state.level * state.gain * (part.mouth && speaking ? .3 : 1);
        if (part.pulse) gain *= t < part.pulse[0] || t > part.pulse[1] ? 0 : Math.sin(Math.PI * (t - part.pulse[0]) / (part.pulse[1] - part.pulse[0]));
        if (part.shake) { const [from, to, hertz] = part.shake, u = (t - from) / (to - from); gain *= u < 0 || u > 1 ? 0 : (1 - u) * .5 * (1 - Math.cos(2 * Math.PI * hertz * (t - from) / 1000)); }
        for (const [channel, value] of Object.entries(part.channels)) channels[channel] = Math.min(1, (channels[channel] || 0) + value * gain);
      }
      for (const [key, value] of Object.entries(recipe.mood)) mood[key] = Math.max(mood[key], value * state.level * Math.min(1, state.gain));
    }
    if (this.raw) Object.assign(channels, this.raw); // authoring aid: gla_face({channel: weight})
    return { channels, mood };
  }
}
