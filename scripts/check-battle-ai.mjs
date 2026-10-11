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
  selectBattleAIAbilities,
} from "../dist/src/core/battle-ai.js";
import { initialEnemyBehavior } from "../dist/src/core/enemy-behavior.js";
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
assert.equal(catalog.common.profile, "narshe-playability-v19");
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
  self: { hp: 100, mp: 10, monsterId: 1, behavior: initialEnemyBehavior() },
  players: [{ level }],
  enemies: [{ level: 1 }],
  conditionIds,
});
function trace(name, ctx, count) {
  const program = programs.get(name);
  assert.ok(program);
  let initial = startBattleAI(program, ctx);
  let state = initial.state;
  ctx = structuredClone(ctx);
  ctx.self.behavior = initial.behavior;
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
      behavior: turn.behavior,
    });
    state = turn.state;
    ctx.self.behavior = turn.behavior;
  }
  return { source: program.source, turns };
}
const traces = {
  guard: trace("sc_ai_000_Guard.json", context(), 3),
  loboLow: trace("sc_ai_019_SilverLobo.json", context(), 4),
  loboHigh: trace("sc_ai_019_SilverLobo.json", context(7), 4),
  loboCondition: trace("sc_ai_019_SilverLobo.json", context(7, [12]), 2),
  leafBunny: trace("sc_ai_017_LeafBunny.json", context(), 4),
  flanMode: trace("sc_ai_047_Flan.json", context(), 4),
  missileBayBelow: trace(
    "sc_ai_147_MissileBay.json",
    {
      ...context(),
      self: { ...context().self, hp: 1535 },
    },
    4,
  ),
  missileBayAt: trace(
    "sc_ai_147_MissileBay.json",
    {
      ...context(),
      self: { ...context().self, hp: 1536 },
    },
    4,
  ),
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
assert.deepEqual(
  traces.flanMode.turns.map((t) => t.behavior.mode),
  [1, 2, 3, 4],
);
assert.deepEqual(
  traces.flanMode.turns.map((t) => t.selectedPc),
  [5, 6, 5, 6],
);
assert.deepEqual(
  traces.missileBayBelow.turns.map((t) => t.selectedPc),
  [10, 11, 12, 10],
);
assert.deepEqual(
  traces.missileBayAt.turns.map((t) => t.selectedPc),
  [5, 5, 5, 5],
);

// Constructed mechanism checkpoints are explicit and do not claim source saves
// or a playable boss. Keep the original program, source PCs and blocked paths.
const parameterChecks = [];
{
  const program = programs.get("sc_ai_022_LesserLopros.json");
  const ctx = context();
  ctx.self.behavior.variables[0] = 2;
  const initial = startBattleAI(program, ctx);
  const low = planBattleAITurn(program, initial.state, ctx);
  assert.equal(low.acts[0].pc, 5);
  ctx.self.behavior.variables[0] = 3;
  assert.throws(
    () => planBattleAITurn(program, initial.state, ctx),
    (e) =>
      e instanceof BattleAIError &&
      e.pc === 12 &&
      /ActForTarget/.test(e.message),
  );
  assert.equal(ctx.self.behavior.variables[0], 3);
  parameterChecks.push({
    source: program.source,
    input: { variable0: [2, 3] },
    belowSelectedPc: 5,
    thresholdBlockedPc: 12,
    liveParametersUnchanged: true,
  });
}
{
  const program = programs.get("sc_ai_167_SoulSaver.json");
  const ctx = context();
  ctx.self.behavior.variables[0] = 1;
  ctx.self.mp = 2048;
  const checkpoint = {
    pc: 20,
    status: "waiting",
    tableId: 0,
    actTurn: 0,
    turnCounter: 0,
    advancedActCount: 0,
    guardianActIsDadaluma: true,
    receivedAbility: null,
  };
  assert.equal(program.instructions[checkpoint.pc].op.kind, "sync");
  const stage = planBattleAITurn(program, checkpoint, ctx);
  assert.equal(stage.state.pc, 45);
  assert.equal(stage.acts.length, 0);
  ctx.self.behavior = stage.behavior;
  const next = planBattleAITurn(program, stage.state, ctx);
  assert.equal(next.acts[0].pc, 62);
  assert.deepEqual(next.acts[0].abilities, [686]);
  assert.equal(next.behavior.variables[0], 0);
  assert.equal(next.state.pc, 1);
  assert.equal(ctx.self.behavior.variables[0], 1);
  ctx.self.mp = 2049;
  assert.throws(
    () => planBattleAITurn(program, stage.state, ctx),
    (e) =>
      e instanceof BattleAIError &&
      e.pc === 47 &&
      /IsCheckReceiveCommand/.test(e.message),
  );
  parameterChecks.push({
    source: program.source,
    constructedCheckpoint: checkpoint,
    input: { variable0: 1, mp: [2048, 2049] },
    intermediateSyncPc: 45,
    lowMpSelectedPc: 62,
    lowMpOutputVariable0: 0,
    highMpBlockedPc: 47,
    abilitiesExecuted: false,
    liveParametersUnchanged: true,
  });
}
assert.equal(ability(696).plan, null);
assert.ok(ability(696).blockers.some((s) => s.includes("function type 38")));

// Check every supplied LoopAct instruction independently of unsupported nearby
// triggers. This does not turn those complete enemy scripts into runnable AI.
const loopInstructions = [];
for (const asset of assets) {
  const program = programs.get(asset.source.assetPath.split("/").at(-1));
  if (!program) continue;
  for (const [pc, raw] of asset.data.Mnemonics.entries()) {
    if (raw.mnemonic !== "LoopAct") continue;
    const op = program.instructions[pc].op;
    assert.equal(op.kind, "loop-act");
    const random = {
      integer: () => {
        throw new Error("LoopAct must not draw an ability");
      },
      float: () => {
        throw new Error("LoopAct must not draw an ability");
      },
    };
    const expected = raw.operands.iValues.flatMap((id, index) =>
      Array(Math.trunc(raw.operands.rValues[index])).fill(id),
    );
    assert.deepEqual(
      selectBattleAIAbilities({ ...op, pc, selected: true }, random),
      expected,
    );
    assert.deepEqual(
      selectBattleAIAbilities({ ...op, pc, selected: false }, random),
      [],
    );
    loopInstructions.push({
      source: program.source,
      pc,
      abilities: op.abilities,
      counts: op.counts,
      expanded: expected,
    });
  }
}
assert.equal(loopInstructions.length, 97);

// Only the source instruction and its ability definitions are imported here.
// The surrounding normal table is an explicitly synthetic mechanism harness;
// unimplemented CounterActReceiveCommand/other source triggers remain blocked.
const loopHostChecks = [];
for (const [name, pc, expected] of [
  ["sc_ai_058_Devoahan.json", 9, [462, 1, 1]],
  ["sc_ai_0C8_Aspidochelon.json", 10, [574, 1, 1]],
]) {
  const original = programs.get(name);
  const content = structuredClone(encounterContent(catalog, 3));
  content.enemies = [content.enemies[0]];
  const enemy = content.enemies[0];
  enemy.ai = {
    kind: "battle-ai-v4",
    source: null,
    entry: 0,
    end: 6,
    blockers: [],
    instructions: [
      { mnemonic: "Nop", op: { kind: "nop" } },
      { mnemonic: "SyncAI", op: { kind: "sync" } },
      { mnemonic: "StartTable", op: { kind: "start-table", tableId: 0 } },
      structuredClone(original.instructions[pc]),
      { mnemonic: "EndTable", op: { kind: "end-table" } },
      { mnemonic: "JumpBattleAI", op: { kind: "jump", target: 0 } },
    ],
  };
  enemy.abilities = battleAIAbilities(enemy.ai);
  enemy.name = "连续行动机制检查";
  enemy.hp = enemy.mp = 10000;
  content.players.forEach((p) => {
    p.hp = 10000;
  });
  content.initialAtb = { player: [0, 0], enemy: [100, 100] };
  for (const id of enemy.abilities) content.abilities[id] = ability(id);
  const b = new BattleGame(content, 317);
  const actions = [];
  for (let i = 0; i < expected.length; i++) {
    b.advance(10);
    assert.equal(b.action.kind, "loop");
    assert.equal(b.action.source.id, expected[i]);
    assert.equal(b.enemyAIState(enemy.id).actTurn, 0);
    b.advance(400);
    assert.ok(b.action.resolved);
    actions.push(structuredClone(b.action));
    b.advance(500);
    assert.equal(b.enemies[0].queued, i < expected.length - 1);
    if (i < expected.length - 1) assert.equal(b.enemies[0].atb, 100);
    else assert.ok(b.enemies[0].atb > 0 && b.enemies[0].atb < 1);
  }
  assert.deepEqual(b.pendingActions, []);
  const run = (parts) => {
    const battle = new BattleGame(content, 317);
    for (const dt of parts) battle.advance(dt);
    return {
      units: battle.combatants,
      events: battle.events,
      action: battle.action,
      pending: battle.pendingActions,
      ai: battle.enemyAIState(enemy.id),
    };
  };
  assert.deepEqual(run([60000]), run(Array(6000).fill(10)));
  // The original complete program is still gated, rather than ignoring triggers.
  const full = structuredClone(content);
  full.enemies[0].ai = original;
  full.enemies[0].abilities = battleAIAbilities(original);
  assert.throws(() => new BattleGame(full, 317), /unsupported AI instruction/);
  loopHostChecks.push({
    source: original.source,
    sourcePc: pc,
    syntheticSurroundingTable: true,
    actions,
    framePartitionReplay: true,
    originalProgramStillBlocked: true,
  });
  if (loopHostChecks.length === 1)
    await writeFile(
      root + "/build/reports/loop-probe.json",
      JSON.stringify(content, null, 2) + "\n",
    );
}

// Same host parameters/poses deliberately isolate AI from enemy asset/stat migration.
const hostChecks = [];
for (const name of [
  "sc_ai_037_Siegfried.json",
  "sc_ai_14F_Soldier.json",
  "sc_ai_537_Brachiosaur.json",
  "sc_ai_16E_thina.json",
  "sc_ai_157_ShortArm.json",
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
  const behavior = one.combatants.find((c) => c.id === enemy.id).behavior;
  if (name === "sc_ai_16E_thina.json") assert.equal(behavior.mode, 1);
  if (name === "sc_ai_157_ShortArm.json") {
    const higher = structuredClone(content);
    higher.enemies[0].hp = 10113;
    assert.throws(
      () => new BattleGame(higher, 239),
      (e) =>
        e instanceof BattleAIError &&
        e.pc === 7 &&
        /ability 696/.test(e.message),
    );
  }
  hostChecks.push({
    source: program.source,
    abilities: enemy.abilities,
    actionCountInRetainedLog: actions.length,
    replay: true,
    ai: one.ai,
    behavior,
    controlledHp: enemy.hp,
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
  fullyDecodedPrograms: rows.filter((r) => !r.blockers.length).length,
  rows,
  traces,
  parameterChecks,
  loopInstructions,
  loopHostChecks,
  hostChecks,
  highLevelDependencyGate: true,
  limitations: [
    "decoding-is-not-playable-enemy-or-map-coverage",
    "host-probes-use-opening-parameters-and-poses-with-source-ai",
    "no-confusion-behavior-from-condition-branch-probe",
    "no-function-38-ability-696-effects",
    "only-basic-counter-readiness-and-CounterAct-no-final-or-full-boss-event-support",
    "loop-ability-effects-and-auto-targets-must-pass-existing-admission",
    "loop-host-probes-import-source-instructions-into-explicit-synthetic-normal-tables",
    "advanced-counter-query-triggers-and-ability-6-gauge-exception-remain-gated",
    "constructed-soulsaver-checkpoint-is-control-flow-only-not-source-save-or-playable-enemy",
    "shared-ability-and-event-writes-to-enemy-variables-remain-unimplemented",
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
    decoded: report.fullyDecodedPrograms,
    hostChecks: hostChecks.length,
    loopInstructions: loopInstructions.length,
    loopHostChecks: loopHostChecks.length,
    contentHash: report.contentHash,
  }),
);
