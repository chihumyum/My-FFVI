import { canonical } from "./canonical.js";
import { checkpointKeys } from "./checkpoint-validation.js";
import type { NewGamePlan } from "./new-game.js";

/** The source-owned domains established by DataInitializeManager.Create that
 * are not represented by roster/inventory/EventState. This version retains
 * their proven initialization values; later writes require their own source
 * providers and are deliberately not inferred from Web clocks or receipts.
 *
 * entrySeed is immutable before-field-load provenance. Current map, player
 * position, selected transportation and entry synchronization remain owned by
 * FieldGame/WorldSession rather than duplicated here. */
export type SourceNativeState = NewGamePlan["nativeInitialization"] & {
  kind: "source-native-state-v1";
  entrySeed: NewGamePlan["entry"];
};

/** Consumes an already source-bound initializer without changing its fields or
 * sharing mutable arrays with the plan, content, field or another session. */
export function createSourceNativeState(plan: NewGamePlan): SourceNativeState {
  if (!plan || plan.kind !== "source-new-game-plan-v1" ||
      plan.stage !== "after-data-create-before-field-load")
    throw new Error("Missing source native-state initializer");
  return structuredClone({
    kind: "source-native-state-v1",
    entrySeed: plan.entry,
    ...plan.nativeInitialization,
  });
}

/** Stored values are checked, never repaired or filled from the initializer.
 * A parking, crystal, warehouse, magic or counter change has no admitted
 * provider in this schema. Rejecting it keeps that limitation explicit rather
 * than accepting arbitrary save data as proof of the missing transition. */
export function validateSourceNativeState(
  state: SourceNativeState,
  initial: Readonly<SourceNativeState>,
): void {
  checkpointKeys(state,
    "kind,entrySeed,ownedTransportationIds,parkedTransportationMapIds,crystalFlags,warehouseItems,keywords,ownedMagic,ownedMagicStones,counters");
  if (state.kind !== "source-native-state-v1" || initial.kind !== "source-native-state-v1")
    throw new Error("Source native-state version mismatch");
  if (canonical(state) !== canonical(initial))
    throw new Error("Unimplemented source native-state change or mismatched entry seed");
}
