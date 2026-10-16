# Source Function23 enemy variables

This family is the three exact source process keys `SET_VARIABLE_CALC`,
`ADD_VARIABLE_CALC`, and `ADD_VARIABLE_CALC_TWO_DIMENTIONAL` (original spelling).
A process label does not authorize execution. The original Function23 must be
slot 2, series 0, with three zero operands, following a separately admitted
primary function. Source rows and the complete original program remain bound.
The current immutable source census has 103 process matches, 98 actual
Function23 matches, 43 AI programs and 26 encounter dependency cuts. The other
five process matches and nine separately named boss variants remain unchanged.
The final comparison changes only these 98 ability records: bounded plans grow
from 643 to 707 (64 additions), while 34 retain independent primary/carrier
gates. Only one affected encounter cut now has all ability plans; that static
closure is not a completed battle or story batch.

The existing actual enemy combatant owns `EnemyBehaviorState.variables`, exactly
fifteen signed int32 cells. This is not a new state bank or a Field variable.
SET writes DataC to direct index DataB; ADD adds DataC at DataB; TWO adds at
DataA and then DataB. Equal indexes receive two ordered additions. Each addition
wraps int32. DataA is retained but unused for SET and ADD. Direct native array
addressing rejects negative indexes; it does not use the AI operand convention
which aliases nonpositive indexes to cell zero. A player or a missing actual
bank never receives this capability.

The variable phase runs once for the whole source action, independently of
primary targets, primary miss, target multiplicity, and MP fee. Its attacker
calculation dictionary has value 0, hit type -1, count 0, null conditions and
false recovery; this is separate from the primary target calculation and never
becomes a fake zero-damage Hit or an extra received-AI reaction.
The separate target fallback is a fixed Miss (value 0, hit type 2, count 0,
empty condition list, recovery false). It is calculated independently for each
nominal target, consumes no random draw, and cannot replace the original first
slot used for received-AI readiness. The source inherited IsMiss predicate
skips this secondary calculator's parameter update. It is neither an absent
dictionary nor the attacker's Non result.

`projectEnemyVariableAction` is a detached preparation. `BattleGame` stages its
new bank in the existing action projection and lets received AI see that
projection. If a real reaction or Final yields at Blank, the parent, bank,
resources, RNG and AI continuation stay unpublished together. Every receiver
must admit before publication. The whole existing battle tick rollback owns
late host failure. Reaction behavior publishes after the variable bank so a
later legitimate AI write survives. A previously unpublished normal wake for
the attacker remains an explicit gate, since silently overwriting its bank or
publishing its prefix would violate the current whole-wake owner contract.

Retirement and current generation/actual instance fences stay in the existing
battle owner. The enemy bank is ephemeral: owned return and CheckpointStorage
retain player state, while a new battle or defeat retry obtains a new enemy
instance and a fresh bank. No Scene, ability-ID, monster-ID or AI-PC branch
selects this executor. No middle-PC or source-flag jump counts as story coverage.

The native evidence is ignored local research. `build/wip/source-battle-variable-executor-common-family/`
retains the full all-source comparison and finite native lease chains. Cached
759140 contains the actual three generic key dispatches and attacker writes;
97c4a0 contains Function23 HitCalc; finite 756460 and 4f7af0 establish attacker
non-hit and target calculator setup. The direct fallback chain
4f7d60 → 4f7ab0 → shared PE66cc80 → cached66c630 → provider3419c0 case23
reaches `UniqueFunction`. Its 9053b0 Calc C drops a tail following a GC barrier;
the complete original PE proves SetStatus/interface2 and GetUniqueStatus/interface14.
The finite 3da960 and aa0a60 bodies show that only six other process keys enter
special target calculations. All three generic keys take the fixed Miss path.
PE4551d0 compares GetHitType to 2 before the existing Basic update loop, so
Unique Update/Default bodies need no export or implementation for this family.
The checker retains full receipts, next-symbol ranges, aliases, pins, PE and C
warning evidence; it does not export additional native methods. Original game
execution and dynamic parity have not been claimed.

Other primary calculations, carriers, numeric conditions, source-specific
processes, equipment and reaction providers retain their previous gates.
In particular Mineralization numeric-consumer gates are unchanged.
