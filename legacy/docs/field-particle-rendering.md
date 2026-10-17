# Source particle rendering

v36 adds a qualified ordinary particle geometry and CPU render-target provider for the five extracted EffectPrefab graphs. It executes the recovered engine vertex generation, the existing source shader translation and single-sample RGBA8 rasterization. This is a provider capability, not a new playable profile: the published profile remains v35, all five live emitters remain blocked, and original-game/GPU parity has not been measured.

## Ownership and interface

`compileFieldParticleRendering(assetGroup, mediaGraph, dependencies, geometryExport)` returns a `FieldParticleRendering`. It binds the exact ParticleSystemRenderer/Camera graph, the source shader/material, PlayerSettings and the particle-entity prefab's GameObject/Transform. The existing descriptor-only `compileFieldParticleGeometry` and its rejecting admission check remain unchanged; removing a requirement string cannot qualify that descriptor.

The pure runtime APIs are:

```ts
projectSourceFieldParticleGeometry(definition, particles, parentTransform)
  // -> {quads, cameraPosition, triangles}

renderSourceFieldParticleTarget({
  definition, particles, parentTransform,
  projection: {kind: "source-d3d11-particle-view-projection", matrix},
  textures, engineSeconds, elapsedSeconds
})
  // -> field-effect-sampled-rt-v1
```

`particles` is the live source order supplied by the simulation owner. Each item contains local `position`, final scalar `size`, final Z `rotation` in radians, final `color32`, and `normalizedAge`. The last field uses the engine's **0–100 percent scale**, not 0–1. Geometry leaves the list intact: at age 100 or greater it collapses the corners to the center. Removal belongs to the lifecycle owner. The color is the render job's final Color32 buffer, not the particle seed at SoA offset `0x380`.

The emitter transform is applied once by geometry. Birth shape rotation and motion integration stay with their own providers. A supplied `parentTransform` represents the particle entity's runtime world parent/position, including the manager's allocation along Y; the board's map position must never substitute for it. Only the recovered unit-scale, identity-basis parent branch is admitted. Source emitter Z rotation is supported; arbitrary scale, rotated camera/root and nonidentity ancestors remain explicit errors.

The GPU view-projection is mandatory, including when there are no particles. The shader receives identity object-to-world because the engine already emits world-space billboard vertices. The live camera/GfxDevice projection conversion is not yet bound; an orthographic size alone cannot prove its Y/depth conversion. Tests label their matrices as controlled inputs. No default projection, root transform, clear-frame fallback or Canvas billboard is installed.

The returned frame uses the existing sampled-target contract: source group/camera identity, RGBA8 UNorm, top-to-bottom image rows with Unity V=1 at the first row. It can feed the already prepared board passes and shared main-field compositor. The particle RT itself has no depth attachment. It does not borrow the main field's depth/stencil, and the function stores no actor or simulation state. Every call validates inputs and produces a fresh detached frame before publication.

## Recovered engine branch

The exact UnityPlayer DLL is bound to SHA-256 `7930dbf028be9e3d146a92dc756a166f10cada81f433c49b8fb4eb6767ae9845`. Its official matching PDB has GUID `4420B376-89DD-4CFE-AEC8-2300F4A999D2`, age 1. PDB procedure length establishes that `GenerateParticleGeometry<0,0,0,0>` at `0xd5bfd0` spans 5,825 bytes; one PE unwind fragment is insufficient evidence for its whole body.

The recovered subset requires source Billboard mode 0, View alignment 0, allowRoll=true, minSize=0, maxSize=0.5, pivot/flip=0, sortMode=0, scalar size/Z rotation and disabled UV animation. The five actual cameras and emitters meet these conditions. Their targets are 256², 128², 32², 32² and 32², with orthographic half-sizes 128, 64, 16, 16 and 16. Source near/far, clear color, full viewport and layer-14 culling are retained.

Geometry uses the serialized quaternion directly through the ordinary `SetTRS` branch. Camera-aligned corners use the source maximum projected size, retain zero/tiny sizes, and preserve source live order. Vertex order is A, B, −A, −B; UVs are `(0,1),(1,1),(1,0),(0,0)` and particle indices are `[0,1,2,0,2,3]`. These indices differ from the display board's mesh and are not interchangeable.

The SIMD sine/cosine approximation uses `cvtps2dq` with nearest-even reduction, followed by the exact float32 polynomial instruction order. Replacing it with truncation causes errors at large/multiturn angles; reassociating two polynomial additions produces a one-ULP error even at one radian. Source center transformation likewise adds translation with Z, then Y, then X; moving translation to the end changes the real rotated emitter by one ULP. Both distinctions are independently checked against the DLL instructions.

The probe runs the real `SetMatrices`, TRS, full generator, billboard leaf and vertex/index writers in x64 instruction emulation. It executes the engine's `math::rsqrte_magicnumber` initializer at `0x78920`; a zero-initialized PE BSS image is not the initialized runtime. Only the PlayerSettings object lookup and `free(nullptr)` are injected services, and non-null frees reject the probe. No vertex calculation is replaced with a Python oracle.

## Prefab and target binding

`export_field_particle_geometry.py` now retains the source particle component, GameObject, Transform, both component pointers, parent and child references, and file/object identities. The compiler requires the unique Transform to belong to that GameObject, the component list to match, the prefab parent to be null and local transform to be identity. All Unity IDs remain decimal strings.

GameAssembly `CreateEffect` at `0x574910` instantiates that entity, initializes the effect prefab, reparents it to the runtime effect root and assigns its allocated local Y. `FieldEffectParticleEntity.Init` at `0xe0c570` instantiates the chosen EffectPrefab below it. The serialized prefab closes the local identity transform; it does **not** prove the runtime effect root's world transform. The latter remains explicit.

The project PlayerSettings object is `globalgamemanagers`, path ID `1`, with active color space 0 (Gamma). The target request uses ARGB32, requested sRGB=true, depthBits=0 and one sample. These arguments do not imply an sRGB render target: source native format dispatch selects GraphicsFormat **8**, RGBA8 UNorm, for both sRGB request values in Gamma. The controlled Linear branch selects format 4 when sRGB=true. Four instruction-executed cases verify the distinction; the current compiler admits only the source Gamma settings.

`RenderTexture.Create` and D3D11 depth initialization establish no depth resource/DSV for this source descriptor. The CPU target therefore uses source particle order and never invents a depth test between particles. The point/clamp board sampler consumes RGBA8 directly without an additional Gamma/sRGB conversion.

The CPU rasterizer uses an explicit GPU clip matrix, D3D clip planes, 8-bit subpixel snapping, pixel centers and top-left triangle ownership. Source UNorm fragment values are clamped before blending, then quantized after each fragment; blend is One/OneMinusSrcAlpha. These rules follow the [D3D11 functional specification](https://microsoft.github.io/DirectX-Specs/d3d/archive/D3D11_3_FunctionalSpec.htm) and [rasterization rules](https://learn.microsoft.com/en-gb/windows/win32/direct3d11/d3d10-graphics-programming-guide-rasterizer-stage-rules). CPU float32 interpolation/filter/blend is a functional implementation; exact device precision and native GPU pixels remain unverified.

## Evidence and reproduction

New isolated engine export directories are `build/native/v36-unity-particle-{geometry,target,draw,viewport,transforms,projection}`. They add 27 complete methods to the six v35 methods; every receipt checks DLL/PDB identity, bounded method bytes and decompiled-file digest. `ExportUnityParticleGeometryMethods.java` uses a separate project and cannot reuse a GameAssembly method identity. Original shader bytes, native excerpts, source media and generated frames remain ignored local output.

```sh
.venv/bin/python tools/export_field_particle_geometry.py --source build/runtime/game --output build/v36-field-particle-geometry
npx tsc --outDir build/v36-geometry-dist
node --test build/v36-geometry-dist/tests/field-particle-geometry.test.js build/v36-geometry-dist/tests/field-particle-rendering.test.js
node scripts/check-field-particle-geometry-rendering.mjs --compiled-dir build/v36-geometry-dist
node scripts/check-field-particle-geometry-native.mjs
node scripts/check-field-particle-geometry.mjs --compiled-dir build/v36-geometry-dist
node scripts/check-field-particle-geometry-ui.mjs --compiled-dir build/v36-geometry-dist
.venv/bin/python -m unittest discover -s tools/tests
```

The final isolated results are:

| Lane | Result | What it establishes |
| --- | --- | --- |
| TypeScript | 22/22, including 11 new cases | Source arithmetic boundaries, missing input rejection, size/age behavior, clipping, row direction, alpha/order and fresh storage |
| New source/render check | 467 assertions | Five strict definitions; 88 full-template and 48 leaf vertices equal executed DLL output; four index and four format cases; five actual shader/texture CPU frames |
| Native receipt check | 234 assertions | Four GameAssembly methods plus five raw ranges; 33 UnityPlayer methods plus two raw ranges |
| Existing source shader/board check | 551 assertions | Five source graphs, 25 independent DXBC vertex probes and 288 fragment probes |
| Existing Renderer check | 8 cases | Prepared sampled frames share the main field attachments; controlled Canvas/RT inputs |
| Python | 31/31 at this checkout | Adapter/native-tool tests; exporter and probe syntax compilation also pass |

The five CPU frame cases use **controlled live particles, parent transform and GPU matrix**. Actual source material, texture bytes, geometry branch and target dimensions are retained. These frames do not establish original-game timing, visibility, GPU raster parity or full emitter qualification.

Receipts are `build/reports/field-particle-geometry-{rendering-check,native-check,check,ui-check}.json`; the executed instruction probe is `build/reports/v36-particle-geometry-probes.json`. Run logs use `build/reports/v36-particle-geometry-{tsc,tests,rendering,native,source,ui,python}.log`.

Remaining integration must supply the live simulation's final appearance/order, allocated effect-root transform and source GPU camera matrix from one owner, then prepare the particle target and board passes as one frame transaction. Missing dependencies still reject. No world content, gameplay profile, actor store or renderer fallback is changed by v36 geometry.
