import test from "node:test";
import assert from "node:assert/strict";
import { appendSelectedPartyCondition, battleUseInvalidContents, projectBattleItemMenu, projectBeastField, projectFieldInvalidContents } from "../src/core/battle-entry.js";
import { compileBattleEntryCatalog, compileNarsheOwnedConditionCheckpoint } from "../src/compiler/battle-entry.js";
import { battleEntryFixture } from "./fixtures/battle-entry.js";

test("walking/savepoint/transportation select different source exclusion lists", () => {
  const { catalog, context } = battleEntryFixture();
  assert.deepEqual(projectFieldInvalidContents(catalog, context).invalidContentIds, [10001, 10005]);
  assert.deepEqual(projectFieldInvalidContents(catalog, { ...context, isSavePoint: true }).invalidContentIds, [10005]);
  assert.deepEqual(projectFieldInvalidContents(catalog, { ...context, transportation: { id: 42, type: 6 }, isSavePoint: true }).invalidContentIds,
    [10001, 10002, 10003, 10004, 10005]);
  assert.deepEqual(projectFieldInvalidContents(catalog, { ...context, transportation: null }).invalidContentIds, [10001, 10005]);
});
test("moving availability 2 uses constant value2 zero, not a hardcoded item ID", () => {
  const { catalog, context } = battleEntryFixture();
  assert.deepEqual(projectFieldInvalidContents(catalog, { ...context, mapId: 102 }).invalidContentIds, [10001, 10002, 10005]);
  assert.deepEqual(projectFieldInvalidContents(catalog, { ...context, mapId: 101 }).invalidContentIds, [10002, 10003, 10005]);
});
test("unknown beast state stays unknown; source beast state removes its exclusions", () => {
  const { catalog, context } = battleEntryFixture();
  assert.equal(projectFieldInvalidContents(catalog, { ...context, beastField: null }).invalidContentIds, null);
  catalog.sleepingContents.push(10005);
  assert.deepEqual(projectFieldInvalidContents(catalog, { ...context, beastField: true }).invalidContentIds, [10001]);
});
test("beast projection distinguishes absent controller and unknown transportation", () => {
  assert.equal(projectBeastField({ controllerPresent: false, footAttributeType: null, transportationId: null }), false);
  assert.equal(projectBeastField({ controllerPresent: true, footAttributeType: 31, transportationId: null }), null);
  assert.equal(projectBeastField({ controllerPresent: true, footAttributeType: 31, transportationId: 1 }), true);
  assert.equal(projectBeastField({ controllerPresent: true, footAttributeType: 32, transportationId: 1 }), true);
  assert.equal(projectBeastField({ controllerPresent: null, footAttributeType: 31, transportationId: 1 }), null);
  assert.equal(projectBeastField({ controllerPresent: null, footAttributeType: null, transportationId: 6 }), false);
  assert.equal(projectBeastField({ controllerPresent: true, footAttributeType: 2, transportationId: null }), false);
});
test("unknown map and duplicate exclusion source identities reject", () => {
  const { catalog, context } = battleEntryFixture();
  assert.throws(() => projectFieldInvalidContents(catalog, { ...context, mapId: 999 }), /map/);
  catalog.movingContents.push({ id: 10002, value2: 0 });
  assert.throws(() => projectFieldInvalidContents(catalog, context), /Duplicate/);
});
test("individual battle-use exclusions leave command-level input untouched", () => {
  const field = [16, 23, 412, 1309];
  assert.deepEqual(battleUseInvalidContents(field), [16, 1309]);
  assert.deepEqual(field, [16, 23, 412, 1309]);
  assert.throws(() => battleUseInvalidContents([16, 16]), /Duplicate/);
});
test("item menu requires available count and battle item shape", () => {
  const { catalog, input, equipment } = battleEntryFixture();
  const inventory = [10001, 10002, 10003, 10004].map((id) => ({ id, count: 1, equipped: 0 }));
  assert.deepEqual(projectBattleItemMenu(catalog, { ...input, inventory }, equipment),
    { available: true, usableItemIds: [10001], canChangeEquipment: false, blockers: [] });
  assert.equal(projectBattleItemMenu(catalog, { ...input, inventory: [{ id: 10001, count: 2, equipped: 2 }] }, equipment).available, false);
});
test("nonempty current hand keeps item menu available with no consumables", () => {
  const { catalog, input, equipment } = battleEntryFixture();
  assert.equal(projectBattleItemMenu(catalog, { ...input, equipment: [101, 2, 3, 4, 5, 5] }, equipment).available, true);
  assert.equal(projectBattleItemMenu(catalog, { ...input, equipment: [null, 2, 3, 4, 5, 5] }, equipment).available, true);
  // Native menu test does not enforce the separate accessories-only UI rule.
  equipment.characters[1]!.accessoriesOnly = true;
  assert.equal(projectBattleItemMenu(catalog, { ...input, equipment: [101, 2, 3, 4, 5, 5] }, equipment).available, true);
});
test("empty hands require an available compatible equipment candidate", () => {
  const { catalog, input, equipment } = battleEntryFixture();
  const inventory = [{ id: 101, count: 2, equipped: 1 }];
  assert.equal(projectBattleItemMenu(catalog, { ...input, inventory }, equipment).canChangeEquipment, true);
  assert.equal(projectBattleItemMenu(catalog, { ...input, inventory: [{ ...inventory[0]!, equipped: 2 }] }, equipment).available, false);
  equipment.definitions[101]!.jobIds = [2];
  assert.equal(projectBattleItemMenu(catalog, { ...input, inventory }, equipment).available, false);
});
test("equipment candidate effects and battle-equipping execution stay separate from menu eligibility", () => {
  const { catalog, input, equipment } = battleEntryFixture();
  equipment.definitions[101]!.blockers.push("Unsupported action/passive effect");
  assert.equal(projectBattleItemMenu(catalog, { ...input, inventory: [{ id: 101, count: 1, equipped: 0 }] }, equipment).available, true);
});
test("unresolved special equipment provider remains unknown without hiding ordinary items", () => {
  const { catalog, input, equipment } = battleEntryFixture();
  equipment.characters[1]!.hasTwoSwordStyle = true;
  assert.equal(projectBattleItemMenu(catalog, input, equipment).available, false, "No candidate needs the unknown provider");
  const inventory = [{ id: 101, count: 1, equipped: 0 }];
  assert.equal(projectBattleItemMenu(catalog, { ...input, inventory }, equipment).available, null);
  const result = projectBattleItemMenu(catalog, { ...input, inventory: [...inventory, { id: 10001, count: 1, equipped: 0 }] }, equipment);
  assert.equal(result.available, true); assert.equal(result.canChangeEquipment, null); assert.ok(result.blockers.length);
});
test("invalid inventory counts and unknown content reject without changing caller state", () => {
  const { catalog, input, equipment } = battleEntryFixture();
  const before = structuredClone(input);
  assert.throws(() => projectBattleItemMenu(catalog, { ...input, inventory: [{ id: 10001, count: 0, equipped: 1 }] }, equipment), /occupancy/);
  assert.throws(() => projectBattleItemMenu(catalog, { ...input, inventory: [{ id: 9999, count: 1, equipped: 0 }] }, equipment), /Unknown/);
  assert.deepEqual(input, before);
});
test("source condition type is resolved before storage; append uses owned identity and selected corps only", () => {
  const owners = [{ id: "own:8", sourceId: 607, enabled: true, conditionIds: [6] },
    { id: "own:3", sourceId: 1, enabled: false, conditionIds: [] }, { id: "reserve", sourceId: 31, enabled: true, conditionIds: [] }];
  const before = structuredClone(owners);
  const changed = appendSelectedPartyCondition(owners, ["own:8", "own:3"], 53);
  assert.deepEqual(changed.map((r) => r.conditionIds), [[6, 53], [53], []]);
  assert.deepEqual(appendSelectedPartyCondition(changed, ["own:8", "own:3"], 53), changed);
  assert.deepEqual(owners, before);
  assert.throws(() => appendSelectedPartyCondition(owners, ["own:8", "1"], 53), /Unknown/);
  assert.deepEqual(owners, before);
});
test("catalog compiler binds all source constants and preserves object identities", () => {
  const { reader, tables, misc, catalog } = battleEntryFixture();
  const result = compileBattleEntryCatalog(reader, tables, misc);
  assert.deepEqual(result.catalog, catalog);
  assert.equal(result.assetSources[0]!.objectId, "9007199254740998");
  assert.equal(result.sources.filter((r) => r.assetPath === "game_constant_int.csv").length, 4);
});
test("constant sequence stops at first gap; later rows are not invented into the provider", () => {
  const { reader, tables, misc } = battleEntryFixture();
  tables["game_constant_int.csv"]!.push({ id: "7", key_name: "FOR_SLEEPING_CONTENTS_DECISION_3", value1: "10002", value2: "0" });
  assert.deepEqual(compileBattleEntryCatalog(reader, tables, misc).catalog.sleepingContents, [10001]);
});
test("new encounter-content or missing misc providers block compilation instead of defaulting empty", () => {
  const { reader, tables, misc } = battleEntryFixture();
  assert.throws(() => compileBattleEntryCatalog(reader, tables, { ...misc, data: {} }), /beast-field/);
  tables["game_constant_int.csv"]!.push({ id: "7", key_name: "FOR_ENCOUNTER_CONTENTS_DECISION_1", value1: "10002", value2: "0" });
  assert.throws(() => compileBattleEntryCatalog(reader, tables, misc), /encounter-content/);
});
test("checkpoint rejects absent or substituted prelude instead of borrowing a transport state", () => {
  const { reader, tables, misc } = battleEntryFixture();
  assert.throws(() => compileNarsheOwnedConditionCheckpoint(reader, tables, []), /checkpoint script/);
  assert.throws(() => compileNarsheOwnedConditionCheckpoint(reader, tables, [{ ...misc,
    source: { ...misc.source, assetPath: "Assets/GameAssets/Serial/Res/Map/Map_40037/Map_40037/sc_e_0001.json" },
    data: { Mnemonics: [{ mnemonic: "SetVehicle", operands: { iValues: [6] } }] } }]), /needs review/);
});
