// Gemini Live client for the avatar window: the same events and methods as the
// GPT-Live client (live-client.js), so bubbles, lip-sync, Instinct, delegation
// and the music commands run on either without knowing which is speaking.
//
// Transport differs: a WebSocket instead of WebRTC. The microphone goes out as
// 16 kHz PCM, her voice comes back as 24 kHz PCM, and is played into a
// MediaStream so the window attaches it exactly like a WebRTC track. The main
// process keeps the API key: it returns a single-use token and the complete
// setup message (electron/gemini-live.cjs).
import { LiveClient } from '/live-client.js';

const NOTE = '(Application note, not said by the user. Never read it aloud.) ';
const bytesToBase64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
const base64ToBytes = text => { const s = atob(text), bytes = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i); return bytes; };

// The browser side of the audio. Tests pass their own stand-in with the same four methods.
export class BrowserAudio {
  async openMicrophone({ inputStream = null, onChunk }) {
    // Own clones only: ending one participant must not stop a shared microphone.
    const stream = inputStream ? new MediaStream(inputStream.getAudioTracks().map(t => t.clone()))
      : await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const context = new AudioContext();
    try {
      await context.audioWorklet.addModule('/pcm-capture-worklet.js');
      const source = context.createMediaStreamSource(stream), node = new AudioWorkletNode(context, 'pcm-capture', { numberOfOutputs: 1, processorOptions: { targetRate: 16000, blockSamples: 640 } });
      // A worklet is only pulled while it leads to the destination; the gain keeps it silent.
      const silent = context.createGain(); silent.gain.value = 0;
      source.connect(node); node.connect(silent); silent.connect(context.destination);
      node.port.onmessage = ({ data }) => onChunk(new Uint8Array(data));
      await context.resume();
      return { stream, close() { node.port.onmessage = null; try { source.disconnect(); node.disconnect(); silent.disconnect(); } catch {} stream.getTracks().forEach(t => t.stop()); void context.close().catch(() => {}); } };
    } catch (error) { stream.getTracks().forEach(t => t.stop()); void context.close().catch(() => {}); throw error; }
  }
  async openSpeaker() {
    const context = new AudioContext({ sampleRate: 24000 }), destination = context.createMediaStreamDestination(), playing = new Set();
    let next = 0;
    await context.resume();
    return {
      stream: destination.stream,
      play(bytes) {
        const samples = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1); if (!samples.length) return;
        const buffer = context.createBuffer(1, samples.length, 24000), channel = buffer.getChannelData(0);
        for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 32768;
        const source = context.createBufferSource(); source.buffer = buffer; source.connect(destination);
        // Chunks arrive faster than real time. Queue them end to end; after a gap, start a little ahead so the first one is not clipped.
        next = Math.max(next, context.currentTime + .06); source.start(next); next += buffer.duration;
        playing.add(source); source.onended = () => playing.delete(source);
      },
      flush() { for (const source of playing) { try { source.stop(); } catch {} } playing.clear(); next = 0; },
      get pending() { return Math.max(0, next - context.currentTime); },
      close() { this.flush(); void context.close().catch(() => {}); },
    };
  }
}

export class GeminiLiveClient extends LiveClient {
  constructor({ createSession, WebSocketImpl = globalThis.WebSocket, audio = new BrowserAudio() }) {
    super({ createSession });
    Object.assign(this, { WebSocketImpl, audio, socket: null, speaker: null, capture: null, calls: new Map(), answers: new Map(), handle: '', resumes: 0, working: false, dropAudio: false, startedAt: 0, usage: null });
  }

  async start({ receiveOnly = false, voice, history = [], resumed = false, muted = false, inputStream = null } = {}) {
    if (this.state !== 'idle') return;
    const generation = ++this.generation, current = () => generation === this.generation;
    Object.assign(this, { muted: Boolean(muted), receiveOnly, resumed, history: history.slice(-48), voice, handle: '', resumes: 0, working: false, dropAudio: false, usage: null });
    this._setState('connecting');
    this.startTimer = setTimeout(() => { if (current()) { this._emit('error', { message: 'Voice connection timed out. Please try again.' }); this.stop('timeout'); } }, 25000);
    try {
      this.speaker = await this.audio.openSpeaker();
      if (!current()) return;
      this.remoteStream = this.speaker.stream; this._emit('remote-track', { stream: this.remoteStream });
      if (!receiveOnly) {
        this.capture = await this.audio.openMicrophone({ inputStream, onChunk: bytes => this._audioIn(bytes) });
        if (!current()) { this.capture.close(); this.capture = null; return; }
        this.microphone = this.capture.stream;
        for (const track of this.microphone?.getAudioTracks?.() || []) track.enabled = !this.muted && !this.suspended;
      }
      await this._connect(current, { voice, history: this.history, preview: receiveOnly });
      if (!current()) return;
      clearTimeout(this.startTimer); this.startedAt = performance.now();
      this._setState('connected', { sessionId: this.sessionId, resumed: this.resumed });
    } catch (error) {
      if (!current()) return;
      this._emit('error', { message: error.message || String(error) });
      this.stop('start_failed');
    }
  }

  // Opens one session: a fresh token and setup from the main process, then the socket. Used for the start and for every resume.
  async _connect(current, options) {
    const result = await this.createSession('', { ...options, provider: 'gemini', resumeHandle: this.handle });
    if (!current()) return;
    if (!result || !result.ok) throw new Error((result && result.error) || 'Session creation failed.');
    if (result.provider !== 'gemini' || !Array.isArray(result.urls) || !result.setup) throw new Error('The voice service did not return a Gemini session.');
    Object.assign(this, { reasoningMode: result.reasoningMode || 'delegate', voice: result.voice || this.voice, tool: result.tool || '', thinking: Boolean(result.thinking), sessionId: result.model || '' });
    let last;
    for (const url of result.urls) {
      try { await this._open(url, result.setup, current); return; } catch (error) { last = error; if (!current()) return; }
    }
    throw last || new Error('Could not open the Gemini voice connection.');
  }
  _open(url, setup, current) {
    return new Promise((resolve, reject) => {
      const socket = new this.WebSocketImpl(url); socket.binaryType = 'arraybuffer';
      let ready = false;
      const fail = message => { if (ready) return; try { socket.close(); } catch {} reject(new Error(message)); };
      const timer = setTimeout(() => fail('Gemini did not confirm the session in time.'), 15000);
      socket.onopen = () => socket.send(JSON.stringify(setup));
      socket.onerror = () => fail('Could not open the Gemini voice connection.');
      socket.onclose = event => {
        clearTimeout(timer);
        if (!ready) return fail(event?.reason ? 'Gemini refused the session: ' + String(event.reason).slice(0, 200) : 'Gemini closed the connection before the session started.');
        if (current() && this.socket === socket) this._lost(event);
      };
      socket.onmessage = event => {
        let message; try { message = JSON.parse(typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data)); } catch { return; }
        if (!ready) {
          if (!('setupComplete' in message)) return;
          ready = true; clearTimeout(timer);
          const previous = this.socket; this.socket = socket; this.endpoint = /v1(alpha|beta)/.exec(url)?.[0] || '';
          if (previous && previous !== socket) { previous.onclose = null; try { previous.close(); } catch {} }
          this.inputClosed = false; if (this.muted || this.suspended) this.suspendInput(this.suspended);
          return resolve();
        }
        if (current() && this.socket === socket) this._onMessage(message);
      };
    });
  }

  _send(message) { if (!this.socket || this.socket.readyState !== 1) return false; this.socket.send(JSON.stringify(message)); return true; }
  _audioIn(bytes) { if (this.state === 'connected' && !this.muted && !this.suspended) this._send({ realtimeInput: { audio: { data: bytesToBase64(bytes), mimeType: 'audio/pcm;rate=16000' } } }); }

  _onMessage(message) {
    const content = message.serverContent;
    if (content) {
      if (content.inputTranscription?.text) this._transcript('user', { delta: content.inputTranscription.text });
      // Her reply has begun, so the user's turn is over: close it now rather than after the usual pause, because a hand-off reads it.
      if (content.modelTurn || content.outputTranscription?.text) this._finish('user');
      for (const part of content.modelTurn?.parts || []) {
        if (part.inlineData?.data && /^audio\/pcm/i.test(part.inlineData.mimeType || 'audio/pcm') && !this.dropAudio) this.speaker?.play(base64ToBytes(part.inlineData.data));
      }
      if (content.outputTranscription?.text && !this.dropAudio) this._transcript('assistant', { delta: content.outputTranscription.text });
      // The user spoke over her: what is queued must not be heard.
      if (content.interrupted) { this.speaker?.flush(); this._finish('assistant'); this.dropAudio = false; this._emit('event', { type: 'gemini.interrupted' }); }
      if (content.turnComplete || content.generationComplete) { this.dropAudio = false; if (content.turnComplete) { this._finish('assistant'); this._emit('event', { type: 'gemini.turn_complete' }); } }
    }
    // Extended Thinking keeps working after a turn ends (fillers, background tools): only IDLE means she is done.
    const status = message.interactionStatus ?? message.interaction_status ?? content?.interactionStatus ?? content?.interaction_status;
    if (typeof status === 'string') { const working = status.toUpperCase() === 'IN_PROGRESS'; if (working !== this.working) { this.working = working; this._emit('event', { type: 'gemini.interaction', working }); } }
    for (const call of message.toolCall?.functionCalls || []) this._toolCall(call);
    for (const id of message.toolCallCancellation?.ids || []) { clearTimeout(this.calls.get(id)?.watchdog); if (this.calls.delete(id)) { clearTimeout(this.answers.get(id)?.timer); this.answers.delete(id); this._emit('event', { type: 'session.delegation.cancelled', delegation: { id } }); } }
    if (message.sessionResumptionUpdate) { const update = message.sessionResumptionUpdate; if (update.resumable !== false && typeof update.newHandle === 'string' && update.newHandle) this.handle = update.newHandle; }
    if (message.usageMetadata) this.usage = message.usageMetadata;
    if (message.goAway) void this._resume('go_away');
  }

  // Her one function is the app's delegation: announce it the way GPT-Live-1 does, and answer it when the result is appended.
  _toolCall(call) {
    if (!call || typeof call.id !== 'string') return;
    if (call.name !== this.tool || this.receiveOnly) { this._send({ toolResponse: { functionResponses: [{ id: call.id, name: call.name, response: { error: 'This function is not available.' } }] } }); return; }
    // Every call gets an answer, whatever happens to the work behind it: an unanswered call leaves Extended Thinking
    // "in progress" for the rest of the session, saying she is on it and never taking another request.
    this.calls.set(call.id, { name: call.name, request: String(call.args?.request || '').slice(0, 2000), watchdog: setTimeout(() => this._answer(call.id, { error: 'The assistant did not finish in time. Tell the user briefly, and do not claim anything was done.' }), 11 * 60 * 1000) });
    this._emit('event', { type: 'session.delegation.created', delegation: { id: call.id, target: 'client', request: this.calls.get(call.id).request } });
  }

  _answer(id, response, { silent = false } = {}) {
    const call = this.calls.get(id); if (!call) return false;
    clearTimeout(call.watchdog); clearTimeout(this.answers.get(id)?.timer); this.answers.delete(id); this.calls.delete(id);
    // INTERRUPT lets the standard model speak a result at once, SILENT keeps a cancellation to itself. Extended Thinking
    // schedules its own speech and closes the socket (1007) if the field is present at all.
    return this._send({ toolResponse: { functionResponses: [{ id, name: call.name, response, ...(this.thinking ? {} : { scheduling: silent ? 'SILENT' : 'INTERRUPT' }) }] } });
  }
  // The app gave up on a hand-off (the user moved on, or stopped her): close the call so Gemini is free again.
  cancelDelegation(id) { return this._answer(id, { result: 'Cancelled by the application because the user moved on. Do not mention this; attend to what the user said last.' }, { silent: true }); }
  send() { return false; } // GPT-Live event objects have no meaning here; callers use the methods below
  _note(content) { return this._send({ realtimeInput: { text: NOTE + String(content || '').slice(0, 4000) } }); }
  userText(content) { return this._send({ realtimeInput: { text: String(content || '').slice(0, 4000) } }); } // the user's own words, typed: no application-note prefix
  appendInstructions(content) { return this._note(content + ' Do not reply to this note.'); }
  // A result for a pending hand-off goes back as its function response (chunks of one answer are joined); anything else is a note she may act on.
  appendCommentary(content, delegation_id = null) {
    if (!delegation_id) return this._note(content);
    if (!this.calls.has(delegation_id)) return false; // answered already, or Gemini cancelled the call: a stale result must not be spoken
    if (!this.socket || this.socket.readyState !== 1) return false;
    const answer = this.answers.get(delegation_id) || { text: '', timer: 0 }; this.answers.set(delegation_id, answer);
    answer.text += String(content || ''); clearTimeout(answer.timer);
    answer.timer = setTimeout(() => this._answer(delegation_id, { result: answer.text.slice(0, 12000) }), 40);
    return true;
  }
  suspendInput(suspended) {
    this.suspended = Boolean(suspended);
    const disabled = this.muted || this.suspended;
    for (const track of this.microphone?.getAudioTracks?.() || []) track.enabled = !disabled;
    // Tell Gemini the stream has paused, once, so it does not wait on a silent microphone; audio simply resumes later.
    if (disabled && !this.inputClosed && !this.receiveOnly) this._send({ realtimeInput: { audioStreamEnd: true } });
    this.inputClosed = disabled;
  }
  // Silence is immediate here, whatever the model does next: what is queued is dropped, and so is the rest of this turn.
  stopSpeaking() { this.speaker?.flush(); this.dropAudio = true; this._finish('assistant'); return this._note('Stop speaking now and wait quietly for the user. Do not reply to this note.'); }

  // The connection ended under a live conversation: pick it up again with the resumption handle, quietly, a few times.
  _lost(event) { this._emit('event', { type: 'gemini.closed:' + (event?.code || '') + ':' + String(event?.reason || '').slice(0, 160) }); if (this.state === 'connected' && this.handle && this.resumes < 3) void this._resume('connection_lost'); else this.stop(event?.code === 1000 ? 'closed' : 'connection_lost'); }
  async _resume(reason) {
    if (this.resuming || this.state !== 'connected') return;
    if (!this.handle) { if (reason !== 'go_away') this.stop('connection_lost'); return; }
    this.resuming = true; this.resumes++;
    const generation = this.generation, current = () => generation === this.generation;
    this._emit('event', { type: 'gemini.resuming', reason });
    try { await this._connect(current, { voice: this.voice, history: this.conversation(), preview: this.receiveOnly }); if (current()) this._emit('event', { type: 'gemini.resumed' }); }
    catch (error) { if (current()) { this._emit('error', { message: 'The voice connection was lost: ' + (error.message || error) }); this.stop('connection_lost'); } }
    finally { this.resuming = false; }
  }

  stop(reason = 'user') {
    if (this.state === 'idle') return;
    ++this.generation; clearTimeout(this.startTimer);
    for (const role of ['user', 'assistant']) this._finish(role);
    for (const answer of this.answers.values()) clearTimeout(answer.timer);
    for (const call of this.calls.values()) clearTimeout(call.watchdog);
    this.answers.clear(); this.calls.clear();
    const socket = this.socket; this.socket = null;
    if (socket) { socket.onclose = null; socket.onmessage = null; try { socket.close(1000); } catch {} }
    this.capture?.close(); this.speaker?.close();
    if (this.startedAt) this._emit('usage', { duration_seconds: (performance.now() - this.startedAt) / 1000, tokens: this.usage?.totalTokenCount ?? null });
    Object.assign(this, { capture: null, speaker: null, microphone: null, remoteStream: null, startedAt: 0, working: false, resuming: false });
    this._setState('idle', { reason });
  }
}
