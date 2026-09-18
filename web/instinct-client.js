// Renderer side of Instinct (electron/instinct.cjs). It paces requests to the
// transcript stream and never blocks it: each method resolves to a decision
// or null, and null always means "use the local rules".
// How much there is to judge. One Chinese, Japanese or Korean character says
// about as much as a short Latin word, so length alone starves those languages.
export const textWeight = text => { let n = 0; for (const ch of String(text || '')) n += /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(ch) ? 3 : 1; return n; };
const clipRows = clips => [...(clips?.values?.() || [])].map(c => ({ id: c.id, label: c.label, category: c.category, aliases: c.aliases }));

export class InstinctClient {
  // faces: [{id, when}] the expression vocabulary Jev may choose from.
  constructor({ decide, active = () => true, faces = () => [], now = () => performance.now() }) {
    Object.assign(this, { decide, active, faces, now });
    this.rows = null; this.rowsFor = null; this.rowsSize = -1;
    this.finalSeq = 0;
    this.speaking = { turn: '', at: -Infinity, length: 0, asked: 0, busy: false, acted: false };
    this.hearing = { turn: '', at: -Infinity, length: 0, busy: false };
  }
  clips(clips) {
    if (this.rowsFor !== clips || this.rowsSize !== clips?.size) { this.rows = clipRows(clips); this.rowsFor = clips; this.rowsSize = clips?.size; }
    return this.rows;
  }
  async ask(request) {
    if (!this.active()) return null;
    try { const r = await this.decide(request); return r && r.ok !== false && r.decision || null; } catch { return null; }
  }
  // A finished assistant turn. A newer final for the same conversation
  // supersedes an older one that is still in flight.
  async assistantFinal(turn, user, reply, { clips, character } = {}) {
    const seq = ++this.finalSeq;
    const decision = await this.ask({ kind: 'reply', user, reply, clips: this.clips(clips), character, faces: this.faces() });
    return seq === this.finalSeq ? { decision } : { superseded: true };
  }
  // While she is still speaking: at most one request in flight, a few per
  // second, and only after enough new words to change the answer.
  async assistantPartial(turn, user, reply, { clips, character } = {}) {
    const s = this.speaking, now = this.now();
    if (s.turn !== turn) Object.assign(s, { turn, at: -Infinity, length: 0, asked: 0, acted: false });
    // A promise to move comes early in a reply; later words are not worth asking about.
    const size = textWeight(reply);
    if (s.acted || s.busy || s.asked >= 4 || size < 16 || size - s.length < 8 || now - s.at < 450) return null;
    Object.assign(s, { busy: true, at: now, length: size, asked: s.asked + 1 });
    const decision = await this.ask({ kind: 'reply', partial: true, user, reply, clips: this.clips(clips), character, faces: this.faces() });
    s.busy = false;
    if (s.turn !== turn || !decision) return null;
    if (decision.suggestion) s.acted = true; // her face may still change; her body acts once
    return decision;
  }
  // While the user is still speaking: what a good listener's face would do.
  async userPartial(turn, partial, { history, character } = {}) {
    const h = this.hearing, now = this.now();
    if (h.turn !== turn) Object.assign(h, { turn, at: -Infinity, length: 0 });
    const size = textWeight(partial);
    if (h.busy || size < 12 || size - h.length < 10 || now - h.at < 900) return null;
    Object.assign(h, { busy: true, at: now, length: size });
    const decision = await this.ask({ kind: 'listen', partial, history, character, faces: this.faces() });
    h.busy = false;
    return h.turn === turn ? decision : null;
  }
}
