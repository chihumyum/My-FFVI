import test from "node:test";
import assert from "node:assert/strict";
import { encodeAcceptanceState, decodeAcceptanceState } from "./acceptance-state.js";

test("diagnostic checkpoint preserves live VM/actor/battle identity without getters or source copies", () => {
  class Battle {
    target() {
      return this.players[0];
    }
  }
  const data = { programs: { 1: { ops: [["Message"]] } } },
    actor = { id: -1, motion: { progress: 0.4 } },
    task = { pc: 7 },
    battle = new Battle();
  const state = {
    data,
    player: actor,
    actors: new Map([["-1", actor]]),
    tasks: [task],
    dialogue: { task },
    groups: new Set(["event"]),
    battle,
    infinity: -Infinity,
    absent: undefined,
  };
  battle.players = [actor];
  battle.owner = state;
  Object.defineProperty(state, "party", {
    enumerable: true,
    get() {
      throw Error("Getter must not run");
    },
  });
  const graph = encodeAcceptanceState(state, { data });
  const restored = decodeAcceptanceState(
    JSON.parse(JSON.stringify(graph)),
    { data },
    { Battle: Battle.prototype },
  );
  assert.equal(restored.data, data);
  assert.equal(restored.player, restored.actors.get("-1"));
  assert.equal(restored.dialogue.task, restored.tasks[0]);
  assert.equal(restored.battle.owner, restored);
  assert.equal(restored.battle.target(), restored.player);
  assert.equal(restored.tasks[0].pc, 7);
  assert.equal(restored.player.motion.progress, 0.4);
  assert.equal(restored.infinity, -Infinity);
  assert.deepEqual([...restored.groups], ["event"]);
  assert.ok(!Object.hasOwn(restored, "party"));
  assert.equal(actor.motion.progress, 0.4);
  assert.throws(() => decodeAcceptanceState(graph), /Missing checkpoint source/);
});
