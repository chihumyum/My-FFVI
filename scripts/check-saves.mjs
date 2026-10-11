// Existing source fixtures exercise the shared checkpoint boundary, not additional playable regions.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { GameSession } from "../dist/src/core/game-session.js";
import {
  encodeSavedGame,
  decodeSavedGame,
} from "../dist/src/core/saved-game.js";
import {
  verifyContent,
  contentDigest,
} from "../dist/src/core/content-integrity.js";
const root = new URL("..", import.meta.url);
const read = async (path) =>
  verifyContent(JSON.parse(await readFile(new URL(path, root), "utf8")));
const field = await read("build/game/narshe.json");
const battle = await read("build/game/opening-playable.json");
const catalog = await read("build/world/catalog.json");
const prior = await read("build/reports/world-check.json");
assert.equal(prior.catalogHash, catalog.contentHash);
assert.equal(prior.bootstrapHash, field.contentHash);
async function restore(game, world, bootstrap = field, definitions = battle) {
  const checkpoint = game.checkpoint();
  const file = await encodeSavedGame(checkpoint, 0);
  const saved = await decodeSavedGame(file);
  const restored = GameSession.restore(saved.checkpoint, bootstrap, definitions, world);
  assert.deepEqual(restored.checkpoint(), checkpoint);
  assert.equal(
    restored.continueVictory(),
    false,
    "Reading a completed reward cannot award it again",
  );
  return restored;
}

async function street(reload) {
  let game = new GameSession(field, battle);
  let restores = 0;
  function settle() {
    for (let n = 0; n < 12000; n++) {
      if (game.battle) {
        assert.notEqual(game.battle.phase, "defeat");
        if (game.battle.phase === "victory") {
          game.continueVictory();
          continue;
        }
        for (const actor of game.battle.ready) {
          const ally = game.battle.players.find(
            (p) => p.hp > 0 && p.hp < p.maxHp * 0.6,
          );
          const target = ally ?? game.battle.targets(actor.id, 218)[0];
          if (target)
            game.battle.command(actor.id, ally ? 222 : 218, target.id);
        }
      } else {
        assert.equal(game.field.stop, null);
        if (game.field.dialogue) game.field.confirm();
        if (game.checkpointReady) return;
      }
      game.advance(10);
    }
    assert.fail(
      "Event/battle continuation failed to reach a stable checkpoint",
    );
  }
  async function walk(direction, count) {
    for (let n = 0; n < count; n++) {
      assert.equal(game.field.move(direction), true);
      game.advance(240);
      settle();
      if (reload) {
        game = await restore(game);
        restores++;
      }
    }
  }
  await walk("up", 11);
  await walk("down", 1);
  await walk("right", 3);
  await walk("left", 3);
  await walk("up", 13);
  await walk("up", 9);
  assert.deepEqual(game.completedEncounters, [3, 1, 2, 3, 42]);
  assert.deepEqual([game.field.player.x, game.field.player.y], [38, 17]);
  assert.equal(game.field.hiddenEntities.has("155"), true);
  return { checkpoint: game.checkpoint(), restores };
}
const uninterrupted = await street(false),
  reloaded = await street(true);
assert.deepEqual(
  reloaded.checkpoint,
  uninterrupted.checkpoint,
  "Repeated reloads preserve the entire next encounter/field outcome, including seeds and rewards",
);

const runs = [];
// Full native party MapSetup remains a formal game gate. Keep the independent
// geometry/checkpoint mechanism probe explicit instead of discarding that host
// silently while calling it a migrated game transition.
const geometryField = structuredClone(field), geometryBattle = structuredClone(battle);
delete geometryField.entry.partyActors;
delete geometryBattle.gameState.partyActors;
for (const content of [geometryField, geometryBattle]) {
  const { contentHash: _, ...payload } = content;
  content.contentHash = await contentDigest(payload);
}
let formalMapBoundaryChecked = false;
for (const entry of prior.runs.filter((r) => r.result === "idle")) {
  const map = await read(`build/world/maps/${entry.mapId}.json`);
  assert.equal(map.contentHash, entry.contentHash);
  if (!formalMapBoundaryChecked) {
    const formal = new GameSession(field, battle), owned = formal.state.snapshot();
    formal.field.previewMap(entry.mapId, entry.entrance);
    assert.throws(() => formal.world.prepare(catalog, map), /队伍演员初始化/);
    assert.deepEqual(formal.state.snapshot(), owned);
    formalMapBoundaryChecked = true;
  }
  const game = new GameSession(geometryField, geometryBattle);
  game.field.previewMap(entry.mapId, entry.entrance);
  assert.equal(game.world.commit(game.world.prepare(catalog, map)), true);
  assert.equal(
    game.checkpointReady,
    true,
    `Existing idle entrance ${entry.mapId}/${entry.entrance}`,
  );
  const copy = await restore(game, { catalog, map }, geometryField, geometryBattle);
  game.advance(500);
  for (const dt of [47, 153, 300]) copy.advance(dt);
  assert.deepEqual(copy.checkpoint(), game.checkpoint());
  runs.push({
    mapId: entry.mapId,
    entrance: entry.entrance,
    contentHash: map.contentHash,
    result: "pass",
  });
}
const report = {
  formatVersion: 1,
  kind: "source-checkpoint-check",
  profile: "game-checkpoint-v2",
  sourceSetHash: field.parentSourceSetHash,
  bootstrapHash: field.contentHash,
  battleCatalogHash: battle.contentHash,
  worldCatalogHash: catalog.contentHash,
  worldReportHash: prior.contentHash,
  street: {
    restores: reloaded.restores,
    encounters: [3, 1, 2, 3, 42],
    result: "pass",
  },
  runs,
  worldMechanismProfile: { bootstrapHash: geometryField.contentHash,
    battleCatalogHash: geometryBattle.contentHash, nativePartyLifecycle: false,
    formalMapBoundaryChecked },
  lane: "source-backed-implementation",
  limitations: [
    "Idle map checkpoints only; no active event or battle continuation save.",
    "Existing development entrances are mechanism probes, not new playable maps or story reachability.",
    "Formal native-party map transitions remain blocked; the separate geometry probe explicitly omits that host.",
    "Does not establish original-game save format, save permission, parity or browser storage behavior.",
  ],
};
const contentHash = await contentDigest(report);
await writeFile(
  new URL("build/reports/save-check.json", root),
  JSON.stringify({ ...report, contentHash }, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      profile: report.profile,
      street: report.street,
      existingIdleEntrances: runs.length,
      maps: new Set(runs.map((r) => r.mapId)).size,
      contentHash,
    },
    null,
    2,
  ),
);
