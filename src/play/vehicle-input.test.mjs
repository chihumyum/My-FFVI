import test from "node:test";
import assert from "node:assert/strict";
import {
  executeVehicleInstruction,
  executeVehicleSyscall,
  vehicleInputState,
  openVehicleInput,
  submitVehicleInput,
  moveVehicle,
  canVehicleLand,
  autoVehicleInput,
} from "./vehicle-input.js";
import { updateVehicleInput } from "./vehicle-input.js";
import { vehicleJourneyInput } from "./story-actions.js";
import { PlayGame } from "./game.js";

function host() {
  const row = (id, extra = {}) => ({
    id: String(id),
    asset_id: String(id + 32),
    release_flag: String(899 + id),
    landing_group_id: String(id - 1),
    bgm_id: "46",
    ...extra,
  });
  return {
    banks: { ScenarioFlag1: { 18: 1 }, ScenarioFlag2: { 44: 0 } },
    data: {
      systemTables: {
        transportation: [
          row(2),
          row(3),
          row(4, { start_takeoff: "7000", start_landing: "7001", transition_inboard: "7003" }),
        ],
        landingGroup: [
          { id: "1", type2: "0", type3: "1" },
          { id: "2", type2: "0", type3: "1" },
          { id: "3", type2: "0", type3: "1" },
        ],
      },
      fieldAssets: {
        1: { asset_name: "terra" },
        36: { asset_name: "blackjack", character_id: "103" },
      },
      scriptIds: { 7000: "takeoff", 7001: "landing", 7003: "deck" },
      programs: {
        takeoff: { name: "takeoff", locals: [4], ops: [["Wait"], ["SysCall"], ["Exit"]] },
        landing: { name: "landing", ops: [["Wait"], ["ChangeMap"], ["Exit"]] },
        deck: { name: "deck", ops: [["SysCall"], ["ChangeMap"], ["Exit"]] },
        stub: { name: "takeoff", ops: [["Nop"], ["Exit"]] },
      },
    },
    mapId: 1,
    map: {
      width: 4,
      height: 2,
      worldTerrain: {
        width: 4,
        height: 2,
        loopType: 3,
        cells: [2, 3, 3, 2, 2, 3, 3, 2],
        footRows: { 2: { typeId: 2 }, 3: { typeId: 3 } },
        transportRules: {
          1: { collisionByFoot: { 2: 1, 3: 0 } },
          2: { collisionByFoot: { 2: 0, 3: 1 } },
          4: { collisionByFoot: { 2: 0, 3: 0 } },
        },
      },
    },
    player: { x: 1, y: 0, layer: 1, asset: "terra", direction: "down" },
    camera: {},
    party: [{ id: 1, hp: 10, maxHp: 100 }],
    actors: new Map(),
    events: [],
    tasks: [],
    control: true,
    get busy() {
      return Boolean(this.vehicleMenu);
    },
    actor(id) {
      if (!this.actors.has(String(id))) this.actors.set(String(id), { id, x: 0, y: 0, layer: 1 });
      return this.actors.get(String(id));
    },
    resolve(name, map) {
      this.lastResolvedMap = map;
      return name === "takeoff"
        ? "stub"
        : Object.hasOwn(this.data.programs, name)
          ? name
          : undefined;
    },
    startScript(name) {
      const task = { program: this.resolve(name, this.mapId), pc: 0, locals: [] };
      this.tasks.push(task);
      return task;
    },
    event(kind, value) {
      this.events.push({ kind, ...value });
    },
    warn(task, message) {
      this.events.push({ kind: "warning", message });
    },
    checkTriggers() {
      throw new Error("Airborne movement must not enter a foot trigger.");
    },
  };
}
const place = (game, id = 4, x = 1, y = 0) =>
  executeVehicleInstruction(game, null, "SetVehicle", [id, 1, x, y, 1, 3]);

test("PR vehicle parking converts its layer request and preserves bottom layer zero on boarding", () => {
  const game = host();
  game.player.layer = 2;
  place(game, 4, 2, 1);
  assert.equal(game.banks.PlaySystems.vehicles[4].layer, 0);
  assert.equal(game.actor(-103).layer, 0);
  assert.equal(game.player.layer, 2);
  executeVehicleInstruction(game, null, "OnTheVehicle", [4]);
  assert.equal(game.player.layer, 0);
  assert.equal(game.actor(-1).layer, 0);
  executeVehicleInstruction(game, null, "SetVehicle", [4, 1, 2, 1, 3, 3]);
  assert.equal(game.banks.PlaySystems.vehicles[4].layer, 2);
});

test("cinematic vehicle hiding expires on map replacement without changing parking or release flags", async () => {
  const fixture = host();
  const game = new PlayGame({
    data: {
      ...fixture.data,
      byMap: {},
      global: { init: "init" },
      programs: {
        ...fixture.data.programs,
        init: { name: "init", locals: [], ops: [["Exit", [], [], []]] },
      },
    },
    loadMap: async () => ({
      ...fixture.map,
      areaId: 1,
      initializer: "init",
      entities: [{ id: "entrance", kind: 0, objectId: 0, x: 1, y: 0, layer: 1 }],
      groups: {},
    }),
  });
  game.warn = (_task, message) => game.warnings.push({ message });
  place(game);
  const parking = structuredClone(game.banks.PlaySystems.vehicles[4]),
    releases = structuredClone(game.banks.TreasureFlag4);
  executeVehicleInstruction(game, null, "SwitchVehicleActive", [1]);
  assert.equal(game.banks.PlaySystems.vehicleActive, false);
  await game.enter(1, 0);
  game.tick(0.1);
  assert.equal(game.banks.PlaySystems.vehicleActive, true);
  assert.equal(game.actor(-103).visible, true);
  assert(vehicleInputState(game).actions.some((action) => action.action === "takeoff"));
  assert.deepEqual(game.banks.PlaySystems.vehicles[4], parking);
  assert.deepEqual(game.banks.TreasureFlag4, releases);
  executeVehicleInstruction(game, null, "SwitchVehicleActive", [1]);
  game.tick(0.1);
  assert.equal(game.actor(-103).visible, false, "same-map cinematic hiding still applies");
});

test("a PR transportation action uses same-cell confirmation with its declared vehicle instead of terrain landing", () => {
  const game = new PlayGame({
    data: { programs: { 0: { name: "entry", ops: [["Exit"]] } }, global: { entry: 0 }, byMap: {} },
  });
  const target = {
    id: "entry",
    kind: 21,
    x: 1,
    y: 1,
    layer: 0,
    script: "entry",
    transportationIds: [5],
  };
  Object.assign(game, {
    mapId: 2,
    map: { width: 3, height: 3, worldTerrain: {} },
    entities: [target],
  });
  Object.assign(game.player, { x: 1, y: 1, layer: 0, vehicle: 1 });
  assert.equal(game.confirm(), false);
  game.player.vehicle = 4;
  assert.equal(game.confirm(), false);
  Object.assign(game.player, { x: 0, direction: "right", vehicle: 5 });
  assert.equal(game.confirm(), false);
  game.player.x = 1;
  assert.equal(game.confirm(), true);
  assert.equal(game.tasks[0].program, 0);
  assert.deepEqual(game.banks, {});
  const flight = host();
  flight.player.vehicle = 4;
  assert.equal(
    vehicleJourneyInput(flight, { target: { ...target, transportationIds: [4] } }, () => {
      throw Error("A source flight entry must not search for a walking/landing route.");
    }),
    null,
  );
});

test("flight can land farther than four tiles from a cave and then use its normal walking corridor", () => {
  const game = host(),
    target = { id: "cave", kind: 3, x: 12, y: 0, layer: 1 };
  Object.assign(game.map, { width: 14, height: 1 });
  Object.assign(game.map.worldTerrain, {
    width: 14,
    height: 1,
    cells: Array.from({ length: 14 }, (_, i) => (i === 1 ? 3 : 2)),
  });
  game.map.worldTerrain.transportRules[1].collisionByFoot[2] = 0;
  game.data.navigation = {
    maps: {
      1: { width: 14, regionRuns: { 1: [[14, 1]] }, entries: [{ ...target, regions: [1] }] },
    },
  };
  Object.assign(game.player, { x: 0, y: 0, vehicle: 4 });
  game.canWalk = () => true;
  game.move = (direction) => moveVehicle(game, direction);
  const input = vehicleJourneyInput(game, { target }, (host) =>
    host.player.vehicle ? ["right"] : [],
  );
  assert.equal(input.target.x, 1);
  assert.equal(input.status, "walk");
  assert.equal(game.player.x, 1);
  assert.equal(game.player.vehicle, 4);
  assert.equal(game.tasks.length, 0);
});

test("source parking, release, position and visibility instructions do not impersonate boarding", () => {
  const game = host(),
    flags = structuredClone(game.banks);
  assert(place(game, 4, 2, 1));
  assert.equal(game.player.vehicle, undefined);
  assert.deepEqual([game.player.x, game.player.y], [1, 0]);
  assert.equal(game.banks.TreasureFlag4[135], 1);
  assert.equal(game.actor(-103).asset, "blackjack");
  assert.equal(game.actor(-103).visible, true);
  executeVehicleInstruction(game, null, "SwitchVehicleActive", [1]);
  assert.equal(game.actor(-103).visible, false);
  executeVehicleInstruction(game, null, "SwitchVehicleActive", [0]);
  assert.equal(game.actor(-103).visible, true);
  executeVehicleInstruction(game, null, "OnTheVehicle", [4]);
  assert.deepEqual([game.player.x, game.player.y, game.camera.x, game.camera.y], [2, 1, 2, 1]);
  assert.equal(game.player.vehicle, undefined);
  executeVehicleInstruction(game, null, "LoseVehicle", [4]);
  assert.equal(game.banks.TreasureFlag4[135], 0);
  assert.equal(game.actor(-103).visible, false);
  assert.deepEqual(game.banks.ScenarioFlag1, flags.ScenarioFlag1);
  assert.deepEqual(game.banks.ScenarioFlag2, flags.ScenarioFlag2);
});

test("manual and automatic takeoff only invoke the table callback and retain a paused caller continuation", () => {
  const game = host();
  assert.equal(submitVehicleInput(game, { action: "takeoff", vehicleId: 4 }), false);
  place(game);
  assert(openVehicleInput(game));
  assert(autoVehicleInput(game, { action: "takeoff", vehicleId: 4 }));
  assert.equal(game.vehicleMenu, null);
  assert.equal(game.tasks[0].program, "takeoff"); // Real body wins over an empty global alias.
  assert.equal(game.lastResolvedMap, 1);
  assert.equal(game.player.vehicle, undefined); // Source has not executed its boarding SysCall yet.
  executeVehicleSyscall(game, null, "乗り物に乗る：ブラックジャック号");
  assert.equal(game.player.vehicle, 4);
  assert.equal(game.player.asset, "blackjack");
  const caller = { program: "main", pc: 13, locals: [42], stack: [], waitFor: null };
  assert(openVehicleInput(game, caller));
  assert.equal(caller.waitFor, "vehicle");
  assert(submitVehicleInput(game, "deck"));
  assert.equal(caller.program, "deck");
  assert.equal(caller.scriptFrames[0].pc, 13);
  assert.deepEqual(caller.scriptFrames[0].locals, [42]);
  assert.equal(game.party[0].hp, 10);
});

test("flight crosses water and wraps without foot triggers; landing preserves the actual flown position", () => {
  const game = host();
  place(game);
  executeVehicleSyscall(game, null, "乗り物に乗る：ブラックジャック号(アニメ・BGMなし)");
  assert(moveVehicle(game, "left"));
  assert.equal(game.player.x, 0);
  assert.equal(canVehicleLand(game), false);
  assert.equal(submitVehicleInput(game, "land"), false);
  assert(moveVehicle(game, "left"));
  assert.equal(game.player.x, 3);
  assert(moveVehicle(game, "left"));
  assert.equal(game.player.x, 2);
  assert.equal(canVehicleLand(game), true);
  assert(submitVehicleInput(game, "land"));
  assert.equal(game.tasks.at(-1).program, "landing");
  executeVehicleSyscall(game, null, "飛空艇着陸時演出開始");
  assert.equal(game.player.vehicle, null);
  assert.deepEqual(
    [game.banks.PlaySystems.vehicles[4].x, game.banks.PlaySystems.vehicles[4].y],
    [2, 0],
  );
  Object.assign(game.player, { x: 0, y: 1 }); // Source ChangeMap's entrance.
  executeVehicleInstruction(game, null, "OnTheVehicle", [4]);
  assert.deepEqual([game.player.x, game.player.y], [2, 0]);
  game.player.visible = false; // Source landing_1 keeps the leader hidden during descent.
  updateVehicleInput(game);
  assert.equal(game.player.visible, true);
  assert(game.events.some((event) => event.kind === "vehicle-landed"));
  game.actors = new Map(); // A landing reload can recreate the same world map ID.
  updateVehicleInput(game);
  assert.equal(game.actor(-103).asset, "blackjack");
  assert.deepEqual([game.actor(-103).x, game.actor(-103).y], [2, 0]);
});

test("deck save/restore keeps world parking and a boat disembarks by one legal shore step", () => {
  const game = host();
  place(game);
  executeVehicleSyscall(game, null, "乗り物に乗る：ブラックジャック号");
  moveVehicle(game, "down");
  executeVehicleSyscall(game, null, "バードビュー情報を保存");
  executeVehicleSyscall(game, null, "乗り物から降りる(アニメ・BGMなし)");
  game.mapId = 119;
  game.map.worldTerrain = null;
  Object.assign(game.player, { x: 14, y: 6 });
  executeVehicleSyscall(game, null, "乗り物に乗る：ブラックジャック号(アニメ・BGMなし)");
  assert.equal(game.banks.PlaySystems.vehicles[4].mapId, 1);
  game.mapId = 1;
  executeVehicleSyscall(game, null, "バードビュー情報を設定");
  assert.deepEqual([game.player.x, game.player.y], [1, 1]);
  const boat = host();
  Object.assign(boat.player, { x: 0, y: 0 });
  place(boat, 2, 0, 0);
  assert(submitVehicleInput(boat, { action: "board", vehicleId: 2 }));
  assert.equal(moveVehicle(boat, "right"), false);
  assert.equal(
    vehicleInputState(boat).actions.find((action) => action.action === "dismount").enabled,
    true,
  );
  assert(autoVehicleInput(boat, { action: "dismount", direction: "right" }));
  assert.deepEqual([boat.player.x, boat.player.y, boat.player.vehicle], [1, 0, null]);
  assert.equal(boat.banks.PlaySystems.vehicles[2].x, 0);
});
