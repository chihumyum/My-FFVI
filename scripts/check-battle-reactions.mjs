// Source instruction/ability probes hosted in explicit synthetic action tables.
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
import { selectBattleAIAbilities } from "../dist/src/core/battle-ai.js";
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
assert.equal(catalog.common.profile, "narshe-playability-v17");
assert.equal(catalog.common.sourceContentHash, source.contentHash);
assert.deepEqual(catalog.common.reactions, {
  counterLimit: 1,
  excludedAbilityIds: [696, 1140, 1262],
});
const programs = new Map(),
  instructions = [],
  programBlockers = [];
for (const asset of Object.values(exported.assets).filter((a) =>
  a.source.assetPath.includes("/MonsterAI/"),
)) {
  const files = exported.sources.filter(
    (s) =>
      s.file === asset.source.file || s.file.endsWith("/" + asset.source.file),
  );
  assert.equal(files.length, 1);
  const identity = {
    ...asset.source,
    sha256: files[0].sha256,
    sourceSetHash: source.parentSourceSetHash,
    battleSourceSetHash: source.sourceSetHash,
  };
  let program;
  try {
    program = compileBattleAI(asset.data, identity);
  } catch (error) {
    programBlockers.push({ source: identity, reason: error.message });
    for (const [pc, raw] of (asset.data.Mnemonics ?? []).entries())
      if (raw.mnemonic === "CounterAct")
        instructions.push({
          source: identity,
          pc,
          blocker: "invalid AI program encoding",
        });
    continue;
  }
  programs.set(asset.source.assetPath.split("/").at(-1), program);
  for (const [pc, raw] of asset.data.Mnemonics.entries()) {
    if (raw.mnemonic !== "CounterAct") continue;
    const op = program.instructions[pc].op;
    if (op.kind === "blocked") {
      instructions.push({ source: program.source, pc, blocker: op.reason });
      continue;
    }
    assert.equal(op.kind, "counter-act");
    assert.deepEqual(op.abilities, raw.operands.iValues);
    assert.deepEqual(op.weights, raw.operands.rValues);
    const act = { ...op, pc, selected: true };
    const first = selectBattleAIAbilities(act, {
      integer: (min) => min,
      float: (min) => min,
    });
    const last = selectBattleAIAbilities(act, {
      integer: (_, max) => max,
      float: (_, max) => max,
    });
    assert.equal(
      first[0],
      op.abilities[op.weights.length ? op.weights.findIndex((w) => w > 0) : 0],
    );
    assert.equal(last[0], op.abilities.at(-1));
    instructions.push({
      source: program.source,
      pc,
      abilities: op.abilities,
      weights: op.weights,
      first,
      last,
    });
  }
}
const probes = [];
for (const [name, pc, expected, missingAbilityId, initialRouteBlocked] of [
  ["sc_ai_002_Templar.json", 5, 379, 40, false],
  ["sc_ai_054_Tonberry.json", 5, 459, 154, true],
]) {
  const original = programs.get(name);
  assert.equal(original.instructions[pc].op.kind, "counter-act");
  const content = structuredClone(encounterContent(catalog, 3));
  content.enemies = [content.enemies[0]];
  const enemy = content.enemies[0];
  enemy.ai = {
    kind: "battle-ai-v4",
    source: null,
    entry: 0,
    end: 7,
    blockers: [],
    instructions: [
      { mnemonic: "Nop", op: { kind: "nop" } },
      { mnemonic: "SyncAI", op: { kind: "sync" } },
      { mnemonic: "StartTable", op: { kind: "start-table", tableId: 0 } },
      { mnemonic: "Act", op: { kind: "act", abilities: [1], weights: [100] } },
      structuredClone(original.instructions[pc]),
      { mnemonic: "EndTable", op: { kind: "end-table" } },
      { mnemonic: "JumpBattleAI", op: { kind: "jump", target: 0 } },
    ],
  };
  enemy.abilities = battleAIAbilities(enemy.ai);
  enemy.name = "来源反击机制检查";
  enemy.hp = enemy.mp = 10000;
  content.players.forEach((p) => {
    p.hp = 10000;
  });
  content.initialAtb = { player: [100, 100], enemy: [100, 100] };
  for (const id of enemy.abilities)
    content.abilities[id] = compileDevelopmentAbility(
      reader,
      id,
      `机制能力 #${id}`,
    );
  // Isolate queue priority with an explicitly uncharged source attack and a
  // synthetic command. The actual opening unlocks and source wait value stay intact.
  content.abilities[1].wait = 0;
  content.commands[900001] = {
    id: 900001,
    name: "机制检查普通攻击",
    kind: "ability",
    abilityIds: [1],
    referencedAbility: null,
    forbiddenConditionIds: [],
  };
  content.players[0].abilities.push(1);
  content.players[0].commands.push(900001);
  const b = new BattleGame(content, 409);
  const attacker = b.players[0].id;
  assert.equal(b.command(attacker, 1, enemy.id, 900001), true);
  b.advance(10);
  const normal = structuredClone(b.pendingActions[0]);
  assert.equal(normal.actor, enemy.id);
  assert.equal(normal.kind, "normal");
  b.advance(400);
  const trigger = structuredClone(b.action);
  assert.equal(b.pendingActions[0].kind, "counter");
  assert.equal(b.pendingActions[0].source.id, expected);
  assert.deepEqual(b.pendingActions[0].targetIds, [attacker]);
  assert.equal(b.enemies[0].atb, 100);
  b.advance(510);
  assert.equal(b.action.kind, "counter");
  b.advance(400);
  const counter = structuredClone(b.action);
  assert.equal(counter.resolved, true);
  b.advance(500);
  assert.equal(b.enemies[0].atb, 100);
  assert.equal(b.enemies[0].queued, true);
  assert.deepEqual(
    b.pendingActions.map(({ charge, ...a }) => a),
    [{ ...normal, charge: undefined }].map(({ charge, ...a }) => a),
  );
  assert.ok(b.pendingActions[0].charge < normal.charge);
  b.advance(10);
  assert.equal(b.action.kind, "normal");
  b.advance(900);
  assert.ok(b.enemies[0].atb > 0 && b.enemies[0].atb < 1);
  const replay = (parts) => {
    const b = new BattleGame(content, 409);
    b.command(attacker, 1, enemy.id, 900001);
    parts.forEach((dt) => b.advance(dt));
    return b;
  };
  assert.deepEqual(replay([60000]), replay(Array(6000).fill(10)));
  const full = structuredClone(content);
  full.enemies[0].ai = original;
  full.enemies[0].abilities = battleAIAbilities(original);
  for (const id of full.enemies[0].abilities)
    full.abilities[id] = compileDevelopmentAbility(
      reader,
      id,
      `机制能力 #${id}`,
    );
  let originalBlocker = null;
  try {
    new BattleGame(full, 409);
  } catch (error) {
    originalBlocker = error.message;
  }
  // v16 admits Templar's IsRecevieAbility predicate, so its first normal route
  // can start. Admission of that route still does not close all source ability
  // dependencies. Keep those two claims separate instead of requiring an old
  // unsupported-opcode failure after that opcode has been implemented.
  assert.equal(
    originalBlocker !== null,
    initialRouteBlocked,
    "Unexpected original AI first-route admission",
  );
  const originalAbilityBlockers = full.enemies[0].abilities.flatMap((id) =>
    full.abilities[id].plan
      ? []
      : [{ abilityId: id, blockers: full.abilities[id].blockers }],
  );
  const missingDependency = originalAbilityBlockers.find(
    (entry) => entry.abilityId === missingAbilityId,
  );
  assert.ok(
    missingDependency?.blockers.length,
    "A controlled instruction must not be counted as the full enemy",
  );
  probes.push({
    source: original.source,
    sourcePc: pc,
    syntheticSurroundingTable: true,
    syntheticPlayerCommand: 900001,
    controlledIncomingWait: 0,
    trigger,
    counter,
    gaugeAfterCounter: 100,
    normalActionPreserved: true,
    gaugeAfterNormal: 0,
    replay: true,
    originalBlocker,
    originalInitialRouteAdmitted: originalBlocker === null,
    originalAbilityBlockers,
  });
  if (probes.length === 1)
    await writeFile(
      root + "/build/reports/counter-probe.json",
      JSON.stringify(content, null, 2) + "\n",
    );
}
const report = {
  lane: "source-counter-instructions-and-controlled-hosts",
  profile: catalog.common.profile,
  sourceSetHash: source.parentSourceSetHash,
  battleSourceSetHash: source.sourceSetHash,
  fieldSourceSetHash: catalog.common.fieldSourceSetHash,
  catalogHash: catalog.contentHash,
  reactionSource: source.reactionSource,
  rules: source.reactions,
  instructionCount: instructions.length,
  decoded: instructions.filter((i) => !i.blocker).length,
  instructions,
  programBlockers,
  probes,
  limitations: [
    "not-original-game-parity",
    "not-full-enemy-or-map-coverage",
    "no-final-attack-or-recovery-specific-trigger",
    "single-target-living-counter-ranges-3-and-7",
    "only-existing-admitted-primary-result-providers",
    "development-atb-and-prng",
  ],
};
report.contentHash = hash(report);
await writeFile(
  root + "/build/reports/battle-reactions-check.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    instructions: report.instructionCount,
    decoded: report.decoded,
    probes: probes.length,
    contentHash: report.contentHash,
  }),
);
