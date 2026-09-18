// One live conversation object for the window, whichever voice model is chosen.
// The window wires its listeners once; this forwards to the GPT-Live or the
// Gemini client and re-dispatches their events. The provider is read when a
// conversation starts, so changing it in Settings takes effect on the next one
// (the window restarts a running conversation, as it does for a new voice).
import { LiveClient } from '/live-client.js';
import { GeminiLiveClient } from '/gemini-live-client.js';

const EVENTS = ['state', 'error', 'event', 'remote-track', 'usage', 'transcript', 'turn-start', 'muted'];
export class LiveSession extends EventTarget {
  constructor({ createSession, provider = () => 'openai', clients = null }) {
    super();
    this.provider = provider;
    this.clients = clients || { openai: new LiveClient({ createSession }), gemini: new GeminiLiveClient({ createSession }) };
    this.active = this.clients.openai;
    for (const client of Object.values(this.clients)) for (const type of EVENTS)
      client.addEventListener(type, event => { if (client === this.active) this.dispatchEvent(new CustomEvent(type, { detail: event.detail })); });
  }
  get providerName() { return this.active === this.clients.gemini ? 'gemini' : 'openai'; }
  start(options = {}) {
    if (this.active.state !== 'idle') return Promise.resolve();
    const next = this.clients[this.provider() === 'gemini' ? 'gemini' : 'openai'];
    if (next !== this.active) { next.history = this.active.history; this.active = next; }
    return this.active.start({ history: this.active.history, ...options });
  }
  // A new voice, or a new voice model: either way the conversation reconnects with what was said so far.
  restart(voice) {
    if (this.active.state === 'idle') return Promise.resolve();
    const muted = this.active.muted, history = this.active.history;
    this.active.stop('voice_change');
    return this.start({ voice, history, resumed: true, muted });
  }
}
// Read and write through to the active client: the window reads these, and QA scripts set them to stage a situation.
for (const name of ['state', 'muted', 'suspended', 'microphone', 'remoteStream', 'generation', 'receiveOnly', 'reasoningMode', 'resumed', 'voice', 'sessionId', 'working', 'history', 'events', 'peer', '_nextEventId'])
  Object.defineProperty(LiveSession.prototype, name, { configurable: true, get() { return this.active[name]; }, set(value) { this.active[name] = value; } });
for (const name of ['stop', 'send', 'appendInstructions', 'appendCommentary', 'userText', 'setMuted', 'suspendInput', 'stopSpeaking', 'remember', 'conversation', 'resetInputTranscript', '_onEvent', '_setState', '_emit'])
  LiveSession.prototype[name] = function (...args) { return this.active[name](...args); };
