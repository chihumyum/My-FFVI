import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PlayGame } from "./game.js";

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
