import test from "node:test";
import assert from "node:assert/strict";
import { prepareMapPartyEntry } from "../src/core/map-party-entry.js";
import { WEB_RETAINED_WORLD_TRANSPORTATION as policy } from "../src/core/world-transportation-entry.js";
import { projectMapEntryView } from "../src/core/map-view.js";
import { actorCatalog } from "./fixtures/party-actors.js";
import { mapEntryInput } from "./fixtures/map-party-entry.js";

function fixture(armor = true, loopType: 0 | 3 = 3) {
  const input = mapEntryInput(), catalog = actorCatalog();
  input.definition.loopType = loopType;
  input.viewPlan = projectMapEntryView({ mapId: input.definition.mapId, isWorld: true, requestedViewType: 1, loopType }, "framework-world-map-flat-v1");
  input.retainedWorldTransportation = { policy, mode: "live-entry" };
  input.transportation = armor ? { id: 6, type: 12, assetId: 38 } : { id: 1, type: 1, assetId: 0 };
  input.prior.context.currentTransport = { id: input.transportation.id, typeId: input.transportation.type, fieldAssetId: input.transportation.assetId };
  Object.assign(input.prior.context.player, { fieldAssetId: armor ? 38 : 1, riderFieldAssetId: armor ? 3 : null, riding: armor });
  return { input, catalog };
}

test("explicit retained Web world entry preserves exact walking/Magitek identities on cyclic and noncyclic world maps", () => {
  for (const armor of [false, true]) for (const loop of [0, 3] as const) {
    const {input, catalog} = fixture(armor, loop), before = structuredClone(input);
    const next = prepareMapPartyEntry(catalog, input);
    assert.deepEqual(next.checkpoint.context.currentTransport, input.prior.context.currentTransport);
    assert.equal(next.player.mount, armor ? "armor" : "");
    assert.equal(next.player.asset, "same-media");
    assert.equal(next.checkpoint.context.player.riderFieldAssetId, armor ? 11 : null,
      "fresh leader base, never old armor outer or old rider");
    assert.deepEqual([next.player.x, next.player.y, next.player.layer, next.player.direction], [8, 9, 2, "left"]);
    assert.equal(next.viewPlan!.mapViewType, 1); assert.equal(next.viewPlan!.presentationViewType, 0);
    assert.deepEqual(input, before);
  }
});

test("retained world policy cannot silently disembark, guess a type12 identity or authorize native Bird", () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) => { delete f.input.retainedWorldTransportation; },
    (f: ReturnType<typeof fixture>) => { Reflect.set(f.input,"retainedWorldTransportation",null); },
    (f: ReturnType<typeof fixture>) => { f.input.retainedWorldTransportation!.policy = "unknown" as typeof policy; },
    (f: ReturnType<typeof fixture>) => { f.input.prior.context.currentTransport!.id = 1; },
    (f: ReturnType<typeof fixture>) => { f.input.transportation.id = 17; f.catalog.transportations.push({id:17,typeId:12,fieldAssetId:38}); },
    (f: ReturnType<typeof fixture>) => { f.input.viewPlan = projectMapEntryView({mapId:f.input.definition.mapId,isWorld:true,requestedViewType:1,loopType:3}); f.input.mapViewType=1; },
    (f: ReturnType<typeof fixture>) => { f.input.definition.pointIns[0]!.linkObject=1; },
    (f: ReturnType<typeof fixture>) => { f.input.canPartySwitching=null; },
  ]) {
    const f=fixture(); mutate(f); const before=structuredClone(f.input);
    assert.throws(()=>prepareMapPartyEntry(f.catalog,f.input)); assert.deepEqual(f.input,before);
  }
});

test("reconstruction explicitly starts from trusted original actors and does not grant live transport switching", () => {
  const f=fixture(); f.input.prior.context.currentTransport={id:1,typeId:1,fieldAssetId:0};
  assert.throws(()=>prepareMapPartyEntry(f.catalog,f.input),/silently/);
  f.input.retainedWorldTransportation!.mode="source-reconstruction";
  const restored=prepareMapPartyEntry(f.catalog,f.input);
  assert.equal(restored.checkpoint.context.currentTransport!.id,6);
  assert.equal(restored.checkpoint.context.player.riderFieldAssetId,11);
  assert.equal(restored.checkpoint.context.player.fieldAssetId,38);
});

test("legacy walking remains compatible; new policy does not grant missing PointIn or world applicability", () => {
  const f=fixture(false); delete f.input.retainedWorldTransportation;
  assert.equal(prepareMapPartyEntry(f.catalog,f.input).checkpoint.context.currentTransport!.id,1);
  f.input.retainedWorldTransportation={policy,mode:"live-entry"}; delete f.input.viewPlan;
  assert.throws(()=>prepareMapPartyEntry(f.catalog,f.input));
});
