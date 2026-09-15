# Meshy motion audit · September 15, 2026

Version 0.2.11 restores the source movement of 51 existing Meshy presets and adds three presets for all five avatars. The library contains 65 clips per character. Existing calibrated walking clips and the custom conversational greeting are retained.

## Findings and changes

- The original converter treated an already-posed Meshy bind frame as neutral for the torso. It also reduced torso rotation to 65% and pushed forearms outward by up to about 14°. Together these changed the choreography. The corrected bake uses anatomical initial body orientation and the original movement amplitude.
- A selected hand/prop value of `none` was truthy in the player, so it incorrectly froze the fingers and overrode a motion’s authored fists. Empty and `none` now both allow the motion hand pose; an actual chosen grip is preserved.
- Cross-character conversion discarded the motion envelope. It now retains the full movement bounds on each native rig, including airborne motion, so framing can be stable across a flip or jump.
- Sarah’s legacy `neutral_bone` is not an animated deform joint in the runtime appearance library. It is excluded from converted motion channels.
- Stable framing is scoped to the current motion, so a wide flip does not leave the following dance zoomed too far out.

The character model files remain byte-for-byte unchanged. Native proportions, skin weights, face shape, outfits, accessories and textures were not altered to compensate for motion issues.

## Source presets

| Motion | Meshy preset ID |
| --- | --- |
| Bubble Dance | 67 |
| Boxing Warm-up | 385 |
| All Night Dance | 64 |
| 360 Power Spin Jump | 397 |
| Backflip | 452 |

Source: [Meshy animation library](https://docs.meshy.ai/en/api/animation-library). The original preset FBXs were reused where available. The expired neutral donor rig was recreated to obtain the three additional presets. No purchased character source was uploaded to Meshy.

## Validation

The actual WebGL player was sampled at eight phases for each of the five listed motions on Tia, Sarah, Iselda, Ming-Mei and Seraphim: 200 rendered comparisons, including takeoff, inversion and landing. The original Meshy preview sequences and FBX joint trajectories were used for comparison. No-prop playback was checked to permit the authored boxing fists.

For Bubble Dance, mean torso-direction error relative to the original source fell from approximately 41° to 7°. Upper-arm and forearm direction errors fell from roughly 5–10° to below 0.1°. Boxing Warm-up’s arm directions similarly match to below 0.1°. Different body proportions and the five-versus-three spine-joint mapping prevent a pixel-identical match to the donor; hair, clothes and facial presentation are character-specific.

The conversion is reproducible with `tools/retarget-meshy-motion.py` and `tools/prepare-character.py`. Private source FBXs, rendered audit sheets, task receipts and numerical measurements live under the owner’s ignored `build/motion-audit/` directory. They are not distributed as raw assets in GitHub.

With licensed local packages in `build/characters/`, run `node_modules/.bin/electron qa/motions-app.cjs` to repeat the 200 rendered phases, native fist checks and viewport bounds checks. Screenshots are saved in ignored `build/qa-motions/`.

## Delivery

`tools/build-motion-update.cjs` creates encrypted motion-only overlays. Existing model and texture parts remain unchanged in R2. The Tia starter includes the updated motion overlay, and downloads of other avatars include their current motion update. Existing installations can download **Motion update** in Settings.
