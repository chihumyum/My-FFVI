# Source field puppet actor host

V29 supplies source actor selection, start/entry/finish plans, and an executable adapter for ordinary actor effects. FieldGame remains the owner of actors, playback, the camera, task slots and collision state. The new modules do not create another saved actor registry. Formal scene readiness still requires a trusted factory/runtime context; the development checkpoint's hidden actor metadata does not prove positions, child hierarchy or material initialization.

The supplied PR executable is the only source. Its SHA-256 is `1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`. All native evidence remains static; no original executable was run. This work does not investigate HD-2D.

## Evidence and scope

`scripts/check-field-puppet-actors-native.mjs` checks source DLL, symbol and header digests, 24 complete Ghidra method receipts, the exact native ranges ending at the next distinct symbol, and 14 additional small raw ranges. It also reads the six-entry initialization array from protected metadata at `0x4deeca`, checks its SHA-1 field identity and resolves the five material property strings through `script.json`. Decompiled inlining is not used as negative evidence beyond a method's raw boundary.

| Evidence | Recovered contract |
| --- | --- |
| `Integrator.Execute` `0x5f2530` | Explicit script flags; ordinary field initialization; pending restore instruction before initialization |
| `InitializePlayerPuppetEntities` `0x5f2e90` | Ordered start and finish calls, camera dummy, leader, six actor lookups, layer/material refresh, visibility, riding and cue |
| `PuppetCoreEntry` `0x5f40c0` | Hide optimization before allocation, negative aliases, party assignment and ordinary resident placement |
| `GetPartyLeaderPuppetEntityID` `0x5f2a80` / `GetPickupCharacterIndex` `0x2db390` | Saved Corps position versus nonempty-member ordinal |
| `GetResidentPartyEntityId` `0x2db630` | Resident source identity → newest enabled owner → current Corps ordinal |
| `GetFieldEntity` `0x2d9b50` / condition search `0x2db030`, `0x9e30f0`, `0x9e2e90` | Camera, puppet, resident, companion, other-party and condition-leader namespaces |
| `PartyPuppetAssignment.Assign` `0x5f60e0` | Five bits, resident conflict and four-slot fallback |
| `CopyEntityLayer` `0x5f2010` / `InitCameraDummy` `0x5f2ca0` | Layer copy includes two renderer refresh calls; camera zero is independent of sprite actors |
| `SwitchTransparentBody` `0x2df5f0`, FF6 transportation constructor `0x40acc0` | Actual transport and map foot attribute determine opaque/semitransparent choice |
| `ApplyMainViewCustomPropertiesToEntity` `0x2d1730` / transparent texture methods `0x2d17a0`, `0x878af0` | Material and render-texture dependencies, including native Unity layers |
| `RideOutTransportation` `0x2df400`, `ReturnRidingCharaAsset` `0x87a4c0`, `RideOut` `0x87a680` | Asset cache return precedes renderer ride-out; it is not only a boolean reset |
| Three collision setters `0x2ee1c0`, `0x2ed3a0`, `0x2ee190` | Map collider layers 9/10/11, applicable entity instances and interactive-target observation are separate switches |

The relevant receipts are in `event-operators`, `v28-puppet-lifecycle`, `v28-puppet-finalize`, `v28-field-visibility-collision`, `v18-condition-appearance`, `v29-field-hosts`, `v29-field-providers`, `v29-field-following` and `v29-puppet-opaque`.

## Compiler inputs

`compileFieldPuppetScriptContext(rawScript, rawMisc)` retains the strict legacy requirement for four explicit `SystemFlag` members. The source world compiler can pass a third physical-source binding under [source-format-system-flags-import-v1](source-system-flags.md): inside an existing non-null object, omitted proven int32 members import as zero using the fixed original loader and matching Unity 2019.4 API contract. Missing/null whole objects and malformed explicit values remain rejected. This is metadata import, not a world-state default or actor-host admission. The native test remains nonzero, not equality with one; the context retains complete original script/misc hashes.

`compileFieldPuppetActorCatalog(rawMisc)` binds the source Corps permutation, resident mappings and condition-character replacements. The current source has four Corps positions, 45 resident definitions and replacements for condition types 665, 666 and 677. The original explicit-member subset has 2,771 scripts. Of the other 533 records, 526 now have importable omitted-member metadata and seven whole-object omissions remain rejected; 393 of the 526 have static field uses. These are import counts, not runtime coverage. The complete combinations for the explicit subset `(SkipInitialize, KeepPlayerPuppet, KeepBadStatusVisual, RidingVehicle)` are:

| Combination | Scripts |
| --- | ---: |
| `0,0,0,0` | 2,191 |
| `0,1,0,0` | 141 |
| `0,0,1,0` | 338 |
| `0,1,1,0` | 101 |

These counts include corpus records outside reachable field content. They are neither playable-script counts nor a story coverage claim. Source provenance, same-source snapshot identity and the compiled script hash remain the caller's responsibility; a saved context cannot authorize itself.

## Actor identities and ownership

`FieldPuppetActorContext.player` is the actual `FieldController.player` instance key. Source ID `-1001` is a party puppet alias. They must not be collapsed because both happen to use `-1001` in an older Web development scene. All runtime bindings are explicit opaque keys.

| Source ID | Native selection |
| --- | --- |
| `0` | Camera/scroll dummy, which can live outside sprite actors |
| `-1010` | Current leader with condition-character selection |
| `-1020` | Companion puppet when companion save data exists; the unsupported/unknown branch remains explicit |
| `-1030..-1032` | Three saved-party avatars |
| Other IDs below `-1000` | Occupied Corps ordinal mapped to `residentPartyEntityList` position |
| `-1000..-1` | Resident asset: current-party member first, otherwise the explicit resident dictionary |
| Positive IDs | Current map entity property ID |

Leader selection scans source `corps_order`, counts nonempty Corps cells and compares the saved **position**. It does not filter the leader scan by enabled status. Resident selection does filter enabled owners, chooses the greatest owned ID for the matching CharacterStatus, and then searches the current Corps list. Source ID, owned ID, Corps position, puppet ordinal and Web actor key stay distinct.

`conditionController`, companion presence, restoration callback applicability, transportation and each actor collection are required inputs. Null means established absence; omitted state is rejected. Known condition stand-in selection is still blocked because its actor/material lifecycle has not been implemented by this ordinary adapter. Positive entity lookup can resolve to known null only when the host supplied the complete current entity collection.

## Ordered lifecycle

`projectFieldPuppetInitialization({phase,catalog,script,context})` returns ordered effects and optional writes to the Integrator's leader/assignment fields. `SkipInitialize` returns without those writes. Ordinary non-skipped initialization requires known absent companion and pending restore instruction.

Start initializes the camera dummy if present, selects the source leader and visits `[-1001,-1002,-1003,-1004,-1005,-1010]` in that order. Each resolved actor receives player position, copied layer plus material/texture refresh, look direction, terrain-dependent body opacity, riding transition and Hide. If the source keep conditions apply, it shows the selected leader, refreshes its view inputs and hides the actual player. It cues the leader from the player's current animation and clears all five assignment bits. Duplicate resolved actor visits are preserved.

Finish copies position, layer/material state, direction and current animation from the selected leader back to the actual player, hides the source puppet list and condition leader, then shows the actual player. It does not imply a collision reset. A missing animation or late material/riding dependency rejects the whole candidate before publication.

`projectFieldPuppetActorEntry` applies the source `SetPuppet` alias rules before core entry is published. Its `characteristics && !keepPlayerPuppet && id == -1001 && next mnemonic == Hide` optimization must run **before** slot/range allocation, because that native branch only hides the actual player. Other entries reserve the proper party assignment and produce ordered placement/visibility effects. The first source `Exit` and core lifecycle remain the shared scheduler's responsibility.

## Executable effects and remaining gates

`projectFieldPuppetActorEffects(effects,snapshot,providers)` clones the host's actor/camera draft and `ActorAnimation` instances. It applies ordered position, layer, look, cue and visibility changes without changing its inputs. All preparation is fallible; publication happens once after actor effects, task changes and shared-owner transactions have passed validation.

The bounded ordinary adapter supports:

- Finite positions in the same host units, including resident placement that preserves X/Y and takes player Z; active movement is rejected rather than silently cancelled.
- Source Look/Cue through validated existing animation media; missing keys or sprites reject the complete draft.
- Known childless Show/Hide, including alpha 1/0; unknown hierarchy remains gated.
- Reapplication of the same already-bound map/layer material inputs. A new map/layer material projection must be implemented before changing that binding.
- Source opaque body and shadow restoration. FF6 forest attributes `[9,30]` use semitransparency for every transport type; river attributes `[10,11,12,13]` additionally use it for type 9. A truly absent current transport uses the native fallback type 1. Unknown transport/foot data does not become a zero attribute. Semitransparent composition remains gated.
- Head render-texture slots: native Unity layer 9 receives upper/ceiling, layer 10 receives ceiling/null, and other layers clear both. A new nonnull render-target composition requires the Web compositor and remains gated. These Unity values are not Web map-layer indices.
- Already-unmounted RideOut with an empty riding-asset cache and absent/idle ride renderer. Mounted or cached-asset transitions remain gated; RideOn requires its media and animation providers.

`viewBinding` is evidence supplied by a renderer that already applied the source inputs. It must not be manufactured merely from the current map name and layer. Likewise, hidden party metadata with no coordinates is not an actor factory result. These restrictions are explicit dependencies, not ignored effects.

## Shared FieldGame port

`FieldPuppetActorsPort` exposes:

```ts
read(): { catalog: FieldPuppetActorCatalog; context: FieldPuppetActorContext };
prepare(plan: Readonly<FieldPuppetActorPlan>): () => void;
controlContext(): {
  worldMapScript: boolean;
  callback: "absent" | "unknown" | "unsupported";
};
prepareCollision(enabled: boolean): () => void;
```

`prepare` reads the same revision used to resolve aliases and creates a private candidate. Its callback is a synchronous, once-only, non-failing publication owned by the host. Combine all actor effects for one Exec transaction before preparing; separate whole-snapshot candidates from the same old revision would overwrite each other's changes.

`worldMapScript` is `CheckCurrentWorldMap() && Integrator.isMapScript`, not simply whether the map is a world map. The callback is specifically `ExecPuppetCallback`, separate from `SetPosCallback`. The source Puppet static constructor does not bind it; the previously recovered ReplaceEntity/TalkToOtherCorps selectors can set it, and ResetReplaceEntity clears it. A fresh static null state is not proof that a later checkpoint still has no callback.

`prepareCollision` covers all three native switches. It must preserve intrinsic per-entity collision properties and publish the map/entity/observation gates with the Exec/Finish transaction. `projectFieldPuppetCollision` supplies the detached three-boolean projection; it does not own another persistence field. Unknown applicability or a missing effect host blocks instead of using `false`/`absent` defaults.

The executable synthetic fixture `fieldPuppetActorHostFixture(control)` demonstrates this port without replacing source effects with a no-op. Its media, coordinates, childless factory state and renderer bindings are deliberately controlled test inputs.

## Validation

Run in an isolated output directory:

```sh
npx tsc -p tsconfig.json --outDir build/v29-task-dist
node --test build/v29-task-dist/tests/field-puppet-actors.test.js build/v29-task-dist/tests/field-puppet-effects.test.js
node scripts/check-field-puppet-actors-native.mjs
node scripts/check-field-puppet-actors.mjs --compiled-dir build/v29-task-dist
```

The 27 synthetic tests cover nonempty Corps ordering, enabled resident identity, duplicate assignments, source Hide optimization, null/unknown separation, start/finish effect order, camera separation, animation failure rollback, material/riding gates and atomic collision preparation.

The source checker verifies all script flag shapes, same-source misc binding, actual `GameState.createNewGame` ownership and source-selected media for the three initial owners. It applies four real source flag combinations and an actual SetPuppet instruction to controlled actors, readies and moves a selected leader, and validates return to the actual player. It also checks missing-media rollback and unresolved companion/restore/condition branches. This does not claim that the selected script fragments form a reachable scene or that the formal fresh-game field factory has run. Reports live only under ignored `build/reports/field-puppet-actors*-check.json`.

The shared FieldGame port is exercised by separate controlled host/scheduler integration tests. Formal GameSession still has no native hidden-actor/camera owner, so that controlled source host explicitly blocks save/restore and battle return until its codec and ownership chain exist. Passing those host tests does not make source story scripts playable or replace the development checkpoint with a real new-game field factory.

The remaining production requirements are trusted initial/runtime instances and coordinates, complete layer/material/ride transitions for applicable scenes, source callback tracking, and shared VM/field checkpoint integration. They must be accepted separately from source decoding and pure projections. See [task scheduling](field-task-control.md) and [party appearance](party-actors.md).
