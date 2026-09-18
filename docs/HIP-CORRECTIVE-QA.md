# Outer hip corrective for the kung-fu ending stance

The final wide squat produces a shelf at the lateral pelvis/thigh junction on
Sarah and Seraphim. The exported joint centers remain connected. The same
crease occurs when the original Sarah mesh, with all authored influences, is
evaluated under the exported pose; changing only four-weight export truncation
does not resolve it.

The correction supports the outer hip's continuous surface between the lateral
pelvis and proximal thigh. Gluteus medius connects the outer ilium to the greater
trochanter; the anatomy reference is [The functional anatomy of hip abductors](https://pubmed.ncbi.nlm.nih.gov/19449297/).
This guides the deformation region, not a claim of patient-specific anatomical
accuracy. A generated sketch was used for contour comparison, not joint measurements.

## Implementation

- `tools/bake-hip-corrective.py` evaluates Blender Corrective Smooth on the source
  body in the exact final exported pose. It uses length-weighted smoothing,
  factor 1, 240 iterations, rest-surface reconstruction, and a hip vertex group.
- The resulting delta is restricted further to the upper lateral hip. The
  central buttock fold and lower thigh are excluded. Sixteen light smoothing
  passes soften the residual upper lateral crease. Normals are calculated after
  these operations. A final local contour patch softens the short indentation
  immediately under the waist. It is restricted to source heights .965–1.11 m
  and lateral hip coordinates, and tapers into the existing surface. It follows
  the pelvis lateral axis; it does not lift or thicken the proximal thigh.
  This replaces the rejected broad thigh-support trials.
- A 14,391-sample field is stored as `hipCorrective` inside each affected private
  `kung-fu-punch.json.deflate` clip. Skeleton transforms and timing are unchanged.
- `AvatarHipCorrective` interpolates one continuous field for both body and
  clothing, caches vertex attributes per streamed geometry, and applies it after
  skinning. Surface normals, shadow draws, and CPU vertex queries use the same
  correction. There is no per-frame mesh smoothing.
- Activation depends on the two thigh orientations relative to the pelvis. It
  fades from full correction at 15 degrees of pose distance to zero at 50
  degrees. Standing/rest has exactly zero correction. It follows root rotation,
  and fades through reversals, entry, exit, and interruptions.

The field is specific to these two characters' matching hip surfaces. Re-bake
when their source geometry or reference motion changes. Generated fields remain
under ignored `build/characters`; never commit source mesh samples to Git.
The package builder already includes `runtime/motions` in encrypted packages.
These local edits do not publish or replace the signed 0.2.23 release.

## Reproduce the private field

Use the licensed Sarah source mesh `Fem-A__Whl_BY_Sarah.export` and rig
`Fem-A_Sara_RIG`. The source file is opened read-only and never saved.

```sh
Blender --background --factory-startup --disable-autoexec \
  --python tools/bake-hip-corrective.py -- \
  --blend /path/to/Sara-003_ARP3.75_BL4.53.blend \
  --rig Fem-A_Sara_RIG --body Fem-A__Whl_BY_Sarah.export \
  --model build/characters/sarah/model.glb \
  --motion build/characters/sarah/runtime/motions/kung-fu-punch.json.deflate \
  --output /tmp/kung-fu-punch.json.deflate
```

Sarah and Seraphim currently share the hip rest surface and final hip orientation.
Use the corresponding target GLB and motion for each bake; do not reuse a field
for a different character without verifying those conditions.

## Verification

```sh
env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron qa/hip-corrective.cjs /tmp/hip-qa
npm test
```

The renderer check runs all 220 frames for both characters, verifies unchanged
bone matrices and source geometry/weights, checks zero activation at rest,
compares CPU vertex queries with actual float-target GPU draws, checks Sarah's
brief/body matching vertices, and exercises friendly/balanced/best geometry.
It saves surrounding frames and identical-camera before/after views from the
back, front, side, and three-quarter angles.

## Reviewed local result and release handoff

The final contour was visually approved on 2026-09-18 after testing the running
app. `npm test` passed for the runtime changes. The final installed assets passed
the renderer fixture: 440 frames, all three detail levels, 24 GPU comparisons
(maximum position error 0.000002057 m), and zero brief/body separation at matching
vertices. Standing/rest resets to the uncorrected pose.

A Git push includes the runtime, bake tool, and QA harness. It does not include
the licensed private motion data under ignored `build/characters`. For the next
release, package both updated motion clips into the encrypted avatar packs and
update the release asset metadata through the normal release process. Re-exporting
a motion from its source also requires re-running the corrective bake.

The visually reviewed local compressed clips have these SHA-256 hashes:

- Sarah: `cf2e3e0ccf8e9cc8704d24d6f9c71c61da38bab22af37598c86dae8f2d20b5fa`
- Seraphim: `e74591b5827f35a1a721e5cd5efd5370bdf9d48ee8caf454ad4347d0436e0aac`

Both are located at
`build/characters/<character>/runtime/motions/kung-fu-punch.json.deflate`.
No release pack was published as part of this change.
