import test from "node:test";
import assert from "node:assert/strict";
import { createEventHistory, describeBugState, reportValue } from "./bug-report.js";
import { PlayGame } from "../../src/play/game.js";

test("bug history preserves the last twenty event-time values, including mutable animation actors", () => {
  const history = createEventHistory();
  const actor = { id: "31", asset: "mo_ff6_p021", animation: "WalkL" };
  for (let i = 0; i < 25; i++) history.record({ kind: "presentation-command", index: i, actor });
  actor.asset = "mo_ff6_v006_c00";
  const events = history.read();
  assert.equal(events.length, 20);
  assert.equal(events[0].index, 5);
  assert.equal(events.at(-1).actor.asset, "mo_ff6_p021");
  history.clear();
  assert.deepEqual(history.read(), []);
});

test("bug report retains failed draw attempts, actual resources, and active script cursors without changing gameplay", () => {
  const game = {
    mapId: 34,
    map: { name: "Map_20051_13" },
    time: 55,
    data: { programs: { 12: { name: "sc_e_0026" } } },
    furthest: { script: "sc_e_0026" },
    lastInstruction: { script: "sc_e_0026", index: 8, name: "Route" },
    tasks: [{ id: 1, program: 12, pc: 9, actor: 0, waitFor: "motion" }],
    player: { x: 102, y: 42, direction: "left" },
    groups: new Set(["entity_default"]),
    partyIndex: 0,
    partySlots: [[2]],
    roster: { 2: { id: 2, name: "洛克", level: 8, hp: 100, equipment: [1, 2] } },
  };
  const before = reportValue(game);
  const renderer = {
    frameActors: [
      { entityId: "19", asset: "mo_ff6_p005", resource: "/actors/WalkL_00.png", drawn: true },
      { entityId: "42", asset: "missing", drawn: false, reason: "missing-character-data" },
    ],
    metrics: () => ({ type: "webgl" }),
    _width: 320,
    _height: 180,
  };
  const report = describeBugState(game, renderer, [{ kind: "map" }], { 34: "费加罗王宫" });
  assert.equal(report.map.name, "费加罗王宫");
  assert.equal(report.script.lastInstruction.index, 8);
  assert.equal(report.script.tasks[0].name, "sc_e_0026");
  assert.equal(report.actors[0].resource, "/actors/WalkL_00.png");
  assert.equal(report.actors[1].reason, "missing-character-data");
  assert.deepEqual(report.party[0].equipment, [1, 2]);
  assert.deepEqual(reportValue(game), before);
});

test("reporting a newly organized party never initializes characters or changes a save", () => {
  const game = new PlayGame({ data: {} });
  game.partySlots = [[5], [], []];
  const before = reportValue(game.snapshot());
  const report = describeBugState(game, { metrics: () => ({}) }, []);
  assert.equal(report.party[0].id, 5);
  assert.equal(report.party[0].uninitialized, true);
  assert.deepEqual(reportValue(game.snapshot()), before);
  assert.equal(game.roster[5], undefined);
});
