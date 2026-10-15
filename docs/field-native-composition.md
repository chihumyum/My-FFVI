# Ordinary native field composition

v98 adds the ordinary actor fade inputs and conditional body/head depth writes, described in [shared story lifecycles](story-shared-lifecycles.md). The bound material alpha participates in both VS and PS before the existing head RT overlays; the flat Canvas route remains an explicit Web presentation policy. Riding/special-material and GPU parity limits remain. References below to rejecting all actor fades describe the earlier v33/v34 scope.

v34 supplies the ordinary nonempty UpperLayer/CeilLayer render targets to the shared CPU compositor and real Canvas renderer. The source camera renders at 320×180 for the admitted 16:9 configuration; the Web display is point-resampled only after that source framebuffer is complete. This extends v33's body/head material implementation. Native shadows, particles and other actor/material modes retain their separate boundaries; a ready ordinary compositor does not certify a playable map.

The original build is identified by `GameAssembly.dll` SHA-256 `1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`. No original shader bytecode, textures or decompiled source is committed. The native checker reads ignored local inputs and validates their identities.

## Content and ownership

`loadFieldCompositionRenderHost(root, sources)` verifies the native source identity plus the actual boot scene and PlayerSettings files. Its fixed same-build descriptor preserves their hashes and object IDs, including PlayerSettings object `1` in `globalgamemanagers`. The world compiler loads this once and passes it to `compileFieldNativeComposition(sources, view, tilemap, renderHost)` alongside the complete source ordinary actor view, raw tilemap, character and map materials and shaders. The resulting `FieldNativeCompositionDefinition` contains the full actor-view definition, map/package hashes, shader/material identities, layer presence and per-target capability. It is attached to `FieldContent.map.nativeComposition`. Omitting the fourth parameter does not qualify nonempty targets.

Layers are declared by their actual source presence. An existing empty UpperLayer still causes source camera and texture binding; it is not equivalent to an absent layer. The statuses are:

| Status | Proven condition | Current host |
| --- | --- | --- |
| `disabled` | Layer absent | Null attachment |
| `clear-only` | Layer present; complete source tile array contains no nonzero GID | Alpha-zero sample, independent of target size |
| `unresolved` | Layer contains a nonzero tile but lacks the bound allocator | Reject before publication |
| `source-rendered` | Nonempty layer and complete ordinary source RT host | Per-frame transparent mesh raster at 320×180 |

`validateFieldNativeComposition` verifies its actor-view binding. Renderer validation also compares each actor's complete current `viewBinding.properties` with `projectFieldActorView(definition.view, layer)`, including the two source content hashes and map size. It does not read a nonexistent `FieldContent.actorView` or accept an arbitrary texture filename as native proof.

`fieldCompositionActorTextures` implements `AttachTransparentTexture` (0x878af0): native Unity layer 9 receives Upper then Ceil, layer 10 receives Ceil then null, other layers receive nulls. Native layer numbers are not Web logical layers. The map providers create deterministic map-bound texture tokens; tokens establish identity, not allocation capability.

`prepareFieldCompositionTargets(definition, {width, height, tiles})` builds the two transient source targets from prepared layer-labelled tile quads. `composeFieldNativePixels` receives those pixels with the main map and actor quads. Neither function owns actors, events, cameras or saves. The renderer reads the existing `FieldGame.actors` owner and source camera projection, prepares every dependency before changing the visible Canvas, and publishes one completed image. Hidden unplaced residents retain their null direction and animation state. `scaleFieldCompositionPixels` copies nearest source RGBA pixels to the same-aspect display; it neither adds a second alpha blend nor feeds display dimensions back into the source camera.

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

This is a source-bound fragment and Web publication implementation, not GPU framebuffer or browser color-management equivalence. The source project is Gamma, confirmed from its actual PlayerSettings; its ordinary RT format is `GraphicsFormat.R8G8B8A8_UNorm` (8), with depth 24 and point filtering. The CPU staging target preserves RGBA8 storage between prepass and head sampling. The original final camera postprocessing and GPU/dynamic framebuffer comparison are not claimed by the Web point-display path.

## Position and depth

`FieldCharaEntity.UpdateVisualPosition` (0x2f4670), `CalcInRangeVertex` (0x9e9840), map-layer setup and offset updates provide the depth inputs. This does not sort a complete actor after one chosen map layer.

The four ordinary layer base depths are 350, 250, 150 and 50. A tile row adds `2*(centerRow-localRow)-2`; the source mesh-window clamp cancels the corresponding parent-depth shift. The center uses the actual unclamped camera coordinate before mesh-window limits.

Actor depth uses its source native Z, Y relative to camera, the nonpositive part of the current sprite's Y offset, serial character offset plus two, `clampTileSubY`, and the actor-owned `CharaZOffset`. The native round helper uses ties to even. The FF6 serial offset is six, verified from the original constant and getter; it cancels the prefab Offset Y of minus six for sprite placement. The player retains its PointIn-initialized `CharaZOffset=0.5`; map NPCs retain their own source value. The legacy bottom-minus-two sprite anchor is not used for this native branch.

Renderer input currently requires the ordinary nonloop camera, 16-pixel tiles, complete source view bindings and source sprite geometry. Riding, body semitransparency, actor fade and mixed unbound visible actors remain explicit gates. Legacy/development actors without this native composition capability retain their previous renderer, including overview and its tile/marker-only behavior.

## Source render-target lifecycle

The v33 boundary was real: the source scene has null initial `targetTexture` values and the `CommonCamera` table (0x4ade00) only assigns Field targets to cameras 0/12. The missing owner is `FieldController.Initialize` (0x2dbcc0). Its normal loop obtains cameras 23/24 through `GetTransparentRTCamera(index, false)`, copies CameraTileMap's orthographic size and RT width/height/format/depth/filter, assigns each newly allocated target, and destroys a previous non-null target. A separate bird loop is outside this ordinary capability.

`FrontRenderTarget.ResetRenderTargets` (0x4b1ea0) initializes Field with source height 1080, divisor 6 and filter 0. The unmanaged aspect constructor (0x4b4a50) computes `height=1080/6` and `width=height*aspect.x/aspect.y`, giving 320×180 at 16:9. Its static constructor (0x4b48c0) supplies graphics format 8 and depth 24; `CreateRenderTextureCommon` (0x4b4770) creates that descriptor. `ChangeViewNormal` (0x2d5880) obtains Field target height/2, giving orthographic size 90. The browser's 512×288 display must not become an orthographic size of 144. Other aspect/letterbox providers remain explicit gates.

The real scene camera objects 165/160 have full normalized viewport, orthographic size 90, near float32(0.3), far 300, no MSAA, clear flags 2 and transparent gray `(24/255,24/255,24/255,0)`. They are zero-offset children of CameraTileMap's transform at native Z=-50, and cull only Unity layers 24/25 respectively. Thus the prepass consumes only transparent Upper/Ceil meshes, not the opaque meshes or actor sprites. Its world depth range is approximately -49.7…250, distinct from the main tile camera's far plane. Source `MapSetup` enables the corresponding cameras by layer presence, clears and disables a previously active absent layer; `Destroy` destroys and clears the texture assignment. Rebuilding CPU staging textures each frame prevents old content from leaking after tile or map changes.

A half-alpha blue tile over the source clear produces `[12,12,140,64]`, including squared alpha. Sampling that RT over an opaque red actor yields `[194,3,35,207]` in the head pass. The body instead keeps the ordinary main transparent result `[127,0,128,191]`. The two targets are sampled sequentially, with top-down exported pixel addressing bound to the source screen-UV projection. Opaque alpha-255 pixels never enter this prepass and still occlude via the main depth buffer; alpha 254 belongs to both source map passes.

Map 3's 953 nonzero Upper and 102 nonzero Ceil tiles now qualify with this provider. Its separate particle dependencies still apply. Map 609, with only BottomLayer, uses the same source-size framebuffer and null attachments. These are source mechanism samples; runtime code contains no map-ID exceptions.

The Initialize Ghidra C export is truncated before the allocator loop. The checker therefore validates the complete original method range and its exact calls/loop branch against raw PE instructions. The two native constructor ranges are independently bound to PE exception boundaries; the managed next-symbol range and the one-byte fallback exports are not accepted as complete methods.

Native character shadow remains the existing development presentation omission. When a visible native actor has `shadowVisible`, Renderer records `{kind:"native-character-shadow", actorId}` once in its readable `presentationOmissions`; it does not clear the gameplay field. The main renderer has no implicit particle renderer: a non-null `fieldEffectsSnapshot` is refused without an explicit particle/material/RT host. The separate effect-board adapter's controlled tests do not supply that missing source provider.

## Checks and limits

```sh
npx tsc --outDir build/v34-composition-dist
node --test build/v34-composition-dist/tests/field-native-composition.test.js
node scripts/check-field-native-composition-native.mjs
node scripts/check-field-native-composition.mjs --compiled-dir build/v34-composition-dist
node scripts/check-field-native-composition-ui.mjs --compiled-dir build/v34-composition-dist
node scripts/check-field-camera-ui.mjs --compiled-dir build/v34-composition-dist
```

The source checker accepts `--source-only` during isolated development before public world rebuild; that mode explicitly reports `publishedChecked=0`. Its default requires exact agreement with both published world maps and verifies their content hashes. It never changes public outputs.

The focused tests cover 18 formula, source-binding, depth, prepass and framebuffer cases. The native check verifies 25 complete methods, four additional raw PE ranges, four shader programs and two character material overrides; it also reads the actual camera hierarchy and PlayerSettings objects. The source check verifies eight original input files, both map definitions, and two real source PNG cases combining Upper/Ceil tiles with a source Tina frame in explicitly controlled viewport positions. It retains negative checks for missing allocator, changed raw tiles, missing shader input and foreign view bindings. Thirteen production-Renderer controlled Canvas cases cover anchor/depth input, atomic failure, native layer 9/10 attachment differences, real head-vs-body target use, frame clearing, fixed source viewport/point display, no double blending, shadow omission, FX-host refusal and hidden residents. The prior camera/overview/background renderer check remains 12/12. None of these checks executes the original GPU or certifies gameplay completion.

Reports are under ignored `build/reports/field-native-composition-{native-check,check,ui-check}.json`. Source/native checks are static and the UI pixel harness is controlled JavaScript, not a browser or original-game screenshot comparison. Parent-host fresh-session replay and browser checks are separate. Nonempty Upper/Ceil RTs, shadows, particle providers, special materials and full original presentation parity remain unfinished; no HD-2D work is part of this delivery.
