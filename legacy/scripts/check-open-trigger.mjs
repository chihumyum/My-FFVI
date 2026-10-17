// Source-data contact/entry probes. Unrelated NPCs, story initialization and original parity are separate lanes.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { TileAnimationState } from "../dist/src/core/tile-animation.js";
import { OpenTriggerState } from "../dist/src/core/open-trigger.js";
import { verifyContent } from "../dist/src/core/content-integrity.js";
import { canonical, hash } from "../dist/src/compiler/content.js";

const root = new URL("..", import.meta.url);
const read = async (p) =>
  verifyContent(JSON.parse(await readFile(new URL(p, root), "utf8")));
const catalog = await read("build/world/catalog.json"),
  world = await read("build/reports/world-check.json"),
  bootstrap = await read("build/game/narshe.json");
assert.equal(world.catalogHash, catalog.contentHash);
assert.equal(world.bootstrapHash, bootstrap.contentHash);
const runs = [],
  excluded = [],
  entrances = [];
const directions = [
  ["up", 1],
  ["right", 2],
  ["down", 4],
  ["left", 8],
];
for (const [mapId, indexed] of Object.entries(catalog.maps)) {
  const content = await read(`build/world/maps/${mapId}.json`);
  assert.equal(content.contentHash, indexed.contentHash);
  if (!content.map) continue;
  const groups = Object.values(content.map.groups),
    defaults = content.map.groups.entity_default;
  for (const group of groups) {
    const context = group === defaults ? [group] : [defaults, group];
    const entities = context.flatMap((g) => g.entities);
    for (const door of group.entities.filter((e) => e.kind === 8)) {
      const identity = {
        mapId: Number(mapId),
        mapHash: content.contentHash,
        group: group.name,
        entityId: door.id,
        source: door.source,
      };
      const reasons = [];
      for (const g of context)
        for (const e of g.entities.filter(
          (e) => e.kind === 1 || e.kind === 8,
        )) {
          const bad = g.blockers.filter(
            (b) => canonical(b.source) === canonical(e.source),
          );
          reasons.push(...bad.map((b) => b.reason));
        }
      for (const g of context)
        reasons.push(
          ...g.blockers
            .filter(
              (b) =>
                !g.entities.some(
                  (e) => canonical(e.source) === canonical(b.source),
                ),
            )
            .map((b) => b.reason),
        );
      if (new Set(entities.map((e) => e.id)).size !== entities.length)
        reasons.push("Duplicate context entity identity");
      if (!door.openTrigger) reasons.push("Uncompiled open trigger");
      const target =
        door.openTrigger &&
        entities.find(
          (e) => e.kind === 1 && e.objectId === door.openTrigger.linkObject,
        );
      if (!target) reasons.push("Missing linked source region");
      if (reasons.length) {
        excluded.push({ ...identity, reasons: [...new Set(reasons)] });
        continue;
      }
      const create = () => {
        const tiles = new TileAnimationState(content.map);
        tiles.register(entities.filter((e) => e.kind === 1));
        return { tiles, doors: new OpenTriggerState(tiles) };
      };
      const { tiles, doors } = create(),
        initial = tiles.snapshot();
      const checks = [];
      for (const [direction, bit] of directions) {
        const state = create(),
          accepted = !!(door.openTrigger.direction & bit);
        assert.equal(state.doors.start(door, entities, direction), accepted);
        assert.equal(state.doors.busy, accepted);
        if (!accepted) assert.deepEqual(state.tiles.snapshot(), initial);
        checks.push({ direction, accepted });
      }
      const direction = directions.find(
        ([, bit]) => door.openTrigger.direction & bit,
      )?.[0];
      if (!direction) {
        runs.push({
          ...identity,
          target: target.id,
          checks,
          outcome: "direction-disabled",
        });
        continue;
      }
      const cells = initial.regions[target.id].cells.map(
        (k) => initial.cells[k],
      );
      if (cells.some((c) => c.originalLoop)) {
        excluded.push({
          ...identity,
          reasons: [
            "Source linked region loops; native wait does not complete",
          ],
        });
        continue;
      }
      const duration = Math.max(0, ...cells.map((c) => c.total));
      if (duration > 60000) {
        excluded.push({ ...identity, reasons: ["Playback budget exceeded"] });
        continue;
      }
      assert.equal(doors.start(door, entities, direction), true);
      const peers = entities.filter(
        (e) =>
          e.kind === 8 &&
          e.id !== door.id &&
          e.openTrigger.linkObject === door.openTrigger.linkObject,
      );
      assert.ok(peers.every((e) => !doors.blocks(e.id)));
      assert.equal(doors.blocks(door.id), true);
      let elapsed = 0;
      while (doors.busy && elapsed <= duration + 20) {
        tiles.advance(10);
        doors.advance();
        elapsed += 10;
      }
      assert.equal(doors.busy, false);
      assert.equal(doors.blocks(door.id), false);
      assert.equal(doors.start(door, entities, direction), false);
      for (const key of initial.regions[target.id].cells) {
        const [layer, index] = key.split(":").map(Number);
        assert.equal(
          tiles.tile(layer, index),
          initial.cells[key].frames.at(-1).tile,
        );
      }
      const entry = create();
      entry.doors.initialize(entities, door);
      assert.equal(entry.doors.blocks(door.id), false);
      assert.equal(entry.doors.busy, false);
      runs.push({
        ...identity,
        target: target.id,
        linkedObject: door.openTrigger.linkObject,
        soundId: door.openTrigger.soundId,
        cells: cells.length,
        peers: peers.map((e) => e.id),
        checks,
        elapsed,
        outcome: "complete",
        final: doors.snapshot(),
        entry: entry.doors.snapshot(),
      });
    }
  }
  const doors = defaults.entities.filter((e) => e.openTrigger);
  if (doors.length)
    for (const row of world.runs.filter(
      (r) => r.mapId === Number(mapId) && r.result === "idle",
    ))
      entrances.push({ ...row, doors: doors.length });
}
const counts = {
  bindings: runs.length + excluded.length,
  complete: runs.filter((r) => r.outcome === "complete").length,
  uniqueCompletedSources: new Set(
    runs
      .filter((r) => r.outcome === "complete")
      .map((r) => canonical(r.source)),
  ).size,
  animatedBindings: runs.filter((r) => r.outcome === "complete" && r.cells > 0)
    .length,
  directionDisabled: runs.filter((r) => r.outcome === "direction-disabled")
    .length,
  excluded: excluded.length,
  idleEntrances: entrances.length,
  idleMaps: new Set(entrances.map((r) => r.mapId)).size,
};
const report = {
  formatVersion: 1,
  kind: "open-trigger-batch-check",
  lane: "implementation-only",
  sourceSetHash: catalog.sourceSetHash,
  catalogHash: catalog.contentHash,
  bootstrapHash: bootstrap.contentHash,
  worldCheckHash: world.contentHash,
  counts,
  runs,
  excluded,
  entrances,
  limitations: [
    "Probes use the exact default or default-plus-event source entity order and all supported tile regions in that context.",
    "NPCs, other collider types, initializer scripts and story-state reachability are excluded from isolated contact probes.",
    "Source SE IDs are retained; playback stays in the explicitly muted development lane.",
    "Idle source entrances are loading evidence, not door traversal or complete playable maps.",
    "Native original-runtime parity has not been sampled.",
  ],
};
await writeFile(
  new URL("build/reports/open-trigger-check.json", root),
  canonical({ ...report, contentHash: hash(report) }) + "\n",
);
console.log(JSON.stringify({ counts, contentHash: hash(report) }, null, 2));
assert.ok(counts.complete > 0);
