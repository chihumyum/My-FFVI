import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Battle } from "./battle.js";
import { createCharacter } from "./progression.js";
import { initRole } from "./role-commands.js";
import { hitChance, attackHits } from "./battle-accuracy.js";

const data = JSON.parse(
  fs.readFileSync(new URL("../../build/web-data/battle.json", import.meta.url)),
);

test("real PR tower formation173 retains its ordinary Magic restriction but explicit story-test characters can Fight", () => {
  const normal = new Battle({
    data,
    party: [createCharacter(data, 5)],
    encounterId: 173,
    random: () => 0.01,
  });
  assert.equal(normal.events.state.magicOnly, true);
  assert.equal(normal.players[0].magicOnly, true);
  assert.equal(
    normal.actionsFor(0).some((a) => a.id === 1),
    false,
  );
  assert.equal(
    normal.commandsFor(0).some((a) => a.commandId === 7),
    true,
  );

  const warnings = [];
  let state = 1;
  const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
  const boosted = new Battle({
    data,
    party: [7, 5, 10].map((id) => createCharacter(data, id, true)),
    encounterId: 173,
    random,
    warn: (message) => warnings.push(message),
  });
  assert.equal(boosted.events.state.magicOnly, true, "the real source event still executes");
  for (const unit of boosted.players) {
    assert.equal(unit.magicOnly, true);
    initRole(boosted, unit);
    assert.equal(unit.magicOnly, true, "the source condition is retained for all arrivals");
  }
  assert(boosted.actionsFor(0).some((a) => a.id === 1));
  for (let frame = 0; frame < 300 && boosted.phase === "active"; frame++) boosted.tick(0.1, true);
  assert.equal(boosted.outcome, "victory");
  assert(boosted.log.some((line) => /攻击 \d+/.test(line)));
  assert(warnings.some((message) => message.includes("Explicit story-test boost")));
});

test("tower-only story-test hit profile keeps ordinary accuracy and the original RNG draw", () => {
  const ability = { accuracy: 100, kind: "physical" },
    target = { side: "enemy", evasion: 100 },
    normal = { magicOnly: true },
    boostedOutside = { testBoost: true },
    boostedTower = { testBoost: true, magicOnly: true };
  assert.equal(hitChance(normal, target, ability), 21);
  assert.equal(hitChance(boostedOutside, target, ability), 21);
  assert.equal(hitChance(boostedTower, target, ability), 100);
  assert.equal(hitChance(boostedTower, { ...target, side: "player" }, ability), 21);
  let calls = 0;
  assert.equal(
    attackHits(boostedTower, target, ability, () => (++calls, 0.99)),
    true,
  );
  assert.equal(calls, 1);
  assert.equal(
    attackHits(normal, target, ability, () => 0.99),
    false,
  );
});
