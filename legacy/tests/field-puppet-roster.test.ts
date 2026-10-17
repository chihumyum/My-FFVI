import assert from "node:assert/strict";
import test from "node:test";
import { projectFieldPuppetRoster } from "../src/core/field-puppet-roster.js";
import { emptyPartyState } from "../src/core/party.js";
import { magitekRowId, ownedConditionGameFixture } from "./fixtures/owned-condition.js";

const add = { kind: "add-condition" as const, conditionType: 607, target: 0 };

test("source puppet roster keeps complete owned identities and four ordered Corps cells", () => {
  const roster = [
    { id: "web:one", ownedId: 71, sourceId: 5, enabled: false, conditionIds: [9007] },
    { id: "web:two", ownedId: 32, sourceId: 18, enabled: true, conditionIds: [] },
    { id: "outside", ownedId: 84, sourceId: 20, enabled: true, conditionIds: [110, 9090] },
  ];
  const party = emptyPartyState();
  party.selectedSlot = 2;
  party.slots[2] = [{ id: null, row: "back" }, { id: "web:two", row: "front" },
    { id: "web:one", row: "back" }, { id: null, row: "front" }];
  const definitions = [{ id: 9007, type: 607 }, { id: 110, type: 0 }, { id: 9090, type: 607 }];
  const before = structuredClone({ roster, party, definitions });
  const result = projectFieldPuppetRoster(roster, party, definitions);
  assert.deepEqual(result, { owned: [
    { ownedId: 71, sourceId: 5, enabled: false, conditionTypes: [607] },
    { ownedId: 32, sourceId: 18, enabled: true, conditionTypes: [] },
    { ownedId: 84, sourceId: 20, enabled: true, conditionTypes: [0, 607] },
  ], party: [0, 32, 71, 0] });
  result.owned[0]!.conditionTypes.push(999); result.party[0] = 999;
  assert.deepEqual({ roster, party, definitions }, before);
});

test("condition identities require an exact full-catalog lookup instead of falling back to type or row", () => {
  const roster = [{ id: "owner", ownedId: 1, sourceId: 2, enabled: true, conditionIds: [9007] }];
  const party = emptyPartyState();
  for (const definitions of [[], [{ id: 607, type: 607 }],
    [{ id: 9007, type: 607 }, { id: 9007, type: 607 }]])
    assert.throws(() => projectFieldPuppetRoster(roster, party, definitions));
  assert.throws(() => projectFieldPuppetRoster([...roster, { ...roster[0]!, id: "other", sourceId: 3 }],
    party, [{ id: 9007, type: 607 }]), /owned identity/);
  assert.throws(() => projectFieldPuppetRoster([{ ...roster[0]!, conditionIds: [9007, 9007] }],
    party, [{ id: 9007, type: 607 }]), /condition list/);
  party.slots[0][1].id = "not-owned";
  assert.throws(() => projectFieldPuppetRoster(roster, party, [{ id: 9007, type: 607 }]), /unowned/);
});

test("GameState puppet read includes disabled and outside members and returns detached arrays", () => {
  const { state } = ownedConditionGameFixture(), saved = state.snapshot();
  saved.roster[0]!.enabled = false;
  saved.roster[1]!.conditionIds = [magitekRowId];
  saved.party = emptyPartyState();
  saved.party.slots[0][2].id = "a";
  state.restore(saved);
  const result = state.fieldPuppetRoster.current();
  assert.deepEqual(result, { owned: [
    { ownedId: saved.roster[0]!.ownedId, sourceId: 1, enabled: false, conditionTypes: [] },
    { ownedId: saved.roster[1]!.ownedId, sourceId: 2, enabled: true, conditionTypes: [607] },
  ], party: [0, 0, saved.roster[0]!.ownedId, 0] });
  result.owned.splice(0); result.party.fill(0);
  assert.deepEqual(state.snapshot(), saved);
  assert.equal(state.fieldPuppetRoster.current().owned.length, 2);
});

test("candidate puppet roster follows the same party and condition draft before one publication", () => {
  const { state } = ownedConditionGameFixture(), before = state.snapshot();
  const live = state.fieldPuppetRoster, draft = state.prepareFieldState();
  draft.ports.party.prepare({ kind: "organize-slot", slot: 1, members: [null, 2, null, 1], refreshActors: true }).commit();
  draft.ports.party.prepare({ kind: "select-slot", slot: 1, refreshActors: false }).commit();
  draft.ports.ownedConditions.prepare(add).commit();
  assert.deepEqual(draft.ports.puppetRoster.current(), { owned: [
    { ownedId: before.roster[0]!.ownedId, sourceId: 1, enabled: true, conditionTypes: [607] },
    { ownedId: before.roster[1]!.ownedId, sourceId: 2, enabled: true, conditionTypes: [607] },
  ], party: [0, before.roster[1]!.ownedId, 0, before.roster[0]!.ownedId] });
  assert.deepEqual(state.snapshot(), before);
  assert.ok(live.current().owned.every((member) => member.conditionTypes.length === 0));
  assert.equal(draft.commit(), true);
  assert.deepEqual(draft.ports.puppetRoster.current(), live.current());
  state.fieldOwnedConditions.prepare({ ...add, kind: "remove-condition" }).commit();
  state.fieldParty.prepare({ kind: "select-slot", slot: 2, refreshActors: false }).commit();
  assert.deepEqual(draft.ports.puppetRoster.current().party, [0, 0, 0, 0]);
  assert.ok(draft.ports.puppetRoster.current().owned.every((member) => member.conditionTypes.length === 0));
  assert.deepEqual(draft.ports.puppetRoster.current(), live.current(), "published port reads current owner, not its old draft");
});

test("discarded and stale puppet candidates do not leak owners or conditions into the live getter", () => {
  const { state } = ownedConditionGameFixture(), draft = state.prepareFieldState();
  draft.ports.ownedConditions.prepare(add).commit();
  state.fieldInventory.prepare({ kind: "grant-gil", amount: 1 }).commit();
  const changed = state.snapshot();
  assert.equal(draft.commit(), false);
  assert.ok(state.fieldPuppetRoster.current().owned.every((member) => member.conditionTypes.length === 0));
  assert.deepEqual(state.snapshot(), changed);
  const recovered = structuredClone(changed);
  recovered.party = emptyPartyState(); recovered.party.selectedSlot = 2;
  recovered.party.slots[2][3].id = "b";
  recovered.roster[1]!.conditionIds = [magitekRowId];
  const live = state.fieldPuppetRoster;
  state.restore(recovered);
  assert.deepEqual(live.current().party, [0, 0, 0, recovered.roster[1]!.ownedId]);
  assert.deepEqual(live.current().owned[1]!.conditionTypes, [607]);
});
