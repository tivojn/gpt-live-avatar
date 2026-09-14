# GPT-Live Avatar

## Getting started from a clone

The renderer and application code are public. Purchased character assets are
separately licensed and must not be redistributed as raw models or texture ZIPs.

```bash
npm install
npm test
npm start                # use your own licensed local avatar package in Settings
```

The Mac release uses protected downloads from a private Cloudflare R2 bucket.
The installer contains the app and signed catalogue, without character models.
Choose a character in **Settings → Avatar**, download its base package, then
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
- Sarah and SGT Sara come from the Auto-Rig Pro Sara blend
  (`~/Downloads/Sara-003_ARP3`), exported headless with Blender
  (materials flattened to Principled BSDF, hair bound to the head bone), then
  `inject-library.py`, OpenClam's `avatar_resources.py` for the resident
  texture tiers, and `build-assets.py`.
- Sarah's complete original wardrobe, props, facial expressions, colors and
  smooth surfaces: [rebuild and verification guide](docs/SARAH-ASSETS.md).

Mac: after configuring the verified R2 gateway and private release files, run
`npm run pack` (app folder) or `npm run dmg` (installer). Both include only the
signed catalogue and app connection information, never the 3D source assets.
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
