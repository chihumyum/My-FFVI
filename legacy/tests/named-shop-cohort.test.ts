import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { hash } from "../src/compiler/content.js";

const { collectNamedShopCohort } = await import(pathToFileURL(resolve(process.cwd(), "scripts/named-shop-cohort.mjs")).href);
const instruction = (mnemonic: string, selector = "") => ({ type: 1, mnemonic,
  operands: { iValues: Array(8).fill(0), rValues: Array(8).fill(0), sValues: [selector, ...Array(7).fill("")] } });
function fixture() {
  const asset = (id: string, name: string, ops: ReturnType<typeof instruction>[]) => ({ id, kind: "script",
    source: { file: id.startsWith("b") ? "bundle-b" : "bundle-a", assetPath: id + ".json",
      objectId: id === "a-root" ? "9007199254740993" : "9007199254740995" },
    data: { Name: name, Mnemonics: ops, Segments: [{ Label: "Main", EntryPoint: 0, Count: ops.length }] } });
  const assets = [asset("a-root", "main", [instruction("SysCall", "new A"), instruction("ChangeScript", "helper")]),
    asset("a-helper", "helper", [instruction("Nop"), instruction("Exit")]),
    asset("b-root", "main", [instruction("SysCall", "new A"), instruction("ChangeScript", "helper")]),
    asset("b-helper", "helper", [instruction("Nop"), instruction("Exit")]),
    asset("a-bad", "bad", [instruction("SysCall", "new B"), instruction("Unknown")])];
  const report = (id: string, maps: string[], blocked: string[] = []) => ({ id, maps,
    instructions: assets.find(asset => asset.id === id)!.data.Mnemonics.length, blocked });
  const corpus = { sourceSetHash: "same-source", manifest: { parentSourceSetHash: "same-parent" }, assets };
  const edge = (id: string, map: string, target: string) => ({ site: { asset: id, index: 1 }, kind: "script",
    mapId: map, reference: "helper", candidates: [target], resolved: true });
  const analysis = { sourceSetHash: "same-source", contentHash: "analysis", scripts: [report("a-root", ["1"]),
    report("a-helper", ["1"]), report("b-root", ["2"]), report("b-helper", ["2"]), report("a-bad", ["1"], ["Unknown"])],
    dependencies: [edge("a-root", "1", "a-helper"), edge("b-root", "2", "b-helper")] };
  const mapBindings = [{ id: "1", issues: [], scriptAliases: { main: "a-root", helper: "a-helper", bad: "a-bad" } },
    { id: "2", issues: [], scriptAliases: { main: "b-root", helper: "b-helper" } }];
  const nativeBindings = [{ selector: "new A", groupId: 1, phase: "new" }, { selector: "new B", groupId: 2, phase: "new" },
    { selector: "old unrelated", groupId: 3, phase: "existing" }];
  const resolveMapScript = (map: typeof mapBindings[number], name: keyof typeof map.scriptAliases) => map.scriptAliases[name] ?? null;
  return { corpus, analysis, mapBindings, nativeBindings, resolveMapScript, hash };
}

test("cohort keeps physical same-name dependencies distinct and retains the excluded whole root", () => {
  const input = fixture(), before = structuredClone({ corpus: input.corpus, analysis: input.analysis });
  const cohort = collectNamedShopCohort(input);
  assert.deepEqual(cohort.counts, { selectedRoots: 3, selectedSourceSites: 3, roots: 2, physicalPrograms: 4,
    instructions: 8, sourceMaps: 2, closedSourceSites: 2, closedSelectors: 1, resolvedEdges: 2, staticallyUnreadyExecutions: 1 });
  assert.deepEqual(cohort.programs.filter((p: { name: string }) => p.name === "helper").map((p: { id: string }) => p.id), ["a-helper", "b-helper"]);
  assert.equal(cohort.excludedPrograms[0].id, "a-bad"); assert.equal(cohort.excludedPrograms[0].raw.Mnemonics[1].mnemonic, "Unknown");
  assert.equal(cohort.programs.find((p: { id: string }) => p.id === "a-root").source.objectId, "9007199254740993");
  assert.equal(cohort.sourceStoryReachability, false);
  assert.deepEqual({ corpus: input.corpus, analysis: input.analysis }, before);
  assert.deepEqual(collectNamedShopCohort(input), cohort, "Discovery is deterministic");
});

test("a resolver mismatch cannot borrow a different map's same-name helper", () => {
  const input = fixture(); input.mapBindings[0]!.scriptAliases.helper = "b-helper";
  const cohort = collectNamedShopCohort(input), rejected = cohort.executions.find((row: { rootId: string }) => row.rootId === "a-root");
  assert.equal(rejected.status, "unready"); assert.equal(rejected.diagnostics[0].kind, "source-namespace-mismatch");
  assert.equal(cohort.programs.some((p: { id: string }) => p.id === "a-root"), false);
  assert.equal(cohort.excludedPrograms.some((p: { id: string }) => p.id === "a-root"), true);
});

test("unresolved references and unbound roots remain explicit instead of disappearing", () => {
  const input = fixture(); input.analysis.dependencies[0]!.resolved = false;
  input.analysis.scripts.find(row => row.id === "b-root")!.maps = [];
  const cohort = collectNamedShopCohort(input);
  assert.equal(cohort.counts.selectedRoots, 3); assert.equal(cohort.counts.roots, 0);
  assert.equal(cohort.excludedPrograms.find((p: { id: string }) => p.id === "b-root").maps.length, 0);
  assert.ok(cohort.executions.some((row: { diagnostics: { kind: string }[] }) => row.diagnostics.some(d => d.kind === "unbound-source-root")));
  assert.ok(cohort.executions.some((row: { diagnostics: { kind: string }[] }) => row.diagnostics.some(d => d.kind === "unresolved-reference")));
});

test("cycles terminate without dropping bodies; source or shape mismatches fail discovery", () => {
  const input = fixture(); input.analysis.dependencies.push({ site: { asset: "a-helper", index: 1 }, kind: "script",
    mapId: "1", reference: "helper", candidates: ["a-helper"], resolved: true });
  assert.equal(collectNamedShopCohort(input).counts.physicalPrograms, 4);
  input.analysis.sourceSetHash = "another-source"; assert.throws(() => collectNamedShopCohort(input), /another source set/);
  input.analysis.sourceSetHash = "same-source"; input.corpus.assets[0]!.data.Mnemonics.push(instruction("Nop"));
  assert.throws(() => collectNamedShopCohort(input), /body changed/);
});
