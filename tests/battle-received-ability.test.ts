import test from "node:test";
import assert from "node:assert/strict";
import {
  planBattleAIReaction,
  planBattleAITurn,
  startBattleAI,
  type BattleAIContext,
} from "../src/core/battle-ai.js";
import { BattleGame } from "../src/core/battle.js";
import { battleReaction } from "../src/core/battle-reactions.js";
import { initialEnemyBehavior } from "../src/core/enemy-behavior.js";
import { GameSession } from "../src/core/game-session.js";
import { compileTargetRule } from "../src/compiler/battle-targets.js";
import { fixture } from "./fixtures/battle-content.js";
import { syntheticAI } from "./fixtures/battle-ai.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";

function context(): BattleAIContext {
  return {
    self: { hp: 100, mp: 10, monsterId: 1, behavior: initialEnemyBehavior() },
    conditionIds: [],
    players: [{ level: 1 }],
    enemies: [{ level: 2 }],
  };
}

function receivedProgram() {
  return syntheticAI([
    ["Nop"],
    ["SyncAI"],
    ["StartTable", [0]],
    ["IsRecevieAbility", [501, 8]],
    ["VariableAssign", [0, 1]],
    ["Act", [601]],
    ["EndTable"],
    ["JumpBattleAI", [0]],
    ["Nop"],
    ["VariableAssign", [0, 2]],
    ["IsRecevieAbilitySystem", [9, 14]],
    ["VariableAssign", [1, 3]],
    ["CounterAct", [602]],
    ["JumpBattleAI", [0]],
    ["Nop"],
    ["VariableAssign", [1, 4]],
    ["CounterAct", [603]],
    ["JumpBattleAI", [0]],
  ]);
}

test("source received ability predicates use exact id/system on hit and miss, without a living gate", () => {
  const program = receivedProgram();
  for (const [id, system, counterReady, hp, expectedPc, marker] of [
    [501, 9, true, 100, 16, [2, 4]],
    [501, 8, true, 100, 12, [2, 3]],
    [501, 9, false, 100, null, [2, 4]],
    [501, 9, true, 0, null, [2, 4]],
    [502, 9, true, 100, null, [1, 0]],
  ] as const) {
    const ctx = context();
    ctx.self.hp = hp;
    const initial = startBattleAI(program, ctx);
    const original = structuredClone(initial);
    const result = planBattleAIReaction(program, initial.state, ctx, {
      counterReady,
      receivedAbilityId: id,
      receivedSystemId: system,
    });
    assert.deepEqual(result.behavior.variables.slice(0, 2), marker);
    assert.deepEqual(
      result.acts.map((a) => a.pc),
      expectedPc ? [expectedPc] : [],
    );
    assert.equal(result.state.receivedAbility, null);
    assert.equal(result.state.actTurn, 0);
    assert.deepEqual(initial, original);
    assert.deepEqual(ctx.self.behavior, initialEnemyBehavior());
    if (id === 501) {
      assert.ok(result.visited.includes(9));
      assert.ok(
        !result.visited.includes(8),
        "native branch resumes after its label",
      );
    }
  }
});

test("SyncAI consumes receiver metadata before the following normal turn or another receiver", () => {
  const ctx = context(),
    program = receivedProgram();
  const initial = startBattleAI(program, ctx);
  const reaction = planBattleAIReaction(program, initial.state, ctx, {
    counterReady: true,
    receivedAbilityId: 501,
    receivedSystemId: 9,
  });
  ctx.self.behavior = reaction.behavior;
  const normal = planBattleAITurn(
    program,
    JSON.parse(JSON.stringify(reaction.state)),
    ctx,
  );
  assert.deepEqual(
    normal.acts.map((a) => a.abilities),
    [[601]],
  );
  assert.equal(normal.behavior.variables[0], 1);
  assert.equal(normal.state.receivedAbility, null);
  assert.equal(reaction.behavior.variables[0], 2);
  const other = planBattleAIReaction(program, reaction.state, ctx, {
    counterReady: true,
    receivedAbilityId: 502,
    receivedSystemId: 9,
  });
  assert.equal(other.behavior.variables[0], 1);
  assert.deepEqual(other.acts, []);
  assert.throws(
    () =>
      planBattleAITurn(
        program,
        {
          ...reaction.state,
          receivedAbility: { id: 501, systemId: 9 },
        },
        ctx,
      ),
    /SyncAI retained received ability/,
  );
});

test("absent received ability queries return zero during initialization and normal readiness", () => {
  for (const mnemonic of ["IsRecevieAbility", "IsRecevieAbilitySystem"]) {
    const initialization = syntheticAI([
      [mnemonic, [0, 2]],
      ["UnreachableWithoutAbility"],
      ["Nop"],
      ["SyncAI"],
    ]);
    assert.equal(startBattleAI(initialization, context()).state.pc, 3);
    const normal = syntheticAI([
      ["Nop"],
      ["SyncAI"],
      [mnemonic, [0, 4]],
      ["UnreachableWithoutAbility"],
      ["Nop"],
      ["StartTable", [0]],
      ["Act", [601]],
      ["EndTable"],
      ["JumpBattleAI", [0]],
    ]);
    const initial = startBattleAI(normal, context());
    assert.deepEqual(
      planBattleAITurn(normal, initial.state, context()).acts[0]!.abilities,
      [601],
    );
  }
});

test("received predicates preserve unsupported operand blockers and reject absent reaction identity", () => {
  for (const mnemonic of ["IsRecevieAbility", "IsRecevieAbilitySystem"]) {
    for (const [ints, reals, strings] of [
      [[1], [], []],
      [[1, 99], [], []],
      [[1, 0, 1], [], []],
      [[1, 0], [1], []],
      [[1, 0], [], ["unknown"]],
    ] as const) {
      const program = syntheticAI([
        [mnemonic, [...ints], [...reals], [...strings]],
      ]);
      assert.equal(program.instructions[0]!.op.kind, "blocked");
    }
    const negative = syntheticAI([[mnemonic, [-1, 0]], ["SyncAI"]]);
    assert.equal(negative.instructions[0]!.op.kind, "received-ability-branch");
    assert.equal(startBattleAI(negative, context()).state.pc, 1);
  }
  const program = receivedProgram(),
    initial = startBattleAI(program, context());
  for (const id of [0, -1, NaN, 0x80000000])
    assert.throws(() =>
      planBattleAIReaction(program, initial.state, context(), {
        counterReady: false,
        receivedAbilityId: id,
        receivedSystemId: 3,
      }),
    );
});

function receiverFixture() {
  const f = fixture();
  f.players.forEach((p) => {
    p.hp = 2000;
  });
  f.enemies.forEach((e) => {
    e.hp = 2000;
    e.ai = syntheticAI([
      ["Nop"],
      ["SyncAI"],
      ["StartTable", [0]],
      ["IsRecevieAbility", [10, 8]],
      ["VariableAssign", [0, 0]],
      ["Act", [13]],
      ["EndTable"],
      ["JumpBattleAI", [0]],
      ["Nop"],
      ["ValueCalc", [0, 1], [], ["＋"]],
      ["CounterAct", [13]],
      ["JumpBattleAI", [0]],
    ]);
  });
  return f;
}

test("battle receivers isolate enemy state and clear metadata without consuming a normal turn", () => {
  for (const missed of [false, true]) {
    const f = receiverFixture();
    if (missed) {
      f.abilities[10]!.plan!.magic!.contentFlags = [];
      f.abilities[10]!.plan!.magic!.accuracy = 0;
    }
    const battle = new BattleGame(f, 487);
    assert.ok(battle.command("a", 10, "e1"));
    battle.advance(410);
    assert.equal(battle.enemies[0]!.behavior!.variables[0], 1);
    assert.equal(battle.enemies[1]!.behavior!.variables[0], 0);
    assert.equal(
      battle.pendingActions.filter((a) => a.kind === "counter").length,
      missed ? 0 : 1,
    );
    const state = battle.enemyAIState("e1")!;
    assert.equal(state.receivedAbility, null);
    assert.equal(state.actTurn, 0);
    state.receivedAbility = { id: 999, systemId: 8 };
    state.actTurn = 99;
    assert.equal(battle.enemyAIState("e1")!.receivedAbility, null);
    assert.equal(battle.enemyAIState("e1")!.actTurn, 0);
    battle.advance(missed ? 500 : 1410);
    battle.enemies[0]!.atb = 100;
    battle.advance(10);
    assert.equal(battle.action!.source.id, 13);
    assert.equal(battle.action!.kind, "normal");
    assert.equal(battle.enemies[0]!.behavior!.variables[0], 0);
  }
});

test("an unsupported second-target received branch rolls back effects, both receivers, queue and RNG", () => {
  const f = receiverFixture();
  f.abilities[10]!.plan!.targeting = compileTargetRule(4, 1)!;
  f.abilities[10]!.cost = 2;
  const clean = new BattleGame(structuredClone(f), 491);
  const broken = new BattleGame(f, 491);
  for (const battle of [clean, broken])
    assert.ok(battle.command("a", 10, { kind: "side", side: "enemy" }));
  // The AI copy is owned by BattleGame. Corrupt only a dependency reached on
  // e2's new receiver path after construction, so e1 has already been planned.
  const instruction = broken.enemies[1]!.ai!.instructions[10]!;
  const original = instruction.op;
  instruction.op = {
    kind: "blocked",
    reason: "controlled unimplemented receiver dependency",
  };
  broken.advance(10);
  const before = {
    resources: broken.combatants.map((c) => [c.hp, c.mp]),
    states: broken.enemies.map((c) => broken.enemyAIState(c.id)),
    behavior: structuredClone(broken.enemies.map((c) => c.behavior)),
    events: structuredClone(broken.events),
  };
  assert.throws(() => broken.advance(400), /unimplemented receiver dependency/);
  assert.deepEqual(
    broken.combatants.map((c) => [c.hp, c.mp]),
    before.resources,
  );
  assert.deepEqual(
    broken.enemies.map((c) => broken.enemyAIState(c.id)),
    before.states,
  );
  assert.deepEqual(
    broken.enemies.map((c) => c.behavior),
    before.behavior,
  );
  assert.deepEqual(broken.events, before.events);
  assert.deepEqual(broken.pendingActions, []);
  assert.equal(broken.action!.resolved, false);
  instruction.op = original;
  broken.advance(10);
  clean.advance(420);
  assert.deepEqual(broken.action, clean.action);
  assert.deepEqual(broken.pendingActions, clean.pendingActions);
  assert.deepEqual(broken.combatants, clean.combatants);
  assert.deepEqual(
    broken.enemies.map((c) => broken.enemyAIState(c.id)),
    clean.enemies.map((c) => clean.enemyAIState(c.id)),
  );
});

test("received ability routing replays under frame partitioning and a fresh battle restart", () => {
  const f = receiverFixture();
  const run = (parts: number[]) => {
    const b = new BattleGame(f, 499);
    assert.ok(b.command("a", 10, "e1"));
    assert.ok(b.command("b", 10, "e2"));
    for (const dt of parts) b.advance(dt);
    return {
      combatants: b.combatants,
      events: b.events,
      states: b.enemies.map((c) => b.enemyAIState(c.id)),
      action: b.action,
      pending: b.pendingActions,
    };
  };
  const once = run([6000]);
  assert.deepEqual(run(Array(600).fill(10)), once);
  assert.deepEqual(run([6000]), once);
});

test("reaction classification preserves ability identity even on a miss without fabricating receiver zero", () => {
  const input = {
    actor: "a",
    target: "b",
    isCounter: false,
    abilityId: 501,
    systemId: 9,
    primarySlot: 1,
    effects: [
      {
        slot: 1,
        resource: "hp" as const,
        recovery: false,
        missed: true,
        amount: 0,
      },
    ],
  };
  assert.deepEqual(
    battleReaction({ counterLimit: 1, excludedAbilityIds: [] }, input),
    {
      counterReady: false,
      receivedAbilityId: 501,
      receivedSystemId: 9,
    },
  );
  for (const id of [0, -1, NaN, 0x80000000])
    assert.throws(
      () =>
        battleReaction(
          { counterLimit: 1, excludedAbilityIds: [] },
          { ...input, abilityId: id },
        ),
      /ability identity/,
    );
});

test("GameSession defeat retry and stable checkpoint replay start clean receiver contexts", () => {
  const f = checkpointFixture(),
    receiver = receiverFixture();
  f.battle.encounters[1000]!.enemies = receiver.enemies;
  f.battle.common.players = receiver.players;
  const game = new GameSession(f.field, f.battle, 503);
  const checkpoint = game.checkpoint();
  const restored = GameSession.restore(
    JSON.parse(JSON.stringify(checkpoint)),
    f.field,
    f.battle,
  );
  for (const session of [game, restored]) {
    session.field.startEvent("fight");
    session.advance(10);
    assert.ok(session.battle);
    assert.throws(() => session.checkpoint(), /Cannot save/);
  }
  const act = (session: GameSession) => {
    const battle = session.battle!;
    assert.equal(battle.enemyAIState("e1")!.receivedAbility, null);
    assert.ok(battle.command("a", 10, "e1"));
    session.advance(410);
    assert.equal(battle.enemies[0]!.behavior!.variables[0], 1);
    return structuredClone({
      combatants: battle.combatants,
      events: battle.events,
      states: battle.enemies.map((c) => battle.enemyAIState(c.id)),
      action: battle.action,
      pending: battle.pendingActions,
    });
  };
  const first = act(game);
  assert.deepEqual(act(restored), first);
  const entry = game.state.snapshot();
  for (const player of game.battle!.players) player.hp = 0;
  game.advance(510);
  assert.equal(game.battle!.phase, "defeat");
  assert.ok(game.retryBattle());
  assert.deepEqual(game.state.snapshot(), entry);
  assert.equal(game.battle!.enemies[0]!.behavior!.variables[0], 0);
  assert.equal(game.battle!.enemyAIState("e1")!.receivedAbility, null);
  assert.deepEqual(game.battle!.pendingActions, []);
  assert.deepEqual(act(game), first);
});
