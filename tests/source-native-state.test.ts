import assert from "node:assert/strict";
import test from "node:test";
import { GameState, type GameStateSnapshot } from "../src/core/game-state.js";
import { createSourceNativeState } from "../src/core/source-native-state.js";
import { EventState } from "../src/core/event-state.js";
import { Transportations } from "../src/core/transportation.js";
import { transportationStayMaps } from "../src/core/transportation-state.js";
import { sourceNativeStateFixture } from "./fixtures/source-native-state.js";

test("source fresh owner retains every native domain and immutable before-field-load entry seed", () => {
  const { fresh, plan, development } = sourceNativeStateFixture(), state = fresh();
  const { ownedTransportationIds, parkedTransportationMapIds: _maps, ...native } = plan.nativeInitialization;
  const expected = { kind: "source-native-state-v2", entrySeed: plan.entry, ...native,
    ownedTransportations: ownedTransportationIds.map((id) => ({ id, mapId: -1,
      position: { x: 1000, y: 1000, z: -1000 }, direction: 0, timeStampTicks: "0" })) };
  assert.equal(state.snapshot().formatVersion, 12);
  assert.equal(state.initialization, "source-new-game");
  assert.deepEqual(state.nativeState, expected);
  assert.deepEqual(state.snapshot().nativeState, expected);
  assert.deepEqual(state.snapshot().roster[0]!.conditionIds, []);
  const checkpoint = development();
  assert.equal(checkpoint.initialization, "development-checkpoint");
  assert.equal(checkpoint.nativeState, null);
  assert.deepEqual(checkpoint.snapshot().roster[0]!.conditionIds, [9007]);
});

test("source initialization, shared read and separate new games share no mutable native arrays", () => {
  const { fresh, plan } = sourceNativeStateFixture(), a = fresh(), b = fresh();
  const before = a.snapshot(), read = a.nativeState!;
  const seed = createSourceNativeState(plan);
  seed.entrySeed.beastExchangeFlags[0] = 88;
  plan.entry.beastExchangeFlags[1] = 89;
  read.ownedTransportations.splice(0);
  read.entrySeed.beastExchangeFlags[2] = 90;
  read.entrySeed.mapId = 999;
  assert.deepEqual(a.snapshot(), before);
  assert.deepEqual(b.snapshot(), before);
});

test("fresh codec restores saved values into a candidate without replaying grants or checkpoint conditions", () => {
  const f = sourceNativeStateFixture(), source = f.fresh();
  source.fieldInventory.prepare({ kind: "pay-gil", amount: 7 }).commit();
  source.fieldOwnedConditions.prepare({ kind: "add-condition", conditionType: 607, target: 0 }).commit();
  const saved = JSON.parse(JSON.stringify(source.snapshot())) as GameStateSnapshot;
  saved.equipmentStock.find((s) => s.id === 3)!.count = 0;
  const restored = f.development();
  restored.restore(saved);
  assert.deepEqual(restored.snapshot(), saved);
  assert.equal(restored.initialization, "source-new-game");
  assert.deepEqual(restored.nativeState, source.nativeState);
  assert.equal(restored.snapshot().gil, 93);
  assert.equal(restored.snapshot().equipmentStock.find((s) => s.id === 3)!.count, 0);
  assert.deepEqual(restored.fieldPuppetRoster.current().owned[0]!.conditionTypes, [607]);
  const originalDevelopment = f.development().snapshot();
  restored.restore(originalDevelopment);
  assert.equal(restored.initialization, "development-checkpoint");
  assert.equal(restored.nativeState, null, "restoring development does not fill source domains");
});

test("owned v10 rejects omitted origin/native state and earlier schemas without partial replacement", () => {
  const state = sourceNativeStateFixture().fresh(), before = state.snapshot();
  const corrupt: ((snapshot: Record<string, unknown>) => void)[] = [
    (s) => { s.formatVersion = 9; },
    (s) => { delete s.initialization; },
    (s) => { delete s.nativeState; },
    (s) => { s.initialization = "new-game"; },
    (s) => { s.initialization = "development-checkpoint"; },
    (s) => { s.nativeState = null; },
    (s) => { s.nativeState = { ...(s.nativeState as object), kind: "source-native-state-v0" }; },
  ];
  for (const change of corrupt) {
    const candidate = structuredClone(before);
    change(candidate as unknown as Record<string, unknown>);
    assert.throws(() => state.restore(candidate));
    assert.deepEqual(state.snapshot(), before);
  }
});

test("native collections, counters and route mutations remain explicit unsupported transitions", () => {
  const state = sourceNativeStateFixture().fresh(), before = state.snapshot();
  const mutations: [string, (value: any) => void][] = [
    ["owner omitted", (n) => n.ownedTransportations.pop()],
    ["owner duplicated", (n) => n.ownedTransportations.push(n.ownedTransportations[0])],
    ["owner order", (n) => n.ownedTransportations.reverse()],
    ["unknown parking", (n) => n.ownedTransportations[0].mapId = null],
    ["incomplete parking", (n) => { delete n.ownedTransportations[0].position; }],
    ["unbound parking", (n) => n.ownedTransportations[0].id = 77],
    ["crystal", (n) => n.crystalFlags[0] = true],
    ["warehouse", (n) => n.warehouseItems.push({ id: 701, count: 1 })],
    ["keyword", (n) => n.keywords.push(7)],
    ["magic", (n) => n.ownedMagic.push(31)],
    ["magic stone", (n) => n.ownedMagicStones.push(1)],
    ["route", (n) => n.entrySeed.mapId++],
    ["transport", (n) => n.entrySeed.transportation.id = 9],
    ["seed position", (n) => n.entrySeed.savedPlayer.x = 1],
    ["seed movement", (n) => n.entrySeed.moveCount++],
    ["seed subtraction", (n) => n.entrySeed.subtractSteps++],
    ["seed beast flag", (n) => n.entrySeed.beastExchangeFlags[2] = 1],
    ["seed beast group", (n) => n.entrySeed.beastSeekGroupId = 1],
    ["premature entry sync", (n) => n.entrySeed.entrySynchronized = true],
    ["missing collection", (n) => { delete n.ownedMagic; }],
    ["unknown field", (n) => { n.extra = 0; }],
    ...Object.keys(before.nativeState!.counters).map((key): [string, (n: any) => void] =>
      [key, (n) => { n.counters[key] = 1; }]),
  ];
  for (const [label, change] of mutations) {
    const candidate = structuredClone(before);
    change(candidate.nativeState);
    assert.throws(() => state.restore(candidate), label);
    assert.deepEqual(state.snapshot(), before, label);
  }
});

test("native initialization domains are carried through shared draft and live transactions exactly once", () => {
  const state = sourceNativeStateFixture().fresh(), before = state.snapshot(), draft = state.prepareFieldState();
  draft.ports.inventory.prepare({ kind: "grant-gil", amount: 5 }).commit();
  draft.ports.ownedConditions.prepare({ kind: "add-condition", conditionType: 607, target: 0 }).commit();
  assert.deepEqual(state.snapshot(), before);
  assert.equal(draft.commit(), true);
  assert.equal(draft.commit(), false);
  assert.deepEqual(state.nativeState, before.nativeState);
  assert.equal(state.initialization, before.initialization);
  assert.equal(state.gil, 105);
  const stale = state.prepareFieldState();
  stale.ports.inventory.prepare({ kind: "grant-gil", amount: 9 }).commit();
  state.fieldInventory.prepare({ kind: "pay-gil", amount: 1 }).commit();
  const latest = state.snapshot();
  assert.equal(stale.commit(), false);
  assert.deepEqual(state.snapshot(), latest);
  assert.deepEqual(state.nativeState, before.nativeState);
});

test("source transportation entry consumes actual owned and parking data with the separate event flag owner", () => {
  const { fresh, definition, plan } = sourceNativeStateFixture(), state = fresh();
  const native = state.nativeState!, transportations = new Transportations(definition.transportation);
  assert.deepEqual(native.ownedTransportations.map((record) => record.id), [1, 9]);
  assert.deepEqual(transportationStayMaps(native.ownedTransportations), { 1: -1, 9: -1 });
  assert.deepEqual(native.entrySeed, plan.entry);
  const events = new EventState(plan.events);
  const entry = transportations.projectMapEntry({
    currentId: null,
    loadId: native.entrySeed.transportation.id,
    mapId: native.entrySeed.mapId,
    stayMapIds: transportationStayMaps(native.ownedTransportations),
    availability: transportations.availability((ref) => events.read(ref)),
  });
  assert.equal(entry.currentId, 1);
  assert.equal(entry.selected, true);
  assert.deepEqual(state.nativeState, native, "field selection does not overwrite the entry seed");
});

test("restoring a source origin requires the matching content initializer even in a development candidate", () => {
  const f = sourceNativeStateFixture(), saved = f.fresh().snapshot();
  delete f.content.sourceNewGame;
  const unbound = new GameState(f.content, [f.player], saved.catalogHash, f.conditions);
  const before = unbound.snapshot();
  assert.throws(() => unbound.restore(saved), /source new-game initializer/);
  assert.deepEqual(unbound.snapshot(), before);
});
