import type { FieldParticleAppearanceDefinition, ParticleAppearanceRecord } from "../../src/core/field-particle-appearance.js";
/** Authored cache/curve. No original asset data is reproduced here. */
export const appearanceDefinition = (): FieldParticleAppearanceDefinition => ({
  kind: "unity-field-particle-appearance-v1", engine: "unity-2019.4.20f1",
  source: { file: "synthetic", assetPath: "controlled/appearance" }, inputSha256: "1".repeat(64), cacheSha256: "2".repeat(64),
  size: { curve: { mode: "curve", multiplier: 1, keys: [{ time: 0, value: 0, inSlope: 1, outSlope: 1 }, { time: 1, value: 1, inSlope: 1, outSlope: 1 }] },
    optimized: [0, 0, 1, 0, 0, 0, 1, 0, 1] },
  color: { times: [0, 1, 1], colors: [0xffffffff, 0x00ffffff, 0x00ffffff], inverseSpans: [0, 1, 1e6] },
  colorSpace: { active: 0, applyActiveColorSpace: true, source: { file: "synthetic", serializedFile: "synthetic", objectId: "1", sha256: "3".repeat(64) } },
  phase: { size: "after-incremental-slices", color: "nonincremental-render-preparation" },
});
export const appearanceRecord = (): ParticleAppearanceRecord => ({ seed: 42, agePercent: 50, startSize: 12, startColor32: [120, 90, 60, 255] });
