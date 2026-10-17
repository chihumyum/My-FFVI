# Source particle modules and material kernels

The v34 particle work delivers executable scalar/color module sampling, the actual selected `Last/LastEffectMaster` fragment calculation, source texture sampling, and a private RGBA raster candidate. It does **not** deliver an executable native emitter or a production field-effect renderer host. All five real emitters still fail admission. The existing Map3, map-transition and stable-save gates remain necessary.

These are separate evidence lanes: source object identity, public Unity mode semantics, independent DXBC evaluation, controlled raster tests, browser rendering and original-game behavior. The first four have checks here. No original Unity player or browser particle simulation was run, and `semanticsVerified` remains false.

## Source closure

`tools/export_field_particle_dependencies.py` consumes the existing source-bound `EffectPrefab` graphs and explicitly selected `shaders` and `effects_textures` bundles. It validates the corpus manifest and source bytes, resolves external CAB/PPtr identities, selects one shader subprogram for the exact keyword set, and exports mip-zero textures without losing decimal-string path IDs. It also binds the real `PlayerSettings` object in `globalgamemanagers`; this built-in object has file/object identity, not an invented `Assets/` path.

The exported dependency source-set digest is `0064334e4aa8ccd412a20a37f414e2b3e8f9e7a92aea9566a938450b854e3491`. Its parent corpus is `8aa0cbb9b09808824a8b4644ccdc5f2d57be1788ba11146a539e663328ac52ed`. The package records the effect-media digest, all selected source digests, shader binary digests, texture byte digests and the separate PlayerSettings digest.

The runtime graph contains one emitter per group. The original named prefab elsewhere in each bundle is not another runtime emitter. Values below are shortened for readability; the compiler retains serialized float values.

| Asset group | Enabled modules | Rate / second | Lifetime | Start size | Start speed |
| --- | ---: | ---: | --- | --- | --- |
| `ef_ff6_m_001` | 8 | 10 | 4.5–5 | 24–42 | 0 |
| `ef_ff6_m_002` | 8 | 14 | 3–3.5 | 24–36 | 0 |
| `ef_ff6_m_003` | 7 | 8 | 0.30–0.64 | 10–14 | 8–12 |
| `ef_ff6_m_004` | 7 | 8 | 0.30–0.64 | 10–14 | 10–14 |
| `ef_ff6_m_016` | 7 | 8 | 0.30–0.64 | 10–14 | 10–14 |

All five have Initial, Emission, Shape, Noise, lifetime Color and lifetime Size. The first two also enable Velocity and lifetime Rotation; the other three enable RotationBySpeed. All use local simulation, hierarchy scaling, speed 1, looping, duration 1, capacity 1000, automatic seed acquisition and prewarm. Their time-zero burst has constant count **1**; its inactive `minScalar = 30` must not become the burst count. Shape type 4 is Cone, not ConeVolume. Reversed random rotation endpoints are preserved rather than sorted.

All five Noise modules use high quality, frequency about 0.32, strength 1, damping, one octave, scroll speed 0.1 and position amount 1. The serialized values do not supply the private Curl/Perlin implementation or random stream.

The exact material reference matters: `ef_ff6_m_016` uses the external `ef_ff6_m_004` material, object `4366549275353272539`. It does not use the similarly named local 016 material. There are five bindings, four material objects, one selected shader variant and three texture objects.

## Executable module contract

`compileFieldParticleModules(assetGroup, rawEffectGraph)` validates the graph and returns `FieldParticleModules`. It retains emission, Shape, Noise, seed and prewarm requirements and their unresolved dependencies. Unknown enabled modules are rejected, not dropped.

The core exposes:

- `evaluateParticleCurve` and `evaluateParticleColor`: explicit mode, time and random interpolation input.
- `createFieldParticleBirth`: initial parameter sampling from twelve named random inputs supplied by the caller. It does not acquire or advance a PRNG.
- `sampleFieldParticleAppearance`: lifetime size and RGBA multiplication, retaining the birth's random channels.
- `sampleFieldParticleRates`: animated velocity, angular rate and gravity multiplier. It does not integrate particle motion or Noise.
- `assertFieldParticleEmitterExecutable`: explicit rejection of incomplete emission plans. Removing their diagnostic strings cannot grant execution.

The public mode mapping and interpolation order are bound to Unity's **2019.4.20f1** reference tag, commit `a4fc5011a29781c15e3ee181f19d80dc7fbab19f`: [ParticleSystemStructs.cs](https://github.com/Unity-Technologies/UnityCsReference/blob/a4fc5011a29781c15e3ee181f19d80dc7fbab19f/Modules/ParticleSystem/Managed/ParticleSystemStructs.cs) and [ParticleSystemEnums.cs](https://github.com/Unity-Technologies/UnityCsReference/blob/a4fc5011a29781c15e3ee181f19d80dc7fbab19f/Modules/ParticleSystem/Managed/ParticleSystemEnums.cs). In particular, TwoCurves has one shared multiplier, constant mode reads the active scalar, and RandomColor samples by the explicit random factor. The reference files remain ignored research data under their reference-only license; repository code contains an independently written implementation.

Unweighted curve segments use their source key values and tangents with cubic Hermite interpolation. Color and alpha gradient key timelines are independent; serialized times are decoded from unsigned 16-bit values. These numeric kernels have semantic regression tests, not a claim of native bitwise equivalence. Weighted curves and fixed-gradient boundary semantics are refused. Serialized pre/post-infinity code 2 is not guessed from a similarly numbered public enum: queries outside the actual key interval fail. This affects later samples of the real 001/002 velocity curves, whose final keys precede lifetime end.

Lifetime module roles are documented in Unity's [Color over Lifetime](https://docs.unity3d.com/2019.4/Documentation/Manual/PartSysColorOverLifeModule.html), [Size over Lifetime](https://docs.unity3d.com/2019.4/Documentation/Manual/PartSysSizeOverLifeModule.html), [Velocity over Lifetime](https://docs.unity3d.com/2019.4/Documentation/Manual/PartSysVelOverLifeModule.html) and [Rotation by Speed](https://docs.unity3d.com/2019.4/Documentation/Manual/PartSysRotBySpeedModule.html). Rate projection does not choose the engine's integration order.

## Actual material and texture execution

The shader uses the exact keywords `ALPHA_EDGE_ON`, `CUTOFF_ON`, `GRDIENT_ON`, `MASK_ON`, `NOISE_ON`, `PREMULTIPLYALPHA_ON`. Compilation requires the recovered binaries:

| Stage | Index | SHA-256 |
| --- | ---: | --- |
| Vertex | 285 | `cc1c31f410babbf1d6f7cc837871cc885019379db245a8273bfb8f69c64fbdad` |
| Fragment | 655 | `75c814aca4b802512f88f5c9c6ea4cef7d925c3cb4c5d39fd59e55e8490754ff` |

`compileFieldParticleMaterial` requires the source gamma project setting, exact state bindings, normalized target blend mode, no depth writes or bias, LEqual depth test, no stencil mutation and the actual texture sampling metadata. It refuses missing color-space provenance, different shader variants, unsupported texture transforms, additional mips and unsupported raster state.

The three exported textures are `EF_Noise15_YN` (128², point/repeat), `EF_Smoke13_SA` (128², linear/clamp), and `EF_Noise01_AK` (256², linear/repeat). All have one mip. Raw RGBA export uses top-to-bottom rows; the core sampler explicitly converts bottom-left UV coordinates and implements the source filter/wrap rules.

`shadeFieldParticle` executes the recovered fragment algebra: noise-texture UV distortion, main-channel gradient, mask-red/main-alpha multiplication, strict cutoff, alpha-edge smoothstep, vertex color, emission and premultiplied output. `_BuiltInTime` selects the supplied global clock or the shared particle player's supplied elapsed clock. The selected bytecode uses `_NOffsetX` on both UV components and does not read `_NOffsetY`; the translation preserves that behavior. Material texture distortion is distinct from the still-unimplemented ParticleSystem NoiseModule.

The source checker independently interprets the actual DXBC register instructions. It does not compare two copies of the translated formula. Across 225 material/UV/time/alpha probes, including 15 surviving fragments, the largest channel difference is `5.960464477539063e-8`. The chosen tolerance allows CPU/GPU arithmetic differences; this is not a native GPU test. Vertex bytes are identity-bound, but native billboard geometry and the vertex transform lifecycle are not granted by that binding.

## Private raster candidate

`apps/game/field-particle-renderer.js` exposes `prepareFieldParticleFrame(input, kernel)`. Input supplies the render target, immutable depth attachment, already-projected particle billboards in explicit order, material, source textures and clocks. The result contains counters, cloned `pixels()` and an explicit Canvas `present()` operation.

Preparation computes into a private premultiplied RGBA8 buffer. It validates all required media and geometry before shading. A later fragment failure also leaves input attachments untouched. LEqual reads depth without writing it; blending uses source One / destination OneMinusSrcAlpha. Unsupported output alpha outside the normalized range fails rather than guessing another target format. Canvas publication converts premultiplied RGB to its required representation once.

This component has a controlled pixel-center billboard coverage rule. It is not a replacement for the native particle vertex generator, D3D triangle rasterization, camera allocation, transparent sorting or board composition. The five generated material swatches use fixed explicit test geometry and clocks. They must not be installed as static stand-ins for the game's smoke.

## Remaining emitter and owner dependencies

The shortest actual-emitter closure still requires the following source providers together:

1. Automatic seed acquisition, seed serialization and per-module draw ordering. Supplying twelve test samples is not this provider.
2. Cone sampling and the source transform order, including which samples are consumed even by constant/disabled parameters.
3. Native Curl/Perlin Noise permutation, derivative calculation, offsets, damping and timestep behavior. Unity's [Noise documentation](https://docs.unity3d.com/2019.4/Documentation/Manual/PartSysNoiseModule.html) establishes the algorithm family, not those private implementation details.
4. Emission/burst timing, fractional emission, birth substeps, capacity/death order, motion integration and initial color quantization. [Prewarm](https://docs.unity3d.com/2019.4/Documentation/Manual/PartSysMainModule.html) describes a simulated cycle, but does not establish its exact stepping or seed state.
5. The shared effect pool's map-lease and renderer lifecycle. v34 source evidence shows that MapManager copies the `FieldEffectInstanceManager` pointer; a map-local emitter rebuild must not reset its counters, camera allocation or caches. This particle module owns none of those resources.

The actual five emitters therefore remain `admittedEmitters: 0`. No change was made to the previous field-effect compiler gate, FieldGame, WorldSession, the main renderer, or save codecs by this line.

## Repeatable checks

```sh
.venv/bin/python tools/fetch_unity_particle_reference.py --output build/v34-unity-reference
.venv/bin/python tools/export_field_particle_dependencies.py --source build/runtime/game --media build/v33-field-effect-media/media.json --bundles shaders,effects_textures --output build/v34-field-particle-dependencies
npx tsc -p tsconfig.json --outDir build/v34-particle-dist
node --test build/v34-particle-dist/tests/field-particles.test.js
node scripts/check-field-particles.mjs --compiled-dir build/v34-particle-dist
node scripts/check-field-particles-ui.mjs --compiled-dir build/v34-particle-dist
.venv/bin/python -m unittest discover -s tools/tests
```

The focused suite passes 14 semantic tests. The source checker passes 204 assertions, 75 real lifetime appearance samples and the 225 DXBC probes. The raster checker passes 11 controlled cases and five real-material swatches; each swatch exercises both visible and discarded fragments. The existing Python suite passes 22 tests. Public aggregate validation is performed separately by the integration owner.

Ignored outputs are `build/v34-field-particle-dependencies`, `build/v34-unity-reference`, `build/reports/field-particles-check.json`, `build/reports/field-particles-ui-check.json`, and `build/reports/field-particle-swatches`. They retain original assets and research material locally and are not repository content.
