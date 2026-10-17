import test from "node:test";
import assert from "node:assert/strict";
import { PlayGame } from "./game.js";
function fixture() {
  const data = {
    global: { name: 0 },
    byMap: {},
    speakers: {},
    messages: { next: "<C2>，出发吧。" },
    programs: {
      0: {
        name: "name",
        ops: [["SysCall", [], [], ["名前入力：ロック"]], ["Msg", [], [], ["next"]], ["Exit"]],
      },
    },
  };
  const game = new PlayGame({
    data,
    interactiveNames: true,
    battleData: { characters: { 1: { id: 1, name: "蒂娜" }, 2: { id: 2, name: "洛克" } } },
  });
  game.startScript("name");
  return game;
}
test("manual PR naming pauses its actual source task and renames the selected character before the next message", () => {
  const game = fixture();
  game.tick(0.1);
  assert.equal(game.nameInput.id, 2);
  assert.equal(game.nameInput.task.pc, 1);
  assert.equal(game.dialogue, null);
  const time = game.time;
  game.tick(4);
  assert.equal(game.time, time);
  assert.equal(game.dialogue, null);
  assert.equal(game.submitName(""), false);
  assert.equal(game.submitName("行云流水"), true);
  game.tick(0.1);
  assert.equal(game.unit(1).name, "蒂娜");
  assert.equal(game.unit(2).name, "行云流水");
  assert.equal(game.dialogue.text, "行云流水，出发吧。");
});
test("automatic regression accepts the existing name in the same source tick without a new player policy", () => {
  const game = fixture();
  game.tick(0.1, { auto: true });
  assert.equal(game.nameInput, null);
  assert.equal(game.time, 0.1);
  assert.equal(game.unit(2).name, "洛克");
  assert.equal(game.dialogue.text, "洛克，出发吧。");
});
