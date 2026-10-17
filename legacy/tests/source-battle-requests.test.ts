import test from "node:test";
import assert from "node:assert/strict";
import { collectSourceBattleRequests } from "../src/compiler/source-battle-requests.js";
import { compileSourceEncounterInstruction } from "../src/compiler/source-encounter.js";
import { compileSourceWalkEncounterDependencies } from "../src/compiler/world.js";
import type { BattleRow } from "../src/compiler/battle.js";
import type { CorpusAsset } from "../src/compiler/corpus.js";
import type { Op } from "../src/field/types.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";

function fixture() {
  const f = checkpointFixture(), map = structuredClone(f.target), catalog = structuredClone(f.world);
  const source = { file: "controlled-source.bundle", assetPath: "Controlled/event.json", objectId: "9223372036854775807",
    serializedFile: "controlled", sha256: "a".repeat(64) };
  const raw = (party: number, extra = 0) => ({ mnemonic: "Encount", type: 1,
    operands: { iValues: [party, extra, 0, 0, 0, 0, 0, 0], rValues: Array(8).fill(0),
      sValues: ["continuation", "", "", "", "", "", "", ""] } });
  const data = { Mnemonics: [raw(374), raw(375, 999)], ScriptLocal: [] };
  const asset: CorpusAsset = { id: "controlled-event", kind: "script", source, data };
  const site = (index: number) => ({ script: "event", index, source: { ...source, pointer: `/Mnemonics/${index}` } });
  map.scripts = { event: [{ ...site(0), kind: "encounter", party: 374, continuation: "continuation" },
    { ...site(1), kind: "blocked", mnemonic: "Encount", reason: "Unimplemented extra operands" }] };
  const master: BattleRow = { source: { ...source, assetPath: "Controlled/map.csv", rowId: String(map.mapId) },
    values: { id: String(map.mapId), monster_set_id: "154", encount_area_grid_id: "0", required_steps_min: "21" } };
  const set: BattleRow = { source: { ...source, assetPath: "Controlled/monster_set.csv", rowId: "154" }, values: { id: "154" } };
  for (let i = 1; i <= 16; i++) { set.values[`monster_set${i}`] = "0"; set.values[`monster_set${i}_rate`] = "0"; }
  Object.assign(set.values, { monster_set1: "126", monster_set1_rate: "0", monster_set2: "374", monster_set2_rate: "80" });
  const reader = { row(table: string) { return table === "map.csv" ? master : set; } };
  const compileWalking = () => map.sourceWalkEncounters = compileSourceWalkEncounterDependencies(reader, map.mapId);
  compileWalking();
  const corpus = { sourceSetHash: catalog.sourceSetHash, manifest: { parentSourceSetHash: catalog.parentSourceSetHash }, assets: [asset] };
  const collect = () => collectSourceBattleRequests({ catalog, maps: [map], corpus });
  return { catalog, map, source, asset, corpus, master, set, data, raw, site, compileWalking, collect };
}

test("whole source requests preserve zero-rate parties, typed events and blocked literal candidates independently", () => {
  const f = fixture(), before = structuredClone({ map: f.map, corpus: f.corpus }), report = f.collect();
  assert.deepEqual(report.requestedPartyIds, [126, 374, 375, 999]);
  assert.equal(report.requests.find(request => request.partyId === 374)!.sites.length, 2);
  assert.equal(report.requests.find(request => request.partyId === 126)!.sites[0]!.rawRate, "0");
  const candidate = report.requests.find(request => request.partyId === 375)!;
  assert.equal(candidate.onlyBlockedCandidates, true); assert.deepEqual(candidate.sites[0]!.rawInstruction, f.data.Mnemonics[1]);
  assert.equal(candidate.sites[0]!.source.objectId, "9223372036854775807");
  const secondary = report.requests.find(request => request.partyId === 999)!;
  assert.equal(secondary.onlyBlockedCandidates, true);
  assert.equal(secondary.sites[0]!.kind, "blocked-field-candidate");
  assert.equal(secondary.sites[0]!.slot, "1", "Native candidate slots retain secondary identities independently of admission");
  assert.ok(report.diagnostics.some(d => d.code === "source-battle-field-variant-unimplemented"));
  assert.equal(report.runtimeAdmission, "unassessed");
  candidate.sites[0]!.source.file = "changed";
  assert.deepEqual({ map: f.map, corpus: f.corpus }, before);
});

test("invalid rate or decoded walking slot cannot hide the original enemy party dependency", () => {
  const f = fixture(); delete f.set.values.monster_set1_rate; f.compileWalking();
  f.map.sourceWalkEncounters!.slots[0]!.partyId = 999;
  const report = f.collect(); assert.deepEqual(report.requestedPartyIds, [126, 374, 375, 999]);
  assert.ok(report.diagnostics.some(d => d.code === "source-walk-encounter-binding-invalid"));
});

test("typed/raw mismatch keeps the real primary candidate and blocks the forged typed identity", () => {
  const f = fixture(); f.master.values.monster_set_id = "0"; f.compileWalking();
  (f.map.scripts.event![0] as Extract<Op, { kind: "encounter" }>).party = 888;
  const report = f.collect(); assert.deepEqual(report.requestedPartyIds, [374, 375, 999]);
  const real = report.requests.find(request => request.partyId === 374)!;
  assert.equal(real.onlyBlockedCandidates, true); assert.equal(real.sites[0]!.kind, "blocked-field-primary");
  assert.deepEqual(real.sites[0]!.rawInstruction, f.data.Mnemonics[0]);
  assert.ok(report.diagnostics.some(d => d.code === "source-battle-field-source-mismatch"));
});

test("raw Encount without a compiled map alias remains an unbound candidate rather than disappearing", () => {
  const f = fixture(); f.corpus.assets.push({ ...structuredClone(f.asset), id: "unbound",
    source: { ...f.source, objectId: "90071992547409937", assetPath: "Controlled/unbound.json" },
    data: { Mnemonics: [f.raw(777)], ScriptLocal: [] } });
  const report = f.collect(); assert.ok(report.requestedPartyIds.includes(777));
  const request = report.requests.find(request => request.partyId === 777)!;
  assert.equal(request.onlyBlockedCandidates, true); assert.equal(request.sites[0]!.mapId, null);
  assert.equal(request.sites[0]!.kind, "unbound-field-primary");
  assert.ok(report.diagnostics.some(d => d.code === "source-battle-field-map-binding-unresolved"));
});

test("source area grids stay unresolved and do not synthesize a default monster set", () => {
  const f = fixture(); f.master.values.monster_set_id = "0"; f.master.values.encount_area_grid_id = "2";
  f.compileWalking(); const report = f.collect();
  assert.deepEqual(report.requestedPartyIds, [374, 375, 999]);
  assert.ok(report.diagnostics.some(d => /area-grid/.test(d.reason)));
});

test("incomplete source worlds, mismatched fingerprints and duplicate asset identities fail before publishing requests", () => {
  const f = fixture(); assert.throws(() => collectSourceBattleRequests({ catalog: f.catalog, maps: [], corpus: f.corpus }), /every indexed map/);
  f.corpus.sourceSetHash = "wrong"; assert.throws(f.collect, /world\/corpus identity/);
  f.corpus.sourceSetHash = f.catalog.sourceSetHash; f.corpus.assets.push(structuredClone(f.asset));
  assert.throws(f.collect, /Ambiguous source/);
});

test("source ordering cannot change request identity", () => {
  const f = fixture(), first = f.collect(); f.corpus.assets.reverse();
  f.map.scripts = Object.fromEntries(Object.entries(f.map.scripts).reverse());
  assert.deepEqual(f.collect(), first);
});

test("typed source commands keep every repeated original slot and command/source edits fail closed", () => {
  const f = fixture(); f.master.values.monster_set_id = "0"; f.compileWalking();
  const raw = f.raw(63, 63); raw.operands.iValues[2] = 63; raw.operands.iValues[3] = 47; raw.operands.iValues[4] = 7;
  f.data.Mnemonics.splice(0, f.data.Mnemonics.length, raw);
  const original = { ...f.site(0), ...compileSourceEncounterInstruction(raw) };
  f.map.scripts.event = [original];
  const report = f.collect(); assert.deepEqual(report.requestedPartyIds, [47, 63]);
  const repeated = report.requests.find(request => request.partyId === 63)!;
  assert.equal(repeated.onlyBlockedCandidates, false);
  assert.deepEqual(repeated.sites.map(site => site.slot), ["0", "1", "2"]);
  assert.ok(repeated.sites.every(site => site.kind === "typed-source-encounter" && site.rawInstruction !== null));
  for (const change of ["slot", "effect", "continuation", "foot"] as const) {
    const forged = structuredClone(original);
    if (change === "slot") forged.command.slots[3] = 999;
    if (change === "effect") forged.command.effectId = 8;
    if (change === "continuation") forged.command.continuation = "forged";
    if (change === "foot") Reflect.set(forged.command, "footCapture", "after-player-sync");
    f.map.scripts.event = [forged]; const rejected = f.collect();
    assert.deepEqual(rejected.requestedPartyIds, [47, 63], "Retain raw candidates rather than trusting a forged command");
    assert.ok(rejected.requests.every(request => request.onlyBlockedCandidates));
    assert.ok(rejected.diagnostics.some(d => d.code === "source-battle-field-source-mismatch"));
  }
});

test("unbound instructions retain every physical candidate including duplicate weight and effect stays separate", () => {
  const f = fixture(), raw = f.raw(83, 114); raw.operands.iValues[2] = 83; raw.operands.iValues[4] = 7;
  f.corpus.assets.push({ ...structuredClone(f.asset), id: "unbound-multiple",
    source: { ...f.source, assetPath: "Controlled/multiple.json", objectId: "90071992547409939" },
    data: { Mnemonics: [raw], ScriptLocal: [] } });
  const report = f.collect(), repeated = report.requests.find(request => request.partyId === 83)!;
  assert.deepEqual(repeated.sites.map(site => site.slot).sort(), ["0", "2"]);
  assert.equal(repeated.onlyBlockedCandidates, true);
  assert.equal(report.requests.find(request => request.partyId === 114)!.sites[0]!.kind, "unbound-field-candidate");
  assert.ok(!report.requestedPartyIds.includes(7));
  assert.ok(repeated.sites.every(site => site.source.objectId === "90071992547409939"));
});
