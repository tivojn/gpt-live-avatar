# Wardrobe audit · 0.2.12

The reported defects covered Sarah's coat and Brazilian bottoms, Iselda's skirt and standing poses, Seraphim's armor, and Ming-Mei's pale eyebrows. Tia's underwear was also inspected without her skirt: its small, separate cover mesh has clipping too, which the normal outfit largely conceals. It is not the same mesh as Sarah's exposed Brazilian outfit, and it is not an appropriate clean fit reference.

## Derived asset changes

Sarah's closely fitted panel had insufficient surface detail and followed incompatible thigh deformation. Its native surface is subdivided, supported at the pelvis and given a small clearance at the lower edge. Side ties keep their original weights. Iselda's skirts are supported from the pelvis so opposing leg motion does not fold the hem through the thighs. Her standing poses also retain her native thigh and shin rest alignment. These are changes to derived application assets; original Blender projects are not modified.

`tools/export-sarah-surfaces.py --bottoms-only` exports the smooth native panel. `tools/repair-wardrobe.py` applies the resident geometry corrections. `tools/build-wardrobe-update.cjs` repacks only selected characters under **new immutable asset revisions**, retaining the other avatars. Uploads still enforce the existing account-wide 10 GB cap.

## Runtime changes

- Sarah's coat hides the covered shirt sleeves/back while preserving the front tie. Small garment clearances reduce intersections in the coat and trousers.
- `web/avatar3d-cloth-occlusion.js` renders the visible affected garment into a floating-point depth texture. It conceals nearby skin penetrating that garment, within defined body regions. Depth separation prevents a rear garment from revealing itself through the front of the body. Exposed hands remain unaffected. This is a rendering correction, not a cloth physics simulation.
- The extra pass runs only for the affected outfits. The target matches the avatar's rendering surface and is disposed with the avatar. It retains the same skinning and contact transformations as the visible garment. Hosts without floating-point color targets skip the pass.
- Ming-Mei's eyebrow map needs a separate brown material tint; the exported pale map alone is insufficient. Both existing eyebrow texture choices retain the tint.
- Armor outfits restore the covered pilot geometry. Helmet outfits keep head rotation aligned with the helmet, including orbiting and face close-ups; the eyes can still move.
- All five defaults enable idle pose transitions. Together now uses the saved transition preference.

## Validation

- `qa/cloth-occlusion.cjs` uses synthetic geometry to assert that a nearby garment covers intersecting skin while distant cloth, a removed outfit and foreground body parts leave skin visible.
- `qa/wardrobe-app.cjs` captures six views of Sarah's three layered outfits and Seraphim's four armor/pilot outfits. It asserts helmet head alignment. Captures require visual review; the script does not automatically prove that clothing never clips.
- The standing pose sweep inspected front and back views across nine Sarah and nine Iselda poses. Ming-Mei's two eyebrow map choices were rendered with and without the correction.
- Full app regression checks and continuous motion validation accompany the release. Extreme animations can still need outfit-specific fitting; this release does not introduce general cloth simulation. Test the host's complete renderer and performance settings when integrating with EnConvo.
