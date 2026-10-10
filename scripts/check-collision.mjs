import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import {
  buildCollisionMapping,
  diagonalBit,
  fieldCollisionRange,
} from "../dist/src/core/collision.js";
import { FieldGame } from "../dist/src/core/field.js";
import { verifyContent } from "../dist/src/core/content-integrity.js";
import { canonical, hash } from "../dist/src/compiler/content.js";
const root = new URL("..", import.meta.url);
const read = async (path) =>
  verifyContent(JSON.parse(await readFile(new URL(path, root), "utf8")));
const catalog = await read("build/world/catalog.json"),
  bootstrap = await read("build/game/narshe.json");
const runs = [],
  skipped = [],
  failures = [],
  coverage = {};
const directions = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] };
for (const [id, indexed] of Object.entries(catalog.maps)) {
  const pkg = await read(`build/world/maps/${id}.json`);
  assert.equal(pkg.contentHash, indexed.contentHash);
  if (!pkg.map || pkg.blockers.length) {
    skipped.push({
      mapId: Number(id),
      reason: pkg.blockers[0]?.reason ?? "Missing geometry",
    });
    continue;
  }
  const map = pkg.map,
    range = fieldCollisionRange(map.width, map.height, map.entities);
  let edges = 0,
    steps = 0;
  for (const [layer, raw] of Object.entries(map.collisions)) {
    for (const value of raw)
      if (value >= 8) coverage[value] = (coverage[value] ?? 0) + 1;
    const mapping = buildCollisionMapping(raw, map.width, map.height, range);
    // Isolate source geometry: default NPCs, plot triggers and presentation are explicitly outside this probe.
    const game = new FieldGame({
      ...bootstrap,
      map: {
        ...map,
        entities: map.entities.filter((e) => e.kind === 27),
        groups: {},
        initialGroups: [],
      },
      scripts: {},
    });
    game.player.layer = Number(layer);
    for (let i = 0; i < mapping.length; i++) {
      if (!(mapping[i] & 240)) continue;
      const x = i % map.width,
        y = Math.floor(i / map.width);
      for (const dx of [-1, 1])
        for (const dy of [-1, 1]) {
          if (!(mapping[i] & diagonalBit(dx, dy))) continue;
          const to = { x: x + dx, y: y + dy },
            reverse = mapping[to.y * map.width + to.x];
          assert.ok(
            reverse & diagonalBit(-dx, -dy),
            `Non-reciprocal edge ${id}/${layer}/${i}`,
          );
          edges++;
          let reached = false;
          for (const [direction, [ix, iy]] of Object.entries(directions)) {
            if (ix !== dx && iy !== dy) continue;
            game.player.x = x;
            game.player.y = y;
            game.player.motion = null;
            const accepted = game.move(direction);
            assert.equal(
              game.stop,
              null,
              `Unknown collision ${id}/${layer}/${i}`,
            );
            if (!accepted) continue;
            game.advance(240);
            if (game.player.x === to.x && game.player.y === to.y) {
              reached = true;
              steps++;
              break;
            }
          }
          if (!reached) failures.push({ mapId: Number(id), layer, x, y, to });
        }
    }
  }
  runs.push({ mapId: Number(id), contentHash: pkg.contentHash, edges, steps });
}
const report = {
  formatVersion: 1,
  kind: "source-collision-movement-probes",
  sourceSetHash: catalog.sourceSetHash,
  catalogHash: catalog.contentHash,
  runs,
  skipped,
  failures,
  collisionCells: coverage,
  limitations: [
    "Isolated static geometry with source map range; actors, story state, event scripts and rendering are excluded.",
    "Grid movement is a development adapter to source collision mapping and collider redirection; native Physics2D timing and swept volumes are not parity-verified.",
    "These probe counts are not playable-map coverage.",
  ],
};
await writeFile(
  new URL("build/reports/collision-check.json", root),
  canonical({ ...report, contentHash: hash(report) }) + "\n",
);
console.log(
  JSON.stringify(
    {
      maps: runs.length,
      mapsWithSlopes: runs.filter((r) => r.edges > 0).length,
      directedEdges: runs.reduce((n, r) => n + r.edges, 0),
      moved: runs.reduce((n, r) => n + r.steps, 0),
      failures: failures.length,
      skipped: skipped.length,
      reportHash: hash(report),
    },
    null,
    2,
  ),
);
assert.equal(
  failures.length,
  0,
  "Source collision graph contains edges unavailable to keyboard movement",
);
