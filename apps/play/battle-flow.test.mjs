import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Battle } from "../../src/play/battle.js";
import { BattleFlow } from "./battle-flow.js";

const data = JSON.parse(
  await readFile(new URL("../../build/web-data/battle.json", import.meta.url)),
);
function fixture(encounterId = 3) {
  const music = [],
    emitted = [];
  const audio = {
    current: { id: 12 },
    position: () => 21.25,
    playMusic(id, options) {
      music.push({ id, ...options });
      this.current = id ? { id } : null;
    },
  };
  const flow = new BattleFlow({ audio, emit: (event) => emitted.push(event) });
  const party = [1, 31, 32].map((id) => structuredClone(data.characters[id]));
  let battle;
  battle = new Battle({
    data,
    party,
    encounterId,
    random: () => 0.5,
    event: (kind, payload) => flow.event({ kind, ...payload }, battle),
    onEnd: (result) => flow.event({ kind: "battle-end", ...result }, battle),
  });
  flow.event({ kind: "battle" }, battle);
  return { flow, battle, music, emitted };
}
const step = (flow, seconds, options) => {
  for (let t = 0; t < seconds; t += 0.05) flow.update(0.05, options);
};
test("battle music, real rewards and victory remain visible until confirmation, then restore the field track position", () => {
  const { flow, battle, music } = fixture();
  assert.equal(music[0].id, data.parties[3].bgmId);
  const beforeExp = battle.players[0].exp || 0;
  for (const enemy of battle.enemies) enemy.hp = 0;
  for (let i = 0; i < 100 && !battle.result; i++) battle.tick(0.1);
  assert(battle.result, "real battle must settle");
  const settledExp = battle.players[0].exp;
  const exp = battle.result.exp;
  assert(flow.busy);
  assert.equal(flow.confirm(), false, "cannot skip the last hit/victory by confirming early");
  step(flow, 2);
  assert.equal(flow.phase, "result");
  assert.equal(music.at(-1).id, data.limits.BGM_BATTLE_WIN);
  assert.equal(flow.result.exp, exp);
  assert.equal(flow.result.players[0].exp, settledExp - beforeExp);
  step(flow, 20);
  assert.equal(flow.phase, "result", "manual results never disappear on a timer");
  assert.equal(battle.players[0].exp, settledExp, "presentation must not re-grant rewards");
  assert.equal(flow.confirm(), true);
  assert.equal(flow.busy, false);
  assert.deepEqual(music.at(-1), { id: 12, offset: 21.25, restart: true });
});
test("one multi-target spell shares one banner; a repeated cast is a separate animation; no engine time advances", () => {
  const { flow, battle, emitted } = fixture();
  const ability = { ...data.abilities[40], power: 1 };
  const sequence = {};
  for (const enemy of battle.enemies)
    battle.perform(battle.players[0], enemy, ability, 2, { sequence });
  battle.perform(battle.players[0], battle.enemies[0], ability, 1, { sequence: {} });
  assert.equal(flow.queue.length, 2);
  assert.equal(flow.queue[0].events.length, 2);
  const elapsed = battle.elapsed,
    ready = battle.players.map((u) => u.atb);
  flow.update(0.01);
  assert.equal(flow.banner, ability.name);
  assert.equal(emitted.length, 0, "the name precedes the effect");
  step(flow, 0.3);
  assert.equal(emitted.length, 2);
  assert.equal(flow.queue.length, 1);
  step(flow, 4);
  assert.equal(emitted.length, 3);
  assert.equal(flow.busy, false);
  assert.equal(battle.elapsed, elapsed);
  assert.deepEqual(
    battle.players.map((u) => u.atb),
    ready,
  );
});
test("escape has no victory result/cue; a PR zero music formation preserves the scene music", () => {
  const { flow, battle, music } = fixture(
    Object.values(data.parties).find((p) => p.bgmId === 0).id,
  );
  assert.deepEqual(music, []);
  flow.event({ kind: "battle-end", outcome: "escape", exp: 0, gil: 0, ap: 0, drops: [] }, battle);
  step(flow, 2);
  assert.equal(flow.phase, "idle");
  assert(!music.some((row) => row.id === data.limits.BGM_BATTLE_WIN));
  assert.equal(music.at(-1).id, 12);
});
test("automatic regression dismisses a real result and an unfinished field audio request is remembered", () => {
  const { flow, battle } = fixture();
  flow.reset();
  flow.audio.current = null;
  flow.audioCommand({ name: "PlayBGM", i: [25] });
  flow.begin(battle);
  assert.deepEqual(flow.previousMusic, { id: 25, offset: 0 });
  for (const enemy of battle.enemies) enemy.hp = 0;
  for (let i = 0; i < 100 && !battle.result; i++) battle.tick(0.1);
  assert(battle.result, "real battle must settle");
  step(flow, 4, { auto: true });
  assert.equal(flow.phase, "idle");
  assert.equal(flow.audio.current.id, 25);
});

test("opening AI actions emitted before the host publishes the battle are not silently lost", () => {
  const { flow, battle, emitted } = fixture();
  flow.reset();
  battle.perform(battle.enemies[0], battle.players[0], data.abilities[1]);
  assert.equal(flow.openingEvents.length, 1);
  flow.begin(battle);
  step(flow, 2);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].actorSide, "enemy");
});
