import { sourceBattleInventory } from "./battle-probe-context.mjs";
// Private source scalars and controlled actions; never grants story commands or AI support.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { readSnapshot, snapshotFile } from "../dist/src/compiler/integrity.js";
import { battleTableIndex } from "../dist/src/compiler/battle.js";
import {
  compileAbilityProgram,
  compileDevelopmentAbility,
  isSourceNormalAttack,
} from "../dist/src/compiler/ability.js";
import {
  compilePhysicalLimits,
  compilePlayerPhysical,
  compileEnemyPhysical,
} from "../dist/src/compiler/physical-parameters.js";
import { calculatePhysical } from "../dist/src/core/physical.js";
import { BattleGame } from "../dist/src/core/battle.js";
import { controlledBattleContent as encounterContent } from "./battle-probe-context.mjs";
import { hash } from "../dist/src/compiler/content.js";

const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const imported = await readSnapshot(root + "/build/import");
const exported = JSON.parse(
  snapshotFile(await readSnapshot(root + "/build/battle"), "battle.json"),
);
const tables = JSON.parse(snapshotFile(imported, "tables.json"));
const reader = battleTableIndex(tables, exported.tableSources);
const catalog = JSON.parse(
  await readFile(root + "/build/game/opening-playable.json", "utf8"),
);
assert.equal(catalog.common.profile, "narshe-playability-v30");
const limits = compilePhysicalLimits(reader);
const zero = { attack: 0, strength: 0, accuracy: 0, criticalRate: 0 };
const players = tables["character_status.csv"].flatMap((row) =>
  [1, 2].map((selectedArm) => ({
    characterId: Number(row.id),
    selectedArm,
    initialConditions: row.initial_condition_group,
    ...compilePlayerPhysical(
      reader,
      Number(row.id),
      {
        selectedArm,
        additionalStrength: 0,
        correctionStrength: 0,
        temporary: zero,
      },
      limits.values,
    ),
  })),
);
const enemies = tables["monster.csv"].map((row) => ({
  monsterId: Number(row.id),
  initialConditions: row.initial_condition,
  ...compileEnemyPhysical(reader, Number(row.id), zero, limits.values),
}));
const terra = players.find((p) => p.characterId === 1 && p.selectedArm === 1);
assert.deepEqual(terra.confirmed, {
  attack: 42,
  strength: 31,
  accuracy: 100,
  criticalRate: 3,
});
assert.deepEqual(
  players.find((p) => p.characterId === 1 && p.selectedArm === 2).confirmed,
  { attack: 12, strength: 31, accuracy: 0, criticalRate: 0 },
);
assert.deepEqual(enemies.find((e) => e.monsterId === 1).confirmed, {
  attack: 16,
  strength: 0,
  accuracy: 100,
  criticalRate: 0,
});
const candidates = [];
for (const row of tables["ability.csv"]) {
  const decoded = compileAbilityProgram(reader, Number(row.id)),
    p = decoded.program;
  if (
    !p.functions.some(
      (f) => f.type === 2 && f.series === 0 && f.values.every((v) => v === 0),
    ) ||
    !(
      (p.process.key === "None" && p.process.values.every((v) => v === 0)) ||
      (p.process.key === "multiply" &&
        p.process.values[0] > 0 &&
        p.process.values.slice(1).every((v) => v === 0))
    ) ||
    p.contentFlags.some((id) => ![1, 2, 5].includes(id))
  )
    continue;
  const checks = [];
  for (const side of ["player", "enemy"])
    for (const evasion of [0, 64, 128])
      for (const hitDraw of [0, 255]) {
        const input = {
          rows: { actor: "front", target: "front", ignoreActorPenalty: false, ignoreTargetPenalty: false },
          rules: {
            normalAttack: isSourceNormalAttack(p.abilityId, p.rules.type_id),
            multiplyPercent:
              p.process.key === "multiply" ? p.process.values[0] : null,
            contentFlags: p.contentFlags,
          },
          power: Number(row.standard_value),
          actor: {
            ...(side === "player"
              ? terra.confirmed
              : enemies.find((e) => e.monsterId === 1).confirmed),
            side,
            level: 10,
            attackElements: [],
            conditionTypes: [],
          },
          target: {
            side: side === "player" ? "enemy" : "player",
            defense: 64,
            evasion,
            elementResistances: {},
          },
          targetCount: 1,
        };
        const ranges = [];
        const result = calculatePhysical(input, (min, max) => {
          ranges.push([min, max]);
          return max === 255 ? hitDraw : 0;
        });
        assert.ok(
          Number.isInteger(result.amount) &&
            result.amount >= 0 &&
            result.amount <= 9999,
        );
        const expected = [...(side === "enemy" ? [[0, 7]] : []), [0, 31]];
        if (!p.contentFlags.includes(1) && input.actor.accuracy < 255)
          expected.push([0, 255]);
        if (!result.missed) expected.push([0, 99]);
        assert.deepEqual(ranges, expected);
        checks.push({ input, result, ranges });
      }
  const ability = compileDevelopmentAbility(reader, p.abilityId, "Controlled");
  candidates.push({
    ...decoded,
    abilityBlockers: ability.blockers,
    scalarChecks: checks,
  });
}
assert.ok(candidates.some((a) => a.program.abilityId === 399));
const base = encounterContent(catalog, 3);
const actionChecks = [];
// Player Fight plus a source multiply action outside the opening ability list.
// These are explicit grants for tests, not a recovered command-unlock rule.
for (const abilityId of [1, 399]) {
  const ability = compileDevelopmentAbility(reader, abilityId, "Controlled");
  assert.ok(ability.plan, ability.blockers.join(";"));
  const run = (parts) => {
    const content = structuredClone(base);
    content.abilities[abilityId] = ability;
    content.commands[900001] = {
      id: 900001,
      name: "Controlled",
      kind: "ability",
      abilityIds: [abilityId],
      forbiddenConditionIds: [],
      referencedAbility: null,
    };
    content.players[0].abilities = [abilityId];
    content.players[0].commands = [900001];
    content.initialAtb = { player: [100, 100], enemy: [0, 0] };
    const battle = new BattleGame(content, 11, undefined, sourceBattleInventory(catalog)),
      actor = battle.players[0],
      target = battle.enemies[0];
    const before = { hp: target.hp, mp: actor.mp };
    assert.equal(battle.command(actor.id, abilityId, target.id, 900001), true);
    for (const dt of parts) battle.advance(dt);
    assert.equal(actor.mp, before.mp - ability.cost);
    assert.ok(target.hp < before.hp);
    assert.equal(
      battle.events.filter((e) => e.text.includes("点伤害")).length,
      1,
    );
    return {
      combatants: battle.combatants,
      events: battle.events,
      action: battle.action,
    };
  };
  const result = run([2600]);
  assert.deepEqual(result, run(Array(260).fill(10)));
  actionChecks.push({ abilityId, result });
}
const report = {
  lane: "source-neutral-physical-scalars-and-controlled-actions",
  profile: catalog.common.profile,
  fieldSourceSetHash: catalog.common.fieldSourceSetHash,
  battleSourceContentHash: catalog.common.sourceContentHash,
  limits,
  players,
  enemies,
  candidates,
  actionChecks,
  parameterScope:
    "Both selected arms with explicit zero additional/correction/temporary inputs; no conditions, passive, two-hand or special-weapon adjustment. Numeric projection does not establish legal equipment or action admission.",
  doesNotEstablish: [
    "original-parity",
    "ability-unlock",
    "equipment-effects",
    "rows-or-affinities",
    "status-engine",
    "enemy-ai",
    "full-game-playability",
  ],
};
await writeFile(
  root + "/build/reports/physical-check.json",
  JSON.stringify({ ...report, contentHash: hash(report) }, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    contentHash: hash(report),
    sourceAbilities: candidates.length,
    scalarCases: candidates.reduce((n, c) => n + c.scalarChecks.length, 0),
    playerArms: players.length,
    enemies: enemies.length,
    controlledActions: actionChecks.map((a) => a.abilityId),
  }),
);
