import assert from "node:assert/strict";
import test from "node:test";
import { compileNarshePartyActorCheckpoint, compilePartyActorCatalog } from "../src/compiler/party-actors.js";
import { preparePartyActors } from "../src/core/party-actors.js";
import { actorContext, actorMember, actorMisc, actorSourceTables } from "./fixtures/party-actors.js";

test("source compiler preserves physical character row order and binds every supplied table row", () => {
  const tables = actorSourceTables(), misc = actorMisc();
  const { catalog, dependencies } = compilePartyActorCatalog(tables, misc);
  assert.deepEqual(catalog.characterAssets.map((r) => r.id), [90, 2, 3, 4, 1]);
  assert.equal(preparePartyActors(catalog, [actorMember()], actorContext(), true).playerAssetCache?.id, 11);
  assert.equal(dependencies.length, Object.values(tables).reduce((sum, rows) => sum + rows.length, 0));
  assert.equal(catalog.residents.length, tables["field_character_asset.csv"].length);
  assert.deepEqual(catalog.flatBirdAssets, { 3: 1034 });
});

test("condition rule admission uses source enum rather than condition table membership; duplicate value keeps slot order", () => {
  const tables = actorSourceTables(), misc = actorMisc();
  misc.change_character_condition_list = [
    { condition_type: 665, field_character_asset_cid: 202 },
    { condition_type: 666, field_character_asset_cid: 203 },
    { condition_type: 685, field_character_asset_cid: 202 }, // enum valid, absent condition.csv
    { condition_type: 9999, field_character_asset_cid: 202 },
    { condition_type: 665, field_character_asset_cid: 203 },
  ];
  const { catalog } = compilePartyActorCatalog(tables, misc);
  assert.deepEqual(catalog.conditionChanges.map((r) => r.type), [665, 666, 685, 665]);
  assert.equal(preparePartyActors(catalog, [actorMember({ conditionIds: [12, 13] })], actorContext(), true).playerAssetCache?.id, 41);
});

test("source optional arrays use their native null behavior without inferring companion absence", () => {
  const { catalog } = compilePartyActorCatalog(actorSourceTables(), {});
  assert.deepEqual(catalog.conditionChanges, []); assert.deepEqual(catalog.viewpointOffsets, []);
  assert.equal(catalog.affectedCompanions, null);
  const context = actorContext();
  context.companion = { fieldAssetId: 3, conditionTypes: [], actor: null, puppet: null };
  assert.deepEqual(preparePartyActors(catalog, [actorMember({ conditionIds: [10] })], context, true).companionConditionTypes, [401]);
});

test("source compiler refuses unresolved assets, duplicate resident identities and ambiguous optional rules", () => {
  const tables = actorSourceTables();
  tables["character_asset.csv"][0]!.field_character_asset_id = "999";
  assert.throws(() => compilePartyActorCatalog(tables, actorMisc()), /Missing character field asset/);
  const duplicated = actorSourceTables(); duplicated["field_character_asset.csv"][1]!.character_id = "1";
  assert.throws(() => compilePartyActorCatalog(duplicated, actorMisc()), /Ambiguous field resident/);
  const misc = actorMisc(); misc.character_viewpoint_offset_list.push(misc.character_viewpoint_offset_list[0]!);
  assert.throws(() => compilePartyActorCatalog(actorSourceTables(), misc), /Duplicate appearance camera/);
});

test("checkpoint inputs bind initial route, entrance, map loops and explicit corps order", () => {
  const tables = { ...actorSourceTables(),
    "initialize_data.csv": [{ id: "43", key_name: "INT_START_MAP_ID", value1: "609", value2: "1" },
      { id: "44", key_name: "INT_MAP_POINTIN", value1: "1", value2: "0" }],
    "map.csv": [609, 572, 3].map((id) => ({ id: String(id), loop_type: "0" })),
  };
  const misc = { ...actorMisc(), corps_order: [0, 1, 2, 3] };
  const { catalog, dependencies } = compilePartyActorCatalog(tables, misc);
  assert.deepEqual(catalog.checkpointInputs, { initialMapId: 609, initialPointIn: 1, initialScriptId: 1,
    initialMapSourceId: 43, initialPointSourceId: 44, mapLoopTypes: { 3: 0, 572: 0, 609: 0 }, corpsOrder: [0, 1, 2, 3] });
  assert.ok(dependencies.some((r) => r.table === "initialize_data.csv" && r.id === 43));
  assert.throws(() => compilePartyActorCatalog(tables, actorMisc()), /corps order/);
  assert.throws(() => compilePartyActorCatalog({ ...tables, "map.csv": tables["map.csv"].slice(1) }, misc), /checkpoint map 609/);
  assert.throws(() => compileNarshePartyActorCheckpoint(catalog, [], []), /checkpoint source/);
  const unbound = compilePartyActorCatalog(actorSourceTables(), actorMisc()).catalog;
  assert.equal(unbound.checkpointInputs, null);
  assert.throws(() => compileNarshePartyActorCheckpoint(unbound, [], []), /initialization needs source review/);
});
