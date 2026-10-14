import test from "node:test";
import assert from "node:assert/strict";
import { collectSourceBattleRequests } from "../src/compiler/source-battle-requests.js";
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
  assert.deepEqual(report.requestedPartyIds, [126, 374, 375]);
  assert.equal(report.requests.find(request => request.partyId === 374)!.sites.length, 2);
  assert.equal(report.requests.find(request => request.partyId === 126)!.sites[0]!.rawRate, "0");
  const candidate = report.requests.find(request => request.partyId === 375)!;
  assert.equal(candidate.onlyBlockedCandidates, true); assert.deepEqual(candidate.sites[0]!.rawInstruction, f.data.Mnemonics[1]);
  assert.equal(candidate.sites[0]!.source.objectId, "9223372036854775807");
  assert.equal(report.requestedPartyIds.includes(999), false, "Unknown extra operands are not guessed to be party identities");
  assert.ok(report.diagnostics.some(d => d.code === "source-battle-field-variant-unimplemented"));
  assert.equal(report.runtimeAdmission, "unassessed");
  candidate.sites[0]!.source.file = "changed";
  assert.deepEqual({ map: f.map, corpus: f.corpus }, before);
});

test("invalid rate or decoded walking slot cannot hide the original enemy party dependency", () => {
  const f = fixture(); delete f.set.values.monster_set1_rate; f.compileWalking();
  f.map.sourceWalkEncounters!.slots[0]!.partyId = 999;
  const report = f.collect(); assert.deepEqual(report.requestedPartyIds, [126, 374, 375]);
  assert.ok(report.diagnostics.some(d => d.code === "source-walk-encounter-binding-invalid"));
});

test("typed/raw mismatch keeps the real primary candidate and blocks the forged typed identity", () => {
  const f = fixture(); f.master.values.monster_set_id = "0"; f.compileWalking();
  (f.map.scripts.event![0] as Extract<Op, { kind: "encounter" }>).party = 888;
  const report = f.collect(); assert.deepEqual(report.requestedPartyIds, [374, 375]);
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
  assert.deepEqual(report.requestedPartyIds, [374, 375]);
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
