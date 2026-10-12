# Shared field effect candidate transactions (v35)

`FieldEffects` remains the single logical owner of boards, particle-player identities, reference counts, shared lookup entries, registration order and allocation counters. `FieldEffects.fork()` creates an unpublished branch of that owner. It does not instantiate another live effect manager. Several local `prepare` / `commit` calls can prepare a destination while the current map and external particle host remain unchanged.

This is a Web publication protocol over recovered native effect semantics. It does not implement Unity particle execution, random seeds or prewarm, and it does not make the real Map 3 effects runnable. Those media still retain their source blockers. It is also not a particle save codec or proof of original-game behavior.

## Source lifetime

The existing source receipts and original DLL establish the manager's lifetime:

| Evidence | Consequence for a candidate |
| --- | --- |
| MapManager copy constructor `312160`, raw pointer copy at `312560`, manager field `+0x198` | Destination maps share the original manager. A per-map constructor must not reset its counters or cache. |
| `InitInsitance` `30c5e0`, allocation at `30c809`; `DestroyInsitance` `30aeb0` | Creation and complete manager destruction are separate from ordinary map turnover. |
| `CreateEntity` `574910`, AddReference `574790`, Release `575200` | Each board contributes a reference; shared groups can use one existing player. Last board release removes the player but leaves its shared lookup tombstone. |
| `ReleaseAlreadyLoadPrefabs` `575150`; `ClearMapAsset` `303710` | Source asset release removes loaded-prefab and shared lookup entries without destroying still-referenced players or resetting allocation order. |
| `SetupActivate` `575400`; update `e0d060` | Registration order, full setup versus group update, actual particle observations and float32 elapsed time survive staging. |

The v34 MapManager decompile truncates at write barriers. The pointer-copy and constructor claims depend on the actual DLL bytes checked by `scripts/check-field-effects-native.mjs`, not the truncated C return. The current checker binds 39 method receipts, 12 raw bindings and 23 semantic bindings to DLL SHA-256 `1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`; `semanticsVerified` remains false.

This module executes the order supplied by the map lifecycle. It does not invent when to destroy old boards, release asset caches, load new resources or switch registration. That source order and the retirement of the old FieldGame lease belong to the World owner.

## Owner and host API

`src/core/field-effects.ts` exports the manager, candidate types and `fieldEffectBoardId(scope, localId)`. `src/core/field-effect-transaction.ts` implements the private branch.

| API | Behavior |
| --- | --- |
| `manager.fork(targetCatalog?, limits?)` | Capture the live owner revision and a host generation, then form an exact union with the destination's trusted media catalog. |
| `candidate.snapshot()` / `catalogSnapshot()` | Return detached copies. They never expose mutable owned state. |
| `manager.prepare(operations)` / `candidate.prepare(operations)` | Validate and project every operation without publishing. Both return `validate`, `commit` and `commitWith`; the candidate changes only its private journal. Map leases preserve this contract. |
| `candidate.prepareTick(seconds)` | Ask an explicit private observer, then prepare one tick against that candidate revision. |
| `candidate.seal()` | Close local mutation and ask the host to prepare one complete ordered batch. Returns `state`, `validate`, `commit`, and `commitWith`. |
| `publication.commitWith(commitOwned)` | Finish FX copies and validation, lock the live FX owner, call the synchronous atomic owned-state commit, then publish the prepared FX exactly once if it returns true. |
| `publication.commit()` | The same publication without a second state owner. |
| `candidate.discard()` | Close the branch and release only its unpublished host resources. Repeating discard is harmless. |

`commitOwned` must return a boolean; false means it made no owned changes. It must not change the effect host. No fallible host validation runs after an owned commit returns true. This prevents the ordering bug in which inventory or party state commits before a second FX validation rejects the map. If owned preparation rejects or its commit returns false, neither FX state nor its catalog is installed.

Field Ready composes the same protocol with the camera owner. It finishes FX validation and copies first, locks the FX owner or private journal and map lease, then validates and locks the prepared camera before publishing actor, collision and task changes. Camera and FX state install without another host validation. A stale camera therefore rejects before the actor publication; an FX validator which reads the original camera does not become stale because Ready itself made the dummy visible. Snapshot reads remain available while writes are locked.

Entity-group activation also uses `commitWith`. Tile registration validates and copies its entire private cell/region draft before its final pointer swaps, then the already-prepared entity, treasure and actor bindings become visible. Invalid tile data leaves both FX and group bindings unchanged. No new tile owner or transaction layer is introduced. Actor/collision providers retain their prepared no-fail publication contract; an opaque provider that writes and then throws cannot be represented as rolled back.

The provider's optional `beginCandidate(origin)` is required for `fork`. The origin contains the detached state and merged catalog. Its result supplies:

```ts
{
  validate(): void;
  prepare(batch): { validate(): void; commit(): void };
  observe?(batch, deltaSeconds): FieldEffectObservation[];
  discard?(): void;
}
```

`validate` checks the host generation captured at fork, including particle and RNG state. Capturing a new generation only at seal would incorrectly accept a live host that changed during destination preparation. Both owner and host are checked around callback boundaries. A callback cannot reenter the locked owner while publication is in progress.

`batch` contains the merged catalog, ordered `plans`, and aligned `operations`. There is one plan per operation, even when several operations came from one local preparation. Consequently create → destroy → release → recreate keeps each intermediate player's identity and media available to the host. Flattening the events with only the initial and final state would lose the destroyed intermediate player. The original tick delta is retained in `operations`; differences between rounded shader elapsed values cannot recover that delta.

The host may allocate private resources during preparation but may publish only in the final commit. Its commit installs already prepared state and must not fail. `discard` is also a no-fail contract: it releases only unpublished private resources and cannot change the live host. The World owner cleans competing candidates before its final publication, so a violating cleanup cannot turn a published map into a reported preparation failure. If an opaque commit violates its contract, the commit is consumed and the manager rejects subsequent writes. The code cannot claim to roll back third-party state or an owned callback that itself violates its atomic contract.

## Catalog, boards and private clocks

Catalog additions are trusted compiled inputs, not data from a save. An existing asset-group key must retain exactly the same definition, including provenance and blockers. Key ordering in a JSON object is irrelevant; array order and values remain exact. Prefab release does not authorize replacing a catalog definition. The merged catalog and logical state install in the same publication; abandoning a branch cannot authorize a later live allocation of its destination-only media.

`fieldEffectBoardId` encodes the map-lifetime scope and local entity identity as a JSON tuple. Two maps, or two visits to the same map, must receive different scopes from the World owner. Shared particle cameras are still selected by asset group. Scoping a board does not create another particle owner or substitute for retiring the old map's mutation lease.

Candidate `prepare` rejects caller-supplied tick observations. Only `prepareTick` can obtain them from the private observer. A live observer is never used as a fallback. Missing private observation support blocks even if the live host has `observe`. Repeated observations of the same journal and delta must not consume more time or RNG; a queried tick becomes committed only when it appears in the next journal. The explicit controlled test observer is not a production particle implementation.

Full setup still stops and hides unselected players. Group setup leaves their playback unchanged while replacing registration. Only registered, active, playing players advance during a tick, and the observation list must match those players and their source particle counts exactly. Local preparation does not reset shader elapsed time or reinterpret the native loop-completion rule.

The default Web budget is 1,024 successfully prepared calls and 4,096 prepared operations per candidate. Dropped sibling preparations still consume that budget; an empty preparation consumes a call. Limits can be explicitly set to positive safe integers up to 65,536. Exhaustion throws before more host observation or local changes. These are resource bounds for candidate preparation, not assertions about original-game limits.

## Stable menus and checkpointing

`FieldGame.menuReady` retains the actor-host, completed script lifecycle, synchronized entry, motion, dialogue, interaction, camera, fade and stop gates. A retired map lease is never ready. `GameSession.menuReady` additionally requires the current owned state to be outside battle and the fresh-game launch protocol to have completed. The item and equipment views use this contract, and their mutation methods check it again when a button is confirmed.

`checkpointReady` requires the same stability plus an implemented save codec for every state owner. Active field effects and any nonzero shared effect-manager history still prevent saving, including after entering an empty map. Those persistence restrictions do not prevent an otherwise stable session from using menu items or changing equipment. The save button and restore validation continue using the checkpoint contract; ordinary shop tasks retain their independent transaction lifecycle.

## Validation

Run without replacing the public compiled tree:

```sh
npx tsc -p tsconfig.json --outDir build/v35-effects-dist
node --test build/v35-effects-dist/tests/field-effect-transaction.test.js build/v35-effects-dist/tests/field-effects.test.js build/v35-effects-dist/tests/field-effects-runtime.test.js
node --test build/v35-effects-dist/tests/field-effect-joint.test.js build/v35-effects-dist/tests/field-camera-host.test.js build/v35-effects-dist/tests/field-camera-runtime.test.js
node scripts/check-field-effects-native.mjs
node scripts/check-field-effects.mjs --compiled-dir build/v35-effects-dist
node scripts/check-field-effects-ui.mjs --compiled-dir build/v35-effects-dist
node --test build/v35-effects-dist/tests/field-menu-ready.test.js
node scripts/check-field-menu-ready-ui.mjs --compiled-dir build/v35-effects-dist
```

The new candidate suite has 28 controlled tests. They cover shared references across two map scopes, zero external publication during multiple local commits, intermediate create/destroy state, cache release before recreation, exact catalog merging, discarded and stale candidates, host failure, joined owned publication, float32 clock precision, explicit private observations, preparation budgets and reentrant writes. Existing pure/compiler and field tests remain separate. Native, real-source and controlled Canvas checks remain distinct from browser pixels, original-game execution and playable coverage.

Eight additional joint-publication tests cover real FieldGame Ready and group registration, live/private/leased effects, refused commits, stale cameras, reentrant writes and invalid tile bindings. The first two tests failed against the prior commit order (`v35-joint-red-tests.log`, 0/2) and pass after the fix. Their assertions inspect actual camera, tile, actor, group and effect state; a read-only host validator is not required to accept state that has already changed underneath it.

The menu suite has 12 controlled GameSession tests for ordinary saving, effect maps, empty maps with shared history, retirement, movement, scripts, dialogue, fade, blocked and unsynchronized entry, transitions, battle/victory and fresh native launch. Four controlled DOM cases execute the real item/equipment views against the real GameSession, including stale confirmation callbacks and readiness-only changes with unchanged inventory. They do not count as browser acceptance.

Current ignored logs are `build/reports/v35-effects-tests.log`, `v35-effects-native.log`, `v35-effects-source.log`, `v35-effects-ui.log`, `v35-effects-menu-tests.log` and `v35-effects-menu-ui.log`. The menu report is `build/reports/field-menu-ready-ui-check.json`. The source checker still observes 15 real boards, five real prefabs and zero admitted real particle providers. Particle/RNG checkpointing and unsupported media remain explicit gates even when a board is hidden or stopped.

Joint-publication logs are `build/reports/v35-joint-tsc.log`, `v35-joint-tests.log` and `v35-joint-focused.log`; the earlier failure evidence is retained in `v35-joint-red-tsc.log` and `v35-joint-red-tests.log`.
