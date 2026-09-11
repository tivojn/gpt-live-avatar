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
  }

  _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  _setState(state, extra = {}) { this.state = state; this._emit('state', { state, ...extra }); }

  async start() {
    if (this.state !== 'idle') return;
    this._setState('connecting');
    try {
      const peer = new RTCPeerConnection();
      this.peer = peer;
      peer.addEventListener('track', event => {
        this.remoteStream = new MediaStream([event.track]);
        this._emit('remote-track', { stream: this.remoteStream });
      });
      peer.addEventListener('connectionstatechange', () => {
        if (['failed', 'disconnected', 'closed'].includes(peer.connectionState) && this.state !== 'idle') this.stop('connection_lost');
      });
      this.microphone = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      for (const track of this.microphone.getAudioTracks()) peer.addTrack(track, this.microphone);
      const events = peer.createDataChannel('oai-events');
      this.events = events;
      events.addEventListener('message', ({ data }) => this._onEvent(data));
      events.addEventListener('close', () => { if (this.state !== 'idle') this.stop('channel_closed'); });
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await new Promise(resolve => {
        if (peer.iceGatheringState === 'complete') return resolve();
        const done = () => { if (peer.iceGatheringState === 'complete') { peer.removeEventListener('icegatheringstatechange', done); resolve(); } };
        peer.addEventListener('icegatheringstatechange', done);
        setTimeout(resolve, 2500);
      });
      const result = await this.createSession(peer.localDescription.sdp);
      if (!result || !result.ok) throw new Error((result && result.error) || 'Session creation failed.');
      await peer.setRemoteDescription({ type: 'answer', sdp: result.sdp });
      this.sessionId = result.id || '';
    } catch (error) {
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
        this.sessionId = (event.session && event.session.id) || this.sessionId;
        this._setState('connected', { sessionId: this.sessionId });
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
    this._emit('transcript', { role, id: seg.id, text: seg.text.trim(), final: true });
  }

  send(event) {
    if (!this.events || this.events.readyState !== 'open') return false;
    const payload = { event_id: `evt_${++this._nextEventId}`, ...event };
    this.events.send(JSON.stringify(payload));
    return true;
  }
  appendInstructions(content) { return this.send({ type: 'session.instructions.append', content, delegation_id: null }); }
  appendCommentary(content) { return this.send({ type: 'session.commentary.append', content, delegation_id: null }); }
  setMuted(muted) {
    this.muted = Boolean(muted);
    for (const track of (this.microphone ? this.microphone.getAudioTracks() : [])) track.enabled = !this.muted;
    this.send({ type: this.muted ? 'session.input_audio.mute' : 'session.input_audio.unmute' });
    this._emit('muted', { muted: this.muted });
  }
  stopSpeaking() { return this.appendInstructions('Stop speaking now and wait quietly for the user.'); }

  stop(reason = 'user') {
    if (this.state === 'idle') return;
    for (const role of ['user', 'assistant']) this._finish(role);
    try { if (this.events && this.events.readyState === 'open') this.events.send(JSON.stringify({ type: 'session.close', event_id: `evt_${++this._nextEventId}` })); } catch {}
    if (this.microphone) this.microphone.getTracks().forEach(t => t.stop());
    try { this.events && this.events.close(); } catch {}
    try { this.peer && this.peer.close(); } catch {}
    this.peer = null; this.events = null; this.microphone = null; this.remoteStream = null;
    this._setState('idle', { reason });
  }
}
