import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PlayGame } from "./game.js";
import { Battle } from "./battle.js";
import { advanceM1 } from "./m1-route.js";

const data = JSON.parse(await readFile(new URL("../../build/web-data/data.json", import.meta.url)));
const battleData = JSON.parse(
  await readFile(new URL("../../build/web-data/battle.json", import.meta.url)),
);

test("source party-position puppets reveal every present companion, not just explicit character IDs", () => {
  for (const slot of [
    [1, 31, 32],
    [2, 3, 4, 5],
  ]) {
    const game = new PlayGame({ data, battleData });
    game.partySlots[0] = slot;
    const program = Object.values(data.programs).find((p) => p.name === "sc_e_0001_3");
    const key = Object.keys(data.programs).find((id) => data.programs[id] === program);
    for (let position = 1; position < slot.length; position++) {
      // Use the real opening SetPuppet instruction with another occupied party slot.
      const instruction = program.ops.findIndex((o) => o[0] === "SetPuppet" && o[1][1] === -1002);
      const adapted = {
        ...data,
        programs: { ...data.programs, [key]: { ...program, ops: [...program.ops] } },
      };
      adapted.programs[key].ops[instruction] = ["SetPuppet", [1, -1001 - position, 89], [], []];
      game.data = adapted;
      const actor = game.actor(-slot[position]);
      actor.visible = false;
      const task = { program: key, pc: instruction, actor: null, bindings: {} };
      game.step(task);
      assert.equal(actor.visible, true, `party position ${position + 1} must appear`);
      assert.equal(task.bindings[1].actor, -1001 - position);
      assert.equal(game.player.visible, true, "revealing a companion must not hide the leader");
    }
  }
});

test("an absent party-position puppet does not reveal a duplicate leader", () => {
  const game = new PlayGame({ data, battleData });
  game.partySlots[0] = [1];
  const key = Object.keys(data.programs).find((id) => data.programs[id].name === "sc_e_0001_3");
  const pc = data.programs[key].ops.findIndex((o) => o[0] === "SetPuppet" && o[1][1] === -1002);
  const actor = game.actor(-1);
  game.step({ program: key, pc, actor: null, bindings: {} });
  assert.equal(actor.visible, false);
  assert.equal(game.player.visible, true);
});

test("the real Figaro cleanup skips empty slots even when their callback contains Show", async () => {
  const game = new PlayGame({ data, battleData });
  game.partySlots[0] = [1];
  game.map = JSON.parse(
    await readFile(new URL("../../build/web-data/maps/34.json", import.meta.url)),
  );
  game.mapId = 34;
  game.groups = new Set(["entity_default"]);
  game.refreshActors();
  const duplicate = game.actor(-1);
  const task = game.startScript("sc_e_0026", { pc: 345, init: true });
  for (let n = 0; n < 30 && !task.done; n++) game.tick(0.1, { auto: true });
  assert.equal(task.done, true);
  assert.equal(duplicate.visible, false, "Empty party callbacks must not create another Terra");
  assert.equal(game.player.visible, true);
});

test("HideMob and RestoreMob preserve hidden actors and parked vehicle visibility", () => {
  const game = new PlayGame({ data, battleData });
  game.mapId = 34;
  const focus = { id: 19, visible: true },
    bystander = { id: 20, visible: true },
    hidden = { id: -1, visible: false },
    vehicle = { id: -105, visible: false };
  game.actors = new Map(
    [focus, bystander, hidden, vehicle].map((actor) => [String(actor.id), actor]),
  );
  const program = Object.keys(data.programs).find((id) => data.programs[id].name === "sc_e_0026");
  game.step({ program, pc: 17, actor: null });
  assert.equal(focus.visible, true, "The authored naming target is excluded");
  assert.equal(bystander.visible, false);
  game.step({ program, pc: 24, actor: null });
  assert.equal(bystander.visible, true);
  assert.equal(hidden.visible, false);
  assert.equal(vehicle.visible, false, "A lost Magitek body must not be resurrected in the castle");
});

test("the real new-game cliff conversation contains Terra and both soldiers", async () => {
  const game = new PlayGame({
    data,
    battleData,
    loadMap: async (id) =>
      JSON.parse(await readFile(new URL(`../../build/web-data/maps/${id}.json`, import.meta.url))),
  });
  await game.start();
  for (let n = 0; n < 2000; n++) {
    game.tick(0.1, { auto: true });
    if (game.loading) await game.pending;
    if (game.dialogue?.key === "E0001_03_020_a_08") break;
  }
  assert.equal(game.dialogue?.key, "E0001_03_020_a_08");
  const actors = [game.player, game.actors.get("-31"), game.actors.get("-32")];
  assert(actors.every((a) => a?.visible === true));
  assert(actors.every((a) => a.vehicle === 6 && a.walkAsset));
  assert.equal(new Set(actors.map((a) => `${a.x}:${a.y}`)).size, 3);
});

test("the real Narshe recovery retires the entrance body and returns control at Terra's puppet pose", async () => {
  const transfers = [],
    stages = [];
  const game = new PlayGame({
    data,
    battleData,
    Battle,
    testBoost: true,
    random: () => 0.5,
    loadMap: async (id) =>
      JSON.parse(await readFile(new URL(`../../build/web-data/maps/${id}.json`, import.meta.url))),
    onEvent: (e) => {
      if (e.kind === "puppet-player-transfer" && e.mapId === 17) transfers.push(e);
      if (e.kind === "bgm" && e.id === 4 && game.mapId === 17)
        stages.push({
          visible: game.player.visible,
          puppetVisible: game.actors.get("-1")?.visible,
        });
    },
  });
  await game.start();
  for (let n = 0; n < 12000 && !transfers.length; n++) {
    game.tick(0.1, { auto: true });
    if (game.loading) await game.pending;
    if (!transfers.length && !game.busy) advanceM1(game);
  }
  assert.equal(transfers.length, 1);
  assert.deepEqual(stages, [
    { visible: false, puppetVisible: true },
    { visible: true, puppetVisible: undefined },
  ]);
  assert.deepEqual([game.player.x, game.player.y], [13, 10]);
  assert.equal(game.player.direction, "left");
  assert.equal(game.player.visible, true);
  assert.equal(game.actors.get("-1")?.visible ?? false, false);
});
