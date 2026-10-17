// Isolated source region playback plus actual source entrance inventory; not an original-game oracle.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { TileAnimationState } from "../dist/src/core/tile-animation.js";
import { FieldGame } from "../dist/src/core/field.js";
import { verifyContent } from "../dist/src/core/content-integrity.js";
import { canonical, hash } from "../dist/src/compiler/content.js";

const root = new URL("..", import.meta.url);
const read = async (path) =>
  verifyContent(JSON.parse(await readFile(new URL(path, root), "utf8")));
const catalog = await read("build/world/catalog.json"),
  world = await read("build/reports/world-check.json");
assert.equal(world.catalogHash, catalog.contentHash);
const runs = [],
  excluded = [],
  entrances = [],
  instructions = new Map(),
  scriptRuns = [];
const bootstrap = await read("build/game/narshe.json");
assert.equal(world.bootstrapHash, bootstrap.contentHash);
const allowed = new Set([
  "nop",
  "exit",
  "join",
  "return",
  "call",
  "wait",
  "puppet",
  "animation-cue",
  "animation-play",
]);
for (const [mapId, indexed] of Object.entries(catalog.maps)) {
  const content = await read(`build/world/maps/${mapId}.json`);
  assert.equal(indexed.contentHash, content.contentHash);
  if (!content.map) continue;
  for (const ops of Object.values(content.scripts))
    for (const op of ops) {
      if (["animation-cue", "animation-play"].includes(op.kind))
        instructions.set(canonical(op.source), op.kind);
    }
  const groups = Object.values(content.map.groups ?? {});
  for (const group of groups)
    for (const entity of group.entities.filter((e) => e.kind === 1)) {
      const identity = {
        mapId: Number(mapId),
        mapHash: content.contentHash,
        group: group.name,
        entityId: entity.id,
        source: entity.source,
      };
      const reasons = group.blockers
        .filter((b) => canonical(b.source) === canonical(entity.source))
        .map((b) => b.reason);
      if (reasons.length || !entity.tileAnimation?.cells) {
        excluded.push({ ...identity, reasons });
        continue;
      }
      const state = new TileAnimationState(content.map);
      state.register([entity]);
      const cells = Object.entries(state.snapshot().cells),
        duration = Math.max(0, ...cells.map(([, c]) => c.total));
      if (duration > 60000) {
        excluded.push({ ...identity, reasons: ["isolated-playback-budget"] });
        continue;
      }
      const pixels = () =>
        entity.tileAnimation.cells.map((c) => state.tile(c.layer, c.index));
      const initial = pixels();
      state.advance(1000);
      assert.deepEqual(pixels(), initial);
      state.cue(entity.id, 1);
      for (const [key, c] of cells) {
        const [layer, index] = key.split(":").map(Number);
        assert.equal(state.tile(layer, index), c.frames.at(-1).tile);
      }
      const finalHash = hash(pixels());
      state.cue(entity.id, 0);
      assert.deepEqual(pixels(), initial);
      state.play(entity.id, false, 1);
      let elapsed = 0;
      while (state.isPlaying(entity.id) && elapsed <= duration + 20) {
        state.advance(10);
        elapsed += 10;
      }
      assert.equal(state.isPlaying(entity.id), false);
      assert.equal(hash(pixels()), finalHash);
      runs.push({
        ...identity,
        cells: cells.length,
        reverse: entity.tileAnimation.reverse,
        initialHash: hash(initial),
        finalHash,
        elapsed,
      });
    }
  const regions = content.map.groups.entity_default.entities.filter(
    (e) => e.tileAnimation?.cells?.length,
  );
  const readyRegions = content.map.groups.entity_default.entities.filter(
    (e) =>
      e.tileAnimation?.cells &&
      !content.map.groups.entity_default.blockers.some(
        (b) => canonical(b.source) === canonical(e.source),
      ),
  );
  for (const [name, ops] of Object.entries(content.scripts)) {
    if (
      !ops.some((o) => o.kind.startsWith("animation-")) ||
      !ops.every((o) => allowed.has(o.kind))
    )
      continue;
    const puppets = ops.filter((o) => o.kind === "puppet");
    if (
      !puppets.length ||
      !puppets.every((o) => readyRegions.some((e) => e.id === o.actor))
    )
      continue;
    const selected = readyRegions.filter((e) =>
      puppets.some((o) => o.actor === e.id),
    );
    const game = new FieldGame({
      ...bootstrap,
      map: {
        ...content.map,
        entities: selected,
        groups: undefined,
        initialGroups: undefined,
      },
      scripts: { [name]: ops },
      scriptLocals: { [name]: content.scriptLocals[name] },
    });
    game.startEvent(name);
    let elapsed = 0;
    while (game.busy && !game.stop && elapsed < 60000) {
      game.advance(10);
      elapsed += 10;
    }
    scriptRuns.push({
      mapId: Number(mapId),
      mapHash: content.contentHash,
      script: name,
      source: ops[0].source,
      regions: selected.map((e) => e.id),
      elapsed,
      outcome: game.stop ? "blocked" : game.busy ? "budget" : "complete",
      stop: game.stop,
      stateHash: hash(game.tileAnimations.snapshot()),
    });
  }
  for (const entry of world.runs.filter(
    (r) => r.mapId === Number(mapId) && r.result === "idle",
  ))
    if (regions.length)
      entrances.push({
        ...entry,
        regions: regions.map((e) => ({
          id: e.id,
          x: e.x,
          y: e.y,
          width: e.width,
          height: e.height,
          cells: e.tileAnimation.cells.length,
        })),
      });
}
const counts = {
  regionBindings: runs.length,
  uniqueSourceRegions: new Set(runs.map((r) => canonical(r.source))).size,
  uniqueAnimatedSourceRegions: new Set(
    runs.filter((r) => r.cells).map((r) => canonical(r.source)),
  ).size,
  animatedBindings: runs.filter((r) => r.cells).length,
  emptyBindings: runs.filter((r) => !r.cells).length,
  excludedBindings: excluded.length,
  decodedCueOps: [...instructions.values()].filter((k) => k === "animation-cue")
    .length,
  decodedPlayOps: [...instructions.values()].filter(
    (k) => k === "animation-play",
  ).length,
  idleEntrancesWithRegions: entrances.length,
  idleMapsWithRegions: new Set(entrances.map((e) => e.mapId)).size,
  sourceScriptBindings: scriptRuns.length,
  completedScriptBindings: scriptRuns.filter((r) => r.outcome === "complete")
    .length,
  uniqueCompletedScripts: new Set(
    scriptRuns
      .filter((r) => r.outcome === "complete")
      .map((r) => canonical(r.source)),
  ).size,
};
const report = {
  formatVersion: 1,
  kind: "tile-animation-batch-check",
  lane: "implementation-only",
  catalogHash: catalog.contentHash,
  bootstrapHash: bootstrap.contentHash,
  worldCheckHash: world.contentHash,
  sourceSetHash: catalog.sourceSetHash,
  counts,
  runs,
  excluded,
  entrances,
  scriptRuns,
  limitations: [
    "Each region is isolated from other source entities and scripts for the playback probe.",
    "Source VM probes run exact scripts whose complete opcode inventory is supported and whose puppets refer only to default tile regions; unrelated source entities and initialization are absent.",
    "Decoded animation op counts include actor/effect targets that still stop at runtime.",
    "Empty bindings are valid source rectangles without matching animated cells, not animation coverage.",
    "Source entrances use the development traveler; story reachability and original runtime parity remain unknown.",
  ],
};
await writeFile(
  new URL("build/reports/tile-animation-check.json", root),
  canonical({ ...report, contentHash: hash(report) }) + "\n",
);
console.log(JSON.stringify({ counts, contentHash: hash(report) }, null, 2));
assert.ok(counts.animatedBindings > 0);
assert.ok(counts.sourceScriptBindings > 0);
assert.equal(counts.completedScriptBindings, counts.sourceScriptBindings);
