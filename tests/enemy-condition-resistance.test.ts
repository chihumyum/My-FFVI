import test from "node:test";
import assert from "node:assert/strict";
import { compileConditionResistances } from "../src/compiler/condition-resistances.js";
import { compileBattleEncounterRuntime } from "../src/compiler/battle-encounter-runtime.js";
import { BattleConditions } from "../src/core/battle-conditions.js";
import { BattleGame } from "../src/core/battle.js";
import { encounterContent } from "../src/core/battle-content.js";
import { GameSession } from "../src/core/game-session.js";
import { GameFlow } from "../src/core/game-flow.js";
import { GameBattleHandoff } from "../src/core/game-battle-handoff.js";
import { compileTargetRule } from "../src/compiler/battle-targets.js";
import { encounterRuntimeFixture } from "./fixtures/battle-encounter-runtime.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";

function fixture() {
  const f = encounterRuntimeFixture();
  f.battle.conditions.rules.definitions.push(
    { id: 301, type: 6, overlapped: false, eraseGroupId: 3 },
    { id: 601, type: 608, overlapped: false, eraseGroupId: 3 },
  );
  f.battle.conditions.behaviors.push({ id: 301, kind: "silence", name: "Controlled silence", untilType: 2 });
  f.tables["condition.csv"] = f.battle.conditions.rules.definitions.map(row => ({
    id: String(row.id), condition_type: String(row.type), overlapped_type: row.overlapped ? "1" : "0",
    erase_condition_group_id: String(row.eraseGroupId),
  }));
  f.tables["condition_group.csv"] = [
    { id: "5001", group_id: "501", condition_id: "301", type_id: "0", invocation_rate: "87" },
    { id: "5002", group_id: "502", condition_id: "301", type_id: "1", invocation_rate: "0" },
    { id: "5003", group_id: "502", condition_id: "601", type_id: "1", invocation_rate: "0" },
  ];
  f.tables["monster.csv"]![0]!.resistance_condition = "501";
  f.tables["monster.csv"]![1]!.resistance_condition = "502";
  return f;
}
function catalog(f: ReturnType<typeof fixture>) {
  const result = compileBattleEncounterRuntime(f.reader(), f.input), baseline = checkpointFixture();
  return { result, content: { ...baseline.battle, common: { ...f.battle,
    fieldSourceSetHash: baseline.field.sourceSetHash, drops: result.drops }, encounters: result.encounters } };
}
function battleFixture(fixed = false) {
  const f = fixture(), enemy = f.input.encounters[0]!.enemies[0]!;
  f.input.encounters[0]!.enemies.push({ ...structuredClone(enemy), monsterId: 9102, slot: 9 });
  const definition = structuredClone(f.battle.abilities[10]!);
  definition.id = 15; definition.name = "Controlled status action"; definition.cost = 2; definition.power = 0;
  definition.program.abilityId = 15; definition.program.range = 4;
  definition.program.rules.system_id = 5;
  definition.program.functions = [{ slot: 1, functionId: 9, type: 9, series: 0, values: [301, fixed ? 1 : 0, 0] }];
  definition.plan = { effects: [{ slot: 1, kind: "add-condition", conditionId: 301, fixedHit: fixed, accuracy: 255 }],
    targeting: compileTargetRule(4, 5)!, physical: null, magic: null };
  f.battle.abilities[15] = definition; f.battle.commands[100]!.abilityIds.push(15);
  for (const player of f.battle.players) player.abilities.push(15);
  const { content, result } = catalog(f);
  assert.equal(result.report.blocked, 0);
  return { ...f, catalog: content, content: encounterContent(content, 9201, 19)! };
}

test("condition resistance groups preserve decimal row identities and selectors rather than invocation rates", () => {
  const f = fixture(), reader = f.reader(), before = JSON.stringify(f.tables);
  const zero = compileConditionResistances(reader, 501, f.battle.conditions.rules.definitions);
  assert.deepEqual(zero.resistances, { 301: 0 });
  assert.deepEqual(zero.sources.map(row => row.source.rowId), ["5001", "301"]);
  zero.sources[0]!.values.type_id = "1";
  assert.equal(JSON.stringify(f.tables), before, "Compiler evidence is detached from the source reader");
  const one = compileConditionResistances(reader, 502, f.battle.conditions.rules.definitions);
  assert.deepEqual(one.resistances, { 301: 1, 601: 1 });
  const conditions = new BattleConditions(f.battle.conditions);
  assert.doesNotThrow(() => conditions.validateResistances(one.resistances));
  assert.throws(() => conditions.validateActive([601]), /Unimplemented active/,
    "An innate resistance reference cannot admit its condition as an active behavior");
});

test("zero group preserves absent tables and exact legacy enemy content", () => {
  const unexpected = () => { throw new Error("A zero group cannot request source rows"); };
  assert.deepEqual(compileConditionResistances({ row: unexpected, group: unexpected }, 0),
    { resistances: {}, sources: [], shadowedRowIds: [] });
  const f = encounterRuntimeFixture(), result = compileBattleEncounterRuntime(f.reader(), f.input);
  assert.deepEqual(result.encounters[9201]!.enemies[0]!.conditionResistances, {});
  assert.equal(result.report.blocked, 0);
});

test("initial state activates a known source group while the same template cannot grant an unproved late-entry phase", () => {
  const f = fixture();
  f.tables["monster.csv"]![0]!.initial_condition = "501";
  const initial = compileBattleEncounterRuntime(f.reader(), f.input);
  assert.deepEqual(initial.encounters[9201]!.enemies[0]!.conditionIds, [301]);
  const enemy = f.input.encounters[0]!.enemies[0]!;
  const late = compileBattleEncounterRuntime(f.reader(), { ...f.input,
    reserveEnemies: [{ partyId: 9201, enemy }] });
  assert.equal(late.encounters[9201], undefined);
  assert.ok(late.diagnostics.some(diagnostic => diagnostic.partyId === 9201 &&
    diagnostic.code === "enemy-initial-condition" && /late-entry initialization phase/.test(diagnostic.reason)));
});

test("same-selector duplicates retain provenance while conflicting duplicates do not guess native enumeration", () => {
  const f = fixture();
  f.tables["condition_group.csv"]!.push({ ...f.tables["condition_group.csv"]![0]!, id: "5004", invocation_rate: "2" });
  const equivalent = compileConditionResistances(f.reader(), 501);
  assert.deepEqual(equivalent.resistances, { 301: 0 }); assert.deepEqual(equivalent.shadowedRowIds, ["5004"]);
  f.tables["condition_group.csv"]!.at(-1)!.type_id = "1";
  assert.throws(() => compileConditionResistances(f.reader(), 501), /conflicting condition resistance rows/);
});

test("missing, malformed and stale group/master bindings block only their dependent encounter", async (t) => {
  for (const fault of ["group", "master", "selector", "master-type", "source-id"] as const) await t.test(fault, () => {
    const f = fixture();
    if (fault === "group") f.tables["condition_group.csv"] = f.tables["condition_group.csv"]!.filter(row => row.group_id !== "502");
    if (fault === "master") f.tables["condition.csv"] = f.tables["condition.csv"]!.filter(row => row.id !== "601");
    if (fault === "selector") f.tables["condition_group.csv"]![1]!.type_id = "-1";
    if (fault === "master-type") f.tables["condition.csv"]!.find(row => row.id === "601")!.condition_type = "609";
    const reader = f.reader();
    if (fault === "source-id") {
      const row = reader.row;
      reader.row = (table, id) => {
        const found = row(table, id);
        return table === "condition.csv" && Number(id) === 601 ? { ...found, source: { ...found.source, rowId: "0601" } } : found;
      };
    }
    const result = compileBattleEncounterRuntime(reader, f.input);
    assert.deepEqual(Object.keys(result.encounters), ["9201"]);
    const failure = result.diagnostics.find(diagnostic => diagnostic.partyId === 9202 && diagnostic.code === "enemy-condition-resistance");
    assert.ok(failure); assert.equal(failure.kind, "blocked"); assert.equal(failure.enemySlot, 5);
    assert.ok(failure.dependency?.table.startsWith("condition"));
    assert.match(failure.reason, /resistance_condition=502/);
  });
});

test("an admitted resistance never bypasses initial active-condition or physical-provider gates", () => {
  for (const field of ["initial_condition", "attack_plus"] as const) {
    const f = fixture(); f.tables["monster.csv"]![1]![field] = "17";
    const result = compileBattleEncounterRuntime(f.reader(), f.input);
    assert.equal(result.encounters[9202], undefined);
    const code = field === "initial_condition" ? "enemy-initial-condition" : "enemy-provider";
    assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === code && diagnostic.reason.includes(field + "=17")));
  }
});

test("source-compiled innate resistances survive BattleGame entry and retain normal versus fixed-hit application", async (t) => {
  for (const fixed of [false, true]) await t.test(String(fixed), () => {
    const f = battleFixture(fixed), battle = new BattleGame(f.content, 19);
    assert.deepEqual(battle.enemies.map(enemy => enemy.conditionResistances), [{ 301: 0 }, { 301: 1, 601: 1 }]);
    assert.deepEqual(battle.targetChoices("a", 15).map(choice => choice.targetIds), [["enemy:5", "enemy:9"]]);
    const before = JSON.stringify(f.content);
    assert.equal(battle.command("a", 15, { kind: "side", side: "enemy" }, 100), true); battle.advance(500);
    assert.deepEqual(battle.enemies.map(enemy => enemy.conditionIds), fixed ? [[301], []] : [[], []]);
    assert.deepEqual(battle.action!.results.map(result => result.effects[0]!.missed), fixed ? [false, true] : [true, true]);
    assert.equal(battle.players[0]!.mp, 6); assert.equal(JSON.stringify(f.content), before);
  });
});

test("later status target failure rolls back the full frame, then replay matches the same compiled battle", () => {
  const f = battleFixture(true), battle = new BattleGame(f.content, 19), control = new BattleGame(f.content, 19);
  for (const owner of [battle, control]) {
    assert.equal(owner.command("a", 15, { kind: "side", side: "enemy" }, 100), true);
    for (let n = 0; n < 100 && (owner.action?.elapsed ?? 0) < 390; n++) owner.advance(10);
    assert.equal(owner.action?.elapsed, 390); assert.equal(owner.action.resolved, false);
  }
  const probe = (owner: BattleGame) => structuredClone({ time: owner.time, phase: owner.phase,
    units: owner.combatants, action: owner.action, pending: owner.pendingActions, timing: owner.timingState, events: owner.events });
  const before = probe(battle), add = battle.conditions.add.bind(battle.conditions);
  const error = new Error("Controlled second-target validation failure"); let calls = 0, firstProjected = false;
  battle.conditions.add = (...args) => {
    if (++calls === 2) throw error;
    const result = add(...args); firstProjected = result.added.includes(301); return result;
  };
  assert.throws(() => battle.advance(10), caught => caught === error);
  assert.equal(firstProjected, true); assert.equal(calls, 2); assert.deepEqual(probe(battle), before);
  // The failed logical tick remains pending; repair replays that tick without
  // adding another interval to the owner clock.
  battle.conditions.add = add; battle.advance(0); control.advance(10);
  assert.deepEqual(probe(battle), probe(control));
});

test("compiled enemy resistances use the real session lease and return resources once through prepared handoff", async () => {
  const f = battleFixture(true), entry = checkpointFixture();
  entry.field.scripts.fight![0] = { ...entry.field.scripts.fight![0]!, kind: "encounter", party: 9201, continuation: "after" };
  const game = new GameSession(entry.field, f.catalog, 19, { battleHandoff: "prepared" }), flow = new GameFlow(game);
  flow.start(); const ready = { visible: true, mediaReady: true, overlayOpen: false }; flow.advance(0, ready);
  const owned = game.state.snapshot(), handoff = new GameBattleHandoff(flow, {
    prepareStart: async () => ({}), prepareReturn: async () => ({}), discard() {},
  });
  assert.equal(game.field.startEvent("fight"), true); const request = game.field.stop;
  assert.equal((await handoff.start()).status, "committed");
  assert.equal(game.field.stop, request); assert.equal(game.state.inBattle, true);
  assert.equal(game.battle!.command("a", 15, { kind: "side", side: "enemy" }, 100), true);
  flow.advance(500, ready); assert.deepEqual(game.battle!.enemies.map(enemy => enemy.conditionIds), [[301], []]);
  assert.deepEqual(game.state.snapshot(), owned, "An action changes the leased battle, not persistent resources");
  for (let n = 0; n < 3000 && game.battle!.phase === "active"; n++) {
    for (const actor of game.battle!.ready) {
      const target = game.battle!.targets(actor.id, 10)[0];
      if (target) game.battle!.command(actor.id, 10, target.id, 100);
    }
    flow.advance(10, ready);
  }
  assert.equal(game.battle!.phase, "victory");
  assert.equal((await handoff.return()).status, "committed"); flow.advance(10, ready);
  assert.equal(game.state.inBattle, false); assert.equal(game.checkpointReady, true);
  assert.equal(game.state.snapshot().completedBattles.length, 1); assert.equal(game.state.snapshot().roster[0]!.mp, 6);
  const returned = game.checkpoint(); await assert.rejects(handoff.return(), /pending encounter/);
  assert.deepEqual(game.checkpoint(), returned);
});
