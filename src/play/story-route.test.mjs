import test from "node:test";
import assert from "node:assert/strict";
import { nextStoryObjective, storyChoice } from "./story-plan.js";

test("changing a disguise does not repeat an already observed clothing objective", () => {
  const game = {
    banks: { ScenarioFlag1: { 50: 1, 51: 1, 52: 0, 53: 1 } },
    history: [],
    completedStoryObjectives: ["merchant-clothes", "merchant-passage"],
  };
  const before = JSON.stringify(game.banks);
  assert.equal(nextStoryObjective(game).id, "change-guard");
  assert.equal(JSON.stringify(game.banks), before);
});

test("the source password choice uses the planned ordinary answer without changing game state", () => {
  const game = {
    banks: { ScenarioFlag1: { 50: 1, 51: 1, 53: 1, 54: 1, 55: 1, 56: 1 } },
    history: [],
    completedStoryObjectives: ["merchant-clothes", "merchant-passage"],
    data: { programs: { 0: { name: "sc_e_0076" } } },
    dialogue: { task: { program: 0 } },
  };
  assert.equal(nextStoryObjective(game).id, "password");
  assert.equal(storyChoice(game), 1);
  assert.equal(game.banks.ScenarioFlag1[57], undefined);
});
