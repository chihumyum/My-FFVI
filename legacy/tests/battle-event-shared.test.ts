import test from "node:test";
import assert from "node:assert/strict";
import { EventState, UnknownEventValue, type VariableRef } from "../src/core/event-state.js";
import { BattleEventSharedState, battleEventSharedSnapshot, parseBattleEventSharedSnapshot,
  prepareBattleEventSharedReturn } from "../src/core/battle-event-shared.js";

const flag: VariableRef = { category: "ScenarioFlag1", index: 52 };
const other: VariableRef = { category: "TreasureFlag4", index: 137 };
const variable: VariableRef = { category: "ScenarioVariable", index: 3 };

test("battle borrows detached global banks without copying local, map or selection owners", () => {
  const field = EventState.initialized(); field.clearMap(6);
  field.beginScript({ labels: ["Field"], values: [37] });
  field.write({ category: "MessageSelection", index: 0 }, 8);
  const entry = battleEventSharedSnapshot(field), battle = new BattleEventSharedState(entry);
  entry.scenario[52] = 1;
  assert.equal(battle.read(flag), 0);
  battle.write(flag, -8); battle.write(variable, -2147483648);
  assert.equal(battle.read(flag), 1); assert.equal(field.read(flag), 0);
  for (const category of ["ScriptLocalVariable", "MapLocalVariable", "AreaLocalVariable", "MessageSelection"] as const) {
    assert.throws(() => battle.read({ category, index: 0 }), /Unsupported shared/);
    assert.throws(() => battle.write({ category, index: 0 }, 1), /Unsupported shared/);
  }
  assert.deepEqual(field.snapshot().script, [37]); assert.equal(field.snapshot().selected, 8);
  const inspected = battle.prepareReturn(); inspected.candidate.global[3] = 9; inspected.entry.scenario[52] = 1;
  assert.equal(battle.read(variable), -2147483648); assert.equal(battle.entry.scenario[52], 0);
});

test("unknown is preserved until an explicit write; frame restore does not change retry entry", () => {
  const field = new EventState(), battle = new BattleEventSharedState(battleEventSharedSnapshot(field));
  assert.throws(() => battle.read(flag), UnknownEventValue);
  const before = battle.snapshot(); battle.write(flag, 1); battle.write(variable, 7);
  assert.equal(battle.read(variable), 7);
  battle.restore(before);
  assert.throws(() => battle.read(variable), UnknownEventValue);
  assert.deepEqual(battle.entry, before);
});

test("return publishes all durable writes once while preserving captured local frame identity", () => {
  const field = EventState.initialized(); field.clearMap(9);
  field.beginScript({ labels: ["suspended"], values: [88] });
  const frame = field.captureScriptLocals();
  const battle = new BattleEventSharedState(battleEventSharedSnapshot(field));
  battle.write(flag, 1); battle.write(other, 1); battle.write(variable, 25);
  const publication = prepareBattleEventSharedReturn(field, battle.prepareReturn());
  assert.equal(field.read(flag), 0);
  let ownedCommitted = false;
  publication.commitWith(() => { assert.equal(field.read(flag), 0); ownedCommitted = true; });
  assert.equal(ownedCommitted, true);
  assert.equal(field.read(flag), 1); assert.equal(field.read(other), 1); assert.equal(field.read(variable), 25);
  field.beginScript({ labels: ["later"], values: [3] }); field.restoreScriptLocals(frame);
  assert.equal(field.read({ category: "ScriptLocalVariable", index: 0 }), 88);
  assert.deepEqual([field.snapshot().map, field.snapshot().area], [Array(8).fill(0), Array(8).fill(0)]);
  assert.throws(() => publication.commit(), /Stale shared/);
});

test("return rejects stale read-only cells before publishing any reward or flag", () => {
  const field = EventState.initialized(), battle = new BattleEventSharedState(battleEventSharedSnapshot(field));
  battle.write(flag, 1);
  const pending = prepareBattleEventSharedReturn(field, battle.prepareReturn());
  field.write(variable, 2);
  let commits = 0;
  assert.throws(() => pending.commitWith(() => { commits++; }), /Stale shared/);
  assert.equal(commits, 0); assert.equal(field.read(flag), 0);
  field.write(variable, 0); pending.commitWith(() => { commits++; });
  assert.equal(commits, 1); assert.equal(field.read(flag), 1);
});

test("failed owned publication does not publish any event bank", () => {
  const field = EventState.initialized(), battle = new BattleEventSharedState(battleEventSharedSnapshot(field));
  battle.write(flag, 1); const pending = prepareBattleEventSharedReturn(field, battle.prepareReturn());
  assert.throws(() => pending.commitWith(() => { throw new Error("owned state rejected"); }), /owned state rejected/);
  assert.equal(field.read(flag), 0);
  prepareBattleEventSharedReturn(field, battle.prepareReturn()).commit();
  assert.equal(field.read(flag), 1);
});

test("invalid return never erases known values, resets locals or publishes an earlier valid flag", () => {
  const field = EventState.initialized(), battle = new BattleEventSharedState(battleEventSharedSnapshot(field));
  battle.write(flag, 1); const invalid = battle.prepareReturn(); invalid.candidate.global[15] = null;
  assert.throws(() => prepareBattleEventSharedReturn(field, invalid), /cannot erase/);
  assert.equal(field.read(flag), 0);
  invalid.candidate.global[15] = 1; invalid.candidate.treasure[1023] = 2;
  assert.throws(() => prepareBattleEventSharedReturn(field, invalid), /Invalid flag/);
  assert.equal(field.read(flag), 0);
});

test("source flag aliases use the same underlying bank cell and canonicalize on return", () => {
  const field = EventState.initialized(), battle = new BattleEventSharedState(battleEventSharedSnapshot(field));
  battle.write({ category: "ScenarioFlag2", index: -1 }, 1);
  assert.equal(battle.read({ category: "ScenarioFlag1", index: 255 }), 1);
  prepareBattleEventSharedReturn(field, battle.prepareReturn()).commit();
  assert.equal(field.read({ category: "ScenarioFlag2", index: -1 }), 1);
  assert.equal(field.read({ category: "ScenarioFlag1", index: 255 }), 1);
});

test("shared payloads reject sparse, malformed and extra banks rather than inferring unknown values", () => {
  const raw = battleEventSharedSnapshot(EventState.initialized());
  for (const change of [
    () => { raw.global[0] = 2147483648; },
    () => { delete raw.global[0]; },
    () => { raw.scenario.pop(); },
  ]) {
    const before = structuredClone(raw); change();
    assert.throws(() => parseBattleEventSharedSnapshot(raw));
    Object.assign(raw, before);
  }
  assert.throws(() => parseBattleEventSharedSnapshot({ ...raw, script: [1] }), /Invalid checkpoint fields/);
  const accepted = parseBattleEventSharedSnapshot(raw); accepted.scenario[0] = 1;
  assert.equal(raw.scenario[0], 0);
});
