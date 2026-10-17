import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadAppearanceAudit } from "./audit-appearances.mjs";

const audit = await loadAppearanceAudit();
const tables = JSON.parse(
  await readFile(new URL("../../build/web-data/raw/tables.json", import.meta.url)),
);
const state = (player, actors = []) => ({
  mapId: 38,
  groups: ["ev_e_0038"],
  partySlots: [[1, 2]],
  partyIndex: 0,
  roster: {},
  player: { id: -1001, visible: false, ...player },
  actors,
});

test("raw PR character_id oracle catches the old p200 bug across all 47 selector rows", () => {
  audit.reset();
  const snapshot = state(
    {},
    tables["field_character_asset.csv"].map((row) => [
      String(-Number(row.character_id)),
      { id: -Number(row.character_id), visible: true, asset: row.asset_name },
    ]),
  );
  assert.equal(audit.compare(snapshot).summary.mismatches, 0);
  snapshot.actors.find(([id]) => id === "-200")[1].asset = "mo_ff6_p200";
  const before = structuredClone(snapshot),
    result = audit.compare(snapshot);
  assert.deepEqual(
    result.mismatches.map((row) => [row.entityId, row.expected, row.actual]),
    [[-200, ["mo_ff6_p016"], ["mo_ff6_p200"]]],
  );
  assert.deepEqual(snapshot, before);
});

test("Magitek requires independent rider and transportation assets in actor parts and rendered rows", () => {
  audit.reset();
  const snapshot = state({
      visible: true,
      vehicle: 6,
      asset: "mo_ff6_v006_c00",
      walkAsset: "mo_ff6_p001",
    }),
    before = structuredClone(snapshot);
  assert.equal(audit.compare(snapshot).summary.mismatches, 0);
  const wrong = [{ asset: "mo_ff6_p001" }, { asset: "mo_ff6_v005_c00" }],
    result = audit.compare(snapshot, {
      actorParts: { player: wrong },
      frameActors: wrong.map((part) => ({ side: "field", entityId: -1001, drawn: true, ...part })),
    });
  assert.deepEqual(
    result.mismatches.map((row) => row.layer),
    ["actor-parts", "render-selection"],
  );
  assert.ok(result.mismatches.every((row) => row.expected.includes("mo_ff6_v006_c00")));
  assert.deepEqual(snapshot, before);
});

test("Locke disguise is derived from raw donor NPC encounter and battle condition, not actual costume", () => {
  audit.reset();
  const snapshot = state({ visible: true, asset: "mo_ff6_p002" });
  snapshot.partySlots = [[2]];
  snapshot.roster[2] = { id: 2, conditions: [80], disguise: 1 };
  const before = structuredClone(snapshot);
  // The battle SysCall starts the clothing sequence; the later source
  // BattleCondition determines the resulting costume, not its old local value.
  audit.sourceInstruction({
    mapId: 38,
    programName: "sc_b_0067",
    pc: 27,
    locals: [0, 0, 0],
    snapshot,
  });
  const result = audit.compare(snapshot);
  assert.deepEqual(result.mismatches[0].expected, ["mo_ff6_p025"]);
  assert.ok(
    result.mismatches[0].sources.some(
      (source) =>
        source.battleScript === "sc_b_0067" &&
        source.spawn.rowId === 223 &&
        source.conditionId === 80,
    ),
  );
  snapshot.player.asset = "mo_ff6_p025";
  assert.equal(audit.compare(snapshot).summary.mismatches, 0);
  const soldier = structuredClone(snapshot);
  soldier.roster[2] = { id: 2, conditions: [79], disguise: 2 };
  soldier.player.asset = "mo_ff6_p025";
  assert.deepEqual(audit.compare(soldier).mismatches[0].expected, ["mo_ff6_p021_c01"]);
  assert.deepEqual({ ...snapshot, player: before.player }, before);
  snapshot.roster[2].conditions = [];
  snapshot.roster[2].disguise = 1;
  assert.deepEqual(audit.compare(snapshot).mismatches[0].expected, ["mo_ff6_p002"]);
});

test("raw map spawn uses mapobject row ID and rejects the same number from field_character_asset", () => {
  audit.reset();
  const wrong = tables["field_character_asset.csv"].find((row) => Number(row.id) === 29).asset_name,
    snapshot = state({}, [["84", { id: 84, kind: 6, visible: true, asset: wrong }]]),
    before = structuredClone(snapshot),
    result = audit.compare(snapshot);
  assert.deepEqual(result.mismatches[0].expected, ["mo_ff6_n014_c00"]);
  assert.equal(result.mismatches[0].sources[0].rowId, 29);
  assert.equal(result.mismatches[0].sources[0].table, "mapobject.csv");
  assert.ok(result.mismatches[0].sources[0].assetPath.endsWith("/ev_e_0038.json"));
  assert.deepEqual(snapshot, before);
});

test("F9 frame rows compare independently, while unresolved substitution never counts as a match", () => {
  audit.reset();
  const f9 = {
      schema: "ffvi-bug-report",
      map: { id: 38 },
      groups: ["ev_e_0038"],
      player: null,
      party: [{ id: 1 }],
      actors: [{ side: "field", entityId: -200, asset: "mo_ff6_p200", drawn: true }],
    },
    before = structuredClone(f9);
  assert.equal(audit.compare(f9).mismatches[0].layer, "render-selection");
  assert.deepEqual(f9, before);
  const mounted = {
    schema: "ffvi-bug-report",
    map: { id: 21 },
    groups: ["ev_e_0018"],
    player: null,
    party: [{ id: 1 }],
    actors: [{ side: "field", entityId: 300, vehicle: 3, asset: "mo_ff6_v002_c00" }],
  };
  assert.equal(audit.compare(mounted).summary.matches, 1);
  mounted.actors[0].asset = "mo_ff6_n001_c00";
  assert.deepEqual(audit.compare(mounted).mismatches[0].expected, ["mo_ff6_v002_c00"]);
  const snapshot = state({ visible: true, asset: "mo_ff6_p001" });
  snapshot.banks = { PlaySystems: { puppetBackup: [[-1001, { asset: "mo_ff6_p999" }]] } };
  assert.deepEqual(audit.compare(snapshot).summary, {
    checked: 1,
    matches: 0,
    mismatches: 0,
    unknown: 1,
  });
  assert.match(audit.compare(snapshot).unknown[0].unknown, /source SysCall/);
});

test("raw route geometry has no sprite obligation, while a missing NPC body remains a failure", () => {
  audit.reset();
  const path = audit.compareRendered(
    [{ side: "field", entityId: 284, kind: 14, drawn: false, reason: "missing-character-asset" }],
    { mapId: 21, groups: ["ev_e_0018"], partySlots: [[1]] },
  );
  assert.equal(path.nonSpriteFrames.length, 1);
  assert.equal(path.summary.mismatches, 0);
  const npc = audit.compareRendered(
    [{ side: "field", entityId: 84, kind: 14, drawn: false, reason: "missing-character-asset" }],
    state({}),
  );
  assert.equal(npc.nonSpriteFrames.length, 0);
  assert.equal(npc.summary.mismatches, 1);
});

test("observed PR SetPuppet and simple substitution preserve source operands and caller state", () => {
  audit.reset();
  const snapshot = state({ visible: true, asset: "mo_ff6_p001" });
  snapshot.partySlots = [[1, 2], [5], [6]];
  const context = { mapId: mapIdForSource(), programName: "sc_e_0966_3", pc: 71, snapshot },
    before = structuredClone(context),
    record = audit.sourceInstruction(context);
  assert.equal(record.name, "SysCall");
  assert.equal(record.s[0], "パペット入れ替え：スロット２先頭");
  assert.deepEqual(audit.compare(snapshot).mismatches[0].expected, ["mo_ff6_p005"]);
  assert.deepEqual(context, before);
  // The compound NPC binding is intentionally unresolved, rather than borrowing
  // the renderer's current asset as proof that a substitution is correct.
  audit.reset();
  audit.sourceInstruction({ mapId: 3, programName: "sc_e_0256_2", pc: 2, snapshot });
  assert.equal(audit.compare(snapshot).summary.unknown, 1);
});
function mapIdForSource() {
  return 542;
}
