// A small live-edge PCM ring. The original player already feeds the speakers;
// this source is analysed through a muted branch, so accumulating old audio only
// creates visible lip-sync delay. Overflow drops whole frames, never channels.
const TARGET = 0.04;
const CEILING = 0.12;

class TapSource extends AudioWorkletProcessor {
  constructor(options = {}) {
    super();
    const requested = options.processorOptions?.channels ?? 2;
    this.channels = Number.isInteger(requested) ? Math.max(1, Math.min(32, requested)) : 2;
    this.capacity = Math.ceil(sampleRate * CEILING) + 256;
    this.ring = Array.from({ length: this.channels }, () => new Float32Array(this.capacity));
    this.write = this.read = this.filled = 0;
    this.started = false;
    this.tail = new Float32Array(0);
    this.starved = this.skipped = this.receivedFrames = 0;
    this.energy = this.samples = this.peak = this.audibleFrames = 0;
    this.reported = 0;
    this.port.onmessage = event => {
      const { type, data } = event.data || {};
      if (type === 'pcm' && data) this.push(data);
      else if (type === 'flush') {
        this.write = this.read = this.filled = 0;
        this.started = false;
        this.tail = new Float32Array(0);
        this.energy = this.samples = this.peak = this.audibleFrames = 0;
        this.starved = this.skipped = this.receivedFrames = 0;
        this.reported = currentTime;
      }
    };
  }

  push(interleaved) {
    if (this.tail.length) {
      const joined = new Float32Array(this.tail.length + interleaved.length);
      joined.set(this.tail); joined.set(interleaved, this.tail.length); interleaved = joined;
    }
    const frames = Math.floor(interleaved.length / this.channels);
    this.tail = interleaved.slice(frames * this.channels);
    if (!frames) return;
    this.receivedFrames += frames;
    let inputStart = 0;
    const target = Math.max(128, Math.floor(sampleRate * TARGET));
    if (this.filled + frames > Math.floor(sampleRate * CEILING)) {
      const drop = this.filled + frames - target;
      const bufferedDrop = Math.min(drop, this.filled);
      this.read = (this.read + bufferedDrop) % this.capacity;
      this.filled -= bufferedDrop;
      inputStart = drop - bufferedDrop;
      this.skipped += drop;
    }
    const count = frames - inputStart;
    for (let frame = 0; frame < count; frame++) {
      const slot = (this.write + frame) % this.capacity;
      for (let channel = 0; channel < this.channels; channel++) {
        const value = interleaved[(frame + inputStart) * this.channels + channel];
        this.ring[channel][slot] = Number.isFinite(value) ? value : 0;
      }
    }
    this.write = (this.write + count) % this.capacity;
    this.filled += count;
    if (!this.started && this.filled >= target) this.started = true;
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output?.length) return true;
    const need = output[0].length;
    for (const channel of output) channel.fill(0);
    const count = this.started ? Math.min(need, this.filled) : 0;
    for (let frame = 0; frame < count; frame++) {
      const slot = (this.read + frame) % this.capacity;
      let framePeak = 0;
      for (let channel = 0; channel < output.length; channel++) {
        const value = this.ring[Math.min(channel, this.channels - 1)][slot];
        output[channel][frame] = value;
        this.energy += value * value;
        framePeak = Math.max(framePeak, Math.abs(value));
      }
      this.peak = Math.max(this.peak, framePeak);
      if (framePeak > 0.0005) this.audibleFrames++;
    }
    // Include emitted zeroes in the RMS window: buffered PCM may be silence.
    this.samples += need * output.length;
    this.read = (this.read + count) % this.capacity;
    this.filled -= count;
    if (this.started && count < need) {
      this.starved += need - count;
      this.started = false; // rebuild a cushion instead of sputtering each quantum
    }
    this.tell();
    return true;
  }

  tell() {
    if (currentTime - this.reported < 0.5) return;
    this.reported = currentTime;
    this.port.postMessage({ type: 'health', buffered: this.filled / sampleRate,
      starved: this.starved, skipped: this.skipped, receivedFrames: this.receivedFrames,
      rms: this.samples ? Math.sqrt(this.energy / this.samples) : 0, peak: this.peak,
      audibleSeconds: this.audibleFrames / sampleRate });
    this.starved = this.skipped = this.receivedFrames = 0;
    this.energy = this.samples = this.peak = this.audibleFrames = 0;
  }
}
registerProcessor('tap-source', TapSource);
