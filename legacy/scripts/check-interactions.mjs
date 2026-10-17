// Source NPC/map-object actions in isolated FieldGame instances, separately from actual map entrances.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { FieldGame, DELTA } from "../dist/src/core/field.js";
import { EventState } from "../dist/src/core/event-state.js";
import { WorldSession } from "../dist/src/core/world-session.js";
import { verifyContent } from "../dist/src/core/content-integrity.js";
import { canonical, hash } from "../dist/src/compiler/content.js";

const mode = process.argv[2] ?? "npc";
assert.ok(["npc", "objects"].includes(mode), "Expected npc or objects");
const entityKind = mode === "npc" ? 6 : 5,
  outputName = mode === "npc" ? "npc" : "map-object",
  properties = (e) => (mode === "npc" ? e.npc : e.mapObject);
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
    for (const entity of group.entities.filter((e) => e.kind === entityKind)) {
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
    interaction = properties(entity),
    blockers = group.blockers.filter(
      (b) =>
        canonical(b.source) === canonical(entity.source) ||
        !group.entities.some(
          (e) => canonical(e.source) === canonical(b.source),
        ),
    );
  if (
    blockers.length ||
    !interaction ||
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
  if (interaction.interaction.kind === "none") {
    noninteractive.push(identity);
    continue;
  }
  assert.ok(["talk", "script"].includes(interaction.interaction.kind));
  const side = Object.keys(sideBit).find(
    (d) => interaction.acceptDirection & sideBit[d],
  );
  if (!side || !interaction.talkMounts.includes("")) {
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
      direction: game.actors[entity.id]?.direction ?? null,
      player: [game.player.x, game.player.y],
    };
  game.confirm();
  const messages = [];
  for (let frame = 0; frame < 3000 && game.busy && !game.stop; frame++) {
    if (game.dialogue) {
      if (game.dialogue.manual) game.advance(10);
      messages.push({ key: game.dialogue.key, hash: hash(game.dialogue.text) });
      game.confirm();
    } else game.advance(10);
  }
  if (interaction.interaction.kind === "talk") {
    if (interaction.interaction.message.template) {
      // This isolated FieldGame deliberately has no held-character owner.
      // A source-bound name dependency must stop before changing the NPC or
      // publishing a window; localized defaults are not a probe provider.
      assert.match(game.stop?.message ?? "", /character name owner is unavailable/);
      assert.equal(game.messageWindow, null);
      assert.deepEqual(messages, []);
      assert.deepEqual([game.player.x, game.player.y], before.player);
      assert.equal(game.actors[entity.id]?.direction ?? null, before.direction);
    } else {
      assert.equal(game.stop, null);
      assert.equal(game.busy, false);
      assert.deepEqual(messages, [
        {
          key: interaction.interaction.message.key,
          hash: hash(interaction.interaction.message.text),
        },
      ]);
      assert.deepEqual([game.player.x, game.player.y], before.player);
      if (entity.npc)
        assert.equal(
          game.actors[entity.id].direction,
          entity.npc.eyeContact && !entity.npc.turnAround
            ? side
            : before.direction,
        );
      if (entityKind === 5) assert.equal(game.actors[entity.id], undefined);
    }
  }
  runs.push({
    ...identity,
    action: interaction.interaction.kind,
    script:
      interaction.interaction.kind === "script"
        ? interaction.interaction.script
        : null,
    messages,
    outcome: game.stop ? "blocked" : game.busy ? "time-limit" : "completed",
    stop: game.stop,
    presentationOmissions: game.presentationOmissions,
    state: game.eventState.snapshot(),
  });
}
// List real source entrances which reach idle with this entity kind; no injected group or story flags.
const entrances = [],
  contextRuns = [];
for (const run of worldCheck.runs.filter((r) => r.result === "idle")) {
  const world = new WorldSession(bootstrap);
  world.field.previewMap(run.mapId, run.entrance);
  assert.ok(world.commit(world.prepare(catalog, maps.get(run.mapId))));
  const targets = world.field.entities.filter(
    (e) =>
      e.kind === entityKind &&
      !world.field.hiddenEntities.has(e.id) &&
      ["talk", "script"].includes(properties(e)?.interaction.kind),
  );
  if (targets.length)
    entrances.push({
      mapId: run.mapId,
      entrance: run.entrance,
      player: {
        x: world.field.player.x,
        y: world.field.player.y,
        layer: world.field.player.layer,
      },
      entities: targets.map((e) => ({
        id: e.id,
        x: e.x,
        y: e.y,
        layer: e.layer,
        action: properties(e).interaction.kind,
      })),
    });
  // A second lane retains all real map entities and source initialization. Player
  // placement is still controlled; this does not claim an approach path from the entrance.
  for (const target of targets) {
    const meta = properties(target),
      side = Object.keys(sideBit).find(
        (d) => meta.acceptDirection & sideBit[d],
      );
    if (!side || !meta.talkMounts.includes("")) continue;
    const probe = new WorldSession(bootstrap);
    probe.field.previewMap(run.mapId, run.entrance);
    assert.ok(probe.commit(probe.prepare(catalog, maps.get(run.mapId))));
    const game = probe.field,
      delta = DELTA[side],
      position = game.actors[target.id] ?? target;
    Object.assign(game.player, {
      x: position.x + delta.x,
      y: position.y + delta.y,
      layer: position.layer,
      direction: opposite[side],
      mount: "",
    });
    game.confirm();
    const messages = [];
    for (let frame = 0; frame < 3000 && game.busy && !game.stop; frame++) {
      if (game.dialogue) {
        if (game.dialogue.manual) game.advance(10);
        messages.push({
          key: game.dialogue.key,
          hash: hash(game.dialogue.text),
        });
        game.confirm();
      } else game.advance(10);
    }
    contextRuns.push({
      mapId: run.mapId,
      entrance: run.entrance,
      entityId: target.id,
      source: target.source,
      script: target.script,
      action: meta.interaction.kind,
      messages,
      outcome: game.stop ? "blocked" : game.busy ? "time-limit" : "completed",
      stop: game.stop,
      presentationOmissions: game.presentationOmissions,
    });
  }
}
const report = {
  formatVersion: 1,
  kind: `source-${outputName}-action-check`,
  sourceSetHash: catalog.sourceSetHash,
  catalogHash: catalog.contentHash,
  bootstrapHash: bootstrap.contentHash,
  worldCheckHash: worldCheck.contentHash,
  runs,
  excluded,
  noninteractive,
  entrances,
  contextRuns,
  limitations: [
    "Isolated fields have no held-character name owner; typed character-name Talk dependencies are explicitly blocked without a default-name fallback.",
    "Isolated interaction probes use exact source actions and scripts, controlled adjacent player positions, and unknown story flags.",
    "They omit other source entities and initialization; blocked dependencies and unknown flags remain failures to complete the action.",
    "Entrance checks load actual default groups and initializers but do not establish story reachability, target approachability, image rendering or original parity.",
    "Context action probes preserve source map entities and initialization, but place the walking player at a controlled adjacent cell; approach paths remain a separate check.",
  ],
};
await writeFile(
  new URL(`build/reports/${outputName}-check.json`, root),
  canonical({ ...report, contentHash: hash(report) }) + "\n",
);
console.log(
  JSON.stringify(
    {
      entityKind,
      uniqueEntities: records.size,
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
      contextActions: contextRuns.length,
      completedContextActions: contextRuns.filter(
        (r) => r.outcome === "completed",
      ).length,
      reportHash: hash(report),
    },
    null,
    2,
  ),
);
