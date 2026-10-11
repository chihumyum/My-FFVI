# Field task control: source recovery and staged pure capability

This v28 work recovers this build's `Call`, `Return`, `SetPuppet`, `ExecPuppet`, and `FinishPuppet` control rules. It supplies strict decoding and pure projections. **It does not replace the production `FieldGame` scheduler.** The current development `join` implementation remains an approximation; newly recognized asynchronous execution and `FinishPuppet` remain blocked in the shared decoder.

The implementation is deliberately separated from actor initialization. Applying the new scheduling rules while omitting native player/party/companion initialization would turn missing state into incorrect visible behavior. The existing field and audio integration were not edited by this work.

## Evidence and validation

All evidence is from the supplied local PR build. Native DLL SHA-256 is `1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc`. Receipt verification also binds the exact IL2CPP symbol and header digests, every selected method's source-byte range, its next-symbol boundary and the saved C digest. C exports remain static research with `semanticsVerified: false`; no original-game dynamic execution is claimed.

The native checker binds 23 complete method exports and 11 additional PE ranges:

- `v28-opening-primitives`: five instructions.
- `v28-puppet-lifecycle`: entry, Ready, global execution/aliveness, callback, main stack, Core Entry/Exit and Integrator Update.
- `v28-field-visibility-collision`: the three real map/entity/observation setters.
- `v28-puppet-finalize`: player-puppet initialization and world-map-script classification.
- Existing `ai-state` and `event-state`: Core Clock and ProgramCounter JumpTo.
- Raw ranges verify status values, return values, shared stack/constructor aliases, JumpCommon and callback reset. The checker scans direct RIP references across both executable sections for callback metadata; this is not a runtime proof that a callback is absent.

The full local corpus produces these independent counts:

| Instruction | All records | Strictly decoded | Incomplete legacy shape blocked |
| --- | ---: | ---: | ---: |
| Call | 7,898 | 7,892 | 6 |
| Return | 7,916 | 7,907 | 9 |
| SetPuppet | 18,915 | 18,888 | 27 |
| ExecPuppet | 7,810 | 7,796 | 14 |
| FinishPuppet | 477 | 477 | 0 |
| Total | 43,016 | 42,960 | 56 |

These include duplicated source-package records, development/legacy material and scripts outside the playable profile. They are not map coverage or gameplay acceptance. Every record in the ignored report retains source-set identity, source file/object string identity, source digest and instruction pointer/hash. The checker verifies 7,796 generated helper pairs, including 477 asynchronous pairs.

Fourteen synthetic semantic tests cover source operand rejection, nested call/return addresses, an expanding stack, bounded puppet ranges, global slot ordering, initial synchronous yield, asynchronous continuation, Finish, callbacks, missing actor identity, world-map collision exclusion and frame-end cancellation. The source checker additionally exercises two controlled pure projections using actual source synchronous/asynchronous instructions. The actor and slot contexts in these probes are explicitly synthetic.

```sh
npx tsc -p tsconfig.json --outDir build/v28-task-dist
node --test build/v28-task-dist/tests/field-task-control.test.js
node scripts/check-field-task-control-native.mjs
node scripts/check-field-task-control.mjs --compiled-dir build/v28-task-dist
```

Reports: `build/reports/field-task-control-native-check.json` and `build/reports/field-task-control-check.json`. The latter invokes the native check afresh. Validation logs use `build/reports/v28-task-{tsc,tests,native,source}.log`.

## Actual control rules

`Internal.Main.Call` at `0x2bae50` pushes the current Call address and tail-calls `JumpCommon` (`0x2bb790`). Only `iValues[0]` is read. The generated `iValues[1] == 1` marker does **not** spawn an asynchronous Call. In this corpus it corresponds to an `ExecPuppet(i0=1)` inside the called helper. `Return` (`0x2bc4c0`) pops the address and jumps back.

`Core.Clock` (`0x82d2c0`) forwards the PC after every `Next`, then keeps executing that same core until a non-Next result. Therefore a Web VM whose PC already points after the current opcode must enter Call at `target + 1`, and store/resume the caller's next PC. The 256 constant is the initial `Stack<int>` capacity. `set_sp` dispatches to the generic Push implementation, which grows the backing array; a 64/256 recursion limit is not a recovered native rule. A Web execution budget is a separate runtime protection.

`SetPuppet` (`0x2c78f0`) uses `i0=track`, `i1=entity`, `i2=entry`. `PuppetCoreEntry` (`0x5f40c0`) selects global core `track + 1`; tracks are 0–31. The slot must be `Sleep`. It scans from entry to the first mnemonic `Exit`, stores that inclusive range, and marks the core `Awake`. Unlike Call, Core Entry executes the entry itself. A staged slot is not a child collection owned by the caller's stack frame.

On the first clock, `ExecPuppet` (`0x2bfa70`) invokes its callback if present, readies every globally Awake slot in ascending order, clears the five party-assignment flags, and disables three collision/observation systems unless this is a world-map map script. `i0 == 1` returns `Next`; otherwise it returns `Blank` even if all newly readied actors proved absent. Later clocks wait while any global slot is Ready, then enable the three systems and return Next. An empty Awake set raises the native WarningFactor path; its alert continuation is not implemented by the pure module, so that case stays explicit.

`FinishPuppet` (`0x2bfec0`) only polls global Ready slots. It does not start Awake slots, cancel tasks, join just one batch, or inspect a parent's children. When none are Ready it applies the same collision completion rule and returns Next. `IsPuppetCoreAlive` (`0x5f3df0`) tests status 2, Ready; status 1, Awake, is excluded.

`PuppetCore.Ready` (`0x5f64d0`) resolves the current source entity. A source-proven null Unity entity sleeps immediately; an existing entity receives `Show(0)`. An unresolved Web binding is not a source-proven null entity. `Core.Exit` clears instruction/script references and sets Sleep; it does not prove cancellation of an independent renderer tween or movement.

`Integrator.Update` (`0x5f4fd0`) clocks the main core first, then slots in order. Every Clock drains that one core's consecutive Next operations. A puppet reaching Halt is immediately exited. If the main core reaches Halt, that frame's remaining puppet clocks still run before frame-end forced Exit of still-Ready puppets. Those tasks do not survive a completed main script. The native finalization path then has additional actor work described below.

## Pure interfaces

`src/core/field-task-control.ts` owns no persistent tasks or actor state:

- `prepareFieldCall` / `prepareFieldReturn` take an inclusive source range and return detached `{pc, stack}` candidates using Web next-op addresses.
- `prepareFieldPuppetEntry` requires all 32 explicit slot statuses and the compiled instruction list, then returns the selected entry and first-Exit range. It does not resolve source actor aliases or publish a task.
- `fieldPuppetControlStep` takes first/resume clock, asynchronous mode, explicit world-map-script classification, callback applicability and the global slots. It returns `flow`, `startSlots`, `collisionEnabled` and `clearAssignments`.
- `projectFieldPuppetReady` distinguishes proven present, proven absent and unknown entity binding. Its Show projection is a host obligation.
- `fieldPuppetMainEnd` selects still-Ready slots after the frame. It is not the complete actor-finalization plan.

`src/compiler/field-task-control.ts` requires exact eight-element integer/real/string arrays, checked integer ranges, known format types and reserved zero/empty fields. Generated type-2 records can execute in the main core; their format type is not proof of a PuppetCore execution context. Missing legacy arrays are not padded from an assumed default. `Call.i1` accepts the two observed marker values but has no runtime asynchronous effect.

## Required host closure before production integration

The next integration batch must address these together:

1. **Player and party aliases.** `PuppetCoreEntry` remaps `-1001`, the status-resident leader identity, resident character identities and party puppet identities. It can copy position/layer, show or hide entities, and alter party assignment. The `characteristics && !keepPlayerPuppet` branch may skip player registration; it examines the next mnemonic and has a distinct Hide path. Neither a negative source ID nor a Web entity with the same name is sufficient proof of identity.
2. **Initial and final actor state.** `InitializePlayerPuppetEntities` (`0x5f2e90`) runs around ordinary field scripts under the native `isFieldScript`, `isSkipInitialize` and hooked-script conditions. It initializes the camera dummy, projects the leader and six native puppet identities, handles the companion, copies position/layer/facing/animation, and applies riding/visibility behavior. The final path can restore the player from its puppet. Existing hidden actor media state alone does not supply all positions, layers or camera context.
3. **Callbacks.** The source callback's empty static constructor is a return stub. Nine direct setter methods bind `ExecPuppetCallbackCommon`; `ResetReplaceEntity` clears it. The callback can remap Awake entities, disable a zero replacement and copy player Z/layer. A new process with a proven lifecycle can establish initial absence, and a closed instruction set can preserve it. An imported or saved unknown context cannot declare itself absent. Unsupported setters remain blocked.
4. **Collision ownership.** `SetMapColliderEnabled` toggles MapColliderCreator base layers 9/10/11; `SetEntityCollisionEnabled` dispatches to resident, companion, party and map entities; `SetInteractiveTargetObservationEnabled` writes the observer's `isObserving`. Do not replace these with a single `busy` flag or accidentally re-enable each entity's permanent collision configuration. The map exception is `CheckCurrentWorldMap() && integrator.isMapScript`, not every script occurring on a world map. Initialization/finalization is not evidence of automatic collision restoration.
5. **One scheduler and atomic publication.** Replace current task-local pending lists and per-parent child waits with one global slot table in the existing owner. Preflight the entire Exec batch before incrementing task IDs, publishing Show, starting movement or changing collision state. A failure in a later slot must not leave earlier tasks running. Preserve owner leases, dialogue/audio waits, treasure handoff and encounter/map transitions.
6. **Frame order and cancellation.** Drain one core's Next instructions until wait before moving to the next core. Prevent the current pump's instruction-by-instruction interleaving and repeated clocks in one logical frame. Apply main-end cancellation after the frame, followed by the recovered finalization transaction. Validate source ranges at jumps and returns.
7. **Checkpoint context.** Stable saves must not serialize pending/active slots as idle or reset disabled collision/unknown callback state by omission. Establish trusted entry context and decide the stable checkpoint contract before changing the live scheduler. Old development checkpoints are not proof that native initialization ran.

The production decoder is intentionally not routed to this module yet. The source report includes its current routing separately. This staged capability should not be counted as completion of the field task system, a fresh new-game host, or asynchronous story playback.
