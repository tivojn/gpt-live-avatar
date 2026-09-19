# Gemini Live as a second voice model

Phase 1 (2026-09-19): the solo avatar's conversation can run on **Gemini 3.8
Live** or **Gemini 3.8 Live · Extended Thinking** instead of GPT-Live-1.
Settings › Voice › Voice model. Everything downstream of the voice (bubbles,
lip-sync, motions from her words, Instinct, music commands, reasoning and
action engines, recording) is unchanged, because it never talked to the model:
it talks to one session object.

Not yet on Gemini (phase 2): Avatar Show voices and Director, the group
conversation, voice previews. They keep using GPT-Live-1 and its key.

**Status: verified against Google's real service on 2026-09-19** with
`qa/gemini-real-app.cjs --live --both` (the key saved in the app, no real
microphone, a stand-in reasoning backend). Both models connect on the v1beta
endpoint in 2.3 to 2.4 s; first words after 0.9 s (Live) and 1.8 s (Extended
Thinking); her voice drives lip-sync; the `ask_assistant` round trip returned a
fact only the stand-in backend knew, once, on both; no application note was
read aloud. Not yet verified: echo on real speakers with a real microphone,
long sessions (`goAway`, resumption in anger), cost.

## How it is put together

| Piece | File | Role |
|---|---|---|
| Choices, setup message, hand-off wording, key check, token | `electron/gemini-live.cjs` | Main process. The API key never leaves it. |
| Session branch, key storage, settings | `electron/main.cjs` (`createGeminiSession`, `gla:gemini-key:*`, `liveInstructions({gemini})`) | `gemini-key.bin` is encrypted with safeStorage like the OpenAI key. |
| The client | `web/gemini-live-client.js` | Extends `LiveClient`: same events and methods, Gemini's protocol on a WebSocket. |
| Microphone | `web/pcm-capture-worklet.js` | Hardware rate → 16 kHz mono 16-bit PCM, 40 ms blocks. |
| One object for the window | `web/live-session.js` | Picks the client when a conversation starts; forwards events of the active one. |

**Auth.** The main process buys a single-use ephemeral token
(`POST /v1beta/auth_tokens`, key in the `x-goog-api-key` header, never in a
URL) with the whole setup sealed in, 2 minutes to start and 30 to run. The window
opens `…BidiGenerateContentConstrained?access_token=…` with it (v1beta first,
v1alpha as a fallback) and sends the setup message the main process composed.
A window can only obtain a token while Gemini is the selected voice model.

**Audio.** Out: 16 kHz PCM as `realtimeInput.audio`. In: 24 kHz PCM, queued
end to end into a `MediaStreamAudioDestinationNode`; the window attaches that
stream exactly like a WebRTC track, so `SpeechOutput`, lip-sync timing and the
show recorder are untouched. Barge-in (`serverContent.interrupted`) and Stop
Talking flush the queue at once; Stop Talking also drops the rest of that turn.

**Reasoning and actions.** GPT-Live-1 has a built-in "delegate to client"
event; Gemini has function calling. One `NON_BLOCKING` function,
`ask_assistant(request)`, plays that part. The client turns its call into the
same `session.delegation.created` event `DelegateClient` already handles, and
the answer (`appendCommentary(text, id)`, chunks joined) goes back as the
function response (`scheduling: "INTERRUPT"` on the standard model only). So OpenAI key or OAuth, xAI,
Codex App Server, OpenClaw, Hermes, Grok Build, EnConvo and the agent engines
all work as before. Differences:

- There is no server-side "GPT-Live reasoning" mode. With that mode selected,
  hand-offs are answered by the app with the same backend model through the
  OpenAI key (`gla:delegate:answer`). Without any way to answer, no function
  is declared.
- The system prompt says "Hand-off policy" (`handOffPolicy()`), not GPT's
  "Delegation policy"; an Extended Thinking model is told to reason by itself
  and hand off only what needs facts it cannot verify, or real tasks.
- A function the app never declared is refused, never run. A cancelled or
  already-answered call takes no result, and a stale result is not spoken.

**Extended Thinking.** `thinkingConfig.thinkingLevel` LOW/MEDIUM/HIGH (not
MINIMAL). Only `NON_BLOCKING` tools are accepted, which is why the one
declaration serves both models. `turnComplete` no longer means she is done:
the client tracks `interaction_status` (`working`, event `gemini.interaction`).

**Mid-session notes.** Gemini's system prompt cannot change after setup, so
`appendInstructions` and id-less `appendCommentary` are sent as
`realtimeInput.text` prefixed "(Application note, not said by the user. Never
read it aloud.)"; instructions add "Do not reply to this note."

**Session length.** Setup asks for `contextWindowCompression.slidingWindow`
and `sessionResumption`. On `goAway` or a dropped socket the client reconnects
with the last resumable handle (up to three times) without the window seeing
the state change, and also passes the transcript in case the handle is refused.

## Settings and voices

- **Live Voice System** (was "Voice"): the system selector and only that
  system's key and options. Nothing about the other system is on the page.
- **The voice belongs to the character**, per system: Settings › Character and
  right-click › Character › Voice list the voices of the system in use
  (`characterVoices()` in `electron/main.cjs`; one setting, `characterVoice`).
  GPT-Live-1 voices live in `groupVoices`, Gemini's in `geminiVoices`, each
  with a default per character.
- **Preview** works on both. A Gemini preview is a session of its own on the
  standard model: no microphone, no tools, the sample sentence as its prompt.
- **Reasoning** follows the system. Under Gemini the built-in mode is "Gemini
  reasoning": Gemini alone, no function declared, nothing reaches another
  model (unless Actions are on, which is the user's choice of an engine).
- **Gender beside each voice** (`electron/voice-gender.json`): Google's
  published table for Gemini. OpenAI publishes none for GPT-Live-1;
  `qa/voice-pitch-app.cjs --live` measured each voice's pitch, but that method
  agreed with Google on only 20 of 30 Gemini voices, so it is used only where
  unambiguous. Beacon and Delta are unlabelled until someone listens.

## Tests

- `qa/gemini-live.cjs` (in `npm test`): choices, setup message, hand-off
  wording, key check and error mapping, token request, key only in a header.
- `qa/gemini-live-client.cjs` (in `npm test`): fake socket and audio. Endpoint
  fallback, PCM in/out, mute, transcripts, barge-in, function call as
  delegation, notes, Stop Talking, interaction status, quiet resume, and
  `LiveSession` switching providers with the transcript carried over.
- `qa/gemini-real-app.cjs --live [--thinking|--both]`: the real app against
  Google's real service, using the key saved in the app. Not part of any sweep.
- `qa/gemini-app.cjs`: the real app against a stand-in Google (HTTP plus a
  hand-written WebSocket server) with Chromium's fake microphone: Settings and
  key validation, token, setup and prompt, 16 kHz stream, function call
  answered by the (stubbed) reasoning path, reply heard, shown and lip-synced,
  Stop Talking, hang-up, provider guard. `GLA_GEMINI_API` and
  `GLA_GEMINI_SOCKET` point the app at the stand-in.
  Set `agentEnabled:false` in any test profile: it defaults to on and would
  send test questions to the user's real agent engine.

## Action matrix (2026-09-19)

`bash qa/action-matrix.sh`: every voice system against every action engine,
with the real services and the real engines on this Mac. In a live
conversation she is asked **aloud** (macOS text-to-speech fed in as her
microphone) to create a text file on the Desktop and then to delete it; the
file system decides. Final results, create / delete in seconds:

| | Actions off | Codex | OpenClaw | Hermes | Grok Build | EnConvo |
|---|---|---|---|---|---|---|
| GPT-Live-1 | declines honestly | 19 / 48 | 16 / 30 | 15 / 20 | 19 / 31 | 13 / 15 |
| Gemini 3.8 Live | declines honestly | 23 / 32 | 19 / 32 | 17 / 21 | 19 / 86 | 13 / 16 |
| Extended Thinking | declines honestly | 21 / 33 | 23 / 34 | 18 / 33 | 25 / 41 | 17 / 20 |

What it found, all fixed:

1. **A sentence transcribed in two pieces cancelled its own task** (legacy,
   both systems). The tail of "create a file named … avatar test dot txt"
   arrives as a new user segment after she has handed off; `DelegateClient`
   took every new segment for an interruption. `LiveClient` now marks a
   segment that picks up within 2.5 s of the last one as `continues`; such a
   segment extends the wait or sends the same hand-off again in full.
2. **An unanswered function call froze Extended Thinking.** When the app gave
   up on a hand-off (the user spoke again), Gemini was never told; Extended
   Thinking keeps the session "in progress" until every call is answered, so
   she kept saying she was on it and never took another task.
   `cancelDelegation()` now closes the call (SILENT on the standard model),
   and a watchdog answers any call still open after 11 minutes.
3. **Extended Thinking claimed success with nothing connected** ("I have
   created the file on your desktop"). With Actions off the prompt now states
   her limits (`NO_ACTIONS`); three reruns all declined.
4. The first OpenClaw and Hermes failures were the engines' own (model off,
   expired login), reported honestly by her on both systems.

Grok Build keeps working after the job is done (a dozen more steps), so her
spoken confirmation comes late. That is the engine's pace.

## What the real service taught us

These are not in the docs the way one would expect; each cost a failed run.

1. **REST names, not SDK names.** `POST /v1beta/auth_tokens` rejects
   `liveConnectConstraints` ("Unknown name"). The field is
   `bidiGenerateContentSetup` and takes the *bare* setup object.
2. **The token carries the whole setup.** With `bidiGenerateContentSetup`
   present and no `fieldMask`, the session's configuration is taken entirely
   from the token and the connection's setup message is ignored. So the full
   setup is sealed into the token (the window cannot alter the model,
   instructions or tools); the socket still has to send a first setup message.
3. **No `scheduling` for Extended Thinking.** A function response with
   `scheduling` closes the socket: 1007, "Function response scheduling is not
   supported for this model". The standard model accepts `INTERRUPT` (she
   speaks the result at once); the client sends it only there.
4. **safeStorage is per app name.** A QA script can only decrypt the saved key
   after `app.setName('gpt-live-avatar')`.
5. Extended Thinking greets proactively (proactive audio is always on), so the
   first utterance of a session may not answer the first input.
6. The token response has `name`; the v1beta constrained endpoint works, so the
   v1alpha fallback has not been needed.

## Still to verify with a person at the microphone

- Echo: her voice plays through Web Audio, not a WebRTC track. Chromium's echo
  canceller should still cancel it; confirm on speakers.
- How reliably each model hands off unprompted (the live check asks it to),
  and whether the filler line feels right. Prompt tuning, not plumbing.
- A session long enough to see `goAway` and a real resumption.
- Cost and latency over a normal conversation.

Sources: [Live API reference](https://ai.google.dev/api/live) ·
[Thinking in the Live API](https://ai.google.dev/gemini-api/docs/live-api/thinking) ·
[Ephemeral tokens](https://ai.google.dev/gemini-api/docs/ephemeral-tokens) ·
[Gemini 3.8 Live Extended Thinking](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live-extended-thinking)
