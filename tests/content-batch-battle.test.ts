import test from "node:test";
import assert from "node:assert/strict";
import { analyzeBatchEncounters } from "../src/compiler/content-batch-battle.js";
import { compileBattleEncounterSources, type BattleEncounterJson } from "../src/compiler/battle-encounters.js";
import { compileBattleEncounterRuntime } from "../src/compiler/battle-encounter-runtime.js";
import { encounterRuntimeFixture } from "./fixtures/battle-encounter-runtime.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";
import { aiSource } from "./fixtures/battle-ai.js";
import type { BattleCatalog } from "../src/core/battle-content.js";
import { playerSessionFixture } from "./fixtures/battle-player-game.js";

test("batch planning blocks a declared player source with a statically absent battle template", () => {
  const f = playerSessionFixture([{ kind: "add-player", sourceId: 33 }]);
  f.battle.common.players = f.battle.common.players.filter(player => player.sourceId !== 33);
  const report = analyzeBatchEncounters(f.battle, [1000]);
  assert.equal(report.encounters[0]!.status, "blocked");
  assert.ok(report.encounters[0]!.blockers.some(blocker => blocker.code === "owned-player-template-missing"));
});

test("available player templates still require an explicit live borrow rather than static ready status", () => {
  const f = playerSessionFixture([{ kind: "add-player", sourceId: 33 }]);
  const report = analyzeBatchEncounters(f.battle, [1000]);
  assert.ok(report.encounters[0]!.runtimeDependencies.some(dependency => dependency.code === "owned-player-borrow-state"));
  assert.equal(report.encounters[0]!.blockers.some(blocker => blocker.code === "owned-player-template-missing"), false);
  delete f.battle.encounters[1000]!.playerParticipants;
  assert.ok(analyzeBatchEncounters(f.battle, [1000]).encounters[0]!.blockers
    .some(blocker => blocker.code === "owned-player-borrow-reference"));
});

/** Reuse the actual source-selection/runtime compilation chain with authored
 * source-shaped records; no hand-authored ready/capability certificate. */
function fixture() {
  const f = encounterRuntimeFixture();
  f.tables["monster_party.csv"] = f.input.encounters.map(encounter => ({
    id: String(encounter.partyId), battle_background_asset_id: "1", battle_bgm_asset_id: "0",
    appearance_production: "0", not_escape: "0", get_ap: "0", get_value: "0", script_name: "0",
    battle_flag_group_id: "0",
    ...Object.fromEntries(encounter.patterns.map((value, i) => [`battle_pattern${i + 1}`, String(value)])),
    ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => {
      const slot = i + 1, enemy = encounter.enemies.find(e => e.slot === slot);
      return [[`monster${slot}`, String(enemy?.monsterId ?? 0)], [`monster${slot}_group`, "1"],
        [`monster${slot}_x_position`, "0"], [`monster${slot}_y_position`, "0"]];
    }).flat()),
  }));
  for (const monster of f.tables["monster.csv"]!) Object.assign(monster, { monster_asset_id: "1", script_id: "1" });
  f.tables["monster_asset.csv"] = [{ id: "1", group_name: "fixture", asset_name: "enemy" }];
  f.tables["monster_ai_script.csv"] = [{ id: "1", script_name: "fixture_ai" }];
  f.tables["battle_background_asset.csv"] = [{ id: "1", asset_name: "fixture_background" }];
  f.tables["ability.csv"] = Object.keys(f.input.abilities).map(id => ({ id }));
  const assets: Record<string, BattleEncounterJson> = { fixture_ai: structuredClone(f.input.encounters[0]!.enemies[0]!.ai) };
  const compile = (requested = [9201, 9202]): BattleCatalog => {
    const reader = f.reader();
    const selected = compileBattleEncounterSources(reader, { partyIds: requested,
      json: name => { const asset = assets[name]; if (!asset) throw new Error("Missing synthetic AI"); return asset; },
      spritePath: suffix => {
        if (suffix === "/fixture_enemy.png") return "synthetic-enemy";
        if (suffix === "/fixture_background.png") return "synthetic-background";
        throw new Error("Missing synthetic sprite");
      } });
    const built = compileBattleEncounterRuntime(reader, { ...f.input, requestedPartyIds: selected.requestedPartyIds,
      encounters: selected.encounters, sourceDiagnostics: selected.diagnostics });
    const catalog = checkpointFixture().battle;
    return { ...catalog, common: { ...catalog.common, abilities: structuredClone(f.input.abilities),
      sprites: structuredClone(f.input.sprites), drops: built.drops },
    encounters: built.encounters, encounterReport: built.report, encounterDiagnostics: built.diagnostics };
  };
  return { f, assets, compile };
}

test("compiled dependency readiness preserves source limitations and never claims runtime admission", () => {
  const catalog = fixture().compile(), before = structuredClone(catalog);
  catalog.common.limitations.push("Controlled integration profile");
  const result = analyzeBatchEncounters(catalog, [9202, 9201, 9201]);
  assert.deepEqual(result.encounterIds, [9201, 9202]);
  assert.deepEqual(result.encounters.map(e => [e.id, e.status, e.abilityIds]),
    [[9201, "ready", [13]], [9202, "ready", [13]]]);
  assert.equal(result.runtimeAdmission, "unassessed");
  assert.deepEqual(result.diagnostics, []);
  for (const entry of result.encounters) {
    assert.ok(entry.limitations.includes("Controlled integration profile"));
    assert.ok(entry.sourceDiagnostics.some(d => d.kind === "development-omission" && d.code === "escape"));
    assert.ok(entry.limitations.some(detail => detail.startsWith("escape:")));
  }
  catalog.common.limitations.pop();
  assert.deepEqual(catalog, before);
  result.encounters[0]!.sourceDiagnostics[0]!.reason = "changed returned evidence";
  assert.deepEqual(catalog, before, "Returned diagnostics must not alias the catalog");
});

test("a missing selected source party retains compiler provenance and does not poison other parties", () => {
  const catalog = fixture().compile([9201, 9999]);
  const result = analyzeBatchEncounters(catalog, [9999, 9201]);
  assert.equal(result.encounters[0]!.status, "ready");
  const missing = result.encounters[1]!;
  assert.equal(missing.status, "blocked");
  assert.ok(missing.blockers.some(d => d.code === "missing-encounter"));
  assert.ok(missing.sourceDiagnostics.some(d => d.code === "table-reference" &&
    d.dependency?.table === "monster_party.csv" && d.dependency.id === 9999));
});

test("missing or mismatched ability references are hard failures even when an old report says compiled", () => {
  for (const mutate of [
    (catalog: BattleCatalog) => { delete catalog.common.abilities[13]; },
    (catalog: BattleCatalog) => { catalog.common.abilities[13]!.id = 14; },
    (catalog: BattleCatalog) => { catalog.common.abilities[13]!.program.abilityId = 14; },
    (catalog: BattleCatalog) => { catalog.encounters[9201]!.enemies[0]!.abilities = []; },
  ]) {
    const catalog = fixture().compile(); mutate(catalog);
    const result = analyzeBatchEncounters(catalog, [9201]).encounters[0]!;
    assert.equal(result.status, "blocked");
    assert.ok(result.blockers.some(d => d.abilityId === 13));
  }
});

test("an unimplemented ability on a conditional AI branch remains visible without a new ability whitelist", () => {
  const f = fixture();
  f.assets.fixture_ai!.data = aiSource([["Nop"], ["SyncAI"], ["IsLevelCheck", [1, 7, 6]],
    ["StartTable", [0]], ["Act", [13]], ["EndTable"], ["StartTable", [0]], ["Act", [12]],
    ["EndTable"], ["JumpBattleAI", [0]]]);
  const catalog = f.compile(), entry = analyzeBatchEncounters(catalog, [9201]).encounters[0]!;
  assert.equal(entry.status, "conditional");
  assert.deepEqual(entry.blockers, []);
  assert.deepEqual(entry.abilityIds, [12, 13]);
  assert.ok(entry.runtimeDependencies.some(d => d.code === "ability-plan" && d.abilityId === 12));
  assert.ok(entry.sourceDiagnostics.some(d => d.kind === "runtime-dependency" && d.pc === 7 && d.dependency?.id === 12));
  assert.equal(catalog.common.abilities[12]!.plan, null);
});

test("automatic targeting restrictions come from the shared runtime compiler and are not silently dropped", () => {
  const f = fixture(); f.f.input.abilities[13]!.program.range = 1;
  const result = analyzeBatchEncounters(f.compile(), [9201]);
  assert.equal(result.encounters[0]!.status, "conditional");
  assert.ok(result.diagnostics.some(d => d.code === "automatic-target" && d.abilityId === 13));
});

test("unknown AI instructions and absent compilation evidence remain conditional", () => {
  const f = fixture();
  f.assets.fixture_ai!.data = aiSource([["Nop"], ["SyncAI"], ["FutureInstruction"], ["JumpBattleAI", [0]]]);
  const catalog = f.compile();
  let result = analyzeBatchEncounters(catalog, [9201]);
  assert.equal(result.encounters[0]!.status, "conditional");
  assert.ok(result.diagnostics.some(d => d.code === "ai-instruction"));
  const plain = fixture().compile(); delete plain.encounterReport; delete plain.encounterDiagnostics;
  result = analyzeBatchEncounters(plain, [9201]);
  assert.equal(result.encounters[0]!.status, "conditional");
  assert.ok(result.diagnostics.some(d => d.code === "compiler-evidence-missing"));
});

test("invalid media, reward, condition and enemy identities are blockers rather than conditional success", () => {
  const cases: [string, (catalog: BattleCatalog) => void][] = [
    ["media-reference", catalog => { delete catalog.common.sprites["synthetic-enemy"]; }],
    ["reward-reference", catalog => { catalog.common.drops!.monsters = []; }],
    ["ai-condition", catalog => { catalog.encounters[9201]!.enemies[0]!.ai!.instructions[0]!.op =
      { kind: "condition", conditionId: 9999, target: 0 }; }],
    ["condition-reference", catalog => { catalog.common.abilities[10]!.program.forbiddenConditionIds = [9999]; }],
    ["encounter-identity", catalog => { catalog.encounters[9201]!.encounterId = 9202; }],
    ["enemy-identity", catalog => { catalog.encounters[9201]!.enemies.push(structuredClone(catalog.encounters[9201]!.enemies[0]!)); }],
    ["ai-reference", catalog => { catalog.encounters[9201]!.enemies[0]!.ai = null; }],
  ];
  for (const [code, mutate] of cases) {
    const catalog = fixture().compile(); mutate(catalog);
    const entry = analyzeBatchEncounters(catalog, [9201]).encounters[0]!;
    assert.equal(entry.status, "blocked", code);
    assert.ok(entry.blockers.some(d => d.code === code), code);
  }
});

test("reachable drops must resolve through the same inventory owner before a batch can be dependency ready", () => {
  const catalog = fixture().compile(), drops = catalog.common.drops!;
  drops.monsters[0]!.rate = 100;
  drops.monsters[0]!.slots[0] = { contentId: 9999, count: 1 };
  drops.contents.push({ id: 9999, kind: "item" });
  const result = analyzeBatchEncounters(catalog, [9201, 9202]);
  assert.equal(result.encounters[0]!.status, "blocked");
  assert.ok(result.encounters[0]!.blockers.some(d => d.code === "reward-ownership-reference"));
  assert.equal(result.encounters[1]!.status, "ready", "An unrelated monster does not grant the missing content");
  drops.monsters[0]!.rate = 0;
  assert.equal(analyzeBatchEncounters(catalog, [9201]).encounters[0]!.status, "ready",
    "An unreachable slot is not a reward grant");
});

test("only requested encounters are analyzed, with deterministic order and no input mutation", () => {
  const catalog = fixture().compile();
  catalog.encounterDiagnostics!.push({ partyId: 9999, kind: "blocked", code: "unrelated", reason: "Unselected party", source: null });
  const before = structuredClone(catalog), ids = [9202, 9201, 9202];
  const first = analyzeBatchEncounters(catalog, ids);
  catalog.encounters = Object.fromEntries(Object.entries(catalog.encounters).reverse());
  catalog.encounterDiagnostics!.reverse(); catalog.encounterReport!.entries.reverse();
  assert.deepEqual(analyzeBatchEncounters(catalog, [9201, 9202]), first);
  assert.deepEqual(ids, [9202, 9201, 9202]);
  assert.deepEqual(analyzeBatchEncounters(before, []), { encounterIds: [], diagnostics: [], encounters: [], runtimeAdmission: "unassessed" });
  assert.throws(() => analyzeBatchEncounters(before, [0]), /identity/);
  assert.throws(() => analyzeBatchEncounters(before, [Number.NaN]), /identity/);
  assert.ok(!first.diagnostics.some(d => d.encounterId === 9999));
});
