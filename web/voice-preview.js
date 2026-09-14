import { LiveClient } from '/live-client.js';

export class VoicePreview {
  constructor({ createSession, live, audio, notify }) {
    this.live = live; this.audio = audio; this.notify = notify;
    this.sample = new Audio(); this.sample.autoplay = true;
    this.client = new LiveClient({ createSession }); this.voice = ''; this.timer = 0;
    this.client.addEventListener('remote-track', ({ detail }) => {
      this.sample.srcObject = detail.stream;
      this.sample.play().catch(() => this.fail('Voice preview could not play. Please try again.'));
    });
    this.client.addEventListener('state', ({ detail }) => {
      if (detail.state === 'idle') { this.cleanup(); return; }
      this.notify({ state: detail.state, voice: this.voice });
      if (detail.state === 'connected') {
        this.client.appendCommentary('Read the short voice sample now, then remain silent.');
        this.timer = setTimeout(() => this.stop(), 12000);
      }
    });
    this.client.addEventListener('transcript', ({ detail }) => {
      if (detail.role === 'assistant' && detail.final) {
        clearTimeout(this.finishTimer);
        this.finishTimer = setTimeout(() => this.stop(), 2200);
      } else if (detail.role === 'assistant') clearTimeout(this.finishTimer);
    });
    this.client.addEventListener('error', ({ detail }) => this.fail(detail.message));
  }
  async start(voice) {
    this.stop();
    this.voice = voice;
    this.error = '';
    this.priorAudioMuted = this.audio.muted;
    this.audio.muted = true;
    this.live.suspendInput(true);
    return this.client.start({ receiveOnly: true, voice });
  }
  fail(message) { this.error = message; this.stop(); }
  stop() {
    if (this.client.state !== 'idle') this.client.stop('preview_end');
    else this.cleanup();
  }
  cleanup() {
    clearTimeout(this.timer); clearTimeout(this.finishTimer);
    this.sample.pause(); this.sample.srcObject = null;
    if (this.voice) {
      this.audio.muted = Boolean(this.priorAudioMuted);
      this.live.suspendInput(false);
      this.notify({ state: 'idle', voice: this.voice, error: this.error || '' });
      this.voice = '';
    }
  }
}
