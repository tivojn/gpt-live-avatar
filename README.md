# GPT-Live Avatar

## Avatars and texture tiers

The Mac DMG and the iOS app ship only the resource-friendly Tia package (1K
textures, meshes, rig, motions). Balanced (2K) and Best quality (4K) textures,
and every other avatar, are downloaded on demand from the public GitHub
release `tivojn/gpt-live-avatar-assets` (`assets-v1`), with a percentage
progress bar in Settings. `index.json` in that release is the catalogue; both
apps refresh it at start / when Settings opens, so new avatars appear without
an app update.

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

Mac: `npm run pack` (app folder) or `npm run dmg` (installer; bundles
`build/assets/bundle` and `build/assets/index.json`).
