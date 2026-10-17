// Portable arbitrary-age Size/Color kernels versus independently executed
// original DLL buffers. This is not a complete scene or browser acceptance.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const compiled = process.argv.includes("--compiled-dir") ? process.argv[process.argv.indexOf("--compiled-dir") + 1] : "dist";
const module = (path) => import(pathToFileURL(resolve(root, compiled, "src", path + ".js")));
const k = await module("core/field-particle-appearance"), c = await module("compiler/field-particle-appearance");
const json = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));
const sha = (v) => createHash("sha256").update(v).digest("hex");
const canonical = (v) => v && typeof v === "object" ? Array.isArray(v) ? "[" + v.map(canonical).join(",") + "]" : "{" + Object.keys(v).sort().map((key) => JSON.stringify(key) + ":" + canonical(v[key])).join(",") + "}" : JSON.stringify(v);
let checks = 0; const check = (fn) => { fn(); checks++; };
const bits = (v) => { const bytes = Buffer.alloc(4); bytes.writeFloatLE(v); return bytes.readUInt32LE(); };
const same = (a, b, label) => check(() => assert.equal(bits(a), bits(b), label));
const native = await json("build/reports/field-particle-appearance-native-check.json");
check(() => assert.equal(native.status, "pass")); check(() => assert.equal(native.semanticsVerified, false));
const probeBytes = await readFile(resolve(root, native.instructionProbes)); check(() => assert.equal(sha(probeBytes), native.instructionProbeSha256));
const probes = JSON.parse(probeBytes), inspection = await json(native.inspectionPath), kernel = c.compileParticleAppearanceKernel([inspection], probes);
const mediaDir = "build/v33-field-effect-media", depDir = "build/v34-field-particle-dependencies";
for (const directory of [mediaDir, depDir]) for (const item of (await json(directory + "/snapshot.json")).files) {
  check(() => assert.ok(!item.file.includes("..") && !item.file.startsWith("/")));
  const bytes = await readFile(resolve(root, directory, item.file)); check(() => assert.equal(sha(bytes), item.sha256));
}
const corpus = await json("build/corpus/corpus.json"), media = await json(mediaDir + "/media.json"), dependencies = await json(depDir + "/dependencies.json");
check(() => assert.equal(sha(canonical(corpus.sources)), corpus.sourceSetHash));
for (const snapshot of [media, dependencies]) {
  check(() => assert.equal(snapshot.parentSourceSetHash, corpus.sourceSetHash));
  for (const source of snapshot.sources) {
    const bytes = await readFile(resolve(root, "build/runtime/game", source.file)); check(() => assert.equal(sha(bytes), source.sha256));
  }
}
const definitions = Object.fromEntries(kernel.bindings.map((b) => [b.group, c.compileFieldParticleAppearance(b.group, media.groups[b.group], dependencies, kernel)]));
for (const test of probes.sizes) for (let lane = 0; lane < 4; lane++) {
  const definition = definitions[test.group], size = { ...definition.size, optimized: test.optimized ? definition.size.optimized : null };
  same(k.sampleParticleAppearanceSize(size, { seed: test.seeds[lane], agePercent: test.agePercent[lane], startSize: test.startSize[lane] }), test.value[lane], test.group + " Size/" + test.optimized);
  same(test.repeat[lane], test.value[lane], "native Size repeat"); same(test.startAfter[lane], test.startSize[lane], "immutable native start size");
  check(() => assert.equal(test.seedsAfter[lane], test.seeds[lane]));
}
for (const test of probes.colors) for (let lane = 0; lane < 4; lane++) {
  const result = k.projectParticleColor32(definitions[test.group], { seed: test.seeds[lane], agePercent: test.agePercent[lane], startColor32: k.unpackParticleAppearanceColor32(test.startColor32[lane]) });
  check(() => assert.equal(k.packParticleAppearanceColor32(result), test.value[lane], test.group + " Color32/" + test.agePercent[lane]));
  check(() => assert.equal(test.repeat[lane], test.value[lane])); check(() => assert.equal(test.startAfter[lane], test.startColor32[lane]));
  check(() => assert.equal(test.seedsAfter[lane], test.seeds[lane]));
}
// Bindings reject changed source inputs and foreign cached products; these
// probes do not alter published media or grant any live effect capability.
const first = kernel.bindings[0].group;
const badKernel = structuredClone(kernel); badKernel.bindings[0].cache.colors[0] = (badKernel.bindings[0].cache.colors[0] ^ 1) >>> 0;
check(() => assert.throws(() => c.compileFieldParticleAppearance(first, media.groups[first], dependencies, badKernel), /cache differs/));
const badGraph = structuredClone(media.groups[first]);
const particle = badGraph.objects.find((o) => o.type === "ParticleSystem" && badGraph.hierarchyIds.includes(o.source.objectId));
particle.data.SizeModule.curve.maxCurve.m_Curve[0].value += .1;
check(() => assert.throws(() => c.compileFieldParticleAppearance(first, badGraph, dependencies, kernel), /cache differs/));
const badDeps = structuredClone(dependencies); badDeps.settings.activeColorSpace = 1;
check(() => assert.throws(() => c.compileFieldParticleAppearance(first, media.groups[first], badDeps, kernel), /Gamma/));
const phases = Object.values(definitions).map((d) => ({ source: d.source, inputSha256: d.inputSha256, cacheSha256: d.cacheSha256, phase: d.phase }));
const report = { formatVersion: 1, status: "pass", lane: "source-final-particle-appearance-versus-isolated-native-instructions", checks,
  sourceAssets: Object.keys(definitions).length, nativeInstructionSizeBatches: probes.sizes.length, nativeInstructionColorBatches: probes.colors.length,
  comparedLanes: (probes.sizes.length + probes.colors.length) * 4, nativeReportSha256: sha(await readFile(resolve(root, "build/reports/field-particle-appearance-native-check.json"))),
  semanticsVerified: false, originalGameExecuted: false, admittedFullEmitters: 0, phases,
  limitations: ["Final arbitrary-age Color32/Size providers only; no complete emitter, scene, original game or browser acceptance.",
    "Gamma only; source advanced size/color/Noise modifiers remain explicit blockers.", "Size cache is produced by original DLL cache builders from current assets and revalidated, not a prerecorded frame table."] };
await mkdir(resolve(root, "build/reports"), { recursive: true });
await writeFile(resolve(root, "build/reports/field-particle-appearance-check.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ checks, sourceAssets: report.sourceAssets, comparedLanes: report.comparedLanes, admittedFullEmitters: 0 }));
