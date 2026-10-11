# Source-driven Magitek battle appearance

This v22 system consumes owned condition type 607 through the normal battle condition catalog. It replaces the old opening-only `RideL` plus fixed crop/offset presentation. It does not make every status, animation, shader, or battle action playable.

The trusted opening row 53 comes from the prelude's `AddCondition(607, 0)` and current owners, as documented in [battle-entry.md](battle-entry.md). Field transport 6 is a separate owner. Removing that field transport is not a substitute for removing the battle condition.

## Source contract

The source DLL is `1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`. Complete Ghidra receipts live in ignored `build/native/v22-battle-appearance`, `v22-battle-appearance-render`, and `v22-battle-appearance-mesh`; earlier Start/Remove and ride methods remain in the v20/v21 receipts. All receipts retain `semanticsVerified: false`.

| Mechanism | Source |
| --- | --- |
| Madou Start, Remove | `0x922070`, `0x921fc0` |
| Ride flag, initial cache, alias dictionary | `0x6827f0`, `0x682df0`, `0x158cc40` |
| Effect posture initialization and selection | `0x92c3b0`, `0x92c440` |
| Effect loader (missing master is no effect) | `0x45b3d0`, `0x45bc70`, `0xaa5b30` |
| Body cache/UV/local position | `0x158d160`, `0x51c6d0`, `0x51c5b0` |
| Separate armor animation and media | `0x683380`, `0x8fa7b0`, `0x1587400`, `0x682e70`, `0x51cc60` |
| Sprite assignment and full-rect mesh | `0x51cba0`, `0x8aa590`, raw `0x924140` / `0x923c30` |

`hasMagitekBehavior` checks the complete supported numeric row shape, not row identity 53 alone: system 4, resistance selector 1, until type 3, no timer/rates/groups/numeric flags/effect/shadow/field-SE/icon providers. The compiler additionally verifies that the effect master contains no row for effect ID zero. The source message key `None` is a hidden empty label, not a missing localization fallback.

`SelectedCharaSize` selects an **effect posture category**, not a pixel scale. For the complete active-607 branch, base is current character size; active type 681 uses `CHARACTER_MOG_ASSET_POSTURE` only if positive. Type 601 then selects `CHARACTER_MADOU_ASSET_POSTURE_50`; otherwise `CHARACTER_MADOU_ASSET_POSTURE` is added. The supplied build's constants are 11, 250 and 200 respectively. Normal actor size 1 therefore selects posture 201. Mog/Kappa arithmetic is tested separately; their lifecycle and active battle behavior remain blocked.

Start saves the previous selected posture once and invalidates body animation key/index. Reconciliation with unchanged 607 does not overwrite the backup. Remove restores the backup, hides armor, and resets body UV/local offset as the following ordinary animation update does. Death's real erase group uses the type-5 preserve rule and keeps row 53; death and revival therefore keep the armor and original backup. Battle-end until-type handling also preserves it.

## Runtime and compiler ports

`compileBattleAppearance(reader, {tables, misc, sprites, sourceIds})` reads the complete source tables, exact `serial_misc_assets.json`, and source-bound sprites. It returns a common catalog, per-source actors, provenance, and per-character blockers. No owner is created by this compilation. Character status selects `character_asset_id`; that row selects `size_type` and the body sprite group. The armor group is the native literal `bc_ff6_p022`. No state is inferred from a filename.

`createBattleAppearanceState(actor)` creates an ordinary state. `reconcileBattleAppearance(catalog, actor, state, conditionIds)` returns a cloned candidate. `projectBattleAppearanceFrame(catalog, actor, state, {key, bodyFrame, armorFrame}, sprites)` returns a candidate state and projection. The host publishes these only when the entire battle action succeeds and rolls them back with the rest of the battle snapshot on failure.

The host must bind the provider before accepting active 607 and preflight the default, down, dying, IdleR00 and dyingR00 media before battle publication. It must also preflight all targets' candidate condition/appearance changes before publishing action effects. A missing key, exact frame, source geometry or image is a blocker. A renderer must never silently substitute an idle sprite or ordinary actor for missing armor. Runtime frame changes use the BattleGame candidate API rather than mutating combatants from the renderer.

## Source rendering projection

Body names come from an alias's `names`; armor names come from its `magic_armor_table.anim_names`. Their frame counts differ and their indices advance separately. For example the supplied `move` alias has two body entries and four armor entries. A body index outside a shorter `chara_offsets` or `chara_position` array retains the previous corresponding value. It does not clamp, reset or copy the last entry. The native cache compares the body key and index; an armor-only frame update does not change those values.

The native aliases `default`, `dying` and `down` select the correct source body names. Mounted default remains `Idle_00`, with the armor separately selecting `WalkL_01`; the legacy forced `RideL_01` body was not this source behavior. Right-facing source aliases use their separate body and armor assets. `orientation: source-alias` means the helper performs no extra flip; original formation orientation and full action-state selection remain host responsibilities.

The adapter preserves source `pixelsPerUnit`, `textureWrap` and `filterMode`, in addition to full texture canvas, pivot and identity. This provider admits full-rect, even canvas width, PPU 1, pivot `(0.5, 0)`, point sampling and Clamp U/V. Odd widths need the native integer-half mesh-width adjustment and remain blocked. It rejects mixed canvas sizes in a single animation group because native `SetSprite` does not resize the initialized mesh. The supplied body images are 32 by 32, armor 32 by 40. Native local position uses source pixels, x right and y up. `_MainTex` offset is UV, U right and V up; it is not a pixel crop amount.

`battleAppearanceQuads(layer)` provides Canvas source/destination rectangles, y down. It includes edge strips that repeat the clamped edge texel instead of assuming transparent borders. With source default offset `(0, .25)` and local position `(0, 24)`, the body samples its top 24 pixels into `[-16, -48, 32, 24]`, plus the eight-pixel clamped top strip. Armor has its own 32-by-40 rectangle. Source `down` uses zero UV offset and local y 20. The posture category does not scale either rectangle.

These are native data and API projections. Canvas/GPU sampling at fractional offsets, original shaders, shadow/depth ordering, action timing, complete native orientation control, and visual parity still need their own acceptance. The renderer's existing development action timing is not certified by the alias table.

## Verification

Run the focused TypeScript tests and the source/native check with an isolated compiler output while other workers own public builds:

```sh
npx tsc -p tsconfig.json --outDir build/item-review-v22 --declaration false
node --test build/item-review-v22/tests/battle-appearance*.test.js
.venv/bin/python -m unittest tools/tests/test_battle_export.py
node scripts/check-battle-appearance.mjs --compiled build/item-review-v22 --native build/runtime/game/GameAssembly.dll
node scripts/check-battle-appearance-ui.mjs --runtime build/item-review-v22
```

The independent source check reads raw rows and original Unity bundles rather than deriving expectations from compiled gameplay values. The current source has 18 requested actors and 70 aliases. It verifies default/down/dying/IdleR00/dyingR00 media, posture constants, death preservation, revival, battle-end persistence, removal, missing-media atomicity, and exact body/armor identities. It also checks 20 complete exported native methods plus seven raw ranges and 723 original sprite metadata records. Reports are `build/reports/battle-appearance-check.json` and `battle-appearance-native-check.json`.

This lane proves deterministic module behavior and binding to this supplied build. Browser acceptance and running-original-game comparisons are separate; no dynamic native parity or full-game migration completion is claimed.

The separate UI check uses real BattleGame with synthetic content and a recorded Canvas/DOM. It verifies opposed-target right aliases, armor-before-body draw order, independent UV source/destination rectangles, dying/death/removal rendering and hidden status labels. Its HP/condition injections are declared controlled render-branch inputs, not source gameplay qualification. The review found and fixed a regression where the new appearance path bypassed the previous aiming-right branch; the host now requests `IdleR00` / `dyingR00` and preflights both before admission. These five host poses produce 90 real-source pose checks across the 18 templates. Full original orientation scheduling remains unverified.
