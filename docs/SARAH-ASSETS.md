# Sarah original assets

Sarah now has 19 runtime meshes, five outfits, the original bag and two weapon
props, optional hoop earrings, 74 original color choices, and 65 authored facial
expressions. Her 145 morph targets, 157 motion-driven bones, 69 poses and 62 motion
clips are retained. Studio lighting and the skin/cornea treatment are shared with
Tia. The Mac context menu exposes colors, expressions, lighting and accessories;
selections are saved per avatar revision.

The original `Sara-003_ARP3.75_BL4.53.blend` supplies the missing garments and props
and the refined surfaces. The old Sarah GLB supplies the established runtime rig
and its original material textures. `Sara_Extras` contains interchange versions
of the same garments/props. Separate eyes, teeth and the unjoined body in the
Blender source are authoring alternatives: the export body already contains
those parts. Including them twice caused overlapping facial geometry.

One Catmull-Clark subdivision level is baked into the body and major garments,
including all facial targets. The exported skin inverse bind matrices are checked
against the original before the geometry can be merged. The bag follows the right
shoulder, and weapon props follow the right hand with the matching authored pose
and grip. Hair and earrings follow the head. Blender's control widgets, separate
strap rigs and secondary physics are not runtime simulations; the complete strap
mesh is used for the Brazilian bottoms. This matches the app's skeletal renderer.

Outfit-specific rest-space masks hide covered skin beneath trousers and covered
shirt/arm layers beneath the coat. These avoid interpenetration during poses while
retaining the full underlying meshes for the other outfits. Transparency remains
soft for hair/brows/lashes; fabric cutouts retain depth testing.

## Rebuild

Requires Blender, Python with numpy/Pillow, and OpenClam Studio's installed
`server/avatar_resources.py`. Run from the repository root. The commands only
read the source blend and the old GLB.

```sh
SARAH_BLEND="$HOME/Downloads/Sara-003_ARP3/Sara-003_ARP3.75_BL4.53/Sara_Blender/Sara-003_ARP3.75_BL4.53.blend"
BLENDER=/Applications/Blender.app/Contents/MacOS/Blender
mkdir -p build/sarah
"$BLENDER" --factory-startup -b "$SARAH_BLEND" --python tools/export-sarah-extras.py -- build/sarah/extras.glb
"$BLENDER" --factory-startup -b "$SARAH_BLEND" --python tools/export-sarah-surfaces.py -- build/sarah/surfaces.glb
python3 tools/complete-sarah.py \
  --base build/sarah/sarah/model.glb \
  --extras build/sarah/extras.glb --surfaces build/sarah/surfaces.glb \
  --textures "$(dirname "$SARAH_BLEND")/textures" \
  --motions build/assets/bundle/tia/runtime/motions \
  --output build/sarah/complete
PYTHONPATH="/Applications/OpenClam Studio.app/Contents/Resources/backend/server" \
  python3 -c 'import avatar_resources; avatar_resources.build("build/sarah/complete/model.glb", "build/sarah/complete/runtime/resident")'
python3 tools/build-assets.py build/sarah/complete sarah
npm test
python3 qa/sarah-assets.py build/sarah/complete/model.glb
npx electron qa/app-smoke.cjs
```

`--base` must be the earlier full-resolution Sarah GLB with `openclamAvatar`
metadata, not Tia or the bare Blender export. A previous release's Sarah 4K GLB
can serve as that input. The generated packages remain outside git, as before.

Development runs prefer `build/assets/packages/sarah`. For all local texture
tiers, copy the completed source's `runtime/resident` directory over that local
package after building the tier archives. Packaged apps use the installed
`~/Library/Application Support/gpt-live-avatar/avatars/sarah` directory. Replace
that directory as a complete revision when updating geometry; do not overlay
old numbered texture files. Downloading a texture tier with a different revision
is rejected. Publishing the regenerated release archives is a separate operation.

The iOS 1K/2K/4K GLBs are also regenerated with the refined geometry, wardrobe,
poses and expressions. Native iOS UI/physical-device memory validation is outside
the Mac verification here. The external original color pack is currently exposed
by the Mac app; no new iOS color-pack download UI is introduced.

## Verification

`qa/sarah-assets.py` checks coverage, finite geometry, normalized weights, pose
references, accessory bindings and facial targets. `npm test` includes revision
isolation, so new mesh indices cannot accidentally use an old downloaded texture.
`qa/app-smoke.cjs` runs the real app using an isolated profile, checks its native
appearance menus, and reloads it to verify selection persistence without starting
a live conversation. Manual rendered review includes front/side portraits, all
five outfits, three props, and walking, waving and swaying.
