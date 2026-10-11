import test from "node:test";
import assert from "node:assert/strict";
import { BattleGame } from "../src/core/battle.js";
import { fixture } from "./fixtures/battle-content.js";
import { syntheticAI } from "./fixtures/battle-ai.js";

const running = {
  paused: false,
  helpPaused: false,
  progressEnabled: true,
  uiWaiting: false,
  forceWaiting: false,
};
function setup(mode: "active" | "wait" = "active", atbSpeed = 1) {
  const content = fixture();
  content.timing = { mode, atbSpeed };
  content.enemies.forEach((e) => {
    e.hp = 9999;
  });
  const battle = new BattleGame(content, 91);
  return { content, battle };
}

test("other gauges and queued chanting continue during action presentation", () => {
  const { battle } = setup();
  battle.players[1]!.atb = 0;
  assert.equal(battle.command("a", 10, "e1"), true);
  battle.advance(10);
  const before = battle.players[1]!.atb;
  battle.advance(200);
  assert.equal(battle.action?.actor, "a");
  assert.equal(battle.action?.elapsed, 200);
  assert.ok(battle.players[1]!.atb > before);
  assert.ok(battle.enemies[0]!.atb > 0);
});

test("chanting stores fractional seconds and can become ready behind an executing action", () => {
  const { content, battle } = setup("active", 2);
  content.abilities[11]!.wait = 1;
  battle.command("a", 10, "e1");
  battle.command("b", 11, "b");
  assert.equal(
    battle.pendingActions.find((a) => a.actor === "b")!.charge,
    0.25,
  );
  battle.advance(100);
  assert.ok(battle.pendingActions.find((a) => a.actor === "b")!.charge > 0);
  battle.advance(30);
  assert.ok(battle.pendingActions.find((a) => a.actor === "b")!.charge < 0);
  assert.equal(battle.action?.actor, "a");
});

test("source Interrupt counters bypass chanting even for enemy ability types 15/16", () => {
  // SetActAbilityCounter 0x15b8550 selects ActType=1. ActDecision
  // 0x1587aa0 sends it directly to SetBattleActData 0x15ace70, bypassing
  // Progress.SetActData/GetChantingTime regardless of the ability's wait.
  for (const type of [15, 16]) {
    const content = fixture();
    content.players.forEach((p) => {
      p.hp = 2000;
    });
    content.enemies.forEach((e) => {
      e.hp = 2000;
      e.ai = syntheticAI([
        ["Nop"],
        ["SyncAI"],
        ["StartTable", [0]],
        ["Act", [13]],
        ["CounterAct", [13]],
        ["EndTable"],
        ["JumpBattleAI", [0]],
      ]);
    });
    content.abilities[13]!.program.rules.type_id = type;
    content.abilities[13]!.wait = 1;
    const battle = new BattleGame(content, 359);
    assert.equal(battle.command("a", 10, "e1"), true);
    assert.equal(battle.command("b", 10, "e2"), true);
    battle.advance(410);
    const counter = battle.pendingActions.find((a) => a.kind === "counter")!;
    assert.equal(counter.charge, 0, `type ${type} interrupt is ready`);
    battle.advance(510);
    assert.equal(battle.action?.kind, "counter");
    assert.equal(battle.action?.actor, "e1");
    battle.advance(910);
    assert.ok(battle.players[0]!.hp < 2000);
    assert.equal(battle.action?.kind, "normal");
    assert.equal(battle.action?.actor, "b", "the ordinary queue resumes");
  }
});

test("WAIT menu input freezes progress but does not suspend a running action", () => {
  const { battle } = setup("wait");
  battle.players[1]!.atb = 0;
  battle.command("a", 10, "e1");
  battle.advance(10);
  const atb = battle.combatants.map((p) => p.atb);
  battle.setClockInput({ ...running, uiWaiting: true });
  battle.advance(500);
  assert.equal(battle.action?.elapsed, 500);
  assert.equal(battle.action?.resolved, true);
  assert.deepEqual(
    battle.combatants.map((p) => p.atb),
    atb,
  );
  battle.setClockInput(running);
  battle.advance(10);
  assert.ok(battle.players[1]!.atb > atb[1]!);
});

test("pause and help pause discard wall time; active mode ignores ordinary menu waiting", () => {
  const { battle } = setup();
  battle.players[1]!.atb = 0;
  battle.command("a", 10, "e1");
  battle.advance(10);
  const before = {
    action: structuredClone(battle.action),
    units: structuredClone(battle.combatants),
    time: battle.time,
  };
  for (const input of [
    { ...running, paused: true },
    { ...running, helpPaused: true },
  ]) {
    battle.setClockInput(input);
    battle.advance(1000);
    assert.deepEqual(
      { action: battle.action, units: battle.combatants, time: battle.time },
      before,
    );
  }
  battle.setClockInput({ ...running, uiWaiting: true });
  battle.advance(10);
  assert.equal(battle.time, 20);
  assert.ok(battle.players[1]!.atb > before.units[1]!.atb);
});

test("clock inputs and fractional charging replay independently of render batching", () => {
  const run = (parts: number[]) => {
    const { content, battle } = setup();
    content.abilities[11]!.wait = 1;
    battle.command("a", 10, "e1");
    battle.command("b", 11, "b");
    for (const ms of parts) battle.advance(ms);
    return {
      units: battle.combatants,
      action: battle.action,
      queue: battle.pendingActions,
      events: battle.events,
    };
  };
  assert.deepEqual(run([1345]), run([3, 102, 40, 1000, 200]));
});
