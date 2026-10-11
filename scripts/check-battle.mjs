import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { compileOpeningBattle } from "../dist/src/compiler/battle.js";
const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const saved = JSON.parse(
  await readFile(
    new URL("../build/game/opening-battle.json", import.meta.url),
    "utf8",
  ),
);
const rebuilt = await compileOpeningBattle(root);
assert.equal(
  saved.contentHash,
  rebuilt.contentHash,
  "Battle compilation must be reproducible",
);
const opening = saved.encounters.find((e) => e.partyId === 3);
assert.deepEqual(
  saved.encounters.map((e) => e.partyId),
  [1, 2, 3, 42],
);
assert.deepEqual(
  opening.enemies.map((e) => [e.slot, e.monsterId]),
  [
    [5, 1],
    [9, 1],
  ],
);
assert.deepEqual(
  saved.initialParty.map((c) => c.characterId),
  [1, 31, 32],
);
assert.equal(saved.tables["monster.csv"]["1"].values.hp, "40");
assert.deepEqual(
  saved.magitekAbilityIds,
  [218, 219, 220, 221, 222, 223, 224, 225],
);
assert.equal(saved.tables["function.csv"]["3"].values.type_id, "3");
for (const group of Object.values(saved.tables["function_group.csv"]))
  for (const [key, value] of Object.entries(group.values))
    if (/^function\d+_id$/.test(key) && Number(value))
      assert.ok(
        saved.tables["function.csv"][String(Number(value))],
        "Unresolved battle function",
      );
assert.equal(
  opening.script.source.assetPath.split("/").at(-1),
  "sc_b_0239.json",
);
assert.equal(
  opening.enemies[0].ai.source.assetPath.split("/").at(-1),
  "sc_ai_000_Guard.json",
);
assert.deepEqual(saved.atb, {
  coefficient: 21,
  enemyCoefficient: 12,
  total: 550,
  maxHighSpeed: 50,
  maxLowSpeed: 50,
});
assert.deepEqual(saved.reactions, { counterLimit: 1, excludedAbilityIds: [696, 1140, 1262] });
assert.ok(saved.reactionSource.assetPath.endsWith("/serial_misc_assets.json"));
assert.match(saved.reactionSource.objectId, /^-?\d+$/);
const background = saved.sprites[opening.background];
assert.deepEqual([background.width, background.height], [512, 256]);
for (const s of Object.values(saved.sprites)) {
  assert.equal(typeof s.source.objectId, "string");
  assert.equal(s.representation, "source-texture-full-rect");
  const png = await readFile(
    new URL("../build/battle/" + s.file, import.meta.url),
  );
  assert.equal(png.readUInt32BE(16), s.width);
  assert.equal(png.readUInt32BE(20), s.height);
}
console.log(
  JSON.stringify({
    contentHash: saved.contentHash,
    encounterParties: saved.encounters.length,
    characters: 3,
    sprites: Object.keys(saved.sprites).length,
    sourceDataVerified: true,
    battleExecutable: false,
  }),
);
