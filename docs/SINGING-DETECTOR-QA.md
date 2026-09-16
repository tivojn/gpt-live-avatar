# Local singing activity detection

The stereo-centre filter is retained as a phoneme-input cleanup filter. It is
not used as evidence that someone is singing: drums, bass and lead instruments
can also be centered. A separate Google YAMNet classifier now assesses the
original mono mix and the centre-enhanced mix, averaging voice-class evidence.
The classifier has no network/API dependency and never uploads audio.

## Integration

`createVocalDetector(context, source, {enhancedSource, onState, signal})` from
`web/vocal-detector.js` resolves to `{allowed(), state, close()}`. Feed `source`
with the full audio and `enhancedSource` with the **ungated** centre cleanup
(`vocalChain(..., {gate:0})`). While `allowed()` is false, emit silence visemes
and zero mouth energy. Keep beat analysis on the complete music. A known
isolated-vocal stem can bypass this classifier.

The detector defaults closed, closes if worker decisions are over 500 ms old,
and closes on model errors. It gathers 500 ms before first allowing singing.
The optional abort signal terminates model startup immediately and closes the
worker after startup too. UI code should surface a loading/error state rather
than silently fall back to the old positional heuristic.

## Evidence (2026-09-17)

All audio remained local. Ground truth came from the publicly distributed
MUSDB18 seven-second test excerpts: original vocal+band mixtures and the exact
sum of drums/bass/other stems with the vocal stem excluded. The test audio is
not distributed with the app, and no model was trained on it.

- Thresholds chosen using the first 20 test songs. 240 non-overlapping-hop
  windows per class: 86.7% of mixture windows admitted, 94.6% of instrumental
  windows rejected. Window 0.975 s, hop 0.5 s, state reset per song.
- Fixed thresholds tested on the remaining **30 held-out songs**: 292/360
  mixture windows admitted (81.1%), 332/360 instrumental windows rejected
  (92.2%). These numbers characterize the gate, not phoneme/lyric accuracy.
  Some mixture windows include singer pauses, so admission is a conservative
  proxy rather than sample-accurate vocal recall.
- Five explicit band→mix→band transitions: admission after 0.1, 1.2, 0.2, 0.2,
  0.7 s; first close after 0.5, 0.1, 0.4, 0.9, 0.7 s. One later band section had
  a 0.3 s false reopening. Dense/quiet vocal starts remain the weakest case.
- Real Electron AudioContext+AudioWorklet+Worker run, nine seconds: all initial
  and late instrumental frames closed; singing admitted at 0.1 s and stayed
  open through the three-second sung segment; closed 0.7 s after band-only
  transition. 91 live updates; average dual inference 12.3 ms on this Mac.
- Actual worker-load abort rejected `AbortError` in 0.4 ms.
- `node qa/vocal-detector.cjs`: eight checks pass, covering 32/44.1/48/96 kHz
  resampling and packet timing, cold startup, stale decisions, worker errors,
  abort during startup, abort after ready, and already-aborted calls.

The model has a one-second receptive window. Updating every 100 ms does not
make classification instantaneous. This is a significant reduction of mouth
motion during instruments, **not perfect singer source separation**. Faint
singing can be missed, and some instruments can still be mistaken for voice.
Phoneme classification still receives a cleaned mixture and is not a lyric
alignment system. Stronger vocal separation would require a separate model
and additional latency/performance evaluation.

## Bundled dependencies

YAMNet TFJS version 1 and TensorFlow.js/WASM 4.22.0, approximately 18 MB.
The original float32 model shards are unmodified. Apache-2.0 notices and a
SHA-256 manifest are included under `web/vendor/`. Scalar and SIMD WASM are
bundled; multithreading is disabled so COOP/COEP is not required. Inference is
in a dedicated worker and does not compete for the avatar's WebGL context.

Sources:
- https://tfhub.dev/google/tfjs-model/yamnet/tfjs/1
- https://github.com/tensorflow/models/tree/master/research/audioset/yamnet
- https://github.com/tensorflow/tfjs/tree/v4.22.0
- https://github.com/sigsep/sigsep-mus-db
