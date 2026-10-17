// Complete source comparison. Structural coverage and source operand sessions
// are not execution of the retained original story bodies.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { runtimeDigest } from "./runtime-digest.mjs";
const argv = process.argv.slice(2), allowed = new Set(["--root", "--compiled", "--before-compiled", "--physical-input", "--nomination", "--output"]);
assert.equal(argv.length % 2, 0); const args = {};
for (let i = 0; i < argv.length; i += 2) { assert(allowed.has(argv[i]) && !Object.hasOwn(args, argv[i])); args[argv[i]] = argv[i + 1]; }
const root = resolve(args["--root"] ?? resolve(import.meta.dirname, "..")), compiled = resolve(root, args["--compiled"] ?? "dist"),
  before = resolve(root, args["--before-compiled"] ?? "dist"), output = resolve(root, args["--output"] ?? "build/reports/source-field-ui.json");
assert.notEqual(compiled, before, "A separate exact before compiler is required"); assert(output.startsWith(resolve(root, "build/reports") + "/"));
const physicalPath = resolve(root, args["--physical-input"] ?? "build/wip/source-field-syscall-capability-nomination/physical-input.json"),
  nominationPath = resolve(root, args["--nomination"] ?? "build/wip/source-field-ui-common-owner-family/nomination.json"),
  physicalBytes = await readFile(physicalPath), nominationBytes = await readFile(nominationPath), physical = JSON.parse(physicalBytes), nomination = JSON.parse(nominationBytes);
const sha = value => createHash("sha256").update(value).digest("hex"), load = (dir, name) => import(pathToFileURL(resolve(dir, name + ".js")));
assert.equal(sha(physicalBytes), nomination.physicalInputSha256); assert.equal(physical.sourceDigest, nomination.sourceDigest); assert.equal(physical.sourceSetHash, nomination.sourceSetHash);
assert.equal(physical.allProgramBindings.length, 3304); assert.equal(physical.allAssets.length, 6951);
const runtimeBefore = await runtimeDigest(root, compiled), [prior, current, { canonical }, { hash }] = await Promise.all([
  load(before, "src/compiler/field"), load(compiled, "src/compiler/field"), load(compiled, "src/core/canonical"), load(compiled, "src/compiler/content")]);
const assets = new Map(physical.allAssets.map(asset => [asset.id, asset])), domains = new Map(physical.analysis.scripts.map(row => [row.id, row.domain]));
const chosen = raw => raw.mnemonic === "ShowMapTitle" || raw.mnemonic === "SysCall" && ["UI非表示", "マップUI全て表示", "ミニマップ表示"].includes(raw.operands?.sValues?.[0]);
const selectedIds = new Set(nomination.completePrograms.map(program => program.id)), changed = [], originalBlockers = [], programBindings = [];
let allInstructions = 0, fieldInstructions = 0, inspectedFields = 0, unchangedFieldInstructions = 0, changedBodies = 0;
for (const binding of physical.allProgramBindings) {
  const asset = assets.get(binding.id); assert(asset); assert.equal(hash(asset.data), binding.rawHash); assert.deepEqual(asset.source, binding.source);
  const raw = asset.data.Mnemonics; allInstructions += raw.length; let bodyChanged = false;
  programBindings.push({ ...binding, domain: domains.get(asset.id) ?? "unassessed" });
  if (domains.get(asset.id) !== "field") continue;
  inspectedFields++;
  for (const [index, instruction] of raw.entries()) {
    fieldInstructions++;
    const site = { script: asset.id, index, source: { ...asset.source, pointer: "/Mnemonics/" + index } }, context = { nextMnemonic: raw[index + 1]?.mnemonic ?? null },
      decode = module => { try { return { op: module.decodeFieldOp(instruction, site, physical.messages, physical.tables, context) }; } catch (error) { return { error: String(error) }; } },
      old = decode(prior), next = decode(current);
    if (!chosen(instruction)) { assert.equal(canonical(next), canonical(old), "Unrelated Field IR changed: " + asset.id + ":" + index); unchangedFieldInstructions++; }
    else {
      assert(selectedIds.has(asset.id)); assert.equal(old.op?.kind, "blocked"); assert.equal(next.op?.kind, "source-field-ui", next.op?.reason);
      assert.notEqual(canonical(old), canonical(next)); bodyChanged = true;
      changed.push({ programId: asset.id, rawHash: binding.rawHash, index, source: asset.source, raw: instruction, before: old.op, after: next.op,
        maps: nomination.sourceBatch.sites.find(row => row.programId === asset.id && row.pc === index)?.maps ?? [] });
    }
    if (next.op?.kind === "blocked") originalBlockers.push({ programId: asset.id, index, reason: next.op.reason });
  }
  if (bodyChanged) changedBodies++;
}
assert.equal(allInstructions, 186003); assert.equal(inspectedFields, 2804); assert.equal(fieldInstructions, 173026);
assert.equal(changed.length, 79); assert.equal(changedBodies, 73); assert.equal(nomination.completeMapClosures.length, 51); assert.equal(nomination.completeDependentAssets.length, 1061);
assert.equal(nomination.completePrograms.reduce((n, p) => n + p.data.Mnemonics.length, 0), 7106);
assert.equal(physical.completeBattlePrograms.length, 53); assert.equal(physical.completeBattleDependencies.requestedPartyIds.length, 490);
assert.equal(sha(await readFile(physicalPath)), sha(physicalBytes)); assert.equal(sha(await readFile(nominationPath)), sha(nominationBytes));
assert.equal(await runtimeDigest(root, compiled), runtimeBefore);
const report = { kind: "whole-source-field-ui-static-difference-v1", result: "passed", runtimeSha256: runtimeBefore,
  sourceSetHash: physical.sourceSetHash, sourceDigest: physical.sourceDigest,
  physicalInput: { path: physicalPath, sha256: sha(physicalBytes), bytes: physicalBytes.length },
  completeUiSource: { path: nominationPath, sha256: sha(nominationBytes), bytes: nominationBytes.length },
  counts: { allPrograms: 3304, allInstructions, fieldPrograms: inspectedFields, fieldInstructions, unchangedFieldInstructions, changedSites: changed.length,
    changedBodies, affectedInstructions: 7106, completeMaps: 51, completePhysicalAssets: 1061, otherDomains: 500, retainedBattleBodies: 53, retainedBattleRequests: 490 },
  programBindings, changed, remainingFieldBlockers: originalBlockers,
  scope: { fieldDecoderComparison: "all-original-Field-instructions-with-same-complete-messages-tables-and-adjacent-mnemonic-context",
    nonfield: "full-original-body-provenance-and-raw-hashes-retained-not-Field-decoded", emptyMessageLookup: "not-granted-by-this-static-physical-input; identical-existing-gates-retained",
    sourceBodiesExecuted: 0, runtimeAdmission: "unassessed", nativeDynamicParity: false, worldCompilations: 0, publications: 0, campaignComplete: false } };
await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ result: report.result, ...report.counts, sourceBodiesExecuted: 0 }));
