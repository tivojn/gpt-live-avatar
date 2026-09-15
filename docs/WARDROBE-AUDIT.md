# Wardrobe audit · 0.2.13

The historical 0.2.12 findings are preserved below. The 0.2.13 corrections,
including the replacement Sarah wardrobe revision, are recorded separately.
Use the matching
[release page](https://github.com/tivojn/gpt-live-avatar/releases/tag/v0.2.13)
to confirm installer availability and checksums.

## Historical 0.2.12 findings

The reported defects covered Sarah's coat and Brazilian bottoms, Iselda's skirt and standing poses, Seraphim's armor, and Ming-Mei's pale eyebrows. Tia's underwear was also inspected without her skirt: its small, separate cover mesh has clipping too, which the normal outfit largely conceals. It is not the same mesh as Sarah's exposed Brazilian outfit, and it is not an appropriate clean fit reference.

### 0.2.12 derived asset changes

Sarah's closely fitted panel had insufficient surface detail and followed incompatible thigh deformation. Its native surface is subdivided, supported at the pelvis and given a small clearance at the lower edge. Side ties keep their original weights. Iselda's skirts are supported from the pelvis so opposing leg motion does not fold the hem through the thighs. Her standing poses also retain her native thigh and shin rest alignment. These are changes to derived application assets; original Blender projects are not modified.

`tools/export-sarah-surfaces.py --bottoms-only` exports the smooth native panel. `tools/repair-wardrobe.py` applies the resident geometry corrections. `tools/build-wardrobe-update.cjs` repacks only selected characters under **new immutable asset revisions**, retaining the other avatars. Uploads still enforce the existing account-wide 10 GB cap.

### 0.2.12 runtime changes

- Sarah's coat hides the covered shirt sleeves/back while preserving the front tie. Small garment clearances reduce intersections in the coat and trousers.
- `web/avatar3d-cloth-occlusion.js` renders the visible affected garment into a floating-point depth texture. It conceals nearby skin penetrating that garment, within defined body regions. Depth separation prevents a rear garment from revealing itself through the front of the body. Exposed hands remain unaffected. This is a rendering correction, not a cloth physics simulation.
- The extra pass runs only for the affected outfits. The target matches the avatar's rendering surface and is disposed with the avatar. It retains the same skinning and contact transformations as the visible garment. Hosts without floating-point color targets skip the pass.
- Ming-Mei's eyebrow map needs a separate brown material tint; the exported pale map alone is insufficient. Both existing eyebrow texture choices retain the tint.
- Armor outfits restore the covered pilot geometry. Helmet outfits keep head rotation aligned with the helmet, including orbiting and face close-ups; the eyes can still move.
- All five defaults enable idle pose transitions. Together now uses the saved transition preference.

### 0.2.12 validation

- `qa/cloth-occlusion.cjs` uses synthetic geometry to assert that a nearby garment covers intersecting skin while distant cloth, a removed outfit and foreground body parts leave skin visible.
- `qa/wardrobe-app.cjs` captures six views of Sarah's three layered outfits and Seraphim's four armor/pilot outfits. It asserts helmet head alignment. Captures require visual review; the script does not automatically prove that clothing never clips.
- The standing pose sweep inspected front and back views across nine Sarah and nine Iselda poses. Ming-Mei's two eyebrow map choices were rendered with and without the correction.
- Full app regression checks and continuous motion validation accompany the release. Extreme animations can still need outfit-specific fitting; this release does not introduce general cloth simulation. Test the host's complete renderer and performance settings when integrating with EnConvo.

## 0.2.13 final corrections

### Ming-Mei and Iselda head attachments

Their exported hair spline roots are separate from the head bone. Authored
animation already moves the hair, but the extra procedural head turn used for
eye contact did not reach those roots. `web/avatar3d-head-attachments.js`
discovers the relevant roots through hair skin weights and carries only that
additional head delta. Full matrices preserve affine transforms. Restoring the
authored matrices before the next pose/motion write prevents accumulation;
head-parented hair and Iselda’s independent skirt roots keep their own behavior.

### Sarah body, underwear and dresses

The final revision is **`sarah-wardrobe-v9`**. It supersedes the v8 panel described
in the historical section. The original authoring projects and original vertex
positions remain unchanged. The derived application assets contain:

- A localized body repair. Six internal disconnected crotch components
  (1,393 vertices) protruded through clothing. The derived body index buffer
  excludes those components and closes two outer holes using 56 triangles made
  from existing boundary vertices. No new outer body vertex positions are added.
- A local skin-weight repair for 706 vertices within x ±3.7 cm,
  y 0.954–1.022 m and z 0.002–0.092 m. This smooths the discontinuous and
  opposite-thigh influences that distorted the fitted clothing during movement.
- New fitted underwear based on the corrected outer-body triangles and weights,
  with four meaningful lower-body morphs. Its low-rise Brazilian cut follows the
  measured native outline. Summer includes its side ties; both `dress` and
  `dress-straps` include the main brief underneath without those long ties.
- The dress’s native weights with a 6 mm lower-garment ease and existing front
  fitting. Keep `web/avatar3d-body-brief.js`, wardrobe visibility, morph handling
  and resource streaming together with the revised asset.

The brief follows a real surface; it is not used to erase skin. The existing
dress-depth pass layers nearby body and the brief underneath visible dress
fabric, with an 8 mm allowance for the brief. It uses the same body bounds and
depth separation principles as the earlier garment pass. This remains specific
garment fitting and layering, not a general cloth simulation.

`tools/repair-sarah-underlayer.py` reproduces the derived Sarah surface using
Blender’s Python environment, licensed unrepaired resident assets and a separate
output directory. It rejects a source that already contains the repair. The
maintainer preserves the original input and publishes the generated buffers and
metadata through the protected wardrobe pipeline.

The Sarah change requires a newly signed base/texture/motion combination.
Maintainers must use the new immutable revision, preserve matching runtime tiers
and retain the 10 GB cloud-storage cap. Other avatar models and textures do not
need a duplicate upload for this wardrobe change.

### Ming-Mei fitted dress back

The opaque back panel used incompatible skin weights: at waist height 1.00 m,
the cloth had almost no pelvis contribution while the nearby body retained
about 29%. Near 1.05 m, some cloth vertices also started 5–8 mm inside the skin.
Motion exposed the body through this panel. The upper lace has authored
transparency and remains translucent.

`web/avatar3d-mingmei-fit.js` transfers weights from four nearby body vertices
and blends into the original side, skirt and upper-body weights. It adds at most
9 mm of local normal clearance to 3,822 of the 15,949 garment vertices. This runs
once per geometry load, including wardrobe reloads. Body geometry, materials,
alpha textures and loose skirt hem remain unchanged. It adds no per-frame work
or new render pass and needs no replacement Ming-Mei model/texture package.

Use the corrected `meshy-v11-20260915` motion pelvis and spine alignment with
these garment checks; earlier candidate clips had an additional posture defect.

### 0.2.13 validation and limits

With licensed prepared packages under `build/characters/`:

```bash
node_modules/.bin/electron qa/head-attachments.cjs
node_modules/.bin/electron qa/mingmei-dress.cjs
node_modules/.bin/electron qa/sarah-dress.cjs
node_modules/.bin/electron qa/sarah-streaming.cjs
node qa/body-brief-hooks.cjs
node_modules/.bin/electron qa/cloth-occlusion.cjs
```

Completed Ming-Mei checks cover Happy Jump Female and Bubble Dance at four
phases from four angles: **32 samples with zero exposed opaque-back pixels**.
The baseline had up to 2,459 exposed panel pixels. The shader diagnostic isolates
the known opaque back region, preserving the actual garment material and alpha;
face, arms and authored upper lace are outside its target. Native captures also
retain the lace and front outfit appearance.

Actual dress eviction/reload recreates geometry and reapplies an identical fit.
Repeated fitting is idempotent; Eco → Quality → Eco → Balanced changes retain
that fit. Body position and weight buffers remain unchanged, skin weights sum
to one within 5.22e-8 and GL error is zero.

Head-attachment checks pass 200 alternating procedural-turn frames plus real
motion and authored pose changes. The restored matrices are compared against
independently saved authored local matrices, not only against the same frame’s
capture. Maximum error is approximately 1.11e-15; GL error is zero. The separate
continuous motion check also retains all five Iselda and four Ming-Mei hair
roots across its 18,250-frame run.

Sarah’s full prepared-asset regression passes **924 renders**, covering 39
pose/outfit cases and 36 samples across six motions. A subsequent shader-hook
preservation correction passes **132 focused renders**, including all five
outfits and boxing. Body-to-brief surface error is zero, maximum skin-weight
sum error is 5.22e-8 and no WebGL or renderer errors occur. These sampled render
results are separate from the geometric invariants below.

The final derived outer-body mesh has zero boundary edges, non-manifold edges
and zero-area triangles. Its original positions and all 145 body morph targets
remain unchanged. `qa/body-brief-hooks.cjs` also verifies that material cloning
retains existing shader callbacks and cache keys, supports material replacement
and arrays, and remains idempotent. These hooks are required when EnConvo layers
its own material behavior or when streamed resources replace a material.

Sarah’s integrated-asset streaming check also passes Eco → Quality → Eco with
actual outfit geometry unload/reload. Corrected body indices, positions, joints
and weights stay byte-identical, brief/body surface mismatch remains zero and
there are no WebGL errors. Explicit `Smaller.Pelvis` and `Thicker.Legs` checks
retain matching body/brief deformation.

Screenshots and sampled motions do not prove every outfit/pose combination is
intersection-free. Host ports must preserve the complete shader, morph,
skinning, fit and streaming pipeline. There is no physical M2/16 GB measurement
or completed EnConvo acceptance test in these results.
