import test from "node:test";
import assert from "node:assert/strict";
import { PlayGame } from "./game.js";

const op = (name, ints = [], reals = [], strings = []) => [
  name,
  ints,
  reals,
  strings,
];
function game(programs) {
  const value = new PlayGame({
    data: {
      byMap: {},
      global: Object.fromEntries(programs.map((p, id) => [p.name, id])),
      programs,
    },
  });
  value.mapId = 1;
  value.map = { initializer: "unused" };
  return value;
}

test("ChangeScript return restores the caller after Exit, including its local variables and ordinary Call stack", () => {
  const g = game([
    {
      name: "parent",
      locals: [7],
      ops: [
        op("Call", [4]),
        op("SetFlag", [1], [], ["ScenarioFlag1"]),
        op("Exit"),
        op("Nop"),
        op("ChangeScript", [1], [], ["child"]),
        op("Calc", [0, 1], [], ["ScriptLocalVariable", "＋", "imm"]),
        op("Return"),
      ],
    },
    { name: "child", locals: [100], ops: [op("Wait", [], [0.2]), op("Exit")] },
  ]);
  const task = g.startScript("parent");
  g.tick(0.1);
  assert.equal(g.banks.ScenarioFlag1?.[1], undefined);
  for (let tick = 0; tick < 5; tick++) g.tick(0.1);
  assert.equal(task.done, true);
  assert.equal(task.locals[0], 8);
  assert.equal(g.banks.ScenarioFlag1[1], 1);
});

test("a tail replacement inside a called script retains the suspended outer caller", () => {
  const g = game([
    {
      name: "parent",
      ops: [
        op("ChangeScript", [1], [], ["child"]),
        op("SetFlag", [2], [], ["ScenarioFlag1"]),
        op("Exit"),
      ],
    },
    {
      name: "child",
      ops: [
        op("ChangeScript", [0], [], ["leaf"]),
        op("SetFlag", [99], [], ["ScenarioFlag1"]),
        op("Exit"),
      ],
    },
    {
      name: "leaf",
      ops: [op("SetFlag", [3], [], ["ScenarioFlag1"]), op("Exit")],
    },
  ]);
  g.startScript("parent");
  g.tick(0.1);
  assert.equal(g.banks.ScenarioFlag1[2], 1);
  assert.equal(g.banks.ScenarioFlag1[3], 1);
  assert.equal(g.banks.ScenarioFlag1[99], undefined);
});
