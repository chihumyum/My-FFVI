// Read-only whole-source comparison. The physical input is an independently
// pinned loader capture, never a capability grant or a source-story oracle.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";

const options = { root: resolve(import.meta.dirname, ".."), compiled: "dist", output: "build/reports/owned-condition-remove-life-source.json" };
const names = { "--root": "root", "--compiled-dir": "compiled", "--baseline-compiled-dir": "baseline",
  "--source-input": "input", "--source-input-sha256": "inputSha256", "--output": "output" }, seen = new Set();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1];
  assert(names[key] && value && !seen.has(key), "Unknown, missing or repeated checker argument");
  seen.add(key); options[names[key]] = value;
}
assert(options.baseline && options.input && /^[a-f0-9]{64}$/.test(options.inputSha256 ?? ""),
  "Supply --baseline-compiled-dir, --source-input and --source-input-sha256");
const root = resolve(options.root), sha = bytes => createHash("sha256").update(bytes).digest("hex");
const inputFile = resolve(root, options.input), inputBytes = await readFile(inputFile);
assert.equal(sha(inputBytes), options.inputSha256, "Physical loader input changed");
const input = JSON.parse(inputBytes), programs = input.allAssets.filter(row => row.kind === "script"),
  assets = new Map(input.allAssets.map(row => [row.id, row])), domains = new Map(input.analysis.scripts.map(row => [row.id, row]));
assert.equal(assets.size, input.allAssets.length, "Duplicate physical identity");
assert.equal(programs.length, 3304); assert.equal(input.tables["condition.csv"].length, 100);
const load = (directory, module) => import(pathToFileURL(resolve(root, directory, "src", module + ".js")).href);
const [{ decodeFieldOp: before }, { decodeFieldOp: after }, { canonical, hash }] = await Promise.all([
  load(options.baseline, "compiler/field"), load(options.compiled, "compiler/field"), load(options.compiled, "compiler/content"),
]);
const changes = [], selected = new Set(), mapIds = new Set(), completePrograms = [];
let operations = 0, fieldSites = 0;
for (const program of programs) {
  const projections = [], raw = program.data.Mnemonics;
  for (const [index, instruction] of raw.entries()) {
    const context = { script: program.id, index, source: { ...program.source, pointer: "/Mnemonics/" + index } },
      next = { nextMnemonic: raw[index + 1]?.mnemonic ?? null };
    const decode = decoder => {
      try { const { source, script, index: pc, ...op } = decoder(instruction, context, input.messages, input.tables, next); return op; }
      catch (error) { return { kind: "static-field-decode-error", reason: error.message }; }
    };
    const a = decode(before), b = decode(after); operations++; projections.push(b);
    const selectedSite = domains.get(program.id).domain === "field" && instruction.mnemonic === "RemoveCondition" &&
      [4, 5].includes(instruction.operands?.iValues?.[0]);
    if (selectedSite) { fieldSites++; selected.add(program.id); for (const id of domains.get(program.id).maps) mapIds.add(id); }
    if (canonical(a) === canonical(b)) { assert(!selectedSite, "Nominated source site did not change"); continue; }
    assert(selectedSite, program.id + ":" + index); assert.equal(a.kind, "blocked"); assert.equal(b.kind, "owned-condition");
    assert.equal(b.command.target, 0);
    assert.deepEqual(b.dependencies.filter(row => row.table === "condition.csv").map(row => row.id),
      b.command.conditionType === 4 ? [4] : [5, 100]);
    changes.push({ programId: program.id, pc: index, source: program.source, raw: instruction, before: a, after: b });
  }
  if (selected.has(program.id)) completePrograms.push({ ...program, rawHash: hash(program.data), afterProjection: projections });
}
assert.equal(operations, 186003); assert.equal(fieldSites, 33); assert.equal(changes.length, 33);
assert.equal(selected.size, 33); assert.equal(mapIds.size, 16);
const completeMaps = input.analysis.maps.filter(map => mapIds.has(map.id)), dependencyIds = new Set(selected);
for (const map of completeMaps) for (const id of [map.packageId, ...Object.values(map.groups), ...map.closure]) if (id) dependencyIds.add(id);
const completeDependentAssets = [...dependencyIds].sort().map(id => { assert(assets.has(id), id); return assets.get(id); });
assert.equal(completeDependentAssets.length, 233);
const bodyInstructions = completePrograms.reduce((n, program) => n + program.data.Mnemonics.length, 0);
assert.equal(bodyInstructions, 1844); assert.equal(input.completeBattlePrograms.length, 53);
const battleInstructions = input.completeBattlePrograms.reduce((n, program) => n + program.data.Mnemonics.length, 0);
assert.equal(battleInstructions, 2312);
const report = { kind: "source-remove-life-condition-whole-source-before-after-v1", result: "only33-source-op-projections-changed",
  input: { file: inputFile, sha256: sha(inputBytes), sourceDigest: input.sourceDigest, sourceSetHash: input.sourceSetHash,
    sourcePolicy: input.sourcePolicy, media: input.media },
  compiled: resolve(root, options.compiled), baselineCompiled: resolve(root, options.baseline),
  counts: { programs: 3304, instructions: operations, changed: 33, type4: changes.filter(row => row.after.command.conditionType === 4).length,
    type5: changes.filter(row => row.after.command.conditionType === 5).length, fullBodies: 33, bodyInstructions, maps: 16,
    declaredDependencyIds: dependencyIds.size, retainedRawDependencyObjects: completeDependentAssets.length, missingDependencies: 0,
    conditionMasterRows: 100, battlePrograms: 53, battleInstructions },
  changes, completePrograms, completeMapClosures: completeMaps, completeDependentAssets,
  conditionMasterRows: input.tables["condition.csv"], completeBattlePrograms: input.completeBattlePrograms,
  completeBattleDependencies: input.completeBattleDependencies,
  scope: { wholeSourceOpComparison: true, rawBodiesUnchanged: true, sourceBodiesExecuted: 0, runtimeAdmissionsClaimed: 0,
    nativeGetListRgctxRestored: false, masterEnumerationOrderAssumed: false, active100Granted: false, producerRuns: 0, publications: 0 } };
const output = resolve(root, options.output); await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report) + "\n");
console.log(JSON.stringify({ result: report.result, counts: report.counts, output, sha256: sha(await readFile(output)) }));
