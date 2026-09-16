# Sarah pelvis weight restoration

Sarah's upper hip formed an angular shelf during the wide squat at the end of Kung-Fu Punch. The source model contained substantial pelvis attachment weights on `c_root_bend.x`, but that control was not marked as a deform bone. Export discarded its influence and normalized the remaining thigh weights, pulling the upper hip toward the raised leg.

The repair restores that authored influence through the exported pelvis driver `root.x`. It applies consistently to the body, fitted brief, side ties, pants, chain belt and dress. The fitted brief retains exactly the body's weights. Recovered source weights supersede the earlier small harmonic crotch-weight workaround; the previous topology closure remains.

This is a skin-weight repair. It does not change motion timing, bone trajectories, poses, body proportions, rest positions, normals, UVs, indices, morph targets, materials, or the existing garment clearance and depth ordering. Original Blender assets remain unchanged.

## Reusable verification

`qa/pelvis-weights.py` uses Python's standard library. For a staged overlay whose unchanged buffers remain in the original resident directory:

```sh
python3 qa/pelvis-weights.py \
  --resident /path/to/candidate/sarah/runtime/resident \
  --fallback /path/to/original/sarah/runtime/resident \
  --baseline /path/to/original/sarah/runtime/resident \
  --authored-body /path/to/licensed/authored-root-weights.json \
  --authored-cloth /path/to/licensed/authored-cloth-root-weights.json \
  --write-manifest /path/to/validated-payload.json
```

The reference tables are generated locally from the licensed Blender project and are not committed with source code. `--baseline` proves the repair leaves existing buffers and geometry/morph descriptors intact and changes weights only on the six affected nodes. The optional authored references verify that changed weights match the original source, including matched rest positions. Every brief vertex must still match a body position and its full bone-weight distribution. All weights must be finite, nonnegative, normalized, and refer to valid joints.

The resulting manifest contains hashes and a validation summary, without source geometry. Verify a copied or installed development payload against that exact approved candidate:

```sh
python3 qa/pelvis-weights.py \
  --resident build/characters/sarah/runtime/resident \
  --expected-manifest /path/to/validated-payload.json
```

The manifest is specific to one payload; regenerate it after an intentional repack. A fingerprint does not substitute for the source comparison and visual review that precede approval.

## Verified repair and visual scope

Independent source matching found no unmatched changed weights. Maximum authored weight error was approximately 1.05e-7; maximum sum error was 2.01e-7; fitted brief/body weight difference was zero across all 4,728 brief vertices. Original geometry, morphs and unrelated skin weights remained unchanged.

Visual checks include the final Kung-Fu Punch squat from front, rear, side and rear three-quarter angles, plus summer, long-pants and dress outfits. For fixed-camera test renders, refresh `clothOcclusion.beforeRender()` **after** moving the camera; otherwise its depth mask describes the prior camera and produces false clothing defects. Additional sampled motions cover boxing, Gangnam Groove, Shake It Off and Backflip. Sampled checks do not establish that every extreme pose is intersection-free.

Keep the repaired resident data and fallback model consistent. Updating a development payload does not update a released DMG or signed remote asset pack; packaging and publication remain separate steps.

## Release integration

Version 0.2.19 uses `sarah-wardrobe-v10`. The copied resident buffers match the
approved payload fingerprints; the fallback GLB SHA-256 is
`b13a635a2d32d37d9ee969152b32792906da404266d333ab50e5db6b96ebc9be`.
Re-running the retrofit reports no changed weights. The export scripts retain
`c_root_bend.x` influence as `root.x` before deform filtering and preserve the
provenance marker through completion; the obsolete harmonic weight workaround
is skipped when authored pelvis weights are present. Topology repairs remain.

The fallback GLB was loaded separately in Electron and rendered at the final
Kung Fu Punch frame with summer, pants and dress outfits from front and rear
three-quarter views. All six renders completed without renderer errors.
`qa/pelvis-payload.json` retains the approved public fingerprints, not licensed
geometry or source weight tables.
