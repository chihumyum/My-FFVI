import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { compileOpeningBattle } from "../dist/src/compiler/battle.js";
import { compileOpeningPlayable } from "../dist/src/compiler/opening-playable.js";
import { GameState } from "../dist/src/core/game-state.js";
import { hash } from "../dist/src/compiler/content.js";

const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const source = await compileOpeningBattle(root);
const catalog = JSON.parse(
  await readFile(root + "/build/game/opening-playable.json", "utf8"),
);
assert.deepEqual(catalog, await compileOpeningPlayable(root, source));
const make = () =>
  new GameState(
    catalog.gameState,
    catalog.common.players,
    catalog.contentHash,
    catalog.common.conditions,
  );
const owned = make(),
  initial = owned.snapshot();
assert.deepEqual(initial.party, ["player:1", "player:31", "player:32"]);
assert.equal(initial.gil, 3000);
assert.deepEqual(initial.items, [{ id: 58, count: 1 }]);
assert.equal(catalog.gameState.items[58].itemId, 57);
assert.equal(catalog.gameState.items[58].important, true);
assert.deepEqual(catalog.gameState.limits, {
  gil: 9999999,
  item: 99,
  hp: 9999,
  mp: 999,
  exp: 15000000,
  level: 99,
});
for (const player of initial.roster) {
  const sourcePlayer =
    source.tables["character_status.csv"][player.sourceId].values;
  assert.deepEqual(
    player.equipment,
    Array.from({ length: 6 }, (_, n) =>
      Number(sourcePlayer[`content_id${n + 1}`]),
    ),
  );
}
const itemChecks = [];
for (const item of Object.values(catalog.gameState.items)) {
  const sourceContent = source.tables["content.csv"][item.id];
  const sourceItem = source.tables["item.csv"][item.itemId];
  assert.equal(sourceContent.values.type_id, "1");
  assert.equal(sourceContent.values.type_value, String(item.itemId));
  assert.equal(item.important, sourceItem.values.type_id === "2");
  owned.changeItems([{ id: item.id, count: 999 }], "grant");
  assert.equal(owned.snapshot().items.find((i) => i.id === item.id).count, 99);
  owned.changeItems([{ id: item.id, count: 1 }], "consume");
  assert.equal(owned.snapshot().items.find((i) => i.id === item.id).count, 98);
  itemChecks.push({
    contentId: item.id,
    itemId: item.itemId,
    important: item.important,
    contentSource: sourceContent.source,
    itemSource: sourceItem.source,
  });
}
const exported = JSON.parse(JSON.stringify(owned.snapshot()));
const restored = make();
restored.restore(exported);
assert.deepEqual(restored.snapshot(), owned.snapshot());
const lease = restored.openBattle(3),
  before = restored.snapshot();
const players = restored.battlePlayers(lease);
players[0].hp = 1;
assert.throws(
  () => restored.changeItems([{ id: 58, count: 1 }], "consume"),
  /reserved/,
);
assert.deepEqual(restored.snapshot(), before);
assert.equal(restored.battlePlayers(lease)[0].hp, 63);
restored.cancelBattle(lease);
const result = {
  lane: "source-owned-state-and-isolated-item-operations",
  profile: catalog.gameState.kind,
  sourceSetHash: source.parentSourceSetHash,
  battleSourceSetHash: source.sourceSetHash,
  catalogHash: catalog.contentHash,
  limits: catalog.gameState.limits,
  initialState: initial,
  itemChecks,
  snapshotRoundtrip: true,
  battleIsolation: true,
  limitations: [
    "not-a-complete-save-game",
    "not-original-game-parity",
    "only-item-content-type-one-stacks",
    "equipment-slots-preserved-but-stock-and-swap-not-implemented",
    "no-item-use-or-drop-rolls",
    "initial-ability-unlocks-and-growth-still-development-rules",
  ],
};
result.contentHash = hash(result);
await writeFile(
  root + "/build/reports/game-state-check.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    players: initial.roster.length,
    items: itemChecks.length,
    important: itemChecks.filter((i) => i.important).length,
    contentHash: result.contentHash,
    catalogHash: catalog.contentHash,
  }),
);
