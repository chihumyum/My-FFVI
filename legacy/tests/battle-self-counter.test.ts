import test from "node:test";
import assert from "node:assert/strict";
import { ControlledBattleGame as BattleGame } from "./fixtures/controlled-battle.js";
import { fixture } from "./fixtures/battle-content.js";
import { syntheticAI } from "./fixtures/battle-ai.js";
import { compileTargetRule } from "../src/compiler/battle-targets.js";
import { participantFixture } from "./fixtures/battle-participant-game.js";
import { enemyBattleDefinition } from "../src/core/battle-participants.js";

function selfAI(ids = [601], weights = [100]) {
  return syntheticAI([["Nop"], ["SyncAI"], ["StartTable", [0]],
    ["CounterAct", ids, weights], ["Act", [13], [100]], ["EndTable"], ["JumpBattleAI", [0]]]);
}
function selfAbility(c: ReturnType<typeof fixture>, id = 601) {
  const ability = structuredClone(c.abilities[11]!);
  Object.assign(ability, { id, name: "Authored self counter", power: 20, cost: 3 });
  ability.program.abilityId = id; ability.program.range = 5;
  ability.plan!.targeting = compileTargetRule(5, 2)!;
  ability.plan!.effects = [{ slot: 1, kind: "recovery", resource: "hp", calculation: "fixed" }];
  ability.plan!.magic = null;
  return ability;
}
function content(queued = false) {
  const c = fixture();
  c.players.forEach(unit => unit.hp = 2000);
  c.enemies.forEach(unit => { unit.hp = 2000; unit.mp = 10; unit.abilities = [13, 601]; unit.ai = selfAI(); });
  c.abilities[601] = selfAbility(c);
  c.initialAtb.enemy = queued ? [100, 100] : [0, 0];
  return c;
}
function snapshot(b: BattleGame) {
  return structuredClone({ units: b.combatants, action: b.action, pending: b.pendingActions,
    ai: b.enemies.map(unit => b.enemyAIState(unit.id)), events: b.events, phase: b.phase, time: b.time,
    participants: b.participantExecution });
}

test("ordinary CounterAct self uses the reacting instance, pays once and preserves the queued normal turn", () => {
  const b = new BattleGame(content(true), 191);
  assert.equal(b.command("a", 10, "e1"), true); b.advance(410);
  const queued = b.pendingActions.find(action => action.actor === "e1" && action.kind === "normal")!;
  const counter = b.pendingActions.find(action => action.kind === "counter")!;
  assert.ok(queued); assert.equal(counter.actor, "e1"); assert.equal(counter.targeting, "automatic");
  assert.deepEqual(counter.targetIds, ["e1"]); assert.equal(counter.charge, 0);
  const hp = b.enemies[0]!.hp, attackerHp = b.players[0]!.hp, gauge = b.enemies[0]!.atb,
    actTurn = b.enemyAIState("e1")!.actTurn;
  assert.ok(hp < b.enemies[0]!.maxHp);
  b.advance(920);
  assert.equal(b.action!.kind, "counter"); assert.equal(b.action!.resolved, true);
  assert.deepEqual(b.action!.targetIds, ["e1"]); assert.equal(b.enemies[0]!.hp, hp + 20);
  assert.equal(b.players[0]!.hp, attackerHp); assert.equal(b.enemies[0]!.mp, 7);
  assert.equal(b.enemies[0]!.atb, gauge); assert.equal(b.enemyAIState("e1")!.actTurn, actTurn);
  assert.equal(b.pendingActions.filter(action => action.kind === "counter").length, 0);
  const retained = b.pendingActions.find(action => action.actor === "e1" && action.kind === "normal")!;
  assert.ok(retained.charge < queued.charge);
  assert.deepEqual({ ...retained, charge: queued.charge }, queued);
  b.advance(400); assert.equal(b.enemies[0]!.mp, 7);
});

test("mixed weighted ordinary CounterAct abilities dispatch after selection and preserve source draw replay", () => {
  const seen = new Set<string>();
  for (const seed of [1, 191, 7417, 65537, 0x7236ab19, 0xdeadbeef, 0x456123ff, 0xffffffff]) {
    const c = content(); c.enemies[0]!.ai = selfAI([601, 13], [50, 50]);
    const whole = new BattleGame(structuredClone(c), seed), split = new BattleGame(c, seed);
    for (const b of [whole, split]) assert.equal(b.command("a", 10, "e1"), true);
    whole.advance(410); for (const ms of [7, 103, 200, 100]) split.advance(ms);
    assert.deepEqual(snapshot(split), snapshot(whole));
    const counter = whole.pendingActions.find(action => action.kind === "counter")!;
    assert.ok(counter); seen.add(counter.source.id === 601 ? "self" : "attacker");
    assert.deepEqual(counter.targetIds, [counter.source.id === 601 ? "e1" : "a"]);
    assert.equal(counter.targeting, counter.source.id === 601 ? "automatic" : undefined);
    whole.advance(2200); for (const ms of [17, 83, 511, 1589]) split.advance(ms);
    assert.deepEqual(snapshot(split), snapshot(whole));
  }
  assert.deepEqual([...seen].sort(), ["attacker", "self"]);
});

test("a later unsupported receiver rolls back damage, MP, prior self decision, AI, registry and random replay", () => {
  const c = content(); c.abilities[10]!.program.range = 4;
  c.abilities[10]!.plan!.targeting = compileTargetRule(4, 3)!; c.abilities[10]!.cost = 2;
  const clean = new BattleGame(structuredClone(c), 211), broken = new BattleGame(c, 211);
  const op = broken.enemies[1]!.ai!.instructions[3]!.op; assert.equal(op.kind, "counter-act");
  if (op.kind !== "counter-act") throw Error("Invalid authored test"); op.abilities = [12];
  for (const b of [clean, broken]) { assert.equal(b.command("a", 10, { kind: "side", side: "enemy" }), true); b.advance(400); }
  const before = snapshot(broken);
  assert.throws(() => broken.advance(10), /Mnemonics\/3: unimplemented ability 12/);
  assert.deepEqual(snapshot(broken), before); assert.equal(broken.players[0]!.mp, 8);
  op.abilities = [601]; broken.advance(0); clean.advance(10);
  assert.deepEqual(snapshot(broken), snapshot(clean));
  broken.advance(2500); clean.advance(2500); assert.deepEqual(snapshot(broken), snapshot(clean));
});

test("unknown nonself counter scope and active control cannot cross the new self branch", () => {
  for (const failure of ["other-range", "control", "bad-self-rule"] as const) {
    const c = content();
    if (failure === "other-range") { c.abilities[601]!.program.range = 2; c.abilities[601]!.plan!.targeting = compileTargetRule(2, 2)!; }
    if (failure === "bad-self-rule") c.abilities[601]!.plan!.targeting = compileTargetRule(3, 3)!;
    if (failure === "control") {
      c.conditionControlPolicy = { kind: "web-source-control-actions-v1" };
      c.conditions.rules.definitions.push({ id: 12, type: 12, overlapped: false, eraseGroupId: 1 });
      c.conditions.rules.eraseRules.push({ id: 1, groupId: 1, type: 2, conditionId: 0, eraseConditionId: 0 });
      c.conditions.behaviors.push({ id: 12, kind: "confusion", name: "", untilType: 8, untilValue: 1 });
      c.enemies[0]!.conditionIds = [12];
      c.abilities[10]!.conditionRecoveryHit = { kind: "source-condition-recovery-hit-v1", forAiType: 2, isMagic: true };
    }
    const b = new BattleGame(c, 223); assert.equal(b.command("a", 10, "e1"), true); b.advance(400);
    const before = snapshot(b);
    assert.throws(() => b.advance(10), failure === "control" ? /active action control is unresolved/ : /automatic target range/);
    assert.deepEqual(snapshot(b), before);
  }
});

test("retiring the reacting instance removes its pending self counter before a same-slot replacement enters", () => {
  const c = participantFixture([{ kind: "wait", seconds: .5 }, { kind: "add-enemy", monsterId: 341, uniqueId: 2 }]);
  c.players.forEach(unit => unit.hp = 2000);
  for (const unit of c.enemies) { unit.hp = 2000; unit.abilities = [13, 601]; unit.ai = selfAI(); }
  c.abilities[601] = selfAbility(c);
  c.participants!.enemyDefinitions[2000] = enemyBattleDefinition(c.enemies[0]!);
  c.participants!.enemyDefinitions[2001] = enemyBattleDefinition(c.enemies[1]!);
  const b = new BattleGame(c, 227); assert.equal(b.command("a", 10, "e1"), true); b.advance(410);
  assert.ok(b.pendingActions.some(action => action.kind === "counter" && action.actor === "e1"));
  b.advance(110);
  const replacement = b.enemies.find(unit => unit.sourceId === 341)!;
  assert.ok(replacement); assert.notEqual(replacement.id, "e1");
  assert.equal(b.enemyAIState("e1"), null);
  assert.equal(b.pendingActions.some(action => action.actor === "e1" || action.targetIds.includes("e1")), false);
  b.advance(2000);
  assert.equal(replacement.hp, replacement.maxHp); assert.equal(replacement.mp, replacement.maxMp);
  assert.equal(b.events.some(event => event.text.includes("Authored self counter")), false);
});

test("a self counter's impact failure restores its MP, HP, registry and random stream before retry", () => {
  const c = content();
  c.abilities[601] = { ...structuredClone(c.abilities[10]!), id: 601, name: "Authored self magic", cost: 3, power: 1 };
  c.abilities[601]!.program.abilityId = 601; c.abilities[601]!.program.range = 5;
  c.abilities[601]!.plan!.targeting = compileTargetRule(5, 3)!;
  const broken = new BattleGame(c, 229), clean = new BattleGame(structuredClone(c), 229);
  for (const b of [broken, clean]) {
    assert.equal(b.command("a", 10, "e1"), true); b.advance(1310);
    assert.equal(b.action!.kind, "counter"); assert.equal(b.action!.resolved, false);
  }
  const defense = broken.enemies[0]!.magicDefense; broken.enemies[0]!.magicDefense = 256;
  const before = snapshot(broken);
  assert.throws(() => broken.advance(10), /outside supported/);
  assert.deepEqual(snapshot(broken), before); assert.equal(broken.enemies[0]!.mp, 10);
  broken.enemies[0]!.magicDefense = defense; broken.advance(0); clean.advance(10);
  assert.deepEqual(snapshot(broken), snapshot(clean)); assert.equal(broken.enemies[0]!.mp, 7);
});
