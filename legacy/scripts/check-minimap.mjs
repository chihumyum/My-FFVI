// Source marker inventory plus actual movement/transition probes. This is not a story-playthrough oracle.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { WorldSession } from "../dist/src/core/world-session.js";
import {
  minimapMarkers,
  requireMinimapMedia,
} from "../dist/src/core/minimap.js";
import { verifyContent } from "../dist/src/core/content-integrity.js";
import { canonical, hash } from "../dist/src/compiler/content.js";
import { loadMinimapMedia } from "../dist/src/compiler/map-ui.js";
const root = new URL("..", import.meta.url);
const read = async (path) =>
  verifyContent(JSON.parse(await readFile(new URL(path, root), "utf8")));
const catalog = await read("build/world/catalog.json"),
  bootstrap = await read("build/game/narshe.json");
const media = await loadMinimapMedia(
  root.pathname.replace(/\/$/, ""),
  catalog.parentSourceSetHash,
);
assert.deepEqual(media, catalog.minimap);
const checked = await read("build/reports/world-check.json");
assert.equal(checked.catalogHash, catalog.contentHash);
assert.equal(checked.bootstrapHash, bootstrap.contentHash);
const ready = new Set(
  checked.runs.filter((r) => r.result === "idle").map((r) => r.mapId),
);
const packages = new Map(),
  groups = new Map(),
  counts = {},
  roundTrips = [];
for (const id of Object.keys(catalog.maps)) {
  const pkg = await read(`build/world/maps/${id}.json`);
  assert.equal(pkg.contentHash, catalog.maps[id].contentHash);
  packages.set(Number(id), pkg);
  for (const group of Object.values(pkg.map?.groups ?? {})) {
    const key = canonical(group.source);
    if (groups.has(key)) continue;
    const markers = minimapMarkers(group.entities);
    requireMinimapMedia(group.entities, media);
    groups.set(key, { source: group.source, markers });
    for (const marker of markers)
      counts[marker.icon] = (counts[marker.icon] ?? 0) + 1;
  }
}
const direction = (from, to) => {
  if (from.layer !== to.layer || to.width !== 1 || to.height !== 1) return null;
  return (
    new Map([
      ["0,-1", "up"],
      ["1,0", "right"],
      ["0,1", "down"],
      ["-1,0", "left"],
    ]).get(`${to.x - from.x},${to.y - from.y}`) ?? null
  );
};
const entities = (pkg) => pkg.map.groups.entity_default.entities;
// Discover adjacent source entrance/exit pairs whose destination has an adjacent return exit.
for (const run of checked.runs.filter((r) => r.result === "idle")) {
  const origin = packages.get(run.mapId),
    sourceEntities = entities(origin);
  const entry = sourceEntities.find(
    (e) => e.kind === 0 && e.objectId === run.entrance,
  );
  for (const exit of sourceEntities.filter(
    (e) => e.kind === 3 && ready.has(e.destination.mapId),
  )) {
    const step = direction(entry, exit);
    if (!step) continue;
    const target = packages.get(exit.destination.mapId),
      targetEntities = entities(target);
    const arrival = targetEntities.find(
      (e) => e.kind === 0 && e.objectId === exit.destination.entrance,
    );
    if (!arrival) continue;
    const back = targetEntities.find(
      (e) =>
        e.kind === 3 &&
        e.destination.mapId === run.mapId &&
        e.destination.entrance === run.entrance &&
        direction(arrival, e),
    );
    if (!back) continue;
    const world = new WorldSession(bootstrap);
    world.field.previewMap(run.mapId, run.entrance);
    assert.ok(world.commit(world.prepare(catalog, origin)));
    const initialMarkers = minimapMarkers(world.field.minimapEntities);
    const doors = [];
    for (const [input, destination] of [
      [step, target],
      [direction(arrival, back), origin],
    ]) {
      if (!world.field.move(input)) {
        assert.equal(world.field.stop, null);
        assert.ok(
          world.field.openTriggers.busy,
          "Transition step blocked without a door animation",
        );
        const pending = world.field.openTriggers.snapshot().pending;
        let elapsed = 0;
        while (world.field.openTriggers.busy && elapsed < 60000) {
          world.field.advance(10);
          elapsed += 10;
        }
        assert.equal(world.field.busy, false);
        assert.equal(world.field.openTriggers.blocks(pending.trigger), false);
        doors.push({
          mapId: world.field.content.map.identity.mapId,
          ...pending,
          elapsed,
        });
        assert.ok(world.field.move(input));
      }
      world.field.advance(240);
      assert.equal(world.field.stop?.kind, "map-transition");
      assert.equal(world.field.stop.request.mapId, destination.mapId);
      assert.ok(world.commit(world.prepare(catalog, destination)));
      assert.equal(world.field.busy, false);
      assert.deepEqual(
        minimapMarkers(world.field.minimapEntities),
        minimapMarkers(entities(destination)),
      );
    }
    assert.deepEqual(
      minimapMarkers(world.field.minimapEntities),
      initialMarkers,
    );
    assert.deepEqual(
      [world.field.player.x, world.field.player.y],
      [entry.x, entry.y],
    );
    roundTrips.push({
      mapId: run.mapId,
      entrance: run.entrance,
      via: target.mapId,
      inputs: [step, direction(arrival, back)],
      doors,
      transitions: world.transitions,
      markerCount: initialMarkers.length,
    });
  }
}
assert.ok(roundTrips.length, "No source round-trip probe executed");
const report = {
  formatVersion: 1,
  kind: "source-minimap-check",
  catalogHash: catalog.contentHash,
  bootstrapHash: bootstrap.contentHash,
  minimapSourceSetHash: media.sourceSetHash,
  uniqueGroups: groups.size,
  markerCounts: counts,
  roundTrips,
  limitations: [
    "Source metadata and adjacent transitions only; not full map or story acceptance.",
    "Browser layout, minimap shader/filter parity and full-game reachability are separate checks.",
  ],
};
await writeFile(
  new URL("build/reports/minimap-check.json", root),
  canonical({ ...report, contentHash: hash(report) }) + "\n",
);
console.log(
  JSON.stringify(
    {
      groups: groups.size,
      markerCounts: counts,
      roundTrips: roundTrips.length,
      reportHash: hash(report),
    },
    null,
    2,
  ),
);
