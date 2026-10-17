import test from "node:test";
import assert from "node:assert/strict";
import { compileFieldNpcRoutes } from "../src/compiler/field-npc-route.js";
import { parseFieldNpcRouteCatalog, parseFieldNpcRouteRawInstruction } from "../src/core/field-npc-route.js";
import type { CorpusAsset } from "../src/compiler/corpus.js";

/** Synthetic source package, not a scene, story flag or runtime fixture. */
function fixture() {
  const source = { file: "synthetic.bundle", assetPath: "Synthetic/Map/package.json",
    objectId: "9223372036854775807", serializedFile: "synthetic-cab", sha256: "a".repeat(64) };
  const instructions = Array.from({ length: 10 }, (_, i) => ({ instruction_type: i + 1,
    speed_id: 0, animation_key: "", cellx: -1, celly: 9, layer: 1, speed_scale: 1,
    loop_cnt: 0, delay_sec: 0.125, frame: 0, duration: 0, jump_height: 0,
    se_id: 0, seek_time: 0, position: 0, category: 0, index: 0, value: 0 }));
  const alias = { name: "route_instruction_701", asset: "Room/route_instruction_701" };
  const map = { name: "Room", route_instruction: [alias], script: [{ name: "routine", asset: "Room/routine" }] };
  const pkg: CorpusAsset = { id: "package", kind: "map-package", source,
    data: { asset_group_name: "synthetic-map", map: [map] } };
  const route: CorpusAsset = { id: "route", kind: "data", source: { ...source,
    assetPath: "Synthetic/Map/Room/route_instruction_701.json", objectId: "9007199254740993" }, data: { instruction_list: instructions } };
  const operands = { iValues: [81, 701, 1, 0, 0, 0, 0, 0], rValues: Array(8).fill(0), sValues: Array(8).fill("") };
  const script: CorpusAsset = { id: "script", kind: "script", source: { ...source,
    assetPath: "Synthetic/Map/Room/routine.json", objectId: "-9223372036854775808" },
    data: { Mnemonics: [{ mnemonic: "AssignMoveRoute", type: 1, operands }] } };
  const corpus = { assets: [pkg, route, script], tables: { "map.csv": [
    { id: "11", map_name: "Room", asset_name: "synthetic-map" },
  ] }, sourceSetHash: "b".repeat(64), manifest: { parentSourceSetHash: "c".repeat(64) } };
  return { corpus, pkg, route, script, alias, map, instructions, operands,
    compile: () => compileFieldNpcRoutes(corpus, 11) };
}
test("all ten instruction families retain exact raw fields and independent capability requirements", () => {
  const f = fixture(), original = structuredClone(f.corpus), result = f.compile(), c = result.catalog!;
  assert.deepEqual(result.report.parse, { declared: 1, parsed: 1, invalid: 0 });
  assert.deepEqual(result.report.binding, { resolved: 1, blocked: 0 });
  assert.deepEqual(c.routes[701]!.instructions.map(i => i.kind), ["move-to", "delay", "play-animation", "cue-animation", "show", "hide", "move-lerp", "play-se", "set-variable", "compare-variable"]);
  assert.deepEqual(c.routes[701]!.instructions.map(i => i.raw), f.instructions);
  assert.ok(result.report.capability.requirements.some(r => r.capability === "sound-presentation" && r.index === 7));
  assert.ok(result.report.capability.requirements.some(r => r.capability === "event-state" && r.index === 9));
  assert.equal(c.executionSupport, "none"); assert.equal(c.migrationReady, false);
  assert.equal(result.report.assignments[0]!.loop, true);
  c.routes[701]!.instructions[0]!.raw.cellx = 888;
  assert.deepEqual(f.corpus, original); // Both raw source and returned IR are detached.
});
test("unrecognized opcode remains a parsed unresolved instruction and never inherits execution", () => {
  const f = fixture(); f.instructions[0]!.instruction_type = 999;
  const result = f.compile();
  assert.equal(result.catalog!.routes[701]!.instructions[0]!.kind, "unresolved");
  assert.equal(result.catalog!.routes[701]!.instructions[0]!.raw.instruction_type, 999);
  assert.deepEqual(result.report.capability.unknownInstructionTypes, [999]);
  assert.equal(result.report.parse.parsed, 1);
  assert.ok(result.diagnostics.some(d => d.kind === "capability" && d.code === "route-instruction-type"));
});
test("missing optional fields are preserved, while invalid scalar/extra field structures are explicit", () => {
  const raw = { instruction_type: 2, delay_sec: 0.25 };
  assert.deepEqual(parseFieldNpcRouteRawInstruction(raw), raw);
  assert.equal("duration" in parseFieldNpcRouteRawInstruction(raw), false);
  assert.throws(() => parseFieldNpcRouteRawInstruction({ ...raw, delay_sec: Infinity }), /single/);
  assert.throws(() => parseFieldNpcRouteRawInstruction({ ...raw, loop_cnt: 1.5 }), /integer/);
  assert.throws(() => parseFieldNpcRouteRawInstruction({ ...raw, guessed_duration: 1 }), /fields/);
  const f = fixture(); (f.route.data as { instruction_list: unknown[] }).instruction_list = [{ instruction_type: 1, cellx: "9" }];
  const result = f.compile(); assert.deepEqual(result.report.parse, { declared: 1, parsed: 0, invalid: 1 });
  assert.deepEqual(result.report.binding, { resolved: 1, blocked: 1 }); // Assignment cannot consume the invalid route.
  assert.equal(result.diagnostics.find(d => d.code === "route-structure")!.kind, "parse");
});
test("same basename in another bundle is never a package-local fallback", () => {
  const f = fixture(); f.route.source.file = "another.bundle";
  const result = f.compile(); assert.deepEqual(result.catalog!.routes, {});
  assert.equal(result.report.binding.resolved, 0); assert.ok(result.report.binding.blocked > 0);
  assert.ok(result.diagnostics.some(d => d.reason.includes("Missing or ambiguous package-local")));
});
test("duplicate asset and alias identities do not select a first/last route", () => {
  const f = fixture(); f.corpus.assets.push({ ...structuredClone(f.route), id: "duplicate-asset" });
  assert.deepEqual(f.compile().catalog!.routes, {});
  const g = fixture(); g.map.route_instruction.push(structuredClone(g.alias));
  const result = g.compile(); assert.deepEqual(result.catalog!.routes, {});
  assert.ok(result.diagnostics.some(d => /Duplicate NPC route alias/.test(d.reason)));
  assert.equal(result.report.assignments[0]!.binding, "unresolved");
});
test("source fingerprints and relative package paths remain hard reference boundaries", () => {
  const f = fixture(); f.route.source.sha256 = "d".repeat(64);
  assert.ok(f.compile().diagnostics.some(d => /fingerprint mismatch/.test(d.reason)));
  const g = fixture(); g.alias.asset = "../Room/route_instruction_701";
  assert.ok(g.compile().diagnostics.some(d => /Unsafe package-local/.test(d.reason)));
  const h = fixture(); h.route.source.serializedFile = "other-cab-in-same-verified-bundle";
  assert.equal(h.compile().report.parse.parsed, 1); // CAB identities are independent and retained, not aliases.
});
test("decimal source identity and each instruction source pointer survive parser round trips", () => {
  const c = fixture().compile().catalog!, parsed = parseFieldNpcRouteCatalog(c);
  assert.equal(parsed.packageSource.objectId, "9223372036854775807");
  assert.equal(parsed.routes[701]!.source.objectId, "9007199254740993");
  assert.equal(parsed.routes[701]!.instructions[9]!.source.pointer, "/instruction_list/9");
  assert.deepEqual(parsed, c); assert.notEqual(parsed.routes[701]!.instructions, c.routes[701]!.instructions);
  parsed.routes[701]!.instructions[0]!.source.objectId = "wrong";
  assert.throws(() => parseFieldNpcRouteCatalog(parsed), /decimal object|binding mismatch/);
});
test("forged package/instruction identity, readiness or native opcode labels are rejected", () => {
  const original = fixture().compile().catalog!;
  const foreign = structuredClone(original); foreign.routes[701]!.aliasSource.file = "foreign.bundle";
  assert.throws(() => parseFieldNpcRouteCatalog(foreign), /package\/source/);
  const wrong = structuredClone(original); wrong.routes[701]!.instructions[0]!.kind = "delay";
  assert.throws(() => parseFieldNpcRouteCatalog(wrong), /instruction\/source/);
  assert.throws(() => parseFieldNpcRouteCatalog({ ...original, migrationReady: true }), /execution contract/);
  assert.throws(() => parseFieldNpcRouteCatalog({ ...original, executionSupport: "available" }), /execution contract/);
});
test("AssignMoveRoute binds only observed loop flags without dropping raw unsupported operands", () => {
  for (const flag of [-1, 2]) {
    const f = fixture(); f.operands.iValues[2] = flag;
    const r = f.compile(), a = r.report.assignments[0]!;
    assert.equal(a.binding, "unresolved"); assert.equal(a.loop, null);
    assert.deepEqual(a.rawOperands, f.operands); assert.notEqual(a.rawOperands, f.operands);
    assert.ok(r.diagnostics.some(d => d.code === "assign-route-binding"));
  }
  const f = fixture(); f.operands.iValues[2] = 0;
  assert.equal(f.compile().report.assignments[0]!.loop, false);
});
test("empty source lists and missing map packages are structural facts, not runnable routes", () => {
  const f = fixture(); f.instructions.length = 0;
  const empty = f.compile(); assert.equal(empty.report.parse.parsed, 1);
  assert.equal(empty.catalog!.routes[701]!.instructions.length, 0);
  assert.ok(empty.diagnostics.some(d => d.code === "route-execution-unavailable"));
  f.corpus.assets.splice(0, 1);
  assert.equal(f.compile().catalog, null);
  assert.throws(() => compileFieldNpcRoutes(f.corpus, 0), /map identity/);
  assert.throws(() => compileFieldNpcRoutes(f.corpus, 99), /map row/);
});
