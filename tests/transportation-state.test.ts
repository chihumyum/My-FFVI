import assert from "node:assert/strict";
import test from "node:test";
import { EventState } from "../src/core/event-state.js";
import { Transportations } from "../src/core/transportation.js";
import { initialOwnedTransportations, projectTransportationState, transportationStayMaps,
  type TransportationStateCommand } from "../src/core/transportation-state.js";
import { sourceNativeStateFixture } from "./fixtures/source-native-state.js";

const command = (change: Partial<TransportationStateCommand> = {}): TransportationStateCommand => ({
  id: 9, enable: true, mapId: 901, position: { x: 16.25, y: -32.5 }, layer: 10,
  direction: 3, timeStampTicks: "638958585001234567", ...change,
});

test("native constructors create complete independent payloads and stay maps are only projections", () => {
  const records = initialOwnedTransportations([1, 9], { 1: -1, 9: -1 });
  assert.deepEqual(records, [1, 9].map((id) => ({ id, mapId: -1,
    position: { x: 1000, y: 1000, z: -1000 }, direction: 0, timeStampTicks: "0" })));
  const maps = transportationStayMaps(records); maps[9] = 901;
  records[1]!.position.x = 3;
  assert.equal(records[0]!.position.x, 1000);
  assert.equal(records[1]!.mapId, -1);
  assert.throws(() => initialOwnedTransportations([1, 9], { 1: -1, 9: 901 }), /initialization/);
  assert.throws(() => initialOwnedTransportations([1, 1], { 1: -1 }), /identities/);
});

test("TransportationEnabled prepares full parking and writes the separate release flag only on joint commit", () => {
  const f = sourceNativeStateFixture(), state = f.fresh(), before = state.snapshot();
  const port = state.fieldTransportation!, events = new EventState(f.plan.events);
  const rules = new Transportations(port.catalog), flag = rules.releaseFlagRef(9);
  const tx = port.prepare(command());
  assert.deepEqual(tx.before, before.nativeState!.ownedTransportations[1]);
  assert.deepEqual(tx.after, { id: 9, mapId: 901,
    position: { x: 16.25, y: -32.5, z: 249 }, direction: 3, timeStampTicks: "638958585001234567" });
  tx.validate();
  assert.deepEqual(state.snapshot(), before); assert.equal(events.read(flag), 0);
  tx.commitWith(() => events.write(flag, 1));
  assert.equal(events.read(flag), 1);
  assert.deepEqual(port.read()[1], tx.after);
  assert.deepEqual(state.nativeState!.entrySeed, before.nativeState!.entrySeed);
  assert.throws(tx.commit, /Stale/);
});

test("nullable location/direction retain values, disabling changes parking but preserves the timestamp", () => {
  const state = sourceNativeStateFixture().fresh(), port = state.fieldTransportation!;
  port.prepare(command()).commit();
  const before = port.read()[1]!;
  const tx = port.prepare(command({ enable: false, mapId: -1,
    position: null, layer: null, direction: null, timeStampTicks: null }));
  tx.commit();
  assert.deepEqual(port.read()[1], { ...before, mapId: -1 });
  assert.throws(() => port.prepare(command({ enable: false })), /preserve its timestamp/);
  assert.throws(() => port.prepare(command({ timeStampTicks: null })), /timestamp/);
});

test("source layer writes preserve <=8, map native9..12, and use the known native default for other layers", () => {
  const { definition } = sourceNativeStateFixture();
  const records = initialOwnedTransportations([1, 9], { 1: -1, 9: -1 });
  for (const [layer, z] of [[8, -1000], [-1, -1000], [9, 349], [10, 249], [11, 149], [12, 49], [13, 0]]) {
    const tx = projectTransportationState(definition.transportation, records, command({ layer: layer! }));
    assert.equal(tx.after.position.z, z);
  }
  const x = 1 / 3;
  assert.equal(projectTransportationState(definition.transportation, records,
    command({ position: { x, y: 0 } })).after.position.x, Math.fround(x));
  assert.equal(records[1]!.position.z, -1000);
});

test("parking JSON restore preserves all fields, exact Int64 and ownership order without reseeding", () => {
  const f = sourceNativeStateFixture(), state = f.fresh();
  state.fieldTransportation!.prepare(command()).commit();
  state.fieldTransportation!.prepare(command({ id: 1, mapId: 777, layer: 12,
    position: { x: -1, y: 2048 }, direction: 0, timeStampTicks: "9223372036854775807" })).commit();
  const saved = JSON.parse(JSON.stringify(state.snapshot()));
  const restored = f.development(); restored.restore(saved);
  assert.deepEqual(restored.snapshot(), saved);
  assert.deepEqual(restored.fieldTransportation!.read(), state.fieldTransportation!.read());
  assert.deepEqual(transportationStayMaps(restored.fieldTransportation!.read()), { 1: 777, 9: 901 });
  const old = structuredClone(saved); old.formatVersion = 9;
  assert.throws(() => restored.restore(old), /version/);
  assert.deepEqual(restored.snapshot(), saved);
});

test("corrupt or incomplete parking state cannot publish even when another valid record changed first", () => {
  const state = sourceNativeStateFixture().fresh(), before = state.snapshot();
  const changes: ((record: any) => void)[] = [
    (record) => { record.id = 77; }, (record) => { record.position.x = Infinity; },
    (record) => { record.position.y = 1 / 3; }, (record) => { delete record.position.z; },
    (record) => { record.direction = null; }, (record) => { record.mapId = 1.5; },
    (record) => { record.timeStampTicks = 638958585001234567; },
    (record) => { record.timeStampTicks = "01"; },
    (record) => { record.timeStampTicks = "9223372036854775808"; },
    (record) => { record.enable = true; },
  ];
  for (const change of changes) {
    const next = structuredClone(before); next.nativeState!.ownedTransportations[0]!.mapId = 901;
    change(next.nativeState!.ownedTransportations[1]);
    assert.throws(() => state.restore(next)); assert.deepEqual(state.snapshot(), before);
  }
});

test("transaction projections and catalog reads are detached and stale live writes reject before callback", () => {
  const state = sourceNativeStateFixture().fresh(), port = state.fieldTransportation!;
  const tx = port.prepare(command()), expected = structuredClone(tx.after);
  tx.before.mapId = 7; tx.after.position.x = 999;
  port.catalog.definitions[1]!.id = 55;
  tx.commit();
  assert.deepEqual(state.fieldTransportation!.read()[1], expected);
  assert.equal(state.fieldTransportation!.catalog.definitions[1]!.id, 9);
  const stale = state.fieldTransportation!.prepare(command({ mapId: 903 }));
  state.fieldInventory.prepare({ kind: "grant-gil", amount: 1 }).commit();
  const before = state.snapshot(); let called = false;
  assert.throws(() => stale.commitWith(() => { called = true; }), /Stale/);
  assert.equal(called, false); assert.deepEqual(state.snapshot(), before);
});

test("shared candidate composes inventory and parking then its same port follows live ownership", () => {
  const state = sourceNativeStateFixture().fresh(), before = state.snapshot(), draft = state.prepareFieldState();
  const stale = draft.ports.transportation!.prepare(command());
  draft.ports.inventory.prepare({ kind: "grant-gil", amount: 4 }).commit();
  assert.throws(stale.commit, /Stale/);
  draft.ports.transportation!.prepare(command()).commit();
  assert.deepEqual(state.snapshot(), before);
  assert.equal(draft.ports.transportation!.read()[1]!.mapId, 901);
  assert.equal(draft.commit(), true); assert.equal(draft.commit(), false);
  assert.equal(state.gil, before.gil + 4);
  state.fieldTransportation!.prepare(command({ mapId: 902 })).commit();
  assert.equal(draft.ports.transportation!.read()[1]!.mapId, 902);
  draft.ports.transportation!.prepare(command({ mapId: 903 })).commit();
  assert.equal(state.fieldTransportation!.read()[1]!.mapId, 903);
});

test("discarded/stale map candidates never overwrite newer parking and invalid prepare is inert", () => {
  const state = sourceNativeStateFixture().fresh(), before = state.snapshot();
  const draft = state.prepareFieldState(); draft.ports.transportation!.prepare(command()).commit();
  assert.deepEqual(state.snapshot(), before);
  state.fieldTransportation!.prepare(command({ mapId: 777 })).commit();
  const current = state.snapshot();
  assert.equal(draft.commit(), false);
  assert.throws(() => state.fieldTransportation!.prepare(command({ id: 777 })), /Unknown/);
  assert.deepEqual(state.snapshot(), current);
});

test("joint publication faults and reentry cannot partially replace live or candidate owned data", () => {
  const state = sourceNativeStateFixture().fresh(), before = state.snapshot();
  const tx = state.fieldTransportation!.prepare(command());
  assert.throws(() => tx.commitWith(() => { throw new Error("provider failed before publication"); }), /provider failed/);
  assert.deepEqual(state.snapshot(), before);
  assert.throws(() => tx.commitWith(() => state.fieldInventory.prepare({ kind: "grant-gil", amount: 1 }).commit()), /in progress/);
  assert.deepEqual(state.snapshot(), before);
  assert.throws(() => tx.commitWith(async () => {}), /synchronous/);
  const draft = state.prepareFieldState();
  const candidate = draft.ports.transportation!.prepare(command());
  const inventory = draft.ports.inventory.prepare({ kind: "grant-gil", amount: 1 });
  assert.throws(() => candidate.commitWith(inventory.commit), /Stale/);
  assert.deepEqual(draft.ports.transportation!.read(), before.nativeState!.ownedTransportations);
  candidate.commitWith(() => { assert.equal(draft.commit(), false); });
  assert.equal(draft.commit(), true);
  assert.equal(state.gil, before.gil); assert.equal(state.fieldTransportation!.read()[1]!.mapId, 901);
});

test("transport mutation respects the battle lease and development origin never synthesizes owned payloads", () => {
  const f = sourceNativeStateFixture(), state = f.fresh();
  const port = state.fieldTransportation!, lease = state.openBattle(44,
    { kind: "battle-reward-policy-v1", ap: 0, magicPoints: 0 });
  assert.throws(() => port.prepare(command()), /reserved/);
  state.cancelBattle(lease);
  port.prepare(command()).commit();
  const dev = f.development();
  assert.equal(dev.fieldTransportation, undefined);
  assert.equal(dev.prepareFieldState().ports.transportation, undefined);
  dev.restore(state.snapshot()); const restoredPort = dev.fieldTransportation!;
  assert.ok(restoredPort);
  dev.restore(f.development().snapshot());
  assert.throws(() => restoredPort.read(), /ownership/);
  assert.throws(() => restoredPort.prepare(command()), /ownership/);
});
