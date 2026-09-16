# Meshy hand fidelity audit — 17 September 2026

The five reported preset motions retain changing wrist rotations, but their downloaded Meshy skeletons contain no finger joints. There is no original finger performance in those files to restore. Adding procedural finger curls would invent motion rather than calibrate the original.

## Verified sources

The read-only inventory covers 95 FBX files under the original `tia-interactive` source tree and the app's `build/show-motions` and `build/motion-audit` trees. It also covers 35 GLBs in those trees, 28 of which contain animation.

- 92 FBXs have no finger bones, including Gangnam Groove, Shake It Off Dance, Boxing Practice, Boxing Warm Up, Kung Fu Punch and Jazz Hands. The six directly evaluated preset FBXs each contain 24 bones, ending at LeftHand and RightHand.
- The other three FBXs, the older text-to-motion `dance.fbx`, `walk.fbx` and `wave.fbx`, have 52 bones including 30 finger joints. Although the fingers have animation channels, evaluating every frame finds 0° angular excursion for every finger. Small matrix differences of 0.000029–0.000101 are numerical evaluation noise, not finger articulation.
- None of the 28 animated GLBs contains animated finger joints.
- GET requests for the existing Gangnam, Shake It Off and Kung Fu animation task IDs return HTTP 404. No alternate original download could be retrieved. No generation request was made and no generation credits were spent.

Local audit evidence is retained in `work/hand-fidelity-audit` in the development workspace, including FBX/GLB inventories, evaluated finger tracks and original-task retrieval results. Those private diagnostics are not distributed with the app.

## Wrists are moving and their motion is preserved

The table measures the maximum quaternion angle from the first frame, with the hand relative to its forearm. This measures motion excursion, not absolute anatomical calibration.

| Original preset | Left wrist | Right wrist |
| --- | ---: | ---: |
| Gangnam Groove | 70.813° | 111.472° |
| Shake It Off Dance | 102.213° | 92.750° |
| Boxing Practice | 56.317° | 64.676° |
| Boxing Warm Up | 36.324° | 41.204° |
| Kung Fu Punch | 127.279° | 88.315° |
| Jazz Hands (source only; withdrawn) | 104.149° | 120.389° |

For the first five clips, the exported Tia, Sarah, Ming-Mei, Iselda and Seraphim motion files match these excursion measures within **0.000103°**. This does not by itself prove every visible hand orientation is anatomically perfect; it does disprove that the wrist animation was replaced by a fixed orientation in these exported clips.

Their local finger matrices change by at most **0.0000013** over each clip, below the runtime's 0.002 animation-detection threshold. All 25 exported samples are correctly classified as lacking finger animation. Tia/Sarah/Ming-Mei/Iselda carry 38 finger/helper joints; Seraphim carries 76 because of the second suit rig.

The local audit also retains source/exported wrist measurements and a Blender reproducer.

## App hand-pose behavior and the scoped fix

`tools/retarget-meshy-motion.py` transfers the body, forearm and wrist through native controls. It has no finger mapping. The absence matters for future animated-finger input, but adding a mapping cannot recover missing tracks from the currently reported presets.

`web/avatar3d-motion.js` measures whether a clip animates fingers. For body-only clips, it applies an authored static hand pose: boxing and Kung Fu entries name fists, while unassigned dances use a relaxed hand pose. The app therefore contributes the fixed finger shape the user notices. These are honest static grips, not source-derived finger performance.

One separately confirmed bug was corrected: a clip with real animated fingers can still be overwritten by a named per-clip hand pose. The existing check skips the relaxed fallback but does not skip the named pose.

The one-line runtime fix skips all automatic catalog hand-pose overrides when the loaded clip actually animates fingers. Explicit user-selected hands or prop grips still win. It changes no geometry, skin weights, body tracks, source files or packaged assets.

The production regression `node qa/motion-finger-priority.mjs` exercises loading, classification, playback and update with animated fingers, named catalog poses, relaxed fallback, explicit user grips and unchanged body tracks. It fails against the old runtime and passes with the correction. This correction does not add finger movement to the current Meshy presets.

## What is needed for faithful finger animation

Obtain a source FBX/GLB for the desired exact choreography that contains genuinely varying finger-joint rotations. Compare the same source against Meshy's preview before accepting it; a different text-generated dance is not an exact replacement. Once valid tracks exist, map phalanges using calibrated source/target rest axes and verify local rotations, palm orientation and unchanged body motion frame by frame. The current generic retarget mapping must then be extended before baking, since it currently maps only through the wrist.

Meshy's current [Animation API](https://docs.meshy.ai/en/api/animation) documents FBX and GLB outputs, animation selection and post-processing, but no full-finger export option. Its [Rigging API](https://docs.meshy.ai/en/api/rigging) likewise documents no finger-detail switch. This is an absence in the published API, not a claim that Meshy can never provide finger articulation. The [Text-to-Motion API](https://docs.meshy.ai/en/api/text-to-motion) does not guarantee it either; the three local outputs inspected here have static finger channels. Check with Meshy for an articulated source download or full-hand rig option before spending credits on regeneration.
