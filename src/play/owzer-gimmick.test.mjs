import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { executeEventSystem, updateSyscallSystems } from "./event-systems.js";
import { fieldTerrainBlockerAt, openedDoorTerrainAt, openFieldDoor } from "./field-collision.js";
import { PlayGame } from "./game.js";

test("the real PR Owzer start/end operate all three source door colliders, without opening adjacent walls", () => {
  const map = JSON.parse(
    fs.readFileSync(new URL("../../build/web-data/maps/445.json", import.meta.url)),
  );
  const entities = [
    ...new Map(
      [...map.entities, ...map.groups.ev_e_1064.entities].map((e) => [String(e.id), e]),
    ).values(),
  ];
  const warnings = [];
  const game = {
    mapId: 445,
    map,
    player: { x: 88, y: 51, layer: 1, direction: "up" },
    time: 0,
    banks: { ScenarioFlag2: { 135: 0 } },
    entities,
    actors: new Map(),
    tasks: [],
    data: { programs: {} },
    resolve() {},
    actor(id) {
      if (!this.actors.has(String(id)))
        this.actors.set(String(id), {
          ...entities.find((e) => String(e.id) === String(id)),
          visible: true,
        });
      return this.actors.get(String(id));
    },
    canWalk: PlayGame.prototype.canWalk,
    event() {},
  };
  const flags = structuredClone(game.banks.ScenarioFlag2);
  const call = (name) =>
    executeEventSystem(game, {}, name, [], [], { warn: (message) => warnings.push(message) });
  assert(fieldTerrainBlockerAt(game, 88, 50, 1));
  call("ギミック開始：アウザーの館");
  assert.equal(game.banks.PlaySystems.owzerDoors.doors.length, 3);
  for (let frame = 0; frame < 4; frame++) {
    const selected = frame % 3;
    for (let n = 0; n < 3; n++) {
      const x = 88 + n * 2;
      assert.equal(Boolean(fieldTerrainBlockerAt(game, x, 50, 1)), n !== selected);
      const region = entities.find(
        (e) => e.kind === 1 && e.x === x && e.y === 49 && e.height === 2,
      );
      assert.equal(game.actor(region.id).tileNormalized, Number(n === selected));
    }
    assert.equal(openedDoorTerrainAt(game, 89, 50, 1), false);
    assert.equal(openedDoorTerrainAt(game, 91, 50, 1), false);
    updateSyscallSystems(game, 3);
  }
  call("ギミック解除：アウザーの館");
  updateSyscallSystems(game, 60);
  assert([88, 90, 92].every((x) => !fieldTerrainBlockerAt(game, x, 50, 1)));
  assert.equal(openedDoorTerrainAt(game, 88, 50, 1), false);
  // Stopping the timed gates leaves the normal door closed. A later real
  // door interaction can still open it, rather than fighting a stale gate.
  assert.equal(game.actor("21").tileNormalized, 0);
  assert.equal(PlayGame.prototype.canMove.call(game, 88, 50, 1), false);
  assert.equal(
    openFieldDoor(
      game,
      entities.find((e) => e.kind === 8 && e.id === "29"),
    ),
    true,
  );
  assert.equal(PlayGame.prototype.canMove.call(game, 88, 50, 1), true);
  assert.equal(openedDoorTerrainAt(game, 88, 50, 1), true);
  assert.equal(openedDoorTerrainAt(game, 89, 50, 1), false);
  call("ギミック開始：アウザーの館");
  assert.equal(game.banks.PlaySystems.owzerDoors.active, true);
  assert.equal(fieldTerrainBlockerAt(game, 90, 50, 1)?.id, "86");
  call("ギミック解除：アウザーの館");
  assert.equal(game.banks.PlaySystems.owzerDoors.active, false);
  assert.deepEqual(game.banks.ScenarioFlag2, flags);
  assert(warnings.some((message) => message.includes("inferred")));
  game.mapId = 444;
  updateSyscallSystems(game, 1);
  assert.equal(game.banks.PlaySystems.owzerDoors, undefined);
});
