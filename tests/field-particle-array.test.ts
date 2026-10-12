import test from "node:test";
import assert from "node:assert/strict";
import { compactExistingParticleRecords, compactNewbornParticleRecords } from "../src/core/field-particle-array.js";
import { compileFieldParticleArray, compileParticleArrayEngine } from "../src/compiler/field-particle-array.js";
import { integrateParticleMotion } from "../src/core/field-particle-motion.js";
import { reserveParticleBirthBatch } from "../src/core/field-particle-lifecycle.js";
import { arrayRecord, controlledArrayEvidence, particleArrayDefinition, particleArrayExport } from "./fixtures/field-particle-array.js";
const dead = Math.fround(100.00000762939453);
const ids = (records: { id: number }[]) => records.map((r) => r.id);

test("existing SIMD mask kills high lanes first and rechecks the same block", () => {
  const before = Array.from({ length: 9 }, (_, i) => arrayRecord(i, [0, 1, 3, 7, 8].includes(i) ? dead : 25));
  const result = compactExistingParticleRecords(particleArrayDefinition(), before);
  assert.deepEqual(ids(result.records), [6, 4, 2, 5]);
  assert.deepEqual(result.trace.filter((t) => t.operation === "kill"), [
    { operation: "kill", index: 3, fromIndex: 8 }, { operation: "kill", index: 1, fromIndex: 7 }, { operation: "kill", index: 0, fromIndex: 6 },
    { operation: "kill", index: 3, fromIndex: 5 }, { operation: "kill", index: 1, fromIndex: 4 },
  ]);
});
test("strict >100 death threshold and partial SIMD lanes preserve full record identity", () => {
  const before = [arrayRecord(0, dead), arrayRecord(1, 100), arrayRecord(2, 99)];
  const result = compactExistingParticleRecords(particleArrayDefinition(), before);
  assert.deepEqual(result.records, [before[2], before[1]]);
  result.records[0]!.retained.label = "changed";
  assert.equal(before[2]!.retained.label, "record-2"); assert.equal(before[0]!.agePercent, dead);
});
test("all-dead, empty and full source capacity have exact logical counts", () => {
  const d = particleArrayDefinition();
  assert.deepEqual(compactExistingParticleRecords(d, []).trace, [{ operation: "resize", count: 0 }]);
  assert.equal(compactExistingParticleRecords(d, Array.from({ length: 1000 }, (_, i) => arrayRecord(i, dead))).records.length, 0);
  assert.equal(compactExistingParticleRecords(d, Array.from({ length: 1000 }, (_, i) => arrayRecord(i, 100))).records.length, 1000);
  assert.throws(() => compactExistingParticleRecords(d, Array.from({ length: 1001 }, (_, i) => arrayRecord(i))), /capacity/);
});
test("uniform integration happens once per original record before the removal pass", () => {
  const records = Array.from({ length: 5 }, (_, i) => ({ ...arrayRecord(i, i === 0 ? 100 : 25), inverseLifetime: 1,
    animatedVelocity: { x: 0, y: 0, z: 0 }, rotationZ: i, angularVelocityZ: 2 }));
  const integrated = records.map((r) => ({ ...r, ...integrateParticleMotion(r, .02).state }));
  const result = compactExistingParticleRecords(particleArrayDefinition(), integrated);
  assert.deepEqual(ids(result.records), [4, 1, 2, 3]);
  assert.equal(result.records[0]!.agePercent, 27); assert.equal(result.records[0]!.position.x, Math.fround(4.01));
  assert.equal(result.records[0]!.rotationZ, Math.fround(4.04));
});
test("newborn scan is scalar ascending and may promote a padding record", () => {
  const births = [arrayRecord(0, dead), arrayRecord(1), arrayRecord(2), arrayRecord(3)];
  const result = compactNewbornParticleRecords(particleArrayDefinition(), { existing: [], acceptedCount: 3, paddedNewborns: births });
  assert.deepEqual(ids(result.records), [3, 1]); assert.equal(result.remainingNewbornCount, 2); assert.equal(result.survivingScratchCount, 3);
  assert.deepEqual(result.trace[0], { operation: "kill", index: 0, fromIndex: 3 });
});
test("a padding death reduces accepted count even when all accepted lanes survive", () => {
  const result = compactNewbornParticleRecords(particleArrayDefinition(), { existing: [], acceptedCount: 1,
    paddedNewborns: [arrayRecord(0), arrayRecord(1, dead), arrayRecord(2), arrayRecord(3)] });
  assert.deepEqual(result.records, []); assert.equal(result.remainingNewbornCount, 0);
});
test("newborn removal repeats the same index and saturates accepted count at zero", () => {
  const result = compactNewbornParticleRecords(particleArrayDefinition(), { existing: [arrayRecord(99)], acceptedCount: 1,
    paddedNewborns: Array.from({ length: 4 }, (_, i) => arrayRecord(i, dead)) });
  assert.deepEqual(ids(result.records), [99]); assert.equal(result.survivingScratchCount, 0);
  assert.deepEqual(result.trace.flatMap((t) => t.operation === "kill" ? [t.index] : []), [4, 4, 4, 4]);
});
test("scratch compaction fills the alignment gap from the live tail, not a stable shift", () => {
  const result = compactNewbornParticleRecords(particleArrayDefinition(), { existing: [arrayRecord(99)], acceptedCount: 5,
    paddedNewborns: Array.from({ length: 8 }, (_, i) => arrayRecord(i)) });
  assert.deepEqual(ids(result.records), [99, 2, 3, 4, 0, 1]);
  assert.deepEqual(result.trace.slice(0, 3), [
    { operation: "assign", index: 1, fromIndex: 6 }, { operation: "assign", index: 2, fromIndex: 7 }, { operation: "assign", index: 3, fromIndex: 8 },
  ]);
});
test("capacity admission and array compaction compose at 999/1000 without granting padding", () => {
  const existing = Array.from({ length: 999 }, (_, i) => arrayRecord(i)), allocation = reserveParticleBirthBatch({ activeCount: 999, maximumParticles: 1000, requested: 4 });
  assert.equal(allocation.startIndex, 1000); assert.equal(allocation.accepted, 1);
  const result = compactNewbornParticleRecords(particleArrayDefinition(), { existing, acceptedCount: allocation.accepted,
    paddedNewborns: Array.from({ length: 4 }, (_, i) => arrayRecord(2000 + i)) });
  assert.equal(result.records.length, 1000); assert.equal(result.records[999]!.id, 2000);
  const full = compactNewbornParticleRecords(particleArrayDefinition(), { existing: result.records, acceptedCount: 0, paddedNewborns: [] });
  assert.deepEqual(full.records, result.records); assert.deepEqual(full.trace, []);
});
test("incomplete scratch, unknown branches and malformed ages fail without mutation", () => {
  const d = particleArrayDefinition(), existing = [arrayRecord(0)], before = structuredClone(existing);
  assert.throws(() => compactNewbornParticleRecords(d, { existing, acceptedCount: 1, paddedNewborns: [arrayRecord(1)] }), /scratch/);
  assert.throws(() => compactNewbornParticleRecords(d, { existing, acceptedCount: 1000, paddedNewborns: [] }), /capacity/);
  for (const age of [NaN, Infinity, -1, 101]) assert.throws(() => compactExistingParticleRecords(d, [arrayRecord(0, age)]), /age/);
  assert.throws(() => compactExistingParticleRecords({ ...d, collision: true } as never, existing), /branch/);
  assert.deepEqual(existing, before);
});
test("compiler requires exact engine bodies and explicit absent destructive modules", () => {
  const evidence = controlledArrayEvidence(), engine = compileParticleArrayEngine([evidence]);
  evidence.methods.pop(); assert.throws(() => compileParticleArrayEngine([evidence]), /body/);
  for (const key of ["CollisionModule", "SubModule", "TrailModule", "TriggerModule", "ClampVelocityModule"]) {
    const raw = particleArrayExport(), p = raw.objects.find((o) => o.type === "ParticleSystem")!.data;
    delete p[key]; assert.throws(() => compileFieldParticleArray("controlled_effect", raw, engine));
  }
  const raw = particleArrayExport(); raw.objects.find((o) => o.type === "ParticleSystem")!.data.ringBufferMode = 1;
  assert.throws(() => compileFieldParticleArray("controlled_effect", raw, engine), /mode/);
});
