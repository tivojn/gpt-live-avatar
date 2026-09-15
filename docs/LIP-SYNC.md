# Live audio lip-sync

Solo and Together use the same local `SpeechOutput` pipeline. GPT-Live sends
streamed audio and transcript fragments, without a documented phoneme/viseme
timeline. Unlike synthesis engines that expose phoneme alignment, this pipeline
must infer articulation from the audio the character speaks.

The bundled MIT-licensed [HeadAudio](https://github.com/met4citizen/HeadAudio)
model uses MFCC features and learned Gaussian phoneme prototypes to select 15
visemes. It runs in an AudioWorklet on CPU, with no remote inference, GPU model,
transcript dependency, or additional API request. RMS controls articulation
strength and turn timing; it no longer selects the mouth shape. The renderer
blends the character's native viseme morphs, with its existing ARKit fallback
recipes where a native morph is absent.

Recognition and playback share one AudioContext. An 80 ms output buffer gives
the recognizer time to classify incoming frames. Timestamped mouth targets use
the device output clock and a 25 ms visual lead for morph blending. This is
added local buffering, not a claim that end-to-end voice latency is 80 ms.
The muted HTML audio element starts Chromium's remote WebRTC decoder; only the
WebAudio path is audible. Do not remove the element or make both paths audible.

Together uses one context and cached model for the room. Closed speaking floors
disable recognition. Interruption mutes immediately, clears pending mouth
targets and replaces the delay buffer so old speech cannot replay. Stop releases
the worklet and media nodes. A recognizer failure is reported visibly and falls
back to a simple mouth opening so speech remains usable.

The model is approximate and trained on English mixed voices. It is not a
neural speech recognizer or an exact TTS phoneme track. English live voices have
been tested; Mandarin/Japanese phoneme accuracy has not been established.

`Conversation sounds` in Voice settings controls the original synthesized
connecting, ready and ending cues. They play once per conversation state change,
including Together; voice previews, internal reconnects and individual peer
turns do not repeat them. Their audio never enters lip-sync recognition.

Validation:

- `node qa/lip-sync.cjs`: model classes, clock queue, silence, cancellation,
  worklet termination and cue deduplication.
- `electron qa/lip-sync-clock.cjs`: actual browser worklet, WebAudio delay,
  output timing, silent restart and OfflineAudioContext sound rendering.
- `electron qa/lip-sync-app.cjs --live`: five actual GPT-Live voices, native
  morph coverage and interruption, with no hardware microphone.
- `electron qa/group-lip-sync-app.cjs --live`: five simultaneous peer connections,
  shared audio context, active speaker isolation and group interruption.

The two opt-in live checks use the installed user's voice API key in an isolated
profile and remove the copied credential on exit. They incur normal GPT-Live
usage charges. Generated recordings and screenshots stay in ignored `build/`.
