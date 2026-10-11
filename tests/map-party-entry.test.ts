import assert from "node:assert/strict";
import test from "node:test";
import { prepareMapPartyEntry, readMapPartySwitching } from "../src/core/map-party-entry.js";
import { compileMapPartyEntry } from "../src/compiler/map-party-entry.js";
import { compileEntityGroup } from "../src/compiler/entity-group.js";
import { actorCatalog, actorMember } from "./fixtures/party-actors.js";
import { mapEntryInput } from "./fixtures/map-party-entry.js";

test("PointIn replaces position/layer/facing and resets movement while preserving the player's visibility", () => {
  const input = mapEntryInput(), catalog = actorCatalog();
  input.playerVisible = false;
  input.prior.context.camera.mapArea = { xMin: -100, yMin: 20, width: 200, height: 40 };
  const before = structuredClone(input);
  const plan = prepareMapPartyEntry(catalog, input);
  assert.deepEqual(plan.player, { x: 8, y: 9, layer: 2, direction: "left", visible: false, asset: "same-media", mount: "" });
  assert.deepEqual(plan.movement, { start: { x: 8, y: 9 }, destination: { x: 8, y: 9 }, elapsed: 0,
    autoMove: false, cacheActiveEnable: 0, cacheActiveFlag: 0 });
  assert.deepEqual(plan.checkpoint.context.camera, { mapViewType: 0, mapArea: { xMin: 0, yMin: 0, width: 0, height: 0 } });
  assert.deepEqual(plan.hiddenActorIds, ["puppet:0", "puppet:1", "puppet:2", "puppet:3", "party:0", "party:1", "party:2"]);
  assert.deepEqual(input, before);
  plan.checkpoint.context.player.id = "detached";
  plan.movement.start.x = 100;
  assert.deepEqual(input, before);
});

test("map entry changes the current leader but only hides existing puppet and other-party media", () => {
  const input = mapEntryInput();
  input.prior.context.puppets[0]!.fieldAssetId = 1;
  input.prior.context.puppets[1]!.fieldAssetId = 38;
  input.prior.context.puppets[1]!.riderFieldAssetId = 3;
  input.prior.context.puppets[1]!.riding = true;
  input.prior.context.multiParty[0]!.actor!.fieldAssetId = 3;
  const leader = actorMember({ id: "new", index: 2, sourceId: 2, jobId: 8 });
  input.party = { activeMembers: [leader], parties: [[leader], [], []] };
  const result = prepareMapPartyEntry(actorCatalog(), input);
  assert.equal(result.player.asset, "bravo");
  assert.equal(result.checkpoint.context.leaderIndex, 2);
  assert.deepEqual(result.checkpoint.context.puppets, input.prior.context.puppets);
  assert.deepEqual(result.checkpoint.context.multiParty, input.prior.context.multiParty);
});

test("walking transport performs RideOut but retains the cached rider asset", () => {
  const input = mapEntryInput();
  input.prior.context.currentTransport = { id: 6, typeId: 12, fieldAssetId: 38 };
  Object.assign(input.prior.context.player, { fieldAssetId: 38, riderFieldAssetId: 3, riding: true });
  const result = prepareMapPartyEntry(actorCatalog(), input);
  assert.deepEqual(result.checkpoint.context.player, { id: "player", fieldAssetId: 11, riderFieldAssetId: 3, riding: false });
  assert.deepEqual(result.checkpoint.context.currentTransport, { id: 1, typeId: 1, fieldAssetId: 0 });
  assert.equal(result.player.mount, "");
});

test("Magitek setup re-caches the fresh player base instead of copying the old mount as the rider", () => {
  const input = mapEntryInput();
  input.transportation = { id: 6, type: 12, assetId: 38 };
  input.prior.context.currentTransport = { id: 6, typeId: 12, fieldAssetId: 38 };
  Object.assign(input.prior.context.player, { fieldAssetId: 38, riderFieldAssetId: 3, riding: true });
  const result = prepareMapPartyEntry(actorCatalog(), input);
  assert.deepEqual(result.checkpoint.context.player, { id: "player", fieldAssetId: 38, riderFieldAssetId: 11, riding: true });
  assert.equal(result.player.asset, "same-media");
  assert.equal(result.player.mount, "armor");
});

test("condition substitution and final transportation camera use the destination context without clearing poison", () => {
  const input = mapEntryInput(), catalog = actorCatalog();
  input.party.activeMembers[0]!.conditionIds = [1, 12];
  catalog.viewpointOffsets.push({ fieldAssetId: 40, x: 3, y: 5 });
  const before = structuredClone(input.party);
  const result = prepareMapPartyEntry(catalog, input);
  assert.equal(result.checkpoint.playerAssetCacheId, 40);
  assert.equal(result.player.asset, "small");
  assert.deepEqual(result.cameraOffset, { x: 3, y: 5 });
  assert.deepEqual(result.ownedConditionChanges, []);
  assert.deepEqual(input.party, before);
});

test("aboard armor the condition cache changes while RideOn uses the initial player base", () => {
  const input = mapEntryInput();
  input.transportation = { id: 6, type: 12, assetId: 38 };
  input.prior.context.currentTransport = { id: 6, typeId: 12, fieldAssetId: 38 };
  Object.assign(input.prior.context.player, { fieldAssetId: 38, riderFieldAssetId: 3, riding: true });
  input.party.activeMembers[0]!.conditionIds = [12];
  const result = prepareMapPartyEntry(actorCatalog(), input);
  assert.equal(result.checkpoint.playerAssetCacheId, 40);
  assert.equal(result.checkpoint.context.player.riderFieldAssetId, 11);
  assert.equal(result.player.asset, "same-media");
});

test("destination condition colliders replace the old registry and return explicit publication work", () => {
  const input = mapEntryInput();
  input.prior.context.conditionColliders = [{ id: "old", collisionType: 1, throughConditionType: 665 }];
  input.definition.conditionColliders = [{ id: "new", collisionType: 1, throughConditionType: 401 }];
  input.party.activeMembers[0]!.conditionIds = [10];
  const result = prepareMapPartyEntry(actorCatalog(), input);
  assert.deepEqual(result.colliderChanges, [{ actorId: "new", active: false }]);
  assert.deepEqual(result.checkpoint.context.conditionColliders, input.definition.conditionColliders);
});

test("the exact party-switching flag is required; false does not read placement globals", () => {
  const refs: unknown[] = [];
  assert.equal(readMapPartySwitching((ref) => { refs.push(ref); return 0; }), false);
  assert.deepEqual(refs, [{ category: "ScenarioFlag3", index: 45 }]);
  assert.equal(readMapPartySwitching(() => 1), true);
  assert.throws(() => readMapPartySwitching(() => null), /Unknown/);
  assert.throws(() => readMapPartySwitching(() => 2), /Unknown/);
});

test("unknown or separate lifecycle dependencies block without mutating the candidate", () => {
  const probes = [
    (input: ReturnType<typeof mapEntryInput>) => { input.entrance = -1; },
    (input: ReturnType<typeof mapEntryInput>) => { input.entrance = 99; },
    (input: ReturnType<typeof mapEntryInput>) => { input.definition.pointIns.push(structuredClone(input.definition.pointIns[0]!)); },
    (input: ReturnType<typeof mapEntryInput>) => { input.definition.pointIns[0]!.linkObject = 12; },
    (input: ReturnType<typeof mapEntryInput>) => { input.canPartySwitching = null; },
    (input: ReturnType<typeof mapEntryInput>) => { input.canPartySwitching = true; },
    (input: ReturnType<typeof mapEntryInput>) => { input.mapViewType = 1; },
    (input: ReturnType<typeof mapEntryInput>) => { input.definition.loopType = 1; },
    (input: ReturnType<typeof mapEntryInput>) => { input.prior.context.companion = { fieldAssetId: 3, conditionTypes: [], actor: null, puppet: null }; },
    (input: ReturnType<typeof mapEntryInput>) => { input.prior.context.currentTransport = null; },
    (input: ReturnType<typeof mapEntryInput>) => { input.prior.context.conditionResidents = null; },
    (input: ReturnType<typeof mapEntryInput>) => { input.transportation = { id: 2, type: 2, assetId: 30 }; },
    (input: ReturnType<typeof mapEntryInput>) => { input.transportation.assetId = 38; },
    (input: ReturnType<typeof mapEntryInput>) => { input.prior.context.puppets[0]!.id = "player"; },
    (input: ReturnType<typeof mapEntryInput>) => { input.party.activeMembers[0]!.conditionIds = [999]; },
    (input: ReturnType<typeof mapEntryInput>) => { input.party.activeMembers = []; },
  ];
  for (const change of probes) {
    const input = mapEntryInput(); change(input);
    const before = structuredClone(input);
    assert.throws(() => prepareMapPartyEntry(actorCatalog(), input));
    assert.deepEqual(input, before);
  }
});

function compilerInputs() {
  const prop = (value: Record<string, unknown>) => Object.entries(value).map(([name, value]) => ({ name, value }));
  const group = { source: { file: "controlled", assetPath: "destination/entity_default.json" },
    data: { layers: [{ name: "GroundObject", objects: [
      { x: 128, y: 160, width: 16, height: 16, gid: 1, properties: prop({ object_type: 0, object_id: 2, direction: 8, link_object_id: 0 }) },
      { x: 64, y: 48, width: 32, height: 16, properties: prop({ object_type: 19, collision_type: 1, through_condition_type: 401, target_transportation_ids: "", confirm_landing: false }) },
    ] }] } };
  const tables = { "map.csv": [{ id: "42", loop_type: "0" }] };
  const entities = compileEntityGroup("entity_default", group, tables).entities;
  return { group, tables, entities };
}

test("compiler binds destination PointIn and collision source pointers without admitting unrelated map behavior", () => {
  const { group, tables, entities } = compilerInputs();
  const { definition, dependencies } = compileMapPartyEntry(tables, 42, { width: 32, height: 24 }, group, entities);
  assert.deepEqual(dependencies, [{ table: "map.csv", id: 42 }]);
  assert.deepEqual(definition.pointIns.map((p) => [p.id, p.x, p.y, p.layer, p.direction, p.linkObject]), [[2, 8, 9, 1, "left", 0]]);
  assert.deepEqual(definition.conditionColliders, [{ id: "entity_default:0:1", collisionType: 1, throughConditionType: 401 }]);
  // Existing entity compiler still reports its unimplemented dynamic collider;
  // this metadata does not remove that package blocker.
  assert.ok(compileEntityGroup("entity_default", group, tables).blockers.length);
});

test("compiler rejects omitted/foreign source objects, missing map master and unsupported entrance transform", () => {
  const { group, tables, entities } = compilerInputs();
  const compile = () => compileMapPartyEntry(tables, 42, { width: 32, height: 24 }, group, entities);
  entities[0]!.source.pointer = "/foreign";
  assert.throws(compile, /Unbound/);
  const fresh = compilerInputs();
  fresh.tables["map.csv"].push({ id: "42", loop_type: "0" });
  assert.throws(() => compileMapPartyEntry(fresh.tables, 42, { width: 32, height: 24 }, fresh.group, fresh.entities), /ambiguous/);
  const transformed = compilerInputs();
  transformed.entities[0]!.width = 2;
  assert.throws(() => compileMapPartyEntry(transformed.tables, 42, { width: 32, height: 24 }, transformed.group, transformed.entities), /shape/);
});
