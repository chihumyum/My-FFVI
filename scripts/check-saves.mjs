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

const runs = [], nativePartyRuns = [], nativePartyBoundaryChecks = [];
// Exercise a real source ordinary entrance with the shared owned/actor host.
// Selecting an already-idle source entry is a controlled lifecycle probe; it
// does not claim the story has reached that map from the opening.
let nativeFixture;
for (const entry of prior.runs.filter((r) => r.result === "idle")) {
  const map = await read(`build/world/maps/${entry.mapId}.json`);
  const point = map.partyEntry?.pointIns.find((p) => p.id === entry.entrance);
  if (!point || point.linkObject !== 0 || map.partyEntry.loopType !== 0 || map.partyEntryBlockers?.length ||
      map.partyEntry.conditionColliders.some((c) => c.collisionType !== 0 && c.throughConditionType !== 0)) continue;
  nativeFixture = { map, entry }; break;
}
assert.ok(nativeFixture, "A source ordinary PointIn must exercise the native actor lifecycle");
{
  const { map, entry } = nativeFixture;
  const game = new GameSession(field, battle), old = game.field,
    oldActors = old.partyActorCheckpoint;
  assert.ok(oldActors);
  old.hiddenEntities.add("-1001");
  old.previewMap(entry.mapId, entry.entrance);
  const prepared = game.world.prepare(catalog, map);
  assert.equal(game.world.commit(prepared), true);
  assert.equal(game.world.commit(prepared), false);
  assert.equal(game.checkpointReady, true);
  const point = map.partyEntry.pointIns.find((p) => p.id === entry.entrance);
  assert.deepEqual([game.field.player.x, game.field.player.y, game.field.player.layer, game.field.player.direction],
    [point.x, point.y, point.layer, point.direction]);
  assert.equal(game.field.hiddenEntities.has("-1001"), true);
  assert.deepEqual(game.field.partyActorCheckpoint.context.puppets, oldActors.context.puppets);
  assert.equal(game.field.transportationId, 6);
  assert.deepEqual(game.field.content.entry.cameraOffset, { x: 0, y: 16 });
  assert.equal(game.world.checkpoint().location.traveler, null);
  assert.deepEqual(game.field.content.treasureInventoryLimits, battle.gameState.limits && {
    item: battle.gameState.limits.item, gil: battle.gameState.limits.gil });
  const copy = await restore(game, { catalog, map });
  assert.deepEqual(copy.field.content.entry.cameraOffset, game.field.content.entry.cameraOffset);
  nativePartyRuns.push({ mapId: entry.mapId, entrance: entry.entrance, contentHash: map.contentHash,
    result: "pass", mode: "source-ordinary-entry-controlled-probe", transportationId: 6, cameraOffset: { x: 0, y: 16 } });
  // A current unknown value remains unknown after checkpoint restore. A source
  // bootstrap seed is not a repair policy for saved event state.
  const unknown = game.checkpoint();
  unknown.world.field.eventState.scenario[2 * 256 + 45] = null;
  const missing = GameSession.restore(unknown, field, battle, { catalog, map });
  missing.field.previewMap(entry.mapId, entry.entrance);
  assert.throws(() => missing.world.prepare(catalog, map), /Unknown.*switching flag/);
  nativePartyBoundaryChecks.push({ name: "restored-unknown-party-flag", result: "blocked" });
  for (const [name, change, pattern] of [
    ["multi-party-placement", (g) => g.field.eventState.write({ category: "ScenarioFlag3", index: 45 }, 1), /party placement/],
    ["disabled-vehicle-release", (g) => g.field.eventState.write({ category: "TreasureFlag4", index: 137 }, 0), /Disabled current map transportation/],
    ["saved-position-native-path", (g) => { g.field.stop.request.entrance = -1; }, /Saved-position/],
    ["bird-view", (g) => { g.field.stop.request.birdview = true; }, /view\/loop/],
  ]) {
    const gate = new GameSession(field, battle), owned = gate.state.snapshot(), old = gate.field;
    gate.field.previewMap(entry.mapId, entry.entrance);
    change(gate);
    const variables = gate.field.eventState.snapshot();
    assert.throws(() => gate.world.prepare(catalog, map), pattern);
    assert.equal(gate.field, old);
    assert.deepEqual(gate.state.snapshot(), owned);
    assert.deepEqual(gate.field.eventState.snapshot(), variables);
    nativePartyBoundaryChecks.push({ name, result: "blocked" });
  }
  for (const [name, change] of [
    ["forged-condition-residents", (s) => { s.world.field.partyActors.context.conditionResidents = []; }],
    ["forged-camera-provider", (s) => { s.world.field.partyActors.context.camera.mapArea.width = 123; }],
    ["duplicate-traveler-owner", (s) => { s.world.location.traveler = { asset: "mo_ff6_p001", mount: "mo_ff6_v006_c00", transportationId: 6 }; }],
  ]) {
    const bad = game.checkpoint(); change(bad);
    assert.throws(() => GameSession.restore(bad, field, battle, { catalog, map }));
    nativePartyBoundaryChecks.push({ name, result: "blocked" });
  }
}
// Keep the independent geometry/checkpoint mechanism profile separate. It does
// not own native actors and cannot count as a native party lifecycle check.
const geometryField = structuredClone(field), geometryBattle = structuredClone(battle);
delete geometryField.entry.partyActors;
delete geometryBattle.gameState.partyActors;
for (const content of [geometryField, geometryBattle]) {
  const { contentHash: _, ...payload } = content;
  content.contentHash = await contentDigest(payload);
}
for (const entry of prior.runs.filter((r) => r.result === "idle")) {
  const map = await read(`build/world/maps/${entry.mapId}.json`);
  assert.equal(map.contentHash, entry.contentHash);
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
  nativePartyRuns,
  nativePartyBoundaryChecks,
  worldMechanismProfile: { bootstrapHash: geometryField.contentHash,
    battleCatalogHash: geometryBattle.contentHash, nativePartyLifecycle: false,
    ordinaryPartyEntryCheckedSeparately: true },
  lane: "source-backed-implementation",
  limitations: [
    "Idle map checkpoints only; no active event or battle continuation save.",
    "Existing development entrances are mechanism probes, not new playable maps or story reachability.",
    "Ordinary source MapSetup/PointIn uses the native actor host; unknown state and unimplemented multi-party/view/saved-position paths remain blocked.",
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
      nativePartyEntries: nativePartyRuns.length,
      nativePartyBlockedDependencies: nativePartyBoundaryChecks.length,
      maps: new Set(runs.map((r) => r.mapId)).size,
      contentHash,
    },
    null,
    2,
  ),
);
