import { test } from "node:test";
import assert from "node:assert/strict";
import { appearanceDefinition, appearanceRecord } from "./fixtures/field-particle-appearance.js";
import { multiplyParticleAppearanceColor32, packParticleAppearanceColor32, projectParticleAppearance, projectParticleColor32,
  projectParticleSize, sampleParticleAppearanceGradient, unpackParticleAppearanceColor32 } from "../src/core/field-particle-appearance.js";

test("appearance computes from immutable birth values on every projection", () => {
  const definition = appearanceDefinition(), record = appearanceRecord(), before = structuredClone({ definition, record });
  const first = projectParticleAppearance(definition, record);
  assert.equal(first.finalSize, 6); assert.deepEqual(first.finalColor32, [120, 90, 60, 128]);
  assert.deepEqual(projectParticleAppearance(definition, record), first); assert.deepEqual({ definition, record }, before);
});
test("single source curves do not consume or use persistent seed", () => {
  const definition = appearanceDefinition(), record = appearanceRecord();
  assert.deepEqual(projectParticleAppearance(definition, { ...record, seed: 0 }), projectParticleAppearance(definition, { ...record, seed: 0xffffffff }));
});
test("optimized comparison clamps t but the polynomial uses the actual endpoint", () => {
  const d = appearanceDefinition(); d.size.optimized = [0, 0, 2, 0, 0, 0, 0, 99, 1];
  assert.equal(projectParticleSize(d, { ...appearanceRecord(), agePercent: 100 }), 24);
});
test("optimized segment switch uses source split and local segment time", () => {
  const d = appearanceDefinition(); d.size.optimized = [0, 0, 1, 0, 0, 0, 2, .5, .5];
  assert.equal(projectParticleSize(d, { ...appearanceRecord(), agePercent: 75 }), 12);
});
test("negative size multiplier clamps before multiplying the birth size", () => {
  const d = appearanceDefinition(); d.size.optimized = [0, 0, 0, -2, 0, 0, 0, -2, 1];
  assert.equal(projectParticleSize(d, appearanceRecord()), 0);
});
test("explicit slow curve path agrees with the authored linear curve", () => {
  const d = appearanceDefinition(); d.size.optimized = null;
  assert.equal(projectParticleSize(d, { ...appearanceRecord(), agePercent: 25 }), 3);
});
test("exact gradient endpoint advances into the appended cache sample", () => {
  const d = appearanceDefinition();
  assert.deepEqual(sampleParticleAppearanceGradient(d.color, 100), [255, 255, 255, 0]);
  assert.equal(sampleParticleAppearanceGradient(d.color, 99.99999)[3], 2);
});
test("native batch Color32 uses rounded byte product rather than float RGBA storage", () => {
  assert.deepEqual(multiplyParticleAppearanceColor32([255, 1, 2, 254], [255, 128, 127, 128]), [255, 1, 1, 127]);
  assert.deepEqual(unpackParticleAppearanceColor32(packParticleAppearanceColor32([1, 2, 128, 255])), [1, 2, 128, 255]);
});
test("final color does not depend on size or a prior rendered color", () => {
  const d = appearanceDefinition(), r = appearanceRecord();
  assert.deepEqual(projectParticleColor32(d, { seed: r.seed, agePercent: r.agePercent, startColor32: r.startColor32 }), [120, 90, 60, 128]);
  const later = projectParticleAppearance(d, { ...r, agePercent: 100 });
  assert.equal(later.finalSize, 12); assert.equal(later.finalColor32[3], 0);
});
test("unknown color space and incremental appearance phases remain blocked", () => {
  const d = appearanceDefinition(); Object.assign(d.colorSpace, { active: 1 });
  assert.throws(() => projectParticleAppearance(d, appearanceRecord()), /Unbound/);
  const other = appearanceDefinition(); Object.assign(other.phase, { size: "before-motion" });
  assert.throws(() => projectParticleAppearance(other, appearanceRecord()), /Unbound/);
});
test("malformed cache, non-byte channels and unbounded ages fail before returning a projection", () => {
  const d = appearanceDefinition(); d.color.inverseSpans[1] = 0;
  assert.throws(() => projectParticleAppearance(d, appearanceRecord()), /interval/);
  assert.throws(() => projectParticleAppearance(appearanceDefinition(), { ...appearanceRecord(), startColor32: [1, 2, 3, 256] }), /integer/);
  assert.throws(() => projectParticleAppearance(appearanceDefinition(), { ...appearanceRecord(), agePercent: 101 }), /lifetime/);
  assert.throws(() => projectParticleAppearance(appearanceDefinition(), { ...appearanceRecord(), startSize: Number.NaN }), /number/);
});
