import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
const { sourcePuppetRouteCohort } = await import(pathToFileURL(resolve(import.meta.dirname, "../../scripts/source-puppet-route-cohort.mjs")).href);
const source = { file: "authored-corpus", assetPath: "Scripts/source-route", objectId: "9223372036854775807" };
const instruction = (mnemonic: string, index = 0, decoded = true) => ({ raw: { type: 2, mnemonic, operands: {} }, site: { script: "source-physical-alias", index, source, maps: [10, 11] }, operandDecoded: decoded ? "decoded" : "blocked", diagnostic: decoded ? null : { code: "unknown-source-operand" } });
function fixture() {
  const program = (id: string, instructions: unknown[], domain = "field") => ({ id, instructions, domain, source, rawHash: id, locals: { operandDecoded: "decoded" }, maps: [] });
  const root = program("root", [instruction("Route", 99), instruction("Route", 100)]);
  const edge = { kind: "script", resolved: true, mapId: 10, reference: "after", candidates: ["a", "b"], site: { asset: "root", script: "source-physical-alias", index: 101, source } };
  return { sourceSetHash: "source", contentHash: "full-corpus", counts: { instructions: 5 }, scripts: [root, program("a", [instruction("Exit")]), program("b", [instruction("Unknown", 5, false)]), program("battle-route", [instruction("Route")], "battle")], analysis: { maps: [
    { id: 10, residentScripts: {}, scriptAliases: { local: "root", after: "a" } },
    { id: 11, residentScripts: {}, scriptAliases: { local: "root", after: "b" } }], dependencies: [edge, { ...edge, mapId: 11 }] } };
}
test("whole Route cohort uses the exact map namespace and retains duplicate source PCs, nonfield sites and unknown successors", () => {
  const raw = fixture(), before = structuredClone(raw), result = sourcePuppetRouteCohort(raw);
  assert.deepEqual(result.roots[0].closure.ids, ["a", "root"]); assert.deepEqual(result.roots[1].closure.ids, ["b", "root"]);
  assert.equal(result.roots[0].closure.operandClosed, true); assert.equal(result.roots[1].closure.operandClosed, false);
  assert.equal(result.allSites.length, 3); assert.equal(result.counts.fieldSites, 2); assert.equal(result.counts.rootBindings, 2);
  assert.equal(result.allSites[0].site.index, 99); assert.equal(result.allSites[1].site.index, 100);
  assert.equal(result.allSites[0].site.source.objectId, source.objectId); assert.equal(result.sourceStoryReachability, false);
  assert.deepEqual(raw, before); assert.deepEqual(sourcePuppetRouteCohort(raw), result);
});
test("a globally resolved script cannot authorize an absent exact namespace target", () => {
  const raw = fixture(); delete (raw.analysis.maps[0]!.scriptAliases as Record<string, string>).after;
  const result = sourcePuppetRouteCohort(raw); assert.equal(result.roots[0].closure.operandClosed, false);
  assert.equal(result.roots[0].closure.unresolved.length, 1); assert.equal(result.roots[0].closure.unresolved[0].site.index, 101);
  assert.equal(result.roots[0].runtimeAdmission, "unassessed"); assert.equal(result.roots[0].sourceStoryReachability, false);
});
