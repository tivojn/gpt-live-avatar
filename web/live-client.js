// GPT-Live WebRTC client for the avatar window.
// The renderer owns the peer connection, microphone and playback; the main
// process exchanges the SDP offer with OpenAI using the stored API key.
export class LiveClient extends EventTarget {
  constructor({ createSession }) {
    super();
    this.createSession = createSession;
    this.peer = null; this.events = null; this.microphone = null; this.audio = null;
    this.sessionId = ''; this.state = 'idle'; this.muted = false;
    this.remoteStream = null;
    this._nextEventId = 0;
    this._segments = { user: null, assistant: null };
    this.generation = 0; this.suspended = false; this.history = [];
  }

  _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  _setState(state, extra = {}) { this.state = state; this._emit('state', { state, ...extra }); }

  async start({ receiveOnly = false, voice, history = [], resumed = false, muted = false, inputStream = null } = {}) {
    if (this.state !== 'idle') return;
    const generation = ++this.generation;
    const current = () => generation === this.generation;
    this.muted = Boolean(muted); this.receiveOnly = receiveOnly; this.resumed = resumed;
    this.history = history.slice(-48); this.voice = voice;
    this._setState('connecting');
    this.startTimer = setTimeout(() => { if (current()) { this._emit('error', { message: 'Voice connection timed out. Please try again.' }); this.stop('timeout'); } }, 25000);
    try {
      const peer = new RTCPeerConnection();
      this.peer = peer;
      peer.addEventListener('track', event => {
        if (!current()) return;
        this.remoteStream = new MediaStream([event.track]);
        this._emit('remote-track', { stream: this.remoteStream });
      });
      peer.addEventListener('connectionstatechange', () => {
        if (current() && ['failed', 'disconnected', 'closed'].includes(peer.connectionState)) this.stop('connection_lost');
      });
      if (inputStream) {
        // Own clones only: ending one participant must not stop the shared mic.
        this.microphone = new MediaStream(inputStream.getAudioTracks().map(t=>t.clone()));
        for(const track of this.microphone.getAudioTracks())peer.addTrack(track,this.microphone);
      } else if (receiveOnly) {
        // GPT-Live advances on incoming audio frames. A receive-only SDP
        // connects but never speaks; drive its clock with generated silence.
        // This opens no microphone and never requests capture permission.
        const clock = new AudioContext(); this.previewClock = clock;
        await clock.resume();
        if (!current()) { void clock.close(); return; }
        const destination = clock.createMediaStreamDestination();
        const silence = clock.createConstantSource(); silence.offset.value = 0;
        silence.connect(destination); silence.start(); this.previewSilence = silence;
        this.microphone = destination.stream;
        for (const track of destination.stream.getAudioTracks()) peer.addTrack(track, destination.stream);
      } else {
        const microphone = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        if (!current()) { microphone.getTracks().forEach(t => t.stop()); return; }
        this.microphone = microphone;
        for (const track of microphone.getAudioTracks()) { track.enabled = !this.muted && !this.suspended; peer.addTrack(track, microphone); }
      }
      const events = peer.createDataChannel('oai-events');
      this.events = events;
      events.addEventListener('message', ({ data }) => { if (current()) this._onEvent(data); });
      events.addEventListener('close', () => { if (current()) this.stop('channel_closed'); });
      const offer = await peer.createOffer();
      if (!current()) return;
      await peer.setLocalDescription(offer);
      await new Promise(resolve => {
        if (peer.iceGatheringState === 'complete') return resolve();
        const done = () => { if (peer.iceGatheringState === 'complete') { peer.removeEventListener('icegatheringstatechange', done); resolve(); } };
        peer.addEventListener('icegatheringstatechange', done);
        setTimeout(resolve, 2500);
      });
      if (!current()) return;
      const result = await this.createSession(peer.localDescription.sdp, { voice, history: this.history, preview: receiveOnly });
      if (!current()) return;
      if (!result || !result.ok) throw new Error((result && result.error) || 'Session creation failed.');
      this.reasoningMode = result.reasoningMode || 'managed';
      await peer.setRemoteDescription({ type: 'answer', sdp: result.sdp });
      if (!current()) return;
      this.voice = result.voice || voice;
      this.sessionId = result.id || '';
    } catch (error) {
      if (!current()) return;
      this._emit('error', { message: error.message || String(error) });
      this.stop('start_failed');
    }
  }

  _onEvent(data) {
    let event;
    try { event = JSON.parse(data); } catch { return; }
    this._emit('event', event);
    switch (event.type) {
      case 'session.started':
        clearTimeout(this.startTimer);
        this.sessionId = (event.session && event.session.id) || this.sessionId;
        this.voice = event.session?.audio?.output?.voice || this.voice;
        if (this.muted || this.suspended) this.send({ type: 'session.input_audio.mute' });
        this._setState('connected', { sessionId: this.sessionId, resumed: this.resumed });
        break;
      case 'session.input_transcript.delta': this._transcript('user', event); break;
      case 'session.output_transcript.delta': this._transcript('assistant', event); break;
      case 'session.closed':
        this._emit('usage', event.usage || null);
        this.stop(event.reason || 'closed');
        break;
      case 'error':
        this._emit('error', { message: (event.error && (event.error.message || event.error.code)) || 'Live session error.', error: event.error });
        break;
      default: break;
    }
  }

  // Deltas carry start_ms/end_ms on the session clock. A gap longer than
  // ~0.8 s on that clock ends a segment, which is how the model paces turns.
  _transcript(role, event) {
    const now = performance.now();
    let seg = this._segments[role];
    const gap = seg && Number.isFinite(event.start_ms) && Number.isFinite(seg.endMs) ? event.start_ms - seg.endMs : 0;
    if (seg && (gap > 800 || now - seg.updatedAt > 2000)) { this._finish(role); seg = null; }
    if (!seg) {
      seg = this._segments[role] = { id: `${role}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, text: '', startMs: event.start_ms, endMs: event.end_ms, updatedAt: now, timer: 0 };
      this._emit('turn-start', { role, id: seg.id });
    }
    seg.text += event.delta || '';
    seg.endMs = Number.isFinite(event.end_ms) ? Math.max(seg.endMs || 0, event.end_ms) : seg.endMs;
    seg.updatedAt = now;
    clearTimeout(seg.timer);
    seg.timer = setTimeout(() => this._finish(role), 1200);
    this._emit('transcript', { role, id: seg.id, text: seg.text, final: false });
  }
  _finish(role) {
    const seg = this._segments[role];
    if (!seg) return;
    clearTimeout(seg.timer);
    this._segments[role] = null;
    this.remember(role, seg.text.trim());
    this._emit('transcript', { role, id: seg.id, text: seg.text.trim(), final: true });
  }
  remember(role, text) {
    if (text && ['user', 'assistant'].includes(role)) this.history.push({ role, text: String(text).slice(-1800) });
    this.history = this.history.slice(-48);
  }
  conversation() {
    return [...this.history,...Object.entries(this._segments).filter(([,seg])=>seg?.text.trim()).sort((a,b)=>(a[1].startMs||0)-(b[1].startMs||0)).map(([role,seg])=>({role,text:seg.text.trim()}))].slice(-48);
  }
  restart(voice) {
    if (this.state === 'idle') return Promise.resolve();
    const muted = this.muted;
    this.stop('voice_change');
    return this.start({ voice, history: this.history, resumed: true, muted });
  }

  send(event) {
    if (!this.events || this.events.readyState !== 'open') return false;
    const payload = { event_id: `evt_${++this._nextEventId}`, ...event };
    this.events.send(JSON.stringify(payload));
    return true;
  }
  appendInstructions(content) { return this.send({ type: 'session.instructions.append', content, delegation_id: null }); }
  appendCommentary(content, delegation_id = null) { return this.send({ type: 'session.commentary.append', content, delegation_id }); }
  setMuted(muted) {
    this.muted = Boolean(muted);
    this.suspendInput(this.suspended);
    this._emit('muted', { muted: this.muted });
  }
  suspendInput(suspended) {
    this.suspended = Boolean(suspended);
    const disabled = this.muted || this.suspended;
    for (const track of this.microphone?.getAudioTracks() || []) track.enabled = !disabled;
    if (!this.receiveOnly) this.send({ type: disabled ? 'session.input_audio.mute' : 'session.input_audio.unmute' });
  }
  stopSpeaking() { return this.appendInstructions('Stop speaking now and wait quietly for the user.'); }

  stop(reason = 'user') {
    if (this.state === 'idle') return;
    ++this.generation; clearTimeout(this.startTimer);
    for (const role of ['user', 'assistant']) this._finish(role);
    try { if (this.events && this.events.readyState === 'open') this.events.send(JSON.stringify({ type: 'session.close', event_id: `evt_${++this._nextEventId}` })); } catch {}
    if (this.microphone) this.microphone.getTracks().forEach(t => t.stop());
    try { this.previewSilence?.stop(); } catch {}
    if (this.previewClock) void this.previewClock.close().catch(() => {});
    this.previewClock = null; this.previewSilence = null;
    try { this.events && this.events.close(); } catch {}
    try { this.peer && this.peer.close(); } catch {}
    this.peer = null; this.events = null; this.microphone = null; this.remoteStream = null;
    this._setState('idle', { reason });
  }
}
