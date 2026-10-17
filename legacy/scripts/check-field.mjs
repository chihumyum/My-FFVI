// Private real-source integration check; public unit tests use only synthetic fixtures.
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { FieldGame } from "../dist/src/core/field.js";
import { compileField } from "../dist/src/compiler/field.js";
import { controlledAudioRuntime } from "./controlled-audio.mjs";
const root = resolve(import.meta.dirname, "..");
const built = JSON.parse(
  await readFile(resolve(root, "build/game/narshe.json"), "utf8"),
);
const fresh = await compileField(root);
assert.deepEqual(
  built,
  fresh,
  "Compiled field differs from verified source snapshots",
);
const g = new FieldGame(built, undefined, undefined, undefined, controlledAudioRuntime());
assert.ok(built.developmentOmissions.length > 0);
assert.ok(built.developmentOmissions.every((item) => item.kind === "field-effect" && item.source.pointer &&
  built.map.groups[item.group].blockers.some((issue) => issue.source.pointer === item.source.pointer)));
assert.equal(built.map.entities.some((entity) => entity.kind === 11), false);
assert.equal(g.fieldEffectsSnapshot, null);
assert.equal(g.move("left"), false);
assert.equal(g.move("right"), false);
for (let n = 0; n < 11; n++) {
  assert.equal(g.move("up"), true);
  g.advance(240);
}
g.advance(1000);
assert.equal(g.stop, null);
assert.equal(g.dialogue?.key, "E0002_00_003_a_01");
assert.equal(g.move("right"), false);
assert.equal(g.player.y, 38);
assert.deepEqual(
  [g.actors["164"].x, g.actors["164"].y, g.actors["165"].x, g.actors["165"].y],
  [37, 35, 39, 35],
);
g.confirm();
g.advance(1000);
assert.equal(g.stop?.kind, "encounter");
assert.equal(g.stop?.party, 3);
assert.equal(g.stop?.continuation, "sc_e_0002_1");
assert.deepEqual(
  [g.actors["164"].x, g.actors["164"].y, g.actors["165"].x, g.actors["165"].y],
  [37, 38, 39, 38],
);
const receipt = {
  lane: "implementation-only",
  contentHash: built.contentHash,
  sourceSetHash: built.sourceSetHash,
  audioHost: "controlled-headless-readiness-and-presentation",
  checks: [
    "compile-reproducibility",
    "explicit-existing-development-particle-omission",
    "corridor-collision",
    "guard-choreography",
    "dialogue-input-lock",
    "explicit-encounter-boundary",
  ],
  result: "pass",
  doesNotEstablish: [
    "original-parity",
    "battle-playability",
    "complete-map-initialization",
    "full-game-migration",
    "audible-browser-or-native-audio",
  ],
};
await mkdir(resolve(root, "build/game"), { recursive: true });
await writeFile(
  resolve(root, "build/game/check.json"),
  JSON.stringify(receipt, null, 2) + "\n",
);
console.log(JSON.stringify(receipt, null, 2));
