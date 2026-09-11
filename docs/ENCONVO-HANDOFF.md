# Handoff: the avatar layer for EnConvo live agents

Audience: the EnConvo developer and the coding agent working in the EnConvo
codebase. Goal: let an EnConvo agent (for example Mavis) that already talks
through EnConvo's own GPT-Live-1 session appear as a 3D avatar (Tia, Sarah,
SGT Sara) with lip-sync, reactions ("do a kung fu punch") and screen-wide
movement. EnConvo keeps its own GPT-Live session, credentials and prompts;
this repository contributes only the avatar.

Repository: https://github.com/tivojn/gpt-live-avatar (source) and its
`assets-v1` release (models, texture tiers, motion clips, catalogue).

## 0. See it running first

Install the notarized Mac build from
https://github.com/tivojn/gpt-live-avatar/releases/tag/v0.1.0, paste any
OpenAI key with GPT-Live-1 access, double-click her head and say "do a kung fu
punch", "come closer", "go to the upper right corner". Right-click her for the
menu (motions, poses, outfits, bubble modes). That is the behaviour the
integration below reproduces inside EnConvo; the TestFlight iOS build shows
the same on a phone.

## 1. What to take and what to ignore

Take (the avatar layer, plain ES modules, no build step):

| Path | Role |
| --- | --- |
| `web/avatar3d.js` | Renderer. `window.OpenClamAvatar3D.create({width,height})` returns an `Avatar3D` instance: `load(url, opts)`, `render(now, state, view)`, `layout()`, `setOrbit`, `crownProjection()`, `jointBounds()`, `keepMotionInViewport(fit, surface)`, `prepareMotionFrame(now)`, `gazePoint(point)`, `lockStudioLens()`, `dispose()`. Dispatches `openclam-avatar3d-ready` on `window` when loaded. |
| `web/avatar3d-motion.js` | `Avatar3DMotion`: motion clip library (`clips` Map, `play(id,{loop})`, `stop()`, `prepare(id)`, `setPlaybackRate`, `isPortraitGesture(id)`, `expression(now)`). Created by `Avatar3D.load` when `motionLibrary` is given; reachable as `avatar.motion`. |
| `web/avatar3d-options.js` | `Avatar3DOptions` (`avatar.options`): poses, outfits, props, wardrobe (`select({...selection, body, outfit, prop})`, `walkingClip()`, `isTravelClip(id)`). Built from the `openclamAvatar` library embedded in the model. |
| `web/avatar3d-companion.js` | The "brain" that maps spoken replies to motions: `replyAvatarAction(user, reply, suggestion, clips)`, `motionIntent`, `avatarIntent`, `isSpatialAction`, `stageDestinations`, `CompanionController` (`consider`, `takeReaction`, `command`, `gesture`, `step`), `AvatarStudioStage` (the perspective stage: depth, walking, corners, close-up). |
| `web/avatar3d-resources.js` | Streams texture tiers (512/1K/2K/4K) for the split "resident" model so the friendly mode stays cheap. |
| `web/vendor/three/*` | three.js r17x modules the renderer imports by absolute path (`/vendor/three/...`). |
| `web/avatar.html` | Reference host: the 2D compositor, fit model, screen-wide stage, bubble, gestures, hit-testing, lip-sync analyser, reaction plumbing. Read it as the integration example; you will replace its live client and bubble with EnConvo's UI. |
| `tools/` | Asset pipeline: `build-assets.py` (packages, tiers, iOS GLBs, catalogue), `inject-library.py` (embed the `openclamAvatar` library into a GLB: bones, poses, outfits), `fetch-assets.sh`. |
| `electron/assets.cjs` | Reference for downloading tiers/avatars from the release with progress, overlaying downloaded tiers on the bundled package, serving `model.gltf` with only the texture variants present, inflating deflated motion clips. |

Ignore (EnConvo already has its own):

- `web/live-client.js` (WebRTC to OpenAI), `electron/main.cjs` session creation, the API key store, `web/settings.html`.
- `ios/GPTLiveAvatar/Live/LiveSession.swift` (WebSocket session) unless you want the native iOS audio path; the iOS avatar bridge in `ios/GPTLiveAvatar/Avatar/` is reusable.

License note: three.js is MIT. The avatar models (Tia, Sarah) and motion clips are the owner's assets; they are shared with EnConvo under whatever terms the owner sets. OpenClam-derived renderer modules keep their OpenClam origin.

## 2. The host contract: what the avatar needs from EnConvo

The avatar layer is driven by four inputs and produces two outputs. All of
them are local, synchronous JavaScript; nothing talks to OpenAI.

Inputs:

1. **Assistant audio** for lip-sync. Any Web Audio source: connect the
   playback `MediaStream` or `AudioNode` to an `AnalyserNode` (fftSize 1024)
   and, every frame, classify a viseme with `measureAudioSignal` +
   `classifyAudioViseme` (both live in `web/avatar.html`, ~40 lines, copy
   them). Feed `state.viseme`, `state.intensity`, `state.speaking` to
   `avatar.render`. No text-to-viseme alignment is needed; the model's speech
   audio is enough and it stays in sync with what the user hears.
2. **Transcript deltas** from the GPT-Live session, both roles:
   `session.input_transcript.delta` (user) and `session.output_transcript.delta`
   (assistant), with `start_ms`/`end_ms`. Fold deltas into sentences (a gap of
   more than 800 ms on the session clock, or 1.2 s idle, ends a sentence; see
   `_transcript` in `web/live-client.js`). Each finished assistant sentence
   group goes to the companion: `companion.consider(latestUserText, replyText,
   undefined, performance.now(), { clips: avatar.motion.clips, turnID })`.
3. **The prompt contract** (see section 4). The model must *say* what it will
   do; the avatar reacts to the reply text, never to the user's words alone.
4. **Commands** from EnConvo's UI or tools: `performAction(action)` in
   `avatar.html` shows the full switch: `clip:<id>`, `stay`, spatial actions
   (`closer`, `back`, `come`, `follow`, `walk-around`, `run-around`,
   `go-upper-right`, ...), `sit`, `stand`, `heart`, plus
   `avatar.options.select({... body, outfit, prop})` for poses, outfits, props.

Outputs:

- A canvas (`avatar.render` returns an offscreen image; the host composites it
  where it wants, with alpha). In this app the whole transparent window is
  the canvas and the bubble is DOM on top.
- Events you may want to surface: `avatar.motion.active` (id of the playing
  clip, for a status line such as "Playing: Kung Fu Punch"), `companion.walking`,
  `companion.destination`, `avatar.crownProjection()` (where to hang a bubble
  or a caption), `avatar.jointBounds()`.

Per frame (30 fps active, 8 to 15 fps idle in this app):

```js
const layout = avatar.layout();                       // rest bounds in model px
// choose fit {scale, x, y}: where the 1024x1536 model frame lands on your surface
fit = avatar.keepMotionInViewport(fit, surface) || fit; // keep lunges on screen
const view = { x: -fit.x / fit.scale, y: -fit.y / fit.scale, w: cssW / fit.scale, h: cssH / fit.scale,
  projectedHeight: 1536 * fit.scale, pixelWidth, pixelHeight };
avatar.prepareMotionFrame(now, reduceMotion);
const image = avatar.render(now, { viseme, intensity, speaking, blink, gaze, expression,
  head: companion.gesture(now, speaking, reduceMotion) }, view);
ctx.drawImage(image, ...);
consumeReaction(now);                                  // see avatar.html: takeReaction -> performAction
```

Screen-wide movement (walking to corners, close-up) needs a surface the size
of the display. This app grows its transparent window to the work area while
a clip or walk runs ("stage mode", `enterStage`/`exitStage` in `avatar.html`)
and shrinks back afterwards, keeping her on-screen size and position
continuous. If EnConvo renders the avatar inside its own window, the stage
surface is simply that window; the corner/close-up model
(`AvatarStudioStage`) works on any rectangle.

## 3. Assets and serving

Package layout (one folder per avatar, same as OpenClam):

```
manifest.json                 slug, name, renderer:"3d", pose, yaw, visemes[]
runtime/resident/model.gltf   split model; images carry extras.openclamVariants [{size, uri, compressed}]
runtime/resident/*.bin        meshes and rig
runtime/resident/image-N-{512,1024,2048,4096}.{png,ktx2}
runtime/motions/library.json  clips: id, label, file, category, duration
runtime/motions/*.json.deflate raw-deflate motion clips (inflate on the way out)
```

The renderer imports three.js by absolute path (`/vendor/three/...`) and
fetches the model and clips by URL, so it needs an http origin or a custom
scheme handler. Three serving rules matter (implemented in `electron/assets.cjs`
and the `/avatar/` branch of `electron/main.cjs`):

1. Serve `model.gltf` with `openclamVariants` filtered to files that exist
   locally; the renderer picks the largest variant at or below the requested
   size, so a missing 4K tier degrades instead of failing.
2. Inflate `*.json.deflate` to `*.json` when the plain file is missing
   (`zlib.inflateRawSync`).
3. Quality profiles: pass `performance: 'eco' | 'balanced' | 'quality'` to
   `avatar.load` and `options.select`; the resources module chooses tiers from
   the projected height.

Distribution: the release `assets-v1` holds `index.json` (catalogue with sizes
and sha256), `tia-bundle.zip` (the friendly 1K package), `<slug>-balanced.zip`
(2K images), `<slug>-best.zip` (4K images), `<slug>-base.zip` for non-bundled
avatars, and `<slug>-{1k,2k,4k}.glb` single-file models for iOS. The apps
refresh `index.json` at start so new avatars appear without an update.

Making a new avatar from a GLB: the renderer refuses motions unless the model
embeds `extras.openclamAvatar` with `rest` listing exactly the bones the
clips drive (157 Auto-Rig Pro deform bones for this clip set), plus `poses`,
`outfits` and `props`. `tools/inject-library.py in.glb out.glb clip.json
--poses-from tia.glb --outfits wardrobe.json` does that, fixes cornea
materials and rebinds unweighted vertices. Poses transfer between rigs with
the same bone names, which is how Sarah got Tia's 69 poses.

## 4. Prompt contract for Mavis (or any EnConvo agent)

The avatar reacts to what the model says, so the session instructions must
teach the model to announce motions in a fixed shape. Copy `liveInstructions()`
from `electron/main.cjs`; the essential parts:

- List the installed clip labels: "The app can play these installed body
  animations: Kung Fu Punch, Joyful Sway, ...". Build it from
  `library.json` at session start.
- "When the user asks you to perform one, say a natural affirmative intention
  that names the animation, such as 'Sure, I'll try a kung fu punch'. The app
  follows your spoken intention, not the user's words."
- Spatial vocabulary: sit down, stand up, wave, make a heart, walk around,
  run around, come closer, step back, walk to any corner, stay still. "The
  screen is a stage: top is farthest and smallest, bottom is nearest."
- Delegation policy: never delegate animation requests to the backend
  Responses model; answer them directly.

`replyAvatarAction(userText, replyText, suggestion, clips)` parses the reply
and returns `clip:<id>`, `action:<spatial>` or nothing; the
`CompanionController` gates it (not while dragging, not on top of a running
clip) and `takeReaction` hands it back when it may play.

Two GPT-Live details that cost a day here:

- Use `session.commentary.append` for anything the model should act on now
  (greeting, typed steering). `session.instructions.append` is absorbed
  silently and often produces no reply.
- Both transcript streams arrive on the data channel (WebRTC) or the socket
  (WebSocket); user transcripts are what let the avatar answer a request in
  the same turn.

## 5. Suggested integration plan

1. **Vendor the layer**: copy `web/avatar3d*.js`, `web/vendor/three/`, and
   the viseme functions from `web/avatar.html` into EnConvo; serve them and
   the avatar package from EnConvo's local server or scheme.
2. **Render harness**: a page or view that creates the avatar, loads Tia's
   package (`npm run fetch-assets` yields `build/assets/bundle/tia`), and runs
   the per-frame loop above with `speaking:false`. Check `avatar.motion.clips.size === 62`
   and play `kung-fu-punch` from a debug hook.
3. **Lip-sync**: route the GPT-Live playback audio through an `AnalyserNode`
   and feed visemes. Verify the mouth varies with speech, not only open/close.
4. **Reactions**: pipe transcript sentences into `companion.consider`; run
   `consumeReaction` each frame; add the prompt contract to Mavis's session
   instructions. Test by saying "do a kung fu punch".
5. **Stage**: decide the surface. Full-screen transparent window (this app)
   or in-app panel. Port `enterStage/exitStage/beginWalk/stepStudio/maintainStage`
   from `avatar.html`; keep the geometry refresh before the texture-swap skip
   (see the comment in `paint()`), or walks start from stale coordinates.
6. **Catalogue UI**: outfits, poses, props and motions come from
   `avatar.options` and `avatar.motion.clips`; see `avatarCatalogueMenu` in
   `electron/main.cjs` for the grouping.
7. **Tiers and other avatars**: reuse `electron/assets.cjs` (download with
   progress, sha256, unpack, overlay) or the iOS `AssetStore.swift`.

## 6. Gotchas we hit

- macOS hardened runtime needs `com.apple.security.device.audio-input`
  (`build/entitlements.mac.plist`); without it the mic prompt never shows and
  capture is silent while Chromium still reports "granted". EnConvo already
  captures audio, so this only matters if the avatar runs as its own app.
- Shipping as a separate app: `tools/dmg.sh` shows the unattended release
  chain (electron-builder signs and notarizes the app with an App Store
  Connect API key, then the DMG container itself is signed, notarized and
  stapled; an unsigned DMG is rejected by Gatekeeper even when its contents are
  notarized). `mac.notarize` and `dmg.sign` in `package.json` are the switches.
- Keep bubbles and overlays inside the *visible* part of the screen, not the
  window: a close-up can make the window larger than the display.
- The model draws her small at the far stage depth; cap corner destinations
  (`y >= 0.26`) and never shrink the resting window below the user's chosen
  size on stage exit.
- Near the camera the visible ground path is foreshortened; boost stride
  speed when `studio.depthScale() > 1` or close-ups crawl.
- Every live session costs about $0.05 per minute plus backend tokens. Add an
  auto hang-up (this app: 15 s when the avatar is not visible, 5 min of user
  silence) so a forgotten session cannot run all night.
- Test without paid sessions: expose debug hooks (`gla_play(id)`, `gla_debug()`,
  `gla_visibleBox()` in `avatar.html`) and drive the app over the Chrome DevTools
  protocol (`--remote-debugging-port`).

## 7. Reference: this app's own pieces, for orientation

- Mac: Electron 43; `electron/main.cjs` (windows, menu, assets, key store,
  GPT-Live session creation), `electron/preload.cjs` (bridge `window.gla`),
  `web/avatar.html` (renderer host), `web/live-client.js` (WebRTC live
  client, replaced by EnConvo's).
- iOS: SwiftUI + WKWebView with a `gla-avatar://` scheme handler
  (`AvatarWebView.swift`), `ModelResources.swift` (GLB to glTF + downscaled
  PNGs), `AssetStore.swift` (downloads), `LiveSession.swift` (WebSocket live
  client with native audio and a spectral viseme analyser,
  `SpeechVisemeAnalyzer.swift`).
- QA: `npm test` (syntax, IPC parity, reply parsing cases).
