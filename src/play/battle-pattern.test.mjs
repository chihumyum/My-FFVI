import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Battle } from "./battle.js";

const data = JSON.parse(
  await readFile(new URL("../../build/web-data/battle.json", import.meta.url)),
);

test("PR battle-pattern columns select their native states, including Narshe's enemy pincer", () => {
  const expected = [0, 2, 4, 5, 1, 3];
  for (let column = 0; column < 6; column++) {
    const source = {
      ...data,
      parties: {
        ...data.parties,
        1: { ...data.parties[1], battlePatterns: expected.map((_, n) => Number(n === column)) },
      },
    };
    const battle = new Battle({
      data: source,
      party: [structuredClone(data.characters[1])],
      encounterId: 1,
      random: () => 0.5,
    });
    assert.equal(battle.pattern, expected[column], `CSV battle_pattern${column + 1}`);
  }
  const opening = new Battle({
    data,
    party: [1, 31, 32].map((id) => ({ ...structuredClone(data.characters[id]), magitek: true })),
    encounterId: 42,
    random: () => 0.5,
  });
  assert.equal(opening.pattern, 4);
  assert.equal(opening.log.includes("敌方夹击"), true);
  assert(opening.players.every((unit) => unit.ignoreRow));
});
