// Private source action checks. Controlled ownership/ATB are not story unlocks.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import {
  battleTableIndex,
  compileOpeningBattle,
} from "../dist/src/compiler/battle.js";
import {
  compileAbilityProgram,
  compileDevelopmentAbility,
} from "../dist/src/compiler/ability.js";
import { compileBattleCommand } from "../dist/src/compiler/commands.js";
import { compileConditionGroup } from "../dist/src/compiler/conditions.js";
import { readSnapshot, snapshotFile } from "../dist/src/compiler/integrity.js";
import { hash } from "../dist/src/compiler/content.js";
import { BattleGame } from "../dist/src/core/battle.js";
import { conditionsAllowAction } from "../dist/src/core/battle-conditions.js";
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
const index = battleTableIndex(tables, exported.tableSources);
const source = await compileOpeningBattle(root);
const catalog = JSON.parse(
  await readFile(root + "/build/game/opening-playable.json", "utf8"),
);
assert.equal(catalog.common.profile, "narshe-playability-v15");
assert.equal(catalog.common.sourceContentHash, source.contentHash);
const abilities = tables["ability.csv"].map((r) =>
  compileAbilityProgram(index, Number(r.id)),
);
const commandRestrictions = tables["command.csv"].map((r) => ({
  commandId: Number(r.id),
  ...compileConditionGroup(index, Number(r.condition_group_id)),
}));
const commands = [],
  blockedCommandBindings = [];
for (const r of tables["command.csv"]) {
  try {
    commands.push(compileBattleCommand(index, Number(r.id), (key) => key));
  } catch (error) {
    // Some source command groups need dynamic lists absent from ability.csv.
    // Preserve that blocker instead of inventing an empty membership/unlock.
    if (
      !error.message.startsWith(
        "Unresolved table group ability.csv.ability_group_id=",
      )
    )
      throw error;
    blockedCommandBindings.push({
      commandId: Number(r.id),
      reason: error.message,
    });
  }
}
const magic = abilities.find((a) => a.program.abilityId === 67).program;
const magitek = abilities.find((a) => a.program.abilityId === 218).program;
const magicCommand = commands.find((c) => c.command.id === 7).command;
const magitekCommand = commands.find((c) => c.command.id === 26).command;
assert.deepEqual(magic.forbiddenConditionIds, [6, 13]);
assert.deepEqual(magitek.forbiddenConditionIds, [13]);
assert.equal(
  conditionsAllowAction(
    [6],
    magic.forbiddenConditionIds,
    magicCommand.forbiddenConditionIds,
  ),
  false,
);
assert.equal(
  conditionsAllowAction(
    [6],
    magitek.forbiddenConditionIds,
    magitekCommand.forbiddenConditionIds,
  ),
  true,
);
assert.equal(
  conditionsAllowAction(
    [13],
    magitek.forbiddenConditionIds,
    magitekCommand.forbiddenConditionIds,
  ),
  false,
);

const base = encounterContent(catalog, 3);
const add = compileDevelopmentAbility(index, 389, "来源沉默动作");
const cure = compileDevelopmentAbility(index, 763, "来源状态恢复动作");
assert.ok(add.plan, add.blockers.join(";"));
assert.ok(cure.plan, cure.blockers.join(";"));
const run = (parts) => {
  const content = structuredClone(base);
  content.abilities[389] = add;
  content.abilities[763] = cure;
  content.commands[900001] = {
    id: 900001,
    name: "Controlled source action",
    kind: "ability",
    abilityIds: [389, 763],
    forbiddenConditionIds: [],
  };
  for (const p of content.players) {
    p.abilities = [389, 763];
    p.commands = [900001];
  }
  content.initialAtb = { player: [100, 100], enemy: [0, 0] };
  const b = new BattleGame(content, 11),
    actor = b.players[0],
    target = b.enemies[0];
  assert.equal(target.magicEvasion, 0);
  const states = [];
  for (const [abilityId, expected, missed] of [
    [389, [6], false],
    [389, [6], true],
    [763, [], false],
    [763, [], true],
  ]) {
    actor.atb = 100; // Explicit controlled readiness at each action boundary.
    assert.equal(b.command(actor.id, abilityId, target.id, 900001), true);
    for (const dt of parts) b.advance(dt);
    assert.deepEqual(target.conditionIds, expected);
    const log = b.events.at(-1).text;
    assert.equal(log.includes("状态未改变"), missed);
    states.push({ abilityId, expected, missed, log });
  }
  return {
    states,
    combatants: b.combatants,
    events: b.events,
    action: b.action,
  };
};
const result = run([950]);
assert.deepEqual(result, run(Array(95).fill(10)));
assert.deepEqual(
  base.enemies.map((e) => e.conditionIds),
  base.enemies.map(() => []),
);
const report = {
  lane: "source-restrictions-and-controlled-condition-actions",
  sourceSetHash: source.parentSourceSetHash,
  battleSourceContentHash: source.contentHash,
  profile: catalog.common.profile,
  abilities,
  commands,
  commandRestrictions,
  blockedCommandBindings,
  actions: [add, cure],
  result,
  doesNotEstablish: [
    "story-unlocks",
    "enemy-AI",
    "other-condition-behaviors",
    "equipment-conditions",
    "death-revival",
    "original-parity",
    "complete-battle",
    "full-game-playability",
  ],
};
await writeFile(
  root + "/build/reports/battle-condition-check.json",
  JSON.stringify({ ...report, contentHash: hash(report) }, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    contentHash: hash(report),
    abilityRestrictions: abilities.length,
    commandRestrictions: commandRestrictions.length,
    blockedCommandBindings,
    controlledActions: result.states.map((s) => ({
      abilityId: s.abilityId,
      missed: s.missed,
    })),
  }),
);
