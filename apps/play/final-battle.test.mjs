import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { FinalBattlePresentation, isFinalTowerEvent } from "./final-battle.js";
import { BattleFlow } from "./battle-flow.js";

const data = JSON.parse(
  await readFile(new URL("../../build/web-data/battle.json", import.meta.url)),
);
const program = data.eventPrograms.sc_b_2022;
const fixture = () => ({
  formation: data.parties[472],
  elapsed: 10,
  players: [{ hp: 9999, atb: 60, conditions: [] }],
  enemies: [{ hp: 30000, atb: 20, conditions: [] }],
  events: { program, paused: false, interactive: true, state: {} },
  log: [],
  data,
});

test("all three real final-battle source scroll cues animate continuously through their authored waits", () => {
  const battle = fixture(),
    controller = new FinalBattlePresentation();
  controller.sample(battle);
  const originalUnits = structuredClone([battle.players, battle.enemies]);
  let previous = 0;
  for (const pc of [31, 52, 71]) {
    const [op, , , names] = program.ops[pc];
    assert.equal(op, "SysCall");
    const name = names[0];
    assert(isFinalTowerEvent({ name }));
    const waits = program.ops.slice(pc + 1, pc + 7).filter((row) => row[0] === "Wait");
    const duration = waits.reduce((sum, row) => sum + row[2][0], 0);
    assert.equal(duration, 3.5);
    controller.event({ name, time: battle.elapsed });
    assert(
      Math.abs(controller.sample(battle).offset - previous) < 1e-10,
      "scroll must not jump to next still",
    );
    const samples = [];
    for (let n = 1; n <= 7; n++) {
      battle.elapsed += 0.5;
      samples.push(controller.sample(battle));
    }
    assert(samples.every((row, n) => row.offset > (n ? samples[n - 1].offset : previous)));
    assert(Math.abs(samples.at(-1).progress - 1) < 1e-12);
    previous = samples.at(-1).offset;
    assert.deepEqual(
      [battle.players, battle.enemies],
      originalUnits,
      "presentation cannot change combat",
    );
    battle.elapsed += 1.4;
  }
  assert.equal(
    Math.round(previous),
    data.backgrounds[50].sprite.height - 216,
    "last ascent reaches the source golden ceiling",
  );
  assert.equal(controller.sample(battle).round, 4);
});

test("source shake stops, frozen game time freezes the scroll, and another battle clears the transform", () => {
  const battle = fixture(),
    controller = new FinalBattlePresentation();
  controller.sample(battle);
  controller.event({ name: "LB:画面揺れ再生", time: 10 });
  controller.event({ name: "LB:背景スクロールラウンド2", time: 10 });
  battle.elapsed = 11;
  const frame = controller.sample(battle);
  assert(frame.shaking && frame.offset > 0 && frame.offset < 144);
  assert.deepEqual(
    controller.sample(battle),
    frame,
    "paused source time cannot continue a wall-clock animation",
  );
  controller.event({ name: "LB:画面揺れ停止", time: 11 });
  assert.equal(controller.sample(battle).shaking, false);
  const ordinary = { ...battle, formation: data.parties[3] };
  assert.deepEqual(controller.sample(ordinary), {
    active: false,
    x: 0,
    y: 0,
    round: 1,
    offset: 0,
    progress: 1,
  });
  const restored = { ...battle, events: { state: { finalRound: 3 } } };
  assert.equal(controller.sample(restored).offset, 288);
});

test("final source effects survive the browser battle queue without advancing the engine or changing music", () => {
  const battle = fixture(),
    emitted = [],
    music = [];
  const flow = new BattleFlow({
    audio: { playMusic: (id) => music.push(id) },
    emit: (e) => emitted.push(e),
  });
  flow.begin(battle);
  flow.event({ kind: "battle-effect", name: "LB:背景スクロールラウンド2" }, battle);
  assert.equal(emitted[0].time, 10);
  assert.equal(emitted[0].name, "LB:背景スクロールラウンド2");
  battle.events.paused = true;
  assert.equal(flow.realtimePresentation, true);
  flow.update(1);
  assert.equal(battle.elapsed, 10);
  assert.deepEqual(music, [65], "only the existing battle-start BGM is played by this flow");
  battle.events.paused = false;
  assert.equal(flow.realtimePresentation, false);
});
