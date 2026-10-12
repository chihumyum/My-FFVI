# Ordinary native field composition

v33 implements the ordinary map and character body/head fragment rules in a transient CPU framebuffer, consumed by the real Canvas renderer. It does **not** complete nonempty UpperLayer/CeilLayer render-target allocation or native character shadows. Those distinctions are part of the content capability and renderer receipt, rather than a claim that a map is playable.

The original build is identified by `GameAssembly.dll` SHA-256 `1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`. No original shader bytecode, textures or decompiled source is committed. The native checker reads ignored local inputs and validates their identities.

## Content and ownership

`compileFieldNativeComposition(sources, view, tilemap)` requires the complete source ordinary actor view, raw tilemap, same-build character material, transparent map material and shader bundles. It produces `FieldNativeCompositionDefinition` with the full actor-view definition, map/package hashes, shader/material identities, layer presence and per-target capability. This is attached to `FieldContent.map.nativeComposition` by the world compiler.

Layers are declared by their actual source presence. An existing empty UpperLayer still causes source camera and texture binding; it is not equivalent to an absent layer. The statuses are:

| Status | Proven condition | Current host |
| --- | --- | --- |
| `disabled` | Layer absent | Null attachment |
| `clear-only` | Layer present; complete source tile array contains no nonzero GID | Alpha-zero sample, independent of target size |
| `unresolved` | Layer contains a nonzero tile | Reject before publication |

`validateFieldNativeComposition` verifies its actor-view binding. Renderer validation also compares each actor's complete current `viewBinding.properties` with `projectFieldActorView(definition.view, layer)`, including the two source content hashes and map size. It does not read a nonexistent `FieldContent.actorView` or accept an arbitrary texture filename as native proof.

`fieldCompositionActorTextures` implements `AttachTransparentTexture` (0x878af0): native Unity layer 9 receives Upper then Ceil, layer 10 receives Ceil then null, other layers receive nulls. Native layer numbers are not Web logical layers. The map providers create deterministic map-bound texture tokens; tokens establish identity, not allocation capability.

`composeFieldNativePixels` receives transient image pixels and prepared quads. It has no actor, event, camera or save-state ownership. The renderer reads the existing `FieldGame.actors` owner and source camera projection, prepares every dependency before changing the visible Canvas, and publishes one completed image. Hidden unplaced residents retain their null direction and animation state.

## Recovered ordinary materials

The independent native check validates the source DXBC programs as well as material overrides. Reading only the shader default would incorrectly place the character head before the transparent map pass.

| Pass | Queue | Alpha test | Blend | Depth writes |
| --- | --- | --- | --- | --- |
| Map opaque | 2450 | Alpha >= 254/255 | Replace | Yes |
| Character body | 2455 | Alpha >= 1/255; sprite V <= 0.25 | One / Zero | Yes |
| Map transparent | 2456 | 1/255 <= alpha <= 254/255 | SrcAlpha / OneMinusSrcAlpha | No |
| Character head | 2457 material override | Alpha >= 1/255; sprite V >= 0.25 | One / Zero | Yes |

The boundary V=0.25 belongs to both character passes. V is the normalized bottom-up sprite UV, not a fixed eight-pixel crop: a 24-pixel sprite has a six-pixel body section. The alpha=254/255 boundary likewise belongs to both map passes.

The ordinary head samples the two bound pre-render inputs in order. Each performs an RGBA lerp using that input's alpha; the body does not sample them. The source map transparent blend applies to alpha as well as RGB: `out = source * source.a + destination * (1-source.a)`. For alpha 128/255 over opaque pixels, output alpha is 191/255, not 1. Canvas `source-over` has a different alpha equation.

The Web host therefore prepares its existing clear/background pixels first, passes them as the CPU color attachment, and publishes the result with `putImageData`. Drawing a transparent intermediate with Canvas `source-over` would multiply its colors by alpha a second time. A production-Renderer regression uses a controlled RGBA Canvas and checks `[4,8,141,191]` for a half-alpha blue tile over `[9,17,27,255]`. It also verifies a character's One/Zero fragment preserves `[255,0,0,128]` directly.

This is a source-bound fragment and Web publication implementation, not GPU framebuffer or browser color-management equivalence. The source project is Gamma, confirmed from its actual PlayerSettings; the CPU staging target is RGBA8. Native RT formats and the final original camera presentation still need an independent GPU/dynamic comparison.

## Position and depth

`FieldCharaEntity.UpdateVisualPosition` (0x2f4670), `CalcInRangeVertex` (0x9e9840), map-layer setup and offset updates provide the depth inputs. This does not sort a complete actor after one chosen map layer.

The four ordinary layer base depths are 350, 250, 150 and 50. A tile row adds `2*(centerRow-localRow)-2`; the source mesh-window clamp cancels the corresponding parent-depth shift. The center uses the actual unclamped camera coordinate before mesh-window limits.

Actor depth uses its source native Z, Y relative to camera, the nonpositive part of the current sprite's Y offset, serial character offset plus two, `clampTileSubY`, and the actor-owned `CharaZOffset`. The native round helper uses ties to even. The FF6 serial offset is six, verified from the original constant and getter; it cancels the prefab Offset Y of minus six for sprite placement. The player retains its PointIn-initialized `CharaZOffset=0.5`; map NPCs retain their own source value. The legacy bottom-minus-two sprite anchor is not used for this native branch.

Renderer input currently requires the ordinary nonloop camera, 16-pixel tiles, complete source view bindings and source sprite geometry. Riding, body semitransparency, actor fade and mixed unbound visible actors remain explicit gates. Legacy/development actors without this native composition capability retain their previous renderer, including overview and its tile/marker-only behavior.

## Remaining render-target dependency

The source level has CameraTileMap and two upper/ceiling pre-render cameras. Their initial targetTexture is null. The recovered `CommonCamera` target pool/reset and static camera-group table (0x4b1900, 0x4b1ea0, 0x4ade00) assign the ordinary Field group to cameras 0 and 12. Cameras 23 and 24 are **not** assigned by that table. The upper/ceiling allocation, size/viewport and sampling owner cannot be inferred from the recovered fragment program or normal front render target.

Accordingly, map 3 has 953 nonzero Upper tiles and 102 nonzero Ceil tiles and remains rejected by `assertFieldCompositionRenderTargets`. Map 609 has only BottomLayer and can consume this bounded ordinary body/head path. These are source regression samples; runtime code contains no map-ID exceptions. Missing particle providers are separate from this gate.

Native character shadow remains the existing development presentation omission. When a visible native actor has `shadowVisible`, Renderer records `{kind:"native-character-shadow", actorId}` once in its readable `presentationOmissions`; it does not clear the gameplay field. The main renderer has no implicit particle renderer: a non-null `fieldEffectsSnapshot` is refused without an explicit particle/material/RT host. The separate effect-board adapter's controlled tests do not supply that missing source provider.

## Checks and limits

```sh
npx tsc --outDir build/v33-composition-dist
node --test build/v33-composition-dist/tests/field-native-composition.test.js
node scripts/check-field-native-composition-native.mjs
node scripts/check-field-native-composition.mjs --compiled-dir build/v33-composition-dist
node scripts/check-field-native-composition-ui.mjs --compiled-dir build/v33-composition-dist
node scripts/check-field-camera-ui.mjs --compiled-dir build/v33-composition-dist
```

The source checker accepts `--source-only` during isolated development before public world rebuild; that mode explicitly reports `publishedChecked=0`. Its default requires exact agreement with both published world maps and verifies their content hashes. It never changes public outputs.

The focused tests cover 12 formula, source-binding, depth and framebuffer cases. The native check verifies 19 complete methods, two additional raw PE ranges, four shader programs and two character material overrides; it also reads the actual camera and PlayerSettings objects. The source check verifies five original bundles and the two map definitions, with independent rejection cases for changed raw tiles, missing shader input and foreign view bindings. Eight production-Renderer controlled Canvas cases cover anchor/depth input, atomic failure, no double blending, explicit shadow omission, FX-host refusal and hidden residents. The prior camera/overview/background renderer check remains 12/12.

Reports are under ignored `build/reports/field-native-composition-{native-check,check,ui-check}.json`. Source/native checks are static and the UI pixel harness is controlled JavaScript, not a browser or original-game screenshot comparison. Parent-host fresh-session replay and browser checks are separate. Nonempty Upper/Ceil RTs, shadows, particle providers, special materials and full original presentation parity remain unfinished; no HD-2D work is part of this delivery.
