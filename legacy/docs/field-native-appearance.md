# Native field actor appearance publication

v32 adds `prepareNativeFieldActorAppearance` for the existing `FieldGame.actors` owner. It consumes one ordered `FieldPartyActorRenderStep[]` from `FieldPartyActors.prepareSequence`, prepares every replacement against a private candidate, and publishes only after complete validation. It never stores another persistent actor collection.

The real source `sc_e_0001` instruction 18 adds type 607 to the three fresh owned characters. Each target invokes an appearance refresh, including an already-present status. This is not yet a request to draw Magitek armor: this build's field condition substitution table contains types 665, 666 and 677, not 607. The normal actor assets therefore remain selected; the later transportation path owns mounting.

## Contract and ownership

`prepareNativeFieldActorAppearance(host, steps)` returns `{ validate(), commit() }`. The host supplies current actors, the party asset catalog, compiled characters, the complete source animation-key index and the material providers. It does not supply an owned roster. The containing transaction calls `validate` before owned state commits, then synchronously publishes the prepared actor changes and camera offset without intervening mutations.

`validate` checks current actor, native payload, entity and animation identities; native pose, playback and asset metadata; source media; the animation-key index; and existing material bindings. A stale candidate or missing dependency changes no actor. `commit` performs only prevalidated plain writes, with no provider callbacks or reads from an already-updated roster. It requires successful validation and can run once.

The existing outer actor, native payload and entity identities survive. Position object, native XYZ, Unity layer, direction (including null), visibility, fade alpha, movement, child identity, riding state, view binding, transparent attachments, body opacity and `CharaZOffset` remain in their current owners. The source PointIn-initialized player retains its corrected `CharaZOffset = 0.5`; actor replacement does not reset it. Only `fieldAssetId`, the animation instance and source shadow visibility are published here. `FieldGame` separately owns the final non-null `cameraOffset` from the ordered batch.

`mode: rider`, an already-mounted actor, custom shadow type 2 and unavailable/custom material bindings remain explicit gates. The supported normal shadow types are 0 (hidden) and 1 (default visible). This module does not manufacture ordinary map NPC factory evidence or enable GPU shader equivalence.

## Source animation semantics

The closed call chain is:

1. Player, party puppet or condition refresh invokes `FieldSpriteEntity.ClearSprite` then `SetAssetStructure`.
2. `SetAssetStructure` saves the previous animation object and dispatches `InitAssetStructure`, which creates a new `SpriteAnimLastFieldEntity` for the new asset.
3. When a previous animation object exists, it calls `OverrideOldData(old, GetMovingAnimName(direction))` and clears the old animation's sprite dictionary. Clearing that dictionary does not reset its selected key or playback fields before the copy.
4. A source key present in the new asset selects that key. `SetupAnimCommon` obtains **new asset** duration, playback mode and flip; the old elapsed time and play state are retained. Native also copies its independent base `isLoop` and `IsEnd` fields; they cannot be inferred from the new mode. The admitted `SpriteAnimLastFieldEntity` paths consume `playingMode`/play/time, not those two base flags: `UpdateAnim` (0xb140f0), `UpdateLinkToMove` (0xb14230), `GetSpriteIndex` (0xb117b0), `SetSprite` (0xb12f40), `Stop` (0xb13f40), and `SwitchNextAnimation` (0xb14010). The VM's `IsPlayingAnim` getter (0xaecb70) reads `isPlay` at +0x20 directly. Thus current observable playback is preserved without claiming a full base-class snapshot. Any future base-class update or `IsEnd` consumer must first extend the animation owner. The new instance's loop counter is zero. Old speed scaling, mode overrides, flip overrides and loop count are not transplanted.
5. If the old key does not exist, source selects the current direction's key, then `Default` if that key is absent. Playback is stopped at time zero. A zero direction selects `Default` without turning the actor down. A present but unsupported animation is blocked, not substituted.
6. If there was no previous animation object, only initialization occurs; no pose is automatically selected. A later refresh can then select `Default` from that existing, initially unselected instance.

The last distinction is observable in the real three-target refresh. The existing hidden `native:party:0` begins with no asset; `ChangePartyEntityAsset` assigns field asset 1 for the enabled leader of party 0. Its first refresh creates an unselected animation. The next target's refresh selects `Default`. Hidden state, off-map native position and null direction remain intact. The unused fourth party puppet keeps its existing asset and unselected animation because the internal condition refresh passes `setDummy=false`.

`InitAssetStructure` retains the body material and copies its `_SrcBlend` and `_DstBlend` factors into the existing head material before rebinding the sprite callback. It does not call map `ApplyViewProperties`, attach transparent render targets, move the actor, change the logical layer or show a hidden actor. Existing ordinary view bindings are validated and preserved rather than replaced with guessed defaults.

## Complete source key index

`compileWorldCharacter` deliberately omits unsupported animations. Its usable animation dictionary therefore cannot establish that an original key is absent.

`compileFieldNativeAnimationKeys(partyCatalog, rawCharacters)` consumes the original `media.json.characters[*].animation.data.animation` lists and emits `FieldNativeAnimationKeys`. Each asset retains the complete ordered key list, original source object identity and raw animation content hash. Duplicate source keys, missing source objects and missing identities are rejected. The world/new-game content binding carries this index; it grants no playback capability on its own.

At runtime the index source must match `Character.source`. A key present in the source index but missing from compiled playback remains an explicit unsupported dependency. Only true source absence allows the native direction/`Default` branch. This also permits ordinary same-asset 607 refreshes to use their already-compiled current poses without requiring every unrelated pose to be implemented.

## Evidence and checks

The source DLL SHA-256 is `1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`. New complete exports in `build/native/v32-native-appearance` bind `SetAssetStructure` (0xaec180), `OverrideOldData` (0xb11ff0) and `ClearSprite` (0xb116e0). The native checker also verifies existing actor initialization, dispatch and playback exports, original PE ranges, symbol/header hashes and the six direction/blend string identities. It uses 18 complete methods plus 4 additional raw methods. These are static evidence, with `semanticsVerified=false`.

Commands (isolated runtime output may be supplied with `--compiled-dir`):

```sh
node --test build/v32-native-appearance-dist/tests/field-native-appearance.test.js
node scripts/check-field-native-appearance-native.mjs
node scripts/check-field-native-appearance.mjs --compiled-dir build/v32-native-appearance-dist
```

The focused run passed 14 tests: replacement playback domains, old-loop/new-once and old-once/new-loop behavior, source absence versus uncompiled poses, hidden/zero-direction actors, old-null animation, sequential repeated changes, exact actor identity, late media failure, stale owner/media/material rejection and one-use publication.

The real-source owner probe passed 5 cases with 55 actors, 3 owned targets, 34 source animation assets and 1,109 byte-verified sprite files. It executes the actual instruction-18 command against fresh source owned state and native actors, repeats the already-added case, exercises a clearly labelled controlled inverse Remove607 command, and rejects missing media or stale poses before owned publication. Reports are `build/reports/field-native-appearance-{native-check,check}.json`.

That probe invokes the command directly after source factory/PointIn. It does not replay preceding title, subtitle, fade or camera clocks. Full fresh-session execution, browser acceptance and camera-offset publication belong to the parent host's separate checks. Original-game dynamic comparison, mounted asset replacement, full shader/head-body composition and native stable-save support are not established by these results.
