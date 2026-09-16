# Motion and hair regression checks

The September 2026 repair keeps the original character models and fixes the animation/rendering paths. Do not reshape the body to compensate for an incorrect pose or retargeted joint rotation.

- `avatar3d-motion.js`: stationary travel must translate every animated root together. These exported rigs can flatten pelvis, spine and limbs into siblings. Moving only the pelvis stretches the skin between them.
- `retarget-meshy-motion.py`: preset arm calibration matches the elbow plane, and wrist calibration matches both palm direction and roll. Half-twist helper branches must remain continuous relative to their limb.
- `prepare-character.py`: preserve the palm frame when transferring a motion between characters.
- `avatar3d-volume.js`: Sarah and Tia use an arm-weighted volume correction when explicit metadata is absent. Keep affine/stretching bones on matrix skinning. Do not apply full-body volume changes to fix an arm defect.
- `avatar3d-hair-clearance.js`: Sarah's long hair retains its authored front/back side at the torso. Scalp vertices remain untouched. Visible hair and its shadow must use the same deformation.
- `avatar3d-portrait.js`: contact-deformed hair needs fresh depth sorting when the chest moves relative to the head. Rigid hair retains its idle cache. Sarah's reduced hair gloss removes the excessive gray reflection without changing her texture or geometry.

## Checks

Run `npm test` for source regressions, including root travel and hair sorting. With the local licensed character packs installed, run:

```sh
npx electron qa/skinning-arms.cjs
npx electron qa/hair-contact.cjs
```

These compare GPU and CPU behavior and check scalp isolation, shadows, torso contact, affine fallback, and scoped arm deformation. Captures and reports stay in ignored `build/` directories.

Before installing a newly baked motion overlay, compare it with the current character library:

```sh
python tools/audit-motion-kinematics.py \
  --characters build/characters \
  --candidates /path/to/candidate-overlays \
  --output /path/to/validation.json
```

This tool requires NumPy. Keep source timing, flags, body transforms and joint trajectories intact. A same-named FBX is not sufficient evidence that its choreography matches the installed clip. Preserve source-specific edits and quarantine mismatches instead of overwriting them.

The local September 16 validation accepted 342 overlays across five avatars. Gangnam Groove, Shake It Off Dance, Kung-Fu Punch, Boxing Practice and Boxing Warm-Up passed for every avatar. Forty-three other candidates were retained as originals because their sources or character-specific adjustments did not match, or they exceeded the strict endpoint tolerance. Six legacy walking/waving clips were not rebaked.

## Release boundary

Raw character and motion data is licensed and stays outside source control. Copying a validated overlay into `build/characters` updates the development app only. Distribution requires rebuilding the protected motion packs, updating their signed catalogue/revisions, and packaging the application through the existing release workflow. Do not advertise an existing DMG as containing a local-only repair.
