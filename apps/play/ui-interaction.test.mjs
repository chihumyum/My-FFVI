import test from "node:test";
import assert from "node:assert/strict";
import { SingleHover } from "./ui-interaction.js";

test("reflow and late leave cannot leave two controls highlighted", () => {
  const hover = new SingleHover(),
    oldButton = {},
    nextButton = {};
  hover.enter(oldButton);
  hover.enter(nextButton);
  assert.equal(oldButton.hover, false);
  assert.equal(nextButton.hover, true);
  hover.leave(oldButton);
  assert.equal(nextButton.hover, true);
  hover.clear();
  assert.equal(nextButton.hover, false);
  assert.equal(hover.current, null);
});
