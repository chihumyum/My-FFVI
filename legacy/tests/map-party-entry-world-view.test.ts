import test from "node:test";
import assert from "node:assert/strict";
import { prepareMapPartyEntry } from "../src/core/map-party-entry.js";
import { projectMapEntryView } from "../src/core/map-view.js";
import { actorCatalog } from "./fixtures/party-actors.js";
import { mapEntryInput } from "./fixtures/map-party-entry.js";

function worldEntry() {
  const entry = mapEntryInput();
  entry.definition.loopType = 3;
  entry.viewPlan = projectMapEntryView({ mapId: entry.definition.mapId, isWorld: true,
    requestedViewType: 0, loopType: 3 });
  return entry;
}

test("normal world PointIn uses the same player pose, visibility and persistent actors with loop area", () => {
  const input = worldEntry(), before = structuredClone(input);
  input.playerVisible = false;
  const plan = prepareMapPartyEntry(actorCatalog(), input);
  assert.deepEqual(plan.player, { x: 8, y: 9, layer: 2, direction: "left", visible: false, asset: "same-media", mount: "" });
  assert.deepEqual(plan.checkpoint.context.camera, { mapViewType: 0,
    mapArea: { xMin: -200, yMin: 160, width: 400, height: 320 } });
  assert.deepEqual(plan.movement.start, { x: 8, y: 9 });
  assert.deepEqual(plan.hiddenActorIds, ["puppet:0", "puppet:1", "puppet:2", "puppet:3", "party:0", "party:1", "party:2"]);
  assert.deepEqual(plan.checkpoint.context.puppets, before.prior.context.puppets);
  assert.deepEqual(plan.checkpoint.context.multiParty, before.prior.context.multiParty);
  assert.deepEqual(plan.ownedConditionChanges, []);
  assert.deepEqual(plan.viewPlan, input.viewPlan);
  assert.deepEqual(input, { ...before, playerVisible: false });
  plan.viewPlan!.loop.horizontal = false;
  assert.equal(input.viewPlan!.loop.horizontal, true);
});

test("loops do not grant world identity or a new entry capability to legacy input", () => {
  const without = worldEntry(); delete without.viewPlan;
  assert.throws(() => prepareMapPartyEntry(actorCatalog(), without), /view\/loop/);
  const sub = worldEntry(); sub.viewPlan = projectMapEntryView({ mapId: sub.definition.mapId,
    isWorld: false, requestedViewType: 0, loopType: 3 });
  assert.throws(() => prepareMapPartyEntry(actorCatalog(), sub), /view\/loop/);
  const legacy = prepareMapPartyEntry(actorCatalog(), mapEntryInput());
  assert.equal(Object.hasOwn(legacy, "viewPlan"), false, "Old plans keep their exact saved/view shape");
});

test("source Bird remains blocked while explicitly flat framework presentation preserves requested view", () => {
  const source = worldEntry(); source.mapViewType = 1;
  source.viewPlan = projectMapEntryView({ mapId: source.definition.mapId, isWorld: true, requestedViewType: 1, loopType: 3 });
  assert.throws(() => prepareMapPartyEntry(actorCatalog(), source), /view\/loop/);
  const framework = worldEntry();
  framework.viewPlan = projectMapEntryView({ mapId: framework.definition.mapId, isWorld: true,
    requestedViewType: 1, loopType: 3 }, "framework-world-map-flat-v1");
  const plan = prepareMapPartyEntry(actorCatalog(), framework);
  assert.equal(plan.checkpoint.context.camera.mapViewType, 0);
  assert.equal(plan.viewPlan!.requestedViewType, 1);
  assert.equal(plan.viewPlan!.mapViewType, 1);
  assert.equal(plan.viewPlan!.presentationViewType, 0);
});

test("world traversal keeps independent companion, multi-party, linked entrance and transportation gates", () => {
  const changes: ((input: ReturnType<typeof worldEntry>) => void)[] = [
    input => { input.canPartySwitching = true; },
    input => { input.canPartySwitching = null; },
    input => { input.definition.pointIns[0]!.linkObject = 12; },
    input => { input.entrance = -1; },
    input => { input.prior.context.companion = { fieldAssetId: 3, conditionTypes: [], actor: null, puppet: null }; },
    input => { input.prior.context.multiParty[0]!.members = structuredClone(input.party.activeMembers); },
    input => { input.transportation = { id: 6, type: 12, assetId: 38 }; },
    input => { input.prior.context.currentTransport = { id: 6, typeId: 12, fieldAssetId: 38 }; },
  ];
  for (const change of changes) {
    const input = worldEntry(); change(input);
    const before = structuredClone(input);
    assert.throws(() => prepareMapPartyEntry(actorCatalog(), input));
    assert.deepEqual(input, before);
  }
});

test("a stale or forged view plan cannot change the destination camera or party draft", () => {
  for (const change of ["map", "loop", "presentation", "derived"] as const) {
    const input = worldEntry();
    if (change === "map") input.viewPlan!.mapId++;
    if (change === "loop") input.viewPlan!.loopType = 0;
    if (change === "presentation") input.mapViewType = 1;
    if (change === "derived") input.viewPlan!.mapViewType = 2;
    const before = structuredClone(input);
    assert.throws(() => prepareMapPartyEntry(actorCatalog(), input), /binding mismatch|projection mismatch/);
    assert.deepEqual(input, before);
  }
});
