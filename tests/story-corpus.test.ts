import test from "node:test";
import assert from "node:assert/strict";
import { compileStoryCorpus, type StoryCorpusSnapshot } from "../src/compiler/story-corpus.js";
import { analyzeCorpus, type CorpusAsset } from "../src/compiler/corpus.js";
import { hash } from "../src/compiler/content.js";

const sha = "a".repeat(64);
const op = (mnemonic: string, iValues: number[] = [], sValues: string[] = []) => ({
  mnemonic, type: 1,
  operands: { iValues: [...iValues, ...Array(8 - iValues.length).fill(0)],
    rValues: Array(8).fill(0), sValues: [...sValues, ...Array(8 - sValues.length).fill("")] },
});
function asset(path: string, kind: CorpusAsset["kind"], data: unknown,
  bundle = "fixture.bundle"): CorpusAsset {
  return { id: bundle + "::" + path, kind, data, source: {
    file: bundle, assetPath: path, objectId: "-9127841932506724402",
    serializedFile: "synthetic", sha256: sha,
  } };
}
const script = (name: string, ops: unknown[], bundle = "fixture.bundle") =>
  asset(`Assets/Fixture/Room/${name}.json`, "script", {
    Mnemonics: ops, ScriptLocal: ["local-a"], ScriptLocalValue: [42],
    Segments: [{ Name: "root", Start: 0, End: ops.length }],
    Animations: [], SystemFlag: { KeepBadStatusVisual: 0 },
    Title: { text: "Synthetic story", sourceId: "9127841932506724402" },
    ExtraSourceProperty: { untouched: [false, null, "source-only"] },
  }, bundle);
function fixture(): StoryCorpusSnapshot {
  return { assets: [
    asset("Assets/Fixture/package.json", "map-package", {
      asset_group_name: "fixture", map: [{ name: "Room", script: [
        { asset: "Room/start", name: "start" }, { asset: "Room/after", name: "after" },
      ] }],
    }),
    script("start", [op("Encount", [3], ["after"])]),
    script("after", [op("Exit")]),
  ], tables: { "map.csv": [{ id: "1", asset_name: "fixture", map_name: "Room", area_id: "1" }] },
  messages: {}, sourceSetHash: sha };
}

test("the entire script body, each same-address mnemonic and large source identities survive", () => {
  const snapshot = fixture(), output = compileStoryCorpus(snapshot);
  assert.equal(output.kind, "story-corpus-v1");
  assert.equal(output.rawPreserved, true);
  assert.equal(output.counts.scripts, 2);
  assert.equal(output.counts.instructions, 2);
  assert.equal(output.counts.rawPreservedInstructions, 2);
  assert.equal(output.counts.operandDecodedInstructions + output.counts.operandBlockedInstructions +
    output.counts.operandUnassessedInstructions, output.counts.instructions);
  for (const raw of snapshot.assets.filter(a => a.kind === "script")) {
    const script = output.scripts.find(s => s.id === raw.id)!;
    assert.deepEqual(script.raw, raw.data);
    assert.equal(script.rawHash, hash(raw.data));
    assert.equal(script.source.objectId, "-9127841932506724402");
    assert.deepEqual(script.locals.decoded, { labels: ["local-a"], values: [42] });
    assert.equal(script.instructions[0]!.site.source.pointer, "/Mnemonics/0");
    assert.equal(script.instructions[0]!.site.source.sha256, sha);
  }
  assert.deepEqual(output.scripts[0]!.raw, snapshot.assets[2]!.data);
  const raw = output.scripts[0]!.raw as { ExtraSourceProperty: { untouched: unknown[] } };
  raw.ExtraSourceProperty.untouched.push("output-only");
  assert.notDeepEqual(output.scripts[0]!.raw, snapshot.assets[2]!.data);
  assert.equal(hash(snapshot.assets[2]!.data), output.scripts[0]!.rawHash);
});

test("unknown or rejected middle instructions are executable stops and never shift later jump addresses", () => {
  const snapshot = fixture();
  snapshot.assets[1] = script("start", [op("Nop"), op("Mystery"), op("Jump", [3]), op("Exit")]);
  const out = compileStoryCorpus(snapshot), instructions = out.scripts.find(s => s.id === snapshot.assets[1]!.id)!.instructions;
  assert.deepEqual(instructions.map(instruction => instruction.site.index), [0, 1, 2, 3]);
  assert.equal(instructions[1]!.operandDecoded, "blocked");
  assert.equal(instructions[1]!.decoded!.kind, "blocked");
  const jump = instructions[2]!.decoded;
  assert.equal(jump!.kind, "jump");
  assert.equal((jump as { target: number }).target, 3);
  assert.equal(instructions[3]!.decoded!.kind, "exit");
  assert.equal(out.counts.instructions, 5);
  assert.equal(out.counts.rawPreservedInstructions, 5);
  snapshot.assets[1] = script("start", [op("Nop"), { mnemonic: "Nop", type: 1 }, op("Jump", [3]), op("Exit")]);
  const rejected = compileStoryCorpus(snapshot).scripts.find(s => s.id === snapshot.assets[1]!.id)!.instructions;
  assert.equal(rejected[1]!.diagnostic!.code, "FIELD_OPERAND_REJECTED");
  assert.equal(rejected[1]!.decoded!.index, 1);
  assert.equal(rejected[3]!.site.index, 3);
});

test("gap grouping separates SysCall selectors and exact reasons while retaining every use", () => {
  const snapshot = fixture();
  snapshot.assets[1] = script("start", [op("SysCall", [], ["UnknownCamera"]),
    op("SysCall", [], ["UnknownCamera"]), op("SysCall", [], ["UnknownParty"]),
    { mnemonic: "SysCall", type: 1 }, op("Mystery"), op("Mystery")]);
  const output = compileStoryCorpus(snapshot);
  const camera = output.capabilityGaps.find(g => g.family === "SysCall:UnknownCamera")!;
  assert.equal(camera.sites.length, 2);
  assert.deepEqual(camera.sites.map(site => site.index), [0, 1]);
  assert.ok(output.capabilityGaps.some(g => g.family === "SysCall:UnknownParty"));
  assert.ok(output.capabilityGaps.some(g => g.family === "SysCall:<unresolved-selector>" &&
    g.code === "FIELD_OPERAND_REJECTED"));
  assert.equal(output.capabilityGaps.find(g => g.family === "Mystery")!.sites.length, 2);
  assert.equal(output.capabilityGaps.reduce((count, gap) => count + gap.sites.length, 0),
    output.counts.operandBlockedInstructions);
});

test("resolved and unresolved dependencies are retained without certification or inferred story edges", () => {
  const snapshot = fixture();
  snapshot.assets[1] = script("start", [op("Encount", [3], ["after"]),
    op("Encount", [3], ["missing"]), op("SetEntities", [], ["missing-group"]), op("Call", [999])]);
  const analysis = analyzeCorpus(snapshot.assets, snapshot.tables, snapshot.messages, sha);
  const output = compileStoryCorpus(snapshot);
  assert.deepEqual(output.analysis.dependencies, analysis.dependencies);
  assert.deepEqual(output.analysis.maps, analysis.maps);
  assert.equal(output.counts.resolvedDependencies, 1);
  assert.equal(output.counts.unresolvedDependencies, 3);
  assert.equal(output.runtimeAdmission, "unassessed");
  assert.equal(output.storyReachability, "unassessed");
  assert.ok(output.scripts.every(script => script.runtimeAdmission === "unassessed" &&
    script.storyReachability === "unassessed" && script.instructions.every(op => op.runtimeAdmission === "unassessed")));
});

test("unbound battle and same-named scripts are preserved and never fed to the field adapter", () => {
  const snapshot = fixture();
  const battle = script("battle", [op("UnimplementedBattleInstruction"), op("Exit")], "battle.bundle");
  const unbound = script("after", [op("Nop")], "other.bundle");
  snapshot.assets.push(battle, unbound);
  const output = compileStoryCorpus(snapshot);
  assert.equal(output.counts.scripts, 4);
  assert.equal(output.counts.fieldScripts, 2);
  assert.equal(output.counts.unassessedScripts, 2);
  assert.equal(output.counts.operandUnassessedInstructions, 3);
  for (const id of [battle.id, unbound.id]) {
    const retained = output.scripts.find(s => s.id === id)!;
    assert.equal(retained.domain, "not-assessed-by-field-runtime");
    assert.equal(retained.locals.operandDecoded, "unassessed");
    assert.ok(retained.instructions.every(op => op.operandDecoded === "unassessed" &&
      op.decoded === null && op.diagnostic === null));
  }
  assert.ok(!output.capabilityGaps.some(g => g.family === "UnimplementedBattleInstruction"));
});

test("identical corpora compile deterministically across asset order and reject duplicate identity", () => {
  const snapshot = fixture();
  snapshot.assets[1] = script("start", [op("Mystery"), op("Exit")]);
  const before = structuredClone(snapshot), first = compileStoryCorpus(snapshot);
  assert.equal(first.contentHash, compileStoryCorpus({ ...snapshot, assets: [...snapshot.assets].reverse() }).contentHash);
  assert.deepEqual(snapshot, before);
  assert.throws(() => compileStoryCorpus({ ...snapshot, assets: [...snapshot.assets, snapshot.assets[1]!] }),
    /Duplicate corpus identity/);
  assert.throws(() => compileStoryCorpus({ ...snapshot, assets: [...snapshot.assets,
    { ...snapshot.assets[1]!, source: { ...snapshot.assets[1]!.source, objectId: 9127841932506724402 as unknown as string } }] }),
    /Invalid input/);
});

test("malformed local banks block only metadata decoding and retain the complete raw banks", () => {
  const snapshot = fixture();
  snapshot.assets[1] = { ...snapshot.assets[1]!, data: {
    Mnemonics: [op("Exit")], ScriptLocal: ["value"], ScriptLocalValue: ["unknown"], Segments: [],
  } };
  const output = compileStoryCorpus(snapshot), retained = output.scripts.find(s => s.id === snapshot.assets[1]!.id)!;
  assert.deepEqual(retained.raw, snapshot.assets[1]!.data);
  assert.equal(retained.locals.operandDecoded, "blocked");
  assert.equal(retained.instructions[0]!.operandDecoded, "decoded");
  const gap = output.capabilityGaps.find(g => g.code === "FIELD_LOCALS_REJECTED")!;
  assert.equal(gap.sites[0]!.source.pointer, "/ScriptLocal");
  assert.equal(output.storyReachability, "unassessed");
});
