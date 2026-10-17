import type { Evidence } from "../field/types.js";

export type FieldParticleArrayDefinition = {
  kind: "unity-field-particle-array-v1";
  source: Evidence;
  engine: { nativeSha256: string; pdbGuid: string; pdbAge: number; version: string };
  maximumParticles: number;
  ringBufferMode: 0;
  collision: false;
  subEmitters: false;
  trails: false;
};
export type ParticleArrayTrace =
  | { operation: "kill" | "assign"; index: number; fromIndex: number }
  | { operation: "resize"; count: number };
export type ParticleArrayResult<T> = { records: T[]; trace: ParticleArrayTrace[] };
const limit = Math.fround(100.00000762939453);
function count(n: number): void {
  if (!Number.isSafeInteger(n) || n < 0 || n > 1000000) throw new Error("Invalid native particle array count");
}
export function validateFieldParticleArray(definition: FieldParticleArrayDefinition): void {
  if (!definition || definition.kind !== "unity-field-particle-array-v1" ||
      definition.engine?.nativeSha256 !== "7930dbf028be9e3d146a92dc756a166f10cada81f433c49b8fb4eb6767ae9845" ||
      definition.engine.pdbGuid !== "4420B376-89DD-4CFE-AEC8-2300F4A999D2" || definition.engine.pdbAge !== 1 ||
      definition.engine.version !== "2019.4.20f1_6dd1c08eedfa") throw new Error("Unbound native particle array definition");
  count(definition.maximumParticles);
  if (definition.ringBufferMode !== 0 || definition.collision !== false || definition.subEmitters !== false || definition.trails !== false)
    throw new Error("Unrecovered particle array lifecycle branch");
}
function validateRecords<T extends { agePercent: number }>(records: readonly T[]): void {
  if (!Array.isArray(records)) throw new Error("Missing native particle records");
  for (const record of records) if (!record || typeof record.agePercent !== "number" || !Number.isFinite(record.agePercent) ||
    record.agePercent < 0 || record.agePercent > limit) throw new Error("Invalid native particle age");
}
function assign<T>(records: (T | undefined)[], index: number, fromIndex: number, trace: ParticleArrayTrace[]): void {
  if (!records[fromIndex]) throw new Error("Missing native particle scratch record");
  records[index] = structuredClone(records[fromIndex]);
  trace.push({ operation: "assign", index, fromIndex });
}
/** SimulateParticles' ordinary removal pass runs AFTER all age and position
 * integration, and BEFORE survivor rotation. Each block captures its mask,
 * kills lanes 3 -> 0, then rechecks that same block. It does not reintegrate.
 * A caller may integrate whole records first only for a uniform scalar delta:
 * survivor rotation then commutes with the full-record moves below. */
export function compactExistingParticleRecords<T extends { agePercent: number }>(
  definition: FieldParticleArrayDefinition, previous: readonly T[],
): ParticleArrayResult<T> {
  validateFieldParticleArray(definition); validateRecords(previous);
  if (previous.length > definition.maximumParticles) throw new Error("Native particle array exceeds capacity");
  const records: T[] = structuredClone([...previous]), trace: ParticleArrayTrace[] = [];
  let length = records.length, block = 0;
  while (block < length) {
    const dead = [0, 1, 2, 3].map((lane) => block + lane < length && Math.fround(records[block + lane]!.agePercent) > 100);
    if (!dead.some(Boolean)) { block += 4; continue; }
    for (let lane = 3; lane >= 0; lane--) if (dead[lane]) {
      trace.push({ operation: "kill", index: block + lane, fromIndex: length - 1 });
      assign(records, block + lane, length - 1, trace); length--;
    }
  }
  records.length = length; trace.push({ operation: "resize", count: length });
  return { records, trace };
}
/** StartModules scans the ENTIRE padded newborn scratch tail in ascending
 * order, rechecking an index after replacement. Even a padding death reduces
 * acceptedCount (saturating at zero). CopyParticlesToUnalignedDst then fills
 * the old/aligned gap from the END of the remaining live scratch prefix. This
 * intentionally differs from stable filtering or concatenating live births.
 * Inputs are already motion-integrated records, including source SIMD padding.
 * The unused alignment gap is never read and needs no fabricated particle. */
export function compactNewbornParticleRecords<T extends { agePercent: number }>(
  definition: FieldParticleArrayDefinition,
  input: { existing: readonly T[]; acceptedCount: number; paddedNewborns: readonly T[] },
): ParticleArrayResult<T> & { remainingNewbornCount: number; survivingScratchCount: number } {
  validateFieldParticleArray(definition); validateRecords(input.existing); validateRecords(input.paddedNewborns); count(input.acceptedCount);
  const oldCount = input.existing.length, accepted = input.acceptedCount, start = Math.ceil(oldCount / 4) * 4;
  if (oldCount > definition.maximumParticles || accepted > definition.maximumParticles - oldCount ||
      input.paddedNewborns.length !== Math.ceil(accepted / 4) * 4) throw new Error("Incomplete or over-capacity native newborn scratch batch");
  if (accepted === 0) return { records: structuredClone([...input.existing]), trace: [], remainingNewbornCount: 0, survivingScratchCount: 0 };
  const records: (T | undefined)[] = structuredClone([...input.existing]), trace: ParticleArrayTrace[] = [];
  records.length = start;
  records.push(...structuredClone([...input.paddedNewborns]));
  let end = records.length, remaining = accepted, index = start;
  while (index < end) {
    if (Math.fround(records[index]!.agePercent) <= 100) { index++; continue; }
    trace.push({ operation: "kill", index, fromIndex: end - 1 });
    assign(records, index, end - 1, trace); end--;
    if (remaining) remaining--;
  }
  if (start !== oldCount) {
    const amount = Math.min(start - oldCount, remaining), source = start - amount + remaining;
    for (let i = 0; i < amount; i++) assign(records, oldCount + i, source + i, trace);
  }
  const finalCount = oldCount + remaining;
  trace.push({ operation: "resize", count: finalCount });
  return { records: records.slice(0, finalCount) as T[], trace, remainingNewbornCount: remaining, survivingScratchCount: end - start };
}
