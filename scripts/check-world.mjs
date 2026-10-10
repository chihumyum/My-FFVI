import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { WorldSession } from "../dist/src/core/world-session.js";
import { verifyContent } from "../dist/src/core/content-integrity.js";
import { canonical, hash } from "../dist/src/compiler/content.js";
const root = new URL("..", import.meta.url);
const read = async (path) =>
  verifyContent(JSON.parse(await readFile(new URL(path, root), "utf8")));
const catalog = await read("build/world/catalog.json"),
  bootstrap = await read("build/game/narshe.json");
const runs = [],
  exclusions = [],
  geometry = {},
  entities = {};
for (const [id, indexed] of Object.entries(catalog.maps)) {
  const target = await read(`build/world/maps/${id}.json`);
  assert.equal(target.contentHash, indexed.contentHash);
  for (const blocker of target.blockers)
    geometry[blocker.reason] = (geometry[blocker.reason] ?? 0) + 1;
  for (const blocker of target.map?.groups?.entity_default?.blockers ?? [])
    entities[blocker.reason] = (entities[blocker.reason] ?? 0) + 1;
  if (!indexed.geometryReady || !indexed.defaultGroupReady) {
    exclusions.push({
      mapId: Number(id),
      reason: !indexed.geometryReady
        ? "geometry-or-package"
        : "default-entities",
    });
    continue;
  }
  const entries = target.map.groups.entity_default.entities.filter(
    (e) => e.kind === 0,
  );
  if (!entries.length)
    exclusions.push({ mapId: Number(id), reason: "no-default-entrance" });
  for (const entry of entries) {
    const world = new WorldSession(bootstrap);
    world.field.previewMap(Number(id), entry.objectId);
    const before = world.field,
      state = canonical(before.eventState.snapshot());
    try {
      const prepared = world.prepare(catalog, target);
      assert.equal(world.commit(prepared), true);
      assert.notEqual(world.field, before);
      assert.deepEqual(
        [world.field.player.x, world.field.player.y],
        [entry.x, entry.y],
      );
      runs.push({
        mapId: Number(id),
        entrance: entry.objectId,
        result: world.field.busy ? "event-pending" : "idle",
        contentHash: target.contentHash,
      });
    } catch (error) {
      assert.equal(world.field, before);
      assert.equal(canonical(before.eventState.snapshot()), state);
      runs.push({
        mapId: Number(id),
        entrance: entry.objectId,
        result: "blocked",
        reason: error.message,
      });
    }
  }
}
const report = {
  formatVersion: 1,
  kind: "source-map-load-check",
  sourceSetHash: catalog.sourceSetHash,
  catalogHash: catalog.contentHash,
  mediaSourceSetHash: catalog.mediaSourceSetHash,
  bootstrapHash: bootstrap.contentHash,
  runs,
  exclusions,
  blockers: { geometry, entities },
  limitations: [
    "Uses the explicit opening development traveler and unknown story flags.",
    "Loads source default entrances; does not establish story reachability, completed initialization, image rendering or original parity.",
  ],
};
await mkdir(new URL("build/reports/", root), { recursive: true });
await writeFile(
  new URL("build/reports/world-check.json", root),
  canonical({ ...report, contentHash: hash(report) }) + "\n",
);
console.log(
  JSON.stringify(
    {
      maps: Object.keys(catalog.maps).length,
      attemptedMaps: new Set(runs.map((r) => r.mapId)).size,
      entries: runs.length,
      loaded: runs.filter((r) => r.result !== "blocked").length,
      idle: runs.filter((r) => r.result === "idle").length,
      blocked: runs.filter((r) => r.result === "blocked").length,
      excluded: exclusions.length,
      reportHash: hash(report),
    },
    null,
    2,
  ),
);
