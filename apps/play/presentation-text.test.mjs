import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { presentText } from "./presentation.js";

test("every PR full-space control token becomes spacing, including train, letters and opera", async () => {
  const data = JSON.parse(
      await readFile(new URL("../../build/web-data/data.json", import.meta.url)),
    ),
    rows = Object.entries(data.messages).filter(([, text]) => text.includes("(FULL_SPACE)")),
    game = { roster: {}, battleData: { characters: {} } };
  assert.ok(rows.length >= 26, "Audit the entire PR message table");
  for (const [key, text] of rows) {
    const output = presentText(game, text);
    assert.equal(output.includes("(FULL_SPACE)"), false, key);
    assert.equal(
      output.match(/　/g)?.length || 0,
      (text.match(/　/g)?.length || 0) + (text.match(/\(FULL_SPACE\)/g)?.length || 0),
      key,
    );
  }
});
