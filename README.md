# GPT-Live Avatar

[Download the signed and notarized Mac installer](https://github.com/tivojn/gpt-live-avatar/releases/latest).
Open the DMG, copy GPT-Live Avatar to Applications, and launch it. Encrypted Tia
is included; the first launch needs internet for a brief unlock.

## Getting started from a clone

**Coworkers and AI coding assistants: start with [the independent development handoff](docs/DEVELOPER-HANDOFF.md).** It covers using the existing R2 service, running feature changes with isolated settings, and building without the owner's Apple credentials.

The renderer and application code are public. Purchased character assets are
separately licensed and must not be redistributed as raw models or texture ZIPs.
Install the official Mac app first, then:

```bash
npm ci
npm run import-release -- "/Applications/GPT-Live Avatar.app"
npm test
npm run start:isolated
```

The import command verifies and reuses only the encrypted client resources
already included in the release. These remain ignored by Git. No Cloudflare
login or owner API keys are required. Use your own voice and Codex accounts.

The Mac release uses protected downloads from a private Cloudflare R2 bucket.
The installer includes an encrypted Tia base package and the signed catalogue.
First launch briefly connects to unlock Tia; subsequent launches work offline.
Choose other characters in **Settings → Avatar**, download their base packages, then
optionally add Balanced (2K) or Best (4K) textures. All five current characters
retain their wardrobe, colors, props, expressions and motion libraries.
Downloaded packages remain encrypted on disk. Content keys are delivered to the
app separately and stored using macOS secure storage; they are not in the
source repository or public installer. See the
[protected asset deployment guide](docs/PROTECTED-ASSETS.md) for the build,
storage cap, traffic limits and protection boundaries.

Older installers and the legacy iOS downloader use the retired raw-file format.
Existing local packages still work. The iOS source requires a protected-loader
port before a new public iOS release; its old GitHub download URLs are not a
supported distribution path.

## Together live conversations

Right-click an avatar and choose **Bring Characters Together**. Each character
keeps independent drag, pinch, rotation and right-click controls. Transparent
spaces let clicks reach the app underneath. Drag the Together title bar, resize
its bottom-right corner, or minimize it to a title bar while talk continues.

The five characters start with feminine voices; voice choices are saved per
character. Speech is indicated by the overhead wave and highlighted name,
without a body shake or speech-driven camera zoom. With actions enabled in
Settings, a human's spoken or typed file/page request uses the same real tools
as solo mode. Address a character by name; it reports the verified outcome.
All participants share the dialogue and verified file results. For example,
ask Tia to create a file and Sarah to delete “that file”; removal uses the
Mac's recoverable Trash. A greeting such as “Hi Tia…” selects Tia and keeps
follow-up replies with her until you address someone else. Say “Everyone,
continue the conversation” to return to the roundtable.
See [shared context and live input](docs/GROUP-CONVERSATIONS.md) for details.

For shell commands, code execution, file editing, screenshots and connected
browser/computer tools, choose **Codex** as the action engine in Settings.
Both solo and Together use the real installed Codex engine and its account.
See [Codex actions and setup](docs/CODEX-ACTIONS.md).

## Avatars and texture tiers

The updated local Mac portrait build includes Tia's original 2K/4K maps,
authored lighting environment and 4K color variants. Best selects these
installed originals; Balanced and Friendly retain smaller texture budgets.
Rebuild that package with `tools/complete-tia-colors.py --textures <original textures>
--package build/assets/bundle/tia --resident <matching original resident folder>
--environment <studio.rgba16f>` after the base asset build. Use
`tools/export-tia-lighting.py` in Blender to convert the original lighting EXR.
`qa/portrait-app.cjs` verifies the real renderer, quality transitions and timing.
`tools/export-tia-expressions.py` restores three original open-mouth expressions
as GPU position/normal morphs. It also exports a separately identified custom
jaw refinement, now disabled to retain Tia's original jaw proportions. Run it in Blender
against the original `.blend` with `-- --package build/assets/bundle/tia` after
building the appearance pack. The source file is never saved by the exporter.

Pipeline (`tools/`):

- `build-assets.py <openclam avatar dir> <slug>`: bundle package, tier zips,
  iOS 1K/2K/4K GLBs, catalogue entry (`build/assets/`).
- `inject-library.py in.glb out.glb [clip.json]`: embeds the `openclamAvatar`
  options library (rig bones the motion clips drive), fixes cornea materials
  and rebinds unweighted vertices; needed for models not built by OpenClam.
- Sarah comes from the Auto-Rig Pro Sara blend
  (`~/Downloads/Sara-003_ARP3`), exported headless with Blender
  (materials flattened to Principled BSDF, hair bound to the head bone), then
  `inject-library.py`, OpenClam's `avatar_resources.py` for the resident
  texture tiers, and `build-assets.py`.
- Sarah's complete original wardrobe, props, facial expressions, colors and
  smooth surfaces: [rebuild and verification guide](docs/SARAH-ASSETS.md).

Mac: after configuring the verified R2 gateway and private release files, run
`npm run pack` (app folder) or `npm run dmg` (installer). Both include encrypted
Tia, the signed catalogue and app connection information. Raw models and
content keys are never bundled.
Notarization: put an App Store Connect API key (Developer role) at
`~/.appstoreconnect/private_keys/AuthKey_<KEYID>.p8` and create
`~/.config/gpt-live-avatar/notarize.env` exporting `APPLE_API_KEY` (path),
`APPLE_API_KEY_ID` and `APPLE_API_ISSUER`; `npm run dmg` then notarizes and
staples automatically. Without that file the DMG is signed but not notarized.


## Desktop controls

[Live group conversations](docs/GROUP-CONVERSATIONS.md): two to five characters, optional human participation, spoken actions and speech interruption.

Avatar and voice selection, voice previews, reliable bubble modes and Tia's original colors: [usage and verification](docs/DESKTOP-CONTROLS.md).

## Handoff for other hosts (EnConvo)

See [docs/ENCONVO-HANDOFF.md](docs/ENCONVO-HANDOFF.md) for how to reuse only the avatar layer (renderer, motions, lip-sync, stage) inside another app that owns its own GPT-Live session.


Desktop Delegate mode supports OpenAI and xAI reasoning with API keys or account
sign-in. Use the right-click **Reasoning** menu and **Settings → Reasoning**.
GPT-Live voice still needs an OpenAI API key. Defaults, authentication behavior,
and test commands are documented in [Desktop controls](docs/DESKTOP-CONTROLS.md#delegate-mode).
