import { canonical } from "./canonical.js";
import { checkpointKeys } from "./checkpoint-validation.js";
import type { NewGamePlan } from "./new-game.js";
import { initialOwnedTransportations, validateOwnedTransportations,
  type OwnedTransportation } from "./transportation-state.js";

/** The source-owned domains established by DataInitializeManager.Create that
 * are not represented by roster/inventory/EventState. OwnedMagic evolves only
 * through source-bound observed learning. Transportation parking evolves
 * through its complete payload transaction. Other domains retain their proven
 * initialization values until their mutation providers are implemented.
 *
 * entrySeed is immutable before-field-load provenance. Current map, player
 * position, selected transportation and entry synchronization remain owned by
 * FieldGame/WorldSession rather than duplicated here. */
export type SourceNativeState = Omit<NewGamePlan["nativeInitialization"],
  "ownedMagic" | "ownedMagicStones" | "ownedTransportationIds" | "parkedTransportationMapIds"> & {
  /** Content identities in the native global OwnedMagicList. */
  ownedMagic: number[];
  /** Ordered, unique content IDs; admitted only by a bound magic-stone catalog. */
  ownedMagicStones: number[];
  ownedTransportations: OwnedTransportation[];
  kind: "source-native-state-v2";
  entrySeed: NewGamePlan["entry"];
};

/** Consumes an already source-bound initializer without changing its fields or
 * sharing mutable arrays with the plan, content, field or another session. */
export function createSourceNativeState(plan: NewGamePlan): SourceNativeState {
  if (!plan || plan.kind !== "source-new-game-plan-v1" ||
      plan.stage !== "after-data-create-before-field-load")
    throw new Error("Missing source native-state initializer");
  const { ownedTransportationIds, parkedTransportationMapIds, ...native } = plan.nativeInitialization;
  return structuredClone({
    kind: "source-native-state-v2",
    entrySeed: plan.entry,
    ...native,
    ownedTransportations: initialOwnedTransportations(ownedTransportationIds, parkedTransportationMapIds),
  });
}

/** Stored values are checked, never repaired or filled from the initializer.
 * Only a source-replayed observed-learning ledger may change ownedMagic.
 * Parking and bound magic-stone ownership have mutation providers; crystal, warehouse and
 * counter changes remain unadmitted. Rejecting them keeps that limitation explicit rather
 * than accepting arbitrary save data as proof of the missing transition. */
export function validateSourceNativeState(
  state: SourceNativeState,
  initial: Readonly<SourceNativeState>,
  expectedOwnedMagic: readonly number[] = initial.ownedMagic,
  admittedMagicStoneIds?: readonly number[],
): void {
  checkpointKeys(state,
    "kind,entrySeed,ownedTransportations,crystalFlags,warehouseItems,keywords,ownedMagic,ownedMagicStones,counters");
  if (state.kind !== "source-native-state-v2" || initial.kind !== "source-native-state-v2")
    throw new Error("Source native-state version mismatch");
  if (!Array.isArray(expectedOwnedMagic) || new Set(expectedOwnedMagic).size !== expectedOwnedMagic.length ||
      expectedOwnedMagic.some((id) => !Number.isSafeInteger(id) || id <= 0))
    throw new Error("Invalid source owned magic projection");
  validateOwnedTransportations(state.ownedTransportations, initial.ownedTransportations.map((record) => record.id));
  if (admittedMagicStoneIds !== undefined && (!Array.isArray(state.ownedMagicStones) ||
      new Set(state.ownedMagicStones).size !== state.ownedMagicStones.length ||
      state.ownedMagicStones.some(id => !Number.isInteger(id) || id <= 0 || !admittedMagicStoneIds.includes(id))))
    throw new Error("Invalid source owned magic stone identity or order");
  if (canonical(state) !== canonical({ ...initial, ownedMagic: expectedOwnedMagic,
    ownedTransportations: state.ownedTransportations,
    ...(admittedMagicStoneIds === undefined ? {} : { ownedMagicStones: state.ownedMagicStones }) }))
    throw new Error("Unimplemented source native-state change or mismatched entry seed");
}
