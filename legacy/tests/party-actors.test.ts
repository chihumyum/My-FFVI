import assert from "node:assert/strict";
import test from "node:test";
import { initialPartyActorResidents, initialPartyActorSaveState, partyActorCameraOffset,
  partyActorLeaderOnMapChange, partyActorMapArea, partyMemberFieldAsset, preparePartyActors,
  type PartyActorContext } from "../src/core/party-actors.js";
import { actorCatalog, actorContext, actorMember } from "./fixtures/party-actors.js";

test("source first match retains CSV order even for identical media and reversed numeric IDs", () => {
  const catalog = actorCatalog(), member = actorMember();
  assert.equal(partyMemberFieldAsset(catalog, member).id, 11);
  catalog.characterAssets.reverse();
  assert.equal(partyMemberFieldAsset(catalog, member).id, 12);
});

test("ordinary leader honors occupied saved position and falls back without filtering disabled owners", () => {
  const context = actorContext(), catalog = actorCatalog();
  const a = actorMember({ index: 2, enabled: false });
  const b = actorMember({ id: "two", index: 3, sourceId: 2, jobId: 8 });
  context.leaderIndex = 3;
  let plan = preparePartyActors(catalog, [a, b], context, true);
  assert.equal(plan.selectedLeaderIndex, 3); assert.equal(plan.playerAssetCache?.id, 2);
  context.leaderIndex = 1;
  plan = preparePartyActors(catalog, [b, a], context, true);
  assert.equal(plan.selectedLeaderIndex, 2); assert.equal(plan.savedLeaderIndex, 2);
  assert.equal(plan.playerAssetCache?.id, 11);
  context.leaderIndex = -1;
  assert.equal(preparePartyActors(catalog, [a], context, true).savedLeaderIndex, -1);
  assert.equal(partyActorLeaderOnMapChange(-1, [b, a]), 2);
  assert.equal(partyActorLeaderOnMapChange(1, [a]), 1);
  assert.equal(partyActorLeaderOnMapChange(-1, []), -1);
});

test("existing puppet slots preserve empty artwork only when setDummy is false; occupied references still resolve", () => {
  const context = actorContext(), catalog = actorCatalog();
  context.puppets[1]!.fieldAssetId = 2;
  context.puppets.push({ id: "extra", fieldAssetId: 2, riderFieldAssetId: 1, riding: true });
  let plan = preparePartyActors(catalog, [actorMember()], context, false);
  assert.equal(plan.changes.some((c) => c.actorId === "puppet:1"), false);
  assert.deepEqual(plan.changes.filter((c) => c.reason === "dummy").map((c) => [c.actorId, c.asset.id, c.mode]),
    [["puppet:2", 1, "replace"], ["puppet:3", 1, "replace"], ["extra", 1, "rider"]]);
  plan = preparePartyActors(catalog, [], context, true);
  assert.equal(plan.changes.find((c) => c.actorId === "puppet:1")?.asset.id, 1);
  context.puppets[2] = null;
  assert.throws(() => preparePartyActors(catalog, [actorMember({ index: 2, sourceId: 99 })], context, false), /character\/job/);
});

test("player transport type precedes riding; a null transport does not imply walking", () => {
  const context = actorContext(), catalog = actorCatalog(), member = actorMember();
  context.player.riding = true;
  let plan = preparePartyActors(catalog, [member], context, true);
  assert.equal(plan.changes[0]!.mode, "replace"); assert.deepEqual(plan.cameraOffset, { x: 2, y: 16 });
  context.currentTransport = { id: 6, typeId: 12, fieldAssetId: 38 };
  plan = preparePartyActors(catalog, [member], context, true);
  assert.equal(plan.changes[0]!.mode, "rider"); assert.equal(plan.cameraOffset, null);
  context.player.riding = false;
  assert.deepEqual(preparePartyActors(catalog, [member], context, true).cameraOffset, { x: 0, y: 0 });
  context.currentTransport = null;
  plan = preparePartyActors(catalog, [member], context, true);
  assert.equal(plan.changes.some((c) => c.actorId === "player"), false);
  assert.equal(plan.playerAssetCache?.id, 11); assert.equal(plan.cameraOffset, null);
});

test("condition appearance uses registry priority and last dictionary value without changing camera", () => {
  const context = actorContext(), catalog = actorCatalog();
  const member = actorMember({ conditionIds: [13, 12] });
  let plan = preparePartyActors(catalog, [member], context, true);
  assert.deepEqual(plan.changes.filter((c) => c.actorId === "player").map((c) => [c.reason, c.asset.id]), [["leader", 11], ["condition", 40]]);
  assert.deepEqual(plan.cameraOffset, { x: 2, y: 16 });
  catalog.conditionChanges.push({ type: 665, residentCharacterId: 203 });
  plan = preparePartyActors(catalog, [member], context, true);
  assert.equal(plan.playerAssetCache?.id, 41);
  catalog.conditionChanges.push({ type: 665, residentCharacterId: 999 });
  assert.equal(preparePartyActors(catalog, [member], context, true).playerAssetCache?.id, 41);
  context.conditionResidents![1]!.fieldAssetId = null;
  assert.equal(preparePartyActors(catalog, [member], context, true).playerAssetCache?.id, 11);
  context.conditionResidents = null;
  assert.equal(preparePartyActors(catalog, [member], context, true).playerAssetCache?.id, 11);
});

test("condition cache can update aboard transport while player asset remains the rider base", () => {
  const context = actorContext(); context.currentTransport = { id: 6, typeId: 12, fieldAssetId: 38 }; context.player.riding = true;
  const plan = preparePartyActors(actorCatalog(), [actorMember({ conditionIds: [12] })], context, true);
  assert.equal(plan.playerAssetCache?.id, 40);
  assert.deepEqual(plan.changes.filter((c) => c.actorId === "player").map((c) => [c.reason, c.asset.id, c.mode]), [["leader", 11, "rider"]]);
});

function companionContext(): PartyActorContext {
  const context = actorContext(); context.companion = { fieldAssetId: 3, conditionTypes: [],
    actor: { id: "companion", fieldAssetId: 3, riderFieldAssetId: 1, riding: true }, puppet: { id: "companion-puppet", fieldAssetId: null, riderFieldAssetId: null, riding: false } };
  return context;
}

test("companion 401/402 synchronization has source all/none/mixed hysteresis and empty-party behavior", () => {
  const catalog = actorCatalog(), context = companionContext();
  const a = actorMember({ conditionIds: [10] }), b = actorMember({ id: "two", index: 1, sourceId: 2, jobId: 8, conditionIds: [10] });
  assert.deepEqual(preparePartyActors(catalog, [a, b], context, true).companionConditionTypes, [401]);
  b.conditionIds = [];
  assert.deepEqual(preparePartyActors(catalog, [a, b], context, true).companionConditionTypes, []);
  context.companion!.conditionTypes = [401, 402];
  const plan = preparePartyActors(catalog, [a, b], context, true);
  assert.deepEqual(plan.companionConditionTypes, [401]);
  assert.deepEqual(plan.changes.filter((c) => c.reason === "companion").map((c) => c.mode), ["replace", "replace"]);
  context.companion!.conditionTypes = [];
  assert.deepEqual(preparePartyActors(catalog, [], context, true).companionConditionTypes, [401, 402]);
  // Native counts entries, including separate source condition IDs with the same type.
  a.conditionIds = [10, 14];
  assert.deepEqual(preparePartyActors(catalog, [a, b], context, true).companionConditionTypes, [401]);
});

test("companion policy false preserves saved types and excludes its collision contribution", () => {
  const catalog = actorCatalog(), context = companionContext();
  context.conditionColliders = [{ id: "gate", collisionType: 1, throughConditionType: 401 },
    { id: "skip", collisionType: 0, throughConditionType: 401 }];
  const members = [actorMember({ conditionIds: [10] }), actorMember({ id: "two", index: 1, sourceId: 2, jobId: 8 })];
  assert.deepEqual(preparePartyActors(catalog, members, context, true).colliderChanges, [{ actorId: "gate", active: true }]);
  catalog.affectedCompanions = [{ fieldAssetId: 3, affected: false }];
  context.companion!.conditionTypes = [402];
  const plan = preparePartyActors(catalog, members, context, true);
  assert.deepEqual(plan.companionConditionTypes, [402]);
  assert.deepEqual(plan.colliderChanges, [{ actorId: "gate", active: false }]);
});

test("missing companion base is a no-op; selected null replacement remains an explicit unsupported boundary", () => {
  const context = companionContext(), catalog = actorCatalog();
  context.companion!.fieldAssetId = 999;
  assert.equal(preparePartyActors(catalog, [actorMember()], context, true).changes.some((c) => c.reason === "companion"), false);
  context.companion!.fieldAssetId = 3; context.companion!.conditionTypes = [665];
  context.conditionResidents![0]!.fieldAssetId = null;
  const before = structuredClone(context);
  assert.throws(() => preparePartyActors(catalog, [actorMember()], context, true), /null asset structure/);
  assert.deepEqual(context, before);
});

test("multi-party refresh uses saved exact slot, enabled owners and source identity independent of job", () => {
  const context = actorContext(), catalog = actorCatalog();
  context.multiParty[0]!.members = [actorMember()];
  context.multiParty[1]!.members = [actorMember({ id: "two", index: 1, sourceId: 2, jobId: 8 })];
  context.multiParty[2]!.members = [actorMember({ enabled: false })];
  const plan = preparePartyActors(catalog, [actorMember()], context, true);
  assert.deepEqual(plan.changes.filter((c) => c.reason === "other-party").map((c) => [c.actorId, c.asset.id]), [["party:0", 1]]);
  context.multiParty[0]!.actor = null;
  assert.throws(() => preparePartyActors(catalog, [], context, true), /existing multi-party actor/);
});

test("camera uses native MapRange dimensions, one wrap and FF6 bird identity substitution", () => {
  assert.deepEqual(partyActorMapArea(10, 8, 0), { xMin: 0, yMin: 0, width: 0, height: 0 });
  assert.deepEqual(partyActorMapArea(10, 8, 3), { xMin: -80, yMin: 64, width: 160, height: 128 });
  const catalog = actorCatalog(), camera = actorContext().camera;
  camera.mapViewType = 2;
  assert.deepEqual(partyActorCameraOffset(catalog, 31, camera), { x: 0, y: 16 });
  camera.mapViewType = 0;
  assert.deepEqual(partyActorCameraOffset(catalog, 31, camera), { x: 0, y: 48 });
  camera.mapArea = partyActorMapArea(1, 1, 3);
  catalog.viewpointOffsets[0] = { fieldAssetId: 11, x: 40, y: -24 };
  assert.deepEqual(partyActorCameraOffset(catalog, 11, camera), { x: 24, y: -8 });
  catalog.viewpointOffsets[0] = { fieldAssetId: 11, x: 8, y: 8 };
  assert.deepEqual(partyActorCameraOffset(catalog, 11, camera), { x: -8, y: -8 });
  catalog.viewpointOffsets[0] = { fieldAssetId: 11, x: 0.1, y: 0.2 };
  assert.deepEqual(partyActorCameraOffset(catalog, 11, camera), { x: Math.fround(0.1), y: Math.fround(0.2) });
});

test("strict context and detached plans reject unknown conditions and actor aliasing without mutation", () => {
  const context = actorContext(), catalog = actorCatalog(), members = [actorMember()];
  const before = structuredClone({ context, catalog, members });
  const plan = preparePartyActors(catalog, members, context, true);
  plan.changes[0]!.asset.asset = "changed";
  assert.deepEqual({ context, catalog, members }, before);
  assert.throws(() => preparePartyActors(catalog, [actorMember({ conditionIds: [999] })], context, true), /Unknown.*condition/);
  context.puppets[0]!.id = "player";
  assert.throws(() => preparePartyActors(catalog, members, context, true), /repeated.*actor/);
  const bad = actorContext(); delete (bad as Partial<PartyActorContext>).companion;
  assert.throws(() => preparePartyActors(catalog, members, bad, true), /Incomplete/);
  const badCamera = actorContext(); badCamera.currentTransport = null; badCamera.camera.mapArea.width = NaN;
  assert.throws(() => preparePartyActors(catalog, members, badCamera, true), /map area/);
  const initial = initialPartyActorSaveState();
  assert.deepEqual(initial, { leaderIndex: -1, companion: null, partyLeaderIndices: [0, 0, 0], otherPartyPlacements: [null, null, null] });
  const residents = initialPartyActorResidents(catalog); residents[0]!.fieldAssetId = 999;
  assert.equal(catalog.residents[0]!.fieldAssetId, 1);
});

test("riding cache is explicit and independent of outer asset and active riding flag", () => {
  const catalog = actorCatalog(), context = actorContext();
  context.currentTransport = { id: 6, typeId: 12, fieldAssetId: 38 };
  Object.assign(context.player, { fieldAssetId: 38, riderFieldAssetId: 1, riding: true });
  const before = structuredClone(context);
  const plan = preparePartyActors(catalog, [actorMember()], context, true);
  assert.deepEqual(plan.changes[0] && { id: plan.changes[0].asset.id, mode: plan.changes[0].mode }, { id: 11, mode: "rider" });
  assert.deepEqual(context, before);
  context.player.riding = false; // source RideOut retains the cached rider reference
  assert.equal(preparePartyActors(catalog, [actorMember()], context, true).changes.some((c) => c.actorId === "player"), false);
  context.player.riderFieldAssetId = 999;
  assert.throws(() => preparePartyActors(catalog, [actorMember()], context, true), /Missing party appearance field asset 999/);
  const missing = actorContext();
  delete (missing.player as Partial<typeof missing.player>).riderFieldAssetId;
  assert.throws(() => preparePartyActors(catalog, [actorMember()], missing, true), /field asset/);
});
