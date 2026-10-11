// Source-bound control-flow and controlled-host checks, not playable-enemy coverage.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { readSnapshot, snapshotFile } from "../dist/src/compiler/integrity.js";
import {
  compileOpeningBattle,
  battleTableIndex,
} from "../dist/src/compiler/battle.js";
import {
  compileBattleAI,
  battleAIAbilities,
} from "../dist/src/compiler/battle-ai.js";
import { compileDevelopmentAbility } from "../dist/src/compiler/ability.js";
import {
  BattleAIError,
  startBattleAI,
  planBattleAITurn,
  drawBattleAIAbility,
} from "../dist/src/core/battle-ai.js";
import { BattleGame } from "../dist/src/core/battle.js";
import { encounterContent } from "../dist/src/core/battle-content.js";
import { hash } from "../dist/src/compiler/content.js";

const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const source = await compileOpeningBattle(root);
const exported = JSON.parse(
  snapshotFile(await readSnapshot(root + "/build/battle"), "battle.json"),
);
const tables = JSON.parse(
  snapshotFile(await readSnapshot(root + "/build/import"), "tables.json"),
);
const reader = battleTableIndex(tables, exported.tableSources);
const catalog = JSON.parse(
  await readFile(root + "/build/game/opening-playable.json", "utf8"),
);
assert.equal(catalog.common.profile, "narshe-playability-v10");
assert.equal(catalog.common.sourceContentHash, source.contentHash);
const assets = Object.values(exported.assets).filter((a) =>
  a.source.assetPath.includes("/MonsterAI/"),
);
const programs = new Map();
const abilities = new Map();
const ability = (id) => {
  if (!abilities.has(id))
    abilities.set(
      id,
      compileDevelopmentAbility(reader, id, `AI 机制样本 #${id}`),
    );
  return abilities.get(id);
};
const rows = assets.map((asset) => {
  const file = exported.sources.filter(
    (s) =>
      s.file === asset.source.file || s.file.endsWith("/" + asset.source.file),
  );
  assert.equal(file.length, 1);
  const identity = {
    ...asset.source,
    sha256: file[0].sha256,
    sourceSetHash: source.parentSourceSetHash,
    battleSourceSetHash: source.sourceSetHash,
  };
  try {
    const program = compileBattleAI(asset.data, identity);
    programs.set(asset.source.assetPath.split("/").at(-1), program);
    return {
      source: identity,
      programHash: hash(program),
      blockers: [
        ...program.blockers.map((reason) => ({ pc: null, reason })),
        ...program.instructions.flatMap(({ mnemonic, op }, pc) =>
          op.kind === "blocked" ? [{ pc, mnemonic, reason: op.reason }] : [],
        ),
      ],
      abilityDependencies: battleAIAbilities(program).map((id) => ({
        id,
        plan: ability(id).plan !== null,
        blockers: ability(id).blockers,
      })),
    };
  } catch (error) {
    return {
      source: identity,
      programHash: null,
      blockers: [{ pc: null, reason: String(error.message) }],
      abilityDependencies: [],
    };
  }
});
assert.equal(rows.length, 430);
const context = (level = 6, conditionIds = []) => ({
  players: [{ level }],
  enemies: [{ level: 1 }],
  conditionIds,
});
function trace(name, ctx, count) {
  const program = programs.get(name);
  assert.ok(program);
  let state = startBattleAI(program, ctx);
  const turns = [];
  for (let n = 0; n < count; n++) {
    const turn = planBattleAITurn(program, state, ctx);
    const selected = turn.acts.filter((a) => a.selected);
    assert.equal(selected.length, 1);
    const drawPcs = [];
    const chosen = turn.acts.map((act) =>
      drawBattleAIAbility(act, {
        integer: (min) => {
          drawPcs.push(act.pc);
          return min;
        },
        float: (min) => {
          drawPcs.push(act.pc);
          return min;
        },
      }),
    );
    turns.push({
      selectedPc: selected[0].pc,
      dependencies: selected[0].abilities,
      drawPcs,
      chosen,
      nextTurn: turn.state.actTurn,
    });
    state = turn.state;
  }
  return { source: program.source, turns };
}
const traces = {
  guard: trace("sc_ai_000_Guard.json", context(), 3),
  loboLow: trace("sc_ai_019_SilverLobo.json", context(), 4),
  loboHigh: trace("sc_ai_019_SilverLobo.json", context(7), 4),
  loboCondition: trace("sc_ai_019_SilverLobo.json", context(7, [12]), 2),
  leafBunny: trace("sc_ai_017_LeafBunny.json", context(), 4),
};
assert.deepEqual(
  traces.guard.turns.map((t) => t.selectedPc),
  [4, 4, 4],
);
assert.deepEqual(
  traces.loboLow.turns.map((t) => t.selectedPc),
  [5, 5, 5, 5],
);
assert.deepEqual(
  traces.loboHigh.turns.map((t) => t.selectedPc),
  [10, 11, 10, 11],
);
assert.deepEqual(
  traces.loboHigh.turns.map((t) => t.drawPcs),
  [
    [10, 11],
    [10, 11],
    [10, 11],
    [10, 11],
  ],
);
assert.deepEqual(
  traces.loboCondition.turns.map((t) => t.selectedPc),
  [16, 16],
);
assert.deepEqual(
  traces.leafBunny.turns.map((t) => t.selectedPc),
  [4, 5, 4, 5],
);
assert.equal(ability(696).plan, null);
assert.ok(ability(696).blockers.some((s) => s.includes("function type 38")));

// Same host parameters/poses deliberately isolate AI from enemy asset/stat migration.
const hostChecks = [];
for (const name of [
  "sc_ai_037_Siegfried.json",
  "sc_ai_14F_Soldier.json",
  "sc_ai_537_Brachiosaur.json",
]) {
  const program = programs.get(name);
  const content = structuredClone(encounterContent(catalog, 3));
  content.enemies = [content.enemies[0]];
  const enemy = content.enemies[0];
  enemy.ai = program;
  enemy.abilities = battleAIAbilities(program);
  enemy.name = "敌方 AI 机制检查";
  enemy.hp = 10000;
  enemy.mp = 10000;
  enemy.agility = 100;
  content.players.forEach((p) => {
    p.hp = 10000;
  });
  content.initialAtb = { player: [0, 0], enemy: [100, 100] };
  for (const id of enemy.abilities) content.abilities[id] = ability(id);
  function run(parts) {
    const battle = new BattleGame(content, 239);
    for (const ms of parts) battle.advance(ms);
    return {
      combatants: battle.combatants,
      events: battle.events,
      phase: battle.phase,
      action: battle.action,
      ai: battle.enemyAIState(enemy.id),
    };
  }
  const one = run([60000]);
  assert.deepEqual(one, run(Array(6000).fill(10)));
  assert.equal(one.phase, "active");
  assert.ok(one.combatants.some((c) => c.side === "player" && c.hp < c.maxHp));
  const actions = one.events.filter((e) =>
    e.text.startsWith(enemy.name + " ·"),
  );
  assert.ok(actions.length >= 3);
  hostChecks.push({
    source: program.source,
    abilities: enemy.abilities,
    actionCountInRetainedLog: actions.length,
    replay: true,
    ai: one.ai,
  });
}
// A level branch fails on its concrete dependency, independent of monster ID.
const high = structuredClone(encounterContent(catalog, 42));
assert.ok(
  high.enemies.some((e) => e.ai.source.assetPath.endsWith("SilverLobo.json")),
);
high.enemies.forEach((e) => {
  e.sourceId = 987654;
});
high.players[0].level = 7;
assert.throws(
  () => new BattleGame(high, 241),
  (e) =>
    e instanceof BattleAIError &&
    e.pc === 10 &&
    e.message.includes("ability 696"),
);

const report = {
  lane: "source-ai-control-flow-and-controlled-host",
  sourceSetHash: source.parentSourceSetHash,
  battleSourceSetHash: source.sourceSetHash,
  fieldSourceSetHash: catalog.common.fieldSourceSetHash,
  sourceContentHash: source.contentHash,
  catalogHash: catalog.contentHash,
  scriptCount: rows.length,
  fullyDecodedNormalPrograms: rows.filter((r) => !r.blockers.length).length,
  rows,
  traces,
  hostChecks,
  highLevelDependencyGate: true,
  limitations: [
    "decoding-is-not-playable-enemy-or-map-coverage",
    "host-probes-use-opening-parameters-and-poses-with-source-ai",
    "no-confusion-behavior-from-condition-branch-probe",
    "no-function-38-ability-696-effects",
    "no-counter-interrupt-variables-loopact-or-boss-event-support",
    "normal-auto-targets-only-ranges-3-and-7-with-development-player-weighting",
    "development-atb-scheduling-and-prng-no-original-parity",
  ],
};
report.contentHash = hash(report);
await writeFile(
  root + "/build/reports/battle-ai-check.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    scripts: rows.length,
    decoded: report.fullyDecodedNormalPrograms,
    hostChecks: hostChecks.length,
    contentHash: report.contentHash,
  }),
);
