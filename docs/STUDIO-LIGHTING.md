# Studio lighting · 0.2.12

Rotating an avatar changes which skin normals and hair strands face the lights. It does not select a higher rendering preset. Previously, the studio rig stayed fixed in world space, and the key light's shadow also attenuated the fill, rim and catchlight. Some elevated views therefore looked much brighter and more detailed than an upright view with the same textures.

Studio and Soft now use a larger, lower key, a broad independent fill, a restrained rim and an eye catchlight. The rig and reflections follow the camera continuously. Only the key uses its matching shadow map. This keeps the visible side illuminated while retaining facial contours, material roughness and the character's chosen colors. Classic retains its original lighting behavior.

The change uses the existing four studio sources, one shadow map and environment texture. It does not raise texture limits, surface budgets or frame rates. Resource Friendly still uses directional approximations without shadows; Balanced retains the display transform and area lights; Best retains its existing skin diffusion and close-up sampling. The M2/16 GB memory and pixel limits are unchanged. This is lighting calibration, not new geometry or an offline renderer.

`qa/studio-lighting.cjs` loads all five local licensed character packs, captures upright, elevated, side and rear views, checks that the rig follows the camera, exercises all three performance presets and restores Classic/Soft/Studio. It also records renderer timings and texture counts. Review the resulting images in ignored `build/qa-lighting-*`; numerical checks alone cannot judge appearance. The release comparisons were made on the development Mac, not an M2, so they are not an M2 performance certification.

For EnConvo integration, keep `avatar3d-portrait.js` with the renderer's material callbacks, environment rotation and per-frame `beforeRender()` call. Replacing only light intensities misses the shadow and camera-relative fixes.

## 0.2.13 restrained refinement

A slightly more lateral key and reduced fill retain gentle facial contours. A smaller eye panel makes the catchlight less broad; environment fill increases only from 0.26 to 0.28. The four-source rig, one shadow, texture limits and surface budgets are unchanged. The v0.2.12 calibration remains the rollback baseline in Git. Local side-by-side captures cover all five avatars; judge the result visually rather than interpreting the small renderer timing differences as a speed improvement.
