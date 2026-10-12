import test from "node:test";
import assert from "node:assert/strict";
import { ownedConditionTargets, projectOwnedCondition, executeOwnedConditionEvent,
  type OwnedConditionCommand, type OwnedConditionMember, type OwnedConditionEventOp } from "../src/core/owned-condition.js";
import { compileOwnedConditionInstruction } from "../src/compiler/owned-condition.js";
import { fixtureParty } from "./fixtures/party.js";
import { magitekMasterRow, magitekRowId, ownedConditionGameFixture } from "./fixtures/owned-condition.js";

const definitions = [{ id: magitekRowId, type: 607 }, { id: 304, type: 4 }];
const roster = (): OwnedConditionMember[] => [
  { id: "current-disabled", ownedId: 1, sourceId: 12, enabled: false, conditionIds: [304] },
  { id: "outside-enabled", ownedId: 2, sourceId: 3, enabled: true, conditionIds: [] },
  { id: "current-enabled", ownedId: 3, sourceId: 31, enabled: true, conditionIds: [] },
];
const party = () => fixtureParty(["current-enabled", "current-disabled"]);
const command = (kind: OwnedConditionCommand["kind"] = "add-condition", target = 0): OwnedConditionCommand =>
  ({ kind, conditionType: 607, target });
const event = (value = command()): OwnedConditionEventOp => ({ kind: "owned-condition", command: value, dependencies: [] });

test("current Corps, enabled roster and source selector retain different owner sets and order", () => {
  assert.deepEqual(ownedConditionTargets(roster(), party(), 0), ["current-enabled", "current-disabled"]);
  assert.deepEqual(ownedConditionTargets(roster(), party(), -1), ["outside-enabled", "current-enabled"]);
  assert.deepEqual(ownedConditionTargets(roster(), party(), 12), ["current-disabled"]);
  assert.throws(() => ownedConditionTargets(roster(), party(), 1), /Unknown owned character status/);
  assert.throws(() => ownedConditionTargets(roster(), party(), 4), /Unknown owned character status/);
});

test("type-to-master add preserves existing statuses and supplies every ordered refresh snapshot", () => {
  const input = roster(), before = structuredClone(input);
  const result = projectOwnedCondition(input, party(), command(), definitions);
  assert.deepEqual(result.roster.map((m) => m.conditionIds), [[304, magitekRowId], [], [magitekRowId]]);
  assert.deepEqual(result.steps.map((s) => s.roster.map((m) => m.conditionIds)), [
    [[304], [], [magitekRowId]], [[304, magitekRowId], [], [magitekRowId]],
  ]);
  result.steps[0]!.roster[0]!.conditionIds.push(123);
  assert.deepEqual(result.roster[0]!.conditionIds, [304, magitekRowId]);
  assert.deepEqual(input, before);
});

test("duplicate add and absent remove still refresh, and duplicateRemove clears all matching rows", () => {
  const input = roster();
  input[0]!.conditionIds.push(magitekRowId, magitekRowId);
  const added = projectOwnedCondition(input, party(), command("add-condition", 12), definitions);
  assert.deepEqual(added.roster[0]!.conditionIds, [304, magitekRowId, magitekRowId]);
  assert.equal(added.steps.length, 1);
  const removed = projectOwnedCondition(input, party(), command("remove-condition", 12), definitions);
  assert.deepEqual(removed.roster[0]!.conditionIds, [304]);
  const absent = projectOwnedCondition(removed.roster, party(), command("remove-condition", 12), definitions);
  assert.deepEqual(absent.roster, removed.roster);
  assert.equal(absent.steps.length, 1);
  assert.deepEqual(projectOwnedCondition(input, fixtureParty([]), command(), definitions).steps, []);
});

test("unsupported condition families, unresolved row order and malformed ownership fail before mutation", () => {
  const input = roster(), before = structuredClone(input);
  for (const conditionType of [0, 4, 5, 6, 10, 53, 676])
    assert.throws(() => projectOwnedCondition(input, party(), { ...command(), conditionType }, definitions), /Unimplemented/);
  assert.throws(() => projectOwnedCondition(input, party(), command(), []), /Missing/);
  assert.throws(() => projectOwnedCondition(input, party(), command(), [...definitions, { id: 9008, type: 607 }]), /ambiguous/);
  assert.throws(() => projectOwnedCondition(input, party(), command("add-condition", -2), definitions), /selector/);
  const corrupt = roster(); corrupt[1]!.conditionIds = [999];
  assert.throws(() => projectOwnedCondition(corrupt, party(), command(), definitions), /Unknown owned condition/);
  corrupt[1]!.conditionIds = []; corrupt[1]!.ownedId = 1;
  assert.throws(() => projectOwnedCondition(corrupt, party(), command(), definitions), /identity/);
  assert.deepEqual(input, before);
});

test("complete actor preparation precedes owned publication and cannot partially publish on failure", () => {
  const { state } = ownedConditionGameFixture(), before = state.snapshot();
  assert.throws(() => executeOwnedConditionEvent(event(), state.fieldOwnedConditions), /refresh is unavailable/);
  assert.throws(() => executeOwnedConditionEvent(event(), state.fieldOwnedConditions, (steps) => {
    assert.equal(steps.length, 2);
    assert.deepEqual(state.snapshot(), before);
    throw new Error("second actor media unavailable");
  }), /second actor/);
  assert.deepEqual(state.snapshot(), before);
  let publications = 0;
  executeOwnedConditionEvent(event(), state.fieldOwnedConditions, (steps) => {
    assert.deepEqual(steps.map((step) => [step.setDummy, step.affectLeader]), [[false, true], [false, true]]);
    assert.deepEqual(state.snapshot(), before);
    return () => { publications++; assert.deepEqual(state.snapshot().roster.map((p) => p.conditionIds), [[magitekRowId], [magitekRowId]]); };
  });
  assert.equal(publications, 1);
});

test("a stale owned transaction never publishes a prepared renderer", () => {
  const { state } = ownedConditionGameFixture();
  let published = false;
  assert.throws(() => executeOwnedConditionEvent(event(), state.fieldOwnedConditions, () => {
    state.fieldInventory.prepare({ kind: "grant-gil", amount: 1 }).commit();
    return () => { published = true; };
  }), /Stale/);
  assert.equal(published, false);
  assert.deepEqual(state.snapshot().roster.map((p) => p.conditionIds), [[], []]);
});

test("a rejected appearance preflight cannot publish the condition into the real owner", () => {
  const { state } = ownedConditionGameFixture(), before = state.snapshot();
  let published = false;
  const publication = Object.assign(() => { published = true; }, {
    validate: () => { throw new Error("Appearance actors changed during preparation"); },
  });
  assert.throws(() => executeOwnedConditionEvent(event(), state.fieldOwnedConditions,
    () => publication), /actors changed/);
  assert.equal(published, false);
  assert.deepEqual(state.snapshot(), before);
});

const raw = (mnemonic = "AddCondition", type = 607, target = 0) => ({ type: 1, mnemonic,
  operands: { iValues: [type, target, 0, 0, 0, 0, 0, 0], rValues: Array(8).fill(0), sValues: Array(8).fill("") } });
const tables = () => ({ "condition.csv": [magitekMasterRow()], "character_status.csv": [{ id: "12" }] });
test("decoder binds source row identity and positive source selectors without inventing owned IDs", () => {
  const compiled = compileOwnedConditionInstruction(raw("AddCondition", 607, 12), tables());
  assert.deepEqual(compiled, { kind: "owned-condition", command: command("add-condition", 12), dependencies: [
    { table: "condition.csv", id: magitekRowId }, { table: "character_status.csv", id: 12 },
  ] });
  for (const target of [0, -1]) assert.equal(compileOwnedConditionInstruction(raw("RemoveCondition", 607, target), tables()).dependencies.length, 1);
  assert.throws(() => compileOwnedConditionInstruction(raw("RemoveCondition", 0), tables()), /Unimplemented/);
  assert.throws(() => compileOwnedConditionInstruction(raw("AddCondition", 607, 11), tables()), /source reference/);
});

test("decoder refuses special parameters and changed Magitek provider rows", () => {
  for (const key of ["damage_number", "field_se_asset_id", "condition_group_id", "icon_id", "until_value"]) {
    const source = tables(); source["condition.csv"][0]![key] = "1";
    assert.throws(() => compileOwnedConditionInstruction(raw(), source), /provider/);
  }
  const extra = raw(); extra.operands.iValues[2] = 1;
  assert.throws(() => compileOwnedConditionInstruction(extra, tables()), /operand shape/);
  const duplicate = tables(); duplicate["condition.csv"].push(magitekMasterRow());
  assert.throws(() => compileOwnedConditionInstruction(raw(), duplicate), /provider/);
});
