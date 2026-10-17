import test from "node:test";
import assert from "node:assert/strict";
import { Battle } from "./battle.js";
import { MonsterAI } from "./monster-ai.js";

const op = (name, ints = [], reals = [], strings = []) => [name, ints, reals, strings];
function interpreter(ops) {
  const unit = { id: 1, hp: 100, mp: 50, side: "enemy", conditions: [] },
    actions = [];
  const battle = {
    elapsed: 0,
    enemies: [unit],
    players: [],
    data: {},
    random: () => 0.5,
    warning() {},
    addLog() {},
    queueAIAction(action) {
      actions.push(action);
    },
  };
  return {
    ai: new MonsterAI(battle, unit, { name: "fixture", ops }),
    actions,
    battle,
    unit,
  };
}

test("AI rotates complete action rows and preserves repeated actions in LoopAct", () => {
  const { ai, actions } = interpreter([
    op("SyncAI"),
    op("StartTable", [0]),
    op("Act", [11], [100]),
    op("LoopAct", [12, 13], [2, 1]),
    op("EndTable"),
    op("JumpBattleAI", [0]),
  ]);
  for (let turn = 0; turn < 3; turn++) ai.wake("normal");
  assert.deepEqual(
    actions.map((action) => action.abilityId),
    [11, 12, 12, 13, 11],
  );
});

test("misses do not trigger hit counters and final actions execute once", () => {
  const { ai, actions, unit } = interpreter([
    op("SyncAI"),
    op("CounterActByHit", [12], [100]),
    op("FinalLoopAttackAct", [13, 14], [1, 2]),
    op("JumpBattleAI", [0]),
  ]);
  ai.wake("reaction", { target: unit, hit: false });
  ai.wake("reaction", { target: unit, hit: true, amount: 1 });
  unit.hp = 0;
  ai.wake("final", { target: unit, hit: true });
  ai.wake("final", { target: unit, hit: true });
  assert.deepEqual(
    actions.map((action) => action.abilityId),
    [12, 13, 14, 14],
  );
});

test("timer wake follows a PR time branch without waiting for another ATB turn", () => {
  const { ai, battle, actions } = interpreter([
    op("SyncAI"),
    op("IsTimerJump", [4], [2]),
    op("JumpBattleAI", [0]),
    op("Exit"),
    op("Act", [15], [100]),
    op("JumpBattleAI", [0]),
  ]);
  battle.elapsed = 1;
  ai.tick();
  assert.equal(actions.length, 0);
  battle.elapsed = 2;
  ai.tick();
  assert.deepEqual(
    actions.map((action) => action.abilityId),
    [15],
  );
});

test("a scene pause freezes AI timers and hidden bodies do not initiate timer actions", () => {
  const { ai, battle, actions, unit } = interpreter([
    op("SyncAI"),
    op("IsTimerJump", [4], [2]),
    op("JumpBattleAI", [0]),
    op("Exit"),
    op("Act", [15], [100]),
    op("JumpBattleAI", [0]),
  ]);
  battle.events = { paused: true };
  battle.elapsed = 2;
  ai.tick();
  assert.equal(actions.length, 0);
  battle.events.paused = false;
  battle.elapsed = 3;
  ai.tick();
  assert.equal(actions.length, 0);
  battle.elapsed = 4;
  ai.tick();
  assert.equal(actions.length, 1);
  unit.hidden = true;
  battle.elapsed = 20;
  ai.tick();
  assert.equal(actions.length, 1);
});

test("IsEnemyAttackJump advances the acting monster turn counter, not an enemy-hit counter", () => {
  const { ai, unit } = interpreter([
    op("SyncAI"),
    op("IsEnemyAttackJump", [4]),
    op("JumpBattleAI", [0]),
    op("Exit"),
    op("ValueCalc", [10, 1], [], ["＋"]),
    op("JumpBattleAI", [0]),
  ]);
  ai.wake("normal");
  assert.equal(ai.vars[10], 1);
  ai.wake("reaction", { actor: { side: "enemy" }, target: unit, hit: true, amount: 1 });
  assert.equal(ai.vars[10], 1);
});

const fight = {
  id: 1,
  name: "Fight",
  kind: "physical",
  range: 3,
  power: 0,
  accuracy: 255,
  systemId: 3,
  typeId: 4,
  functions: [{ id: 2, values: [] }],
};
function fixture(ops, extra = {}) {
  const warnings = [],
    program = { name: "fixture", ops };
  const data = {
    abilities: { 1: fight, ...extra.abilities },
    aiPrograms: { fixture: program },
    monsters: {
      1: {
        id: 1,
        aiName: "fixture",
        hp: 999999,
        maxHp: 999999,
        level: 1,
        attack: 1,
      },
    },
    parties: {
      1: {
        members: [{ monsterId: 1, slot: 0 }, ...(extra.second ? [{ monsterId: 1, slot: 1 }] : [])],
      },
    },
    ...extra.data,
  };
  const battle = new Battle({
    data,
    party: [{ id: 1, hp: 1000, maxHp: 1000 }],
    encounterId: 1,
    random: () => 0.5,
    inventory: { 2: 1 },
    warn: (message) => warnings.push(message),
  });
  return { battle, warnings };
}

test("an unsupported AI-selected effect logs its source and executes Fight", () => {
  for (const functionId of [999]) {
    const { battle, warnings } = fixture(
      [op("SyncAI"), op("Act", [777], [100]), op("JumpBattleAI", [0])],
      {
        abilities: {
          777: { id: 777, range: 3, functions: [{ id: functionId, values: [] }] },
        },
      },
    );
    const player = battle.players[0],
      before = player.hp;
    battle.enemyTurn(battle.enemies[0]);
    assert.ok(player.hp < before);
    assert.equal(battle.lastAction.ability.id, 1);
    assert.match(warnings.join("\n"), /AI fixture:1: ability 777.*using Fight/);
  }
});

test("a monster does not counter its own self-targeted Nothing action", () => {
  const { battle } = fixture(
    [op("SyncAI"), op("Act", [696], [100]), op("CounterAct", [1], [100]), op("JumpBattleAI", [0])],
    {
      abilities: {
        696: { id: 696, range: 5, functions: [{ id: 23, values: [] }] },
      },
    },
  );
  battle.enemyTurn(battle.enemies[0]);
  assert.equal(battle.enemies[0].aiState.actions, 1);
  assert.equal(battle.enemies[0].hp, battle.enemies[0].maxHp);
  assert.equal(battle.aiQueue.length, 0);
});

test("item-sensitive AI receives its own item hit and does not observe an ally's healing item", () => {
  const { battle } = fixture(
    [
      op("SyncAI"),
      op("IsRecevieItem", [1, 4]),
      op("JumpBattleAI", [0]),
      op("Exit"),
      op("ModeCount"),
      op("JumpBattleAI", [0]),
    ],
    {
      data: {
        functions: { 1: { function1_id: 1, function1_value1: 1, function1_value2: 2 } },
        contents: { 2: { type_id: 1, type_value: 1 } },
        items: {
          1: { id: 1, battle_function_group_id: 1, battle_renge_id: 7, standard_value: 50 },
        },
      },
    },
  );
  battle.players[0].hp = 500;
  battle.players[0].ready = true;
  assert.equal(battle.useItem(0, 2, 0), true);
  assert.equal(battle.enemies[0].aiState.mode, 0);
  battle.notifyAction({
    actor: battle.players[0],
    target: battle.enemies[0],
    hit: true,
    item: { itemId: 2, contentId: 1 },
  });
  assert.equal(battle.enemies[0].aiState.mode, 0);
  battle.notifyAction({
    actor: battle.players[0],
    target: battle.enemies[0],
    hit: true,
    item: { itemId: 1, contentId: 2 },
  });
  assert.equal(battle.enemies[0].aiState.mode, 1);
});

test("deferred counter chains retain their depth across Blank and yield safely", () => {
  const { battle, warnings } = fixture(
    [op("SyncAI"), op("Blank"), op("CounterAct", [1], [100]), op("JumpBattleAI", [0])],
    { second: true },
  );
  battle.perform(battle.enemies[0], battle.enemies[1], fight);
  battle.tick(1);
  assert.match(warnings.join("\n"), /reaction chain stopped at depth 8/);
  assert.equal(battle.aiQueue.length, 0);
  assert.ok(battle.ais.reduce((count, ai) => count + ai.actions, 0) <= 9);
});
