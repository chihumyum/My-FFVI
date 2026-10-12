# Field effect boards and shared particle players

The current runtime has one `FieldEffects` owner for source kind 11 boards, a prepared particle/material host, and FieldGame dispatch. It does **not** implement the five real Map3 Unity particle effects. Those source objects remain in the compiled entity group with precise provider blockers. The controlled renderer and tests prove host plumbing and state semantics; they do not prove the original game's images, timing or playability.

## Source identity and evidence

This investigation binds the supplied `GameAssembly.dll` SHA-256 `1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`. Native receipts retain the DLL, symbol and header digests and `semanticsVerified: false`. No Windows or Unity player was run.

`MapConstants.ObjectType.EffectEntity = 11` selects `FieldEffectBoardEntity`. `MapManager.CreateEntity` (`305420`) separately asks `FieldEffectInstanceManager` for a particle player, then initializes a board against that player's material and render texture. A board is neither a sprite character nor a placeholder decoration. It must not enter the physical actor collection.

| Source entry | Recovered responsibility |
| --- | --- |
| `9f2440`, constructors `9f25c0` / `43e0c0` | Property defaults, nullable front/split/collision, building overrides, source z offset |
| `574910`, `574790`, `575200` | Shared player allocation, camera identity, reference counts and last release |
| `87dc90` | Clear render texture for every board, mesh/UV/depth strips, material queue, reference registration |
| `575400` | Register players selected by boards, deduplicate cameras, distinguish full setup and group update |
| `e0c570`, `e0cc30`, `e0cc60`, `e0d030`, `e0d060` | Particle prefab initialization, play/stop, loop completion and shader elapsed time |
| `87f570`, `87dc00` | Zero-duration board Show/Hide writes alpha and activity without stopping the shared player |
| `87f320`, `87f260`, `87f760`, shared `2c8ef0` | Board animation overload, playback query, and exact empty Cue override (`ret 0`) |
| `9eb2f0`, inherited `3750c0` | Particle update mask 42; board update mask 2 |
| `308cf0`, `3083c0`, `352d90` | Default-first creation, layer/property array order, direct group activity separate from Show/Hide |
| `b27340`, `309e30` | Raw object pixels to native map position and out-of-range standby placement |

The receipts are in `build/native/v33-field-effect-lifecycle`, `v33-field-effect-control`, `v33-native-map-hosts`, `v33-field-pools-targets`, plus older source batches enumerated by the native checker. Ghidra mislabels the managed write barrier in board `OnDestroy` as non-returning; the checker also binds its actual raw tail, which calls interface Release before base destruction.

## Ownership and transaction contract

`FieldEffectState` holds boards, shared particle players, camera IDs, reference counts and registration order. The current scene has exactly one such owner. Neither `actors` nor `hiddenEntities` stores a second effect copy.

`projectFieldEffects(state, catalog, operations)` builds one disposable candidate for an ordered operation list. `FieldEffects.prepare(operations)` obtains a host transaction and returns `{ state, validate, commit }`. Preparing or rejecting a stale candidate does not change the logical owner. A host must prepare its material, texture and particle changes without publishing; its commit installs prepared state and must not fail.

The FieldGame runtime host additionally implements `observe(state, deltaSeconds)`. It supplies read-only candidate `ParticleSystem.isPlaying` observations for exactly the active, registered, playing particle players. It must not advance or publish a different particle owner before preparation succeeds. Missing, duplicate or mismatched observations reject that update.

FieldGame exposes `fieldEffectsSnapshot` for the renderer. `FieldContent.fieldEffects` contains the media catalog; `FieldGameOptions.fieldEffects` supplies the explicit runtime host. Content parsing does not grant that host. The renderer component requires a frame per shared camera, native-coordinate projection and a prepared material/depth implementation. It does not choose ordinary Canvas source-over as a substitute for Unity shaders.

Each effect transaction is atomic. **The whole FieldGame frame is not an all-owner rollback transaction.** FX ticks follow the existing field update sequence. The Web scheduler delivers 10 ms logical updates; this is not a measured reproduction of native frame cadence.

## Recovered semantics

- `play_on_awake` defaults true. In `CreateEntity`, it supplies both sharing and automatic-play behavior. Shared boards with the same asset group refer to one particle player; every board still clears its render texture and adds one reference. Non-awake boards allocate separate players.
- New player camera IDs and off-map vertical placement preserve source allocation order. `SetupActivate(false)` shows selected players and hides unused ones. `SetupActivate(true)` unregisters the previous selection and registers the new selection without hiding unselected players. The selected board order determines camera registration order.
- Zero-duration board Show/Hide changes `activeSelf`, `fadeAlpha` and the zero fade state. It does not start/stop shared playback. Direct map-group `SetActive` changes only activity, so inactive/alpha-one and active/alpha-zero states are valid.
- Play restarts the effect child and resets loop count. It does not reset shader `elapsedSec`. A nonpositive requested limit derives indefinite playback from any looped emitter, otherwise one completion. For a positive limit, only non-looping particles' actual `isPlaying` postpone completion. The source can therefore complete an explicitly limited playback of a looped emitter on an update.
- Particle `GetUpdateAttribute` returns `42 = Field(2) | Message(8) | FieldReady(32)`. This differs from the board's inherited mask 2. The player clock can continue while a board is hidden or ordinary characters are paused by a message.
- The string board PlayAnimation overload reads only nullable mode. Explicit mode zero selects limit one; other or absent mode selects the automatic limit. The admitted Puppet.PlayAnim decoder maps source count 0/1 to mode zero and negative count to mode one. Key, time scale and flip are ignored by this particular native override. Board CueAnimation is a proven empty override. A non-looping script action waits on the shared player's actual playback state.
- Default map objects are created before the event dictionary. Each group retains native layer-array then property-array order. This batch admits **default-only effect pools**. Any effect in any event group prevents construction; unknown dictionary insertion order is not replaced with JavaScript object enumeration or lazy creation on activation. FX-free event group activation reuses the existing default pool and runs group setup.
- Position input uses raw source pixel geometry and native mapRange, not normalized legacy collision coordinates. Layer 0–3 maps to native 9–12 with Z 349/249/149/49. The source top boundary is exclusive; out-of-range placement needs the bound standby transform. Unsupported overflow is rejected. Front/zOffset modifies local mesh depth and is not applied twice to the entity transform.
- Mesh generation preserves native signed remainder, odd strip counts, and zero-area tail strips. UVs and render queues remain source parameters; sorting, clamping or flattening them would change composition.
- Last release removes the live player and reference-count entry but leaves the source shared dictionary entry. Reuse of a dangling shared entry is explicitly rejected. The runtime does not invent cache deletion or a replacement camera.

## Real Map3 diagnosis

Map 3 (`Map_20010`) has 15 kind 11 default boards, in source object order:

`515, 520, 518, 521, 522, 523, 524, 525, 517, 516, 526, 519, 532, 533, 534`.

Its 24 event groups have no kind 11 boards. All default boards lie in `CeilObject`, use 16×16 source object geometry, enable awake/front/split/affected, disable collision/building/birdview/depth override, and use blend type 0. Their raw z offset -1 becomes effective 2 through the native front rule.

| Asset group | Boards | Runtime emitters | Derived render texture |
| --- | ---: | ---: | --- |
| `ef_ff6_m_001` | 8 | 1 | 256×256 |
| `ef_ff6_m_002` | 1 | 1 | 128×128 |
| `ef_ff6_m_003` | 2 | 1 | 32×32 |
| `ef_ff6_m_004` | 1 | 1 | 32×32 |
| `ef_ff6_m_016` | 3 | 1 | 32×32 |

Each bundle also contains its original named prefab. The runtime loads **`Prefabs/EffectPrefab`**, so counting every ParticleSystem in the bundle would double the actual emitter count. The exporter follows that exact GameObject/Transform graph, records external files and keeps every Unity path ID as a decimal string. Render texture dimensions are truncated float32 `(orthographicSize * 2)`, not copied from the serialized placeholder texture.

The five actual runtime emitters require NoiseModule, automatic random seeds, prewarm and other enabled Unity modules. Material, shader and texture dependencies are preserved with exact local/external pointers. `compileFieldEffectMedia` reports these dependencies; it never clears them after successfully parsing a prefab. Actual objects therefore fail runtime admission before either an owner change or renderer preparation.

Ignored diagnostics:

- `build/v33-field-effect-media/media.json` and `snapshot.json`: source-bound raw graphs; selected source-set hash `c3f1c91286f1d4f75eab92fce74182d2cd8e205d3aa445d993d5316c3ea6fde6`.
- `build/reports/field-effects-check.json`: 15 exact board descriptors, native placement/mesh hashes, 5 actual prefab descriptors and precise blockers.
- `build/reports/field-effects-native-check.json`: receipt, native-range and raw-interface bindings.
- `build/reports/field-effects-ui-check.json`: controlled Canvas draw-call assertions, not browser or native screenshots.

## Deliberate boundaries

Nonzero board fades, color fades, building/collision behavior, birdview/screen/minimap effects, nonzero blend-table behavior, animator-driven effects and unimplemented particle/material providers remain blocked. Generic effect movement/attachment is not added by admitting Show/Play.

A logical FX snapshot omits Unity particle/RNG internals and is **not** a stable save codec. FieldGame checkpointing with an effect pool is blocked. Source native-actor preparation and destination map allocation cannot call a real particle provider's commit on a still-discardable candidate; they require a future joint allocation/cancel/retirement transaction. WorldSession rejects source-map effect retirement and destination-map effect allocation before changing owned state or preparing a new field. A hidden or stopped pool is still owned and cannot simply be discarded.

## Repeatable checks

Run against the parent's current compiled tree, or use the isolated `build/v33-entity-dist` path:

```sh
.venv/bin/python tools/export_field_effect_media.py --source build/runtime/game --groups ef_ff6_m_001,ef_ff6_m_002,ef_ff6_m_003,ef_ff6_m_004,ef_ff6_m_016 --output build/v33-field-effect-media
node --test build/v33-entity-dist/tests/field-effects.test.js build/v33-entity-dist/tests/field-effects-runtime.test.js
node scripts/check-field-effects-native.mjs
node scripts/check-field-effects.mjs --compiled-dir build/v33-entity-dist
node scripts/check-field-effects-ui.mjs --compiled-dir build/v33-entity-dist
```

The focused suite has 15 pure/compiler tests and 7 FieldGame/WorldSession integration tests. It covers source geometry, independent activity and alpha, shared references, ordered setup, loop observations, provider failure/staleness, real-decoder board dispatch, duplicate-owner prevention and map/save refusal. The native checker covers 27 receipt-backed methods, 12 raw bindings and 20 semantic bindings. The source checker has 22 assertions across 15 real boards and 5 real prefabs, with zero source prefabs admitted and zero renderer prepares. UI checking has 15 controlled assertions and three draw calls. These lanes do not count as playable Map3 coverage or original-game comparison.
