# Meshy motion audit · September 15, 2026

Version 0.2.13 introduced motion revision `meshy-v11-20260915`; version 0.2.16
ships `show-20260916`, the same bake plus the theatre and stage clips (78 per
character) delivered as a motion-only overlay. Use the matching
[release page](https://github.com/tivojn/gpt-live-avatar/releases/tag/v0.2.13)
to confirm installer availability and checksums. Earlier release findings
remain below as history.

## Historical 0.2.11 audit

Version 0.2.11 restored the source movement of 51 existing Meshy presets and adds three presets for all five avatars. The library contains 65 clips per character. Existing calibrated walking clips and the custom conversational greeting are retained.

### 0.2.11 findings and changes

- The original converter treated an already-posed Meshy bind frame as neutral for the torso. It also reduced torso rotation to 65% and pushed forearms outward by up to about 14°. Together these changed the choreography. The corrected bake uses anatomical initial body orientation and the original movement amplitude.
- A selected hand/prop value of `none` was truthy in the player, so it incorrectly froze the fingers and overrode a motion’s authored fists. Empty and `none` now both allow the motion hand pose; an actual chosen grip is preserved.
- Cross-character conversion discarded the motion envelope. It now retains the full movement bounds on each native rig, including airborne motion, so framing can be stable across a flip or jump.
- Sarah’s legacy `neutral_bone` is not an animated deform joint in the runtime appearance library. It is excluded from converted motion channels.
- Stable framing is scoped to the current motion, so a wide flip does not leave the following dance zoomed too far out.

For the 0.2.11 motion release, the character model files remained byte-for-byte unchanged. Native proportions, skin weights, face shape, outfits, accessories and textures were not altered to compensate for motion issues.

### Source presets

| Motion | Meshy preset ID |
| --- | --- |
| Bubble Dance | 67 |
| Boxing Warm-up | 385 |
| All Night Dance | 64 |
| 360 Power Spin Jump | 397 |
| Backflip | 452 |

Added on 2026-09-18 (motion revision `presets-20260918`, retarget v12, all five
characters; fetched with the existing rig task, nothing new was uploaded):

| Motion | Category | Meshy preset ID |
| --- | --- | --- |
| Pop Dance LSA2 | Dances | 80 |
| Denim Pop Dance | Dances | 71 |
| Love You Pop Dance | Dances | 76 |
| Superlove Pop Dance | Dances | 83 |
| Break Dance (Breakdance_1990) | Dances | 395 |
| Flying Fist Kick | Kung fu & fitness | 94 |
| Counter Strike (Counterstrike) | Kung fu & fitness | 90 |

Source: [Meshy animation library](https://docs.meshy.ai/en/api/animation-library). The original preset FBXs were reused where available. The expired neutral donor rig was recreated to obtain the three additional presets. No purchased character source was uploaded to Meshy.

### 0.2.11 validation

The actual WebGL player was sampled at eight phases for each of the five listed motions on Tia, Sarah, Iselda, Ming-Mei and Seraphim: 200 rendered comparisons, including takeoff, inversion and landing. The original Meshy preview sequences and FBX joint trajectories were used for comparison. No-prop playback was checked to permit the authored boxing fists.

For Bubble Dance, mean torso-direction error relative to the original source fell from approximately 41° to 7°. Upper-arm and forearm direction errors fell from roughly 5–10° to below 0.1°. Boxing Warm-up’s arm directions similarly match to below 0.1°. Different body proportions and the five-versus-three spine-joint mapping prevent a pixel-identical match to the donor; hair, clothes and facial presentation are character-specific.

The conversion is reproducible with `tools/retarget-meshy-motion.py` and `tools/prepare-character.py`. Private source FBXs, rendered audit sheets, task receipts and numerical measurements live under the owner’s ignored `build/motion-audit/` directory. They are not distributed as raw assets in GitHub.

With licensed local packages in `build/characters/`, run `node_modules/.bin/electron qa/motions-app.cjs` to repeat the 200 rendered phases, native fist checks and viewport bounds checks. Screenshots are saved in ignored `build/qa-motions/`.

### Protected delivery

`tools/build-motion-update.cjs` creates encrypted motion-only overlays. Existing model and texture parts remain unchanged in R2. The Tia starter includes the updated motion overlay, and downloads of other avatars include their current motion update. Existing installations can download **Motion update** in Settings.


## Historical 0.2.12 follow-up

The 360 Power Spin Jump now removes horizontal root travel while retaining its vertical jump and spin. Solo and Together frame the complete clip before playback, so later wide poses cannot progressively zoom the avatar out or leave a changed scale after landing.

Boxing Warm-up and Happy Sway Standing use a supported stance: leg lengths are retained, the hips remain over that stance, and each ankle can lift and each foot can pitch independently. These are adaptations for the five native rigs, not a claim of pixel-identical playback of the Meshy donor.

`qa/motion-support.cjs` samples every frame of these three clips on all five characters (2,910 frames). It checks limb length, foot separation, independent lift/heel articulation, stationary depth and constant framing. The full-loop spin depth ratio is about 1.03 (limb movement), and the framing ratio is 1.00. Run with Electron and licensed local character packages.

The motion revision is `meshy-v10-20260915`. This release also updates Sarah and Iselda's derived wardrobe packages separately; see [wardrobe audit](WARDROBE-AUDIT.md). The original authoring projects are unchanged.

## 0.2.13 pelvis and spine correction

The final motion revision is **`meshy-v11-20260915`**. The library still contains
65 clips per character. The retargeting tools rebuild motion data from existing
local Meshy source FBXs; this follow-up makes no new Meshy API requests and does
not edit character geometry, skin weights, proportions or materials.

### Anatomical reference

The previous pelvis reference used almost coincident waist/spine controls only
2.9 mm apart. Their direction pointed roughly 79° forward, producing the
forward-thrust pelvis and misplaced torso visible in crouches and jumps.
The native Tia bake now derives the anatomical pelvis basis from the hip
midpoint and pelvis triangle. Secondary retargeting aligns each target’s pelvis
to that basis, retaining its native rig dimensions.

Ming-Mei and Iselda also have shortened spine chains. Their deform aliases now
map to the same donor levels as the corresponding controls. Applying different
donor levels to those aliases twisted body and clothing differently even when
the main spine looked aligned.

### Rebuild scope

- 59 full-body source presets are rebaked through the unchanged Tia rig.
- Tia, Sarah and Seraphim each receive those 59 revised clips.
- Ming-Mei and Iselda each receive all 65 converted clips, including the spine
  and target-pelvis correction.
- 307 of the 325 per-character clip files change. The 18 retained files are
  four calibrated walking cycles and two portrait waves on each of Tia, Sarah
  and Seraphim; they remain byte-for-byte unchanged.
- The existing 360 Power Spin Jump remains in place horizontally while retaining
  its jump and spin. Stable clip framing and independent foot articulation from
  v0.2.12 are preserved. Generic `dance` resolves to `joyful-sway` and is included.

### Measurements and regression checks

Backflip pelvis direction error against the source was approximately 75.71°
for Tia/Sarah/Seraphim, 56.54° for Ming-Mei and 57.32° for Iselda. It is now
0.384° on all five. Across all 59 source presets and 10,896 source frames, maximum
pelvis error is 0.518° and leg-length variation stays below 0.000009 m. The repaired
spine alias alignment error is below 0.00002°.

With licensed local packages:

```bash
node_modules/.bin/electron qa/motion-support.cjs
node_modules/.bin/electron qa/motion-posture.cjs
node_modules/.bin/electron qa/mingmei-dress.cjs
```

The existing motion-support harness passes **2,910 frames** across all five
characters: limb length, foot separation/lift, stationary spin depth and stable
framing. The spin depth ratio is at most 1.0225 from limb motion; the camera-fit
ratio is 1.00.

The continuous posture harness also passes **30 scenarios and 18,250 rendered
frames**: all five characters, six motions (Backflip, 360 Power Spin Jump,
`joyful-sway`, Boxing Warm-up, Happy Jump Female and Hello Run), two full loops
per scenario at 60 Hz animation sampling. Camera-fit variation is zero; maximum
procedural hair-matrix error is 2.22e-16. Iselda’s five and Ming-Mei’s four
independent hair attachment roots are present, and no renderer errors occur.
This is a separate run from the 2,910-frame support regression.

The revised clips also underpin Ming-Mei’s 32-sample opaque-back wardrobe check;
see [Wardrobe audit](WARDROBE-AUDIT.md). Numerical agreement establishes skeletal
alignment, not a pixel-identical Meshy render: native proportions, source
materials, hair and garment movement still differ. There is no general cloth
simulation or physical M2/16 GB acceptance claim.

### Delivery compatibility

Use encrypted motion overlays with revision `meshy-v11-20260915`. Sarah’s
separate `sarah-wardrobe-v9` base and texture revision must have a matching signed
motion combination; the other avatar model/texture packages need no motion-only
repack. The encrypted Tia starter keeps its current matching motion overlay.
Asset publication requires the maintainer’s signed catalogue, verified R2 upload,
installer build and GitHub release; source changes alone do not complete those
steps.
