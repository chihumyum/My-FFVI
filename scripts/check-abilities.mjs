// Private source checks. Dispatch counts are not unlocked or playable abilities.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  compileOpeningBattle,
  battleTableIndex,
} from "../dist/src/compiler/battle.js";
import {
  compileAbilityProgram,
  compileDevelopmentAbility,
} from "../dist/src/compiler/ability.js";
import { readSnapshot, snapshotFile } from "../dist/src/compiler/integrity.js";
import { hash } from "../dist/src/compiler/content.js";
import { BattleGame } from "../dist/src/core/battle.js";
import { controlledBattleContent as encounterContent } from "./battle-probe-context.mjs";

const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const source = await compileOpeningBattle(root);
const imported = await readSnapshot(root + "/build/import");
const exported = JSON.parse(
  snapshotFile(
    await readSnapshot(root + "/build/battle"),
    "battle.json",
  ).toString(),
);
const tables = JSON.parse(snapshotFile(imported, "tables.json").toString());
const index = battleTableIndex(tables, exported.tableSources);
const decoded = [],
  rejected = [],
  admitted = [],
  blocked = [],
  functionUse = {},
  processUse = {};
for (const a of tables["ability.csv"]) {
  const id = Number(a.id);
  let compiled;
  try {
    compiled = compileAbilityProgram(index, id);
  } catch (error) {
    rejected.push({ abilityId: id, reason: error.message });
    continue;
  }
  decoded.push({ ...compiled, contentHash: hash(compiled) });
  for (const fn of compiled.program.functions)
    (functionUse[fn.type] ??= []).push({
      abilityId: id,
      slot: fn.slot,
      values: fn.values,
    });
  (processUse[compiled.program.process.key] ??= []).push(id);
  const ability = compileDevelopmentAbility(index, id, `能力 #${id}`);
  if (ability.plan) admitted.push(ability);
  else blocked.push({ abilityId: id, reasons: ability.blockers });
}
// The known source is expected to remain decodable; a newly broken source fails.
assert.deepEqual(rejected, []);
assert.equal(decoded.length, tables["ability.csv"].length);
const catalog = JSON.parse(
  await readFile(root + "/build/game/opening-playable.json", "utf8"),
);
assert.equal(catalog.common.sourceContentHash, source.contentHash);
assert.equal(Object.keys(catalog.common.abilities).length, decoded.length);
for (const ability of admitted) {
  const published = catalog.common.abilities[ability.id];
  assert.ok(published);
  assert.deepEqual(published.program, ability.program);
  if (published.plan) assert.deepEqual(published.plan, ability.plan);
  else assert.ok(published.blockers.length, "A blocked source plan needs an explicit host/display reason");
}
for (const ability of blocked) assert.equal(catalog.common.abilities[ability.abilityId].plan, null);
const base = encounterContent(catalog, 3);
assert.ok(base);
const results = [];
// Abilities using fixed HP, MP, and both resources, outside the Guard/Magitek subset.
for (const id of [760, 761, 764, 765, 766, 1288]) {
  const ability = compileDevelopmentAbility(index, id, `能力 #${id}`);
  assert.ok(ability.plan, ability.blockers.join(";"));
  const run = (parts) => {
    const content = structuredClone(base);
    content.abilities[id] = ability;
    content.players[0].abilities = [id];
    content.players[0].commands = [900001];
    // Controlled mechanism setup, not a source command unlock.
    content.commands[900001] = {
      id: 900001,
      name: "Controlled",
      kind: "ability",
      abilityIds: [id],
      referencedAbility: null,
      forbiddenConditionIds: [],
    };
    content.initialAtb = { player: [100, 100], enemy: [0, 0] };
    const battle = new BattleGame(content, 11);
    const actor = battle.players[0];
    actor.hp = 1;
    actor.mp = 0;
    actor.maxMp = 1000;
    const before = { hp: actor.hp, mp: actor.mp };
    assert.equal(battle.command(actor.id, id, actor.id), true);
    for (const dt of parts) battle.advance(dt);
    const resources = new Set(
      ability.plan.effects
        .filter((e) => e.kind === "recovery")
        .map((e) => e.resource),
    );
    assert.equal(
      actor.hp,
      resources.has("hp")
        ? Math.min(actor.maxHp, before.hp + ability.power)
        : before.hp,
    );
    assert.equal(
      actor.mp,
      resources.has("mp")
        ? Math.min(actor.maxMp, before.mp + ability.power)
        : before.mp,
    );
    assert.equal(
      battle.events.filter((e) => e.text.includes("恢复")).length,
      ability.plan.effects.length,
    );
    return {
      combatants: battle.combatants,
      events: battle.events,
      action: battle.action,
    };
  };
  const result = run([900]);
  assert.deepEqual(result, run(Array(90).fill(10)));
  results.push({
    abilityId: id,
    program: ability.program,
    effects: ability.plan.effects,
    result,
  });
}
const report = {
  lane: "source-dispatch-and-controlled-development-effects",
  sourceSetHash: source.parentSourceSetHash,
  battleSourceContentHash: source.contentHash,
  profile: catalog.common.profile,
  decoded,
  rejected,
  admitted,
  blocked,
  functionUse,
  processUse,
  checks: results,
  doesNotEstablish: [
    "original-parity",
    "ability-unlock",
    "items-inventory",
    "full-targeting",
    "status-engine",
    "complete-battle",
    "full-game-playability",
  ],
};
await mkdir(root + "/build/reports", { recursive: true });
await writeFile(
  root + "/build/reports/ability-check.json",
  JSON.stringify({ ...report, contentHash: hash(report) }, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    contentHash: hash(report),
    decoded: decoded.length,
    rejected: rejected.length,
    admittedDevelopmentPlans: admitted.length,
    blockedDevelopmentPlans: blocked.length,
    controlledAbilityChecks: results.map((r) => r.abilityId),
  }),
);
