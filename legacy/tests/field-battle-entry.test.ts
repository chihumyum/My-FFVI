import test from "node:test";
import assert from "node:assert/strict";
import { projectBattleFieldState, type BattleFieldState } from "../src/core/field-battle-entry.js";
import { battleEntryFixture } from "./fixtures/battle-entry.js";

const transportations = [{ id: 1, type: 1 }, { id: 6, type: 12 }];
const mounted = (): BattleFieldState => ({ mapId: 100, transportationId: 6,
  isSavePoint: null, beastFieldController: null, footAttributeType: null });

test("field entry derives exclusions from current transport identity without inventing save-point state", () => {
  const { catalog } = battleEntryFixture();
  assert.deepEqual(projectBattleFieldState(catalog, mounted(), transportations), {
    invalidContentIds: [10001, 10002, 10003, 10004, 10005], blockers: [],
  });
  const foot: BattleFieldState = { ...mounted(), transportationId: 1,
    beastFieldController: false };
  assert.equal(projectBattleFieldState(catalog, foot, transportations).invalidContentIds, null);
  assert.deepEqual(projectBattleFieldState(catalog, { ...foot, isSavePoint: true }, transportations).invalidContentIds, [10005]);
  // Changing maps reads the destination rule rather than the opening context.
  assert.deepEqual(projectBattleFieldState(catalog, { ...foot, mapId: 101 }, transportations).invalidContentIds,
    [10002, 10003, 10005]);
});

test("missing map/transport identities cannot masquerade as a controller absence or a walking default", () => {
  const { catalog } = battleEntryFixture();
  for (const field of [{ ...mounted(), mapId: null }, { ...mounted(), transportationId: null }]) {
    const result = projectBattleFieldState(catalog, field, transportations);
    assert.equal(result.invalidContentIds, null);
    assert.equal(result.blockers.length, 1);
  }
  assert.throws(() => projectBattleFieldState(catalog, mounted(), []), /transportation/);
  assert.throws(() => projectBattleFieldState(catalog, mounted(), [...transportations, { id: 6, type: 1 }]), /ambiguous/);
});

test("a walking field with unresolved beast controller remains unknown until actual terrain or controller evidence resolves it", () => {
  const { catalog } = battleEntryFixture();
  const field = { ...mounted(), transportationId: 1, isSavePoint: false };
  assert.equal(projectBattleFieldState(catalog, field, transportations).invalidContentIds, null);
  assert.deepEqual(projectBattleFieldState(catalog, { ...field, footAttributeType: 1 }, transportations).invalidContentIds,
    [10001, 10005]);
  assert.deepEqual(projectBattleFieldState(catalog, { ...field, beastFieldController: true, footAttributeType: 31 }, transportations).invalidContentIds,
    [10001]);
});
