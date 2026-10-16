# Original Sprite logical canvas media

The `world-media-0.2.0` adapter restores an original Sprite's transparent logical canvas. It does not redraw, resize, recolor, or substitute the image. UnityPy first decodes the exact source Sprite and resolves its Atlas render-data key and packing rotation. The adapter translates its original planar mesh by the source pivot and pixels per unit, then places those decoded pixels into `m_Rect`. It converts the lower-left source coordinates to the top-left PNG coordinates once.

Only integral mesh bounds inside the original canvas are accepted. The decoded dimensions must match those bounds exactly. The RGBA crop must remain byte identical, including colors at zero alpha; all new padding is transparent black. Fractional texture/atlas offsets are retained as evidence and cannot replace the mesh anchor. Unknown packing bits, nonzero UV geometry, nonplanar or subpixel vertices, and downscaled Atlas geometry remain explicit export issues. The installed UnityPy decoder already undoes packing rotation; the adapter does not rotate again.

The current complete source generation has 306 characters. It retains all 2443 previous Sprite records and PNG bytes and adds 179 logical canvases from 27 original character packages. Five genuinely missing named Sprites remain missing. Its media source-set hash remains the hash of the same physical input sources; it is not a claim that the old and new media metadata bytes are identical.

## Private generation and source compilation

Keep the real old `world-media-0.1.0` snapshot. Generate a separate candidate, with an explicit output directory:

```sh
.venv/bin/python tools/source_adapter/test_sprite_logical_canvas.py
.venv/bin/python tools/source_adapter/export_world_media.py \
  --source build/runtime/game \
  --output build/source-sprite-media \
  --reuse-locked-packages build/world-media
```

The optional reuse input is the complete verified old snapshot. Unchanged package Atlas PNG bytes are retained. Every retained full-rectangle Sprite is also decoded from its original source and compared pixel for pixel before its previous PNG bytes and metadata are reused. All 306 character packages are processed; no scene or sprite exception table is used.

The publication owner passes this explicit build input to `compileSharedContentPackages` or `publishContentPackages`:

```js
sourceSpriteMedia: {
  kind: 'source-sprite-logical-canvas-input-v1',
  input: 'build/source-sprite-media',
  baselineInput: 'build/world-media'
}
```

The input lock becomes `source-prerequisite-input-lock-v6`; `baseLockKind` retains the existing v1 through v5 cohort. Older lock versions reject the new media generation. Both local input directories, real paths, complete snapshot files, metadata, PNG bytes, exact comparison owner, and original source package bytes are fenced. Missing or changed baseline/candidate inputs reject. The new directory cannot be a public content collection or the same physical directory as the baseline.

`compileWorld` and `compileSourceNewGame` receive the candidate directory explicitly. The pipeline normally pure-compiles both complete source worlds with the same current compiler and different real media inputs. `verifySourceSpriteMediaPair` validates every old record/file, the exact 179 additions, original issue bindings, the projection domain, and actual PNG crop/padding pixels. `createSourceSpriteMediaComparison` then verifies the entire 649-map delta. Only those Sprite additions, newly available animations/import observations, and exactly derived character/pose diagnostics may differ. Any other map body or existing character change rejects.

Comparison copies project those verified fields to the real old generation before the existing source recipe, animation import, NPC pose, framework, owned-state, and dependency guards run. Both actual generations and historical recipe pins remain untouched. Historical kind10 rows absent before their independent animation import receive no invented pose diagnostic. The complete candidate retains every remaining unsupported shader, tint, missing asset, mechanism, and script diagnostic. No save supplies this comparison owner or grants a media provider.

The publisher's `/world-media/` reads map to the same explicitly fenced candidate directory. Original URLs and the retained old media bytes remain available; the existing archive converts them to digest-addressed media. Restoring a package uses that package's verified content and media identities. This resource generation adds no GameState owner or save capability and changes no character/party initialization.

## Validation boundary

For this source corpus, the two real generations restore 153 animations and remove 242 exact `Missing character pose` diagnostics in 28 groups across 22 maps. They do not make any additional default entity group wholly ready. All 649 original map bodies and their other diagnostics remain present. Original PNG tests and controlled CPU Canvas tests exercise the actual production Renderer and original logical anchor in both horizontal directions. These results do not claim native material parity, browser acceptance, original-root story execution, or a complete playable campaign.
