import test from "node:test";
import assert from "node:assert/strict";
import { BattleConditions, type BattleConditionCatalog } from "../src/core/battle-conditions.js";
import { projectOwnedConditionRemoveLife } from "../src/core/owned-condition.js";
import { compileOwnedConditionInstruction } from "../src/compiler/owned-condition.js";
import { fixtureParty } from "./fixtures/party.js";

const catalog = (aliasActive = false): BattleConditionCatalog => ({
  hpZeroConditionId: 5, dying: { conditionId: 4, thresholdDivisor: 8 },
  rules: { definitions: [[4, 4], [5, 5], [6, 6], [100, 5]].map(([id, type]) =>
    ({ id: id!, type: type!, overlapped: false, eraseGroupId: 1 })),
    eraseRules: [{ id: 1, groupId: 1, conditionId: 0, type: 2, eraseConditionId: 0 }] },
  behaviors: [{ id: 4, kind: "dying", name: "Dying", untilType: 3 },
    { id: 5, kind: "unable-fight", name: "Death", untilType: 3 },
    { id: 6, kind: "silence", name: "Silence", untilType: 2 },
    ...(aliasActive ? [{ id: 100, kind: "unable-fight" as const, name: "Synthetic resolved alias", untilType: 3 as const }] : [])],
});
const roster = () => [
  { id: "first", ownedId: 90, sourceId: 12, enabled: false, hp: 0, maxHp: 80, conditionIds: [5, 5, 6], mp: 9 },
  { id: "second", ownedId: 3, sourceId: 31, enabled: true, hp: 70, maxHp: 80, conditionIds: [], mp: 7 },
];
const command = (type = 5, target = 0) => ({ kind: "remove-condition" as const, conditionType: type, target });
function project(input = roster(), type = 5, target = 0, source = catalog()) {
  return projectOwnedConditionRemoveLife(input, fixtureParty(["second", "first"]), command(type, target),
    source.rules.definitions, new BattleConditions(source));
}

test("nonzero death removal deletes all matching rows before one HP helper and one refresh per current Corps owner", () => {
  const input = roster(), before = structuredClone(input), source = catalog(true);
  input[0]!.conditionIds = [5, 100, 5, 6];
  const result = project(input, 5, 0, source);
  assert.equal(result.roster[0]!.hp, 1); assert.deepEqual(result.roster[0]!.conditionIds, [6, 4]);
  assert.deepEqual(result.targets, ["second", "first"]);
  assert.deepEqual(result.steps.map(s => [s.targetId, s.roster[0]!.hp]), [["second", 0], ["first", 1]]);
  assert.deepEqual(result.roster.map(m => [m.ownedId, m.sourceId, m.enabled, m.mp]),
    before.map(m => [m.ownedId, m.sourceId, m.enabled, m.mp]));
  assert.deepEqual(input[0]!.conditionIds, [5, 100, 5, 6]);
  assert.equal(Object.hasOwn(result, "coreI0Writes"), false);
});

test("all matching master permutations preserve unrelated list order and never repeat recovery", () => {
  const input = roster(), source = catalog(true); input[0]!.conditionIds = [6, 100, 5, 100];
  const one = project(input, 5, 0, source); source.rules.definitions.reverse();
  const two = project(input, 5, 0, source);
  assert.deepEqual(two, one); assert.equal(two.roster[0]!.hp, 1);
  const again = project(two.roster, 5, 0, source);
  assert.deepEqual(again.roster, two.roster); assert.equal(again.steps.length, 2);
});

test("type4 removes the stored dying row without changing HP; no present row still has an ordered refresh", () => {
  const input = roster(); input[0]!.hp = 1; input[0]!.conditionIds = [6, 4, 4];
  const result = project(input, 4);
  assert.equal(result.roster[0]!.hp, 1); assert.deepEqual(result.roster[0]!.conditionIds, [6]);
  assert.deepEqual(result.roster[1], input[1]); assert.equal(result.steps.length, 2);
  assert.deepEqual(project(result.roster, 4).roster, result.roster);
  const tiny = roster(); tiny[0]!.maxHp = 1;
  assert.equal(project(tiny).roster[0]!.hp, 1);
});

test("identity-only master dependencies never authorize unknown active100 or sanitize invalid owned state", () => {
  const input = roster(); input[0]!.conditionIds = [100];
  assert.throws(() => project(input), /Unimplemented active battle condition: 100/);
  input[0]!.conditionIds = [999]; assert.throws(() => project(input), /Unknown owned condition/);
  input[0]!.conditionIds = [5]; input[0]!.hp = 20; assert.throws(() => project(input), /HP\/death/);
  const source = catalog(); source.rules.definitions.push(structuredClone(source.rules.definitions[0]!));
  assert.throws(() => project(roster(), 5, 0, source), /Duplicate|Invalid/);
});

test("empty targets keep provider validation and positive selectors keep actual source identity", () => {
  const input = roster(), source = catalog(), rules = new BattleConditions(source);
  const empty = projectOwnedConditionRemoveLife(input, fixtureParty([]), command(), source.rules.definitions, rules);
  assert.deepEqual(empty.targets, []); assert.deepEqual(empty.steps, []); assert.deepEqual(empty.roster, input);
  assert.deepEqual(project(input, 5, 12).targets, ["first"]);
  assert.deepEqual(project(input, 5, -1).targets, ["second"]);
  assert.throws(() => project(input, 5, 90), /source selector|status selector/);
  assert.throws(() => projectOwnedConditionRemoveLife(input, fixtureParty([]), command(), [], rules), /Missing owned condition/);
});

const raw = (type = 5) => ({ type: 1, mnemonic: "RemoveCondition", operands: {
  iValues: [type, 0, 0, 0, 0, 0, 0, 0], rValues: Array(8).fill(0), sValues: Array(8).fill("") } });
test("source decoder retains every matching master dependency, full operand gates and all other family gates", () => {
  const tables = { "condition.csv": [{ id: "4", condition_type: "4" }, { id: "5", condition_type: "5" },
    { id: "100", condition_type: "5" }] };
  assert.deepEqual(compileOwnedConditionInstruction(raw(), tables).dependencies,
    [{ table: "condition.csv", id: 5 }, { table: "condition.csv", id: 100 }]);
  assert.deepEqual(compileOwnedConditionInstruction(raw(4), tables).dependencies, [{ table: "condition.csv", id: 4 }]);
  for (const type of [607, 665, 666, 7]) assert.throws(() => compileOwnedConditionInstruction(raw(type), tables));
  const add = raw(); add.mnemonic = "AddCondition"; assert.throws(() => compileOwnedConditionInstruction(add, tables), /Unimplemented/);
  const spare = raw(); spare.operands.iValues[2] = 1; assert.throws(() => compileOwnedConditionInstruction(spare, tables), /shape/);
  const duplicate = structuredClone(tables); duplicate["condition.csv"].push({ id: "4", condition_type: "5" });
  assert.throws(() => compileOwnedConditionInstruction(raw(), duplicate), /Ambiguous/);
});
