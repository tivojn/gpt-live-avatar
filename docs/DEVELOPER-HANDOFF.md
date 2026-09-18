# Independent development handoff

For an authorized coworker making feature changes to GPT-Live Avatar while
continuing to use the existing protected avatar download service. No owner
Cloudflare login, Blender originals or private release keys are needed.

If you are integrating the avatar layer into **EnConvo**, start with
[ENCONVO-HANDOFF.md](ENCONVO-HANDOFF.md). It separates reusable rendering/audio
components from the account, voice and agent systems EnConvo already owns.

Updated September 18, 2026 for **v0.2.23**. Use the
[release page](https://gpt-live-avatar-downloads.gpt-live-avatar-downloads.workers.dev/releases/)
to confirm Apple Silicon installer availability and checksums
(`releases/latest.json` on that host is the machine-readable record). Use the
release tag and matching checksums for a reproducible reference.


## After 0.2.23: grouped menu, Settings panes, one monochrome theme

- **Right-click menu.** Both windows build the same groups from
  `electron/avatar-menu.cjs`: talk and Ask… on top; Perform, Look, Character,
  Agent and View in the middle; Avatar Show, Settings, updates, the installed
  version and Quit at the bottom. About is folded into the updates window.
- **Settings** is a sidebar of panes (Voice, Character, Appearance, Reasoning,
  Actions, Agents, Instinct, Shortcuts and tips) instead of one page five
  screens long. Every control kept its `id` and wiring; each pane carries a
  one-line status chip mirrored as a dot in the sidebar; paths and overrides
  sit in Advanced drawers; the per-character agent table shows only the active
  engine's column; the installed-packs drawer opens by itself when something
  needs downloading. `openSettingsWindow('reasoning'|'actions'|…)` and
  `gla.openSettings(pane)` deep-link to a pane; `window.gla_settings_pane`
  switches panes for QA.
- **One theme.** `web/theme.css` holds the palette for Settings, the Avatar
  Show panel and prompter, the bubbles, the composer and the updates window.
  It is monochrome by design and follows the macOS appearance: status is a
  shape (filled dot, ring, outline) and a weight, never a hue. Do not add
  colour tokens elsewhere; `qa/theme-app.cjs` opens the real windows in light
  and dark and fails on any computed colour with saturation, on text and
  surfaces that do not flip, and on a Settings pane that no longer fits.
- Seraphim's Enclosed and Heavy armors are retired on read; superseded R2
  packs are removed with `tools/cloud/prune-r2.cjs` (see Protected assets).

## 0.2.23 QA pass, new motions, sing-along retired

A full test-engineering pass: 27 fixes (Show cost and recording leaks first),
the header Record light, captions during gestures, bubble-off-during-motion
with restore, seven new motions for every character, the outer-hip corrective
for the kung-fu stance on Sarah and Seraphim ([Hip corrective QA](HIP-CORRECTIVE-QA.md);
both ship in motion revision `hip-corrective-20260918`) and the removal of
sing-along. Results, method and open
items: [Test report](TEST-REPORT-0.2.22.md).

## 0.2.22 Avatar Show update

Live voice steering through gpt-live-1, audience notes, pause/resume, MP4
recording, the panel as the window and the shared bubble theme. See
[Avatar Show](AVATAR-SHOW.md).

## 0.2.21 EnConvo engine

EnConvo (Mavis and custom agents) is a reasoning and action engine through
its local API, with a per-character agent column. See
[Agent runtimes](AGENT-RUNTIMES.md).

## 0.2.20 Instinct update

Optional TypeSafe Jev integration (Settings → Instinct): motions start
mid-sentence, clips are chosen by meaning, and 21 facial expressions respond
while the user speaks and while she speaks, in any language. Without a key
the built-in rules decide as before. Design, measurements and tests:
[Instinct](INSTINCT.md).

## 0.2.19 music, input and deformation update

- Right-click → Perform → **Dance Along to Current Song** or **Stop** in solo or
  Together (sing-along was retired in 0.2.23: lip-syncing to another app's
  music never matched the quality of her own voice; a sing-along request now
  dances along and says so). Together uses the clicked
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

## First successful run

Use an Apple Silicon Mac (M1 or newer) with macOS 14 or newer, Git and a current
Node.js LTS with npm. Node 22.12.0 or newer is required by Electron.

1. Confirm availability on the release page, then download the official
   signed installer for the current version:
   https://gpt-live-avatar-downloads.gpt-live-avatar-downloads.workers.dev/releases/
   (installers are served as
   `releases/gpt-live-avatar-<version>-arm64.dmg` on that host; v0.2.21 and
   earlier were published on GitHub releases, which the private repository no
   longer exposes).
2. Copy **GPT-Live Avatar.app** into Applications. Launch it while online and
   confirm Sarah appears in her tie top, chain pants and sandals, without a coat. This is also the reference app for comparing changes.
3. Clone the source and create your own branch:

```bash
git clone https://github.com/tivojn/gpt-live-avatar.git
cd gpt-live-avatar
git switch -c codex/coworker-feature
npm ci
npm run import-release -- "/Applications/GPT-Live Avatar.app"
npm test
npm run start:isolated
```

`import-release` verifies the signed catalogue and Sarah's full SHA-256 checksum.
It imports only these **already shipped** resources:

| From the installed app's Contents/Resources | In the clone |
| --- | --- |
| assets-runtime.json | build/protected/assets-runtime.json |
| assets-index.json | build/protected/index.json |
| avatars/sarah/base.gla | build/protected/starter/sarah/base.gla |
| avatars/sarah/motions.gla, when present in the signed catalogue | build/protected/starter/sarah/motions.gla |

It also links the encrypted starter and its declared motion overlay into
`build/assets/bundle/sarah` so the
unpackaged development app can display Sarah. Files stay encrypted and ignored by
Git. The command is safe to rerun with identical resources and refuses to
replace different ones. For a different release, use a fresh clone or back up
and move conflicting imported files before importing again.

`start:isolated` uses `build/dev-profile` for its settings, downloads and locally
protected credentials. It does not use the normal installed app's profile or
inherit the owner's voice-key environment variable. Close the development app
before restarting it after source changes. No npm compile step is needed for
ordinary Electron/HTML/JavaScript edits.

## Accounts and additional characters

- Sarah is included; her first unlock needs internet. No voice key is needed just
  to display or manipulate her. Download other characters in Settings → Avatar.
- Voice and Together talk need **your own OpenAI API key with GPT-Live access**.
  OpenAI account sign-in for reasoning does not replace the voice key.
- To use Codex for both reasoning and actions, install/sign in to Codex, choose
  Settings → Reasoning → Delegate mode → OpenAI → Authentication → Codex App
  Server, and Check Codex connection. Enable actions below. The same model serves
  solo and Together; a separate OAuth sign-in in the avatar app is unnecessary.
  Browser/computer tools need your own connected setup and macOS permissions.
- Codex permissions default to Full access. You can choose Ask for approval or
  Approve for me in Settings or the avatar's right-click menu.
- OpenClaw, Hermes and Grok Build are alternative reasoning/action engines in the reference app.
  Install and configure the chosen runtime with your own account; the avatar
  installer does not bundle it. Select its provider in Reasoning, enable
  actions, then choose native agents/profiles in **Agents for each character**.
  Missing runtimes are disabled. With direct API/OAuth reasoning, the action
  engine can be selected separately. See [AGENT-RUNTIMES.md](AGENT-RUNTIMES.md)
  for setup, Hermes OpenAI OAuth2, profile routing and native permission limits.
- The old built-in file/browser action engine has been removed. Browser/computer tools and file permissions belong to the selected external runtime. Right-click **Delegate Reasoning Provider** for reasoning. **Action Engine & Permissions** controls the effective action engine and its permissions. Following reasoning is the default; an explicit action-engine selection stays independent.
- Native agents, Hermes profiles and account sign-ins are not shipped in this
  repo or DMG. The owner's locally configured Hermes `tia` profile is an example,
  not an account your clone inherits. Ordinary visual feature work needs none
  of these runtimes.

See [Codex actions](CODEX-ACTIONS.md) and
[Together conversations](GROUP-CONVERSATIONS.md).

For the rendering changes and v0.2.13 follow-up, see [Studio lighting](STUDIO-LIGHTING.md),
[Wardrobe audit](WARDROBE-AUDIT.md) and [Motion audit](MOTION-AUDIT.md).

### Usage costs

The local Codex app-server connection has no separate connection fee. Codex
tasks authenticated with ChatGPT consume that account's subscription allowance;
API-key authentication uses separately billed API usage. Subscription limits
still apply, and additional credits or third-party services can cost extra.
See [Codex authentication](https://learn.chatgpt.com/docs/auth) and
[usage limits](https://learn.chatgpt.com/docs/pricing).

GPT-Live voice uses the app's API key. As of September 15, 2026, the rate is
$0.05 per connected session-minute, billed per second. Together opens one
session per character: five connected characters are approximately $0.25/minute
or $15/hour for voice alone, even when they take turns speaking. Group human
input also uses the separately billed `gpt-4o-mini-transcribe` API. API-key
reasoning backends and paid external tools are additional. Stop live talk to end
the voice sessions; muting the microphone does not disconnect them.
See [GPT-Live pricing](https://developers.openai.com/api/docs/models/gpt-live-1).

## Keep the current R2 connection

Keep `electron/asset-download.json`, the protected loader and the imported
runtime configuration/catalogue compatible. Ordinary UI and behavior changes,
app version changes and your local build do not require a new bucket or Worker.
The existing gateway checks the download token; it does not require the
original Apple signing identity. A new profile obtains its own locally stored
unlock keys through that gateway.

Do **not** run `build-protected-assets`, `tools/cloud/deploy.cjs`,
`tools/cloud/upload-r2.cjs` or rotate keys for feature-only work. Those are
maintainer publishing operations, not developer setup. Do not commit imported
resources, raw models, runtime download tokens, personal profiles or credentials.
Do not request the owner's Cloudflare administration token, private-build.json,
model content keys or Apple signing credentials.

The shared gateway has a hard daily request cutoff. If it is unavailable or
returns a limit error, leave the configuration intact and retry later. This
workflow downloads existing content; it never creates billable cloud resources
or uploads duplicate models. See [protected delivery](PROTECTED-ASSETS.md).

## Build a local test app or DMG

```bash
npm test
npm run pack:local       # unsigned local .app in dist/mac-arm64/
# Or, when you need a local installer:
npm run dmg:local        # unsigned, unnotarized local DMG in dist/
```

These commands explicitly disable Apple identity discovery and notarization, so
they do not need the owner's Apple account. Local outputs are for development;
they do not have the official release's Gatekeeper acceptance. Test a local app
with a separate profile to avoid replacing normal app settings:

```bash
"dist/mac-arm64/GPT-Live Avatar.app/Contents/MacOS/GPT-Live Avatar" \
  --user-data-dir="$PWD/build/packaged-test-profile"
```

A publicly distributed signed/notarized release needs the responsible
publisher's own Apple Developer ID and notarization setup. `npm run dmg` is the
maintainer signing workflow; do not use it expecting the owner's credentials to
exist. A source branch or local build does not automatically publish a GitHub
release. Push your branch and open a PR if you have repository access; otherwise
use your own fork. The 3D asset licenses are separate from source-code rights.

The right-click menu shows the installed version as a row of its own; the
window behind **Check for Updates…** carries the bundled description that
About used to show. Both windows build the same groups (Perform, Look, Agent,
View) from `electron/avatar-menu.cjs`. **Check for Updates…** reads `releases/latest.json` from the
release service on demand (the same Worker host as `electron/asset-download.json`,
public routes under `releases/` only) and falls back to the GitHub releases API
only when that service cannot be reached. It opens the official download and
does not auto-install. Publishing is `node tools/cloud/publish-release.cjs`
(see [PROTECTED-ASSETS.md](PROTECTED-ASSETS.md), "Publishing an installer").
If you distribute a separate app/fork, update `electron/releases.cjs` and
`electron/release-info.json` for your own release destination and description;
an EnConvo integration should use EnConvo's updater.

## What to test before handing back changes

1. `npm test` passes. It uses generated fixtures; no original Blender files,
   API key or live microphone is needed.
2. Start with a fresh `--user-data-dir` and confirm bundled Sarah unlocks and
   renders. Check Settings opens without a voice key. Do not delete your normal
   app profile to simulate a new user.
3. In the development/test profile, download a second character and verify it
   renders. Restart and confirm the downloaded character remains available.
4. Exercise the feature you changed in solo and Together where relevant.
   Check right-click controls, drag/resize, transparency, task progress and
   addressed-character routing. Live tests need your own account and may incur
   its normal API usage.
5. Keep source changes separate from assets and credentials. Run `git status`
   before committing. Report your macOS version, hardware, tested features and
   any remaining issue; do not claim another machine was tested.

Useful entry points: `electron/main.cjs` (desktop windows/settings),
`web/avatar.html` (solo UI), `web/group.js` (Together),
`electron/codex-agent.cjs` (Codex tasks), `electron/agent-permissions.cjs`
(permissions), `electron/runtime-agents.cjs` / `electron/acp-agent.cjs`
(OpenClaw/Hermes/Grok tasks and native agent assignments), `electron/app-info.cjs` (version and
updates), and `web/agent-progress.js` (overhead task updates).

## Changes in 0.2.11

- Settings → Keyboard shortcuts records custom combinations. Defaults: **⌘⇧0 Bring Avatar Back**, **⌘⇧9 Avatar Close-up**. Together uses the last clicked character; recovery restores the group. Conflicts preserve the previous shortcuts.
- 54 Meshy presets were baked with source amplitude and initial body orientation, including three additions: Backflip, 360 Power Spin Jump and All Night Dance. The library now contains 65 clips per character. No mesh, skin, material or wardrobe data changed.
- Updated motions ship in encrypted `motions.gla` overlays. The signed catalogue’s optional `motionUpdate` field keeps old model/texture packages available. Fresh avatar downloads fetch the overlay; the Tia starter includes it. See [motion audit](MOTION-AUDIT.md) and [protected assets](PROTECTED-ASSETS.md).


### Historical 0.2.12 renderer and asset changes

These describe the earlier release. Sarah’s v8 panel and the v10 motion bake are
superseded by the v0.2.13 changes below; retain this section as release history.

- Keep `web/avatar3d-cloth-occlusion.js` with the renderer dependency tree. It provides a garment-only depth pass for Sarah's Brazilian outfit and Iselda's skirts. This pass runs only while a supported garment is visible. Body bounds and a depth limit prevent rear cloth or hands from erasing exposed skin.
- Sarah's `sarah-wardrobe-v8` package includes a smooth pelvis-supported Brazilian panel. Iselda's `iselda-wardrobe-v9` includes corrected standing-pose leg alignment and skirt support. Both keep their original materials and wardrobe choices. Use the new signed base/texture/motion combination; do not overlay old tiers.
- Idle pose transitions default on for all five characters and Together uses the saved preference. Explicit pose selections and prop modes retain their existing controls.
- Ming-Mei's eyebrow material restores its missing brown tint. Armor outfits restore the clothed pilot and lock head direction to the helmet while allowing eye movement.
- See [motion audit](MOTION-AUDIT.md) and [wardrobe audit](WARDROBE-AUDIT.md) for scope, reproducible checks and limitations. Physical M2/16 GB acceptance remains a host integration test.

### 0.2.13 visual and motion corrections

- **Head attachments:** keep `web/avatar3d-head-attachments.js` and its hooks in
  `avatar3d.js` and `avatar3d-options.js`. Ming-Mei and Iselda export independent
  hair spline roots beside the head. The module applies the additional
  procedural head transform to those roots, restoring their full authored
  matrices before the next pose or motion frame. Baked hair animation remains
  part of the authored pose layer.
- **Deep zoom:** keep `web/avatar-zoom.js` with both solo and Together controls.
  Continued pinch/wheel zoom uses a camera crop after the native surface reaches
  its display bounds. Zoom can pass a face close-up to eye detail; a finite
  numerical guard prevents invalid math. Pointer anchoring, crop panning and
  aspect changes stay coordinated. Render surfaces and texture budgets remain
  bounded. Defaults remain **⌘⇧9** for close-up and **⌘⇧0** for recovery.
- **Lighting:** Studio/Soft receive a restrained key/fill and catchlight
  adjustment. The existing four lights, one shadow map and rendering budgets
  remain the same. The v0.2.12 calibration is the rollback reference; see
  [Studio lighting](STUDIO-LIGHTING.md).
- **Motions:** use `show-20260916` on all five avatars. It keeps the
  `meshy-v11-20260915` bake (anatomical pelvis alignment, secondary character
  retargeting, Ming-Mei/Iselda’s spine aliases, in-place spin, foot
  articulation and stable framing) and adds the theatre set for Avatar Show:
  78 clips per character. See [Motion audit](MOTION-AUDIT.md) for measured scope.
- **Sarah:** use the new immutable `sarah-wardrobe-v9` asset combination. The
  derived body has a localized internal-component/topology and skin-weight
  repair; original vertex positions remain intact. New body-fitted underwear
  shares the outer body surface and lower-body morphs. Both dresses include
  the brief; summer retains its native low-rise cut and ties. The dresses keep
  their authored weights with a small garment clearance. Preserve the runtime
  fit, visibility, morph and depth-layer hooks together with the revised assets.
- **Ming-Mei:** `web/avatar3d-mingmei-fit.js`, called by `fitGarment`, matches the
  fitted dress back to nearby body skin weights with up to 9 mm of clearance.
  It runs once per loaded geometry, including after wardrobe eviction/reload.
  The body and authored lace transparency stay intact. This is runtime-only;
  it requires no replacement Ming-Mei model or texture package.

Only the Sarah wardrobe and revised motion overlays need new protected content
for this follow-up. Feature-only development still uses the published catalogue
and protected loader; do not rebuild assets or rotate delivery keys. Maintainers
must publish matching signed base/texture/motion revisions rather than mixing
old Sarah tiers with the v9 base. The maintainer’s reproducible surface-repair
tool is `tools/repair-sarah-underlayer.py`; ordinary UI/agent integration does
not need to run it.

### Reproducing the visual checks

`npm test` includes the pure zoom checks. These additional Electron harnesses
need the licensed local prepared packages under `build/characters/`. These are
maintainer asset checks; a clone bootstrapped only from encrypted release
resources can run `npm test` and the isolated app checks instead. Do not obtain
private source assets or release keys merely to run these harnesses:

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

Native deep-zoom checks pass beyond the prior face/body cutoff with bounded
render surfaces and recovery. Head-attachment checks pass 200 alternating
frames plus authored motion/pose changes; maximum matrix error is about
1.11e-15 and GL error is zero. Lighting checks cover all five avatars and all
quality profiles, retaining camera alignment and four light sources. The
[previous calibration](https://github.com/tivojn/gpt-live-avatar/commit/e08ccab13f2cecf5a3df80a0f9a8dd3e187647b8)
is the explicit visual rollback point.

Ming-Mei’s opaque-back check passes 32 motion/angle samples with no exposed
panel pixels, including actual wardrobe unload/reload and Eco/Quality changes.
Motion support passes 2,910 frames on all five avatars; separate continuous
posture QA passes 30 scenarios and 18,250 rendered frames. Detailed accepted QA
results and remaining limits are in the wardrobe and motion audits. These are
local renderer checks; physical M2/16 GB testing, a complete EnConvo integration
and every possible outfit/animation combination require their own acceptance.
The app uses garment-specific fitting and depth layers, not general cloth
simulation.


### 0.2.14 overhead input follow-up

The fullscreen Ask dialog is removed. `web/agent-client.js` now owns only task routing, per-character progress, cancellation and inline questions. The composers live in the existing overhead bubbles in `web/avatar.html` and `web/group.js`. Reuse those surfaces for EnConvo input and route their requests to EnConvo’s own agent system; do not create an extra modal window. Group typed requests share conversation history and verified results while retaining the chosen character.

`electron/agent-folder.cjs` supplies the `~/Downloads` working-folder default and a one-time migration of the former Desktop default. `web/path-display.js` shortens the current user’s home path for display without changing execution paths. This update uses the same protected v0.2.13 avatar catalogue; no new model download is needed.


### 0.2.15 Sarah starter default

Fresh profiles select Sarah. Her default outfit is **Tie top, chain pants &
sandals** (`casual`), with no coat or prop. `electron/default-appearance.json`
retains her selected pose, colors and accessories; **Restore default look**
applies that look. Later user appearance choices remain separate from defaults.

The installer embeds Sarah’s existing 579,546,579-byte encrypted base and
53,459,437-byte matching motion overlay. The R2 catalogue and hosted packages
are unchanged; no asset repack or new upload is needed. Tia remains available
from Settings → Avatar. Earlier release sections above describe their original
Tia starter and remain as history.

### 0.2.16 Avatar Show · Playwright & Director

The Together window is now **Avatar Show · Playwright & Director** (menu item,
window title, `web/group.html`). Its default format is *Put on a show*; the
earlier free conversation remains as *Improvise together*.

- `electron/show.cjs` registers the `gla:show:*` IPC (Playwright, text
  Director, live Director session, motion pipeline status, generation and
  cancel); `electron/show-script.cjs` is the pure casting, brief, parser and
  cue-sheet module; `electron/show-motions.cjs` drives
  `tools/show-motion.py` (Meshy text-to-motion → `tools/show-motion-facing.py`
  facing gate → `tools/retarget-meshy-motion.py` → library integration for all
  installed characters, backups under `build/show-motions/backup`).
- Renderer: `web/show.js` (Director chat, preparation, prompter, revision),
  `web/show-player.js` (line-by-line performance with standby takeover),
  `web/show-director.js` (persistent GPT-Live Director session),
  `web/show-cues.js` (spoken cue phrases, English and Chinese).
- Custom motions need `~/.config/gpt-live-avatar/show-motion.json`:
  `{"meshyApiKey","rigTaskId","blender","uv","blend","python","donor"}`.
  `GLA_SHOW_MOTION_CONFIG` overrides the path (QA points it at a missing file
  so tests never spend Meshy credits). Without a usable configuration the
  Director reports the problem and substitutes the script's fallback motion.
- QA: `qa/show.cjs` (pure modules, in `npm test`), `qa/show-app.cjs`
  (Electron flow with stubbed reasoning: briefing, cue, script, prompter, pass,
  standby, revision, replay), `qa/show-live.cjs --live` (real reasoning,
  voices and, when the script asks, the real Meshy pipeline; writes a review
  video under `build/qa-show-live`).
- Bundled dev characters gained two Director-made *Show* clips
  (`applause-cheer`, `juggle-invisible`); installed app characters receive new
  clips only through a protected-asset release.
