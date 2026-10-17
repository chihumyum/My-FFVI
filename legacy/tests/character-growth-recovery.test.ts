import assert from "node:assert/strict";
import test from "node:test";
import { BattleConditions, type BattleConditionCatalog } from "../src/core/battle-conditions.js";
import { recoverJoinedCharacter } from "../src/core/character-recovery.js";

function conditions() {
  const definitions = [
    { id: 305, type: 5 }, { id: 306, type: 6 }, { id: 304, type: 4 },
    { id: 310, type: 10 }, { id: 999, type: 99 },
  ].map((d) => ({ ...d, overlapped: false, eraseGroupId: 1 }));
  const catalog: BattleConditionCatalog = {
    rules: { definitions, eraseRules: [{ id: 1, groupId: 1, type: 2, conditionId: 0, eraseConditionId: 0 }] },
    hpZeroConditionId: 305, dying: { conditionId: 304, thresholdDivisor: 8 },
    behaviors: [
      { id: 305, kind: "unable-fight", untilType: 3, name: "dead" },
      { id: 306, kind: "silence", untilType: 2, name: "silenced" },
      { id: 304, kind: "dying", untilType: 3, name: "dying" },
      { id: 310, kind: "poison", untilType: 3, name: "poisoned", hpDivisor: 16 },
    ],
  };
  return new BattleConditions(catalog);
}
test("join recovery heals a dead character before clearing its death identity", () => {
  const before = { id: "owner", hp: 0, mp: 2, maxHp: 137, maxMp: 19, conditionIds: [305] };
  const result = recoverJoinedCharacter(before, conditions());
  assert.deepEqual(result, { ...before, hp: 137, mp: 19, conditionIds: [] });
  assert.deepEqual(before.conditionIds, [305]);
  assert.equal(before.hp, 0);
});
test("null-interpreter join removes all current copies irrespective of condition type", () => {
  const before = { hp: 1, mp: 0, maxHp: 100, maxMp: 0, conditionIds: [306,304,310,306,304,305] };
  assert.deepEqual(recoverJoinedCharacter(before, conditions()), { ...before, hp: 100, conditionIds: [] });
});
test("join recovery preserves identity, growth and equipment data in an independent candidate", () => {
  const before = { hp: 8, mp: 0, maxHp: 64, maxMp: 11, conditionIds: [],
    sourceId: 2, equipment: [1,2,3], growth: { additionalExp: 7 }, enabled: false };
  const result = recoverJoinedCharacter(before, conditions());
  assert.equal(result.enabled, false);
  assert.deepEqual(result.growth, before.growth);
  result.equipment.push(4);
  assert.deepEqual(before.equipment, [1,2,3]);
  assert.equal(result.hp, 64);
  assert.equal(result.mp, 11);
});
test("unknown condition mechanics and invalid resources reject the whole recovery", () => {
  const before = { hp: 1, mp: 0, maxHp: 64, maxMp: 11, conditionIds: [999] };
  const snapshot = structuredClone(before);
  assert.throws(() => recoverJoinedCharacter(before, conditions()), /Unimplemented active/);
  assert.deepEqual(before, snapshot);
  assert.throws(() => recoverJoinedCharacter({ ...before, conditionIds: [555] }, conditions()), /Unknown/);
  assert.throws(() => recoverJoinedCharacter({ ...before, hp: 65, conditionIds: [] }, conditions()), /exceeds/);
  assert.throws(() => recoverJoinedCharacter({ ...before, maxHp: 0, conditionIds: [] }, conditions()), /resource/);
});
