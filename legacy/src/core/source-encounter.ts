export const WEB_SOURCE_ENCOUNTER_UNIFORM_SLOTS = "web-source-encounter-uniform-slots-v1" as const;
export type SourceEncounterCommand = {
  kind: "source-encounter";
  /** Original positions, including zero sentinels and duplicate probability
   * slots. MonsterParty identities are not player Corps/owned identities. */
  slots: [number, number, number, number];
  effectId: number;
  continuation: string;
  footCapture: "before-player-sync";
};
export type SourceEncounterOp = { kind: "source-encounter"; command: SourceEncounterCommand };
export type SourceEncounterSlot = { slotIndex: 0 | 1 | 2 | 3; partyId: number };
export type SourceEncounterSelection = SourceEncounterSlot & Pick<SourceEncounterCommand,
  "effectId" | "continuation" | "footCapture">;
const integer = (value: unknown, minimum: number): value is number => Number.isInteger(value) &&
  (value as number) >= minimum && (value as number) <= 0x7fffffff;
/** Validate descriptors before reading values: a purported data command must
 * not execute caller code or hide grants in symbol/accessor/array properties. */
function dataKeys(raw: unknown, keys: string): void {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(raw)))
    throw new Error("Invalid source encounter checkpoint object");
  const expected = keys.split(",").sort(), actual = Reflect.ownKeys(raw), descriptors = Object.getOwnPropertyDescriptors(raw);
  if (actual.some(key => typeof key !== "string") || actual.length !== expected.length ||
      (actual as string[]).sort().some((key, index) => key !== expected[index]) ||
      Object.values(descriptors).some(descriptor => !descriptor.enumerable || !("value" in descriptor)))
    throw new Error("Invalid source encounter checkpoint data fields");
}
function denseSlots(raw: unknown): asserts raw is SourceEncounterCommand["slots"] {
  if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype)
    throw new Error("Invalid source encounter party slot prototype");
  const keys = Reflect.ownKeys(raw), descriptors: Record<string, PropertyDescriptor> = Object.getOwnPropertyDescriptors(raw);
  if (keys.length !== 5 || keys.some(key => typeof key !== "string" || !["0", "1", "2", "3", "length"].includes(key)) ||
      descriptors.length?.value !== 4 ||
      ["0", "1", "2", "3"].some(key => !descriptors[key]?.enumerable || !("value" in descriptors[key]!)))
    throw new Error("Invalid source encounter dense party slot data");
}

/** Native ChooseEncountPartyIndex skips i4 and zero values, then matches the
 * random draw against the ORIGINAL physical index. All observed source slots
 * are contiguous from i0. Gaps, ZeroEncount dispatch and negative IDs require
 * distinct source contracts; they must not turn into compressed/default RNG. */
export function parseSourceEncounterCommand(raw: SourceEncounterCommand): SourceEncounterCommand {
  dataKeys(raw, "kind,slots,effectId,continuation,footCapture");
  denseSlots(raw.slots);
  if (raw.kind !== "source-encounter" || raw.footCapture !== "before-player-sync" ||
      !Array.isArray(raw.slots) || raw.slots.length !== 4 ||
      typeof raw.continuation !== "string" || !raw.continuation || raw.continuation.trim() !== raw.continuation ||
      !integer(raw.effectId, 0)) throw new Error("Invalid source encounter command or continuation");
  let empty = false, count = 0;
  for (let index = 0; index < 4; index++) {
    const value = raw.slots[index];
    if (!Object.hasOwn(raw.slots, index) || !integer(value, 0)) throw new Error("Invalid source encounter party slot");
    if (value === 0) empty = true;
    else {
      if (empty) throw new Error("Source encounter slots with gaps require their original-index lottery contract");
      count++;
    }
  }
  if (!count) throw new Error("Source ZeroEncount dispatcher is not implemented");
  return { kind: "source-encounter", slots: [raw.slots[0], raw.slots[1], raw.slots[2], raw.slots[3]], effectId: raw.effectId,
    continuation: raw.continuation, footCapture: "before-player-sync" };
}
export function sourceEncounterCandidates(command: SourceEncounterCommand): SourceEncounterSlot[] {
  return parseSourceEncounterCommand(command).slots.flatMap((partyId, index) => partyId > 0
    ? [{ slotIndex: index as SourceEncounterSlot["slotIndex"], partyId }] : []);
}
/** Pure interpretation of an already-prepared draw, never a random owner or
 * a native-RNG parity grant. Callers explicitly declare the deterministic Web
 * policy and supply a valid uniform slot index from their existing RNG owner.
 * Even a single-slot request requires that explicit input. */
export function selectSourceEncounterSlot(command: SourceEncounterCommand, input: {
  policy: typeof WEB_SOURCE_ENCOUNTER_UNIFORM_SLOTS;
  drawIndex: number;
}): SourceEncounterSelection {
  dataKeys(input, "policy,drawIndex");
  if (input.policy !== WEB_SOURCE_ENCOUNTER_UNIFORM_SLOTS)
    throw new Error("Source encounter selection requires its explicit Web uniform-slot policy");
  const parsed = parseSourceEncounterCommand(command), candidates = sourceEncounterCandidates(parsed);
  if (!integer(input.drawIndex, 0) || input.drawIndex >= candidates.length)
    throw new Error("Invalid prepared source encounter slot draw");
  const selected = candidates[input.drawIndex]!;
  return { ...selected, effectId: parsed.effectId, continuation: parsed.continuation, footCapture: parsed.footCapture };
}
