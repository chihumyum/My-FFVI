import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PlayGame } from "./game.js";
import { pathTo } from "./m1-route.js";
import { followTarget } from "./story-route.js";
import {
  cooperativeStoryInput,
  switchCooperativeParty,
  updateCooperativeInput,
} from "./cooperative-input.js";

// Independent physical-input fixtures using real PR scripts and plate objects.
// They do not represent a played mainline save or mainline completion.
const data = JSON.parse(await readFile(new URL("../../build/play/data.json", import.meta.url)));
const source = JSON.parse(
  await readFile(new URL("../../build/world/maps/549.json", import.meta.url)),
);
const bundleName = source.map.entities
  .find((entity) => entity.kind === 30)
  .source.file.split("/")
  .pop()
  .replace(".bundle", ".json");
const bundle = JSON.parse(
  await readFile(new URL(`../../build/corpus/bundles/${bundleName}`, import.meta.url)),
);
const platesFor = (source) =>
  source.map.entities
    .filter((entity) => entity.kind === 30)
    .map((entity) => {
      const asset = bundle.find((asset) => asset.source.assetPath === entity.source.assetPath);
      const raw = entity.source.pointer
        .split("/")
        .filter(Boolean)
        .reduce((value, key) => value[key], asset.data);
      const properties = Object.fromEntries(
        raw.properties.map((property) => [property.name, property.value]),
      );
      return {
        ...entity,
        leaveScriptId: properties.leave_script_id,
        actionId: properties.action_id,
      };
    });
const plates = platesFor(source);

function fixture(sourceMap = source, sourcePlates = plates) {
  const mapId = sourceMap.mapId;
  const map = {
    ...sourceMap.map,
    initializer: "",
    entities: sourcePlates,
    groups: {},
    collisions: {},
  };
  const game = new PlayGame({ data, loadMap: async (id) => ({ ...map, id }), onEvent: () => {} });
  game.warn = () => {};
  Object.assign(game, {
    mapId,
    map,
    entities: sourcePlates,
    triggered: new Set(),
    partySlots: [[7], [5], [10]],
    partyIndex: 0,
    rts: { active: true, count: 3 },
    partyPositions: [
      { mapId, x: 17, y: 12, layer: 1, direction: "right" },
      { mapId, x: 9, y: 12, layer: 1, direction: "right" },
      { mapId, x: 14, y: 10, layer: 1, direction: "down" },
    ],
  });
  Object.assign(game.player, game.partyPositions[0]);
  game.banks.ScenarioVariable = { 4: 0, 5: 3, 11: mapId, 12: mapId, 13: mapId };
  return game;
}
function tick(game) {
  game.tick(0.05, { auto: true });
  updateCooperativeInput(game);
}
function settle(game, limit = 500) {
  for (let n = 0; n < limit && (game.busy || game.cooperativeState?.queue?.length); n++) tick(game);
  assert.equal(game.busy, false, "Source callback did not finish within 25 simulated seconds");
}
function move(game, direction) {
  assert(game.move(direction));
  updateCooperativeInput(game);
  settle(game);
}
const flag = (game, index) => game.banks.ScenarioFlag2?.[index] || 0;

test("real PR 0976 / 0982 retain two parties on plates, open 0983, and run source leave reset", () => {
  const game = fixture();
  move(game, "right");
  assert.equal(flag(game, 222), 1);
  assert.equal(flag(game, 227), 0);
  assert(switchCooperativeParty(game, 1));
  assert.equal(flag(game, 222), 1, "Switching control must not release the first party");
  move(game, "right");
  assert.equal(flag(game, 226), 1);
  assert.equal(flag(game, 227), 1);
  assert(game.history.some((entry) => entry.script === "sc_e_0983"));
  assert.equal(game.partyPositions[0].x, 18);
  assert(switchCooperativeParty(game, 0));
  move(game, "left");
  assert.equal(flag(game, 222), 0, "Only actual departure runs sc_e_0976_1");
  assert.equal(flag(game, 226), 1);
  assert.equal(flag(game, 227), 1, "The source door stays open after the plate is released");
});

test("automatic cooperative parts use normal walk/switch input and release the required source plate", () => {
  const game = fixture();
  const condition = (game, value) => flag(game, value.index) === value.value;
  const objective = {
    id: "double",
    cooperative: true,
    hold: true,
    parts: [
      { scripts: ["sc_e_0976"], complete: { index: 222, value: 1 } },
      { scripts: ["sc_e_0982"], complete: { index: 226, value: 1 } },
    ],
  };
  const findTarget = (game, objective) => {
    const target = game.entities.find((entity) => objective.scripts.includes(entity.script));
    const route = target && pathTo(game, target);
    return route ? { status: "target", target, route } : { status: "no-route" };
  };
  for (let n = 0; n < 1000 && flag(game, 227) !== 1; n++) {
    tick(game);
    if (!game.busy) cooperativeStoryInput(game, objective, { condition, findTarget, followTarget });
  }
  settle(game);
  assert.equal(flag(game, 227), 1, "The ordinary input driver failed to open the PR door");
  const release = { id: "weight", cooperative: true, release: ["sc_e_0976"] };
  for (let n = 0; n < 20 && flag(game, 222); n++) {
    tick(game);
    if (!game.busy) cooperativeStoryInput(game, release, {});
  }
  settle(game);
  assert.equal(flag(game, 222), 0);
  assert.equal(flag(game, 226), 1);
});

test("cross-map RTS source continuation restores the destination party without overwriting its pose", async () => {
  const game = fixture();
  game.partyPositions[1] = { mapId: 550, x: 7, y: 8, layer: 2, direction: "left" };
  game.banks.ScenarioVariable[12] = 550;
  assert(switchCooperativeParty(game, 1));
  await game.pending;
  settle(game);
  assert.equal(game.mapId, 550);
  assert.equal(game.partyIndex, 1);
  assert.equal(game.player.x, 7);
  assert.equal(game.player.y, 8);
  assert.equal(game.player.layer, 2);
  assert.equal(game.partyPositions[0].mapId, 549);
  assert.equal(game.partyPositions[0].x, 17);
  assert.equal(game.partyPositions[1].x, 7);
});

test("two parties sharing one PR three-plate switch leave one spare party and preserve the occupied source flag", async () => {
  const source = JSON.parse(
    await readFile(new URL("../../build/world/maps/565.json", import.meta.url)),
  );
  const game = fixture(source, platesFor(source));
  game.partyPositions = [
    { mapId: 565, x: 43, y: 10, layer: 1, direction: "up" },
    { mapId: 565, x: 39, y: 13, layer: 1, direction: "up" },
    { mapId: 565, x: 39, y: 13, layer: 1, direction: "up" },
  ];
  Object.assign(game.player, game.partyPositions[0]);
  move(game, "up");
  assert.equal(flag(game, 233), 1);
  assert(switchCooperativeParty(game, 1));
  move(game, "up");
  assert.equal(flag(game, 232), 1);
  assert(switchCooperativeParty(game, 2));
  move(game, "up");
  assert.equal(
    game.history.filter((entry) => entry.script === "sc_e_0988").length,
    1,
    "A second occupant must not press the same physical plate again",
  );
  const objective = {
    id: "triple",
    cooperative: true,
    hold: true,
    parts: [
      { scripts: ["sc_e_0988"], complete: { index: 232, value: 1 } },
      { scripts: ["sc_e_0989"], complete: { index: 233, value: 1 } },
      { scripts: ["sc_e_0990"], complete: { index: 234, value: 1 } },
    ],
  };
  const helpers = {
    condition: (game, value) => flag(game, value.index) === value.value,
    findTarget: (game, objective) => {
      const target = game.entities.find((entity) => objective.scripts.includes(entity.script));
      const route = target && pathTo(game, target);
      return route ? { status: "target", target, route } : { status: "no-route" };
    },
    followTarget,
  };
  const first = cooperativeStoryInput(game, objective, helpers);
  assert.equal(first.status, "walk", "The duplicate occupant should be free to walk to sc_e_0990");
  assert.equal(flag(game, 232), 1, "The other party is still standing on the central plate");
  assert(!game.history.some((entry) => entry.script === "sc_e_0988_1"));
  for (let n = 0; n < 200 && !flag(game, 235); n++) {
    tick(game);
    if (!game.busy) cooperativeStoryInput(game, objective, helpers);
  }
  assert.equal(flag(game, 235), 1, "Real PR sc_e_0990 must reach the sc_e_0991 source callback");
  assert(game.history.some((entry) => entry.script === "sc_e_0990"));
  assert(game.history.some((entry) => entry.script === "sc_e_0991"));
});
