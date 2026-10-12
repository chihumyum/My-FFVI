# Field particle geometry and board composition

v35 separates the particle camera/geometry providers from the board that displays their render texture. The five supplied EffectPrefab graphs now compile to strict source-bound renderer/camera definitions. The particle and board vertex programs, both board fragment passes, and board blending/depth queues have executable CPU translations. The real particle render-texture provider remains unavailable. This work does not admit map 3 particles or establish original-game pixel equivalence.

`Renderer` accepts an optional fourth argument, `effectProvider`. An effect scene without it still fails before touching the visible Canvas. The provider must prepare explicit sampled RT frames, the active-board draw order, and the bound material. Board passes then share the existing ordinary field color, depth and stencil attachments. They never use a Canvas overlay or create another actor owner.

## Source inputs and remaining engine closure

`compileFieldParticleGeometry(assetGroup, exportedGraph, dependencies)` follows the selected prefab hierarchy, with decimal-string Unity object IDs. It validates the renderer and camera, records their transform ancestry and source identities, and keeps missing engine providers explicit.

| Actual group | Orthographic half-size | Target | Emitter local Z rotation |
| --- | ---: | ---: | --- |
| `ef_ff6_m_001` | 128 | 256 × 256 | Quaternion Z −0.026176923885941505, W 0.9996573328971863 |
| `ef_ff6_m_002` | 64 | 128 × 128 | Zero |
| `ef_ff6_m_003` | 16 | 32 × 32 | Zero |
| `ef_ff6_m_004` | 16 | 32 × 32 | Zero |
| `ef_ff6_m_016` | 16 | 32 × 32 | Zero |

All five source cameras have local position `(0, 0, -20)`, an orthographic full viewport, transparent-black clear, near plane float32 `0.3`, far plane `1000`, and native initialization changes culling to layer 14. Renderers use Billboard mode 0, View alignment 0, allow roll, min size 0, max size 0.5, zero pivot/flip, sort mode 0, and vertex streams `[0, 1, 3, 4]`. Simulation space and scaling mode are both 0. The emitter transform remains separate from the vertices supplied to the vertex shader; its rotation must not be applied twice.

The GameAssembly `FieldEffectParticleEntity.Init` at `0xe0c570` requests a square target of twice the camera's half-size, with point filtering and clamp wrapping. Raw source descriptor code at `0x1019180 → 0x1019240 → 0x10190e0` gives **depthBits 0**, MSAA 1 and format argument 0. `0x1019390` changes the format and sRGB flag, and the caller explicitly supplies true. A depth array on the ordinary field framebuffer is not evidence that this particle RT has a depth attachment. The real RT format conversion, gamma/sRGB sampling and GPU projection/raster behavior remain unqualified.

The exact UnityPlayer PDB is bound to GUID `4420B376-89DD-4CFE-AEC8-2300F4A999D2`, age 1, with DLL and PDB digests checked independently. Six geometry methods are recorded:

| RVA | PDB identity | Scope |
| --- | --- | --- |
| `0xd7aaf0` | `ParticleSystemGeometryJob.Initialize` | Job setup |
| `0xd7c720` | `ParticleSystemGeometryJob.RenderJob` | Dispatch and particle indices |
| `0xd7c9f0` | `ParticleSystemGeometryJob.RenderJobCommon` | Geometry variant selection |
| `0xd7ecc0` | `ParticleSystemGeometryJob.ScheduleJobs` | Render-job inputs |
| `0xd88f50` | `ParticleSystemRenderer.PrepareForRenderThreaded` | Camera/transform inputs and sorting branch |
| `0xd5bfd0` | `GenerateParticleGeometry<0,0,0,0>` | 5,825-byte PDB procedure, SIMD expansion not yet translated |

These receipts are static evidence. They do not complete job inputs, billboard expansion, view-size clamping, vertex packing or engine draw ordering. The source particle triangle indices `[0,1,2,0,2,3]` also differ from the already recovered display-board indices `[0,1,2,2,1,3]`; the two meshes cannot be substituted.

`assertFieldParticleGeometryExecutable` currently rejects all five graphs. Clearing its requirements array also fails validation. No default quad generation, RNG, Noise, prewarm or simulated texture is installed by this module.

## Executable shader and board contract

`transformFieldParticleVertex` accepts actual vertex positions, UV/color and explicit column-major object-to-world and view-projection matrices. It reproduces particle vertex program 285's float32 instruction order and passes UV/color through. It does not derive billboard corners from particle centers. The board vertex program follows the same position arithmetic with its independently bound identity UV scale/offset.

The new exporter follows the real `FieldEffectParticleEntity.originalEffectMaterial` pointer into `map_common`, then its external shader pointer back into `chara_field`. The compiler binds these exact identities and the actual `Last/FieldEffectEntityShader` programs. It rejects changed pointers, keywords, duplicate texture properties, shaders and pass states. Original bytecode and assets stay in ignored output directories.

The source material has **two nonexclusive passes**:

1. Multiply texture RGBA by vertex RGBA. Test `alpha × _Color.a >= float32(254/255)`. Multiply all four channels by `_Color.a`, blend, write depth, and replace stencil.
2. Multiply the same inputs. Test the float32 RGB sum against `1/255`. This pass does not test an upper alpha bound. Blend all four channels, replace stencil, and leave depth unchanged.

Opaque colored pixels can execute both passes; opaque black can execute only the first; low-alpha colored pixels can execute only the second. Running both passes per individual strip changes overlaps. The compositor completes a renderer's first pass over its full mesh before running its second pass.

`FieldEffectBoardEntity.Init` (`0x87dc90`) and `MapConstants..cctor` (`0x43b490`) bind the blend choices. Source type 0 overrides the table's SrcAlpha with **One**, destination OneMinusSrcAlpha; type 1 uses One/One; type 2 uses DstColor/Zero. The same factors apply to alpha. The shader's `_Color.a` is already part of the source fragment; publishing through Canvas source-over would apply another incorrect alpha operation.

The ordinary shared queues run in this order:

| Queue | Pass |
| ---: | --- |
| 2450 | Opaque map tiles |
| 2453 | Non-front effect boards |
| 2455 | Character body |
| 2456 | Transparent map tiles |
| 2457 | Character head |
| 2458 | Front affected effect boards |
| 2460 | Front unaffected effect boards |

Board ZTest is LEqual (4) or explicit Always (8). Always does not disable the first pass's depth write. Both board passes replace stencil with 0 for affected boards or 2 for unaffected boards. Ordinary opaque tiles keep stencil, transparent tiles replace 0 and characters replace 2. No unrecovered downstream stencil consumer is inferred. Relative board order within each queue remains a required provider input.

The common framebuffer accepts prepared batches through `composeFieldNativePixels({effects:{material,batches}, ...})`. It validates every batch before rasterizing, uses native clip limits and point sampling, preserves degenerate source strips as zero-area entries, and returns its transient depth/stencil attachments for regression inspection. These attachments are the **main field target**, never a fabricated particle RT.

## Renderer interface and failure behavior

The optional host implements:

```ts
effectProvider.prepare({state, camera, width, height})
  // state and camera are detached snapshots; source viewport is 320 × 180
  -> {material, boardOrder, frames: Map<cameraId, sampledFrame>}

sampledFrame = {
  kind: "field-effect-sampled-rt-v1",
  assetGroup, cameraId, width, height,
  sampleEncoding: "rgba8-unorm",
  rowOrder: "top-to-bottom",
  data: Uint8ClampedArray
}
```

This frame represents separately qualified sampler output, not raw sRGB RT storage. The current real-source pipeline cannot supply it. The CPU interface intentionally does not accept a depth buffer as proof of RT qualification.

`prepareSourceFieldEffectBoards` validates the active-board order, source mesh topology/material mapping and axis-aligned ordinary camera projection, then copies the sampled frame bytes. Later frame mutation cannot change the prepared candidate. Missing frames, unknown encoding, source material mismatch, an invalid later board, or an absent ordinary framebuffer reject the whole visible publication. The successful result is published once via `putImageData`; no material lookup or particle generation occurs during publication.

The existing `prepareFieldEffectBoards` Canvas helper remains a controlled adapter with an explicitly supplied material host. It is not the default source provider. Source building/collision/birdview/screen/minimap and animated fade branches remain blocked in the new adapter. Shared gameplay admission also retains its existing blend/provider gates; the standalone blend kernels do not grant new scene capabilities.

## Reproduction and acceptance

```sh
.venv/bin/python tools/export_field_particle_geometry.py --source build/runtime/game --output build/v35-field-particle-geometry
npx tsc --outDir build/v35-particle-geometry-dist
node --test build/v35-particle-geometry-dist/tests/field-particle-geometry.test.js build/v35-particle-geometry-dist/tests/field-native-composition.test.js
node scripts/check-field-particle-geometry.mjs --compiled-dir build/v35-particle-geometry-dist
node scripts/check-field-particle-geometry-native.mjs
node scripts/check-field-particle-geometry-ui.mjs --compiled-dir build/v35-particle-geometry-dist
node scripts/check-field-native-composition-ui.mjs --compiled-dir build/v35-particle-geometry-dist
node scripts/check-field-camera-ui.mjs --compiled-dir build/v35-particle-geometry-dist
node scripts/check-field-effects-ui.mjs --compiled-dir build/v35-particle-geometry-dist
```

The isolated checks pass: 11 new TypeScript cases plus 18 existing composition cases; 551 source assertions across 5 graphs, 25 vertex probes and 288 fragment probes; 72 native-binding assertions over 3 managed methods, 5 raw ranges and 6 UnityPlayer methods; 8 production-Renderer cases with controlled sampled textures/Canvas. Existing composition UI 13, camera UI 12 and controlled effect UI 15 cases also pass. Python exporter syntax compilation passes. Parent full-project checks are recorded separately.

Source exports are `build/v35-field-particle-geometry`, `build/v33-field-effect-media`, and `build/v34-field-particle-dependencies`. Exact engine exports are `build/native/v35-unity-particle-seeds` and `build/native/v35-unity-particle-emission`. Reports are `build/reports/field-particle-geometry-{check,native-check,ui-check}.json`; isolated run logs use `build/reports/v35-particle-geometry-*.log`.

The source checker evaluates actual DXBC instructions with an independent register interpreter. It does not use the translated TypeScript shader formula to manufacture expected values. Its vertex inputs and matrices are controlled; its fragment samples are controlled. Neither these results nor the renderer checks are native GPU, browser-raster or original-game dynamic acceptance. Formal particle admission remains zero until the remaining engine and RT providers are proven and supplied.
