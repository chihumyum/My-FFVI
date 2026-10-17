import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { isVeldt, walkEncounter, encounterPool } from "./encounters.js";
import { buyFromShop, closeShop } from "./event-systems.js";
import { canVehicleLand } from "./vehicle-input.js";
import { compileMap, packageBinding } from "../../tools/export/maps.mjs";

test("PR world cell overrides retain the Zone Eater island and the adjacent ordinary ocean pool", () => {
  const read = (relative) =>
      JSON.parse(fs.readFileSync(new URL(`../../build/web-data/${relative}`, import.meta.url))),
    tables = read("raw/tables.json"),
    data = read("data.json"),
    battleData = read("battle.json"),
    assets = read("raw/bundles/map_10020_assets_all_5f007a416d3223c1a14303a1a0c0e437.json"),
    index = new Map(
      assets.map((asset) => [
        (asset.source.file + "::" + asset.source.assetPath).toLowerCase(),
        asset,
      ]),
    ),
    packages = assets.filter((asset) => asset.data.map),
    row = tables["map.csv"].find((row) => row.id === "2"),
    binding = packageBinding(row, packages, index),
    map = compileMap(row, binding, tables, read("raw/media.json"), {}),
    source = assets.find((asset) => asset.source.assetPath.endsWith("/encount_grid.json")).data,
    warnings = [],
    game = {
      data,
      battleData,
      map,
      mapId: 2,
      player: { x: 236, y: 42, vehicle: 1 },
      warn: (_task, message) => warnings.push(message),
    };
  assert.deepEqual(map.worldTerrain.encounterGrid.cells, source.cells.map(Number));
  assert.equal(map.worldTerrain.encounterGrid.cells[42 * 256 + 236], 267);
  assert.equal(canVehicleLand(game, 5, 236, 42), true);
  assert.equal(canVehicleLand(game, 5, 237, 42), true);
  assert.deepEqual(
    encounterPool(game).filter((choice) => choice.weight > 0),
    [
      { id: 336, weight: 80 },
      { id: 336, weight: 80 },
      { id: 336, weight: 80 },
      { id: 336, weight: 16 },
    ],
  );
  game.player.y = 40;
  assert.equal(map.worldTerrain.encounterGrid.cells[40 * 256 + 236], 215);
  assert.equal(canVehicleLand(game, 5, 236, 40), false);
  assert(
    encounterPool(game)
      .filter((choice) => choice.weight > 0)
      .every((choice) => choice.id === 0),
  );
});

test("walking encounters charge PR terrain cost, wait for input, and cannot roll an empty slot into a victory", () => {
  const started = [],
    game = {
      mapId: 1,
      map: { width: 4, height: 4 },
      player: { x: 1, y: 1 },
      Battle: true,
      random: () => 0,
      warn() {},
      battles: [],
      battleData: {
        parties: { 2: {} },
        encounters: {
          maps: { 1: { min: 200, max: 200, subtract: 100, set: 7 } },
          sets: {
            7: {
              choices: [
                { id: 0, weight: 1 },
                { id: 2, weight: 1 },
              ],
            },
          },
        },
      },
      encounter(...args) {
        started.push(args);
      },
    };
  assert.equal(walkEncounter(game), false);
  assert.equal(walkEncounter(game), false);
  assert.equal(started.length, 0);
  game.random = () => 0.9;
  game.busy = true;
  assert.equal(walkEncounter(game), false);
  assert.equal(game.walkEncounterState.remaining, 0);
  game.busy = false;
  game.entities = [{ kind: 23, x: 0, y: 0, width: 4, height: 4 }];
  assert.equal(walkEncounter(game), false);
  assert.equal(game.walkEncounterState.remaining, 0);
  game.entities = [];
  walkEncounter(game);
  assert.equal(walkEncounter(game), true);
  assert.equal(started[0][0], 2);
  game.map.worldTerrain = { width: 4, cells: Array(16).fill(31), footRows: { 31: { typeId: 31 } } };
  assert.equal(isVeldt(game), true);
  game.player.vehicle = 3;
  assert.equal(isVeldt(game), false);
});

test("a shop sale deducts gil and closed shops cannot sell from their previous cached stock", () => {
  const game = {
    banks: { PlaySystems: {} },
    gil: 1000,
    inventory: {},
    event() {},
    shop: { stock: [{ id: 24, price: 150 }], task: { waitFor: "shop" } },
  };
  const caller = game.shop.task;
  assert.equal(buyFromShop(game, 24, 2), true);
  assert.equal(game.gil, 700);
  assert.equal(game.inventory[24], 2);
  assert.equal(closeShop(game), true);
  assert.equal(caller.waitFor, null);
  assert.equal(buyFromShop(game, 24), false);
  assert.equal(game.gil, 700);
});
