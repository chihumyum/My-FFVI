# Source battle forced return

The common battle VM decodes all ten exact zero-operand `BattleForceExit` sites as `force-return`. The wrapper advances to the original following instruction immediately. `WEB_BATTLE_EVENT_CONTROLS` is required before constructing a battle that contains this request. The existing source flag contract admits only its independently implemented flag14/19 declarations; unknown flags and nonordinary judgment modes gain no new admission.

`BattleGame` owns the request and the distinct `forced` terminal phase. Enabled judgment gives this request priority over ordinary win, defeat and retreat, including an unresolved staged action. Pending and staged work stays suspended until the whole battle owner is retired. This is separate from `RemoveAllAct`, whose six source sites remain blocked by its missing active executor cancellation lifecycle.

Forced=4 does not execute native `SaveParameter`, `SaveRecoveryCondition`, victory results or escape entry. It awards no experience, Gil, learning, loot, defeat registrations or escape count. The new owned return envelope contains participant identities and borrowed history; it cannot carry mutable HP, MP, rows, equipment, conditions or inventory. `GameState.prepareForcedReturn` validates the exact lease/history and records one `forced` receipt while preserving the entry owned state. A forced receipt does not count as a won encounter or learning receipt.

`GameSession.prepareBattleReturn` joins that owned transaction with the existing staged shared-event return and field continuation. `GameBattleHandoff`, Flow and Commands authorize the same prepared return, including cancellation, stale candidates, preparation failure and retry. The app and actual BattleView display a separate result with a return button. Save/load preserves the receipt and serial; a subsequent encounter uses the next lease. Current owned save versions retain their existing layout, with the new explicit receipt outcome. Older readers that do not support that outcome reject it.

The same frame fence covers the force request, source VM, actions, messages and effects. A failed frame restores the request along with those owners. Successful return uses the existing joint message/effect retirement. Throwing resource cleanup is contained after publication; it cannot roll back a committed shared message or owned result.

## Native basis and remaining gates

These are static observations from the supplied `GameAssembly.dll` (`1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`), not dynamic original-game parity:

- External/AI Force wrappers `0xb42a00` / `0x821a50` call accessor slot21 and return Next. Save wrappers `0xb42980` / `0x8219d0` use slot22.
- EventCommand `0x1562e00` / `0x1562d90` set independent request bits. Normal enabled judgment `0x157c1f0` chooses Forced=4 before ForcedOnSave=6 and before ordinary judgment.
- Result dispatch `0x460850` sends result4 directly to WinFadeOut state13. Result6 enters state12; `0x462e90` saves parameters and recovery conditions before state13. Presentation state names do not make either result a victory.
- Escape entry `0x462d90` increments its own count. Victory entry `0x463f00` owns reward/defeat registration paths. Both forced paths bypass these entries.
- Source `GetBattleResult` `0x278b30` rechecks current Corps eligibility for previous results4/6 and may report Lose=2. The precise previous-result publication and Corps projection are not closed. A committed forced receipt therefore triggers a specific query gate; it is never mapped to Win, Escape, a fixed4/6, or an HP guess. Existing ordinary result producers retain their existing behavior.
- All 22 `BattleForceExitOnSave` sites retain a specific gate. Its save chain includes Corps layout, nonparticipant recovery conditions, equipment ownership/count reconciliation, used items and retained steal/drop lists, not just current battle players' HP/MP. No empty list or borrowed-party preservation rule is substituted for this behavior.

`scripts/check-source-battle-forced-return.mjs` recompiles all 53 complete source battle programs (2312 instructions), preserves physical source bindings and all 490 requested parties / 483 descriptors / 7 diagnostics, and verifies the ten typed requests plus twenty-two explicit save gates. It never executes source story programs or builds/publishes the 649 maps. Typed source sites are not playable story coverage.
