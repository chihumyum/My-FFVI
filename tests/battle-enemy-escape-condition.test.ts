import test from "node:test";
import assert from "node:assert/strict";
import { BattleConditions, type BattleConditionCatalog } from "../src/core/battle-conditions.js";
import { hasEscapeBehavior } from "../src/compiler/conditions.js";
import { compileDevelopmentAbility } from "../src/compiler/ability.js";
import { conditionSpeedAbilityFixture, conditionSpeedFixture } from "./fixtures/condition-speed.js";

/** Synthetic identities use the verified shape, not the original row ID or
 * source data. The catalog remains the only condition identity provider. */
function addEscape<T extends ReturnType<typeof conditionSpeedFixture>>(f: T) {
  const escape: Record<string, string> = { ...f.tables["condition.csv"]![0]!,
    id: "703", condition_type: "3", system_type: "4", target_type: "1",
    until_type: "2", attack_target: "1", erase_condition_group_id: "33", mes_id_name: "None" };
  f.tables["condition.csv"]!.push(escape);
  f.tables["erase_condition_group.csv"]!.push({ id: "703", group_id: "33",
    condition_id: "703", type_id: "3", erase_condition: "6" });
  return { ...f, escape };
}
const fixture = () => addEscape(conditionSpeedFixture());

test("Escape compilation retains its actual identity, conflict sources and hidden None name", () => {
  const f = fixture(), before = structuredClone(f.tables), compiled = f.compile();
  assert.equal(hasEscapeBehavior(f.reader().row("condition.csv", 703)), true);
  assert.deepEqual(compiled.catalog.behaviors.find(row => row.id === 703),
    { id: 703, kind: "escape", untilType: 2, name: "" });
  const engine = new BattleConditions(compiled.catalog);
  assert.equal(engine.escapeConditionId, 703);
  assert.equal(engine.name(703), "");
  assert.ok(compiled.sources.some(row => row.source.assetPath.endsWith("/condition.csv") && row.source.rowId === "703"));
  assert.ok(compiled.sources.some(row => row.source.assetPath.endsWith("/erase_condition_group.csv") && row.source.rowId === "703"));
  assert.deepEqual(f.tables, before);
});

test("every source numeric selector remains an admission boundary, including target versus game-over flags", () => {
  const f = fixture();
  for (const [key, value] of Object.entries(f.escape)) {
    if (key === "id" || key.startsWith("mes_id_")) continue;
    const raw = { ...f.escape, [key]: String(Number(value) + 1) };
    assert.equal(hasEscapeBehavior({ values: raw }), false, key);
    assert.deepEqual(f.escape, f.reader().row("condition.csv", 703).values);
  }
  const invalid = fixture(); invalid.escape.game_over_target = "1";
  const catalog = invalid.compile().catalog, engine = new BattleConditions(catalog);
  assert.ok(!catalog.behaviors.some(row => row.id === 703));
  assert.throws(() => engine.forceEnemyEscape([]), /Escape condition provider/);
  assert.throws(() => engine.validateActive([703]), /Unimplemented active/);
  const incomplete = { ...f.escape }; delete incomplete.battle_effect_asset_id;
  assert.throws(() => hasEscapeBehavior({ values: incomplete }), /Invalid table integer/);
});

test("forced escape applies the shared ordered conflict transaction without resistance, accuracy or a random stream", () => {
  const engine = new BattleConditions(fixture().compile().catalog), current = [53, 6, 4];
  const change = engine.forceEnemyEscape(current);
  assert.deepEqual(change, { currentIds: [53, 4, 703], added: [703], removed: [6], missed: false });
  assert.deepEqual(current, [53, 6, 4]);
  assert.equal(engine.isEscaped(change.currentIds), true);
  change.currentIds.push(6); change.added.length = 0;
  assert.deepEqual(engine.forceEnemyEscape(current),
    { currentIds: [53, 4, 703], added: [703], removed: [6], missed: false });
});

test("the native Contains branch is a detached no-op and does not replay conflict removal", () => {
  const engine = new BattleConditions(fixture().compile().catalog), current = [703, 6, 4];
  const change = engine.forceEnemyEscape(current);
  assert.deepEqual(change, { currentIds: current, added: [], removed: [], missed: false });
  change.currentIds.splice(0, 2);
  assert.deepEqual(current, [703, 6, 4]);
  assert.equal(engine.isEscaped(current), true);
});

test("conflict invalidation stays explicit while unknown active identities reject the whole candidate", () => {
  const f = fixture();
  f.tables["erase_condition_group.csv"]!.push({ id: "704", group_id: "1",
    condition_id: "6", type_id: "6", erase_condition: "703" });
  const engine = new BattleConditions(f.compile().catalog), current = [6, 4];
  assert.deepEqual(engine.forceEnemyEscape(current),
    { currentIds: current, added: [703], removed: [703], missed: false });
  assert.equal(engine.isEscaped(current), false);
  assert.deepEqual(current, [6, 4]);
  for (const ids of [[117], [999], [703, 117]]) {
    const before = [...ids];
    assert.throws(() => engine.forceEnemyEscape(ids), /Unknown|Unimplemented active/);
    assert.throws(() => engine.isEscaped(ids), /Unknown|Unimplemented active/);
    assert.deepEqual(ids, before);
  }
});

test("escape identity is neither death nor a permanent field state, and does not consume reward ownership", () => {
  const engine = new BattleConditions(fixture().compile().catalog);
  const owner = { hp: 17, mp: 9, exp: 29, gil: 13, conditionIds: [4] }, before = structuredClone(owner);
  const change = engine.forceEnemyEscape(owner.conditionIds);
  assert.equal(engine.isUnableFight(change.currentIds), false);
  assert.deepEqual(engine.settleLife(owner.hp, change.currentIds, false),
    { hp: 17, conditionIds: [4, 703] });
  engine.validateStableLife(owner.hp, change.currentIds);
  assert.deepEqual(engine.battleEnd(change.currentIds), [4]);
  const dead = engine.settleLife(0, change.currentIds, false);
  assert.deepEqual(dead, { hp: 0, conditionIds: [5] });
  assert.equal(engine.isEscaped(dead.conditionIds), false);
  assert.deepEqual(owner, before);
});

test("missing and ambiguous providers fail without hard-coded IDs or granting unrelated active behaviors", () => {
  const old = new BattleConditions(conditionSpeedFixture().compile().catalog);
  assert.equal(old.isEscaped([]), false);
  assert.equal(old.isEscaped([6]), false);
  assert.throws(() => old.escapeConditionId, /Escape condition provider/);
  assert.throws(() => old.forceEnemyEscape([]), /Escape condition provider/);
  const f = fixture();
  f.tables["condition.csv"]!.push({ ...f.escape, id: "704", until_type: "9" });
  const ambiguous = new BattleConditions(f.compile().catalog);
  assert.throws(() => ambiguous.escapeConditionId, /ambiguous Escape/);
  assert.throws(() => ambiguous.forceEnemyEscape([703]), /ambiguous Escape/);
  for (const mutate of [
    (catalog: BattleConditionCatalog) => { catalog.rules.definitions.find(row => row.id === 703)!.overlapped = true; },
    (catalog: BattleConditionCatalog) => { catalog.rules.definitions.find(row => row.id === 703)!.type = 5; },
    (catalog: BattleConditionCatalog) => { Object.assign(catalog.behaviors.find(row => row.id === 703)!, { untilType: 3 }); },
    (catalog: BattleConditionCatalog) => { Object.assign(catalog.behaviors.find(row => row.id === 703)!, { resistanceProvider: { groupId: 1, conditions: { 6: 1 } } }); },
  ]) {
    const catalog = fixture().compile().catalog; mutate(catalog);
    assert.throws(() => new BattleConditions(catalog), /Unsupported/);
  }
});

test("an admitted Escape behavior does not grant ordinary AddCondition effect compilation", () => {
  const f = addEscape(conditionSpeedAbilityFixture("haste"));
  assert.ok(compileDevelopmentAbility(f.reader(), 801, "Synthetic Haste").plan);
  f.group.function1_value1 = "703";
  assert.equal(compileDevelopmentAbility(f.reader(), 801, "Unadmitted ordinary Escape").plan, null);
  assert.ok(f.compile().catalog.behaviors.some(row => row.id === 703 && row.kind === "escape"));
});
