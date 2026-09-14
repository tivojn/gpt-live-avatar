# GPT-Live Avatar

## Getting started from a clone

The large 3D assets are not in git; they live in this repository's
`assets-v1` release. One command fetches what the apps bundle:

```bash
npm install
npm run fetch-assets      # Tia's resource-friendly package + the iOS 1K model + catalogue
npm run pack              # Mac app in dist/mac-arm64
npm run dmg               # Mac installer
```

iOS: `cd ios && xcodegen generate` (or open `GPTLiveAvatar.xcodeproj`), then
build the `GPTLiveAvatar` scheme. Signing uses team X7R8N6MMSU; change it in
`ios/project.yml` for another account. Everything else (2K/4K tiers, Sarah,
SGT Sara) is downloaded by the apps on demand from the same release.

## Avatars and texture tiers

The public starter packages and the iOS app ship the resource-friendly Tia package (1K
textures, meshes, rig, motions). Balanced (2K) and Best quality (4K) textures,
and every other avatar, are downloaded on demand from the public GitHub
release `assets-v1` of this repository, with a percentage
progress bar in Settings. `index.json` in that release is the catalogue; both
apps refresh it at start / when Settings opens, so new avatars appear without
an app update.

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

Mac: `npm run pack` (app folder) or `npm run dmg` (installer; bundles
`build/assets/bundle` and `build/assets/index.json`).
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
