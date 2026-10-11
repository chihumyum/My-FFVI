// Real-source scalar checks. Does not grant spells, supply AI or close spell dependencies.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { readSnapshot, snapshotFile } from "../dist/src/compiler/integrity.js";
import { battleTableIndex } from "../dist/src/compiler/battle.js";
import {
  compileAbilityProgram,
  compileDevelopmentAbility,
} from "../dist/src/compiler/ability.js";
import { calculateMagic } from "../dist/src/core/magic.js";
import { hash } from "../dist/src/compiler/content.js";
import { BattleGame } from "../dist/src/core/battle.js";
import { encounterContent } from "../dist/src/core/battle-content.js";

const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const imported = await readSnapshot(root + "/build/import");
const exported = JSON.parse(
  snapshotFile(
    await readSnapshot(root + "/build/battle"),
    "battle.json",
  ).toString(),
);
const tables = JSON.parse(snapshotFile(imported, "tables.json").toString());
const reader = battleTableIndex(tables, exported.tableSources);
const catalog = JSON.parse(
  await readFile(root + "/build/game/opening-playable.json", "utf8"),
);
assert.equal(catalog.common.profile, "narshe-playability-v8");
const candidates = [];
for (const row of tables["ability.csv"]) {
  const decoded = compileAbilityProgram(reader, Number(row.id));
  const p = decoded.program,
    f = p.functions[0];
  if (
    p.functions.length !== 1 ||
    f.type !== 3 ||
    f.series !== 0 ||
    f.values.join(",") !== "1,0,0" ||
    p.process.key !== "None" ||
    p.process.values.some(Boolean) ||
    p.contentFlags.some((id) => ![1, 2, 5].includes(id))
  )
    continue;
  // Explicit test inputs: neutral affinities, no status/equipment/critical or
  // provider overrides. Source flags/rate/power are preserved, even when the
  // complete ability is blocked by targeting, AI or another dependency.
  const checks = [];
  for (const side of ["player", "enemy"])
    for (const magicEvasion of [0, 64, 128])
      for (const draw of [0, 127, 128, 255]) {
        const input = {
          rules: {
            accuracy: p.rules.accuracy_rate,
            contentFlags: p.contentFlags,
            elements: [],
            forceDefense: false,
          },
          power: Number(row.standard_value),
          actor: { side, level: 10, magic: 20 },
          target: {
            side: "enemy",
            magicDefense: 64,
            magicEvasion,
            elementResistances: {},
          },
          recovery: false,
          targetCount: 1,
        };
        const ranges = [];
        const result = calculateMagic(input, (min, max) => {
          ranges.push([min, max]);
          return max === 255 ? draw : 0;
        });
        assert.ok(
          Number.isInteger(result.amount) &&
            result.amount >= 0 &&
            result.amount <= 9999,
        );
        if (result.missed) assert.deepEqual(ranges, [[0, 255]]);
        if (p.contentFlags.includes(1) || p.rules.accuracy_rate >= 255)
          assert.deepEqual(ranges, [[0, 31]]);
        checks.push({ input, result, ranges });
      }
  const ability = compileDevelopmentAbility(reader, p.abilityId, "Controlled");
  candidates.push({
    ...decoded,
    abilityBlockers: ability.blockers,
    scalarChecks: checks,
  });
}
assert.ok(candidates.some((x) => x.program.abilityId === 268));
assert.ok(candidates.some((x) => x.program.contentFlags.includes(5)));
// Separate controlled playability regression, through the actual action queue.
const base = encounterContent(catalog, 3);
const run = (parts) => {
  const content = structuredClone(base);
  content.initialAtb = { player: [100, 100], enemy: [0, 0] };
  const battle = new BattleGame(content, 11);
  const actor = battle.players[0];
  actor.hp = 1;
  const mp = actor.mp;
  assert.equal(battle.command(actor.id, 222, actor.id, 26), true);
  for (const dt of parts) battle.advance(dt);
  assert.equal(actor.hp, actor.maxHp);
  assert.equal(actor.mp, mp - content.abilities[222].cost);
  return {
    combatants: battle.combatants,
    action: battle.action,
    events: battle.events,
  };
};
const battleCheck = run([2600]);
assert.deepEqual(battleCheck, run(Array(260).fill(10)));
const report = {
  lane: "source-neutral-magic-scalars-and-controlled-action",
  profile: catalog.common.profile,
  fieldSourceSetHash: catalog.common.fieldSourceSetHash,
  battleSourceContentHash: catalog.common.sourceContentHash,
  candidates,
  battleCheck,
  doesNotEstablish: [
    "original-parity",
    "ability-unlock",
    "complete-targeting",
    "status-or-affinity-modifiers",
    "enemy-ai",
    "full-game-playability",
  ],
};
await writeFile(
  root + "/build/reports/magic-check.json",
  JSON.stringify({ ...report, contentHash: hash(report) }, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    contentHash: hash(report),
    sourceAbilities: candidates.length,
    scalarCases: candidates.reduce((n, x) => n + x.scalarChecks.length, 0),
    controlledRecovery: 222,
  }),
);
