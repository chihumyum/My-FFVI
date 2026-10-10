// Private source-backed flow check. No original assets or story text are committed here.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { GameSession } from "../dist/src/core/game-session.js";
import { compileOpeningBattle } from "../dist/src/compiler/battle.js";
import { compileOpeningPlayable } from "../dist/src/compiler/opening-playable.js";
const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const field = JSON.parse(
  await readFile(root + "/build/game/narshe.json", "utf8"),
);
const content = JSON.parse(
  await readFile(root + "/build/game/opening-playable.json", "utf8"),
);
assert.deepEqual(
  content,
  await compileOpeningPlayable(root, await compileOpeningBattle(root)),
);
assert.deepEqual(
  content.common.players.map((p) => p.abilities.length),
  [8, 4, 4],
);
assert.deepEqual(
  content.common.players.map((p) => p.weight),
  [8, 8, 8],
);
assert.deepEqual(
  content.common.players.map((p) => p.hp),
  [63, 68, 70],
);
function enter(parts = [1000]) {
  const s = new GameSession(field, content);
  for (let n = 0; n < 11; n++) {
    assert.equal(s.field.move("up"), true);
    s.advance(240);
  }
  s.advance(1000);
  s.field.confirm();
  for (const dt of parts) s.advance(dt);
  assert.equal(s.battle?.phase, "active");
  return s;
}
const s = enter();
const split = enter(Array(100).fill(10));
assert.equal(
  s.battle.time,
  split.battle.time,
  "Encounter handoff must not discard partial-frame time",
);
assert.deepEqual(s.battle.combatants, split.battle.combatants);
assert.equal(s.continueVictory(), false);
for (let n = 0; n < 10000 && s.battle.phase === "active"; n++) {
  for (const actor of s.battle.ready) {
    const target = s.battle.targets(actor.id, 218)[0];
    if (target) s.battle.command(actor.id, 218, target.id);
  }
  s.advance(10);
}
assert.equal(s.battle.phase, "victory");
assert.equal(s.battle.reward.gil, 96);
assert.equal(s.battle.reward.each, 32);
assert.equal(s.continueVictory(), true);
assert.equal(s.continueVictory(), false);
s.advance(1000);
assert.equal(s.gil, 3096);
assert.equal(s.field.stop, null);
assert.equal(s.field.busy, false);
assert.deepEqual([...s.field.hiddenEntities].sort(), ["164", "165", "177"]);
assert.equal(s.field.flags.ScenarioFlag1[1], true);
assert.equal(s.field.move("down"), true);
s.advance(240);
assert.equal(s.field.move("up"), true);
s.advance(240);
assert.equal(s.field.stop, null);
assert.equal(
  s.battle,
  null,
  "Cleared trigger cannot start the encounter again",
);
assert.equal(
  s.field.move("up"),
  true,
  "Movement resumes after the continuation",
);
s.advance(240);
const loss = enter();
for (let n = 0; n < 30 && loss.battle.phase === "active"; n++)
  loss.advance(60000);
assert.equal(loss.battle.phase, "defeat");
assert.equal(loss.continueVictory(), false);
assert.equal(loss.gil, content.common.gil);
assert.equal(loss.field.hiddenEntities.size, 0);
assert.equal(loss.retryBattle(), true);
assert.equal(loss.battle.phase, "active");
assert.deepEqual(
  loss.battle.players.map((p) => p.hp),
  content.common.players.map((p) => p.hp),
);
// Keep the already-built street slice as a shared handoff regression, not a map-specific runtime.
const street = enter();
let previousBattle = null;
function settle() {
  for (let n = 0; n < 12000; n++) {
    if (street.battle) {
      if (street.battle !== previousBattle) {
        if (street.players)
          assert.deepEqual(
            street.battle.players.map((p) => p.hp),
            street.players.map((p) => p.hp),
            "Consecutive encounters retain HP",
          );
        previousBattle = street.battle;
      }
      assert.notEqual(street.battle.phase, "defeat");
      if (street.battle.phase === "victory") {
        street.continueVictory();
        continue;
      }
      for (const actor of street.battle.ready) {
        const ally = street.battle.players.find(
          (p) => p.hp > 0 && p.hp < p.maxHp * 0.6,
        );
        const target = ally ?? street.battle.targets(actor.id, 218)[0];
        if (target)
          street.battle.command(actor.id, ally ? 222 : 218, target.id);
      }
    } else {
      assert.equal(street.field.stop, null);
      if (street.field.dialogue) street.field.confirm();
      if (!street.field.busy && !street.field.player.motion) return;
    }
    street.advance(10);
  }
  assert.fail("Event/battle handoff did not finish");
}
function walk(direction, count) {
  for (let n = 0; n < count; n++) {
    assert.equal(street.field.move(direction), true);
    street.advance(240);
    settle();
  }
}
settle();
walk("down", 1);
walk("right", 3);
walk("left", 3);
walk("up", 13);
walk("up", 9);
assert.deepEqual(street.completedEncounters, [3, 1, 2, 3, 42]);
assert.deepEqual([street.field.player.x, street.field.player.y], [38, 17]);
assert.deepEqual(street.field.flags.ScenarioFlag1, {
  1: true,
  2: true,
  3: true,
  4: true,
});
assert.equal(street.field.hiddenEntities.has("155"), true);
assert.equal(
  street.field.presentationOmissions.length,
  6,
  "Muted development cues remain recorded",
);
const receipt = {
  lane: "implementation-only",
  profile: content.common.profile,
  contentHash: content.contentHash,
  checks: [
    "deterministic-compilation",
    "source-party-and-equipment",
    "manual-command-victory",
    "reward-consumed-once",
    "encounter-handoff-frame-partition",
    "field-continuation",
    "cleared-trigger-and-collision",
    "defeat-and-retry",
    "consecutive-encounters-retain-party",
    "shared-encounter-catalog-and-continuations",
  ],
  result: "pass",
  doesNotEstablish: [
    "original-parity",
    "all-abilities",
    "complete-rewards",
    "full-game-migration",
  ],
};
await writeFile(
  root + "/build/game/playable-check.json",
  JSON.stringify(receipt, null, 2) + "\n",
);
console.log(JSON.stringify(receipt, null, 2));
