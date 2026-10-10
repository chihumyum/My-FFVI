// Source-backed isolated group execution; minimap media is checked, no story oracle.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadCorpus } from "../dist/src/compiler/corpus.js";
import {
  bindMapPackages,
  compileMapGroups,
  resolveMapScript,
} from "../dist/src/compiler/map-package.js";
import {
  decodeFieldOp,
  decodeScriptLocals,
} from "../dist/src/compiler/field.js";
import { hash } from "../dist/src/compiler/content.js";
import { FieldGame } from "../dist/src/core/field.js";
import { EventState } from "../dist/src/core/event-state.js";
import { loadMinimapMedia } from "../dist/src/compiler/map-ui.js";

const root = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const corpus = await loadCorpus(root),
  byId = new Map(corpus.assets.map((a) => [a.id, a]));
const minimap = await loadMinimapMedia(
  root,
  corpus.manifest.parentSourceSetHash,
);
for (const [suffix, sha256] of [
  [
    "GameAssembly.dll",
    "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
  ],
  [
    "/Metadata/global-metadata.dat",
    "9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45",
  ],
])
  assert.ok(
    corpus.manifest.sources.some(
      (s) => s.file.endsWith(suffix) && s.sha256 === sha256,
    ),
    "Unreviewed group activation source",
  );
const maps = bindMapPackages(corpus.assets, corpus.tables).map((map) => ({
  ...map,
  compiledGroups: compileMapGroups(map, byId, corpus.tables, corpus.messages),
}));
const byMap = new Map(maps.map((m) => [m.id, m]));
const links = [];
function link(map, site, destination, continuation = null) {
  const target = byMap.get(String(destination.mapId));
  const entries = target
    ? Object.values(target.compiledGroups).flatMap((g) =>
        g.entities
          .filter((e) => e.kind === 0 && e.objectId === destination.entrance)
          .map((e) => ({
            group: g.name,
            id: e.id,
            x: e.x,
            y: e.y,
            layer: e.layer,
            source: e.source,
          })),
      )
    : [];
  links.push({
    from: map.id,
    site,
    destination,
    continuation,
    entries,
    status: !target
      ? "missing-map"
      : entries.length === 0
        ? "missing-entry"
        : entries.length > 1
          ? "ambiguous-entry"
          : entries[0].group === "entity_default"
            ? "unique-default-entry"
            : "story-dependent-entry",
    continuationResolved:
      !continuation || !!(target && resolveMapScript(target, continuation)),
  });
}
for (const map of maps) {
  for (const group of Object.values(map.compiledGroups))
    for (const entity of group.entities)
      if (entity.destination) link(map, entity.source, entity.destination);
  for (const id of map.scripts) {
    const a = byId.get(id);
    for (const [index, m] of a.data.Mnemonics.entries())
      if (m.mnemonic === "ChangeMap") {
        const i = m.operands?.iValues,
          s = m.operands?.sValues;
        if (
          m.type === 1 &&
          Number.isInteger(i?.[0]) &&
          Number.isInteger(i?.[1])
        )
          link(
            map,
            { ...a.source, pointer: `/Mnemonics/${index}` },
            { mapId: i[0], entrance: i[1] },
            s?.[0] || null,
          );
      }
  }
}
const allowed = new Set([
  "nop",
  "exit",
  "call",
  "return",
  "wait",
  "branch",
  "jump",
  "calc",
  "flag",
  "entities",
  "message",
]);
const results = [],
  excluded = [];
function run(map, asset, ops, input) {
  const state = EventState.initialized();
  for (const { ref, value } of input) state.write(ref, value);
  const content = {
    formatVersion: 1,
    kind: "field-development",
    sourceSetHash: corpus.sourceSetHash,
    parentSourceSetHash: corpus.sourceSetHash,
    contentHash: hash(asset.data),
    map: {
      id: map.name,
      width: 1,
      height: 1,
      tileSize: 16,
      layers: [],
      tilesets: [],
      textures: {},
      collisions: { 1: [0] },
      entities: [],
      groups: map.compiledGroups,
      source: asset.source,
    },
    characters: {},
    minimap,
    scripts: { [asset.id]: ops },
    scriptLocals: { [asset.id]: decodeScriptLocals(asset.data) },
    entry: {
      player: { x: 0, y: 0, layer: 1, direction: "up", asset: "", mount: "" },
      description:
        "Isolated entity-group execution; default map and media not mounted",
      evidence: [asset.source],
    },
    limitations: ["headless-group-host", "controlled-initial-state"],
  };
  const game = new FieldGame(content, state),
    messages = [];
  game.startEvent(asset.id);
  for (let n = 0; n < 6000 && game.busy && !game.stop; n++)
    if (game.dialogue) {
      messages.push(game.dialogue.key);
      game.confirm();
    } else game.advance(10);
  return {
    input,
    outcome: game.stop
      ? "stopped"
      : game.busy
        ? "budget-exhausted"
        : "finished",
    groups: [...game.activeGroups],
    entities: game.entities.map((e) => ({
      id: e.id,
      kind: e.kind,
      source: e.source,
    })),
    messages,
    stateHash: hash(game.eventState.snapshot()),
    stop: game.stop,
  };
}
for (const map of maps)
  for (const id of map.scripts) {
    const asset = byId.get(id);
    if (!asset.data.Mnemonics.some((m) => m.mnemonic === "SetEntities"))
      continue;
    let ops;
    try {
      ops = asset.data.Mnemonics.map((m, index) =>
        decodeFieldOp(
          m,
          { script: id, index, source: asset.source },
          corpus.messages,
        ),
      );
    } catch {
      excluded.push({ map: map.id, id, reason: "operand-decoder-rejected" });
      continue;
    }
    if (!ops.every((o) => allowed.has(o.kind))) {
      excluded.push({
        map: map.id,
        id,
        reason: "additional-runtime-capabilities",
      });
      continue;
    }
    const segments = asset.data.Segments;
    if (
      segments?.length !== 1 ||
      segments[0].EntryPoint !== 0 ||
      segments[0].Count !== ops.length
    ) {
      excluded.push({ map: map.id, id, reason: "segment-lifecycle" });
      continue;
    }
    const required = [
      ...new Set(ops.filter((o) => o.kind === "entities").map((o) => o.group)),
    ];
    if (
      required.some(
        (name) =>
          !map.compiledGroups[name] || map.compiledGroups[name].blockers.length,
      )
    ) {
      excluded.push({
        map: map.id,
        id,
        reason: "group-dependencies",
        required,
      });
      continue;
    }
    const seeds = new Map();
    for (const op of ops.filter(
      (o) => o.kind === "branch" && o.left.category.includes("Flag"),
    ))
      seeds.set(op.left.category + ":" + op.left.index, {
        ref: op.left,
        value: 1,
      });
    const inputs = [[], ...[...seeds.values()].map((seed) => [seed])];
    if (seeds.size > 1) inputs.push([...seeds.values()]);
    const cases = inputs.map((input) => {
      const result = run(map, asset, ops, input);
      assert.deepEqual(
        run(map, asset, ops, input),
        result,
        "Group activation must replay identically",
      );
      return result;
    });
    results.push({ map: map.id, id, source: asset.source, cases });
  }
const cases = results.flatMap((r) => r.cases),
  allGroups = maps.flatMap((m) => Object.values(m.compiledGroups));
const counts = {
  maps: maps.length,
  boundMaps: maps.filter((m) => !m.issues.length).length,
  initializerStatus: Object.fromEntries(
    [...new Set(maps.map((m) => m.initializerStatus))]
      .sort()
      .map((status) => [
        status,
        maps.filter((m) => m.initializerStatus === status).length,
      ]),
  ),
  entityGroupBindings: allGroups.length,
  entityGroupAssets: new Set(maps.flatMap((m) => Object.values(m.groups))).size,
  groupBindingsWithoutLogicalBlockers: allGroups.filter(
    (g) => !g.blockers.length,
  ).length,
  links: links.length,
  linkStatus: Object.fromEntries(
    [...new Set(links.map((l) => l.status))]
      .sort()
      .map((s) => [s, links.filter((l) => l.status === s).length]),
  ),
  scripts: new Set(results.map((r) => r.id)).size,
  mapScriptBindings: results.length,
  cases: cases.length,
  finished: cases.filter((c) => c.outcome === "finished").length,
  activatedCases: cases.filter((c) => c.groups.length).length,
  activationVariants: results.filter(
    (r) => new Set(r.cases.map((c) => JSON.stringify(c.groups))).size > 1,
  ).length,
};
const index = {
  formatVersion: 1,
  kind: "map-package-index",
  sourceSetHash: corpus.sourceSetHash,
  maps,
  links,
  limitations: [
    "entry references are static candidates, not confirmed active-story destinations",
    "media, map initialization and full entity behaviors remain incomplete",
  ],
};
const report = {
  formatVersion: 1,
  kind: "entity-group-batch-check",
  lane: "implementation-only",
  sourceSetHash: corpus.sourceSetHash,
  minimapSourceSetHash: minimap.sourceSetHash,
  counts,
  results,
  excluded,
  selection: {
    capabilities: [...allowed],
    groupDependencies:
      "all referenced groups must have no logical blockers before execution",
    initialState:
      "controlled zero and flag variations; default group not mounted",
  },
  doesNotEstablish: [
    "complete-map-initialization",
    "cross-map-playability",
    "media-readiness",
    "story-reachability",
    "original-parity",
  ],
};
await mkdir(root + "/build/reports", { recursive: true });
for (const [name, value] of [
  ["map-index", index],
  ["entity-group-check", report],
])
  await writeFile(
    root + `/build/reports/${name}.json`,
    JSON.stringify({ ...value, contentHash: hash(value) }, null, 2) + "\n",
  );
console.log(
  JSON.stringify(
    {
      counts,
      indexHash: hash(index),
      reportHash: hash(report),
      bindingIssues: maps
        .filter((m) => m.issues.length)
        .map((m) => ({ id: m.id, issues: m.issues }))
        .slice(0, 6),
    },
    null,
    2,
  ),
);
assert.ok(results.length > 0);
assert.equal(
  counts.finished,
  counts.cases,
  "Selected group execution stopped; inspect receipt",
);
assert.ok(
  counts.activatedCases > 0 && counts.activationVariants > 0,
  "No source-controlled group selection observed",
);
