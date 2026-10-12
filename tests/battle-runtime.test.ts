import test from "node:test";
import { cyclingAI, syntheticAI } from "./fixtures/battle-ai.js";
import assert from "node:assert/strict";
import { ControlledBattleGame as BattleGame } from "./fixtures/controlled-battle.js";
import { compileTargetRule } from "../src/compiler/battle-targets.js";
import type { BattleContent } from "../src/core/battle-content.js";
import { fixture } from "./fixtures/battle-content.js";

function counterFixture() {
  const f = fixture();
  f.players.forEach((p) => {
    p.hp = 2000;
  });
  f.enemies.forEach((e) => {
    e.hp = 2000;
    e.abilities = [13, 10, 12];
    e.ai = syntheticAI([
      ["Nop"],
      ["SyncAI"],
      ["StartTable", [0]],
      ["ValueCalc", [0, 1], [], ["＋"]],
      ["Act", [13]],
      ["CounterAct", [13]],
      ["Act", [10]],
      ["EndTable"],
      ["JumpBattleAI", [0]],
    ]);
  });
  f.abilities[11]!.program.rules.system_id = 2;
  return f;
}

test("counter interrupts pending actions, targets the attacker, and preserves a queued ordinary turn", () => {
  const f = counterFixture();
  f.initialAtb.enemy = [100, 100];
  const b = new BattleGame(f, 359);
  assert.equal(b.command("a", 10, "e1"), true);
  assert.equal(b.command("b", 10, "e2"), true);
  b.advance(10);
  assert.equal(b.action!.actor, "a");
  const pending = b.pendingActions;
  assert.deepEqual(
    pending.map((a) => a.actor),
    ["b", "e1", "e2"],
  );
  b.advance(400);
  assert.deepEqual(
    b.pendingActions.map((a) => [a.kind, a.actor]),
    [
      ["counter", "e1"],
      ["normal", "b"],
      ["normal", "e1"],
      ["normal", "e2"],
    ],
  );
  assert.equal(b.enemyAIState("e1")!.actTurn, 1);
  assert.equal(b.enemies[0]!.behavior!.variables[0], 2);
  assert.equal(b.enemies[0]!.atb, 100);
  b.advance(510);
  assert.equal(b.action!.kind, "counter");
  assert.equal(b.action!.actor, "e1");
  assert.deepEqual(b.action!.targetIds, ["a"]);
  b.advance(900);
  assert.equal(b.enemies[0]!.atb, 100);
  assert.equal(b.enemies[0]!.queued, true);
  assert.ok(b.players[0]!.hp < b.players[0]!.maxHp);
  assert.equal(b.players[1]!.hp, b.players[1]!.maxHp);
  assert.deepEqual(
    b.pendingActions.map(({ charge, ...action }) => action),
    pending.map(({ charge, ...action }) => action),
  );
  assert.ok(
    b.pendingActions.every((action, i) => action.charge < pending[i]!.charge),
  );
});

test("reaction branches see post-action HP and leave a partially filled gauge intact", () => {
  const f = counterFixture();
  f.enemies[0]!.ai = syntheticAI([
    ["Nop"],
    ["SyncAI"],
    ["StartTable", [0]],
    ["Act", [13]],
    ["EndTable"],
    ["IsCheckHp", [1999, 8], [], ["≦"]],
    ["CounterAct", [13]],
    ["JumpBattleAI", [0]],
    ["Nop"],
    ["CounterAct", [10]],
    ["JumpBattleAI", [0]],
  ]);
  const b = new BattleGame(f, 367);
  b.enemies[0]!.atb = 51;
  b.command("a", 10, "e1");
  b.advance(10);
  const gauge = b.enemies[0]!.atb;
  b.advance(400);
  assert.ok(b.enemies[0]!.hp < 1999);
  assert.equal(b.pendingActions[0]!.kind, "counter");
  assert.equal(b.pendingActions[0]!.source.id, 10);
  b.advance(1410);
  assert.ok(b.enemies[0]!.atb > gauge);
  assert.equal(b.enemies[0]!.queued, false);
});

test("misses and healing wake source AI but do not turn into ordinary turns or damage counters", () => {
  for (const healing of [false, true]) {
    const f = counterFixture();
    if (healing) {
      f.abilities[10]!.plan = structuredClone(f.abilities[11]!.plan);
      f.abilities[10]!.plan!.targeting = compileTargetRule(7, 2)!;
      f.abilities[10]!.program.rules.system_id = 2;
    } else {
      f.abilities[10]!.plan!.magic!.contentFlags = [];
      f.abilities[10]!.plan!.magic!.accuracy = 0;
    }
    const b = new BattleGame(f, 373);
    b.command("a", 10, "e1");
    b.advance(410);
    assert.equal(b.action!.results[0]!.effects[0]!.missed, !healing);
    assert.equal(b.pendingActions.length, 0);
    assert.equal(b.enemies[0]!.behavior!.variables[0], 1);
    assert.equal(b.enemyAIState("e1")!.actTurn, 0);
  }
});

test("zero damage can counter, while fatal hits never enqueue a living CounterAct", () => {
  for (const fatal of [false, true]) {
    const f = counterFixture();
    if (fatal) f.enemies[0]!.hp = 1;
    else {
      f.abilities[10]!.plan!.magic!.elements = [1];
      f.enemies[0]!.elementResistances = { 1: 3 };
    }
    const b = new BattleGame(f, 379);
    b.command("a", 10, "e1");
    b.advance(410);
    if (fatal) assert.equal(b.enemies[0]!.hp, 0);
    else assert.equal(b.enemies[0]!.hp, 2000);
    assert.equal(
      b.pendingActions.filter((a) => a.kind === "counter").length,
      fatal ? 0 : 1,
    );
  }
});

test("a counter may target a friendly attacker and cannot recursively trigger that attacker's counter AI", () => {
  const b = new BattleGame(counterFixture(), 383);
  // Controlled friendly-fire host. Normal enemy automatic targeting is still
  // restricted to players; the reaction rule itself must retain explicit identity.
  b.command("a", 10, "e2");
  b.advance(10);
  b.action!.actor = "e1";
  b.action!.source.id = 13;
  b.action!.commandId = null;
  b.advance(400);
  assert.equal(b.pendingActions[0]!.actor, "e2");
  assert.deepEqual(b.pendingActions[0]!.targetIds, ["e1"]);
  const targetState = b.enemyAIState("e1");
  b.advance(910);
  assert.equal(b.action!.kind, "counter");
  assert.ok(b.enemies[0]!.hp < 2000);
  assert.deepEqual(b.enemyAIState("e1"), targetState);
  assert.equal(b.enemies[0]!.behavior!.variables[0], 0);
  assert.equal(b.pendingActions.length, 0);
});

test("a later unsupported counter rolls back every target, cost, AI parameter, queue and random draw", () => {
  const f = counterFixture();
  f.abilities[10]!.plan!.targeting = compileTargetRule(4, 3)!;
  f.abilities[10]!.cost = 2;
  const clean = new BattleGame(structuredClone(f), 389);
  const broken = new BattleGame(f, 389);
  const op = broken.enemies[1]!.ai!.instructions[5]!.op;
  assert.equal(op.kind, "counter-act");
  if (op.kind !== "counter-act") throw new Error("invalid fixture");
  op.abilities = [12];
  for (const b of [clean, broken]) {
    b.command("a", 10, { kind: "side", side: "enemy" });
    b.advance(400);
  }
  const before = structuredClone(broken.combatants);
  const pending = broken.pendingActions;
  const ais = broken.enemies.map((e) => broken.enemyAIState(e.id));
  const logs = [...broken.events];
  assert.throws(() => broken.advance(10), /unimplemented ability 12/);
  assert.deepEqual(broken.combatants, before);
  assert.deepEqual(broken.pendingActions, pending);
  assert.deepEqual(
    broken.enemies.map((e) => broken.enemyAIState(e.id)),
    ais,
  );
  assert.deepEqual(broken.events, logs);
  assert.equal(broken.action!.resolved, false);
  assert.deepEqual(broken.action!.results, []);
  op.abilities = [13];
  clean.advance(20);
  broken.advance(10);
  assert.deepEqual(broken.action!.results, clean.action!.results);
  assert.deepEqual(broken.pendingActions, clean.pendingActions);
  assert.deepEqual(broken.combatants, clean.combatants);
  assert.deepEqual(
    broken.enemies.map((e) => broken.enemyAIState(e.id)),
    clean.enemies.map((e) => clean.enemyAIState(e.id)),
  );
});

test("enemy counters ignore MP shortage while lost targets cancel without consuming the ordinary gauge", () => {
  for (const reason of ["cost", "target"] as const) {
    const f = counterFixture();
    f.abilities[13]!.cost = 2;
    const b = new BattleGame(f, 397);
    b.enemies[0]!.atb = 52;
    b.command("a", 10, "e1");
    b.advance(410);
    const gauge = b.enemies[0]!.atb;
    if (reason === "cost") b.enemies[0]!.mp = 0;
    else
      b.players.forEach((p) => {
        p.hp = 0;
      });
    b.advance(510);
    if (reason === "cost") {
      assert.equal(b.action!.kind, "counter");
      assert.deepEqual(b.action!.targetIds, ["a"]);
      b.advance(900);
      assert.equal(b.enemies[0]!.mp, 0);
      assert.ok(b.players[0]!.hp < b.players[0]!.maxHp);
    }
    assert.equal(b.action, null);
    assert.ok(b.enemies[0]!.atb > gauge);
    assert.equal(b.enemies[0]!.queued, false);
    assert.deepEqual(b.pendingActions, []);
  }
});

test("counter decisions and interleaved normal turns replay across frame partitions", () => {
  const f = counterFixture();
  const one = new BattleGame(f, 401),
    partitioned = new BattleGame(structuredClone(f), 401);
  for (const b of [one, partitioned]) {
    b.command("a", 10, "e1");
    b.command("b", 10, "e2");
  }
  one.advance(60000);
  for (let n = 0; n < 6000; n++) partitioned.advance(10);
  assert.deepEqual(partitioned, one);
});

test("enemy AI cycles physical and magic decisions through the shared action queue", () => {
  const f = fixture();
  f.players.forEach((p) => {
    p.hp = 10000;
  });
  f.enemies.forEach((e) => {
    e.hp = 10000;
    e.sourceId = 712345;
    e.abilities = [13, 10];
    e.ai = cyclingAI([13, 10]);
  });
  const battle = new BattleGame(f, 221);
  const sequence: number[] = [];
  for (let turn = 0; turn < 3; turn++) {
    battle.enemies[0]!.atb = 100;
    battle.advance(10);
    sequence.push(battle.action!.source.id);
    assert.equal(battle.action!.actor, "e1");
    battle.advance(900);
    assert.ok(battle.enemies[0]!.atb > 0 && battle.enemies[0]!.atb < 1); // Released, then one FF6 progress update.
    assert.equal(battle.enemies[0]!.queued, false);
  }
  assert.deepEqual(sequence, [13, 10, 13]);
  assert.equal(battle.enemyAIState("e1")!.actTurn, 1);
  assert.equal(battle.enemyAIState("e2")!.actTurn, 0);
  assert.ok(battle.players.some((p) => p.hp < p.maxHp));
});

test("a loop submits in source order and releases its gauge only after the last queued action", () => {
  const f = fixture();
  f.players.forEach((p) => {
    p.hp = 10000;
  });
  const e = f.enemies[0]!;
  e.abilities = [13, 10];
  e.ai = syntheticAI([
    ["Nop"],
    ["SyncAI"],
    ["StartTable", [0]],
    ["LoopAct", [13, 10], [1, 2]],
    ["Act", [13]],
    ["EndTable"],
    ["JumpBattleAI", [0]],
  ]);
  const b = new BattleGame(f, 281);
  b.enemies.forEach((p) => {
    p.atb = 100;
  });
  b.advance(10);
  assert.equal(b.action!.source.id, 13);
  assert.equal(b.action!.kind, "loop");
  assert.deepEqual(
    b.pendingActions.map((a) => [a.actor, a.source.id]),
    [
      ["e1", 10],
      ["e1", 10],
      ["e2", 13],
    ],
  );
  const copied = b.pendingActions;
  copied[0]!.targetIds.length = 0;
  assert.equal(b.pendingActions[0]!.targetIds.length, 1);
  b.advance(900);
  assert.equal(b.enemies[0]!.atb, 100);
  assert.equal(b.enemies[0]!.queued, true);
  for (let i = 0; i < 2; i++) {
    b.advance(10);
    assert.equal(b.action!.source.id, 10);
    assert.equal(b.action!.actor, "e1");
    b.advance(900);
  }
  assert.ok(b.enemies[0]!.atb > 0 && b.enemies[0]!.atb < 1); // Released, then one FF6 progress update.
  assert.equal(b.enemies[0]!.queued, false);
  assert.equal(b.enemies[0]!.mp, e.mp - 2 * f.abilities[10]!.cost);
  assert.equal(b.enemyAIState("e1")!.actTurn, 1);
  b.advance(10);
  assert.equal(b.action!.actor, "e2");
  assert.equal(b.action!.kind, "normal");
});

test("an enemy loop member below its fee still executes before the later action and clamps MP at zero", () => {
  const f = fixture();
  f.players.forEach((p) => {
    p.hp = 10000;
  });
  f.abilities[10]!.cost = 5;
  f.enemies[0]!.abilities = [10, 13];
  f.enemies[0]!.ai = syntheticAI([
    ["Nop"],
    ["SyncAI"],
    ["StartTable", [0]],
    ["LoopAct", [10, 13], [2, 1]],
    ["EndTable"],
    ["JumpBattleAI", [0]],
  ]);
  const b = new BattleGame(f, 283);
  b.enemies[0]!.atb = 100;
  b.advance(910);
  assert.equal(b.enemies[0]!.mp, 3);
  b.advance(10);
  assert.equal(b.action!.source.id, 10);
  assert.equal(b.enemies[0]!.queued, true);
  assert.equal(b.enemies[0]!.atb, 100);
  assert.deepEqual(
    b.pendingActions.map((a) => a.source.id),
    [13],
  );
  b.advance(900);
  assert.equal(b.enemies[0]!.mp, 0);
  assert.equal(b.enemies[0]!.queued, true);
  assert.equal(b.enemies[0]!.atb, 100);
  b.advance(10);
  assert.equal(b.action!.source.id, 13);
  b.advance(900);
  assert.equal(b.enemies[0]!.queued, false);
  assert.ok(b.enemies[0]!.atb > 0 && b.enemies[0]!.atb < 1); // Released, then one FF6 progress update.
  assert.equal(b.enemies[0]!.mp, 0);
});

test("death between loop members removes the remaining group without charging it", () => {
  const f = fixture();
  f.players.forEach((p) => {
    p.hp = 10000;
  });
  f.abilities[10]!.wait = 1; // Native integer wait: becomes ready during the first enemy action.
  f.enemies[0]!.ai = syntheticAI([
    ["Nop"],
    ["SyncAI"],
    ["StartTable", [0]],
    ["LoopAct", [13], [3]],
    ["EndTable"],
    ["JumpBattleAI", [0]],
  ]);
  const b = new BattleGame(f, 293);
  assert.equal(b.command("a", 10, "e1"), true);
  b.enemies[0]!.atb = 100;
  b.advance(10);
  assert.equal(b.action!.actor, "e1");
  b.advance(900);
  assert.equal(b.pendingActions.filter((a) => a.actor === "e1").length, 2);
  b.advance(10);
  assert.equal(b.action!.actor, "a");
  b.advance(400);
  assert.equal(b.enemies[0]!.hp, 0);
  assert.equal(b.enemies[0]!.queued, false);
  assert.equal(b.enemies[0]!.atb, 0);
  assert.equal(
    b.pendingActions.some((a) => a.actor === "e1"),
    false,
  );
  b.advance(500);
  assert.equal(b.phase, "active");
});

test("a later target failure rolls back the entire loop, its controller counters and RNG", () => {
  const f = fixture();
  f.enemies[0]!.sourceId = 0x113;
  f.enemies[0]!.abilities = [13, 10];
  f.enemies[0]!.ai = syntheticAI([
    ["Nop"],
    ["SyncAI"],
    ["StartTable", [0]],
    ["ValueCalc", [0, 1], [], ["＋"]],
    ["LoopAct", [13, 10], [2, 1]],
    ["EndTable"],
    ["JumpBattleAI", [0]],
  ]);
  const clean = new BattleGame(structuredClone(f), 307);
  const broken = new BattleGame(f, 307);
  clean.enemies[0]!.atb = broken.enemies[0]!.atb = 100;
  const initial = broken.enemyAIState("e1");
  f.abilities[10]!.plan!.targeting.modes = [];
  assert.throws(() => broken.advance(10), /Invalid battle target rule/);
  assert.deepEqual(broken.pendingActions, []);
  assert.equal(broken.enemies[0]!.queued, false);
  assert.equal(broken.enemies[0]!.behavior!.variables[0], 0);
  assert.deepEqual(broken.enemyAIState("e1"), initial);
  f.abilities[10]!.plan!.targeting.modes = ["single"];
  clean.advance(10);
  broken.advance(0); // Retry the retained failed step without adding more wall time.
  assert.deepEqual(broken.action, clean.action);
  assert.deepEqual(broken.pendingActions, clean.pendingActions);
  assert.deepEqual(broken.enemyAIState("e1"), clean.enemyAIState("e1"));
  assert.equal(broken.enemyAIState("e1")!.advancedActCount, 6);
  clean.advance(500);
  broken.advance(500);
  assert.deepEqual(broken.action!.results, clean.action!.results);
});

test("queued loop targets are revalidated after an earlier hit defeats their target", () => {
  const f = fixture();
  f.players.forEach((p) => {
    p.hp = 10000;
  });
  f.enemies[0]!.ai = syntheticAI([
    ["Nop"],
    ["SyncAI"],
    ["StartTable", [0]],
    ["LoopAct", [13], [3]],
    ["EndTable"],
    ["JumpBattleAI", [0]],
  ]);
  const b = new BattleGame(f, 281);
  b.enemies[0]!.atb = 100;
  b.advance(10);
  const doomed = b.action!.targetIds[0]!;
  b.players.find((p) => p.id === doomed)!.hp = 1;
  assert.ok(b.pendingActions.some((a) => a.targetIds[0] === doomed));
  b.advance(900);
  assert.equal(b.players.find((p) => p.id === doomed)!.hp, 0);
  for (let i = 0; i < 2; i++) {
    b.advance(10);
    assert.equal(b.action!.kind, "loop");
    assert.notEqual(b.action!.targetIds[0], doomed);
    b.advance(900);
  }
  assert.equal(b.phase, "active");
  assert.equal(b.enemies[0]!.queued, false);
});

test("empty loops and enormous groups fail admission before committing a turn", () => {
  for (const count of [0, -1, 1001]) {
    const f = fixture();
    f.enemies[0]!.ai = syntheticAI([
      ["Nop"],
      ["SyncAI"],
      ["StartTable", [0]],
      ["LoopAct", [13], [count]],
      ["EndTable"],
      ["JumpBattleAI", [0]],
    ]);
    assert.throws(
      () => new BattleGame(f, 311),
      /empty loop|host action budget/,
    );
  }
});

test("loop queues and turns replay identically across frame partitions", () => {
  const f = fixture();
  f.players.forEach((p) => {
    p.hp = 100000;
  });
  f.enemies.forEach((e) => {
    e.ai = syntheticAI([
      ["Nop"],
      ["SyncAI"],
      ["StartTable", [0]],
      ["LoopAct", [13], [3]],
      ["Act", [13]],
      ["EndTable"],
      ["JumpBattleAI", [0]],
    ]);
  });
  const run = (parts: number[]) => {
    const b = new BattleGame(f, 313);
    for (const dt of parts) b.advance(dt);
    return {
      units: b.combatants,
      events: b.events,
      action: b.action,
      pending: b.pendingActions,
      states: b.enemies.map((e) => b.enemyAIState(e.id)),
    };
  };
  assert.deepEqual(run([60000]), run(Array(6000).fill(10)));
});

test("battle owns independent enemy parameters and preflight does not advance their phase", () => {
  const f = fixture();
  f.players.forEach((p) => {
    p.hp = 10000;
  });
  f.enemies.forEach((e) => {
    e.hp = 10000;
    e.abilities = [13, 10];
    e.ai = syntheticAI([
      ["VariableAssign", [14, 5]],
      ["ModeSet", [1]],
      ["SyncAI"],
      ["ValueCalc", [14, 1], [], ["＋"]],
      ["ModeCount"],
      ["StartTable", [0]],
      ["IsVariableComparison", [14, 7, 10], [], ["≧"]],
      ["Act", [13]],
      ["EndTable"],
      ["JumpBattleAI", [1]],
      ["Nop"],
      ["Act", [10]],
      ["EndTable"],
      ["JumpBattleAI", [1]],
    ]);
  });
  const run = (steps: number[]) => {
    const battle = new BattleGame(f, 243);
    assert.equal(battle.enemies[0]!.behavior!.variables[14], 5);
    assert.equal(battle.enemies[0]!.behavior!.mode, 1);
    const actions = [];
    for (let turn = 0; turn < 3; turn++) {
      battle.enemies[0]!.atb = 100;
      battle.advance(10);
      actions.push(battle.action!.source.id);
      for (const dt of steps) battle.advance(dt);
    }
    assert.deepEqual(actions, [13, 10, 10]);
    assert.equal(battle.enemies[0]!.behavior!.variables[14], 8);
    assert.equal(battle.enemies[0]!.behavior!.mode, 4);
    assert.equal(battle.enemies[1]!.behavior!.variables[14], 5);
    assert.equal(battle.enemies[1]!.behavior!.mode, 1);
    assert.equal(battle.players[0]!.behavior, null);
    return {
      units: battle.combatants,
      events: battle.events,
      ai: battle.enemyAIState("e1"),
    };
  };
  assert.deepEqual(run([900]), run(Array(90).fill(10)));
});

test("AI gates all ability dependencies on a reached table before partial execution", () => {
  const f = fixture();
  const enemy = f.enemies[0]!;
  enemy.ai = syntheticAI([
    ["Nop"],
    ["SyncAI"],
    ["ValueCalc", [0, 1], [], ["＋"]],
    ["ModeCount"],
    ["IsLevelCheck", [1, 7, 9]],
    ["StartTable", [0]],
    ["Act", [13]],
    ["EndTable"],
    ["JumpBattleAI", [0]],
    ["Nop"],
    ["StartTable", [1]],
    ["Act", [13]],
    ["Act", [9999]],
    ["EndTable"],
    ["JumpBattleAI", [0]],
  ]);
  enemy.abilities.push(9999);
  const battle = new BattleGame(f, 223);
  battle.players[1]!.level = 7;
  battle.players[1]!.hp = 0;
  battle.enemies[0]!.atb = 100;
  const before = battle.enemyAIState("e1");
  assert.throws(
    () => battle.advance(10),
    /Mnemonics\/12: unimplemented ability 9999/,
  );
  assert.deepEqual(battle.enemyAIState("e1"), before);
  assert.equal(battle.action, null);
  assert.equal(battle.enemies[0]!.queued, false);
  assert.equal(battle.players[0]!.hp, f.players[0]!.hp);
  assert.equal(battle.enemies[0]!.behavior!.variables[0], 0);
  assert.equal(battle.enemies[0]!.behavior!.mode, 0);
  f.players[1]!.level = 7;
  assert.throws(() => new BattleGame(f, 223), /unimplemented ability 9999/);
});

test("failed AI target resolution rolls back its random stream, turn and queue", () => {
  const f = fixture();
  f.enemies[0]!.ai = syntheticAI([
    ["Nop"],
    ["SyncAI"],
    ["StartTable", [0]],
    ["ValueCalc", [0, 1], [], ["＋"]],
    ["ModeCount"],
    ["Act", [13]],
    ["Act", [10]],
    ["EndTable"],
    ["JumpBattleAI", [0]],
  ]);
  f.enemies[0]!.abilities = [13, 10];
  const clean = new BattleGame(structuredClone(f), 227);
  const broken = new BattleGame(f, 227);
  clean.enemies[0]!.atb = broken.enemies[0]!.atb = 100;
  f.abilities[13]!.plan!.targeting.modes = [];
  assert.throws(() => broken.advance(10), /Invalid battle target rule/);
  assert.equal(broken.enemyAIState("e1")!.actTurn, 0);
  assert.equal(broken.enemies[0]!.queued, false);
  assert.equal(broken.action, null);
  assert.equal(broken.enemies[0]!.behavior!.variables[0], 0);
  assert.equal(broken.enemies[0]!.behavior!.mode, 0);
  f.abilities[13]!.plan!.targeting.modes = ["single"];
  clean.advance(10);
  broken.advance(0); // Retry the retained failed step without adding more wall time.
  assert.deepEqual(broken.action, clean.action);
  assert.deepEqual(broken.enemyAIState("e1"), clean.enemyAIState("e1"));
  assert.deepEqual(broken.enemies[0]!.behavior, clean.enemies[0]!.behavior);
  assert.equal(broken.enemies[0]!.behavior!.variables[0], 1);
  assert.equal(broken.enemies[0]!.behavior!.mode, 1);
  clean.advance(500);
  broken.advance(500);
  assert.deepEqual(broken.action!.results, clean.action!.results);
});

test("one group action can damage a weak target and heal an absorbing target with one cost", () => {
  const f = fixture();
  const ability = f.abilities[10]!;
  ability.plan!.magic!.elements = [1];
  ability.plan!.targeting = compileTargetRule(4, 1)!;
  ability.cost = 2;
  f.enemies.forEach((e) => {
    e.hp = 1000;
    e.agility = 0;
  });
  f.enemies[0]!.elementResistances = { 1: 1 };
  f.enemies[1]!.elementResistances = { 1: 4 };
  const run = (parts: number[]) => {
    const battle = new BattleGame(f, 71);
    battle.enemies[1]!.hp = 300;
    assert.equal(
      battle.command("a", 10, { kind: "side", side: "enemy" }),
      true,
    );
    for (const dt of parts) battle.advance(dt);
    const results = battle.action!.results;
    assert.equal(results.length, 2);
    assert.equal(battle.players[0]!.mp, 6);
    assert.ok(battle.enemies[0]!.hp < 1000);
    assert.ok(battle.enemies[1]!.hp > 300);
    const firstEffect = results[0]!.effects[0]!, secondEffect = results[1]!.effects[0]!;
    assert.equal(firstEffect.resource, "hp");
    assert.equal(secondEffect.resource, "hp");
    assert.equal(firstEffect.resource === "hp" && firstEffect.recovery, false);
    assert.equal(secondEffect.resource === "hp" && secondEffect.recovery, true);
    const before = structuredClone(battle.combatants);
    battle.advance(100);
    assert.deepEqual(
      battle.combatants.map((c) => [c.hp, c.mp]),
      before.map((c) => [c.hp, c.mp]),
    );
    return { results, units: battle.combatants, events: battle.events };
  };
  assert.deepEqual(run([500]), run(Array(50).fill(10)));
});

test("a later target with unknown affinity cannot partially commit earlier damage or consume MP/RNG", () => {
  const f = fixture();
  f.abilities[10]!.plan!.targeting = compileTargetRule(4, 1)!;
  f.abilities[10]!.plan!.magic!.elements = [1];
  f.abilities[10]!.cost = 2;
  f.enemies.forEach((e) => {
    e.hp = 1000;
    e.agility = 0;
  });
  const battle = new BattleGame(f, 71);
  battle.command("a", 10, { kind: "side", side: "enemy" });
  battle.advance(10);
  const before = structuredClone(battle.combatants);
  const random = (battle as unknown as { randomState: number }).randomState;
  const events = structuredClone(battle.events);
  battle.enemies[1]!.elementResistances = { 1: 402 } as never;
  assert.throws(() => battle.advance(500), /Unimplemented elemental/);
  assert.deepEqual(
    battle.combatants.map((c) => [c.hp, c.mp]),
    before.map((c) => [c.hp, c.mp]),
  );
  assert.equal(
    (battle as unknown as { randomState: number }).randomState,
    random,
  );
  assert.deepEqual(battle.events, events);
  assert.equal(battle.action!.resolved, false);
  assert.deepEqual(battle.action!.results, []);
});
function conditionFixture() {
  const f = fixture();
  f.conditions = {
    hpZeroConditionId: f.conditions.hpZeroConditionId,
    dying: f.conditions.dying,
    rules: {
      definitions: [
        ...f.conditions.rules.definitions,
        { id: 301, type: 6, overlapped: false, eraseGroupId: 1 },
        { id: 302, type: 8, overlapped: false, eraseGroupId: 1 },
      ],
      eraseRules: [
        ...f.conditions.rules.eraseRules,
        { id: 1, groupId: 1, conditionId: 0, type: 2, eraseConditionId: 0 },
      ],
    },
    behaviors: [
      ...f.conditions.behaviors,
      { id: 301, kind: "silence", name: "Silence", untilType: 2 },
    ],
  };
  f.commands[100]!.forbiddenConditionIds = [301];
  f.commands[101] = {
    id: 101,
    name: "Status",
    kind: "ability",
    abilityIds: [14, 15],
    referencedAbility: null,
    forbiddenConditionIds: [],
  };
  for (const p of f.players) {
    p.abilities.push(14, 15);
    p.commands.push(101);
  }
  f.abilities[14] = {
    ...structuredClone(f.abilities[11]!),
    id: 14,
    name: "Recover",
    wait: 0,
    plan: {
      targeting: {
        relation: "either",
        modes: ["single"],
        defaultMode: "single",
        defaultRelation: "enemy",
        normalFormationOnly: false,
        life: "alive",
      },
      physical: null,
      magic: null,
      effects: [{ slot: 1, kind: "recover-condition", conditionIds: [301] }],
    },
  };
  f.abilities[15] = {
    ...structuredClone(f.abilities[11]!),
    id: 15,
    name: "Silence",
    wait: 0,
    plan: {
      targeting: {
        relation: "either",
        modes: ["single"],
        defaultMode: "single",
        defaultRelation: "enemy",
        normalFormationOnly: false,
        life: "alive",
      },
      physical: null,
      magic: null,
      effects: [
        {
          slot: 1,
          kind: "add-condition",
          conditionId: 301,
          fixedHit: true,
          accuracy: 100,
        },
      ],
    },
  };
  return f;
}
test("player physical goes through command, cost and target settlement with deterministic replay", () => {
  const f = fixture();
  f.players[0]!.abilities = [13];
  f.commands[100]!.abilityIds.push(13);
  f.abilities[13]!.cost = 2;
  for (const e of f.enemies) e.hp = 100;
  const run = (parts: number[]) => {
    const b = new BattleGame(f, 11);
    assert.equal(b.command("a", 13, "e1", 100), true);
    for (const dt of parts) b.advance(dt);
    assert.equal(b.players[0]!.mp, 6);
    assert.ok(b.enemies[0]!.hp < 100);
    assert.equal(b.events.filter((e) => e.text.includes("点伤害")).length, 1);
    return { combatants: b.combatants, events: b.events, action: b.action };
  };
  assert.deepEqual(run([900]), run(Array(90).fill(10)));
});
test("missing physical inputs block selection, and invalid arithmetic cannot partially commit", () => {
  const f = fixture();
  f.players[0]!.abilities = [13];
  f.commands[100]!.abilityIds.push(13);
  f.players[0]!.physical = null;
  let b = new BattleGame(f, 11);
  assert.equal(b.canUse("a", 13), false);
  assert.deepEqual(b.targets("a", 13), []);
  assert.equal(b.command("a", 13, "e1"), false);
  f.players[0]!.physical = {
    attack: 20,
    strength: 30,
    accuracy: 100,
    criticalRate: 0,
  };
  f.abilities[13]!.plan!.physical!.contentFlags = [777];
  f.abilities[13]!.cost = 2;
  b = new BattleGame(f, 11);
  const before = b.combatants.map((c) => ({ hp: c.hp, mp: c.mp }));
  assert.equal(b.command("a", 13, "e1"), true);
  assert.throws(() => b.advance(500), /Unimplemented physical/);
  assert.deepEqual(
    b.combatants.map((c) => ({ hp: c.hp, mp: c.mp })),
    before,
  );
});
test("magic misses spend MP once and replay with the same later random choices", () => {
  const f = fixture();
  f.abilities[10]!.cost = 3;
  f.abilities[10]!.plan!.magic = {
    accuracy: 100,
    contentFlags: [],
    elements: [],
    forceDefense: false,
  };
  for (const e of f.enemies) e.magicEvasion = 128;
  const run = (parts: number[]) => {
    const b = new BattleGame(f, 11);
    assert.equal(b.command("a", 10, "e1"), true);
    for (const dt of parts) b.advance(dt);
    assert.equal(b.players[0]!.mp, 5);
    assert.equal(b.enemies[0]!.hp, 10);
    assert.equal(b.events.filter((e) => e.text.includes("闪避")).length, 1);
    return { combatants: b.combatants, events: b.events, action: b.action };
  };
  assert.deepEqual(run([900]), run(Array(90).fill(10)));
});
test("old profiles and unknown magic modifiers cannot silently use neutral calculations", () => {
  const f = fixture();
  assert.throws(
    () =>
      new BattleGame(
        { ...f, profile: "narshe-playability-v4" } as unknown as BattleContent,
        1,
      ),
    /Unsupported battle runtime profile/,
  );
  f.abilities[10]!.cost = 3;
  f.abilities[10]!.plan!.magic!.contentFlags = [3];
  const b = new BattleGame(f, 1);
  assert.equal(b.command("a", 10, "e1"), true);
  assert.throws(() => b.advance(500), /Unimplemented magic content flag/);
  assert.equal(b.players[0]!.mp, 8);
  assert.equal(b.enemies[0]!.hp, 10);
});
test("status changes cancel a queued command without MP cost; cure restores eligibility", () => {
  const f = conditionFixture();
  f.abilities[10]!.cost = 3;
  const run = (parts: number[]) => {
    const b = new BattleGame(f, 11);
    assert.equal(b.command("a", 15, "b", 101), true);
    assert.equal(b.command("b", 10, "e1", 100), true);
    for (const dt of parts) b.advance(dt);
    assert.deepEqual(b.players[1]!.conditionIds, [301]);
    assert.equal(b.canUse("b", 10, 100), false);
    assert.equal(b.players[1]!.mp, 8);
    assert.equal(b.players[0]!.mp, 6);
    assert.equal(b.enemies[0]!.hp, 10);
    b.players[0]!.atb = 100;
    assert.equal(b.command("a", 14, "b", 101), true);
    b.advance(500);
    assert.deepEqual(b.players[1]!.conditionIds, []);
    assert.equal(b.canUse("b", 10, 100), true);
    assert.equal(b.players[0]!.mp, 4);
    return { combatants: b.combatants, events: b.events, action: b.action };
  };
  assert.deepEqual(run([1000]), run(Array(100).fill(10)));
  assert.deepEqual(
    f.players.map((p) => p.conditionIds),
    [[], []],
  );
});
test("the selected command stays attached to an action and is checked again at resolution", () => {
  const f = conditionFixture();
  f.commands[102] = {
    id: 102,
    name: "Alternative",
    kind: "ability",
    abilityIds: [10],
    referencedAbility: null,
    forbiddenConditionIds: [],
  };
  f.players[0]!.commands.push(102);
  f.players[0]!.conditionIds = [301];
  let b = new BattleGame(f, 1);
  assert.equal(b.canUse("a", 10), false); // Ambiguous source command.
  assert.equal(b.canUse("a", 10, 100), false);
  assert.equal(b.canUse("a", 10, 102), true);
  f.abilities[10]!.program.forbiddenConditionIds = [301];
  b = new BattleGame(f, 1);
  assert.equal(b.canUse("a", 10, 102), false); // An alternative command cannot bypass ability restriction.
  b.players[0]!.conditionIds = [];
  assert.equal(b.command("a", 10, "e1", 102), true);
  b.advance(10);
  assert.equal(b.action?.commandId, 102);
  b.players[0]!.conditionIds = [301];
  b.advance(500);
  assert.deepEqual(b.action?.results, []);
  assert.equal(b.enemies[0]!.hp, 10);
});
test("unknown active states and compound status plans never partially spend MP or apply effects", () => {
  const f = conditionFixture();
  f.players[0]!.conditionIds = [302];
  assert.throws(() => new BattleGame(f, 1), /Unimplemented active/);
  f.players[0]!.conditionIds = [];
  f.abilities[15]!.plan!.effects.push({ slot: 2, kind: "magic" });
  const b = new BattleGame(f, 1);
  assert.equal(b.command("a", 15, "b", 101), true);
  assert.throws(() => b.advance(500), /Unimplemented ability effect/);
  assert.equal(b.players[0]!.mp, 8);
  assert.deepEqual(b.players[1]!.conditionIds, []);
});
test("battle-only conditions clear before the party transfers to the field", () => {
  const f = conditionFixture();
  f.players[0]!.conditionIds = [301];
  const b = new BattleGame(f, 1);
  for (const enemy of b.enemies) enemy.hp = 0;
  b.advance(10);
  assert.equal(b.phase, "victory");
  assert.deepEqual(b.takeVictory()!.players[0]!.conditionIds, []);
  assert.deepEqual(f.players[0]!.conditionIds, [301]);
});
test("compound recovery commits both resources once and consumes one action cost", () => {
  const f = fixture();
  const a = f.abilities[11]!;
  a.power = 50;
  a.plan = {
    targeting: {
      relation: "self",
      modes: ["single"],
      defaultMode: "single",
      defaultRelation: "ally",
      normalFormationOnly: false,
      life: "alive",
    },
    physical: null,
    magic: null,
    effects: [
      { slot: 1, kind: "recovery", resource: "hp", calculation: "fixed" },
      { slot: 3, kind: "recovery", resource: "mp", calculation: "fixed" },
    ],
  };
  const run = (parts: number[]) => {
    const b = new BattleGame(f, 7);
    const actor = b.players[0]!;
    actor.hp = 1;
    actor.maxMp = 100;
    actor.mp = 8;
    assert.deepEqual(
      b.targets("a", 11).map((t) => t.id),
      ["a"],
    );
    assert.equal(b.command("a", 11, "b"), false);
    assert.equal(b.command("a", 11, "a"), true);
    for (const part of parts) b.advance(part);
    assert.equal(actor.hp, 51);
    assert.equal(actor.mp, 56); // 8 - one 2 MP cost + 50 MP recovery
    assert.equal(b.events.filter((e) => e.text.includes("恢复")).length, 2);
    return b;
  };
  assert.deepEqual(run([900]).combatants, run(Array(90).fill(10)).combatants);
});
test("invalid commands do not spend turns; unsupported abilities cannot execute", () => {
  const b = new BattleGame(fixture(), 7),
    before = structuredClone(b.combatants);
  for (const args of [
    ["a", 12, "e1"],
    ["a", 10, "b"],
    ["a", 13, "e1"],
    ["unknown", 10, "e1"],
    ["a", 10, "unknown"],
  ] as const)
    assert.equal(b.command(args[0], args[1], args[2]), false);
  assert.deepEqual(b.combatants, before);
  assert.equal(b.command("a", 10, "e1"), true);
  assert.equal(b.command("a", 10, "e2"), false);
});
test("queued attacks retarget a defeated enemy, settle rewards once, and replay across frame partitions", () => {
  const run = (parts: number[]) => {
    const b = new BattleGame(fixture(), 5);
    b.command("a", 10, "e1");
    b.command("b", 10, "e1");
    for (const dt of parts) b.advance(dt);
    return b;
  };
  const a = run([4000]),
    b = run(Array(400).fill(10));
  assert.equal(a.phase, "victory");
  assert.deepEqual(a.combatants, b.combatants);
  assert.deepEqual(a.events, b.events);
  assert.deepEqual(a.reward, b.reward);
  assert.equal(a.reward?.gil, 14);
  assert.equal(a.reward?.each, 9);
  assert.ok(a.enemies.every((e) => e.hp === 0));
  assert.equal(a.takeVictory()?.gil, 14);
  assert.equal(a.takeVictory(), null);
  const after = structuredClone(a.combatants);
  a.advance(5000);
  assert.deepEqual(a.combatants, after);
});
test("healing uses a living ally, consumes MP at execution, and clamps to max HP", () => {
  const f = fixture();
  f.enemies.forEach((e) => (e.agility = 0));
  const b = new BattleGame(f, 7);
  b.players[1]!.hp = 7;
  assert.equal(b.command("a", 11, "b"), true);
  assert.equal(b.players[0]!.mp, 8);
  b.advance(1200);
  assert.equal(b.players[1]!.hp, b.players[1]!.maxHp);
  assert.equal(b.players[0]!.mp, 6);
});
test("enemy actions can defeat the party; defeat never grants victory or rewards", () => {
  const f = fixture();
  f.players.forEach((p) => (p.hp = 1));
  f.enemies.forEach((e) => {
    e.level = 10;
    e.attack = 80;
  });
  f.initialAtb.enemy = [100, 100];
  const b = new BattleGame(f, 20);
  for (let n = 0; n < 5 && b.phase === "active"; n++) b.advance(60000);
  assert.equal(b.phase, "defeat");
  assert.equal(b.reward, null);
  assert.equal(b.takeVictory(), null);
  assert.ok(b.players.every((p) => p.hp === 0));
});

test("group actions reselect living members at impact, and one remaining target gets full damage", () => {
  const f = fixture();
  f.abilities[10]!.plan!.targeting = compileTargetRule(6, 3)!;
  f.abilities[10]!.cost = 2;
  for (const enemy of f.enemies) enemy.hp = 2000;
  const run = (group: boolean, parts: number[]) => {
    const b = new BattleGame(f, 71);
    assert.equal(
      b.command("a", 10, group ? { kind: "side", side: "enemy" } : "e1"),
      true,
    );
    b.advance(10);
    b.enemies[1]!.hp = 0; // Target disappears after selection, before impact.
    for (const part of parts) b.advance(part);
    assert.deepEqual(b.action!.targetIds, ["e1"]);
    assert.equal(b.players[0]!.mp, 6);
    assert.equal(b.enemies[1]!.hp, 0);
    return b;
  };
  const all = run(true, [400]);
  assert.deepEqual(all.action!.results, run(false, [400]).action!.results);
  assert.deepEqual(all.combatants, run(true, Array(40).fill(10)).combatants);
  assert.deepEqual(all.action!.selection, { kind: "side", side: "enemy" });
});

test("multi-target numerical actions use the staged count and cannot bypass scope restrictions", () => {
  const f = fixture();
  f.abilities[10]!.plan!.targeting = compileTargetRule(4, 3)!;
  f.abilities[10]!.cost = 2;
  for (const enemy of f.enemies) enemy.hp = 2000;
  const run = (parts: number[]) => {
    const b = new BattleGame(f, 31);
    assert.equal(b.command("a", 10, "e1"), false); // All-only is not a single attack.
    assert.equal(b.command("a", 10, { kind: "side", side: "player" }), false);
    const selection = { kind: "side" as const, side: "enemy" as const };
    assert.equal(b.command("a", 10, selection), true);
    assert.equal(b.command("a", 10, selection), false);
    for (const part of parts) b.advance(part);
    assert.equal(b.players[0]!.mp, 6);
    assert.deepEqual(
      b.action!.results.map((r) => r.target),
      ["e1", "e2"],
    );
    for (const result of b.action!.results) {
      const effect = result.effects[0]!;
      assert.equal(effect.resource, "hp");
      if (effect.resource === "hp")
        assert.ok(effect.amount > 40 && effect.amount < 80);
    }
    return b;
  };
  assert.deepEqual(run([500]).combatants, run(Array(50).fill(10)).combatants);
});

test("a later target failure rolls back every result, resource and random draw", () => {
  const f = fixture();
  f.abilities[10]!.plan!.targeting = compileTargetRule(4, 3)!;
  f.abilities[10]!.cost = 2;
  for (const enemy of f.enemies) enemy.hp = 2000;
  const setup = () => {
    const b = new BattleGame(f, 9);
    assert.equal(b.command("a", 10, { kind: "side", side: "enemy" }), true);
    b.advance(10);
    return b;
  };
  const b = setup();
  const before = b.combatants.map((c) => ({
    id: c.id,
    hp: c.hp,
    mp: c.mp,
    conditionIds: c.conditionIds,
  }));
  const events = structuredClone(b.events);
  b.enemies[1]!.magicDefense = 256;
  assert.throws(() => b.advance(400), /outside supported/);
  assert.deepEqual(
    b.combatants.map((c) => ({
      id: c.id,
      hp: c.hp,
      mp: c.mp,
      conditionIds: c.conditionIds,
    })),
    before,
  );
  assert.deepEqual(b.events, events);
  assert.deepEqual(b.action!.results, []);
  assert.equal(b.action!.resolved, false);
  b.enemies[1]!.magicDefense = 30;
  b.advance(10);
  const control = setup();
  control.advance(410);
  assert.deepEqual(b.action!.results, control.action!.results);
  assert.deepEqual(b.combatants, control.combatants);
});

test("all-party compound recovery applies cost once before self MP recovery", () => {
  const f = fixture();
  const a = f.abilities[11]!;
  a.power = 50;
  a.plan = {
    targeting: compileTargetRule(2, 1)!,
    physical: null,
    magic: null,
    effects: [
      { slot: 1, kind: "recovery", resource: "hp", calculation: "fixed" },
      { slot: 3, kind: "recovery", resource: "mp", calculation: "fixed" },
    ],
  };
  const b = new BattleGame(f, 1);
  for (const player of b.players) {
    player.hp = 1;
    player.maxMp = 100;
  }
  assert.equal(b.command("a", 11, { kind: "side", side: "player" }), true);
  b.advance(500);
  assert.deepEqual(
    b.players.map((p) => [p.hp, p.mp]),
    [
      [51, 56],
      [51, 58],
    ],
  );
  assert.equal(b.action!.results.length, 2);
  b.advance(390);
  assert.deepEqual(
    b.players.map((p) => [p.hp, p.mp]),
    [
      [51, 56],
      [51, 58],
    ],
  );
});

test("group status effects keep individual resistance and recover individual identities", () => {
  const f = conditionFixture();
  f.abilities[15]!.plan!.targeting = compileTargetRule(4, 5)!;
  f.abilities[14]!.plan!.targeting = compileTargetRule(4, 1)!;
  f.enemies[1]!.conditionResistances = { 301: 1 };
  const b = new BattleGame(f, 19);
  assert.equal(b.command("a", 15, { kind: "side", side: "enemy" }, 101), true);
  b.advance(500);
  assert.deepEqual(
    b.enemies.map((e) => e.conditionIds),
    [[301], []],
  );
  assert.deepEqual(
    b.action!.results.map((r) => r.effects[0]!.missed),
    [false, true],
  );
  assert.equal(b.players[0]!.mp, 6);
  b.advance(410);
  b.players[0]!.atb = 100;
  assert.equal(b.command("a", 14, { kind: "side", side: "enemy" }, 101), true);
  b.advance(500);
  assert.deepEqual(
    b.enemies.map((e) => e.conditionIds),
    [[], []],
  );
  assert.equal(b.players[0]!.mp, 4);
});

function revivalFixture() {
  const f = conditionFixture();
  f.players.push({
    ...structuredClone(f.players[0]!),
    id: "c",
    name: "Third ally",
  });
  f.players[1]!.conditionIds = [305];
  f.enemies.forEach((e) => {
    e.hp = 5000;
    e.agility = 0;
  });
  f.abilities[16] = {
    ...structuredClone(f.abilities[11]!),
    id: 16,
    name: "Revive",
    cost: 2,
    wait: 0,
    plan: {
      effects: [
        { slot: 1, kind: "recover-condition", conditionIds: [305] },
        { slot: 2, kind: "recover-max-hp", mode: "divide", value: 8 },
      ],
      targeting: {
        ...compileTargetRule(7, 1)!,
        life: "include-fallen-players",
      },
      magic: null,
      physical: null,
    },
  };
  for (const p of f.players) p.abilities.push(16);
  f.commands[101]!.abilityIds.push(16);
  return f;
}

test("revival includes fallen players, restores exact ratio and derives dying", () => {
  const f = revivalFixture(),
    b = new BattleGame(f, 41);
  const fallen = b.players[1]!;
  assert.equal(fallen.hp, 0);
  assert.equal(fallen.maxHp, 80);
  assert.equal(fallen.atb, 0);
  assert.equal(
    b.targets("a", 11).some((c) => c.id === "b"),
    false,
  );
  assert.equal(
    b.targets("a", 16).some((c) => c.id === "b"),
    true,
  );
  assert.equal(b.command("b", 16, "b"), false);
  assert.equal(b.command("a", 16, "b"), true);
  b.advance(410);
  assert.equal(fallen.hp, 10);
  assert.deepEqual(fallen.conditionIds, [304]);
  assert.ok(fallen.atb > 0 && fallen.atb < 1); // Revival resets, then this frame advances the gauge.
  assert.equal(fallen.queued, false);
  assert.equal(b.players[0]!.mp, 6);
  assert.deepEqual(
    b.action!.results[0]!.effects.map((e) => e.missed),
    [false, false],
  );
  b.advance(500);
  assert.equal(b.phase, "active");
  assert.deepEqual(f.players[1]!.conditionIds, [305]);
});

test("two queued revivals retain their target; the later miss cannot heal a living unit", () => {
  const run = (partition: number[]) => {
    const b = new BattleGame(revivalFixture(), 17);
    b.command("a", 16, "b");
    b.command("c", 16, "b");
    for (const dt of partition) b.advance(dt);
    assert.equal(b.players[1]!.hp, 10);
    assert.equal(b.players[0]!.mp, 6);
    assert.equal(b.players[2]!.mp, 6);
    assert.deepEqual(b.action!.targetIds, ["b"]);
    assert.ok(b.action!.results[0]!.effects.every((e) => e.missed));
    return { units: b.combatants, events: b.events, action: b.action };
  };
  assert.deepEqual(run([1320]), run(Array(132).fill(10)));
});

test("lethal damage cancels a charged action and revival cannot resurrect that command", () => {
  const f = revivalFixture();
  f.players[1]!.conditionIds = [301];
  f.commands[100]!.forbiddenConditionIds = [];
  f.abilities[10]!.wait = 100;
  f.abilities[17] = { ...structuredClone(f.abilities[10]!), id: 17, wait: 0 };
  f.abilities[17]!.plan!.targeting = compileTargetRule(7, 3)!;
  f.players[0]!.abilities.push(17);
  f.commands[100]!.abilityIds.push(17);
  const b = new BattleGame(f, 71),
    target = b.players[1]!;
  target.hp = 1;
  assert.equal(b.command("b", 10, "e1"), true);
  assert.equal(b.command("a", 17, "b"), true);
  b.advance(410);
  assert.equal(target.hp, 0);
  assert.deepEqual(target.conditionIds, [305]);
  assert.equal(target.atb, 0);
  assert.equal(target.queued, false);
  assert.equal(target.mp, 8);
  assert.equal(b.command("c", 16, "b"), true);
  b.advance(910);
  assert.equal(target.hp, 10);
  assert.ok(target.atb > 0 && target.atb < 1);
  assert.equal(target.queued, false);
  assert.ok(!b.events.some((e) => e.text === "Second ally · Beam"));
});

test("death persists after victory and battle reentry, without receiving experience", () => {
  const f = revivalFixture(),
    b = new BattleGame(f, 12);
  for (const enemy of b.enemies) enemy.hp = 0;
  b.advance(10);
  assert.equal(b.phase, "victory");
  assert.ok(!b.reward!.recipients.includes("b"));
  const result = b.takeVictory()!;
  assert.deepEqual(result.players[1]!.conditionIds, [305]);
  assert.equal(result.players[1]!.hp, 0);
  const next = new BattleGame(f, 13, result.players);
  assert.equal(next.players[1]!.hp, 0);
  assert.equal(next.players[1]!.atb, 0);
  assert.equal(next.canUse("b", 16), false);
  assert.equal(b.takeVictory(), null);
});

test("invalid revival dependency rolls back HP, conditions, cost and queued state", () => {
  const f = revivalFixture(),
    b = new BattleGame(f, 1);
  b.command("a", 16, "b");
  b.advance(400);
  const before = structuredClone(b.combatants);
  const restore = f.abilities[16]!.plan!.effects[1]!;
  if (restore.kind !== "recover-max-hp") assert.fail();
  restore.value = 0;
  assert.throws(() => b.advance(10), /Invalid revival/);
  assert.deepEqual(b.combatants, before);
  assert.deepEqual(b.action!.results, []);
  assert.equal(b.action!.resolved, false);
});
