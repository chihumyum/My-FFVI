# Source post-battle checks

This batch covers the complete `CursedShield`, `LotSecedeShadow` and
`RemoveShadowInBattle` selector families: 14 original sites in 7 complete
programs (585 instructions), with 406 dependent source parties. It does not
execute, shorten or rewrite those programs. Whole-program battle admission is
unchanged. The full audit retains all 53 battle programs / 2312 instructions,
490 requested parties, 483 source descriptors and 7 source diagnostics. Common
source without an exact battle export remains explicitly unbound.

## Owners and transactions

The no-shield branch scans the actual borrowed six-slot equipment first. It
does not require unused shield master 213, a conversion catalog or counter 9.
A real wearer still needs its exact shield binding; the 256 conversion remains
blocked until its owned equipment transaction is implemented.

`BattleGame` reads its existing equipment qualification and shared-bank draft.
`GameState` remains the owned roster/equipment/inventory owner; the existing
`GameSession` lease and prepared return publish owned resources and shared
scenario banks together. There is no additional saved post-battle state,
inventory, party, RNG or counter. Retry uses the same captured entry. A failed
logical tick restores the shared draft, VM locals, time, RNG and actual units.

Shadow borrows the same immutable complete roster / selected Corps / field
entry as Gau. `GameSession` captures it before opening the lease whenever either
family needs it. The complete source initializer is required: a bounded
development roster cannot establish that Shadow has never been owned.
`GetOwnedCharactersClone(true)` includes disabled owned records. Membership is
in the current selected group, not all three saved groups. At the dependent
branch, BattleGame validates the captured owned IDs and source identities
against its actual current players; an unimplemented formation publication is
an explicit gate.

## CursedShield

The instruction first reads the existing `ScenarioVariable[2]`. Exact `-1001`
returns without reading equipment or counter. Otherwise it scans actual player
owned equipment, including dead players, and compares content identity 213.
The scan stops at the first match for each player: multiple equipped copies do
not multiply that player's increment. No matching player means no read or
write of `ScenarioVariable[9]`; an unknown counter is not assumed zero.

Matching players increment the same borrowed `ScenarioVariable[9]` using signed
int32 arithmetic. Only exact 256 enters conversion. Values already greater than
256 do not trigger conversion. Non-conversion increments are prepared together
and published to the battle draft after all required reads succeed.

Exact 256 remains a reached, specific gate. The native branch grants content
214, calls `SetEquip` for the matching slot with its native flags, removes
content 213, resets the counter and writes `ScriptLocal[1]=-1`. This requires
the complete equipment/stock/parameter/provider transaction. A visible item
swap or an isolated counter reset is insufficient. This implementation does not
publish any part of that conversion. It also does not pretend the equipment
dictionary is empty when qualification is unavailable.

The source audit retains the complete source rows: content213→armor17 and
content214→armor18, alongside the existing compiled equipment identity. Runtime
reads of equipped IDs use the actual borrowed loadout. The unused conversion
content is not required by a non-conversion branch.

## Shadow lottery

The call writes `ScriptLocal[3]=0` before testing its ordered guards. It reads
the existing BeastField predicate; a proven BeastField exits, an unresolved
required predicate blocks. It then reads the three native start/stop flag pairs
in order, reading both cells for each examined pair:

| Start ScenarioFlag1 | Stop ScenarioFlag1 |
| --- | --- |
| 97 | 108 |
| 123 | 125 |
| 147 | 158 |

The first pair with start=1 and stop=0 selects the eligible branch; later pairs
are not read. If no pair matches, the instruction returns with local3=0 and no
roster/Corps/fixed-state/log/RNG request. If eligible, it looks for source status
4 in the full owned roster, then requires that held identity in the selected
Corps with more than one member. Missing later providers do not turn earlier
proven non-triggering branches into errors.

The three-element arrays are source metadata, not lore or guessed flags. The
bounded original Current static initializer calls `InitializeArray` and raw
setters for static offsets 0x1b8/0x1c0. Their exact metadata payloads have SHA1
names `98B7EDA825213E8FF74D369043D45CDC5FCD1C6C` and
`75D2BC4329FCE5EEB1342BF7EA5821B2491033C4`. The independent native checker binds
the PE bytes, metadata field references, dump offsets, payload bytes and every
array element. Shared generic aliases are recorded; their first decompiler
alias is not assigned semantics.

The reached native `fixedPreeMptiveState` remains distinct from the Web
formation. Values 2/4/5 exclude the draw; unknown requires its actual owner.
Current Session entry captures this provider as null. A subsequent eligible
branch requires the real `BattleActLog` containing that owned player's Fight
command1 action. Neither rendered messages nor learned/observed ability lists
provide this log. Its complete publication/cancellation lifecycle is not yet
closed, so the runtime preserves a specific gate there. The pure contract
defines the subsequent conditional shared RNG call as inclusive 0..99, with
only 0 writing local3=1. Synthetic tests of that contract are not actual source
action-log execution or native RNG equivalence.

Three original lottery sites declare the required fourth local and are typed.
The fourth site, `sc_b_0097`, declares only two locals. It remains explicitly
blocked for missing ScriptLocalVariable[3]; no local bank is invented.

## Shadow departure

All four original calls remain specifically blocked. The complete native
`RemoveShadowInBattle` scans players, invokes `SecedeShadow` and disables the
matching held owner, then unconditionally clears/reserves an Integrator field
script even if no Shadow was found. Character absence cannot prove this whole
instruction has no effect. Correct support requires the complete owned Corps /
roster publication plus the reserved field-script continuation. The common
family is not an encounter- or PC-specific exception.

## Verification and remaining scope

Eight new tests cover lazy reads and unknowns, per-player counter semantics,
signed overflow, exact conversion gating, ordered flag pairs, selected owner
identity, conditional 1 percent RNG contract, retained operand padding, rollback,
and a real source-initialized Session with failed media, retry, battle return,
checkpoint and restore. They run through the same BattleGame/Session owners as
the app. The actual app module retains its existing complete test flow.

Pure conservation reports compare the entire current directory with an
independently compiled v107 + Gau baseline. The 14 changed source operations
are exactly 9 typed calls and 5 specific gates. Other instructions, headers and
non-script directory diagnostics remain exact; source-script and source-flag
omissions are empty. The directory remains 1→1 definitions. Static affected
counts are not whole-program execution, source reachability, browser acceptance,
original-game parity or campaign completion. No 649 producer runs in this batch.
