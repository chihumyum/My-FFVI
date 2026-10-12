// Source graph and portable float32 kernels versus independent original DLL
// instruction observations. This is not a full prefab or game execution test.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const compiled = process.argv.includes("--compiled-dir") ? process.argv[process.argv.indexOf("--compiled-dir") + 1] : "dist";
const module = (file) => import(pathToFileURL(resolve(root, compiled, "src", file + ".js")));
const k = await module("core/field-particle-motion"), c = await module("compiler/field-particle-motion");
const json = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const canonical = (v) => v && typeof v === "object" ? Array.isArray(v) ? "[" + v.map(canonical).join(",") + "]" : "{" + Object.keys(v).sort().map((key) => JSON.stringify(key) + ":" + canonical(v[key])).join(",") + "}" : JSON.stringify(v);
let checks = 0; const check = (fn) => { fn(); checks++; };
const bits = (v) => { const b = Buffer.alloc(4); b.writeFloatLE(v); return b.readUInt32LE(); };
const same = (actual, expected, label) => check(() => assert.equal(bits(actual), bits(expected), label));
const vector = (v) => ({ x: v[0], y: v[1], z: v[2] });
const native = await json("build/reports/field-particle-motion-native-check.json");
check(() => assert.equal(native.status, "pass")); check(() => assert.equal(native.semanticsVerified, false));
const probeBytes = await readFile(resolve(root, native.instructionProbes)); check(() => assert.equal(sha(probeBytes), native.instructionProbeSha256));
const probes = JSON.parse(probeBytes), inspection = await json(native.inspectionPath);
const kernel = c.compileParticleMotionKernel([inspection], probes);
const physicsDir = "build/v36-field-particle-motion", mediaDir = "build/v33-field-effect-media";
for (const directory of [physicsDir, mediaDir]) for (const item of (await json(directory + "/snapshot.json")).files) {
  check(() => assert.ok(!item.file.includes("..") && !item.file.startsWith("/")));
  const bytes = await readFile(resolve(root, directory, item.file)); check(() => assert.equal(sha(bytes), item.sha256));
}
const physics = await json(physicsDir + "/physics.json"), gravity = c.compileParticleGravity(physics);
const corpus = await json("build/corpus/corpus.json"), media = await json(mediaDir + "/media.json");
check(() => assert.equal(sha(canonical(corpus.sources)), corpus.sourceSetHash));
check(() => assert.equal(media.parentSourceSetHash, corpus.sourceSetHash)); check(() => assert.equal(physics.parentSourceSetHash, corpus.sourceSetHash));
for (const source of [...media.sources, ...physics.sources]) {
  if (media.sources.includes(source)) check(() => assert.deepEqual(source, corpus.sources.find((s) => s.file === source.file)));
  const bytes = await readFile(resolve(root, "build/runtime/game", source.file)); check(() => assert.equal(sha(bytes), source.sha256));
}
check(() => assert.equal(sha(canonical(physics.sources)), physics.sourceSetHash));
const definitions = Object.fromEntries(Object.entries(media.groups).map(([group, graph]) => [group, c.compileFieldParticleMotion(group, graph, kernel)]));
for (const test of probes.perlin) {
  const v = k.sampleParticlePerlinDerivative(kernel, vector(test.position), test.frequency);
  for (let lane = 0; lane < 4; lane++) { same(v.x, test.value[lane], "Perlin dx"); same(v.y, test.value[lane + 4], "Perlin dy"); }
}
for (const test of probes.noise) for (let lane = 0; lane < 4; lane++) {
  const v = k.sampleParticleNoise(kernel, { ...definitions.ef_ff6_m_001.noise, damping: test.damping }, { position: vector(test.positions[lane]), systemSeed: test.systemSeed, scroll: test.scroll });
  for (const [i, key] of ["x", "y", "z"].entries()) same(v[key], test.value[i][lane], "Noise " + key);
}
for (const test of probes.rotation) for (let lane = 0; lane < 4; lane++) same(k.sampleParticleAngularVelocity({ min: Math.fround(1.0471975803375244), max: Math.fround(-1.0471975803375244),
  bySpeed: test.bySpeed, randomizeDirection: test.randomizeDirection, seed: test.seeds[lane], prior: test.before[lane] }), test.value[lane], "Rotation");
for (const test of probes.curves) same(k.evaluateParticleMotionKeys(test.keys, test.time), test.value, "Curve " + test.group + " " + test.axis);
for (const test of probes.curveBindings) {
  check(() => assert.ok(test.keys > 3)); check(() => assert.equal(test.optimized, false));
}
for (const test of probes.velocity) for (let lane = 0; lane < 4; lane++) {
  const v = k.sampleParticleAnimatedVelocity(definitions[test.group].velocity, test.seeds[lane], test.agePercent[lane]);
  for (const [i, key] of ["x", "y", "z"].entries()) same(v[key], test.value[i][lane], "Velocity " + key);
}
const stateFrom = (before, lane) => ({ seed: 42, agePercent: before["0x3c0"][lane], inverseLifetime: before["0x3e0"][lane],
  position: { x: before["0x0"][lane], y: before["0x20"][lane], z: before["0x40"][lane] },
  velocity: { x: before["0x60"][lane], y: before["0x80"][lane], z: before["0xa0"][lane] },
  animatedVelocity: { x: before["0xc0"][lane], y: before["0xe0"][lane], z: before["0x100"][lane] }, rotationZ: before["0x220"][lane], angularVelocityZ: before["0x280"][lane] });
for (const test of probes.integration) {
  check(() => assert.equal(test.count, 4));
  for (let lane = 0; lane < 4; lane++) {
    const { state: v, expired } = k.integrateParticleMotion(stateFrom(test.before, lane), test.delta);
    check(() => assert.equal(expired, false));
    for (const [key, off] of [["x", "0x0"], ["y", "0x20"], ["z", "0x40"]]) same(v.position[key], test.after[off][lane], "Integration " + key);
    same(v.agePercent, test.after["0x3c0"][lane], "Age"); same(v.rotationZ, test.after["0x220"][lane], "Angular integration");
  }
}
for (const test of probes.gravity) for (let lane = 0; lane < 4; lane++) {
  const d = { ...definitions.ef_ff6_m_003, gravityMultiplier: test.multiplier }, before = test.before;
  const v = k.prepareParticleMotionRates(d, { seed: 42, agePercent: 0, inverseLifetime: 1, position: { x: 0, y: 0, z: 0 },
    velocity: { x: before["0x60"][lane], y: before["0x80"][lane], z: before["0xa0"][lane] },
    animatedVelocity: { x: before["0xc0"][lane], y: before["0xe0"][lane], z: before["0x100"][lane] }, rotationZ: 0, angularVelocityZ: before["0x280"][lane] },
    { deltaSeconds: test.deltas[lane], systemSeed: 42, noiseScroll: 0, space: { gravity: vector(test.gravity), worldToLocal: test.worldToLocal } });
  for (const [key, off] of [["x", "0x60"], ["y", "0x80"], ["z", "0xa0"]]) same(v.velocity[key], test.after[off][lane], "Gravity " + key);
  for (const off of ["0xc0", "0xe0", "0x100", "0x280"]) same(test.after[off][lane], 0, "Initial clears previous rate");
}
const assets = [];
for (const [group, d] of Object.entries(definitions)) {
  // Explicit controlled simulation-space transform and seed; neither is a
  // claim that the live field host has provided source-bound dynamic inputs.
  const space = { gravity: gravity.gravity, worldToLocal: [1, 0, 0, 0, 1, 0, 0, 0, 1] };
  let state = { seed: 42, agePercent: 0, inverseLifetime: .5, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 1, z: 0 }, animatedVelocity: { x: 0, y: 0, z: 0 }, rotationZ: 0, angularVelocityZ: 0 };
  let scroll = 0; const trace = [];
  for (let i = 0; i < 4; i++) {
    scroll = k.advanceParticleNoiseScroll(scroll, d.noise.scrollSpeed, .02, true, 1);
    const rates = k.prepareParticleMotionRates(d, state, { deltaSeconds: .02, systemSeed: 42, noiseScroll: scroll, space });
    const next = k.integrateParticleMotion(rates, .02); check(() => assert.equal(next.expired, false)); state = next.state; trace.push({ scroll, state });
  }
  check(() => assert.equal(state.agePercent, 4)); check(() => assert.notDeepEqual(state.position, { x: 0, y: 0, z: 0 }));
  assets.push({ group, source: d.source, gravityMultiplier: d.gravityMultiplier, velocity: d.velocity !== null, rotationBySpeed: d.rotation.bySpeed,
    steps: trace.length, traceSha256: sha(canonical(trace)) });
}
const report = { formatVersion: 1, status: "pass", lane: "source-particle-motion-kernels-with-independent-instruction-probes", checks,
  sourceSetHash: corpus.sourceSetHash, gravitySource: gravity.source, nativeChecks: native.checks, instructionProbeSha256: native.instructionProbeSha256,
  instructionCases: Object.fromEntries(["perlin", "noise", "rotation", "curves", "curveBindings", "velocity", "integration", "gravity"].map((name) => [name, probes[name].length])),
  assets, semanticsVerified: false, originalGameExecuted: false, admittedFullEmitters: 0,
  limitations: ["These source graphs qualify the motion stage, not complete particle instances.",
    "Color/Size PostSimulation, birth/capacity/deletion, automatic seed acquisition and renderer projection remain separate providers.",
    "Moving-emitter newborn compensation requires its actual source host input; the stationary helper rejects nonzero emitter motion.",
    "Native lookup tables stay extracted source data and are not copied into tracked redistributable fixtures."] };
await writeFile(resolve(root, "build/reports/field-particle-motion-check.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ checks, instructionCases: report.instructionCases, actualAssets: assets.length, admittedFullEmitters: 0 }));
