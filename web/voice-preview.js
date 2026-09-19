import { LiveClient } from '/live-client.js';
import { GeminiLiveClient } from '/gemini-live-client.js';

export class VoicePreview {
  // provider(): 'openai' or 'gemini', read when a preview starts: a voice is sampled on the live voice system it belongs to.
  constructor({ createSession, live, audio, notify, provider = () => 'openai' }) {
    this.live = live; this.audio = audio; this.notify = notify; this.provider = provider;
    this.sample = new Audio(); this.sample.autoplay = true;
    this.clients = { openai: new LiveClient({ createSession }), gemini: new GeminiLiveClient({ createSession }) };
    this.client = this.clients.openai; this.voice = ''; this.timer = 0;
    for (const client of Object.values(this.clients)) this.wire(client);
  }
  wire(client) {
    const mine = handler => event => { if (client === this.client) handler(event); }; // only the client in use speaks for the preview
    client.addEventListener('remote-track', mine(({ detail }) => {
      this.sample.srcObject = detail.stream;
      this.sample.play().catch(() => this.fail('Voice preview could not play. Please try again.'));
    }));
    client.addEventListener('state', mine(({ detail }) => {
      if (detail.state === 'idle') { this.cleanup(); return; }
      this.notify({ state: detail.state, voice: this.voice });
      if (detail.state === 'connected') {
        // GPT-Live takes this as commentary; Gemini needs someone to ask, so it goes as a typed request there.
        if (client === this.clients.gemini) client.userText('Please say your short voice sample now.'); else client.appendCommentary('Read the short voice sample now, then remain silent.');
        this.timer = setTimeout(() => this.stop(), 12000);
      }
    }));
    client.addEventListener('transcript', mine(({ detail }) => {
      if (detail.role === 'assistant' && detail.final) {
        clearTimeout(this.finishTimer);
        this.finishTimer = setTimeout(() => this.stop(), 2200);
      } else if (detail.role === 'assistant') clearTimeout(this.finishTimer);
    }));
    client.addEventListener('error', mine(({ detail }) => this.fail(detail.message)));
  }
  async start(voice) {
    this.stop();
    this.client = this.clients[this.provider() === 'gemini' ? 'gemini' : 'openai'];
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
