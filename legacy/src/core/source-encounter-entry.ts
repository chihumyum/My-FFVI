import { checkpointInteger } from "./checkpoint-validation.js";
import type { SourceEncounterFootBackground } from "./source-encounter-foot.js";
import type { SourceEncounterCommand } from "./source-encounter.js";
import { parseSourceEncounterCommand, selectSourceEncounterSlot, sourceEncounterCandidates } from "./source-encounter.js";

/** Explicit Web host policy. Source slot multiplicity is retained, but this
 * deterministic seed mapping is not the original Unity random stream. */
export const WEB_SOURCE_ENCOUNTER_POLICY = "web-source-encounter-uniform-slots-v1" as const;
export type WebSourceEncounterPolicy = typeof WEB_SOURCE_ENCOUNTER_POLICY;
export type SourceEncounterSelection = ReturnType<typeof selectSourceEncounterSlot>;
export type FieldSourceEncounterPort = {
  readonly policy: WebSourceEncounterPolicy;
  prepare(command: SourceEncounterCommand): { readonly selection: SourceEncounterSelection; validate(): void };
};
export type SourceEncounterRequest = {
  kind: "source-encounter-request-v1";
  policy: WebSourceEncounterPolicy;
  command: SourceEncounterCommand;
  selection: SourceEncounterSelection;
  foot: SourceEncounterFootBackground;
};

/** Reuses the session's already persisted seed and committed encounter serial.
 * No mutable RNG owner or hidden draw is installed in FieldGame. Every pending
 * request retains this one result, including host cancellation and retry. */
export function selectWebSourceEncounter(command: SourceEncounterCommand, seed: number, serial: number): SourceEncounterSelection {
  checkpointInteger(seed, 0, 0xffffffff); checkpointInteger(serial, 0, Number.MAX_SAFE_INTEGER);
  const parsed = parseSourceEncounterCommand(command), count = sourceEncounterCandidates(parsed).length;
  // Domain separation from battle formation/AI. Rejection sampling removes
  // modulo bias. This Web mapping deliberately does not assert Unity parity.
  let rng = (seed ^ Math.imul(serial >>> 0, 0x9e3779b1) ^ Math.imul(Math.floor(serial / 0x100000000), 0x85ebca6b) ^ 0x53454e43) >>> 0;
  const limit = 0x100000000 - 0x100000000 % count;
  do { rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0; } while (rng >= limit);
  return selectSourceEncounterSlot(parsed, { policy: WEB_SOURCE_ENCOUNTER_POLICY, drawIndex: rng % count });
}
