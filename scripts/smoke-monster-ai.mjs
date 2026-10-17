import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { Battle } from "../src/play/battle.js";
import { MONSTER_AI_OPS } from "../src/play/monster-ai.js";
const data = JSON.parse(await fs.readFile("build/play/battle.json", "utf8"));
const programs = Object.values(data.aiPrograms),
  opcodes = new Set(programs.flatMap((p) => p.ops.map((o) => o[0])));
assert.equal(programs.length, 430);
assert.equal(opcodes.size, 69);
assert.deepEqual(
  [...opcodes].filter((op) => !MONSTER_AI_OPS.has(op)),
  [],
);
const start = performance.now(),
  results = [],
  warnings = new Set();
for (const program of programs) {
  assert.ok(performance.now() - start < 30_000, "AI smoke exceeded 30 seconds");
  const base = Object.values(data.monsters).find((m) => m.aiName === program.name),
    monsterId = base?.id ?? 90000;
  const monster = {
    ...(base || data.monsters[1]),
    id: monsterId,
    aiName: program.name,
  };
  const fixture = {
    ...data,
    monsters: { ...data.monsters, [monsterId]: monster },
    parties: {
      ...data.parties,
      99999: { id: 99999, script: "", members: [{ monsterId, slot: 0 }] },
    },
  };
  const party = [1, 2, 6, 7].map((id) => ({
    ...data.characters[id],
    hp: 999999,
    maxHp: 999999,
    mp: 9999,
    maxMp: 9999,
  }));
  let seed = 347;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const b = new Battle({
      data: fixture,
      party,
      encounterId: 99999,
      random,
      warn: (message) => warnings.add(message),
    }),
    enemy = b.enemies[0],
    ai = enemy.aiState;
  // This isolated fixture keeps participants available so every PR AI receives
  // several turns, damage/status/item notifications, a timer wake and a final wake.
  // It is deliberately separate from the unmodified-stat new-game regression.
  for (let turn = 0; turn < 6; turn++) {
    b.phase = "active";
    enemy.hp = Math.max(
      1,
      Math.floor(enemy.maxHp * (turn % 3 === 0 ? 1 : turn % 3 === 1 ? 0.5 : 0.05)),
    );
    enemy.removed = false;
    enemy.escaped = false;
    enemy.hidden = false;
    for (const u of party) {
      u.hp = u.maxHp;
      u.removed = false;
      u.escaped = false;
      u.hidden = false;
    }
    ai.wake("normal");
    for (let tick = 0; tick < 6; tick++) b.tick(0.1, false);
    const ability = data.abilities[[1, 40, 8, 132, 31, 42][turn]];
    ai.wake("reaction", {
      actor: party[turn % 4],
      target: enemy,
      ability,
      hit: turn !== 4,
      amount: turn === 4 ? 0 : 17,
      item: turn === 2 ? { itemId: 25, contentId: 26 } : null,
    });
    for (let tick = 0; tick < 6; tick++) b.tick(0.1, false);
    assert.ok(
      Number.isFinite(enemy.hp) && Number.isFinite(enemy.mp),
      program.name + " has invalid resources",
    );
    assert.ok(
      ai.pending.length <= 16 && b.aiQueue.length <= 256,
      program.name + " has an unbounded queue",
    );
  }
  b.phase = "active";
  enemy.removed = false;
  enemy.escaped = false;
  b.elapsed += 80;
  ai.tick();
  for (let tick = 0; tick < 6; tick++) b.tick(0.1, false);
  enemy.hp = 0;
  ai.wake("final", {
    actor: party[0],
    target: enemy,
    ability: data.abilities[1],
    hit: true,
    amount: enemy.maxHp,
  });
  for (let tick = 0; tick < 6; tick++) b.tick(0.1, false);
  assert.ok(ai.wakes >= 6, program.name + " did not execute several turns");
  assert.ok(ai.actions > 0, program.name + " did not select an action");
  for (const unit of [...b.players, ...b.enemies])
    assert.ok(
      Number.isFinite(unit.hp) && Number.isFinite(unit.mp),
      program.name + " produced invalid resources",
    );
  results.push({
    script: program.name,
    monsterId: base?.id ?? null,
    wakes: ai.wakes,
    actions: ai.actions,
    visited: [...ai.visits],
  });
}
const report = {
  programs: results.length,
  opcodeKinds: opcodes.size,
  seconds: (performance.now() - start) / 1000,
  results,
  warnings: [...warnings],
};
await fs.writeFile("build/play/ai-smoke.json", JSON.stringify(report, null, 2));
console.log(
  `${results.length} PR MonsterAI programs × 6 normal turns plus reactions, timers and final actions: completed without exception; ${report.seconds.toFixed(2)}s.`,
);
console.log(
  `Warnings (including ability fallbacks): ${warnings.size}. Details: build/play/ai-smoke.json`,
);
