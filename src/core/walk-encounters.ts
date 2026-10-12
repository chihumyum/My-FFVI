import { canonical } from "./canonical.js";

/** Authored Web framework rules, not a conversion of native required_steps. */
export type FrameworkWalkEncounterPolicy = {
  kind: "framework-walk-encounters-v1";
  id: string;
  minSteps: number;
  maxSteps: number;
  transportationIds: number[];
  parties: { partyId: number; weight: number }[];
};
export type WalkEncounterSnapshot = {
  kind: "framework-walk-encounter-state-v1";
  seed: number;
  rng: number;
  completedSteps: number;
  encounters: number;
  maps: { mapId: number; policy: FrameworkWalkEncounterPolicy; remainingSteps: number }[];
};
export type WalkEncounterPrepared = {
  readonly partyId: number | null;
  validate(): void;
  /** Synchronous publication. If it throws, this scheduler stays unchanged and
   * the candidate is consumed. The callback owns its own failure atomicity. */
  commitWith(publishStep: () => void): void;
};

const UINT32_MAX = 0xffffffff;
const UINT32_SIZE = 0x100000000;
function record(raw: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(raw)))
    throw new Error(`Invalid ${label} object`);
  const ownKeys = Reflect.ownKeys(raw);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== "string" || !keys.includes(key)) ||
      keys.some((key) => !Object.getOwnPropertyDescriptor(raw, key)?.enumerable ||
        !("value" in Object.getOwnPropertyDescriptor(raw, key)!)))
    throw new Error(`Invalid ${label} fields`);
  return raw as Record<string, unknown>;
}
function integer(raw: unknown, min: number, max: number, label: string): number {
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || Object.is(raw, -0) || raw < min || raw > max)
    throw new Error(`Invalid ${label}`);
  return raw;
}
function array(raw: unknown, label: string): unknown[] {
  if (!Array.isArray(raw) || Reflect.ownKeys(raw).length !== raw.length + 1)
    throw new Error(`Invalid ${label} array`);
  for (let index = 0; index < raw.length; index++) {
    const property = Object.getOwnPropertyDescriptor(raw, index);
    if (!property?.enumerable || !("value" in property))
      throw new Error(`Invalid ${label} array`);
  }
  return raw;
}
const identity = (raw: unknown, label: string): number => integer(raw, 1, 0x7fffffff, label);

export function parseFrameworkWalkEncounterPolicy(raw: unknown): FrameworkWalkEncounterPolicy {
  const value = record(raw, ["kind", "id", "minSteps", "maxSteps", "transportationIds", "parties"], "walk encounter policy");
  if (value.kind !== "framework-walk-encounters-v1" || typeof value.id !== "string" ||
      !value.id.length || value.id.trim() !== value.id)
    throw new Error("Invalid walk encounter policy identity");
  const minSteps = integer(value.minSteps, 1, UINT32_MAX, "minimum walk steps");
  const maxSteps = integer(value.maxSteps, minSteps, UINT32_MAX, "maximum walk steps");
  const transportationIds = array(value.transportationIds, "walk transportation").map((id) => identity(id, "walk transportation identity"));
  if (!transportationIds.length || new Set(transportationIds).size !== transportationIds.length)
    throw new Error("Missing or duplicate walk transportation identity");
  const parties = array(value.parties, "walk parties").map((rawParty) => {
    const party = record(rawParty, ["partyId", "weight"], "walk party");
    return { partyId: identity(party.partyId, "walk party identity"),
      weight: integer(party.weight, 1, UINT32_MAX, "walk party weight") };
  });
  if (!parties.length || new Set(parties.map((party) => party.partyId)).size !== parties.length)
    throw new Error("Missing or duplicate walk party identity");
  if (parties.reduce((sum, party) => sum + party.weight, 0) > UINT32_MAX)
    throw new Error("Walk party total weight exceeds uint32 range");
  return { kind: value.kind, id: value.id, minSteps, maxSteps, transportationIds, parties };
}

function parseSnapshot(raw: unknown, seed: number): WalkEncounterSnapshot {
  const value = record(raw, ["kind", "seed", "rng", "completedSteps", "encounters", "maps"], "walk encounter snapshot");
  if (value.kind !== "framework-walk-encounter-state-v1" ||
      integer(value.seed, 0, UINT32_MAX, "walk seed") !== seed)
    throw new Error("Walk encounter snapshot seed or format mismatch");
  const rng = integer(value.rng, 0, UINT32_MAX, "walk random state");
  const completedSteps = integer(value.completedSteps, 0, Number.MAX_SAFE_INTEGER, "completed walk steps");
  const encounters = integer(value.encounters, 0, completedSteps, "walk encounter count");
  const maps = array(value.maps, "walk maps").map((rawMap) => {
    const map = record(rawMap, ["mapId", "policy", "remainingSteps"], "walk map state");
    const mapId = identity(map.mapId, "walk map identity"), policy = parseFrameworkWalkEncounterPolicy(map.policy);
    const remainingSteps = integer(map.remainingSteps, 1, policy.maxSteps, "remaining walk steps");
    return { mapId, policy, remainingSteps };
  });
  if (new Set(maps.map((map) => map.mapId)).size !== maps.length)
    throw new Error("Duplicate walk map identity");
  if (maps.length > completedSteps || (completedSteps > 0 && maps.length === 0) ||
      (completedSteps === 0 && rng !== seed))
    throw new Error("Inconsistent walk encounter snapshot counters");
  return { kind: value.kind, seed, rng, completedSteps, encounters, maps: maps.sort((a, b) => a.mapId - b.mapId) };
}

/** One session-owned deterministic stream with persistent per-map countdowns.
 * The host calls prepareStep only for an eligible successful free-movement
 * step. Script movement, transportation and event priority belong to the host.
 * RNG: full-period uint32 LCG and rejection sampling; both threshold endpoints
 * are included, and a constant range still consumes one random draw. */
export class WalkEncounterState {
  private readonly seed: number;
  private value: WalkEncounterSnapshot;
  private committing = false;

  constructor(seed: number) {
    this.seed = integer(seed, 0, UINT32_MAX, "walk seed");
    this.value = { kind: "framework-walk-encounter-state-v1", seed: this.seed, rng: this.seed,
      completedSteps: 0, encounters: 0, maps: [] };
  }

  snapshot(): WalkEncounterSnapshot { return structuredClone(this.value); }

  restore(raw: unknown): void {
    this.unlocked();
    const next = parseSnapshot(raw, this.seed);
    this.value = next;
  }

  /** Validates a known binding without installing a new map or consuming RNG. */
  assertPolicy(mapId: number, rawPolicy: FrameworkWalkEncounterPolicy): void {
    identity(mapId, "walk map identity");
    const policy = parseFrameworkWalkEncounterPolicy(rawPolicy);
    const bound = this.value.maps.find((map) => map.mapId === mapId);
    if (bound && canonical(bound.policy) !== canonical(policy))
      throw new Error(`Walk encounter policy binding mismatch for map ${mapId}`);
  }

  prepareStep(mapId: number, rawPolicy: FrameworkWalkEncounterPolicy): WalkEncounterPrepared {
    this.unlocked();
    const policy = parseFrameworkWalkEncounterPolicy(rawPolicy);
    this.assertPolicy(mapId, policy);
    const before = this.value, next = structuredClone(before);
    if (next.completedSteps === Number.MAX_SAFE_INTEGER)
      throw new Error("Completed walk step counter overflow");
    const bounded = (size: number): number => {
      const limit = UINT32_SIZE - UINT32_SIZE % size;
      let value: number;
      do {
        next.rng = (Math.imul(next.rng, 1664525) + 1013904223) >>> 0;
        value = next.rng;
      } while (value >= limit);
      return value % size;
    };
    const threshold = (): number => policy.minSteps + bounded(policy.maxSteps - policy.minSteps + 1);
    let map = next.maps.find((entry) => entry.mapId === mapId);
    if (!map) {
      map = { mapId, policy, remainingSteps: threshold() };
      next.maps.push(map); next.maps.sort((a, b) => a.mapId - b.mapId);
    }
    map.remainingSteps--;
    next.completedSteps++;
    let partyId: number | null = null;
    if (map.remainingSteps === 0) {
      let draw = bounded(policy.parties.reduce((sum, party) => sum + party.weight, 0));
      for (const party of policy.parties) {
        if (draw < party.weight) { partyId = party.partyId; break; }
        draw -= party.weight;
      }
      if (partyId === null) throw new Error("Invalid walk party draw");
      next.encounters++;
      map.remainingSteps = threshold();
    }
    let consumed = false;
    const validate = (): void => {
      if (consumed) throw new Error("Walk encounter candidate already consumed");
      this.unlocked();
      if (this.value !== before) throw new Error("Stale walk encounter candidate");
    };
    return Object.freeze({ partyId, validate, commitWith: (publishStep: () => void): void => {
      validate();
      if (typeof publishStep !== "function") throw new Error("Missing walk step publication");
      consumed = true;
      this.committing = true;
      try {
        // All scheduler work and copies are complete before external publication.
        // No owner reads or fallible scheduler validation follow a valid callback.
        publishStep();
        this.value = next;
      } finally { this.committing = false; }
    } });
  }

  private unlocked(): void {
    if (this.committing) throw new Error("Walk encounter publication is reentrant");
  }
}
