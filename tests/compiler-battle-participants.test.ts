import test from "node:test";
import assert from "node:assert/strict";
import { encounterRuntimeFixture } from "./fixtures/battle-encounter-runtime.js";
import { aiSource } from "./fixtures/battle-ai.js";
import { compileBattleEncounterRuntime } from "../src/compiler/battle-encounter-runtime.js";
import { parseBattleParticipantContent } from "../src/core/battle-participants.js";
import { analyzeBatchEncounters } from "../src/compiler/content-batch-battle.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";
import type { BattleCatalog } from "../src/core/battle-content.js";

function reserveFixture() {
  const f = encounterRuntimeFixture();
  const master = structuredClone(f.tables["monster.csv"]![0]!);
  master.id = "9103"; master.exp = "19"; master.gill = "23";
  f.tables["monster.csv"]!.push(master);
  f.input.reserveEnemies = [{ partyId: 9201,
    enemy: { ...structuredClone(f.input.encounters[0]!.enemies[0]!), monsterId: 9103 } }];
  f.input.development.participants = [{ partyId: 9201, rewardScope: "active-units",
    slots: { 2: { x: -40, y: 21, group: 2 } } }];
  return f;
}

function catalogFor(f: ReturnType<typeof reserveFixture>): BattleCatalog {
  const result = compileBattleEncounterRuntime(f.reader(), f.input), base = checkpointFixture().battle;
  return { ...base, common: { ...base.common, abilities: f.input.abilities, conditions: f.input.conditions,
    sprites: f.input.sprites, drops: result.drops,
    battleEvents: { conditions: f.input.conditions.rules.definitions.map(condition => ({ id: condition.id,
      type: condition.type, attackTarget: condition.id === 305 ? 1 : 0, gameOverTarget: condition.id === 305 ? 1 : 0 })) } },
    encounters: result.encounters, encounterDiagnostics: result.diagnostics, encounterReport: result.report };
}

function bindRootEntries(f: ReturnType<typeof encounterRuntimeFixture>, entries: readonly [number, number][]) {
  const encounter = f.input.encounters[0]!;
  encounter.metadata.scriptId = 8123;
  const ops = [...entries.map(([monsterId, uniqueId]) => ({ mnemonic: "BattleAddEnemy", type: 1,
    operands: { iValues: [monsterId, uniqueId, 0, 0, 0, 0, 0, 0], rValues: Array(8).fill(0), sValues: Array(8).fill("") } })),
    { mnemonic: "Exit", type: 1, operands: { iValues: Array(8).fill(0), rValues: Array(8).fill(0), sValues: Array(8).fill("") } }];
  encounter.script = { source: { ...f.aiIdentity, sourceSetHash: "a".repeat(64),
    battleSourceSetHash: "b".repeat(64), sha256: "c".repeat(64), assetPath: "synthetic/participant-root.json" },
    data: { Name: "Synthetic root entries", Title: { main: "Synthetic battle", sub: "Redistributable" },
      ScriptLocal: [], ScriptLocalValue: [],
      SystemFlag: { KeepBadStatusVisual: 0, KeepPlayerPuppet: 0, RidingVehicle: 0, SkipInitialize: 0 },
      Animations: [], Segments: [{ Label: "Main", EntryPoint: 0, Count: ops.length }], Mnemonics: ops } };
}

function waveFixture() {
  const f = encounterRuntimeFixture(), master = structuredClone(f.tables["monster.csv"]![0]!);
  master.id = "9103"; master.exp = "29"; master.gill = "31";
  f.tables["monster.csv"]!.push(master);
  const child = f.encounter(513, 9103);
  child.enemies[0]!.slot = 3;
  child.enemies.push({ ...structuredClone(child.enemies[0]!), slot: 7, x: -33, y: 17, group: 2 });
  f.input.enemyParties = [{ partyId: 9201, encounter: child }];
  f.input.development.participants = [{ partyId: 9201, rewardScope: "all-entered", slots: {} }];
  return { ...f, child };
}

function bindWaveRoot(f: ReturnType<typeof encounterRuntimeFixture>, partyIds: readonly number[], add?: [number, number]) {
  bindRootEntries(f, add ? [add] : []);
  const data = f.input.encounters[0]!.script!.data as {
    Segments: { Count: number }[];
    Mnemonics: { mnemonic: string; type: number; operands: { iValues: number[]; rValues: number[]; sValues: string[] } }[];
  };
  const exit = data.Mnemonics.pop()!;
  for (const id of partyIds) {
    const selector: Record<number, string> = { 513: "LB:敵パーティラウンド2", 514: "LB:敵パーティラウンド3", 515: "LB:敵パーティラウンド4" };
    assert.ok(selector[id]);
    data.Mnemonics.push({ mnemonic: "SysCall", type: 1, operands: { iValues: Array(8).fill(0), rValues: Array(8).fill(0),
      sValues: [selector[id]!, "", "", "", "", "", "", ""] } });
  }
  data.Mnemonics.push(exit); data.Segments[0]!.Count = data.Mnemonics.length;
}

test("static source slots publish an explicit normalized contract without adding reserve units", () => {
  const f = encounterRuntimeFixture(), result = compileBattleEncounterRuntime(f.reader(), f.input);
  const encounter = result.encounters[9201]!;
  assert.deepEqual(encounter.participants!.initial, [{ id: "enemy:5", sourceId: 9101, uniqueId: 5 }]);
  assert.deepEqual(encounter.participants!.slots, { 5: { x: 12, y: -8, group: 1 } });
  assert.equal(encounter.participants!.rewardScope, "active-units");
  assert.deepEqual(Object.keys(encounter.participants!.enemyDefinitions), ["9101"]);
  assert.doesNotThrow(() => parseBattleParticipantContent(encounter.participants, encounter.enemies));
});

test("late masters share the same compiler and remain content rather than initial enemies", () => {
  const f = reserveFixture(), before = JSON.stringify(f.input);
  const result = compileBattleEncounterRuntime(f.reader(), f.input), encounter = result.encounters[9201]!;
  assert.equal(JSON.stringify(f.input), before);
  assert.equal(encounter.enemies.length, 1);
  assert.deepEqual(Object.keys(encounter.participants!.enemyDefinitions), ["9101", "9103"]);
  assert.equal(encounter.participants!.enemyDefinitions[9103]!.exp, 19);
  assert.equal(encounter.participants!.enemyDefinitions[9103]!.gil, 23);
  assert.equal(encounter.participants!.enemyDefinitions[9103]!.ai!.source!.objectId, "90071992547409937");
  assert.deepEqual(result.drops.monsters.map(monster => monster.id), [9101, 9102, 9103]);
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.partyId === 9201 &&
    diagnostic.code === "participant-policy" && diagnostic.kind === "development-omission"));
  assert.equal(result.report.entries.find(entry => entry.partyId === 9201)!.enemyCount, 1);
  assert.equal(result.report.originalGameExecuted, false);
});

test("late dependencies and policy failures block their destination encounter before entering battle", () => {
  for (const cause of ["policy", "media", "master", "initial-condition", "slot"] as const) {
    const f = reserveFixture();
    if (cause === "policy") delete f.input.development.participants;
    if (cause === "media") f.input.reserveEnemies![0]!.enemy.sprite = "missing-late-media";
    if (cause === "master") f.tables["monster.csv"]!.pop();
    if (cause === "initial-condition") f.tables["monster.csv"]![2]!.initial_condition = "22";
    if (cause === "slot") f.input.development.participants![0]!.slots[2]!.group = 3;
    const result = compileBattleEncounterRuntime(f.reader(), f.input);
    assert.deepEqual(Object.keys(result.encounters), ["9202"], cause);
    assert.ok(result.diagnostics.some(diagnostic => diagnostic.partyId === 9201 && diagnostic.kind === "blocked"));
    assert.deepEqual(result.drops.monsters.map(monster => monster.id), [9102]);
  }
});

test("reserve AI references and unknown instructions retain dependency PCs without static-menu substitution", () => {
  const f = reserveFixture();
  f.input.reserveEnemies![0]!.enemy.ai.data = aiSource([
    ["Nop"], ["SyncAI"], ["MissingLateInstruction"], ["StartTable", [0]], ["Act", [12]],
    ["EndTable"], ["JumpBattleAI", [0]],
  ]);
  const result = compileBattleEncounterRuntime(f.reader(), f.input), encounter = result.encounters[9201]!;
  assert.equal(result.report.withRuntimeDependencies, 1);
  assert.equal(encounter.participants!.enemyDefinitions[9103]!.ai!.instructions[2]!.op.kind, "blocked");
  assert.deepEqual(result.report.entries.find(entry => entry.partyId === 9201)!.abilityIds, [12, 13]);
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.partyId === 9201 && diagnostic.code === "ai-instruction" &&
    diagnostic.pc === 2 && diagnostic.enemySlot === undefined));
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === "ability-plan" && diagnostic.pc === 4 &&
    diagnostic.dependency?.id === 12));
});

test("missing late abilities are static blockers even before the reserve unit is created", () => {
  const f = reserveFixture();
  f.input.reserveEnemies![0]!.enemy.ai.data = aiSource([
    ["Nop"], ["SyncAI"], ["StartTable", [0]], ["Act", [999]], ["EndTable"], ["JumpBattleAI", [0]],
  ]);
  const result = compileBattleEncounterRuntime(f.reader(), f.input);
  assert.equal(result.encounters[9201], undefined);
  assert.ok(result.encounters[9202]);
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.partyId === 9201 && diagnostic.code === "ability-reference" &&
    diagnostic.kind === "blocked" && diagnostic.pc === 3 && diagnostic.dependency?.id === 999));
});

test("reachable late drops survive publication and unsupported ownership does not disappear with pruning", () => {
  const f = reserveFixture(), master = f.tables["monster.csv"]![2]!;
  master.drop_rate = "100"; master.drop_content_id1 = "777"; master.drop_content_id1_value = "2";
  f.tables["content.csv"]!.push({ id: "777", type_id: "1", type_value: "99" });
  f.tables["item.csv"]!.push({ id: "99", type_id: "1" });
  let result = compileBattleEncounterRuntime(f.reader(), f.input);
  assert.ok(result.encounters[9201]);
  assert.deepEqual(result.drops.contents, [{ id: 777, kind: "item" }]);
  assert.equal(result.drops.monsters.find(monster => monster.id === 9103)!.slots[0]!.count, 2);
  f.tables["content.csv"]![0]!.type_id = "8";
  result = compileBattleEncounterRuntime(f.reader(), f.input);
  assert.equal(result.encounters[9201], undefined);
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.partyId === 9201 && diagnostic.code === "monster-drops" &&
    diagnostic.kind === "blocked" && diagnostic.dependency?.id === 9103));
  assert.deepEqual(result.drops.contents, []);
});

test("same-master conflicting content and initial slot rewrites never become replacement permission", () => {
  const f = reserveFixture();
  f.input.reserveEnemies![0]!.enemy.monsterId = 9101;
  f.input.reserveEnemies![0]!.enemy.ai.data = aiSource([
    ["Nop"], ["SyncAI"], ["StartTable", [0]], ["Act", [10]], ["EndTable"], ["JumpBattleAI", [0]],
  ]);
  let result = compileBattleEncounterRuntime(f.reader(), f.input);
  assert.equal(result.encounters[9201], undefined);
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === "enemy-template-identity"));
  const valid = reserveFixture();
  valid.input.development.participants![0]!.slots[5] = { x: 900, y: -8, group: 1 };
  result = compileBattleEncounterRuntime(valid.reader(), valid.input);
  assert.equal(result.encounters[9201], undefined);
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === "participant-content" && diagnostic.reason.includes("initial")));
});

test("late formation requirements cover all reachable branches and explicit accounting remains visible", () => {
  const f = reserveFixture();
  f.input.encounters[0]!.patterns = [1, 0, 1, 0, 0, 0];
  f.input.development.formations = { kind: "framework-battle-formations-v1", id: "both", weights: [1, 0, 1, 0, 0, 0] };
  f.input.abilities[10]!.plan!.targeting.normalFormationOnly = true;
  f.input.reserveEnemies![0]!.enemy.ai.data = aiSource([
    ["Nop"], ["SyncAI"], ["StartTable", [0]], ["Act", [10]], ["EndTable"], ["JumpBattleAI", [0]],
  ]);
  f.input.development.participants![0]!.rewardScope = "all-entered";
  const result = compileBattleEncounterRuntime(f.reader(), f.input);
  assert.equal(result.encounters[9201]!.participants!.rewardScope, "all-entered");
  assert.equal(result.encounters[9202]!.participants!.rewardScope, "active-units");
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.partyId === 9201 && diagnostic.code === "ability-formation"));
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === "participant-policy" && diagnostic.reason.includes("all-entered")));
});

test("reserve selections cannot point at unrequested encounters or alias the same master twice", () => {
  const f = reserveFixture();
  f.input.reserveEnemies![0]!.partyId = 9999;
  assert.throws(() => compileBattleEncounterRuntime(f.reader(), f.input), /selection/);
  f.input.reserveEnemies![0]!.partyId = 9201;
  f.input.reserveEnemies = [...f.input.reserveEnemies!, ...f.input.reserveEnemies!];
  assert.throws(() => compileBattleEncounterRuntime(f.reader(), f.input), /selection/);
});

test("batch analysis covers late AI, abilities, media and drops without counting templates as live enemies", () => {
  const f = reserveFixture(), initial = catalogFor(f);
  const analysis = analyzeBatchEncounters(initial, [9201]);
  assert.equal(analysis.runtimeAdmission, "unassessed");
  assert.deepEqual(analysis.encounters[0]!.enemyIds, ["enemy:5"]);
  for (const cause of ["media", "drop", "ability"] as const) {
    const catalog = catalogFor(reserveFixture());
    const reserve = catalog.encounters[9201]!.participants!.enemyDefinitions[9103]!;
    if (cause === "media") delete catalog.common.sprites[reserve.sprites.idle];
    if (cause === "drop") catalog.common.drops!.monsters = catalog.common.drops!.monsters.filter(monster => monster.id !== 9103);
    if (cause === "ability") {
      reserve.abilities.push(999);
      reserve.ai!.instructions[3]!.op = { kind: "act", abilities: [999], weights: [1] };
    }
    const result = analyzeBatchEncounters(catalog, [9201]).encounters[0]!;
    assert.equal(result.status, "blocked", cause);
    assert.ok(result.blockers.some(diagnostic => diagnostic.code ===
      (cause === "media" ? "media-reference" : cause === "drop" ? "reward-reference" : "ability-reference")));
    if (cause === "ability") assert.ok(result.abilityIds.includes(999));
  }
});

test("batch root dependencies retain PCs for missing masters and slots, including absent legacy contracts", () => {
  const f = reserveFixture();
  for (const cause of ["master", "slot", "contract"] as const) {
    const catalog = catalogFor(f), encounter = catalog.encounters[9201]!;
    encounter.lifecycle = { kind: "battle-lifecycle-v1", mode: "script", scriptId: 8123,
      program: { kind: "battle-event-v1", source: null, entry: 0, end: 2, localNames: [], initialLocals: [], blockers: [],
        instructions: [{ mnemonic: "BattleAddEnemy", op: { kind: "add-enemy", monsterId: 9103, uniqueId: 2 } },
          { mnemonic: "Exit", op: { kind: "exit" } }] } };
    if (cause === "master") delete encounter.participants!.enemyDefinitions[9103];
    if (cause === "slot") delete encounter.participants!.slots[2];
    if (cause === "contract") delete encounter.participants;
    const result = analyzeBatchEncounters(catalog, [9201]).encounters[0]!;
    assert.equal(result.status, "blocked");
    assert.ok(result.blockers.some(diagnostic => diagnostic.code === "battle-participant-reference" &&
      diagnostic.reason.includes("PC 0") && diagnostic.reason.includes(cause === "slot" ? "slot 2" : "master 9103")));
  }
});

test("the runtime compiler blocks undeclared root entry resources and policy at their source PC", () => {
  const f = encounterRuntimeFixture();
  bindRootEntries(f, [[9999, 6]]);
  const result = compileBattleEncounterRuntime(f.reader(), f.input);
  assert.equal(result.encounters[9201], undefined);
  assert.ok(result.encounters[9202]);
  assert.equal(result.report.entries.find(entry => entry.partyId === 9201)!.status, "blocked");
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.partyId === 9201 && diagnostic.kind === "blocked" &&
    diagnostic.code === "battle-participant-reference" && diagnostic.pc === 0 && diagnostic.dependency?.table === "monster.csv" &&
    diagnostic.dependency.id === 9999));
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === "battle-participant-reference" && diagnostic.pc === 0 &&
    diagnostic.reason.includes("slot 6")));
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === "participant-policy" && diagnostic.pc === 0));
  assert.deepEqual(result.drops.monsters.map(monster => monster.id), [9102]);
});

test("a same-master same-slot root replacement cannot inherit static reward accounting", () => {
  const f = encounterRuntimeFixture();
  bindRootEntries(f, [[9101, 5]]);
  let result = compileBattleEncounterRuntime(f.reader(), f.input);
  assert.equal(result.encounters[9201], undefined);
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === "participant-policy" && diagnostic.kind === "blocked" &&
    diagnostic.pc === 0 && diagnostic.dependency?.table === "script.csv" && diagnostic.dependency.id === 8123));
  assert.equal(result.diagnostics.some(diagnostic => diagnostic.code === "battle-participant-reference"), false);
  f.input.development.participants = [{ partyId: 9201, rewardScope: "all-entered", slots: {} }];
  result = compileBattleEncounterRuntime(f.reader(), f.input);
  assert.equal(result.encounters[9201]!.participants!.rewardScope, "all-entered");
  assert.equal(result.encounters[9201]!.lifecycle!.mode, "script");
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === "participant-policy" &&
    diagnostic.kind === "development-omission" && diagnostic.reason.includes("all-entered")));
});

test("the compiler checks every root entry PC independently before publishing a participant contract", () => {
  const f = encounterRuntimeFixture();
  bindRootEntries(f, [[9999, 6], [9101, 7]]);
  f.input.development.participants = [{ partyId: 9201, rewardScope: "active-units",
    slots: { 6: { x: 40, y: -8, group: 1 } } }];
  const result = compileBattleEncounterRuntime(f.reader(), f.input);
  assert.equal(result.encounters[9201], undefined);
  assert.ok(result.encounters[9202]);
  const missing = result.diagnostics.filter(diagnostic => diagnostic.code === "battle-participant-reference");
  assert.equal(missing.length, 2);
  assert.ok(missing.some(diagnostic => diagnostic.pc === 0 && diagnostic.reason.includes("master 9999")));
  assert.ok(missing.some(diagnostic => diagnostic.pc === 1 && diagnostic.reason.includes("slot 7")));
});

test("a complete late root entry requires both compiled reserve content and its explicit policy", () => {
  const f = reserveFixture();
  bindRootEntries(f, [[9103, 2]]);
  const result = compileBattleEncounterRuntime(f.reader(), f.input);
  assert.ok(result.encounters[9201]);
  assert.equal(result.encounters[9201]!.lifecycle!.mode, "script");
  assert.ok(result.encounters[9201]!.participants!.enemyDefinitions[9103]);
  assert.ok(result.encounters[9201]!.participants!.slots[2]);
  assert.equal(result.diagnostics.some(diagnostic => diagnostic.partyId === 9201 && diagnostic.kind === "blocked"), false);
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.partyId === 9201 &&
    diagnostic.code === "participant-policy" && diagnostic.kind === "development-omission"));
});

test("source enemy parties join the shared master closure without changing entry context or initial units", () => {
  const f = waveFixture(); bindWaveRoot(f, [513]);
  const before = JSON.stringify(f.input), result = compileBattleEncounterRuntime(f.reader(), f.input);
  const encounter = result.encounters[9201]!;
  assert.ok(encounter);
  assert.equal(JSON.stringify(f.input), before);
  assert.equal(encounter.enemies.length, 1);
  assert.deepEqual(encounter.participants!.enemyParties![513]!.members, [
    { sourceId: 9103, uniqueId: 3 }, { sourceId: 9103, uniqueId: 7 },
  ]);
  assert.deepEqual(encounter.participants!.enemyParties![513]!.slots[7], { x: -33, y: 17, group: 2 });
  assert.equal(encounter.background, f.input.encounters[0]!.background);
  assert.equal(encounter.formation, "normal");
  assert.deepEqual(encounter.rewardPolicy, { kind: "battle-reward-policy-v1", ap: 0, magicPoints: 0 });
  assert.equal(result.report.entries.find(entry => entry.partyId === 9201)!.enemyCount, 1);
  assert.deepEqual(result.drops.monsters.map(monster => monster.id), [9101, 9102, 9103]);
});

test("wave resources, source binding and raw metadata gaps isolate their destination before publication", () => {
  for (const cause of ["source", "media", "master", "conflict", "condition", "formation", "flags", "script", "script-binding", "members"] as const) {
    const f = waveFixture(); bindWaveRoot(f, [513]);
    if (cause === "source") f.child.source.rowId = "514";
    if (cause === "media") f.child.enemies[0]!.sprite = "missing-wave-media";
    if (cause === "master") f.tables["monster.csv"]!.pop();
    if (cause === "conflict") f.child.enemies.forEach(enemy => {
      enemy.monsterId = 9101;
      enemy.ai.data = aiSource([["Nop"], ["SyncAI"], ["StartTable", [0]], ["Act", [10]], ["EndTable"], ["JumpBattleAI", [0]]]);
    });
    if (cause === "condition") f.tables["monster.csv"]![2]!.initial_condition = "22";
    if (cause === "formation") f.child.patterns = [1, 1, 0, 0, 0, 0];
    if (cause === "flags") {
      f.child.metadata.battleFlagGroupId = 18;
      f.child.metadata.battleFlags = [{ source: f.rowSource("battle_flag_group.csv", 19),
        values: { id: "19", group_id: "18", battle_flag_id: "14" } }];
    }
    if (cause === "script") {
      f.child.metadata.scriptId = 17;
      f.child.script = { source: { ...f.aiIdentity }, data: {} };
    }
    if (cause === "script-binding") f.child.metadata.scriptId = 17;
    if (cause === "members") f.child.enemies[1]!.slot = 3;
    const result = compileBattleEncounterRuntime(f.reader(), f.input);
    assert.equal(result.encounters[9201], undefined, cause);
    assert.ok(result.encounters[9202], cause);
    assert.ok(result.diagnostics.some(diagnostic => diagnostic.partyId === 9201 && diagnostic.kind === "blocked"));
    assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === "enemy-party-reference" && diagnostic.pc === 0));
    assert.deepEqual(result.report.enemyPartySources![0]!.metadata, f.child.metadata);
    assert.equal(result.report.enemyPartySources![0]!.consumerSemantics, "unverified");
    assert.deepEqual(result.drops.monsters.map(monster => monster.id), [9102]);
  }
});

test("every wave reference and source policy is checked even if no reserve master is requested", () => {
  const f = waveFixture(); bindWaveRoot(f, [513, 514]);
  delete f.input.development.participants;
  const result = compileBattleEncounterRuntime(f.reader(), f.input);
  assert.equal(result.encounters[9201], undefined);
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === "enemy-party-reference" && diagnostic.pc === 1 &&
    diagnostic.dependency?.id === 514));
  assert.deepEqual(result.diagnostics.filter(diagnostic => diagnostic.code === "participant-policy" && diagnostic.kind === "blocked")
    .map(diagnostic => diagnostic.pc), [0, 1]);
});

test("a phase policy cannot invent a child source or rewrite a real source slot", () => {
  for (const cause of ["missing-source", "source-slot"] as const) {
    const f = waveFixture(); bindWaveRoot(f, [513]);
    f.input.development.participants![0]!.enemyParties = cause === "missing-source"
      ? { 514: { slots: {} } } : { 513: { slots: { 3: { x: 999, y: -8, group: 1 } } } };
    const result = compileBattleEncounterRuntime(f.reader(), f.input);
    assert.equal(result.encounters[9201], undefined);
    assert.ok(result.diagnostics.some(diagnostic => diagnostic.kind === "blocked" &&
      diagnostic.reason.includes(cause === "missing-source" ? "source party binding" : "source child slot")));
  }
});

test("mixed AddEnemy and party changes close the requested slot across every selected phase", () => {
  const f = waveFixture(); bindWaveRoot(f, [513], [9101, 5]);
  let result = compileBattleEncounterRuntime(f.reader(), f.input);
  assert.equal(result.encounters[9201], undefined);
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === "battle-participant-reference" && diagnostic.pc === 0 &&
    diagnostic.dependency?.id === 513 && diagnostic.reason.includes("all selected phases")));
  f.input.development.participants![0]!.enemyParties = { 513: { slots: { 5: { x: 40, y: -8, group: 1 } } } };
  result = compileBattleEncounterRuntime(f.reader(), f.input);
  assert.ok(result.encounters[9201]);
  assert.deepEqual(result.encounters[9201]!.participants!.enemyParties![513]!.slots[5], { x: 40, y: -8, group: 1 });
});

test("child metadata is preserved independently while the explicit Web profile keeps parent presentation and rewards", () => {
  const f = waveFixture(); bindWaveRoot(f, [513]);
  f.child.metadata.backgroundId = 2; f.child.metadata.bgmId = 9; f.child.metadata.appearanceProduction = 1;
  f.child.metadata.notEscape = 2; f.child.metadata.getValue = 12; f.child.patterns = [0, 0, 1, 0, 0, 0];
  f.child.background = "synthetic-wave-background";
  f.input.sprites = { ...f.input.sprites, [f.child.background]: { file: "/synthetic/wave-bg.png", width: 32, height: 16 } };
  const result = compileBattleEncounterRuntime(f.reader(), f.input), entry = result.encounters[9201]!;
  assert.ok(entry);
  assert.equal(entry.formation, "normal");
  assert.equal(entry.background, "synthetic-background");
  assert.equal(entry.rewardPolicy!.magicPoints, 0);
  const annotation = result.report.enemyPartySources![0]!;
  assert.equal(annotation.rootPartyId, 9201); assert.equal(annotation.partyId, 513);
  assert.deepEqual(annotation.source, f.child.source); assert.deepEqual(annotation.metadata, f.child.metadata);
  assert.deepEqual(annotation.patterns, f.child.patterns); assert.equal(annotation.consumerSemantics, "unverified");
  (annotation.metadata as typeof f.child.metadata).getValue = 0;
  assert.equal(f.child.metadata.getValue, 12);
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === "enemy-party-metadata" && diagnostic.dependency?.id === 513 &&
    diagnostic.dependency.field === "get_value"));
});

test("wave drop ownership and conditional AI plans use the existing registries and retain capability gaps", () => {
  const f = waveFixture(); bindWaveRoot(f, [513]);
  f.child.enemies.forEach(enemy => { enemy.ai.data = aiSource([
    ["Nop"], ["SyncAI"], ["StartTable", [0]], ["Act", [12]], ["EndTable"], ["JumpBattleAI", [0]],
  ]); });
  const master = f.tables["monster.csv"]![2]!;
  master.drop_rate = "100"; master.drop_content_id1 = "777"; master.drop_content_id1_value = "2";
  f.tables["content.csv"]!.push({ id: "777", type_id: "1", type_value: "99" });
  f.tables["item.csv"]!.push({ id: "99", type_id: "1" });
  let result = compileBattleEncounterRuntime(f.reader(), f.input);
  assert.ok(result.encounters[9201]);
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === "ability-plan" && diagnostic.kind === "runtime-dependency" &&
    diagnostic.reason.includes("Enemy party 513") && diagnostic.pc === 3));
  assert.deepEqual(result.drops.contents, [{ id: 777, kind: "item" }]);
  assert.ok(result.report.entries.find(entry => entry.partyId === 9201)!.abilityIds.includes(12));
  f.tables["content.csv"]![0]!.type_id = "8";
  result = compileBattleEncounterRuntime(f.reader(), f.input);
  assert.equal(result.encounters[9201], undefined);
  assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === "monster-drops" && diagnostic.dependency?.id === 9103));
});

test("batch analysis keeps party references and cross-phase slot gaps blocked independently of an old green report", () => {
  const f = waveFixture(); bindWaveRoot(f, [513], [9101, 5]);
  f.input.development.participants![0]!.enemyParties = { 513: { slots: { 5: { x: 40, y: -8, group: 1 } } } };
  const catalog = catalogFor(f);
  delete catalog.encounters[9201]!.participants!.enemyParties![513]!.slots[5];
  let analysis = analyzeBatchEncounters(catalog, [9201]).encounters[0]!;
  assert.equal(analysis.status, "blocked");
  assert.ok(analysis.blockers.some(diagnostic => diagnostic.code === "battle-participant-reference" && diagnostic.reason.includes("PC 0")));
  delete catalog.encounters[9201]!.participants!.enemyParties![513];
  analysis = analyzeBatchEncounters(catalog, [9201]).encounters[0]!;
  assert.equal(analysis.status, "blocked");
  assert.ok(analysis.blockers.some(diagnostic => diagnostic.code === "enemy-party-reference" && diagnostic.reason.includes("PC 1")));
});
