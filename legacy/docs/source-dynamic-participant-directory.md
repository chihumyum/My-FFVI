# Source dynamic participant directory

The framework directory explicitly declares `source-battle-directory-policy-v5`
with `sourceParticipants`:

```json
{"kind":"web-source-dynamic-participants-v1","slotLayout":"source-party-nine-slots","rewardScope":"all-entered"}
```

This binds source data to the existing Web participant owner. It does not run
source programs or grant an initial-condition, AI, child-party or owned-player
capability. Directory policy v1–v4 keep their previous exact shapes. This version
is independent of initialized recipe/profile upgrade versions.

For every descriptor whose complete original battle program contains an admitted
`BattleAddEnemy` or round-change operation, the compiler resolves the root's
original `monster_party.csv` row and all nine X/Y/group columns. Empty source
slots remain real positions. The compiler never compacts nonempty slots or
borrows a layout from another party.

Every referenced enemy master resolves through its own `monster.csv` row,
`monster_asset.csv` row, AI master and exact physical export. This includes
masters absent from every initial encounter. Existing initial bindings must
agree with the resolved master/AI/sprite. Missing references produce a concrete
per-root hard diagnostic. Late templates then pass through the existing enemy
definition compiler, including their actual initial-condition and AI gates.

Every round-change reference keeps its complete source party row. Successfully
resolved child descriptors retain all source members, pattern bits, flags,
rewards, metadata, root script and AI. Failed descriptor resolution remains a
source diagnostic at its original round-change PC; the original child row is
still included in the proof. No child flags are erased and switching never
executes the child's root as a replacement for the original root.

The unchanged Web owner uses source unique IDs as nine fixed slots and retains
all entered enemy instances for the explicit `all-entered` reward scope. Its
atomic entry/retirement and AI lifecycle are the existing Web implementation.
This declaration does not reproduce native `GetPosUniqueAdjust`, Unity asset
loading order or asynchronous presentation timing. It does not grant Gau/Shadow
owned departure, reserve-script, borrowed-player source 33, unknown condition
activation or child flag/reward behavior.

The directory's strict catalog is compiled before applying this declaration.
Only its framework catalog receives reserve resources, full child descriptors
and the per-party Web policy. Initialized consumers require the exact v5 policy,
full original program, every affected root/site, source nine-slot declaration,
actual master/asset/AI chain and complete child-row proof. Rehashing a mutated
payload cannot replace these consistency checks. Diagnostics and current
dependency analysis remain part of the existing initialized binding contract.

`scripts/inspect-source-dynamic-participants.mjs` performs a pure full-source
comparison. It retains all 53 battle programs/2312 instructions, all 490 party
requests (including failed descriptors), and the complete four affected bodies
and their 25 add-enemy/three round-change sites. It rejects changes to unrelated
roots and removal of any hard diagnostic outside the exact source-wiring
categories. Its definition count is compilation evidence, not completed source
encounters or campaign coverage. The tool produces no maps or content packages.

Controlled tests exercise real source-shaped tables, a late master absent from
initial descriptors, missing/changed identity and resource chains, noncompact
empty slots, child flags, unknown conditions/AI and both initialized consumers.
The Session test uses the compiler's derived content through entry, AI ownership,
combat, victory return and checkpoint restoration. It is redistributable test
data and makes no claim of executing an original encounter.
