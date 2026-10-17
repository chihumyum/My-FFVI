# Event context branches

v39 adds the supplied build's `BranchByCharacter` and `BranchByPlayerDirection` to the shared event decoder and `FieldGame`. The implementation reads the existing character and actor owners. It does not add a saved roster, choose a visual stand-in for the player, or require a script-specific runtime branch.

This is a framework capability. The source corpus contains 441 character branches and 129 direction branches, including duplicated package records. Decoding those 570 sites does not establish that their surrounding stories or maps are playable.

## Source rules

`External.Branch.BranchByCharacter`, RVA `0xb43990`, has these operands:

| Operand | Source meaning |
| --- | --- |
| `i0` | `OwnedCharacterData.characterStatusId`, not the owned instance ID |
| `i1=0` | Jump when that source character is present |
| `i1=1` | Jump when it is absent |
| `i2=0` | Enumerate current corps cells, resolve each cell's owned ID through `GetMemberData`, and collect source character IDs |
| `i2=1` | Enumerate `GetOwnedCharactersClone(false)`, which includes enabled owners only, and collect source character IDs |
| `i3` | Target label address |

The two reads have different enabled semantics. `GetMemberData` resolves the current corps cell against the complete owned list without filtering `IsEnableCorps`. `GetOwnedCharactersClone(false)` does apply that filter. An enabled owner outside the current party therefore matches only the second query; a disabled owner still referenced by the current party matches only the first. The complete readonly owner snapshot must retain both identities and the enabled flag.

The native branch compares `!contains` with `i1`. The compiler admits the observed Boolean forms, `i1` and `i2` in `{0,1}`, and retains unsupported forms as blockers. It does not interpret arbitrary nonzero operands as new capabilities.

`External.Branch.BranchByPlayerDirection`, RVA `0xb44a20`, obtains `Integrator.entityAccessor` and invokes `IEntityAccessor.GetPlayerEntity`, slot 7. This is the actual player, independent of the current task actor, puppet alias, party leader's replacement sprite, or camera target.

| Player's normalized direction | Selected label |
| --- | --- |
| North / up | `i0` |
| East / right | `i1` |
| South / down | `i2` |
| West / left | `i3` |
| Known zero vector | `i2` |

The direction getter at `0xe0dd70` reads the native direction vector and removes its Y component when both components are nonzero before normalizing. The branch tests X first; at X zero it tests `Y > 0`, so `(0,0)` takes the south path. The Web helper accepts known cardinal directions or an explicit known-zero `null`. An unavailable direction is `undefined` and fails. The current `FieldGame.player` readiness guard requires a prepared nonnull pose before starting the controlled host events; this work does not expand that initialization boundary to unplaced zero-direction players.

Both instructions return `Next` after `JumpCommon`. `JumpCommon` calls `ProgramCounter.JumpTo`; `Core.Clock` then calls `ForwardStep`. A selected label therefore becomes the Web next PC `target + 1`. Label 0 is a real jump to PC 1. The corpus's 957 referenced label operands all point at source `Nop` records. A failed character predicate preserves the already incremented Web cursor and does not range-check the unselected jump.

## Implementation contract

`src/compiler/event-context-branch.ts` exports `compileEventContextBranchInstruction(raw)` and the two recognized mnemonics. It requires complete eight-element integer, real and string arrays, `Format.type=1`, zero reserved integers/reals and empty reserved strings. The shared compiler attaches each site's source provenance and turns a decoder failure into a specific blocked instruction.

`src/core/event-context-branch.ts` exports `EventContextBranchOp`:

```ts
type EventContextBranchOp =
  | {
      kind: "branch-character";
      sourceId: number;
      presence: "present" | "absent";
      scope: "current-party" | "enabled-roster";
      target: number;
    }
  | {
      kind: "branch-player-direction";
      targets: readonly [number, number, number, number];
    };
```

`prepareEventContextBranch(op, input)` takes the already advanced `nextPc`, inclusive source task range and the relevant readonly context. It returns `{pc, branched}` after validation. It never modifies the cursor, event state, party, owned characters or player pose itself.

For a character branch, the caller supplies `FieldPuppetRosterRead` from the existing `puppetRoster.current()` port. That snapshot contains the full owned list and the current four corps owned IDs. Missing ports, duplicate owned identities, duplicate occupied cells and unknown corps references fail before any event marker is written. Source IDs may repeat across distinct owned instances; membership is existential.

For a direction branch, `FieldGame` supplies the actual player's current direction. No roster port is needed. For a character branch, no direction input is needed. The result is applied only after preparation succeeds. No additional checkpoint fields or durable caches are introduced; subsequent instructions and restored sessions read the current owner again.

## Evidence and checks

The native checker binds seven complete C exports and seven original PE ranges to the supplied DLL, exact IL2CPP symbols and structure header:

| Source | Role |
| --- | --- |
| `event-interaction-v39/b43990`, `b44a20` | The two branch bodies and operand/return rules |
| `v18-field-foot-monitor/86e820`, `870230` | Current corps clone and owned lookup |
| `shared-event-vm/2bb700` | Common jump wrapper |
| `event-state/834420` | Inclusive jump bounds and PC assignment |
| `ai-state/82d2c0` | `Next` advances the PC |
| Raw `871840`, `52ffe0`, `4a4310`, `52ffc0`, `530160` | Enabled filtering, identity predicate and identity getters |
| Raw `e0dd70`, shared `409ff0` | Direction input and the reviewed return-zero call sites |

Receipts remain `semanticsVerified: false`. This is static recovery and independent Web testing, not original-game execution.

```sh
npx tsc -p tsconfig.json --outDir build/v39-context-branch-dist
node --test build/v39-context-branch-dist/tests/event-context-branch.test.js
node scripts/check-event-context-branch-native.mjs
node scripts/check-event-context-branch.mjs --compiled-dir build/v39-context-branch-dist
```

The standard source command also accepts the default public `dist` by omitting `--compiled-dir` after the main build. It invokes the native check afresh.

The 13 semantic tests cover strict decoding, both roster scopes, enabled differences, owned/source ID separation, opposite presence predicates, duplicate source identities, unavailable or malformed context, all directions, the known-zero pure case, zero labels, selected target bounds, no mutation on failure and fresh reads.

The source checker separately verifies:

- All 570 source records decode through the shared compiler with exact operands and site provenance.
- 882 character projections and 645 direction projections, with expectations computed from original operands and controlled inputs rather than from the compiled rule output.
- Eight actual `FieldGame` character paths, covering both predicates, scopes and outcomes, followed by checkpoint/restore.
- Four actual `FieldGame` direction paths.
- Two actual `FieldGame` failures for missing or unresolved roster context, with unchanged event state.

The 14 host probes keep the exact source branch and target addresses but replace surrounding instructions with controlled route markers and supply controlled readonly roster/pose inputs. They do not execute the source story. All extracted instructions and source-site reports remain ignored local output in `build/reports/event-context-branch-{native-check,check}.json`.

`BranchByLeader`, `BranchByNumOfMember`, additional direction representations, unsupported operand forms and complete story reachability are outside this increment.
