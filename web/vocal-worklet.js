// Pull the singer out of a stereo mix, so the recognizer classifies a voice
// instead of a drum kit.
//
// Lead vocals are almost always panned dead centre, while guitars, keys, reverb
// and stereo overheads are spread wide. That difference is per-frequency, so a
// plain (L+R)/2 is not enough - bass and snare are centred too and would still
// come through. Instead, for every FFT bin, measure how much L and R agree:
//
//     agreement = 1 - |L-R| / (|L|+|R|)
//
// A bin that is identical in both channels scores 1 (centre, probably voice);
// a bin that differs scores 0 (wide, probably instrument). Weight the mid
// signal by that score, raised to a power to sharpen the decision.
//
// Extracting the centre is not the same as knowing someone is singing, and that
// gap is what made the avatar mouth the backing track. Measured against a
// vocal-free instrumental, the recognizer returned silence for 1% of frames:
// her mouth ran through the whole piece.
//
// So a second number decides WHETHER a voice is present, and it is measured,
// not assumed. Spectral flatness was the obvious candidate and it is wrong:
// against ground-truth audio a voice scored 0.91 and the band 0.97, so gating
// on "peaky means voice" would have silenced the singer and kept the orchestra.
// A trumpet is exactly as harmonic as a person.
//
// What does separate them is how much of the voice band is pinned dead centre
// relative to the whole mid signal. On the same ground truth: 0.44 with a voice
// present against 0.29 without. That is a real but soft margin, so it drives a
// soft gate. A false negative then costs a smaller mouth movement rather than a
// frozen face, which is the right way for this to fail.
const N = 1024, H = 256, BINS = N / 2 + 1;
// Where a sung voice lives. Below this is bass and kick, above it is mostly air
// and cymbals, and both are liars about whether anyone is singing.
const VOICE_LOW_HZ = 200, VOICE_HIGH_HZ = 3500;
const smoothstep = (edge0, edge1, x) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};
const hann = new Float32Array(N);
for (let i = 0; i < N; i++) hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
// Hann at 75% overlap sums to 1.5; divide it back out on the way to output.
const NORM = 1 / 1.5;

function fft(re, im, inverse){
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++){
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j){ [re[i],re[j]]=[re[j],re[i]]; [im[i],im[j]]=[im[j],im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1){
    const ang = (inverse ? 2 : -2) * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len){
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++){
        const ar = re[i+k], ai = im[i+k];
        const br = re[i+k+len/2]*cr - im[i+k+len/2]*ci;
        const bi = re[i+k+len/2]*ci + im[i+k+len/2]*cr;
        re[i+k] = ar+br; im[i+k] = ai+bi;
        re[i+k+len/2] = ar-br; im[i+k+len/2] = ai-bi;
        const ncr = cr*wr - ci*wi; ci = cr*wi + ci*wr; cr = ncr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++){ re[i] /= n; im[i] /= n; }
}

class CenterExtract extends AudioWorkletProcessor {
  static get parameterDescriptors(){
    return [
      {name:'sharpness', defaultValue:2.5, minValue:0.5, maxValue:6},
      // 0 disables voice gating entirely, which is what the local-file path
      // wants when it is already pointed at a vocal stem.
      {name:'gate', defaultValue:1, minValue:0, maxValue:1},
      // Straddling the measured margin: the band's median (0.29) sits low in
      // this range, the singer's median (0.44) at the top of it. Pushing the
      // floor up to 0.30 to force more silence was tried and measured worse -
      // it blanked quiet sung frames without ever resting during the band.
      {name:'centreFloor', defaultValue:.22, minValue:0, maxValue:1},
      {name:'centreCeiling', defaultValue:.45, minValue:0, maxValue:1},
    ];
  }
  constructor(){
    super();
    this.inL = new Float32Array(N); this.inR = new Float32Array(N);
    this.filled = 0;
    this.out = new Float32Array(N * 2); this.outRead = 0; this.outWrite = 0; this.outCount = 0;
    this.re1 = new Float32Array(N); this.im1 = new Float32Array(N);
    this.re2 = new Float32Array(N); this.im2 = new Float32Array(N);
    this.lowBin = Math.max(1, Math.round(VOICE_LOW_HZ * N / sampleRate));
    this.highBin = Math.min(BINS - 1, Math.round(VOICE_HIGH_HZ * N / sampleRate));
    this.midSum = 0; this.centreSum = 0;
    this.loudest = 1e-6;   // slow-decaying reference for "loud for this song"
    this.open = 0;         // smoothed gate, 0 closed .. 1 open
    this.reported = 0;
  }
  frame(sharpness, gate, floorT, ceilT){
    const {re1, im1, re2, im2} = this;
    for (let i = 0; i < N; i++){
      re1[i] = this.inL[i] * hann[i]; im1[i] = 0;
      re2[i] = this.inR[i] * hann[i]; im2[i] = 0;
    }
    fft(re1, im1, false); fft(re2, im2, false);
    // Centre extraction, keeping the magnitudes for the voice test below.
    const centre = this.centre || (this.centre = new Float32Array(BINS));
    for (let k = 0; k < BINS; k++){
      const lr = re1[k], li = im1[k], rr = re2[k], ri = im2[k];
      const magL = Math.hypot(lr, li), magR = Math.hypot(rr, ri);
      const diff = Math.hypot(lr - rr, li - ri);
      const agree = Math.max(0, 1 - diff / (magL + magR + 1e-9));
      const g = Math.pow(agree, sharpness);
      const midR = (lr + rr) * 0.5, midI = (li + ri) * 0.5;
      const mr = midR * g, mi = midI * g;
      centre[k] = Math.hypot(mr, mi);
      if (k >= this.lowBin && k <= this.highBin){
        this.midSum += Math.hypot(midR, midI); this.centreSum += centre[k];
      }
      re1[k] = mr; im1[k] = mi;
      if (k > 0 && k < N/2){ re1[N-k] = mr; im1[N-k] = -mi; }   // keep it real
    }

    // How much of the voice band is pinned dead centre. A lead vocal is the
    // most centred thing in a pop mix, so this rises when someone sings and
    // falls back when only the band is playing - which absolute level cannot
    // tell you, because the band is perfectly loud on its own.
    const centred = this.centreSum / (this.midSum + 1e-12);
    this.midSum = 0; this.centreSum = 0;

    // Kept only as an observable. It is reported by gla_sing() and is useful
    // when a mix behaves oddly, but it is deliberately not part of the decision.
    let sum = 0, logSum = 0, count = 0;
    for (let k = this.lowBin; k <= this.highBin; k++){
      const mag = centre[k] + 1e-9;
      sum += mag; logSum += Math.log(mag); count++;
    }
    const arithmetic = sum / count;
    const tonality = 1 - Math.exp(logSum / count) / (arithmetic + 1e-12);

    // "Loud for this song" rather than an absolute threshold, so a quiet master
    // is not mistaken for an instrumental break.
    // Frames arrive every 5 ms, so this decays about 1% a second: slow enough
    // to remember the chorus through a quiet verse, fast enough to follow a
    // change of track.
    this.loudest = Math.max(arithmetic, this.loudest * 0.99995);
    const level = arithmetic / (this.loudest + 1e-12);

    // The level term only removes true near-silence; the centre term does the
    // actual work of deciding whether anyone is singing.
    const voice = smoothstep(floorT, ceilT, centred) * smoothstep(0.02, 0.08, level);
    const target = gate > 0 ? 1 - gate + gate * voice : 1;
    // Open in about ten milliseconds so no syllable is clipped at its start,
    // close over about seventy so the gate rests between phrases. A much slower
    // release was tried, on the theory that it should ride through a singer's
    // breaths: measured, it never closed at all, because a band throws up a
    // centred moment often enough to keep re-triggering it.
    this.open += (target - this.open) * (target > this.open ? 0.5 : 0.08);
    // Below this the residue would still clear the recognizer's own voice gate
    // and keep her mouth moving, so it is snapped to true silence instead.
    const applied = this.open < 0.06 ? 0 : this.open;
    if (applied !== 1) for (let i = 0; i < N; i++){ re1[i] *= applied; im1[i] *= applied; }

    if (currentTime - this.reported > 0.2){
      this.reported = currentTime;
      this.port.postMessage({type:'voice', t:currentTime, tonality, level, centred, gain:applied});
    }

    fft(re1, im1, true);
    for (let i = 0; i < N; i++){
      const at = (this.outWrite + i) % this.out.length;
      this.out[at] += re1[i] * hann[i] * NORM;
    }
    this.outCount += H;
    this.outWrite = (this.outWrite + H) % this.out.length;
  }
  process(inputs, outputs, params){
    const input = inputs[0], output = outputs[0][0];
    if (!input || !input.length || !output) return true;
    const L = input[0], R = input[1] || input[0];
    const sharpness = params.sharpness[0];
    const gate = params.gate[0], floorT = params.centreFloor[0], ceilT = params.centreCeiling[0];
    for (let i = 0; i < L.length; i++){
      this.inL[this.filled] = L[i]; this.inR[this.filled] = R[i]; this.filled++;
      if (this.filled === N){
        this.frame(sharpness, gate, floorT, Math.max(ceilT, floorT + .02));
        this.inL.copyWithin(0, H); this.inR.copyWithin(0, H);
        this.filled = N - H;
      }
    }
    for (let i = 0; i < output.length; i++){
      if (this.outCount > 0){
        output[i] = this.out[this.outRead];
        this.out[this.outRead] = 0;
        this.outRead = (this.outRead + 1) % this.out.length;
        this.outCount--;
      } else output[i] = 0;
    }
    return true;
  }
}
registerProcessor('vocal-center', CenterExtract);
