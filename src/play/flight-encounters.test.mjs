import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { executeFlightEncounterSyscall, checkFlightEncounterContact } from "./flight-encounters.js";
import { moveVehicle } from "./vehicle-input.js";
import { PlayGame } from "./game.js";
import { Battle } from "./battle.js";

const read = (relative) =>
  JSON.parse(fs.readFileSync(new URL(`../../${relative}`, import.meta.url)));
const data = read("build/web-data/data.json"),
  battleData = read("build/web-data/battle.json");
function contactHost(vehicle = 5) {
  const map = read("build/web-data/maps/2.json"),
    started = [],
    warnings = [];
  const game = {
    data,
    map,
    mapId: 2,
    banks: {},
    actors: new Map(),
    entities: map.groups.ev_e_0964.entities,
    player: { x: 127, y: 128, layer: 0, vehicle },
    camera: {},
    control: true,
    busy: false,
    random: () => 0.5,
    warn: (_task, message) => warnings.push(message),
    event() {},
    resolve: (name) => data.byMap[2][name] ?? data.global[name],
    startScript(name) {
      started.push(name);
      return { pc: 0 };
    },
  };
  return { game, started, warnings };
}

test("the PR placement host keeps its ten source bodies and only an accepted Falcon move dispatches their source script", () => {
  const { game, started, warnings } = contactHost();
  assert.equal(executeFlightEncounterSyscall(game, null, "unrelated"), false);
  assert.equal(executeFlightEncounterSyscall(game, null, "デスゲイズ配置"), true);
  assert.equal(game.actors.size, 10);
  assert.equal(started.length, 0, "placement itself must never start a boss");
  assert.equal(moveVehicle(game, "right"), true);
  assert.deepEqual(started, ["sc_e_0964"]);
  moveVehicle(game, "left");
  moveVehicle(game, "right");
  assert.equal(started.length, 1, "the same pending source contact cannot retrigger");
  assert(warnings.some((message) => /approximated/.test(message)));
});

test("source flight contact cannot activate from walking, Blackjack or an unplaced old checkpoint", () => {
  for (const vehicle of [1, 4]) {
    const { game, started } = contactHost(vehicle);
    executeFlightEncounterSyscall(game, null, "デスゲイズ配置");
    moveVehicle(game, "right");
    assert.equal(checkFlightEncounterContact(game), false);
    assert.equal(started.length, 0);
  }
  const { game, started, warnings } = contactHost();
  assert.equal(moveVehicle(game, "right"), true);
  assert.equal(started.length, 0);
  assert(warnings.some((message) => /world-map re-entry/.test(message)));
});

test("Deathgaze HP uses its dedicated persistent record rather than unrelated ScenarioVariable3 scratch", () => {
  const make = (banks) =>
    new Battle({
      data: battleData,
      encounterId: 464,
      party: [{ id: 7, level: 21, hp: 1000, maxHp: 1000 }],
      banks,
      random: () => 0.5,
    });
  const initial = { ScenarioVariable: { 3: 7 } },
    first = make(initial);
  assert.equal(first.enemies[0].hp, battleData.monsters[286].hp);
  assert.equal(initial.ScenarioVariable[3], battleData.monsters[286].hp);
  const saved = { ScenarioVariable: { 3: 7 }, PlaySystems: { deathgazeHp: 12345 } },
    again = make(saved);
  assert.equal(again.enemies[0].hp, 12345);
  assert.equal(saved.ScenarioVariable[3], 12345);
});

test("actual PR flight contact, AI retreat, recontact and victory run the source HP gate before awarding Bahamut", async () => {
  // Independent integration fixture from the real BOOSTED Falcon checkpoint.
  // Its original stats/inventory/banks are restored. No plot flags, HP, Gil,
  // monster properties, actor coordinates or target script PCs are injected.
  // The explicit source map-entry fixture runs its real initializer; travel
  // thereafter uses only ordinary cardinal flight and Fight/Defend commands.
  let sample = 0.9;
  const saved = read("build/play/stage1-checkpoints/kefka-tower.json"),
    events = [];
  const game = new PlayGame({
    data,
    battleData,
    Battle,
    random: () => sample,
    loadMap: async (id) => read(`build/web-data/maps/${id}.json`),
    onEvent: (event) => events.push(event),
  });
  game.warn = (_task, message) => game.warnings.push({ message });
  await game.restore(structuredClone(saved));
  await game.enter(2, 1);
  const settle = async () => {
    for (let n = 0; n < 2000 && game.busy; n++) {
      assert.equal(game.battle, null, "field continuation must not invent another encounter");
      game.tick(0.1, { auto: true });
      if (game.loading) await game.pending;
    }
    assert.equal(game.busy, false, "source field continuation has a bounded wait");
  };
  await settle();
  assert.equal(game.banks.PlaySystems.deathgazePlacement.bodyIds.length, 10);
  const flyIntoSourceBody = () => {
    const target = game.actors.get("157");
    if (game.player.x === target.x && game.player.y === target.y) assert(moveVehicle(game, "left"));
    for (let n = 0; n < 600 && !game.busy; n++) {
      const width = game.map.width,
        height = game.map.height,
        dx = (target.x - game.player.x + width) % width,
        dy = (target.y - game.player.y + height) % height,
        direction = dx ? (dx < width / 2 ? "right" : "left") : dy < height / 2 ? "down" : "up";
      assert(moveVehicle(game, direction));
    }
    for (let n = 0; n < 5 && !game.battle; n++) game.tick(0.1);
    assert.equal(game.battle?.encounterId, 464);
    assert.equal(game.history.at(-1).script, "sc_e_0964");
    return game.battle;
  };
  const first = flyIntoSourceBody();
  sample = 0.5;
  let struck = false;
  for (let n = 0; n < 1000 && game.battle; n++) {
    game.tick(0.1);
    const active = game.battle;
    if (!active) break;
    for (const [index, unit] of active.players.entries())
      if (unit.ready) {
        if (!struck) struck = active.choose(index, 1, 0);
        else active.choose(index, 2);
      }
  }
  assert.equal(game.battle, null);
  assert(struck && first.enemies[0].escaped, "the actual source AI331 must retreat");
  assert.equal(first.outcome, "escape");
  assert.equal(first.result.exp, 0);
  assert.equal(first.result.gil, 0);
  const remaining = first.enemies[0].hp;
  assert(remaining > 0 && remaining < battleData.monsters[286].hp);
  await settle();
  assert.equal(game.banks.ScenarioVariable[3], remaining);
  assert.equal(game.inventory[85], undefined);
  assert.notEqual(game.banks.ScenarioFlag2[216], 1);
  const second = flyIntoSourceBody();
  assert.equal(second.enemies[0].hp, remaining);
  for (let n = 0; n < 2000 && game.battle; n++) {
    game.tick(0.1);
    const active = game.battle;
    if (!active) break;
    for (const [index, unit] of active.players.entries())
      if (unit.ready) active.choose(index, 1, 0);
  }
  assert.equal(game.battle, null);
  assert.equal(second.enemies[0].hp, 0);
  assert.equal(second.outcome, "victory");
  await settle();
  assert.equal(game.banks.ScenarioVariable[3], 0);
  assert.equal(game.banks.PlaySystems.deathgazeHp, 0);
  assert.equal(game.inventory[85], 1);
  assert.equal(game.banks.ScenarioFlag2[216], 1);
  assert.equal(game.mapId, 2);
  assert.equal(game.player.vehicle, 5);
  assert.equal(game.over, undefined);
  assert.equal(events.filter((event) => event.kind === "flight-contact").length, 2);
  assert.equal(game.history.filter((row) => row.script === "sc_e_0964_2").length, 1);
});
