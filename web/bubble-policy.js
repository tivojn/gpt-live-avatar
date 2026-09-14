// Visibility is independent of animation, status labels and audio levels.
export class BubblePolicy {
  constructor() { this.until = 0; this.mode = 'auto'; this.editor = false; }
  setMode(mode) {
    this.mode = ['always', 'auto', 'off'].includes(mode) ? mode : 'auto';
    if (this.mode === 'off') { this.until = 0; this.editor = false; }
  }
  incoming(now, duration = 9000) { if (this.mode !== 'off') this.until = Math.max(this.until, now + duration); }
  visible(now) { return this.mode === 'always' || (this.mode === 'auto' && (this.editor || now < this.until)); }
}
