// Source NPC actions in isolated FieldGame instances, separately from actual map entrances.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { FieldGame, DELTA } from "../dist/src/core/field.js";
import { EventState } from "../dist/src/core/event-state.js";
import { WorldSession } from "../dist/src/core/world-session.js";
import { verifyContent } from "../dist/src/core/content-integrity.js";
import { canonical, hash } from "../dist/src/compiler/content.js";

const root = new URL("..", import.meta.url);
const read = async (path) =>
  verifyContent(JSON.parse(await readFile(new URL(path, root), "utf8")));
const catalog = await read("build/world/catalog.json"),
  bootstrap = await read("build/game/narshe.json"),
  worldCheck = await read("build/reports/world-check.json");
assert.equal(worldCheck.catalogHash, catalog.contentHash);
assert.equal(worldCheck.bootstrapHash, bootstrap.contentHash);
const maps = new Map();
for (const [id, indexed] of Object.entries(catalog.maps)) {
  const map = await read(`build/world/maps/${id}.json`);
  assert.equal(map.contentHash, indexed.contentHash);
  maps.set(Number(id), map);
}
const opposite = { up: "down", right: "left", down: "up", left: "right" },
  sideBit = { up: 1, right: 2, down: 4, left: 8 };
const records = new Map();
for (const map of maps.values())
  for (const group of Object.values(map.map?.groups ?? {})) {
    for (const entity of group.entities.filter((e) => e.kind === 6)) {
      const key = canonical(entity.source);
      if (!records.has(key))
        records.set(key, { entity, group, map, mapIds: [] });
      records.get(key).mapIds.push(map.mapId);
    }
  }
const runs = [],
  excluded = [],
  noninteractive = [];
for (const { entity, group, map, mapIds } of records.values()) {
  const identity = {
      source: entity.source,
      entityId: entity.id,
      probeContext: {
        mapId: map.mapId,
        mapHash: map.contentHash,
        group: group.name,
      },
      mapIds: [...new Set(mapIds)].sort((a, b) => a - b),
    },
    npc = entity.npc,
    blockers = group.blockers.filter(
      (b) => canonical(b.source) === canonical(entity.source),
    );
  if (
    blockers.length ||
    !npc ||
    !Number.isInteger(entity.x) ||
    !Number.isInteger(entity.y)
  ) {
    excluded.push({
      ...identity,
      reasons: blockers.map((b) => b.reason),
      geometry: [entity.x, entity.y],
    });
    continue;
  }
  if (npc.interaction.kind === "none") {
    noninteractive.push(identity);
    continue;
  }
  assert.ok(["talk", "script"].includes(npc.interaction.kind));
  const side = Object.keys(sideBit).find(
    (d) => npc.acceptDirection & sideBit[d],
  );
  if (!side || !npc.talkMounts.includes("")) {
    excluded.push({
      ...identity,
      reasons: ["No supported walking interaction side"],
    });
    continue;
  }
  const delta = DELTA[side],
    direction = opposite[side];
  // Exact source entity/action/script; other entities and normal map initialization are intentionally absent.
  const content = {
    ...bootstrap,
    map: {
      ...map.map,
      entities: [entity],
      groups: undefined,
      initialGroups: undefined,
    },
    characters: catalog.characters,
    scripts: map.scripts,
    scriptLocals: map.scriptLocals,
    entry: {
      ...bootstrap.entry,
      player: {
        ...bootstrap.entry.player,
        x: entity.x + delta.x,
        y: entity.y + delta.y,
        direction,
        layer: entity.layer,
        mount: "",
      },
    },
  };
  const game = new FieldGame(content, new EventState()),
    before = {
      direction: game.actors[entity.id].direction,
      player: [game.player.x, game.player.y],
    };
  game.confirm();
  const messages = [];
  for (let frame = 0; frame < 3000 && game.busy && !game.stop; frame++) {
    if (game.dialogue) {
      messages.push({ key: game.dialogue.key, hash: hash(game.dialogue.text) });
      game.confirm();
    } else game.advance(10);
  }
  if (npc.interaction.kind === "talk") {
    assert.equal(game.stop, null);
    assert.equal(game.busy, false);
    assert.deepEqual(messages, [
      {
        key: npc.interaction.message.key,
        hash: hash(npc.interaction.message.text),
      },
    ]);
    assert.deepEqual([game.player.x, game.player.y], before.player);
    assert.equal(
      game.actors[entity.id].direction,
      npc.eyeContact && !npc.turnAround ? side : before.direction,
    );
  }
  runs.push({
    ...identity,
    action: npc.interaction.kind,
    script: npc.interaction.kind === "script" ? npc.interaction.script : null,
    messages,
    outcome: game.stop ? "blocked" : game.busy ? "time-limit" : "completed",
    stop: game.stop,
    state: game.eventState.snapshot(),
  });
}
// List real source entrances which reach idle with NPCs; no injected group or story flags.
const entrances = [];
for (const run of worldCheck.runs.filter((r) => r.result === "idle")) {
  const world = new WorldSession(bootstrap);
  world.field.previewMap(run.mapId, run.entrance);
  assert.ok(world.commit(world.prepare(catalog, maps.get(run.mapId))));
  const npcs = world.field.entities.filter(
    (e) =>
      e.npc?.interaction.kind === "talk" ||
      e.npc?.interaction.kind === "script",
  );
  if (npcs.length)
    entrances.push({
      mapId: run.mapId,
      entrance: run.entrance,
      player: {
        x: world.field.player.x,
        y: world.field.player.y,
        layer: world.field.player.layer,
      },
      npcs: npcs.map((e) => ({
        id: e.id,
        x: e.x,
        y: e.y,
        layer: e.layer,
        action: e.npc.interaction.kind,
      })),
    });
}
const report = {
  formatVersion: 1,
  kind: "source-npc-action-check",
  sourceSetHash: catalog.sourceSetHash,
  catalogHash: catalog.contentHash,
  bootstrapHash: bootstrap.contentHash,
  worldCheckHash: worldCheck.contentHash,
  runs,
  excluded,
  noninteractive,
  entrances,
  limitations: [
    "Isolated NPC probes use exact source actions and scripts, controlled adjacent player positions, and unknown story flags.",
    "They omit other source entities and initialization; blocked dependencies and unknown flags remain failures to complete the action.",
    "Entrance checks load actual default groups and initializers but do not establish story reachability, NPC approachability, image rendering or original parity.",
  ],
};
await writeFile(
  new URL("build/reports/npc-check.json", root),
  canonical({ ...report, contentHash: hash(report) }) + "\n",
);
console.log(
  JSON.stringify(
    {
      uniqueNpcs: records.size,
      noninteractive: noninteractive.length,
      excluded: excluded.length,
      probes: runs.length,
      completed: runs.filter((r) => r.outcome === "completed").length,
      talk: runs.filter((r) => r.action === "talk").length,
      script: runs.filter((r) => r.action === "script").length,
      emptyScripts: runs.filter(
        (r) => r.action === "script" && r.script === null,
      ).length,
      completedScripts: runs.filter(
        (r) =>
          r.action === "script" &&
          r.script !== null &&
          r.outcome === "completed",
      ).length,
      entrances: entrances.length,
      reportHash: hash(report),
    },
    null,
    2,
  ),
);
