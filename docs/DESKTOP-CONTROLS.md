# Desktop controls and Tia colors

Right-click the avatar, speech bubble or Listening label to switch installed avatars and choose a voice. Each voice has **Preview voice** and **Use this voice** actions. Settings provides the same preview and explicit apply controls; browsing voices does not change the saved voice.

## Bubble modes

- **Always On**: visible while idle, talking or moving.
- **Off**: automatic speech/task bubbles remain hidden. The small Listening/Muted indicator still reports an active microphone session. Explicitly choosing **Ask [name] to do something…** temporarily opens that avatar’s input bubble; closing it restores Off.
- **Only on Incoming Messages**: assistant transcript fragments reveal the bubble for nine seconds after the latest fragment. Animation, outgoing messages and status changes do not alter the timer. The message editor remains visible while focused.

The Listening indicator has a 16-pixel gap above the projected crown, increased from 10 pixels. It moves beside the head if there is insufficient room above.

## Ask from the overhead bubble

Right-click **Ask [name] to do something…** to type a request above that character. Try “Do a backflip” or “Help with files or the browser.” Click the microphone or double-click the head to start talking. Solo live-conversation text continues the current conversation; an idle typed request uses the selected action engine directly. Together typed requests go to the character whose bubble you opened, with the shared group history and verified task results.

Task updates and agent follow-up questions appear in the same bubble. Inputs remain visible while editing; the close button collapses the composer without canceling ongoing work. Use Stop task to cancel. Only the avatar and its visible controls intercept clicks; the rest of the desktop stays accessible.

The agent starting folder defaults to `~/Downloads`. It is the runtime’s working directory, not a limit on its file access. Settings can change it. The previous default `~/Desktop` migrates once; custom folders and later explicit choices are retained. Displayed home paths use `~`; the runtime still receives the real absolute path.

## Voice behavior

GPT-Live voices are selected when a session starts; changing the voice requires a new session. The app reconnects automatically, preserves mute state, and supplies recent user/assistant transcript messages as startup history. It does not repeat the greeting. This is a brief connection interruption, not a seamless audio swap; backend work in progress and older conversation context are not resumed.

Previews use the actual GPT-Live voice and require the saved API key. They create a short session driven by generated silence, without microphone capture, then close automatically. During a preview, live input and playback are temporarily silenced and restored afterward. The existing user mute preference is preserved. Previews incur normal GPT-Live session usage.

Reference: [Managing GPT-Live sessions](https://developers.openai.com/api/docs/guides/live-conversations).

## Motion and avatar changes

Affirmative replies such as “I'll do a little dance” resolve to an installed motion. Repeated transcript fragments from the same turn do not restart the dance. Named dances use their own clips. Explicit motions stop screen travel, and stale asynchronous actions cannot override a newer selection.

Each model has a package-specific URL so quick avatar switching cannot fetch another avatar's mesh or textures midway through loading. Superseded models are disposed, and each avatar's appearance remains separate.

## Tia's original colors

The appearance pack contains 87 original color maps in 17 groups. It uses the textures from `Tia-001.1_Blender.zip`, matched to the original Blender materials. Alpha channels come from the matching runtime materials so hair cards, lashes and cutout clothing retain their shapes. Geometry and existing Tia texture tier numbering are unchanged.

To rebuild after fetching/rebuilding the Tia package:

```sh
python tools/complete-tia-colors.py --textures /path/to/Blender/textures --package build/assets/bundle/tia
```

Requires Pillow. The pack includes source filenames and checksums in `appearance/source-audit.json`. These desktop menu and preview changes do not add iOS controls.

## Verification

- `npm test`: syntax/contracts, asset revision isolation, bubble states, dance intent and turn deduplication, voice history/reconnect/mute/cancellation.
- `npx electron qa/controls-app.cjs`: actual WebGL, all 87 restored texture bindings, native menu callbacks, movement, timed bubble behavior, rapid avatar changes, appearance persistence, both voice interfaces and indicator visibility. Uses an isolated profile and a fake speech transport.
- `npx electron qa/live-voices.cjs --live`: optional real service verification; requires credentials accessible to the runner's macOS key storage identity. It captures no microphone audio. For an installed signed build, perform the same preview/reconnect checks in that app's identity.

## Props, pinch and drag

Rifles and pistols keep their authored arm/hand transforms relative to the animated chest. Idle pose cycling pauses while a weapon is selected. Body/leg motion still plays; arm gestures retain the grip while carrying the prop. Prop extents are measured after optional geometry becomes resident. Each mesh is tracked through its own rigid attachment or per-bone skin bounds, including independent nested weapon rigs. Geometry-residency changes invalidate the cache. This applies to imported props without an authored holding pose as well. The renderer updates descendants before measuring, avoiding a stale first-frame measurement.

Equipping a prop expands the transparent host to the display work area. The viewport guard includes the prop, including its muzzle. Rendering is cropped to the body/prop region so empty desktop space does not reduce character resolution. Small render-size changes are rounded to 32-pixel steps to avoid continuous buffer reallocation.

Pinching updates the character scale on animation frames inside this stable host, instead of waiting for a pause and repeatedly resizing the macOS window. Hold-to-drag also accepts a deliberate movement before the hold timer expires, coalesces pointer movement per frame, and cleans up on release, cancellation, lost capture and window blur. Hit testing reads a small cached alpha mask instead of reading GPU pixels for every mouse event. Position changes are saved after movement settles; temporary display-size windows are never saved as the preferred avatar size.

After a close-up or a return to center, the first drag or pinch takes over from automatic positioning using the currently displayed size and position. Manual movement keeps the head reachable on screen. **⌘⇧0** (shown beside **Bring Avatar Back** in the menu) restores the captured upper-right placement and size, even when another app has focus. Placement is relative to the primary display's work area and scales down for smaller displays. `qa/placement-app.cjs` checks this full sequence in the actual renderer.

## Tia's facial rendering

The portrait renderer combines compatible hair sections for transparency ordering, uses softer head-volume shading, adds skin scattering/AO maps and shadows, and separates cornea reflections from the iris. Classic lighting restores the original material settings. The three additional smile/laugh expressions come from the original Blender asset. The custom jaw taper is disabled, restoring Tia's original jaw proportions while retaining the other improvements. Vowels use stronger articulation at small desktop sizes, with less extra opening in close-up. Closed-lip sounds and silence still close the mouth.

`qa/portrait-app.cjs` covers material restoration, texture changes, expression reloads, original open smiles, the absence of custom jaw narrowing, and lip closure. Visual comparisons against the product screenshot remain necessary: the real-time skin and hair still differ from the product render.

## Personal default appearances

`electron/default-appearance.json` captures the user's selected colors, outfits and accessories for all five avatars. Fresh installs select Sarah in **Tie top, chain pants & sandals** (`casual`), without the coat. Every character starts with no prop. Tia starts in Standing 6; the other initial poses retain the captured choices. **Restore default look** restores that avatar's captured look. **Original color** in each color submenu selects the source asset's base texture.

Current choices are stored per avatar in the main configuration file. They therefore survive a full restart even though the local server gets a different port. Existing local-storage values can migrate when available; this installation also restores the latest recovered settings from the previous app profile.

Additional verification:

- `npx electron qa/props-app.cjs`: actual WebGL for both avatars and guns, original grips across idle/heart/sit/dance, full prop bounds, native pinch input, drag after pinch, release cleanup, compact window movement and write coalescing, and default appearance restoration. Compact dragging uses a controlled pointer stream because Electron's input injection does not hold the physical macOS mouse button during native window movement.
- `npx electron qa/appearance-restart.cjs`: launches a second process against the preceding isolated test profile to verify both looks and compact size survive a complete restart.


## Delegate mode

Right-click **Reasoning** to choose Codex App Server, OpenClaw, Hermes, Grok Build or EnConvo for reasoning. **Actions & Permissions** contains action-provider choices and their own saved permissions. Actions follow reasoning by default; an explicit override stays independent. For direct API/OAuth reasoning, open **Settings → Reasoning** to choose OpenAI or xAI and API key or OAuth2 account sign-in. OpenAI additionally offers **Codex App Server**, which reuses the installed Codex account without a separate avatar-app login. GPT-Live reasoning remains available; this is voice-model reasoning, not a built-in action engine. All enabled external actions use a native agent. The OpenAI defaults are `gpt-5.6-luna` for API keys and `gpt-5.6-sol` for OAuth2; xAI starts with `grok-4.6`. Codex App Server's Account default uses Luna for Codex API-key accounts or Sol for ChatGPT accounts. Model choices are stored separately for each provider/authentication combination. The connection test makes a short real model request.

GPT-Live voice and previews continue to use the existing OpenAI API key. The selected connection handles delegated reasoning. Mode/provider/model changes reconnect an active Live session, retaining recent transcript context and mute state. Codex App Server also supplies enabled actions in solo and Together using the same selected model; its model list comes from the local Codex engine. With actions disabled, it uses a restricted reasoning-only thread. See [Codex actions](CODEX-ACTIONS.md). Direct API/OAuth reasoning does not import OpenClaw's tools.

The client collects input/output transcripts, including unfinished input segments, since `session.delegation.created` contains an ID but no question. It sends bounded context to the selected provider and returns final text with the original delegation ID. New turns, stopping, reconnecting, changing providers and closing windows cancel obsolete work. Commentary is split on Unicode boundaries with a conservative UTF-8 byte ceiling below the API’s 500-token append limit.

Direct API/OAuth credentials remain in the Electron main process, encrypted by macOS-backed Electron safeStorage in `delegate-credentials/`. OAuth refresh tokens, access tokens, PKCE verifiers and xAI device codes are never included in renderer settings. Direct sign-in uses a fresh app-owned credential; existing OpenClaw/OpenClam credentials are not imported. Refresh is single-flight, preserves an omitted rotated refresh token and cannot restore a credential after sign-out. Protected requests use fixed HTTPS destinations with redirects rejected. Codex App Server instead leaves credentials with Codex and connects over local stdio. Neither OAuth nor Codex App Server silently falls back to a stored API key.

References checked September 13, 2026:

- OpenClaw installed, current stable and skill reference: all **2026.9.4**. The OpenAI public-client PKCE flow uses `auth.openai.com`, a state-checked loopback callback on port 1455, and automatic refresh. Inference uses the ChatGPT Codex Responses endpoint, account-ID header, `store: false`, streaming and the supported parameter subset.
- OpenClam’s `server/xai_oauth.py` and `server/providers.py`: Grok Build-compatible device authorization, the public Grok client identity, renewable credentials, and the separate OAuth inference proxy. Compatibility headers match its Grok Build 1.0.4 contract; provider changes can require an update.
- [OpenAI Live delegation](https://developers.openai.com/api/docs/guides/live-delegation).
- [OpenAI authentication](https://learn.chatgpt.com/docs/auth).
- [xAI authentication and inference routing](https://docs.x.ai/build/enterprise).
- [Grok Build public OAuth configuration](https://github.com/xai-org/grok-build/blob/eb267feff13129e568df38fb6fdf0ceb65f735d6/crates/codegen/xai-grok-shell/src/auth/config.rs).

Additional verification:

- `node qa/delegate.cjs`: defaults, model persistence, real loopback PKCE/state checks with simulated provider responses, xAI polling/host checks, cancellation and refresh races, four inference wire contracts, split SSE frames, error redaction, transcript handoff and Unicode append limits.
- `npx electron qa/delegate-app.cjs`: real Settings UI, native menu, IPC, SDK session setup, input transcript handoff, matching delegation reply ID and mode reconnection. Provider responses and WebRTC are simulated.
- `npx electron qa/delegate-live.cjs --live`: opt-in actual OpenAI model and voice handoff; uses a generated spoken question through WebRTC, never the hardware microphone. Account OAuth inference requires an actual user sign-in and is not proven by simulated-authentication tests.

The compact Listening pill has a soft 3.4-second breathing microphone halo. It stops while muted, speaking or hidden and respects Reduce Motion. Click it to expand the conversation; the avatar body is not animated to indicate listening.

## Face close-up and customizable shortcuts

**⌘⇧9** opens a centered face close-up, using the current appearance. **⌘⇧0** returns to normal size at the default upper-right position. In Together, click a character first; close-up uses that character, and recovery restores the group. The character’s appearance and voice are unchanged.

Settings → **Keyboard shortcuts** lets you record a combination for either action. Escape cancels recording. Conflicting combinations are rejected without losing the previous shortcuts. **Restore default shortcuts** restores ⌘⇧0 and ⌘⇧9. The chosen shortcuts appear in the right-click and View menus and remain available while another app is focused.
