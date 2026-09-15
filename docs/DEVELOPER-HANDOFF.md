# Independent development handoff

For an authorized coworker making feature changes to GPT-Live Avatar while
continuing to use the existing protected avatar download service. No owner
Cloudflare login, Blender originals or private release keys are needed.

If you are integrating the avatar layer into **EnConvo**, start with
[ENCONVO-HANDOFF.md](ENCONVO-HANDOFF.md). It separates reusable rendering/audio
components from the account, voice and agent systems EnConvo already owns.

Updated September 15, 2026 for **v0.2.13**. Use the matching
[release page](https://github.com/tivojn/gpt-live-avatar/releases/tag/v0.2.13)
to confirm Apple Silicon installer availability and checksums. Use the release
tag and matching checksums for a reproducible reference.

## First successful run

Use an Apple Silicon Mac (M1 or newer) with macOS 14 or newer, Git and a current
Node.js LTS with npm. Node 22.12.0 or newer is required by Electron.

1. Confirm availability on the matching release page, then download the official
   signed v0.2.13 installer:
   https://github.com/tivojn/gpt-live-avatar/releases/download/v0.2.13/GPT-Live.Avatar-0.2.13-arm64.dmg
2. Copy **GPT-Live Avatar.app** into Applications. Launch it while online and
   confirm Tia appears. This is also the reference app for comparing changes.
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

`import-release` verifies the signed catalogue and Tia's full SHA-256 checksum.
It imports only these **already shipped** resources:

| From the installed app's Contents/Resources | In the clone |
| --- | --- |
| assets-runtime.json | build/protected/assets-runtime.json |
| assets-index.json | build/protected/index.json |
| avatars/tia/base.gla | build/protected/starter/tia/base.gla |
| avatars/tia/motions.gla, when present in the signed catalogue | build/protected/starter/tia/motions.gla |

It also links the encrypted starter and its declared motion overlay into
`build/assets/bundle/tia` so the
unpackaged development app can display Tia. Files stay encrypted and ignored by
Git. The command is safe to rerun with identical resources and refuses to
replace different ones. For a different release, use a fresh clone or back up
and move conflicting imported files before importing again.

`start:isolated` uses `build/dev-profile` for its settings, downloads and locally
protected credentials. It does not use the normal installed app's profile or
inherit the owner's voice-key environment variable. Close the development app
before restarting it after source changes. No npm compile step is needed for
ordinary Electron/HTML/JavaScript edits.

## Accounts and additional characters

- Tia is included; her first unlock needs internet. No voice key is needed just
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

Right-click → **About GPT-Live Avatar** shows the installed version and bundled
description; **Check for Updates…** queries this repository's published releases
on demand. It opens the official download and does not auto-install. If you
distribute a separate app/fork, update `electron/releases.cjs` and
`electron/release-info.json` for your own release destination and description;
an EnConvo integration should use EnConvo's updater. Keep the R2 asset service
configuration separate from the app-update destination.

## What to test before handing back changes

1. `npm test` passes. It uses generated fixtures; no original Blender files,
   API key or live microphone is needed.
2. Start with a fresh `--user-data-dir` and confirm bundled Tia unlocks and
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
- **Motions:** use `meshy-v11-20260915` on all five avatars. The bake corrects
  anatomical pelvis alignment, including secondary character retargeting, and
  Ming-Mei/Iselda’s spine aliases. It retains the established in-place spin,
  foot articulation and stable framing. The library still contains 65 clips per
  character. See [Motion audit](MOTION-AUDIT.md) for measured scope.
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
