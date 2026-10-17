import test from "node:test";
import assert from "node:assert/strict";
import { projectMapEntryView, parseMapEntryViewPlan, assertMapEntryViewBinding,
  type MapEntryViewInput } from "../src/core/map-view.js";

const input = (change: Partial<MapEntryViewInput> = {}): MapEntryViewInput => ({ mapId: 1001,
  isWorld: true, requestedViewType: 0, loopType: 3, ...change });

test("world identity and requested view are independent of looping geometry", () => {
  const world = projectMapEntryView(input({ loopType: 0, requestedViewType: 1 }));
  assert.equal(world.isWorld, true); assert.equal(world.mapViewType, 1);
  assert.deepEqual(world.loop, { horizontal: false, vertical: false });
  const sub = projectMapEntryView(input({ isWorld: false, requestedViewType: 2 }));
  assert.equal(sub.isWorld, false); assert.equal(sub.requestedViewType, 2);
  assert.equal(sub.mapViewType, 0); assert.equal(sub.presentationViewType, 0);
  assert.deepEqual(sub.loop, { horizontal: true, vertical: true });
  assert.throws(() => projectMapEntryView(input({ isWorld: null })), /Unknown map world applicability/);
});

test("Normal, Bird and FlatBird retain source requests instead of collapsing nonzero to one", () => {
  for (const requestedViewType of [0, 1, 2] as const) {
    const plan = projectMapEntryView(input({ requestedViewType }));
    assert.equal(plan.requestedViewType, requestedViewType);
    assert.equal(plan.mapViewType, requestedViewType);
    assert.equal(plan.presentationViewType, requestedViewType);
    assert.equal(plan.presentationPolicy, null);
  }
});

test("framework flat presentation records the deliberate policy and keeps original Bird/FlatBird identity", () => {
  for (const requestedViewType of [1, 2] as const) {
    const plan = projectMapEntryView(input({ requestedViewType }), "framework-world-map-flat-v1");
    assert.equal(plan.mapViewType, requestedViewType);
    assert.equal(plan.requestedViewType, requestedViewType);
    assert.equal(plan.presentationViewType, 0);
    assert.equal(plan.presentationPolicy, "framework-world-map-flat-v1");
    assert.deepEqual(parseMapEntryViewPlan(plan), plan);
  }
  assert.throws(() => projectMapEntryView(input({ isWorld: false }), "framework-world-map-flat-v1"), /Unadmitted/);
  assert.throws(() => projectMapEntryView(input(), "unknown" as "framework-world-map-flat-v1"), /Unadmitted/);
});

test("loop axes follow the source four-value domain and remain detached", () => {
  for (const loopType of [0, 1, 2, 3] as const) {
    const original = input({ loopType }), before = structuredClone(original);
    const plan = projectMapEntryView(original);
    assert.deepEqual(plan.loop, { horizontal: loopType === 1 || loopType === 3, vertical: loopType === 2 || loopType === 3 });
    plan.loop.horizontal = !plan.loop.horizontal;
    assert.deepEqual(original, before);
  }
});

test("loaded plans reject forged derived view, policy or topology and stale destination binding", () => {
  const plan = projectMapEntryView(input({ requestedViewType: 1 }), "framework-world-map-flat-v1");
  assert.throws(() => parseMapEntryViewPlan({ ...plan, mapViewType: 0 }), /projection mismatch/);
  assert.throws(() => parseMapEntryViewPlan({ ...plan, presentationViewType: 1 }), /projection mismatch/);
  assert.throws(() => parseMapEntryViewPlan({ ...plan, presentationPolicy: null }), /projection mismatch/);
  assert.throws(() => parseMapEntryViewPlan({ ...plan, loop: { horizontal: false, vertical: true } }), /projection mismatch/);
  const binding = { mapId: plan.mapId, loopType: plan.loopType, presentationViewType: plan.presentationViewType };
  const detached = assertMapEntryViewBinding(plan, binding);
  assert.notEqual(detached, plan); assert.notEqual(detached.loop, plan.loop);
  for (const [key, value] of [["mapId", 1002], ["loopType", 0], ["presentationViewType", 1]] as const)
    assert.throws(() => assertMapEntryViewBinding(plan, { ...binding, [key]: value }), /binding mismatch/);
});

test("strict view input does not coerce unknown applicability, numeric domains or accessor fields", () => {
  for (const bad of [input({ mapId: -0 }), input({ mapId: 0 }), input({ mapId: 0x80000000 }),
    input({ requestedViewType: 3 as 0 }), input({ requestedViewType: -0 }), input({ loopType: 4 as 0 }),
    input({ isWorld: 1 as unknown as boolean }), { ...input(), guessedFromMapName: true }]) {
    const before = structuredClone(bad);
    assert.throws(() => projectMapEntryView(bad), /Invalid|Unknown/);
    assert.deepEqual(bad, before);
  }
  let reads = 0;
  const bad = { ...input() };
  Object.defineProperty(bad, "isWorld", { enumerable: true, get: () => { reads++; return true; } });
  assert.throws(() => projectMapEntryView(bad), /fields/);
  assert.equal(reads, 0);
  assert.throws(() => parseMapEntryViewPlan({ ...projectMapEntryView(input()), sourceFallback: false }), /fields/);
});
