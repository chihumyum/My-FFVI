import test from "node:test";
import assert from "node:assert/strict";
import { BattleConditions, type BattleConditionCatalog } from "../src/core/battle-conditions.js";
import { projectOwnedConditionRemoveAll, executeOwnedConditionEvent,
  type OwnedConditionResourceMember } from "../src/core/owned-condition.js";
import { compileOwnedConditionInstruction } from "../src/compiler/owned-condition.js";
import { fixtureParty } from "./fixtures/party.js";
import { magitekMasterRow } from "./fixtures/owned-condition.js";

const catalog = (): BattleConditionCatalog => ({ hpZeroConditionId: 5, dying: { conditionId: 4, thresholdDivisor: 8 },
  rules: { definitions: [[4, 4], [5, 5], [6, 6], [53, 607], [79, 665], [80, 666], [9007, 607], [9008, 665], [100, 5]]
    .map(([id, type]) => ({ id: id!, type: type!, overlapped: false, eraseGroupId: 1 })),
    eraseRules: [{ id: 1, groupId: 1, conditionId: 0, type: 2, eraseConditionId: 0 }] },
  behaviors: [{ id: 4, kind: "dying", name: "Synthetic dying", untilType: 3 },
    { id: 5, kind: "unable-fight", name: "Synthetic death", untilType: 3 },
    { id: 6, kind: "silence", name: "Synthetic silence", untilType: 2 },
    { id: 53, kind: "magitek", name: "", untilType: 3 },
    { id: 9007, kind: "magitek", name: "", untilType: 3 }],
});
const command = (target = 0) => ({ kind: "remove-condition" as const, conditionType: 0, target });
const roster = (): (OwnedConditionResourceMember & { mp: number; gear: number[] })[] => [
  { id: "disabled-current", ownedId: 41, sourceId: 12, enabled: false, hp: 20, maxHp: 80, mp: 4, conditionIds: [], gear: [2] },
  { id: "enabled-reserve", ownedId: 2, sourceId: 3, enabled: true, hp: 40, maxHp: 80, mp: 8, conditionIds: [], gear: [3] },
  { id: "enabled-current", ownedId: 77, sourceId: 31, enabled: true, hp: 70, maxHp: 80, mp: 17, conditionIds: [], gear: [5] },
];
const party = () => fixtureParty(["enabled-current", "disabled-current"]);

test("exact retained row IDs survive; same-type aliases do not acquire retention or active behavior", () => {
  const input = roster(), rules = new BattleConditions(catalog());
  input[0]!.conditionIds = [6, 79, 9007, 53, 9008, 80];
  const before = structuredClone(input), result = projectOwnedConditionRemoveAll(input, party(), command(12), rules);
  assert.deepEqual(result.roster[0]!.conditionIds, [79, 53, 80]);
  assert.deepEqual(result.coreI0Writes, [6, 79, 9007, 53, 9008, 80]);
  assert.deepEqual(result.roster[0]!.gear, [2]); assert.equal(result.roster[0]!.mp, 4);
  assert.deepEqual(input, before);
  // Identity-only preservation is not authorization of their active behavior.
  assert.throws(() => rules.validateActive([79]), /Unimplemented active/);
  assert.throws(() => rules.validateActive([80]), /Unimplemented active/);
});

test("type0 iterates the original list, deletes duplicates together, and adds HP per original death record", () => {
  class Observed extends BattleConditions {
    calls: { hp: number; ids: number[] }[] = [];
    override updateDying(hp: number, maxHp: number, ids: readonly number[]): number[] {
      this.calls.push({ hp, ids: [...ids] }); return super.updateDying(hp, maxHp, ids);
    }
  }
  const rules = new Observed(catalog()), input = roster();
  input[0]!.hp = 0; input[0]!.conditionIds = [5, 5, 6];
  const result = projectOwnedConditionRemoveAll(input, party(), command(12), rules);
  assert.equal(result.roster[0]!.hp, 2); assert.deepEqual(result.roster[0]!.conditionIds, [4]);
  assert.deepEqual(result.coreI0Writes, [5, 5, 6]);
  assert.deepEqual(rules.calls, [{ hp: 1, ids: [6] }, { hp: 2, ids: [6, 4] }]);
  assert.equal(result.steps.length, 1, "one target refresh, not one refresh per copied condition");
});

test("later original conditions can remove a condition recreated by the HP setter, so order is observable", () => {
  const input = roster(), rules = new BattleConditions(catalog()); input[0]!.hp = 0;
  // This is a deliberately synthetic list-order counterexample, not a claim
  // that this source game's death conflict admits both rows simultaneously.
  input[0]!.conditionIds = [5, 4];
  assert.deepEqual(projectOwnedConditionRemoveAll(input, party(), command(12), rules).roster[0]!.conditionIds, []);
  input[0]!.conditionIds = [4, 5];
  assert.deepEqual(projectOwnedConditionRemoveAll(input, party(), command(12), rules).roster[0]!.conditionIds, [4]);
});

test("current Corps, enabled roster and source status targets retain exact source ordering and empty refreshes", () => {
  const input = roster(), rules = new BattleConditions(catalog());
  input[0]!.conditionIds = [6]; input[1]!.conditionIds = [53];
  for (const [target, expected, writes] of [[0, ["enabled-current", "disabled-current"], [6]],
    [-1, ["enabled-reserve", "enabled-current"], [53]], [12, ["disabled-current"], [6]]] as const) {
    const result = projectOwnedConditionRemoveAll(input, party(), command(target), rules);
    assert.deepEqual(result.targets, expected); assert.deepEqual(result.steps.map(s => s.targetId), expected);
    assert.deepEqual(result.coreI0Writes, writes);
    assert.deepEqual(result.roster.map(m => [m.ownedId, m.sourceId, m.enabled, m.mp, m.gear]),
      input.map(m => [m.ownedId, m.sourceId, m.enabled, m.mp, m.gear]));
  }
  const empty = projectOwnedConditionRemoveAll(input, fixtureParty([]), command(), rules);
  assert.deepEqual(empty.targets, []); assert.deepEqual(empty.steps, []); assert.deepEqual(empty.coreI0Writes, []);
  assert.throws(() => projectOwnedConditionRemoveAll(input, party(), command(41), rules), /source selector|status selector/);
});

const raw = (type = 0, target = 0) => ({ type: 1, mnemonic: "RemoveCondition", operands: {
  iValues: [type, target, 0, 0, 0, 0, 0, 0], rValues: Array(8).fill(0), sValues: Array(8).fill("") } });
const tables = () => ({ "condition.csv": [{ ...magitekMasterRow(), id: "53" },
  { id: "79", condition_type: "665" }, { id: "80", condition_type: "666" }], "character_status.csv": [{ id: "12" }] });
test("decoder admits only full source type0 shape and exact native row identities, leaving explicit 665/666 blocked", () => {
  assert.deepEqual(compileOwnedConditionInstruction(raw(0, 12), tables()).dependencies, [
    { table: "condition.csv", id: 53 }, { table: "condition.csv", id: 79 }, { table: "condition.csv", id: 80 },
    { table: "character_status.csv", id: 12 },
  ]);
  for (const type of [665, 666]) assert.throws(() => compileOwnedConditionInstruction(raw(type), tables()), /Unimplemented/);
  const add = raw(); add.mnemonic = "AddCondition";
  assert.throws(() => compileOwnedConditionInstruction(add, tables()), /Unimplemented/);
  for (const mutate of [(r: ReturnType<typeof raw>) => r.type = 2,
    (r: ReturnType<typeof raw>) => r.operands.iValues[2] = 1,
    (r: ReturnType<typeof raw>) => r.operands.rValues[7] = .1,
    (r: ReturnType<typeof raw>) => r.operands.sValues[0] = "unknown"]) {
    const value = raw(); mutate(value); assert.throws(() => compileOwnedConditionInstruction(value, tables()));
  }
  const wrong = tables(); wrong["condition.csv"][1]!.condition_type = "607";
  assert.throws(() => compileOwnedConditionInstruction(raw(), wrong), /retained/);
});

test("missing MainCore is not permission to execute only the owned half of the source instruction", () => {
  let prepared = false;
  assert.throws(() => executeOwnedConditionEvent({ kind: "owned-condition", command: command(), dependencies: [] },
    { prepare: () => { prepared = true; throw new Error("must not call"); } }), /same MainCore/);
  assert.equal(prepared, false);
});
