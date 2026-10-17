import assert from "node:assert/strict";
import test from "node:test";
import { BattleGame } from "../src/core/battle.js";
import { battleAbilityContentAllowed, battleItemContentAllowed, projectFieldInvalidContents } from "../src/core/battle-entry.js";
import { battleEntryFixture } from "./fixtures/battle-entry.js";
import { battleEntryRuntimeFixture } from "./fixtures/battle-entry-runtime.js";
import { sourceQualifiedBattleFixture } from "./fixtures/battle-abilities.js";
import { itemFixture } from "./fixtures/items.js";

test("unknown save-point state blocks only the walking branch that reads it", () => {
  const f = battleEntryFixture(), context = { ...f.context, isSavePoint: null };
  assert.equal(projectFieldInvalidContents(f.catalog, context).invalidContentIds, null);
  assert.match(projectFieldInvalidContents(f.catalog, context).blockers.join(), /save-point/);
  assert.equal(projectFieldInvalidContents(f.catalog, { ...context, transportation: null }).invalidContentIds, null);
  assert.deepEqual(projectFieldInvalidContents(f.catalog, { ...context, transportation: { id: 6, type: 12 } }).invalidContentIds,
    [10001, 10002, 10003, 10004, 10005]);
  assert.deepEqual(projectFieldInvalidContents(f.catalog, { ...context, mapId: 101 }).invalidContentIds, [10002, 10003, 10005]);
  f.catalog.sleepingContents = [];
  assert.deepEqual(projectFieldInvalidContents(f.catalog, context).invalidContentIds, [10005]);
});

test("source item menu uses each actor's equipment and rejects the shared entry-time flag", () => {
  const { content, inventory } = battleEntryRuntimeFixture(0);
  const battle = new BattleGame(content, 51, undefined, inventory);
  assert.equal(content.qualificationContext!.itemMenuAvailable, true);
  assert.equal(battle.itemQualification("a").available, false);
  assert.equal(battle.itemQualification("b").available, true);
  assert.equal(battle.commandMenu("a").find((c) => c.id === 3)!.available, false);
  assert.equal(battle.commandMenu("b").find((c) => c.id === 3)!.available, true);
  const missing = new BattleGame(sourceQualifiedBattleFixture(), 51);
  assert.equal(missing.commandMenu("a").find((c) => c.id === 3)!.available, false);
  assert.match(missing.commandMenu("a").find((c) => c.id === 3)!.blockers.join(), /per-character/);
  assert.equal(missing.canUse("a", 10, 7), true, "unknown item context does not erase known abilities");
});

test("legacy synthetic battles tolerate a lease equipment snapshot without granting a source query", () => {
  const { content, inventory } = battleEntryRuntimeFixture();
  delete content.battleEntry;
  content.qualificationContext!.mode = "development-static";
  content.players.forEach((p) => { p.commands = [100]; });
  const battle = new BattleGame(content, 51, undefined, inventory);
  assert.equal(battle.canUse("a", 11, 100), true);
  assert.equal(battle.itemQualification("a").available, null);
  content.qualificationContext!.mode = "source";
  assert.throws(() => new BattleGame(content, 51, undefined, inventory), /lacks source catalog/);
});

test("last-item consumption recomputes the source menu while its own reservation stays executable", () => {
  const { content, inventory } = battleEntryRuntimeFixture();
  const battle = new BattleGame(content, 51, undefined, inventory);
  battle.players[0]!.hp = 1;
  assert.equal(battle.commandItem("a", 10001, { kind: "single", id: "a" }, 3), true);
  assert.equal(battle.itemQualification("a").available, true, "source Count remains one until commit");
  assert.equal(battle.canUseItem("b", 10001, 3), false, "the shared last copy is already reserved");
  battle.advance(410);
  assert.equal(battle.players[0]!.hp, 51);
  assert.deepEqual(battle.inventory, [{ id: 10001, count: 0, available: 0 }]);
  assert.equal(battle.itemQualification("a").available, false);
  assert.equal(battle.itemQualification("b").available, true, "equipped hand still opens the equipment branch");
  assert.equal(battle.canUseItem("b", 10001, 3), false);
  assert.equal(inventory.stacks[0]!.count, 1, "host lease input stays untouched");
});

test("native item candidates and admitted effects are separate requirements", () => {
  const { content, inventory } = battleEntryRuntimeFixture(0);
  inventory.stacks = [10002, 10003, 10004, 10005].map((id) => ({ id, count: 1 }));
  inventory.definitions[10005]!.uses.battle.plan = null;
  const battle = new BattleGame(content, 51, undefined, inventory);
  assert.deepEqual(battle.itemQualification("a").usableItemIds, [10005]);
  assert.equal(battle.itemQualification("a").available, true, "missing effect does not hide a source menu");
  for (const id of [10002, 10003, 10004, 10005]) assert.equal(battle.canUseItem("a", id, 3), false);
});

test("unknown equipment special eligibility does not disable a known usable consumable", () => {
  const { content, inventory } = battleEntryRuntimeFixture();
  inventory.qualification!.equipmentCatalog.characters[1000]!.hasTwoSwordStyle = true;
  inventory.qualification!.equipmentStock.push({ id: 102, count: 1, equipped: 0 });
  const battle = new BattleGame(content, 51, undefined, inventory);
  assert.equal(battle.itemQualification("a").canChangeEquipment, null);
  assert.equal(battle.commandMenu("a").find((c) => c.id === 3)!.available, true);
  assert.equal(battle.canUseItem("a", 10001, 3), true);
});

test("per-actor item status checks use live conditions at selection and resolution", () => {
  const { content, inventory } = battleEntryRuntimeFixture();
  inventory.definitions[10001]!.forbiddenConditionIds = [306];
  const battle = new BattleGame(content, 51, undefined, inventory);
  assert.equal(battle.commandItem("a", 10001, { kind: "single", id: "a" }, 3), true);
  battle.players[0]!.conditionIds = [306];
  assert.equal(battle.canUseItem("a", 10001, 3), false);
  battle.advance(410);
  assert.equal(battle.inventory[0]!.count, 1);
  assert.equal(battle.canUseItem("b", 10001, 3), true);
});

test("command exclusions retain raw IDs while item use applies the native teleport exceptions", () => {
  const { content, inventory } = battleEntryRuntimeFixture();
  for (const id of [23, 412]) {
    content.battleEntry!.items.push({ id, type: 1, listType: 1, throwFlag: 0, battleFunctionGroupId: 8 });
    inventory.definitions[id] = itemFixture(id);
    inventory.stacks.push({ id, count: 1 });
  }
  content.qualificationContext!.invalidContentIds = [23, 412, 10001];
  const battle = new BattleGame(content, 51, undefined, inventory);
  assert.equal(battle.itemQualification("a").available, true);
  assert.equal(battle.canUseItem("a", 10001, 3), false);
  assert.equal(battle.canUseItem("a", 23, 3), true);
  assert.equal(battle.canUseItem("a", 412, 3), true);
  content.battleAbilities!.commands.find((c) => c.id === 3)!.contentId = 23;
  assert.equal(battle.commandMenu("a").find((c) => c.id === 3)!.available, false);
  assert.equal(battle.canUseItem("a", 23, 3), false);
});

test("individual ability invalidity reads function1 identity rather than any match or function type", () => {
  const { content, inventory } = battleEntryRuntimeFixture();
  content.qualificationContext!.invalidContentIds = [1010];
  const battle = new BattleGame(content, 51, undefined, inventory);
  assert.equal(battle.canUse("a", 10, 7), true);
  const first = content.abilities[10]!.program.functions.find((f) => f.slot === 1)!;
  first.type = 28;
  assert.equal(battle.canUse("a", 10, 7), true, "type_id is not FunctionGroup.Function1Id");
  first.functionId = 28;
  assert.equal(battle.canUse("a", 10, 7), false);
  content.abilityContentIds![10] = 412;
  content.qualificationContext!.invalidContentIds = [412];
  assert.equal(battle.canUse("a", 10, 7), true);
  content.abilityContentIds![10] = null;
  assert.equal(battle.canUse("a", 10, 7), false, "missing list-ability content remains unresolved");
  assert.equal(battleAbilityContentAllowed(null, 1010, 28), null);
  assert.equal(battleItemContentAllowed(null, 10001), null);
});

test("queued item use rechecks a newly invalid content without consuming stock", () => {
  const { content, inventory } = battleEntryRuntimeFixture();
  const battle = new BattleGame(content, 51, undefined, inventory);
  assert.equal(battle.commandItem("a", 10001, { kind: "single", id: "a" }, 3), true);
  battle.advance(20);
  content.qualificationContext!.invalidContentIds = [10001];
  battle.advance(400);
  assert.equal(battle.inventory[0]!.count, 1);
  assert.equal(battle.players[0]!.mp, battle.players[0]!.maxMp);
});

test("failure preserves live stock and menu eligibility until every target can commit", () => {
  const { content, inventory } = battleEntryRuntimeFixture();
  const battle = new BattleGame(content, 51, undefined, inventory);
  const targeting = battle.items[10001]!.uses.battle.plan!.targeting;
  targeting.modes = ["side"]; targeting.defaultMode = "side"; targeting.relation = "ally";
  battle.players.forEach((p) => { p.hp = 1; });
  assert.equal(battle.commandItem("a", 10001, { kind: "side", side: "player" }, 3), true);
  battle.advance(400);
  const before = battle.inventory;
  battle.players[1]!.maxMp = NaN;
  assert.throws(() => battle.advance(10), /Invalid action target resource/);
  assert.deepEqual(battle.inventory, before);
  assert.equal(battle.itemQualification("a").available, true);
  assert.equal(battle.players[0]!.hp, 1);
  battle.players[1]!.maxMp = 8;
  battle.advance(10);
  assert.equal(battle.inventory[0]!.count, 0);
  assert.equal(battle.itemQualification("a").available, false);
});

test("equipment qualification is a cloned lease input and mismatched ownership is rejected", () => {
  const { content, inventory } = battleEntryRuntimeFixture(0);
  const battle = new BattleGame(content, 51, undefined, inventory);
  inventory.qualification!.members[0]!.equipment[0] = 101;
  inventory.qualification!.equipmentStock[0]!.count = 2;
  assert.equal(battle.itemQualification("a").available, false);
  inventory.qualification!.members[0]!.sourceId++;
  assert.throws(() => new BattleGame(content, 51, undefined, inventory), /member mismatch/);
  inventory.qualification!.members[0]!.sourceId--;
  assert.throws(() => new BattleGame(content, 51, undefined, inventory), /occupancy/);
});
