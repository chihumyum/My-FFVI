import { EventState, validVariable, type EventStateSnapshot, type VariableRef } from "./event-state.js";
import { checkpointKeys } from "./checkpoint-validation.js";
import { canonical } from "./canonical.js";

/** Durable event banks have one owner in FieldGame/WorldSession. The battle
 * borrows a candidate, as it already does for characters and inventory. This
 * publication policy is a Web transaction contract: the source DataStorage
 * singleton writes immediately. Field/AI script-local banks are never borrowed. */
export type BattleEventSharedSnapshot = Pick<EventStateSnapshot, "scenario" | "treasure" | "global">;
export type BattleEventSharedReturn = {
  kind: "battle-event-shared-return-v1";
  entry: BattleEventSharedSnapshot;
  candidate: BattleEventSharedSnapshot;
};

export function isBattleEventSharedVariable(ref: VariableRef): boolean {
  return validVariable(ref) && /^(ScenarioFlag[1-4]|TreasureFlag[1-4]|ScenarioVariable)$/.test(ref.category);
}

function eventSnapshot(raw: unknown): EventStateSnapshot {
  checkpointKeys(raw, "scenario,treasure,global");
  const value = raw as BattleEventSharedSnapshot;
  // EventState validates exact bank sizes, int32 values, and flag/null values.
  // Array.from also visits sparse entries; holes cannot become unknown cells.
  const bank = (values: unknown): (number | null)[] => {
    if (!Array.isArray(values)) throw new Error("Missing shared battle event bank");
    return Array.from(values, value => {
      if (value !== null && typeof value !== "number") throw new Error("Invalid shared battle event value");
      return value;
    });
  };
  return { ...new EventState().snapshot(), scenario: bank(value.scenario),
    treasure: bank(value.treasure), global: bank(value.global) };
}

export function parseBattleEventSharedSnapshot(raw: unknown): BattleEventSharedSnapshot {
  return battleEventSharedSnapshot(new EventState(eventSnapshot(raw)));
}

export function battleEventSharedSnapshot(owner: EventState): BattleEventSharedSnapshot {
  const { scenario, treasure, global } = owner.snapshot();
  return { scenario, treasure, global };
}

/** Only the candidate is mutable; entry is fixed for retries and stale-return
 * checks. A simulation-frame failure restores candidate without touching the
 * persistent owner, its selected values, or any suspended script-local frame. */
export class BattleEventSharedState {
  private readonly initial: BattleEventSharedSnapshot;
  private state: EventState;
  constructor(raw: BattleEventSharedSnapshot) {
    this.initial = parseBattleEventSharedSnapshot(raw);
    this.state = new EventState(eventSnapshot(this.initial));
  }
  read(ref: VariableRef): number {
    if (!isBattleEventSharedVariable(ref)) throw new Error("Unsupported shared battle event variable");
    return this.state.read(ref);
  }
  write(ref: VariableRef, value: number): void {
    if (!isBattleEventSharedVariable(ref)) throw new Error("Unsupported shared battle event variable");
    this.state.write(ref, value);
  }
  get entry(): BattleEventSharedSnapshot { return structuredClone(this.initial); }
  snapshot(): BattleEventSharedSnapshot { return battleEventSharedSnapshot(this.state); }
  restore(raw: BattleEventSharedSnapshot): void {
    const next = parseBattleEventSharedSnapshot(raw);
    this.state = new EventState(eventSnapshot(next));
  }
  prepareReturn(): BattleEventSharedReturn {
    return { kind: "battle-event-shared-return-v1", entry: this.entry, candidate: this.snapshot() };
  }
}

/** Prepare all writes before publishing owned rewards or field continuation.
 * Validation compares every borrowed cell, including cells only read by a
 * branch. Publication changes cells in the existing owner; it never replaces
 * EventState and never resets or invalidates captured ScriptLocal frames. */
export function prepareBattleEventSharedReturn(owner: EventState, raw: BattleEventSharedReturn): {
  validate(): void;
  commit(): void;
  /** The caller's prepared owned publication must contain no host callback. */
  commitWith(publishOwned: () => void): void;
} {
  checkpointKeys(raw, "kind,entry,candidate");
  if (raw.kind !== "battle-event-shared-return-v1") throw new Error("Invalid shared battle event return");
  const entry = parseBattleEventSharedSnapshot(raw.entry), candidate = parseBattleEventSharedSnapshot(raw.candidate);
  const before = canonical(entry);
  const writes: { ref: VariableRef; value: number }[] = [];
  for (const key of ["scenario", "treasure", "global"] as const) {
    for (const [index, value] of candidate[key].entries()) {
      if (value === entry[key][index]) continue;
      if (value === null) throw new Error("Battle event return cannot erase a known value");
      const category = key === "global" ? "ScenarioVariable" :
        `${key === "scenario" ? "Scenario" : "Treasure"}Flag${Math.floor(index / 256) + 1}`;
      const ref = { category, index: key === "global" ? index : index % 256 } as VariableRef;
      writes.push({ ref, value });
    }
  }
  const draft = new EventState(owner.snapshot());
  for (const { ref, value } of writes) draft.write(ref, value);
  let consumed = false;
  const validate = () => {
    if (consumed || canonical(battleEventSharedSnapshot(owner)) !== before)
      throw new Error("Stale shared battle event return");
  };
  validate();
  const commitWith = (publishOwned: () => void) => {
    validate();
    consumed = true;
    publishOwned();
    // Every address/value was validated above. No host callback or parsing
    // occurs after the first write, and the current local bank is untouched.
    for (const { ref, value } of writes) owner.write(ref, value);
  };
  return { validate, commit: () => commitWith(() => {}), commitWith };
}
