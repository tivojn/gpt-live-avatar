// Microphone audio for Gemini Live: mono, 16 kHz, 16-bit little-endian PCM in
// 40 ms blocks. The context runs at the hardware rate (usually 48 kHz), so each
// output sample is the mean of the input samples it spans: a box filter that is
// cheap, has no latency and is plenty for speech. The fractional position
// carries across render quanta, so any hardware rate works.
class PCMCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.step = sampleRate / (options?.processorOptions?.targetRate || 16000);
    this.block = new Int16Array(options?.processorOptions?.blockSamples || 640);
    this.filled = 0; this.position = 0; this.sum = 0; this.count = 0;
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      this.sum += input[i]; this.count++; this.position++;
      if (this.position >= this.step) {
        this.position -= this.step;
        const value = Math.max(-1, Math.min(1, this.sum / this.count));
        this.block[this.filled++] = value < 0 ? value * 32768 : value * 32767;
        this.sum = 0; this.count = 0;
        if (this.filled === this.block.length) { const out = this.block.slice(); this.port.postMessage(out.buffer, [out.buffer]); this.filled = 0; }
      }
    }
    return true;
  }
}
registerProcessor('pcm-capture', PCMCapture);
