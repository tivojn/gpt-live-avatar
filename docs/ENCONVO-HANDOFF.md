# EnConvo avatar integration handoff

**Goal: give EnConvo's existing agents a visible, animated avatar. EnConvo owns
the intelligence, credentials, voice conversation, tools and permissions.**

For the EnConvo developer and their AI coding assistant. Updated September 17,
2026 for GPT-Live Avatar **v0.2.19**. Use its tag for a reproducible source
reference. Check the matching release page for signed installer availability
and checksums, and record the exact source commit you integrate.

- Repository: https://github.com/tivojn/gpt-live-avatar
- Release: https://github.com/tivojn/gpt-live-avatar/releases/tag/v0.2.19
- Apple Silicon DMG: https://github.com/tivojn/gpt-live-avatar/releases/download/v0.2.19/GPT-Live.Avatar-0.2.19-arm64.dmg
- Checksums: https://github.com/tivojn/gpt-live-avatar/releases/download/v0.2.19/SHA256SUMS-0.2.19.txt
- This handoff: https://github.com/tivojn/gpt-live-avatar/blob/main/docs/ENCONVO-HANDOFF.md
- Plain Markdown for your coding assistant: https://raw.githubusercontent.com/tivojn/gpt-live-avatar/main/docs/ENCONVO-HANDOFF.md
- Clone/build guide: https://github.com/tivojn/gpt-live-avatar/blob/main/docs/DEVELOPER-HANDOFF.md
- Standalone agent setup: https://github.com/tivojn/gpt-live-avatar/blob/main/docs/AGENT-RUNTIMES.md
- Asset delivery details: https://github.com/tivojn/gpt-live-avatar/blob/main/docs/PROTECTED-ASSETS.md
- Studio lighting: https://github.com/tivojn/gpt-live-avatar/blob/main/docs/STUDIO-LIGHTING.md

This document describes working repository components and a proposed integration
boundary. **There is no completed EnConvo adapter or published avatar SDK here.**
EnConvo's code has not been inspected for this handoff. Locate its actual
extension, audio and agent interfaces before choosing a native bridge. Names
explicitly marked *proposed* below are interfaces to implement, not existing APIs.

### Integration reference in the v0.2.19 source

- Five characters, solo/Together controls, local audio-to-viseme lip-sync,
  overhead speech/task updates, protected downloads and the encrypted Sarah
  starter are available as the integration reference.
- Standalone reasoning and enabled actions can use Codex App Server, OpenClaw
  Hermes or Grok Build. OpenClaw agents and Hermes profiles can be assigned separately to
  each character. Missing runtimes are marked unavailable; a failed selected
  runtime does not silently fall back to another provider.
- Right-click menus include About and Check for Updates, with the installed
  version, release description and official download links. Checks are on
  demand; the app does not automatically replace itself.
- The new runtime adapters are optional examples, not prerequisites for
  EnConvo. Start with one silent avatar, then connect EnConvo's own audio and
  tools. Do not start by reproducing the standalone account/settings system.

Use `SHA256SUMS-0.2.19.txt` from the matching release to verify its downloaded
installer rather than checksums from an older release.


## 0.2.19 music, input and deformation update

- Right-click **Dance Along to Current Song** or **Stop Dancing** in solo or
  Together (sing-along was retired in 0.2.23). Together uses the clicked
  character; stopping one leaves the other performers running. Stop also
  cancels pending startup. Music controls need neither a voice API key nor an
  external agent, but require macOS 14.4 or newer, audible music and audio-capture permission.
- Every visible overhead bubble includes input, microphone and send controls,
  including after live conversation ends. Focusing the field keeps it open.
  Ordinary bubbles hide during motions/music and return afterward; explicitly
  reopened input and agent questions remain accessible during a performance.
- `web/music-command.js` recognizes direct typed/spoken requests;
  `web/sing.js` manages music sessions and per-character output;
  `electron/audio-tap-owner.cjs` owns the shared native capture helper.
  `electron/music-menu.cjs` supplies both menus. Reuse the existing request
  route and keep music audio separate from conversational voice output.
- Dance along reads the tempo from the captured mix and paces the dance
  clips; the mouth stays still. The former vocal detector and music visemes
  went with sing-along.
- Sarah's immutable `sarah-wardrobe-v10` packages restore authored pelvis
  weights on body, fitted brief, side ties, pants, belt and dress. Geometry and
  morphs are unchanged. All five characters use motion overlay
  `music-pelvis-20260917`; previous immutable download URLs remain available. Signed catalogue publication
  times let a new installer supersede stale cached catalogues; an older
  downloaded Sarah package cannot override the repaired bundled starter.
- The renderer preserves real finger tracks when present. The audited Meshy
  sources contain wrist motion but no changing finger animation. Root drift,
  arm volume and hair clearance repairs are included in this release.

EnConvo continues to own credentials, voice sessions, reasoning, tools and
permissions. The avatar components provide rendering and attributed UI/audio
hooks; there is still no completed EnConvo adapter. Map music capture and
session lifecycle to EnConvo's host permissions before exposing these controls.

Validation: the full `npm test` suite, pelvis fingerprint/geometry checks and
idempotent retrofit pass. The notarized packaged app unlocks bundled Sarah
with a fresh profile and downloads Tia plus matching motions from the live
gateway. An existing-profile fixture with the previous encrypted Sarah and
cached catalogue selects the repaired bundle and preserves its tactical outfit.
The installed DMG retains existing settings and credential files. `qa/music-controls-app.cjs` exercises the real solo
and Together windows with stubbed music requests; session and native-menu
regressions separately cover scoped startup/stop and routing. See
[Pelvis weight QA](PELVIS-WEIGHT-QA.md), [Motion deformation QA](MOTION-DEFORMATION-QA.md)
and [Finger audit](MESHY-HAND-AUDIT.md) for measured scope and limitations.

## 1. Scope and ownership

The owner describes EnConvo as an all-in-one agent with its own credentials,
agentic tools and delegation. If EnConvo already supports GPT-Live-1, connect
the avatar to that session. Otherwise implement GPT-Live support through
**EnConvo's own voice/delegate architecture**. The avatar receives the resulting
assistant audio and events; it does not choose a provider or log in.

| Capability | Owner in the EnConvo integration |
| --- | --- |
| API keys, OAuth, subscriptions, provider/model selection | EnConvo |
| GPT-Live transport, microphone, playback, interruption | EnConvo; coordinate playback with the lip-sync adapter |
| Reasoning, delegation, memory and task execution | EnConvo |
| Files, shell, code, screenshots, browser/computer use | EnConvo's tools and permissions |
| Geometry, materials, wardrobe, hair, eyes, expressions | Reuse this renderer and licensed packages |
| Audio-to-viseme recognition, face blending, blinking | Reuse the local avatar modules |
| Movement, motions, rotation, resize | Avatar adapter, exposed as EnConvo tools/UI |
| Task updates above the correct head | Avatar UI fed by EnConvo's attributed events |
| Protected downloads and encrypted cache | Reuse/port the native asset loader; keys stay outside the web renderer |

Keep `characterId`, `agentId`, `voiceId`, `conversationId` and `turnId` separate,
even if initially mapped 1:1. A visual avatar does not automatically require a
new agent/session. Changing an outfit must not reconnect voice or reasoning.

The standalone app has a Live client, direct provider reasoning, and native
Codex App Server/OpenClaw/Hermes/Grok Build adapters. Its old built-in action
engine and file/browser tools have been removed; it only exposes visual avatar
controls to the selected external runtime. **Do not run these alongside EnConvo's own system.
None of those runtimes is a required dependency for this integration.**

### Agent assignment in the reference app

The standalone app stores assignments as
`avatarAgentBindings[characterId][engine]`. OpenClaw discovers native agents;
Hermes discovers named profiles. A blank assignment follows the runtime's
default, while an explicit missing assignment produces an error. The engine
selected for reasoning handles enabled actions by default. An explicit action
engine override can use a different runtime, including with direct API/OAuth
reasoning. Permissions follow the effective action engine. Both solo and Together
pass the addressed character and shared, verified task context to that engine.

For EnConvo, map characters to **EnConvo agent IDs** using its existing registry.
Preserve the addressed character through progress, tools and spoken results.
Agent/profile selection must not move a task's reply to another avatar or create
an independent conversation history for each outfit. Reference implementation:
[runtime-agents.cjs](../electron/runtime-agents.cjs), with operational details in
[AGENT-RUNTIMES.md](AGENT-RUNTIMES.md).

The local validation used a Hermes `tia` profile with OpenAI OAuth2 and
`openai-codex:gpt-5.6-sol`. **That profile and sign-in are not included in the
installer or repository.** Coworkers configure their own runtime accounts if
testing those optional backends. No owner login or token transfer is needed.

## 2. Target architecture

```text
User voice / typed request
           |
           v
EnConvo: conversation, addressee, context, model/delegate, permissions
       |                 |                         |
       | speech audio    | text + public progress  | local avatar tools
       v                 v                         v
             EnConvo avatar adapter (to build)
       | audio clock -> visemes   | character/turn -> UI state
       v                         v
       3D renderer + motions + face + overhead bubble
                           |
                  transparent desktop surface

Protected R2 gateway -> native encrypted cache -> authenticated resources
                                                        |
                                                        v
                                                     renderer
```

A native EnConvo host can use a webview for rendering while owning the window,
audio engine and tool bridge. A small Electron companion is an alternative if
its extension model cannot host a transparent webview. Choose after inspecting
EnConvo. Do not introduce a second microphone or credential UI merely to make
the existing standalone page work.

## 3. Run the reference before extracting components

Use an Apple Silicon Mac with macOS 14+, Git and Node/npm compatible with the
locked dependencies. Install the official app above, then:

```bash
git clone https://github.com/tivojn/gpt-live-avatar.git
cd gpt-live-avatar
git switch -c codex/enconvo-avatar
npm ci
npm run import-release -- "/Applications/GPT-Live Avatar.app"
npm test
npm run start:isolated
```

`import-release` verifies the shipped catalogue and encrypted Sarah checksum.
It imports only the release's `assets-runtime.json`, `assets-index.json`,
`sarah/base.gla` and the signed catalogue's optional `sarah/motions.gla` into ignored
`build/` paths. It copies no personal account or
settings. First unlock needs internet; displaying/manipulating Sarah needs no
voice key. Other characters download in Settings → Avatar.

`start:isolated` uses `build/dev-profile`, leaving the installed app profile
alone. Use the developer's own account if testing standalone voice. The EnConvo
integration should use the developer's normal EnConvo credential setup.

The earlier v0.2.12 reference DMG is about 1.05 GB because encrypted Tia,
wardrobe and motions are included. The current v0.2.19 reference includes Sarah
instead; check its matching release for the installer size and checksums.
EnConvo can use this starter pattern; a cloud-only package needs
a first-run download UI before a character can appear.

Do not begin by re-exporting Blender models. Current protected packages contain
the rig/material corrections and appearance libraries. The raw-model GitHub
release is retired. `fetch-assets.sh` and legacy raw/iOS paths are not the
supported coworker bootstrap; use `import-release`.

## 4. Component map: what to take

Paths are relative to this repository. Follow transitive imports: copying only
`avatar3d.js` loses most quality and rig fixes.

| Component | Files | Notes |
| --- | --- | --- |
| Core renderer | [web/avatar3d.js](../web/avatar3d.js) | Publishes `window.OpenClamAvatar3D`; WebGL canvas, rig, visemes and poses. |
| Wardrobe/resources | [web/avatar3d-options.js](../web/avatar3d-options.js), [web/avatar3d-resources.js](../web/avatar3d-resources.js) | Selection, color variants, streaming and texture tiers. |
| Skin/hair/eyes | [web/avatar3d-portrait.js](../web/avatar3d-portrait.js), [web/avatar3d-diffusion.js](../web/avatar3d-diffusion.js), [web/avatar3d-face.js](../web/avatar3d-face.js), `web/vendor/color/` | Per-character calibration, skin diffusion, display transforms and facial packs. |
| Deformation corrections | [web/avatar3d-volume.js](../web/avatar3d-volume.js), [web/avatar3d-clearance.js](../web/avatar3d-clearance.js), [web/avatar3d-garment-fit.js](../web/avatar3d-garment-fit.js), [web/avatar3d-body-brief.js](../web/avatar3d-body-brief.js), [web/avatar3d-mingmei-fit.js](../web/avatar3d-mingmei-fit.js), [web/avatar3d-cloth-occlusion.js](../web/avatar3d-cloth-occlusion.js) | Joint volume, body-fitted briefs, local garment fit and depth-limited layering; preserve material callbacks, morphs, rig metadata and streaming hooks. |
| Head/hair attachment | [web/avatar3d-head-attachments.js](../web/avatar3d-head-attachments.js) | Ming-Mei/Iselda hair follows procedural head turns without replacing authored pose/motion transforms. Preserve restore/capture/apply ordering. |
| Motions/stage | [web/avatar3d-motion.js](../web/avatar3d-motion.js), [web/avatar3d-companion.js](../web/avatar3d-companion.js) | Clips, reactions, `CompanionController`, `AvatarStudioStage`. |
| Eye behavior | [web/avatar3d-attention.js](../web/avatar3d-attention.js) | Irregular blinks and subtle binocular eye movement; already called by renderer. |
| Current lip-sync | [web/lip-sync.js](../web/lip-sync.js), [web/lip-sync-worklet.js](../web/lip-sync-worklet.js), [web/lip-sync-model.js](../web/lip-sync-model.js), `web/vendor/headaudio/` | Learned audio-to-viseme recognition introduced in v0.2.8, not the removed RMS/spectral classifier. |
| Connection sounds | [web/conversation-sounds.js](../web/conversation-sounds.js) | Synthesized connecting/ready/end cues; no samples or remote service. |
| Task bubbles | [web/agent-progress.js](../web/agent-progress.js), [web/bubble-policy.js](../web/bubble-policy.js) | Public status, stale-event handling and Auto/Always/Off. |
| Deep zoom / close-up | [web/avatar-zoom.js](../web/avatar-zoom.js), [web/avatar-closeup.js](../web/avatar-closeup.js) | Shared crop math; keep solo/Together pointer anchoring, pan, reset and pixel budgets together. |
| Drawing/hit tests | [web/avatar-render-budget.js](../web/avatar-render-budget.js), [web/avatar-hit-mask.js](../web/avatar-hit-mask.js) | Pixel/texture budgets, frame pacing, cached alpha mask. |
| Three.js runtime | `web/vendor/three/` | Keep the complete directory including workers, WASM and `avatar-morph-stream.js`. [MANIFEST.json](../web/vendor/three/MANIFEST.json) records 0.185.1 and the local morph-streaming patch. A stock replacement can regress memory use. |
| Protected delivery | [electron/assets.cjs](../electron/assets.cjs), [electron/protected-assets.cjs](../electron/protected-assets.cjs), [electron/asset-download.json](../electron/asset-download.json) | Node/native-side responsibilities; port for a non-Electron host. |
| Defaults | [electron/default-appearance.json](../electron/default-appearance.json), [electron/default-voices.json](../electron/default-voices.json), [electron/default-placement.json](../electron/default-placement.json) | Seed EnConvo preferences; preserve subsequent user choices. |

Read these as host examples, not drop-in EnConvo pages:

- [web/avatar.html](../web/avatar.html): solo loading/compositor, stage,
  drag/pinch/rotation, `performAction`, `placeBubble`, playback and cleanup.
- [web/group.js](../web/group.js), [web/group-panel.js](../web/group-panel.js),
  [web/group.html](../web/group.html): actor map, layout, independent controls,
  speaker/listener gaze, bubbles and resizable/minimizable Together panel.
- [electron/main.cjs](../electron/main.cjs): `avatarInfo`, authenticated asset
  server, placement/recovery and native menus. Extract these responsibilities
  without initializing its agent/account/session machinery.
- [electron/preload.cjs](../electron/preload.cjs): Electron's `window.gla` bridge,
  mixing UI, accounts, tools and voice. Replace with a narrow EnConvo bridge.
- [electron/app-info.cjs](../electron/app-info.cjs),
  [electron/releases.cjs](../electron/releases.cjs),
  [electron/release-info.json](../electron/release-info.json): standalone
  version details and update checks. EnConvo should use its own updater. A
  separately distributed fork must change its update destination so users
  cannot accidentally replace it with the upstream standalone app.

Leave EnConvo in charge instead of copying these backends:

- `web/live-client.js`, `web/delegate-client.js`, `web/agent-client.js`;
- `web/group-live.js`, `web/group-voice.js`, `web/group-input.js`,
  `web/group-capture.js`, `web/group-capture-worklet.js`;
- `electron/live-config.cjs`, `electron/delegate*.cjs`, `electron/agent*.cjs`,
  `electron/codex*.cjs`, `electron/group-input.cjs`;
- `electron/acp-client.cjs`, `electron/acp-agent.cjs`,
  `electron/runtime-agents.cjs`, `electron/runtime-tools.cjs`.

They remain useful behavior references. `web/group-context.js`,
`web/group-actions.js` and `electron/group-context.cjs` inform routing/shared
receipts, but EnConvo's conversation store should remain the source of truth.
The ACP bridge and its short-lived local avatar-tool endpoint exist for the
standalone runtimes. EnConvo should register avatar commands directly in its
own tool system, rather than introducing that additional bridge.

## 5. Renderer API that exists today

Load `avatar3d.js` as an ES module. It exposes
`OpenClamAvatar3D.create({width, height})` and dispatches
`openclam-avatar3d-ready` when the module is ready. The instance supports:

- `load(modelURL, {resources, pose, yaw, performance, motionLibrary,
  appearanceLibrary, textureLimit})`;
- `render(now, state, view)` → canvas; `resize(width, height)`; `dispose()`;
- `options.selection`, `options.select(selection)`, `motion.clips`,
  `motion.play(id, {loop})`, `motion.stop()`;
- `setOrbit({yaw, pitch})`, `layout()`, `crownProjection()`, `jointBounds()`,
  `prepareMotionFrame(now, reduce)`, `keepMotionInViewport(fit, surface)`.

`now` is monotonic milliseconds (`performance.now()`), not Unix time. `view`
is an optional camera/compositor crop in the renderer's model frame with output
pixel dimensions. Use the full host example for desktop travel.

Quality names differ across layers: UI `friendly` maps to renderer `eco`,
`balanced` to `balanced`, and `best` to `quality`. The shared pixel-budget helper
takes the UI names; `load()` and appearance selection take the renderer names.

The following is **example adapter code to write**, using existing methods.
`info` comes from your protected asset service with the URL/metadata fields of
`avatarInfo()`. Call from a user gesture with an assistant-only MediaStream and
a shared AudioContext. This graph must be the stream's single audible route.

```js
import '/avatar3d.js';
import { SpeechOutput } from '/lip-sync.js';
import { frameDue } from '/avatar-render-budget.js';

export async function mountAvatar(container, info, look, stream, context) {
  const avatar = OpenClamAvatar3D.create({ width: 480, height: 700 });
  await avatar.load(info.modelURL, {
    resources: Boolean(info.residentAvailable), pose: info.pose, yaw: info.yaw,
    performance: 'balanced', textureLimit: 2048,
    motionLibrary: info.motionsURL, appearanceLibrary: info.appearanceURL,
  });
  avatar.options?.select({ ...look, performance: 'balanced' });
  container.append(avatar.canvas);
  const speech = new SpeechOutput(context, {
    onError: message => console.warn(message), // surface in EnConvo's UI
  });
  await speech.ready;
  speech.attach(stream);
  await context.resume();
  let request = 0, last = 0;
  function frame(now) {
    request = requestAnimationFrame(frame);
    if (document.visibilityState !== 'visible') return;
    const signal = speech.sample();
    const active = signal.speaking || avatar.motion?.active || avatar.options?.transition;
    const due = frameDue(now, last, active ? 30 : 15);
    if (due === null) return;
    last = due;
    avatar.render(now, {
      viseme: signal.viseme, visemeWeights: signal.visemeWeights,
      lipSyncSource: signal.lipSyncSource,
      intensity: signal.relative, speaking: signal.speaking,
      projectedHeight: 700, fitContent: true, stableFitContent: true,
      bodyMotion: false, audienceContact: true,
    });
  }
  request = requestAnimationFrame(frame);
  return {
    avatar,
    interrupt() { speech.setActive(false); },
    resumeSpeech() { speech.setActive(true); },
    dispose() {
      cancelAnimationFrame(request);
      speech.close();
      avatar.dispose();
      avatar.canvas.remove();
      // EnConvo owns the stream tracks and context; it closes them.
    },
  };
}
```

Production needs startup-failure cleanup, subscriptions, host visibility and
avatar-switch generations. This fixed-viewport example does not implement
native controls, tools or group routing. For a silent avatar, omit SpeechOutput
and pass silent speech state: audio is not required to mount the character.

## 6. EnConvo audio integration

### Current pipeline

The current pipeline uses HeadAudio: MFCC features and learned Gaussian phoneme prototypes
select 15 visemes locally. It is not neural and not text-driven animation.
RMS controls intensity. The model is 14,352 bytes, with no inference API or GPU
model. Visemes are `sil`, `PP`, `FF`, `TH`, `DD`, `kk`, `CH`, `SS`, `nn`, `RR`,
`aa`, `E`, `ih`, `oh`, `ou`, mapped to native morphs or fallback recipes.

Pass `visemeWeights`, `lipSyncSource`, `intensity` and `speaking`, not just a
boolean. The worklet uses the audio clock independently of paced rendering.
`SpeechOutput.attach()` currently accepts a browser **MediaStream**. Recognition
and playback share one AudioContext and an **80 ms local playback buffer**.
The device output clock and a small visual lead align mouth blending. This is
not a claim that total conversation latency is 80 ms.

The muted HTML audio element inside SpeechOutput starts Chromium's remote
WebRTC decoder; only WebAudio is audible. Removing it caused silent remote
audio in actual Electron tests. Do not activate both playback paths or add a
second 80 ms delay downstream.

### Browser audio from EnConvo

Feed EnConvo's assistant-only stream into this graph. Remove duplicate playback
or adapt the graph to EnConvo's single playback owner. `SpeechOutput.input` is
an internal gain node feeding recognition and delay; wrap that seam for an
AudioNode source instead of pretending `attach()` accepts AudioNodes. Nodes
must share the same context.

### Native PCM from EnConvo

**A native adapter still needs to be built.** Find where EnConvo receives/decodes
assistant audio and schedules playback. Choose either:

1. Feed bounded PCM batches into a webview audio source, with one WebAudio graph
   owning recognition and playback; or
2. Keep native playback, recognize the same PCM, timestamp visemes against the
   native playback clock and map that clock to the renderer.

Specify sample rate, channels, sample format and frame index. Resample/downmix
deliberately, handle underflow, bound queues and flush scheduled audio/visemes
on interruption. Avoid JSON/base64 for every tiny audio quantum. Transcript
deltas cannot replace the missing audio bridge.

Test WebGL2, AudioWorklet, workers/WASM and secure-origin behavior in EnConvo's
actual webview. Electron is verified; WKWebView is not. If the custom scheme
cannot support the worklet, use a supported origin or native recognition/clock
path. Do not silently revert to RMS.

### Shared rules

- Recognize only **that character's assistant speech**: never the microphone,
  SFX, music or mixed audio from other characters.
- Group: share model/context resources; disable recognition for inactive peers.
- Interruption: `setActive(false)` clears queued visemes and the delay buffer.
  Also cancel/flush EnConvo's upstream response. Reopening the floor must not
  release stale audio from the interrupted turn.
- End/cancel/disconnect produces silence. Removing an actor disposes its
  worklet/output, not EnConvo's shared context or host-owned microphone.
- Recognition remains approximate. English live voices were tested;
  Mandarin/Japanese phoneme accuracy has not been established.
- If EnConvo's TTS supplies accurate timed phonemes/visemes, map those directly
  to the renderer instead. Use one articulation source at a time.

See [LIP-SYNC.md](LIP-SYNC.md) for details and tests.

## 7. Proposed event and tool boundary

Define a versioned host adapter. These names are **proposed**, not shipped APIs:

| Event | Data/meaning | Avatar behavior |
| --- | --- | --- |
| `conversation.state` | Conversation ID, idle/connecting/connected, reconnect reason | Status and optional once-per-room cue |
| `speech.begin` / audio / `speech.end` | Character/turn/conversation IDs, audio format and playback-clock origin | Correct output, visemes, overhead wave, name highlight |
| `speech.interrupted` | Interrupted turn/generation | Stop sound and clear that turn's targets |
| `transcript` | Human/assistant role, participant ID, turn, text, delta/final | Attributed captions/bubble |
| `task.progress` | Task and character IDs, public state/label/text | Update above the addressed head |
| `task.result` | Same IDs, verified result, artifact references or error | Final bubble; EnConvo stores shared result |
| `attention` | Speaker/listener/audience target | Smooth gaze without shaking the body |
| `avatar.command` | Request ID, target, validated local command | Motion, move, pose, appearance, restore |

Bind asynchronous events to conversation, character and turn/task generation.
Ignore closed-session/replaced-task events. Deduplicate tool request IDs so a
provider retry does not play a motion twice.

Register local tools in **EnConvo's existing tool registry**, for example:

| Proposed tool | Existing behavior to adapt |
| --- | --- |
| `avatar_state` | Solo/group `installAgentUI(... execute ...)` handlers enumerate visible actors and installed motion IDs. |
| `play_motion(character, motion)` | Solo `performAction('clip:' + id)` or group per-actor playback. Validate installed clip IDs. |
| `move_avatar(character, destination)` | Solo stage/`beginWalk` or group movement handler. Report whether arrival actually happened. |
| `set_appearance(character, selection)` | `avatar.options.select(...)`, validate against that actor's catalogue, persist in EnConvo. |
| `restore_avatar(character)` | Native recovery plus stage reset; there is no `Avatar3D.reset()` method. |

For “Tia, go upper right and create tia.txt on Desktop,” EnConvo orchestrates
the movement tool and its own file tool. The visual layer neither runs shell
commands nor decides file permissions. Report results only after the tools
confirm them. Cancelling speech does not undo a completed file operation.

`CompanionController`, `replyAvatarAction()` and `groupAction()` offer language
reaction examples. Prefer structured EnConvo tools for explicit actions. If
reply-driven reactions are also enabled, deduplicate against tool calls. Do not
copy the standalone voice prompt or its delegation policy wholesale.

### Task progress above the head

Map public EnConvo events to `AgentProgress.accept()`: `id`, `character`, `state`,
optional `text`, `tool`, `error`, `receipts`. Send `thinking` first for a new
task, then `update`/tool states, then `complete`, `error` or `cancelled`.
Otherwise its stale-event guard rejects an unknown task.

The class tracks one current task. The standalone controller keeps a separate
instance per character, so simultaneous tasks on different avatars retain
independent progress. EnConvo should add a per-task map if one character can
run multiple concurrent jobs.

Show public status, not private reasoning, credentials or raw shell output.
Detailed artifacts remain in EnConvo's result UI. Respect Bubble Off; Auto keeps
an active task visible and briefly retains the result. Clamp bubbles to the
visible screen, including during close-up.

### Conversation sounds

`ConversationSounds.transition(state, {resumed, reason})` provides short sci-fi
connecting/ready/end cues. Instantiate once per conversation/room, not per
actor. Honor the user's toggle, suppress previews/internal reconnect cues, and
keep the sound out of the recognition graph. If EnConvo already plays session
cues, select one owner to avoid duplicate chimes.

## 8. Multiple participants and shared context

Start with one character, then add the other four using `group.js` as the
visual/control reference. The standalone group supports two to five avatars
and optional human participation.

Standalone `LiveGroup` opens one persistent GPT-Live session per character and
separately transcribes bounded human utterances to confirm addressees. **That
is a reference transport design, not an EnConvo requirement.** Reuse EnConvo's
transcript/routing/session infrastructure. Do not add an extra transcription
API merely because this app uses one. If EnConvo cannot reliably identify names,
design recognition there and explain its latency/cost in EnConvo.

One session serving several distinct voices is a host/provider capability to
verify. The renderer does not change the session's voice. Do not promise five
concurrent voices for the price of one session. The renderer itself makes no
voice or reasoning requests.

Required behavior:

1. “Hi Tia…” routes the instruction and spoken result to Tia. Keep unnamed
   follow-ups with her until a new addressee is established.
2. A name alone selects the listener and waits. A paused “Sarah…” followed by
   an instruction must not fall through to the previous actor.
3. All actors share attributed dialogue and **verified** tool receipts. After
   Tia creates a file, Sarah resolves “delete that file” from EnConvo's result,
   subject to EnConvo's permissions.
4. Context is not new authorization. Quoted text, webpage content or another
   character's spoken claim is not a verified result or a human command.
5. Human barge-in stops audible speech immediately, then routes the recognized
   request. Never relay avatar audio as another actor's human microphone input.
6. Preserve character/agent/voice identity through delegation. Tia must not
   narrate Sarah's task result.
7. Indicate speaking with the overhead wave and highlighted name, without a
   body shake, scale pulse or camera zoom. Requested motions still work.
8. Keep independent drag, pinch, two-finger rotation, context menu and
   transparent-gap click-through during live conversation.

Reference voice defaults, to map through EnConvo's own voice settings:

| Character | Slug | Voice |
| --- | --- | --- |
| Tia | `tia` | `marin` |
| Sarah | `sarah` | `gleam` |
| Iselda | `iselda` | `quartz` |
| Ming-Mei | `ming-mei` | `willow` |
| Seraphim | `seraphim` | `bossa` |

More behavior: [GROUP-CONVERSATIONS.md](GROUP-CONVERSATIONS.md).

## 9. Controls, defaults and visual fidelity

- Seed from `default-appearance.json`, the owner's later manually selected
  looks. Sarah is the initial avatar in v0.2.19, using `casual` — **Tie top,
  chain pants & sandals**, without the coat. Tia's body remains `Ps012.stand`
  (Standing 6); all characters default to no prop. Cursor
  following is off. Preserve later user edits.
- Audience eye contact applies at rest/talking; a held prop preserves authored
  aim. NaturalAttention already handles irregular blinks/subtle eye motion;
  do not add a competing fixed blink timer.
- **Cmd+Shift+0** restores default size/upper-right placement. A saved manual
  location may differ on later launches. Port `default-placement.json` and
  native coordinate conversion/clamping for multiple monitors.
- **Cmd+Shift+9** frames a face close-up. Pinch/wheel zoom can continue to eye
  detail through `avatar-zoom.js`; the host surface stays bounded while its
  camera crop becomes smaller. Preserve crop panning and pointer anchoring in
  solo and Together, including aspect changes. Do not scale a native window or
  drawing buffer indefinitely to implement deep zoom.
- CSS `pointer-events: none` alone cannot make a native window click-through.
  Use silhouette masks plus native pass-through, while bubbles/menu controls
  remain interactive. Do not read the full GPU image on every pointer move.
- Keep camera aspect correct. Distinguish CSS points, device pixels,
  avatar-frame coordinates and global screen coordinates. Test close-up,
  “come over,” stage exit, manual drag and recovery together.
- Bounds must include wardrobe/props, not only torso. Prepare the motion frame
  before measuring; retain `keepMotionInViewport` and stable fitting.
- Copy appearance packs and material/rig modules together. These are
  Blender-derived skinned glTF packages with custom metadata, not a generic
  VRM/MToon integration. A generic shader/import loses important corrections.
- Keep original facial proportions. Tia's experimental narrower jaw was
  reverted; do not re-enable it as a quality improvement.
- Preserve volume skinning, arm/hand pose handling, garment clearance and
  source normals. Otherwise elbow collapse, skirt penetration, inflated hips,
  detached-looking joints or faceted clothing can return. Check moving poses.

The renderer approximates Blender beauty shots in real time; identical offline
rendering is not guaranteed. Compare actual captures with the reference app
and available licensed product/source images before declaring a port complete.

## 10. Protected downloads and the existing R2 service

For authorized integration work, keep the existing gateway and imported client
resources. Changing app name/version/local signing identity does not itself
require a new bucket. The gateway checks the application download credential,
not the original Apple signing identity.

This credential is separate from EnConvo's model-provider credentials: it is
only for the avatar protocol, not an OpenAI key or Cloudflare admin token. Never
put its value in docs, logs or renderer UI.

Required resources and implementation:

1. `electron/asset-download.json`: HTTPS gateway location.
2. Imported `build/protected/assets-runtime.json`: catalogue public key and
   shipped download credential; keep out of source control.
3. Imported signed `build/protected/index.json`: packages, revisions, sizes and
   checksums; starter at `build/protected/starter/sarah/base.gla`, with its matching
   `sarah/motions.gla` overlay.
4. `AvatarAssets` in `electron/assets.cjs`: verification, unlock, download,
   cancellation, revision-aware resolution and resource reads.
5. `ProtectedPackage` in `electron/protected-assets.cjs`: encrypted archive
   reader. A native port must preserve its format/authentication behavior.

Archives remain encrypted on disk. First unlock retrieves wrapped content keys
and stores them securely; later launches can work offline. Electron uses
`safeStorage`; native EnConvo needs its own secure-storage implementation, not
plaintext JSON or a copied user key file.

The current server binds `127.0.0.1` and requires a per-run `X-Gla-Asset-Key`
header for model resources. Electron injects it only for its own app windows.
**A new EnConvo webview does not automatically receive that header.** Port the
authenticated resource boundary. Do not fix a 403 by removing authentication
or allowing wildcard CORS.

Preserve `avatarInfo()` / `startServer()` serving behavior:

- Package-scoped URLs, so one actor's resource root cannot change when another
  actor loads. Serve model, textures, appearance packs and motions.
- Filter `openclamVariants` to installed files; missing 4K degrades gracefully.
  Do not overlay tiers from different asset revisions.
- Inflate raw-deflate motion JSON when the plain JSON URL is requested.
- Bounded range reads, proper content types, no-store decrypted responses and
  path-traversal rejection. Do not unpack a plaintext model cache to disk.
- Preserve absolute `/vendor/three/...` and other module imports, or rewrite
  them consistently for an EnConvo subpath. Include worklet, model, LUT and
  worker/WASM dependencies, not just the main JavaScript file.

Ordinary integration needs no new bucket, uploads, key rotation or cloud deploy.
No owner Cloudflare login, private content/signing keys, Blender originals or
Apple signing credentials are needed to develop against the protected service.

The established design uses a Workers Free gateway with daily cutoff and a
**10,000,000,000-byte upload-workflow storage cap**. Preserve these limits,
bounded retries and private bucket access. Quota errors should offer retry/later,
not create a paid fallback. This is not an unlimited guarantee against bills
if plans, uploaders or other account usage change. Format/deployment details:
[PROTECTED-ASSETS.md](PROTECTED-ASSETS.md).

### Licensing boundary

`package.json` declares MIT. Preserve source provenance and third-party notices
including HeadAudio, Three.js and color transforms. Purchased models, textures,
motions and Blender originals have separate terms. Repo access or a working
download URL does not itself grant redistribution rights in a new public
product. Confirm permitted EnConvo distribution with the owner and the applicable
asset licenses before publishing; keep raw models and keys private.

Encryption deters casual extraction; a user controlling their computer can
inspect runtime geometry. It is not unbreakable DRM or proof of license
compliance. Do not offer raw-model export or public GLB/texture ZIP URLs.

## 11. Performance target

**Target: M2 MacBook with 16 GB RAM. This is not a verified hardware result from
the current development Mac.** Measure on the target machine; high multi-avatar
GPU load was a major concern in the reference app.

Reuse `avatar-render-budget.js`:

- Solo: 30 fps active, 10 fps idle in Friendly, 15 otherwise.
- Group: 30 fps busy, 12 resting per actor.
- At reported memory <=16 GB, nominal total pixel budgets are 0.7M Friendly,
  1.2M Balanced, 1.8M Best, divided across characters. These are allocation
  targets, not strict RAM/VRAM ceilings; rounding/hysteresis adds slack.
- Texture ceilings at <=16 GB: 2K for one/two actors, 1K for more than two.
- Render the visible body/prop rectangle and composite onto the transparent
  surface. Avoid full-display Retina WebGL buffers per actor and constant
  buffer reallocation. Preserve morph streaming, tiering and disposal.
- Skip hidden rendering; keep geometry/placement updates flowing during texture
  swaps. Share audio resources; do not recognize silent listeners repeatedly.

Benchmark sustained idle, speech, kung-fu punch, approach/close-up, switching
and five-character talk. Record frame-time distribution, CPU, GPU and process
memory. One screenshot cannot establish a GPU budget or smooth motion.

## 12. Delivery milestones and acceptance

### A. One silent character in EnConvo

Protected asset access and Sarah render without a new voice/account UI. Check
skin/hair/eyes, wardrobe, expressions, props, drag/pinch/rotation, gap
click-through, close-up and Cmd+Shift+0. Compare captures with the reference
using matching appearance, camera and quality.

### B. EnConvo voice and interruption

Real EnConvo speech drives lip closures, open and rounded vowels. Interrupt
mid-word and start a new turn; no duplicate playback, stale speech, stuck mouth
or hidden extra mic session. Verify headphones/speakers and the actual native
or browser audio path inside EnConvo.

### C. EnConvo tools and task bubbles

Ask Tia to move and create a disposable test file through EnConvo. Show progress
above Tia and the verified outcome. Check cancellation, denied access and a
new task arriving before an old update. EnConvo owns permissions throughout.

### D. Five actors

Test addressed names, a paused “Sarah…”, follow-ups, barge-in and roundtable
resume. Tia creates a test file; Sarah operates on that exact file using shared
receipts. Only the addressee narrates. Test parallel tasks across avatars and
independent cancellation. If EnConvo supports multiple jobs per avatar, provide
an additional task-selection UI.

Play motions on all five, including Sarah's boxing warmup when installed.
Inspect elbows, wrists, shoulders, skirt/hip joints and prop bounds from
multiple angles. All actors remain manipulable while talking.

### E. Packaging and target hardware

Fresh profile: starter unlocks online then renders offline; another actor
downloads; cancellation preserves old assets; missing tiers degrade. No raw
model cache or credentials in Git. Use EnConvo's distribution/signing workflow,
measure M2/16 GB, and leave the original installation/profile intact.

Reference checks:

```bash
npm test
npx electron qa/lip-sync-clock.cjs
```

Inspect these for scenarios to adapt: `qa/controls-app.cjs`,
`qa/placement-app.cjs`, `qa/props-app.cjs`, `qa/group-controls-app.cjs`,
`qa/character-portrait.cjs`, `qa/protected-app.cjs`, `qa/render-budget.cjs`.
They are standalone harnesses, not EnConvo tests. Check fixture/profile setup
before running: some expect imported packages or installed settings.

`qa/lip-sync-app.cjs --live` and `qa/group-lip-sync-app.cjs --live` use the
installed voice credential and real provider sessions, incurring normal usage.
Use only the developer's account. Normal `npm test` requires no original
Blender files or live microphone.

### Verification scope

The `npm test` suite checks engine routing, separate permissions, cancellation,
shared task receipts and the visual-only tool bridge. `qa/runtime-app.cjs --live`
exercises real native reasoning, file creation/readback and Sarah's motion in
solo/Together through OpenClaw, Hermes and Grok Build. It also checks the new
listening animation and Settings/About screens without opening a microphone.
See the release notes for the checks completed for the published installer.

Earlier v0.2.9 acceptance also covered a packaged fresh-profile Tia unlock/render
and native Hermes reasoning. This is not a new full voice-quality or EnConvo
integration test.

These are reference-app checks. EnConvo integration, another developer's
credentials and M2/16 GB performance still need their own acceptance tests.

## 13. Starting instruction for your coding assistant

> Read docs/ENCONVO-HANDOFF.md and inspect EnConvo's existing agent, credential,
> voice, delegation and extension interfaces. Implement milestone A, then B,
> before group work. Reuse v0.2.13's complete renderer dependency tree, real
> audio-to-viseme pipeline and protected asset loader. EnConvo owns provider
> credentials, reasoning, tools, microphone and conversation state. Build a
> narrow adapter; do not instantiate the standalone app's Codex, OpenClaw,
> Hermes, Grok Build or direct-OAuth backends, or duplicate its voice
> session. Map avatars to EnConvo's own agent IDs. Identify the real
> audio format and playback clock, validate APIs in code, preserve R2 protection
> and original character proportions, and test inside EnConvo before claiming
> completion. Treat proposed events/tools as interfaces to implement, not an
> existing SDK. Report host assumptions, hardware measurements and limitations.

### 0.2.11 integration additions

Use `electron/shortcuts.cjs` only if EnConvo does not already own shortcuts. The defaults are **⌘⇧0** for recovery and **⌘⇧9** for a face close-up. `web/avatar-closeup.js` provides the framing calculation; both solo and Together use it without modifying models. Settings records custom combinations and handles conflicts.

Action permissions are under **Action Engine & Permissions**, separate from **Delegate Reasoning Provider**. `agentFollowReasoning` defaults to true. An explicit external action choice turns following off and preserves independent action models and permissions. EnConvo can replace both routing controls with its own agent system.

All five avatars now have 65 motions. `tools/retarget-meshy-motion.py` preserves the Meshy source’s body orientation and movement amplitude. The optional signed `motionUpdate` package contains only `runtime/motions/`; apply it before the base package for those paths, after verifying its signature, checksums, authenticated chunks and matching base revision. The Tia installer includes this encrypted overlay. Do not copy raw model or motion data into a public EnConvo repository.


### Historical 0.2.12 renderer and asset changes

This records the earlier release. Its Sarah v8 panel and v10 motion revision are
superseded below; retain the v0.2.12 lighting calibration as a rollback reference.

- Studio/Soft lighting and reflections now follow the camera, with independent fill lighting. Preserve the portrait renderer's material callbacks and `beforeRender()` integration; see [studio lighting](STUDIO-LIGHTING.md). Light count, texture limits and desktop pixel budgets are unchanged.
- Keep `web/avatar3d-cloth-occlusion.js` with the renderer dependency tree. It provides a garment-only depth pass for Sarah's Brazilian outfit and Iselda's skirts. This pass runs only while a supported garment is visible. Body bounds and a depth limit prevent rear cloth or hands from erasing exposed skin.
- Sarah's `sarah-wardrobe-v8` package includes a smooth pelvis-supported Brazilian panel. Iselda's `iselda-wardrobe-v9` includes corrected standing-pose leg alignment and skirt support. Both keep their original materials and wardrobe choices. Use the new signed base/texture/motion combination; do not overlay old tiers.
- Idle pose transitions default on for all five characters and Together uses the saved preference. Explicit pose selections and prop modes retain their existing controls.
- Ming-Mei's eyebrow material restores its missing brown tint. Armor outfits restore the clothed pilot and lock head direction to the helmet while allowing eye movement.
- See [motion audit](MOTION-AUDIT.md) and [wardrobe audit](WARDROBE-AUDIT.md) for scope, reproducible checks and limitations. Physical M2/16 GB acceptance remains a host integration test.

### 0.2.13 integration follow-up

Preserve the complete renderer dependency tree, especially:

- `avatar3d-head-attachments.js` and authored-frame restore/capture/apply hooks.
  Ming-Mei and Iselda’s extra procedural head turns carry their independent
  hair roots through full matrices while retaining the baked hair animation.
- `avatar-zoom.js`, solo `avatar.html` and per-actor Together crop state. Deep
  zoom magnifies through a bounded camera crop; it does not allocate an
  eye-sized model into an enormous desktop surface. Keep coordinate conversion,
  aspect handling, panning and recovery together. EnConvo can own the shortcuts.
- `avatar3d-mingmei-fit.js` through the normal `fitGarment` streaming path.
  Ming-Mei’s fitted opaque back transfers local body weights and adds at most
  9 mm clearance once on load; her body and upper lace remain unchanged.
- Sarah’s `avatar3d-body-brief.js` and garment-fit/morph/depth-layer hooks and the matching
  `sarah-wardrobe-v9` protected content. The final derived brief follows the
  repaired outer body surface and lower-body morphs, including under both
  dresses. Dress weights remain authored; a small clearance handles the fitted
  fabric. See [Wardrobe audit](WARDROBE-AUDIT.md) for the localized derived-body
  repair, summer cut and checked cases.
- The `meshy-v11-20260915` motion overlays. They correct pelvis anatomy across
  all five rigs and the Ming-Mei/Iselda spine aliases. Existing in-place jump,
  separate foot motion and stable clip framing remain part of the pipeline.
  Read [Motion audit](MOTION-AUDIT.md) before altering a retarget map.
- The restrained Studio/Soft calibration, retaining four light sources, one
  shadow map and existing texture/pixel limits. Compare against the v0.2.12
  rollback reference rather than increasing exposure or light count globally.

Sarah’s wardrobe revision and the new motion overlays need matching protected
packages. The hair, lighting, zoom and Ming-Mei dress fitting changes are runtime
corrections. They do not require another copy of every avatar asset or new R2
credentials. Keep the signed catalogue’s revision compatibility checks.

Useful maintainer checks when licensed prepared assets exist locally (a clone
using only encrypted release imports should use `npm test` and the isolated app
instead; these commands do not provide or request source model keys):

```bash
node_modules/.bin/electron qa/zoom-native.cjs
node_modules/.bin/electron qa/head-attachments.cjs
node_modules/.bin/electron qa/motion-support.cjs
node_modules/.bin/electron qa/motion-posture.cjs
node_modules/.bin/electron qa/mingmei-dress.cjs
node_modules/.bin/electron qa/sarah-dress.cjs
node qa/body-brief-hooks.cjs
node_modules/.bin/electron qa/studio-lighting.cjs
```

The new Ming-Mei harness verifies opaque-back coverage across 32 samples and
survival of wardrobe streaming and quality-tier changes. Motion support checks
2,910 frames on all five characters. Separate continuous posture QA passes
30 scenarios and 18,250 rendered frames with stable framing and hair attachments. The audits record the additional posture,
hair and Sarah coverage results. These are reference renderer tests, not an
EnConvo adapter test. Review movement from all angles, interruption and recovery
inside EnConvo. There is no general cloth simulation or physical M2/16 GB
acceptance result in this follow-up.

### Protected download transport

The Electron host supplies `net.fetch` to `AvatarAssets` so protected downloads
use Chromium’s network stack, including HTTP/2. An EnConvo port should supply an
equivalent native HTTP/2-capable client while retaining origin restrictions,
redirect rejection, cancellation and signed per-part/whole-package checksums.


### 0.2.14 overhead input follow-up

The fullscreen Ask dialog is removed. `web/agent-client.js` now owns only task routing, per-character progress, cancellation and inline questions. The composers live in the existing overhead bubbles in `web/avatar.html` and `web/group.js`. Reuse those surfaces for EnConvo input and route their requests to EnConvo’s own agent system; do not create an extra modal window. Group typed requests share conversation history and verified results while retaining the chosen character.

`electron/agent-folder.cjs` supplies the `~/Downloads` working-folder default and a one-time migration of the former Desktop default. `web/path-display.js` shortens the current user’s home path for display without changing execution paths. This update uses the same protected v0.2.13 avatar catalogue; no new model download is needed.


### 0.2.15 Sarah starter default

The reference installer and fresh profile now start with Sarah in **Tie top,
chain pants & sandals** (`casual`), without a coat or prop. Reuse
`electron/default-appearance.json` for her remaining pose, color and accessory
choices, and preserve later user edits. Tia remains a downloadable character.

Sarah’s included base is the existing 579,546,579-byte protected archive,
accompanied by its 53,459,437-byte signed motion overlay. This changes installer
contents and defaults only; the protected R2 catalogue, asset revisions and
hosted packages are unchanged. Keep the earlier v0.2.13 asset fixes and
v0.2.14 overhead-input behavior when integrating this release.
