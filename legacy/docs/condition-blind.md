# Ordinary Blind and condition-dependent hit rates

This v26 system slice restores the supplied PR build's ordinary Blind provider, the associated physical and magic hit branches, and its shared-state lifecycle. It does not execute the original game or claim native visual parity. HD-2D work remains deferred.

## Source closure

The source `condition.csv` contains two records of type 9. Ordinary row 9 has `system_type=1`, `until_type=3`, no stacking, timer, parameter, attribute, species or condition-group provider, effect 70 and icon 1. Row 89 additionally references condition group 1304 and erase group 14; it remains unadmitted. The compiler tests the complete ordinary provider shape rather than treating a type number as support for every row.

The new `v26-speed-blind` native receipt supplies `BlindConditionFunction` constructor `0x76fad0`, Start `0x76f740`, Update `0x76f880`, `CheckHaveConfusionConditionFunction` `0x76f610`, effect predicate `0x76f810`, confusion-function predicate `0x771a30`, and `CalcExecuteFF6` initializer `0xaa3950`. Existing receipts provide function dispatch, physical/magic/recovery/status hit, battle-end cleanup and effect destruction. The dedicated checker verifies 14 exported methods, one shared Remove alias, four initializer arrays, method identities, native-range hashes and decompiled-file hashes against the supplied PE, symbols, header and metadata.

Ghidra's initializer C stops at the first write barrier. That truncated C is not negative evidence. The checker follows all four PE initializer references and binds their private-field SHA1 names to metadata bytes:

| Native static field | Condition types, in source order | Metadata offset |
| --- | --- | --- |
| HitRatePlusConditions | 12, 630, 34, 9, 602, 16 | `0x4df17a` |
| HitRateMinusConditions | 407, 4, 10, 15 | `0x4def8a` |
| PhysicsAlwaysHitConditions | 7, 11, 603, 17 | `0x4df036` |
| MagicAlwaysHitConditions | 7, 11, 603, 17, 604 | `0x4df036` |

Knowing these arrays does not admit unimplemented Confusion, Sleep, Stop or other status lifecycles. Ordinary Blind, Slow, Poison, Dying and Haste are the newly relevant already-admitted numerical contexts. The always-hit arrays remain evidence for the surrounding branch; their active statuses remain blocked.

## Numerical contract

`PhysicalInput.actor.conditionTypes` is required. The action host derives both actor and target types from the authoritative condition IDs through `BattleConditions.types`; it overwrites stale caller projections. An unknown actor condition list cannot become `[]`. Existing pure fixtures explicitly declare an empty actor list.

In ordinary `PhysicalExecution` (`0xa97b20`), selected-arm/confirmed accuracy is first capped at 255. Actor type 9 halves that value with integer truncation, once regardless of duplicate type presence. Source content flag 1 is then applied and overrides the penalty. Existing special-weapon/process admissions remain strict; the native bypass branch is not generalized to unsupported weapons.

Physical and magic attacks subsequently inspect the **target's** condition lists when the entering accuracy is below 255. A match in the plus list applies `min(255,trunc(rate*1.25))`; a match in the minus list then applies `min(255,trunc(rate*0.75))`. Each list applies at most once, and both may apply. For example, actor accuracy 100 with Blind becomes 50; a Blind target raises it to 62; Poison on that target reduces it to 46. Initial 254 plus then minus becomes 191 because the intermediate plus result caps at 255. Initial 255 bypasses both lists.

Actor Blind does not halve magic accuracy. Target Blind and Slow can raise magic accuracy. Target Poison, Dying and Haste can reduce it. `AddConditionExection` (`0xa91a90`) uses its existing accuracy/evasion/resistance path and does not apply either target array. Fixed condition application retains its distinct source resistance rule.

The hit random schedule differs by calculator. Physical variance occurs before the final hit check, so an adjusted rate of 255 skips the hit draw. Magic enters its hit branch based on the pre-adjustment rate; if the target correction raises it to 255, it still consumes one hit draw and then forces success. Both retain the source integer evasion arithmetic, comparison and later variance/critical ordering. No extra RNG is added for the status itself.

## State, items and field behavior

Blind stores only its condition identity; there is no local timer, cached accuracy multiplier or numeric parameter mutation. The ordinary `until_type=3` persists across battle end. Existing generic resistance, duplicate checks, conflict groups and cure references remain authoritative. Death uses its source erase group, which does not retain ordinary Blind. Revival does not recreate an erased Blind condition.

`BattleConditions.validateStableLife(hp, ids)` validates HP/death agreement and reruns the conflict rule for each actual death identity without publishing a change. `GameState` uses it to reject impossible saved death/Blind or death/Poison combinations atomically, while preserving conditions that the concrete source death row retains.

Source content 13 (item row 12) references recovery group 9, which removes rows 9 and 89. Source content 15 also references Blind recovery. Decoding the alternate reference does not make row 89 an active supported status. Menu use requires a real condition/resource change and consumes once; an already queued battle cure may resolve without changing a now-cured target under the existing item semantics.

The field provider validates the ordinary row and maps it to zero step damage and zero field sound. The supplied `serial_misc_assets.json` substitution list contains only condition types 665, 666 and 677, so ordinary Blind requires no replacement map actor in this source context. Field snapshots retain the condition ID. This does not broaden field event AddCondition/RemoveCondition providers beyond their separately recovered contracts.

## Presentation boundary

Start initializes a condition effect; Remove aliases `DestroyEffect` (`0x45ad60`). Effect row 70 declares source asset `ef_ff6_statblind`, position type 5 and SE 274. The compiler requires these provider rows and preserves provenance even in the current development presentation-omission lane. The native particle, icon rendering and SE are not claimed migrated by the numerical implementation.

Update only adjusts visibility for serial type 6 player effects after loading. An active effect hides only when both `IsConfusion()` and a current Confusion behavior (type 12 or 630) are present. An inactive effect shows only when both are absent. If the signals disagree, native retains previous visibility. `projectBlindEffectVisible` records this exact pure projection; it is not a replacement sprite or a claim that the particle host is implemented. The current active-status domain rejects both Confusion providers.

## Checks

Run isolated compilation, then the focused tests and source check:

```sh
npx tsc -p tsconfig.json --outDir build/v26-blind-dist
node --test build/v26-blind-dist/tests/condition-blind.test.js build/v26-blind-dist/tests/battle-blind.test.js
node scripts/check-condition-blind-native.mjs
node scripts/check-condition-blind.mjs --source-only --dist build/v26-blind-dist
node scripts/check-condition-blind.mjs --dist build/v26-blind-dist
```

The source-only check independently enumerates all 15 Blind ability carriers. Twelve ordinary single-condition plans compile. Ability 304 retains its unsupported type 13/range 16 gate; 1231 and 1253 retain their `ADD_VARIABLE_CALC` provider gate. This is not 12 newly owned/selectable skills or a claim of complete enemy AI admission.

It also checks 2,560 numerical cases against raw condition types and PE-bound initializer arrays, 36 source ability projections, ten source lifecycle/field probes, real effect/SE references and the actual map substitution rules. The published lane verifies the v26 content fingerprint, exact plans and a real frozen source battle lease, with controlled Blind and eye-drop stock only on isolated snapshots. The independent GameSession tests cover field steps, save/restore, status-only menu consumption, defeat retry, victory persistence and a late multi-target failure restoring resources, action state, events and RNG before deterministic retry. Source and synthetic checks are separate from original-game execution and final release acceptance.
