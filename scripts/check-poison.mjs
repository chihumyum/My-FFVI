import { sourceBattleInventory } from "./battle-probe-context.mjs";
// Real-source condition/action/item probes with explicit controlled ownership.
// These are not original-game recordings or proof of story acquisition.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { readSnapshot, snapshotFile } from "../dist/src/compiler/integrity.js";
import { battleTableIndex } from "../dist/src/compiler/battle.js";
import { compileDevelopmentAbility } from "../dist/src/compiler/ability.js";
import { compileItem } from "../dist/src/compiler/items.js";
import {
  compileBattleConditionCatalog,
  hasPoisonBehavior,
} from "../dist/src/compiler/conditions.js";
import { hash } from "../dist/src/compiler/content.js";
import { verifyContent } from "../dist/src/core/content-integrity.js";
import { BattleConditions } from "../dist/src/core/battle-conditions.js";
import { FieldConditions } from "../dist/src/core/field-conditions.js";
import { BattleGame } from "../dist/src/core/battle.js";
import { GameState } from "../dist/src/core/game-state.js";
import { sourceBattleContent as encounterContent, controlledBattleContent } from "./battle-probe-context.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const reportPath = root + "build/reports/poison-check.json";
const sha = (data) => createHash("sha256").update(data).digest("hex");
await mkdir(root + "build/reports", { recursive: true });
await rm(reportPath, { force: true });
execFileSync(process.execPath, [root + "scripts/check-poison-native.mjs"], {
  cwd: root,
  stdio: "pipe",
});
const nativeBytes = await readFile(
  root + "build/reports/poison-native-check.json",
);
const native = JSON.parse(nativeBytes);
assert.equal(native.semanticsVerified, false);
const imported = await readSnapshot(root + "build/import");
const exported = JSON.parse(
  snapshotFile(await readSnapshot(root + "build/battle"), "battle.json"),
);
const tables = JSON.parse(snapshotFile(imported, "tables.json"));
const manifest = JSON.parse(snapshotFile(imported, "project.json"));
const source = await verifyContent(
  JSON.parse(await readFile(root + "build/game/opening-battle.json", "utf8")),
);
const catalog = await verifyContent(
  JSON.parse(await readFile(root + "build/game/opening-playable.json", "utf8")),
);
assert.equal(manifest.sourceSetHash, source.parentSourceSetHash);
assert.equal(exported.parentSourceSetHash, manifest.sourceSetHash);
assert.equal(source.sourceSetHash, exported.sourceSetHash);
assert.equal(catalog.common.sourceContentHash, source.contentHash);
const index = battleTableIndex(tables, exported.tableSources);
const provenance = new Map();
function row(table, id) {
  const raw = tables[table].filter((r) => r.id === String(id));
  assert.equal(raw.length, 1, `${table}:${id}`);
  const selected = index.row(table, id);
  const published = source.tables[table]?.[id];
  if (published) {
    assert.deepEqual(published.values, raw[0]);
    assert.deepEqual(published.source, selected.source);
  }
  const files = exported.sources.filter(
    (f) =>
      f.file === selected.source.file ||
      f.file.endsWith("/" + selected.source.file),
  );
  assert.equal(files.length, 1, `${table}:${id}: source file`);
  provenance.set(`${table}:${id}`, {
    table,
    rowId: String(id),
    source: selected.source,
    fileSha256: files[0].sha256,
    rowHash: hash(raw[0]),
    publishedSourceClosure: !!published,
  });
  return selected;
}
const compiled = compileBattleConditionCatalog(
  index,
  tables["condition.csv"].map((r) => Number(r.id)),
  (key) => key,
);
assert.deepEqual(
  compiled.catalog.behaviors.map(({ name, ...b }) => b),
  catalog.common.conditions.behaviors.map(({ name, ...b }) => b),
);
assert.deepEqual(compiled.catalog.rules, catalog.common.conditions.rules);
const conditions = new BattleConditions(catalog.common.conditions);
const poisonRows = tables["condition.csv"]
  .filter((r) => r.condition_type === "10")
  .map((r) => row("condition.csv", r.id));
assert.deepEqual(
  poisonRows.map((r) => Number(r.values.id)),
  [10, 88],
);
assert.equal(hasPoisonBehavior(poisonRows[0]), true);
assert.equal(hasPoisonBehavior(poisonRows[1]), false);
assert.equal(poisonRows[1].values.condition_group_id, "1303");
assert.deepEqual(conditions.poisonIds([4, 10]), [10]);
assert.deepEqual(conditions.poisonIds([4, 88]), [88]);
assert.deepEqual(Object.keys(poisonRows[1].values).filter((key) => poisonRows[1].values[key] !== poisonRows[0].values[key]).sort(),
  ["condition_group_id", "erase_condition_group_id", "id"]);
const providerRows = tables["condition_group.csv"].filter((r) => r.group_id === poisonRows[1].values.condition_group_id);
assert.deepEqual(providerRows.map((r) => [Number(r.condition_id), Number(r.type_id)]), [[10, 1]]);
const provider = { groupId: Number(poisonRows[1].values.condition_group_id),
  conditions: Object.fromEntries(providerRows.map((r) => [r.condition_id, Number(r.type_id)])) };
assert.deepEqual(catalog.common.conditions.behaviors.find((b) => b.id === 88).resistanceProvider, provider);
const field = new FieldConditions(catalog.gameState.fieldConditions);
field.validateActive([10]);
assert.throws(() => field.validateActive([88]), /Unimplemented active field/);
for (const id of [15, 16])
  assert.throws(() => conditions.validateActive([id]), /Unimplemented active/);
assert.equal(row("condition.csv", 10).values.until_type, "3");
assert.equal(row("condition.csv", 10).values.rate_type1, "3");
assert.equal(row("condition.csv", 10).values.rate_value1, "16");
assert.equal(row("condition.csv", 10).values.damage_number, "32");
function recordSource(r) {
  const matches = Object.entries(exported.tableSources).filter(
    ([, s]) =>
      s.assetPath === r.source.assetPath && s.objectId === r.source.objectId,
  );
  assert.equal(matches.length, 1);
  row(matches[0][0], r.values.id);
}
for (const r of compiled.sources) recordSource(r);

const poisonAbilities = tables["ability.csv"]
  .map((r) => compileDevelopmentAbility(index, Number(r.id), r.id))
  .filter((a) =>
    a.program.functions.some((fn) => fn.type === 9 && fn.values[0] === 10),
  );
const admitted = poisonAbilities.filter((a) => a.plan);
assert.deepEqual(
  admitted.map((a) => a.id),
  [
    417, 426, 427, 430, 455, 461, 465, 491, 494, 507, 518, 552, 607, 609, 622,
    647, 651,
  ],
);
for (const a of poisonAbilities) {
  row("ability.csv", a.id);
  row("function_group.csv", a.program.groupId);
  for (const f of a.program.functions) row("function.csv", f.functionId);
}
const cases = [];
const providerState = [88], providerBase = { 10: 0, 6: 1 };
const noRng = () => assert.fail("Unexpected temporary poison resistance draw");
assert.deepEqual(conditions.effectiveResistances(providerState, providerBase, "enemy"), { 10: 1, 6: 1 });
for (const fixed of [false, true]) {
  assert.deepEqual(conditions.add(providerState, providerBase, 10, { fixed, accuracy: 255, magicEvasion: 0 }, noRng, "enemy"),
    { currentIds: [88], added: [], removed: [], missed: true });
}
const providerClock = conditions.reconcilePoisonState(providerState, [], 1);
assert.deepEqual(providerClock, [{ conditionId: 88, elapsedSeconds: 0, thresholdSeconds: 8 }]);
const providerTick = conditions.advancePoison({ conditionIds: providerState, state: providerClock,
  hp: 160, maxHp: 160, elementResistances: {}, seconds: 8, atbSpeed: 1, isTimeStopped: false });
assert.equal(providerTick.hp, 150); assert.equal(providerTick.ticks[0].conditionId, 88);
assert.deepEqual(conditions.recover(providerState, [10]).currentIds, [88]);
const providerRemoved = conditions.recover(providerState, [88]).currentIds;
assert.deepEqual(providerRemoved, []);
assert.deepEqual(conditions.effectiveResistances(providerRemoved, providerBase, "enemy"), providerBase);
assert.deepEqual(conditions.reconcilePoisonState(providerRemoved, providerTick.state, 1), []);
assert.deepEqual(conditions.settleLife(0, providerState, false).conditionIds, [5]);
assert.deepEqual(conditions.battleEnd(providerState), [88]);
assert.deepEqual(providerState, [88]); assert.deepEqual(providerBase, { 10: 0, 6: 1 });
cases.push({ kind: "source-active-poison-provider", conditionId: 88, provider, tick: providerTick,
  ordinaryApplicationAdmitted: false, fieldPersistenceAdmitted: false });
for (const a of admitted) {
  const [effect] = a.plan.effects;
  assert.equal(a.plan.effects.length, 1);
  assert.equal(effect.kind, "add-condition");
  assert.equal(effect.conditionId, 10);
  const added = conditions.add(
    [],
    {},
    effect.conditionId,
    { accuracy: effect.accuracy, fixed: effect.fixedHit, magicEvasion: 0 },
    () => 0,
  );
  assert.deepEqual(added.currentIds, [10]);
  const firstState = conditions.reconcilePoisonState(added.currentIds, [], 1);
  const tick = conditions.advancePoison({
    conditionIds: added.currentIds,
    state: firstState,
    hp: 159,
    maxHp: 159,
    elementResistances: {},
    seconds: 8,
    atbSpeed: 1,
    isTimeStopped: false,
  });
  assert.equal(tick.hp, 150);
  assert.equal(tick.ticks[0].amount, 9);
  assert.equal(tick.state[0].thresholdSeconds, 16);
  const dead = conditions.settleLife(0, added.currentIds, false);
  assert.deepEqual(dead.conditionIds, [5]);
  assert.deepEqual(
    conditions.reconcilePoisonState(dead.conditionIds, tick.state, 1),
    [],
  );
  assert.deepEqual(conditions.battleEnd(added.currentIds), [10]);
  cases.push({
    kind: "source-add-poison-and-lifecycle",
    abilityId: a.id,
    added,
    tick,
    death: dead,
  });
}

const antidote = compileItem(index, 12, "source-item-12");
for (const r of antidote.sources) recordSource(r);
for (const context of ["menu", "battle"]) {
  assert.deepEqual(antidote.definition.uses[context].plan.effects, [
    { slot: 1, kind: "recover-condition", conditionIds: [10, 88] },
  ]);
  assert.deepEqual(
    catalog.gameState.items[12].uses[context].plan,
    antidote.definition.uses[context].plan,
  );
}
const makeState = () =>
  new GameState(
    catalog.gameState,
    catalog.common.players,
    catalog.contentHash,
    catalog.common.conditions,
  );
const owned = makeState();
const saved = owned.snapshot();
const target = saved.roster.find((p) => p.id === owned.activeParty[0].id);
target.conditionIds = [10]; // Controlled precondition; not a story unlock or runtime mutation.
owned.restore(saved);
owned.changeItems([{ id: 12, count: 1 }], "grant"); // Real source item, controlled ownership.
const persisted = JSON.parse(JSON.stringify(owned.snapshot()));
const restored = makeState();
restored.restore(persisted);
assert.deepEqual(restored.snapshot(), persisted);
assert.match(restored.fieldMovementBlocker, /交通状态/);
assert.equal(restored.fieldMoveBlocker(1, true), null);
const menuHp = restored.snapshot().roster.find((p) => p.id === target.id).hp;
assert.equal(restored.useMenuItem(12, target.id), true);
assert.equal(restored.fieldMovementBlocker, null);
assert.equal(
  restored.snapshot().roster.find((p) => p.id === target.id).hp,
  menuHp,
);
assert.deepEqual(
  restored.snapshot().roster.find((p) => p.id === target.id).conditionIds,
  [],
);
assert.equal(restored.snapshot().items.find((i) => i.id === 12)?.count ?? 0, 0);
cases.push({
  kind: "source-antidote-menu-after-stable-state-restore",
  contentId: 12,
  targetId: target.id,
  before: persisted,
  after: restored.snapshot(),
});

const lease = owned.openBattle(3, catalog.encounters[3].rewardPolicy);
const itemBattle = new BattleGame(
  encounterContent(catalog, 3),
  71,
  owned.battlePlayers(lease),
  owned.battleInventory(lease),
);
const itemTarget = itemBattle.players.find((p) => p.id === target.id);
itemTarget.atb = 100;
assert.deepEqual(itemBattle.conditionClockState(itemTarget.id), [
  { conditionId: 10, elapsedSeconds: 0, thresholdSeconds: 8 },
]);
const itemHp = itemTarget.hp;
assert.equal(
  itemBattle.commandItem(
    itemTarget.id,
    12,
    { kind: "single", id: itemTarget.id },
    3,
  ),
  true,
);
for (let elapsed = 0; elapsed < 450; elapsed += 10) {
  itemBattle.enemies.forEach((e) => {
    e.atb = 0;
  });
  itemBattle.advance(10);
}
assert.deepEqual(itemTarget.conditionIds, []);
assert.deepEqual(itemBattle.conditionClockState(itemTarget.id), []);
assert.equal(itemTarget.hp, itemHp);
assert.equal(itemBattle.inventory.find((i) => i.id === 12)?.count ?? 0, 0);
assert.deepEqual(
  owned.snapshot(),
  persisted,
  "Active battle uses a lease; it does not publish into field ownership before outcome",
);
cases.push({
  kind: "source-antidote-battle",
  contentId: 12,
  targetId: itemTarget.id,
  hp: itemTarget.hp,
  conditions: itemTarget.conditionIds,
  clocks: itemBattle.conditionClockState(itemTarget.id),
  inventory: itemBattle.inventory,
  events: itemBattle.events,
});

// Exercise a real source action, ordinary clock, source target poison weakness,
// and source cure through BattleGame. Only action ownership/readiness is forced.
const cure = compileDevelopmentAbility(index, 763, "source-cure-763");
assert.ok(cure.plan);
function battleChain(partitions) {
  const content = controlledBattleContent(catalog, 3);
  const sourceAction = admitted.find((a) => a.id === 417);
  content.abilities[417] = sourceAction;
  content.abilities[763] = cure;
  content.commands[900001] = {
    id: 900001,
    name: "Controlled source condition probe",
    kind: "ability",
    abilityIds: [417, 763],
    referencedAbility: null,
    forbiddenConditionIds: [],
  };
  content.players[0].abilities = [417, 763];
  content.players[0].commands = [900001];
  content.initialAtb = {
    player: content.players.map(() => 100),
    enemy: content.enemies.map(() => 0),
  };
  const battle = new BattleGame(content, 91, undefined, sourceBattleInventory(catalog));
  const actor = battle.players[0],
    enemy = battle.enemies[0];
  assert.equal(enemy.magicEvasion, 0);
  assert.equal(enemy.elementResistances[6], 1);
  assert.equal(battle.command(actor.id, 417, enemy.id, 900001), true);
  // Withhold enemy readiness at each controlled step, leaving poison progress
  // and action presentation on the real host path. No enemy AI claim is made.
  const advance = (ms) => {
    assert.equal(ms % 10, 0);
    for (let elapsed = 0; elapsed < ms; elapsed += 10) {
      for (const e of battle.enemies) e.atb = 0;
      battle.advance(10);
    }
  };
  for (const ms of partitions) advance(ms);
  assert.deepEqual(enemy.conditionIds, [10]);
  assert.equal(enemy.hp, enemy.maxHp - 2 * Math.floor(enemy.maxHp / 16));
  const beforeCure = {
    hp: enemy.hp,
    conditions: [...enemy.conditionIds],
    clocks: battle.conditionClockState(enemy.id),
    events: structuredClone(battle.events),
  };
  actor.atb = 100;
  assert.equal(battle.command(actor.id, 763, enemy.id, 900001), true);
  advance(950);
  assert.deepEqual(enemy.conditionIds, []);
  assert.deepEqual(battle.conditionClockState(enemy.id), []);
  assert.equal(enemy.hp, beforeCure.hp);
  return {
    beforeCure,
    afterCure: {
      hp: enemy.hp,
      conditions: enemy.conditionIds,
      clocks: battle.conditionClockState(enemy.id),
    },
    events: battle.events,
  };
}
const chain = battleChain([9000]);
assert.deepEqual(battleChain([1000, 3000, 5000]), chain);
cases.push({
  kind: "source-battle-poison-tick-and-cure",
  controls:
    "temporary ability ownership, command wrapper, player readiness, withheld enemy readiness",
  ...chain,
});
const report = {
  lane: "source-poison-behavior-and-controlled-system-chain",
  profile: catalog.common.profile,
  sourceSetHash: manifest.sourceSetHash,
  battleSourceContentHash: source.contentHash,
  catalogContentHash: catalog.contentHash,
  nativeReceiptSha256: sha(nativeBytes),
  nativeSemanticsVerified: false,
  poisonRows,
  activeConditionIds: [10, 88],
  ordinaryApplicationIds: [10],
  admittedAbilityIds: admitted.map((a) => a.id),
  blockedAbilities: poisonAbilities
    .filter((a) => !a.plan)
    .map((a) => ({ id: a.id, blockers: a.blockers })),
  provenance: [...provenance.values()],
  cases,
  doesNotEstablish: [
    "original runtime parity",
    "field poison step damage",
    "haste/slow/stop providers",
    "native rendering",
    "story ownership or reachability",
    "enemy AI coverage",
    "full-game playable coverage",
  ],
};
const output = JSON.stringify(report, null, 2) + "\n";
await writeFile(reportPath, output);
console.log(
  JSON.stringify({
    sourceAbilities: poisonAbilities.length,
    admittedAbilities: admitted.length,
    controlledCases: cases.length,
    sha256: sha(output),
    nativeSemanticsVerified: false,
  }),
);
