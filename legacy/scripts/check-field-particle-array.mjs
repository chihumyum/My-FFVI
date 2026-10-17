import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const flag = process.argv.indexOf("--compiled-dir"), compiled = flag < 0 ? "dist" : process.argv[flag + 1];
const k = await import(pathToFileURL(resolve(root, compiled, "src/core/field-particle-array.js")));
const c = await import(pathToFileURL(resolve(root, compiled, "src/compiler/field-particle-array.js")));
const motion = await import(pathToFileURL(resolve(root, compiled, "src/core/field-particle-motion.js")));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex"), json = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));
const canonical = (v) => v && typeof v === "object" ? Array.isArray(v) ? "[" + v.map(canonical).join(",") + "]" : "{" + Object.keys(v).sort().map((key) => JSON.stringify(key) + ":" + canonical(v[key])).join(",") + "}" : JSON.stringify(v);
let checks = 0; const check = (fn) => { fn(); checks++; };
const native = await json("build/reports/field-particle-array-native-check.json"), probeBytes = await readFile(resolve(root, native.instructionProbes));
check(() => assert.equal(sha(probeBytes), native.instructionProbeSha256)); check(() => assert.equal(native.semanticsVerified, false));
const probes = JSON.parse(probeBytes), media = await json("build/v33-field-effect-media/media.json"), snapshot = await json("build/v33-field-effect-media/snapshot.json");
for (const file of snapshot.files) {
  check(() => assert.ok(!file.file.includes("..") && !file.file.startsWith("/")));
  const bytes = await readFile(resolve(root, "build/v33-field-effect-media", file.file)); check(() => assert.equal(sha(bytes), file.sha256));
}
const corpus = await json("build/corpus/corpus.json");
check(() => assert.equal(sha(canonical(corpus.sources)), corpus.sourceSetHash)); check(() => assert.equal(media.parentSourceSetHash, corpus.sourceSetHash));
for (const source of media.sources) {
  check(() => assert.deepEqual(source, corpus.sources.find((s) => s.file === source.file)));
  const bytes = await readFile(resolve(root, "build/runtime/game", source.file)); check(() => assert.equal(sha(bytes), source.sha256));
}
const engine = c.compileParticleArrayEngine([await json(native.verifiedInspection)]);
const names = ["ef_ff6_m_001", "ef_ff6_m_002", "ef_ff6_m_003", "ef_ff6_m_004", "ef_ff6_m_016"];
check(() => assert.deepEqual(Object.keys(media.groups), names));
const definitions = names.map((name) => c.compileFieldParticleArray(name, media.groups[name], engine));
for (const definition of definitions) check(() => assert.equal(definition.maximumParticles, 1000));
const d = definitions[0], traces = [];
function integrate(record, delta) {
  const result = motion.integrateParticleMotion({ seed: record.seed, agePercent: record.agePercent, inverseLifetime: record.inverseLifetime,
    position: { x: record.px, y: record.py, z: record.pz }, velocity: { x: record.vx, y: record.vy, z: record.vz },
    animatedVelocity: { x: record.ax, y: record.ay, z: record.az }, rotationZ: record.rotation, angularVelocityZ: record.angular }, delta).state;
  return { ...record, agePercent: result.agePercent, px: result.position.x, py: result.position.y, pz: result.position.z, rotation: result.rotationZ };
}
for (const [i, probe] of probes.existing.entries()) {
  const input = probe.before.map((record) => integrate(record, probe.delta)), before = structuredClone(input), result = k.compactExistingParticleRecords(d, input);
  check(() => assert.deepEqual(input, before));
  check(() => assert.deepEqual(result.records, probe.records, "existing records " + i));
  check(() => assert.deepEqual(result.trace, probe.trace, "existing trace " + i));
  check(() => assert.equal(result.records.length, probe.endIndex)); traces.push(result);
}
for (const [i, probe] of [...probes.newborn, ...probes.copies].entries()) {
  const input = { existing: probe.before.slice(0, probe.oldCount), acceptedCount: probe.acceptedCount, paddedNewborns: probe.before.slice(probe.startIndex) };
  const before = structuredClone(input), result = k.compactNewbornParticleRecords(d, input);
  check(() => assert.deepEqual(input, before)); check(() => assert.deepEqual(result.records, probe.records, "newborn records " + i));
  check(() => assert.equal(result.remainingNewbornCount, probe.remaining));
  // StartParticles bypasses birth/Copy entirely when accepted=0. The direct
  // Copy leaf's zero-count resize is observed separately, not added to the host.
  if (probe.acceptedCount) check(() => assert.deepEqual(result.trace, [...probe.deathTrace, ...probe.copyTrace], "newborn trace " + i));
  else { check(() => assert.deepEqual(result.trace, [])); check(() => assert.deepEqual(probe.copyTrace, [{ operation: "resize", count: probe.oldCount }])); }
  traces.push(result);
}
const assets = definitions.map((definition, i) => {
  const bad = structuredClone(media.groups[names[i]]), p = bad.objects.find((o) => o.type === "ParticleSystem" && o.source.objectId === definition.source.objectId).data;
  p.SubModule.enabled = true; check(() => assert.throws(() => c.compileFieldParticleArray(names[i], bad, engine), /module|provider/));
  return { name: names[i], source: definition.source, maximumParticles: definition.maximumParticles, arrayProviderAdmitted: true };
});
const report = { lane: "source-bound-particle-array-kernel-with-isolated-instruction-comparison", semanticsVerified: false, checks,
  nativeChecks: native.checks, engine, sourceSetHash: corpus.sourceSetHash, nativeInstructionReport: "build/reports/field-particle-array-native-check.json",
  existingCases: probes.existing.length, newbornCases: probes.newborn.length, scratchCopyCases: probes.copies.length,
  instructionComparison: "Exact complete records and ordered kill/assign/resize traces; existing nonzero-delta integration compared without tolerance",
  traceSha256: sha(canonical(traces)), assets, admittedFullEmitters: 0,
  limitations: ["Ring, collision, trigger, trail and subemitter branches remain blocked", "Newborn post-module records are controlled inputs in the array probe",
    "Uniform source existing-particle delta only; no per-lane existing delta admission", "Complete host/render lifecycle and original-game dynamic comparison are separate acceptance lanes"] };
await mkdir(resolve(root, "build/reports"), { recursive: true });
await writeFile(resolve(root, "build/reports/field-particle-array-check.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ checks, actualAssets: assets.length, existingCases: probes.existing.length, newbornCases: probes.newborn.length,
  scratchCopyCases: probes.copies.length, admittedFullEmitters: 0, semanticsVerified: false }));
