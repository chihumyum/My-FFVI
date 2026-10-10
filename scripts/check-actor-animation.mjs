// Source animation assets and isolated original scripts; not map/story reachability or original parity.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { ActorAnimation } from "../dist/src/core/actor-animation.js";
import { FieldGame } from "../dist/src/core/field.js";
import { verifyContent } from "../dist/src/core/content-integrity.js";
import { canonical, hash } from "../dist/src/compiler/content.js";

const root = new URL("..", import.meta.url);
const read = async (path) =>
  verifyContent(JSON.parse(await readFile(new URL(path, root), "utf8")));
const catalog = await read("build/world/catalog.json"),
  bootstrap = await read("build/game/narshe.json"),
  world = await read("build/reports/world-check.json");
assert.equal(world.catalogHash, catalog.contentHash);
assert.equal(world.bootstrapHash, bootstrap.contentHash);
const clips = [],
  excluded = [],
  scripts = [],
  seen = new Set();
for (const [asset, character] of Object.entries(catalog.characters)) {
  for (const key of Object.keys(character.animations)) {
    const identity = { asset, key, source: character.source };
    const animation = new ActorAnimation(character);
    try {
      animation.cue(key, 0);
      animation.play(key, false, 1);
    } catch (error) {
      excluded.push({ ...identity, reason: error.message });
      continue;
    }
    const playing = animation.snapshot();
    const final = character.animations[playing.key].frames.at(-1);
    let elapsed = 0;
    while (animation.playing && elapsed < 60000) {
      animation.advance(10);
      elapsed += 10;
    }
    assert.equal(animation.playing, false, `${asset}/${key} did not finish`);
    assert.equal(animation.frame().sprite, final.sprite);
    assert.equal(animation.frame().alpha, final.alpha);
    assert.equal(animation.frame().flip, final.flip !== playing.flip);
    const clone = animation.clone();
    clone.cue(key, 0);
    assert.equal(animation.snapshot().elapsed, playing.duration);
    clips.push({
      ...identity,
      selected: playing.key,
      elapsed,
      duration: playing.duration,
      final: hash(animation.frame()),
    });
  }
}
const allowed = new Set([
  "flag",
  "calc",
  "branch",
  "jump",
  "nop",
  "exit",
  "return",
  "call",
  "wait",
  "puppet",
  "join",
  "position",
  "look",
  "move",
  "hide",
  "message",
  "animation-cue",
  "animation-play",
]);
for (const [mapId, indexed] of Object.entries(catalog.maps)) {
  const map = await read(`build/world/maps/${mapId}.json`);
  assert.equal(map.contentHash, indexed.contentHash);
  if (!map.map) continue;
  const defaults = map.map.groups.entity_default;
  for (const [name, ops] of Object.entries(map.scripts)) {
    if (
      !ops.some((o) => o.kind.startsWith("animation-")) ||
      !ops.every((o) => allowed.has(o.kind))
    )
      continue;
    const targets = new Set(
      ops
        .filter((o) => o.kind === "puppet" && o.actor !== "-1001")
        .map((o) => o.actor),
    );
    for (const group of Object.values(map.map.groups)) {
      const groups = group === defaults ? [group] : [defaults, group];
      const actors = groups.flatMap((g) =>
        g.entities.filter((e) => targets.has(e.id)),
      );
      if (
        actors.length !== targets.size ||
        new Set(actors.map((a) => a.id)).size !== targets.size ||
        actors.some((a) => a.kind !== 6 || !a.asset)
      )
        continue;
      if (
        actors.some((a) =>
          groups.some((g) =>
            g.blockers.some((b) => canonical(a.source) === canonical(b.source)),
          ),
        )
      )
        continue;
      const identity = canonical([
        ops[0].source,
        actors.map((a) => [a.id, a.source]),
      ]);
      if (seen.has(identity)) continue;
      seen.add(identity);
      const content = {
        ...bootstrap,
        map: {
          ...map.map,
          entities: actors,
          groups: undefined,
          initialGroups: undefined,
        },
        characters: catalog.characters,
        scripts: { [name]: ops },
        scriptLocals: { [name]: map.scriptLocals[name] },
        entry: {
          ...bootstrap.entry,
          player: { ...bootstrap.entry.player, mount: "" },
        },
      };
      const run = () => {
        const game = new FieldGame(content),
          messages = [];
        game.startEvent(name);
        let elapsed = 0;
        while (game.busy && !game.stop && elapsed < 60000) {
          if (game.dialogue) {
            messages.push({
              key: game.dialogue.key,
              hash: hash(game.dialogue.text),
            });
            game.confirm();
          } else {
            game.advance(10);
            elapsed += 10;
          }
        }
        return {
          elapsed,
          outcome: game.stop ? "blocked" : game.busy ? "budget" : "complete",
          stop: game.stop,
          state: game.eventState.snapshot(),
          messages,
          actors: Object.fromEntries(
            Object.entries(game.actors).map(([id, a]) => [
              id,
              {
                x: a.x,
                y: a.y,
                direction: a.direction,
                animation: a.animation?.snapshot(),
              },
            ]),
          ),
        };
      };
      const result = run();
      assert.deepEqual(run(), result);
      scripts.push({
        mapId: Number(mapId),
        mapHash: map.contentHash,
        group: group.name,
        script: name,
        source: ops[0].source,
        actors: actors.map((a) => ({ id: a.id, source: a.source })),
        ...result,
      });
    }
  }
}
const counts = {
  sourceCharacters: Object.keys(catalog.characters).length,
  clipKeysCompleted: clips.length,
  clipKeysExcluded: excluded.length,
  sourceScripts: new Set(scripts.map((s) => canonical(s.source))).size,
  scriptContexts: scripts.length,
  completedContexts: scripts.filter((s) => s.outcome === "complete").length,
  completedScripts: new Set(
    scripts
      .filter((s) => s.outcome === "complete")
      .map((s) => canonical(s.source)),
  ).size,
  blockedContexts: scripts.filter((s) => s.outcome === "blocked").length,
  budgetContexts: scripts.filter((s) => s.outcome === "budget").length,
};
const implementation = {};
for (const path of [
  "dist/src/core/actor-animation.js",
  "dist/src/core/field.js",
  "apps/game/renderer.js",
  "scripts/check-actor-animation.mjs",
])
  implementation[path] = createHash("sha256")
    .update(await readFile(new URL(path, root)))
    .digest("hex");
const report = {
  formatVersion: 1,
  kind: "source-actor-animation-check",
  sourceSetHash: catalog.sourceSetHash,
  catalogHash: catalog.contentHash,
  bootstrapHash: bootstrap.contentHash,
  worldCheckHash: world.contentHash,
  implementation,
  counts,
  clips,
  excluded,
  scripts,
  limitations: [
    "Clip runs are isolated one-shot playback, not original-game timing samples or all animation paths.",
    "Script probes retain original instructions and target actor bindings; unrelated entities and normal map initialization are absent.",
    "The root traveler is explicitly unmounted for these probes; story reachability and player identity are not established.",
    "Mounted animation, back-and-forth playback, changing alpha, custom runtime animation definitions and other script parameter shapes remain unsupported.",
  ],
};
await writeFile(
  new URL("build/reports/actor-animation-check.json", root),
  canonical({ ...report, contentHash: hash(report) }) + "\n",
);
console.log(JSON.stringify({ ...counts, reportHash: hash(report) }, null, 2));
