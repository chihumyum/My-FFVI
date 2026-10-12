import test from "node:test";
import assert from "node:assert/strict";
import { evaluateBattleEventBranch, type BattleEventContext, type BattleEventRules } from "../src/core/battle-event-context.js";
import { compileBattleEventBranch, compileBattleEventRules } from "../src/compiler/battle-event-context.js";
import { BattleAIError, planBattleAIReaction, planBattleAITurn, startBattleAI, type BattleAIContext } from "../src/core/battle-ai.js";
import { initialEnemyBehavior } from "../src/core/enemy-behavior.js";
import { BattleGame } from "../src/core/battle.js";
import { syntheticAI } from "./fixtures/battle-ai.js";
import { fixture } from "./fixtures/battle-content.js";
import type { BattleRow } from "../src/compiler/battle.js";

const rules: BattleEventRules = { conditions: [
  { id: 305, type: 5, attackTarget: 1, gameOverTarget: 1 },
  { id: 304, type: 4, attackTarget: 0, gameOverTarget: 0 },
  { id: 401, type: 40, attackTarget: 3, gameOverTarget: 0 },
  { id: 402, type: 41, attackTarget: 0, gameOverTarget: 1 },
  { id: 403, type: 42, attackTarget: 2, gameOverTarget: 2 },
  { id: 480, type: 680, attackTarget: 0, gameOverTarget: 0 },
  { id: 602, type: 602, attackTarget: 0, gameOverTarget: 0 },
] };
function events(): BattleEventContext {
  return { rules: structuredClone(rules), selfId: "enemy:self", finalAttackFirstTargetSide: null, units: [
    { id: "player:a", side: "player", conditionIds: [], removed: false },
    { id: "enemy:self", side: "enemy", conditionIds: [], removed: false },
    { id: "enemy:other", side: "enemy", conditionIds: [], removed: false },
  ] };
}
const only = { kind: "only-alive" as const, target: 0 };
const count = (side: "player" | "enemy", value: number) => ({ kind: "unit-alive-count" as const,
  side, value, operator: "＝" as const, target: 0 });

test("only-alive excludes the caller, while target and game-over flags are distinct", () => {
  const context = events(), other = context.units[2]!;
  assert.equal(evaluateBattleEventBranch(only, context), false);
  assert.equal(evaluateBattleEventBranch(count("enemy", 2), context), true);
  other.conditionIds = [401]; // untargetable, but counted by IsGameOverByUnit.
  assert.equal(evaluateBattleEventBranch(only, context), true);
  assert.equal(evaluateBattleEventBranch(count("enemy", 2), context), true);
  other.conditionIds = [402]; // game over, but still targetable.
  assert.equal(evaluateBattleEventBranch(only, context), false);
  assert.equal(evaluateBattleEventBranch(count("enemy", 1), context), true);
  other.conditionIds = [403]; // Neither field uses a generic truthy test.
  assert.equal(evaluateBattleEventBranch(only, context), false);
  assert.equal(evaluateBattleEventBranch(count("enemy", 2), context), true);
  other.conditionIds = [305, 305];
  context.units[1]!.conditionIds = [305];
  assert.equal(evaluateBattleEventBranch(only, context), true, "caller life is not tested");
  assert.equal(evaluateBattleEventBranch(count("enemy", 0), context), true);
});

test("target override and staged final-attack order preserve removal precedence", () => {
  const context = events(), other = context.units[2]!;
  other.conditionIds = [305, 480];
  assert.equal(evaluateBattleEventBranch(only, context), false);
  assert.equal(evaluateBattleEventBranch(count("enemy", 1), context), true);
  other.conditionIds = [305];
  context.finalAttackFirstTargetSide = "enemy";
  assert.equal(evaluateBattleEventBranch(only, context), false);
  other.removed = true;
  assert.equal(evaluateBattleEventBranch(only, context), true);
  other.conditionIds = [];
  assert.equal(evaluateBattleEventBranch(count("enemy", 2), context), true, "count does not query IsRemove");
});

test("population count keeps factions and tests the integer result exactly equal to one", () => {
  const context = events();
  context.units[0]!.conditionIds = [305];
  assert.equal(evaluateBattleEventBranch(count("player", 0), context), true);
  assert.equal(evaluateBattleEventBranch(count("enemy", 2), context), true);
  assert.equal(evaluateBattleEventBranch({ ...count("enemy", 1), operator: "－" }, context), true);
  assert.equal(evaluateBattleEventBranch({ ...count("enemy", 0), operator: "＋" }, context), false);
  assert.equal(evaluateBattleEventBranch({ ...count("enemy", 1), operator: "←" }, context), true);
});

test("unknown or contradictory context is never treated as an empty formation", () => {
  const context = events();
  assert.throws(() => evaluateBattleEventBranch(only, undefined), /Missing battle event unit/);
  assert.throws(() => evaluateBattleEventBranch(only, { ...context, selfId: "absent" }), /enemy owner/);
  assert.throws(() => evaluateBattleEventBranch(only, { ...context, units: [...context.units, context.units[0]!] }), /identity/);
  context.units[2]!.conditionIds = [999];
  const before = structuredClone(context);
  assert.throws(() => evaluateBattleEventBranch(only, context), /condition 999/);
  assert.deepEqual(context, before);
  context.units[2]!.conditionIds = [602];
  assert.throws(() => evaluateBattleEventBranch(count("enemy", 2), context), /type 602/);
});

test("source rule compiler binds exact row identity and never substitutes missing flags", () => {
  const rows: BattleRow[] = rules.conditions.map((c) => ({ values: {
    id: String(c.id), condition_type: String(c.type), attack_target: String(c.attackTarget),
    game_over_target: String(c.gameOverTarget),
  }, source: { file: "synthetic.bundle", serializedFile: "synthetic", objectId: "90071992547409939",
    assetPath: "synthetic/condition.csv", rowId: String(c.id) } }));
  const reader = { row: (table: string, id: number | string) => {
    assert.equal(table, "condition.csv");
    const row = rows.find((r) => r.values.id === String(id));
    if (!row) throw new Error("Missing source row");
    return row;
  } };
  const ids = rules.conditions.map((c) => c.id);
  const compiled = compileBattleEventRules(reader, ids);
  assert.deepEqual(compiled.rules, rules);
  assert.equal(compiled.sources[0]!.source.objectId, "90071992547409939");
  assert.throws(() => compileBattleEventRules(reader, [...ids, ids[0]!]), /selection/);
  rows[0]!.source.rowId = "5";
  assert.throws(() => compileBattleEventRules(reader, ids), /source identity/);
  rows[0]!.source.rowId = String(ids[0]);
  delete rows[0]!.values.attack_target;
  assert.throws(() => compileBattleEventRules(reader, ids), /table integer/);
});

test("branch decoder preserves source slots, operators and strict extra-operand gates", () => {
  const raw = (iValues: number[], sValues: string[] = [], rValues: number[] = []) => ({ iValues, rValues, sValues });
  const range = { entry: 1, end: 8 };
  assert.deepEqual(compileBattleEventBranch("IsOnlyAlive", raw([5, 0]), range), { kind: "only-alive", target: 5 });
  assert.deepEqual(compileBattleEventBranch("IsUnitAliveCount", raw([2, -1, 5], ["≧"]), range),
    { kind: "unit-alive-count", side: "enemy", value: -1, operator: "≧", target: 5 });
  for (const [name, operands] of [
    ["IsOnlyAlive", raw([8])], ["IsOnlyAlive", raw([5, 1])], ["IsOnlyAlive", raw([5], ["message"])],
    ["IsOnlyAlive", raw([5], [], [1])], ["IsUnitAliveCount", raw([0, 2, 5], ["＝"])],
    ["IsUnitAliveCount", raw([1, 2, 5])], ["IsUnitAliveCount", raw([1, 2, 5], ["=="])],
    ["IsUnitAliveCount", raw([1, 2, 5, 1], ["＝"])],
  ] as const) assert.equal(compileBattleEventBranch(name, operands, range)?.kind, "blocked");
});

function aiContext(): BattleAIContext {
  return { self: { hp: 100, mp: 10, monsterId: 71, behavior: initialEnemyBehavior() },
    conditionIds: [], players: [{ level: 1 }], enemies: [{ level: 2 }], events: events() };
}

test("population branches run during initial and reaction clocks and jump after the label", () => {
  const program = syntheticAI([
    ["IsUnitAliveCount", [2, 2, 2], [], ["＝"]], ["WrongBranch"], ["LabelMustBeSkipped"],
    ["ModeSet", [4]], ["SyncAI"], ["IsOnlyAlive", [9]], ["ModeSet", [5]],
    ["JumpBattleAI", [3]], ["WrongBranch"], ["LabelMustBeSkipped"], ["ModeSet", [6]],
    ["JumpBattleAI", [3]],
  ]);
  const context = aiContext(), initial = startBattleAI(program, context);
  assert.equal(initial.behavior.mode, 4);
  context.self.behavior = initial.behavior;
  context.events!.units[2]!.conditionIds = [305];
  const reaction = planBattleAIReaction(program, initial.state, context,
    { counterReady: false, receivedAbilityId: 10, receivedSystemId: 3 });
  assert.equal(reaction.behavior.mode, 6);
  assert.deepEqual(reaction.acts, []);
  assert.equal(context.self.behavior.mode, 4);
});

test("missing event context fails at the reached source PC and leaves the previous AI state intact", () => {
  const program = syntheticAI([["Nop"], ["SyncAI"], ["ModeCount"], ["IsOnlyAlive", [5]],
    ["JumpBattleAI", [0]], ["Nop"], ["JumpBattleAI", [0]]]);
  const context = aiContext(), initial = startBattleAI(program, context), before = structuredClone(initial);
  delete context.events;
  assert.throws(() => planBattleAITurn(program, initial.state, context),
    (e) => e instanceof BattleAIError && e.pc === 3 && /unit context/.test(e.message));
  assert.deepEqual(initial, before);
  assert.equal(context.self.behavior.mode, 0);
});

function battleFixture() {
  const content = fixture();
  content.battleEvents = structuredClone(rules);
  content.enemies.forEach((enemy) => { enemy.hp = 500; enemy.abilities = [13]; });
  content.initialAtb.enemy = [0, 0];
  return content;
}

test("actual action candidate death is visible to AI reaction count before life publication", () => {
  const content = battleFixture();
  content.enemies[0]!.hp = 1;
  content.enemies[0]!.ai = syntheticAI([["Nop"], ["SyncAI"],
    ["IsUnitAliveCount", [2, 1, 7], [], ["＝"]], ["ModeSet", [10]],
    ["StartTable", [0]], ["Act", [13]], ["JumpBattleAI", [0]],
    ["Nop"], ["ModeSet", [20]], ["JumpBattleAI", [0]]]);
  const battle = new BattleGame(content, 37);
  assert.equal(battle.command("a", 10, "e1"), true);
  battle.advance(410);
  assert.equal(battle.enemies[0]!.hp, 0);
  assert.equal(battle.enemies[0]!.behavior!.mode, 20);
  assert.equal(battle.enemies[1]!.hp, 500);
});

test("reaction failure rolls damage, AI phase, queues and clock back as one action", () => {
  const content = battleFixture();
  content.enemies[0]!.hp = 1;
  content.enemies[0]!.ai = syntheticAI([["Nop"], ["SyncAI"],
    ["IsUnitAliveCount", [2, 1, 8], [], ["＝"]], ["StartTable", [0]], ["Act", [13]],
    ["EndTable"], ["JumpBattleAI", [0]], ["Nop"], ["Nop"],
    ["ModeSet", [99]], ["UnsupportedAfterDeath"], ["JumpBattleAI", [0]]]);
  const battle = new BattleGame(content, 37);
  assert.equal(battle.command("a", 10, "e1"), true);
  battle.advance(400);
  const before = structuredClone({ units: battle.combatants, ai: battle.enemyAIState("e1"),
    action: battle.action, queue: battle.pendingActions, events: battle.events, time: battle.time });
  assert.throws(() => battle.advance(10), /UnsupportedAfterDeath/);
  assert.deepEqual({ units: battle.combatants, ai: battle.enemyAIState("e1"), action: battle.action,
    queue: battle.pendingActions, events: battle.events, time: battle.time }, before);
});
