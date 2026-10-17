import test from "node:test";
import assert from "node:assert/strict";
import { BattleConditions, type BattleConditionCatalog } from "../src/core/battle-conditions.js";
import { executeFieldRecoveryEvent, fieldRecoveryEligible, projectFieldRecovery, validateFieldRecoveryCommand,
  type FieldRecoveryCommand, type FieldRecoveryEventOp, type FieldRecoveryMember,
  type FieldRecoveryPort } from "../src/core/field-recovery.js";
import type { OwnedConditionAppearanceStep } from "../src/core/owned-condition.js";
import { fixtureParty } from "./fixtures/party.js";

// Synthetic master IDs deliberately differ from ConditionType and from native
// row 5. A second admitted death is a test provider, never admission of row 100.
const dying = 704, death = 705, otherDeath = 1705, silence = 706, magitek = 7607;
const catalog = (): BattleConditionCatalog => ({
  hpZeroConditionId: death,
  dying: { conditionId: dying, thresholdDivisor: 8 },
  rules: {
    definitions: [
      { id: dying, type: 4, overlapped: false, eraseGroupId: 1 },
      { id: death, type: 5, overlapped: false, eraseGroupId: 1 },
      { id: otherDeath, type: 5, overlapped: false, eraseGroupId: 1 },
      { id: silence, type: 6, overlapped: false, eraseGroupId: 1 },
      { id: magitek, type: 607, overlapped: false, eraseGroupId: 1 },
      { id: 11, type: 11, overlapped: false, eraseGroupId: 1 },
      { id: 100, type: 5, overlapped: false, eraseGroupId: 1 },
    ],
    eraseRules: [{ id: 1, groupId: 1, conditionId: 0, type: 2, eraseConditionId: 0 }],
  },
  behaviors: [
    { id: dying, kind: "dying", name: "Synthetic dying", untilType: 3 },
    { id: death, kind: "unable-fight", name: "Synthetic death", untilType: 3 },
    { id: otherDeath, kind: "unable-fight", name: "Synthetic alternate death", untilType: 3 },
    { id: silence, kind: "silence", name: "Synthetic silence", untilType: 2 },
    { id: magitek, kind: "magitek", name: "", untilType: 3 },
  ],
});
const conditions = () => new BattleConditions(catalog());
type Member = FieldRecoveryMember & { gear: { slots: number[] } };
const roster = (): Member[] => [
  { id: "current-disabled", ownedId: 41, sourceId: 12, enabled: false,
    hp: 20, mp: 4, maxHp: 80, maxMp: 20, conditionIds: [], gear: { slots: [1, 2] } },
  { id: "outside-enabled", ownedId: 2, sourceId: 3, enabled: true,
    hp: 40, mp: 8, maxHp: 80, maxMp: 20, conditionIds: [], gear: { slots: [3, 4] } },
  { id: "current-enabled", ownedId: 77, sourceId: 31, enabled: true,
    hp: 70, mp: 17, maxHp: 80, maxMp: 20, conditionIds: [], gear: { slots: [5, 6] } },
];
const party = () => fixtureParty(["current-enabled", "current-disabled"]);
const command = (changes: Partial<FieldRecoveryCommand> = {}): FieldRecoveryCommand => ({
  kind: "recover-hp", amount: 3, target: 0, allowUnableFight: false, allowMineralization: false, ...changes,
});
const event = (changes: Partial<FieldRecoveryCommand> = {}): FieldRecoveryEventOp => ({
  kind: "field-recovery", command: command(changes), dependencies: [],
});

test("recovery uses current Corps order, enabled roster order, or exact source status identity", () => {
  const input = roster();
  for (const [target, expected] of [
    [0, ["current-enabled", "current-disabled"]],
    [-1, ["outside-enabled", "current-enabled"]],
    [12, ["current-disabled"]],
  ] as const) {
    const result = projectFieldRecovery(input, party(), command({ target }), conditions());
    assert.deepEqual(result.targets, expected);
    assert.deepEqual(result.roster.map((m) => m.hp), input.map((m) => m.hp + (expected.some((id) => id === m.id) ? 3 : 0)));
    assert.deepEqual(result.roster.map((m) => [m.ownedId, m.sourceId, m.enabled]), input.map((m) => [m.ownedId, m.sourceId, m.enabled]));
  }
  for (const target of [41, 77, 9999])
    assert.throws(() => projectFieldRecovery(input, party(), command({ target }), conditions()), /Unknown owned character status/);
});

test("positive and negative amounts add their magnitude; zero uses the selected maximum as increment", () => {
  const input = roster();
  for (const kind of ["recover-hp", "recover-mp"] as const) {
    const plus = projectFieldRecovery(input, party(), command({ kind, target: 12, amount: 7 }), conditions());
    const minus = projectFieldRecovery(input, party(), command({ kind, target: 12, amount: -7 }), conditions());
    assert.deepEqual(plus, minus);
    assert.equal(plus.roster[0]![kind === "recover-hp" ? "hp" : "mp"], kind === "recover-hp" ? 27 : 11);
    const full = projectFieldRecovery(input, party(), command({ kind, target: 12, amount: 0 }), conditions());
    assert.equal(full.roster[0]![kind === "recover-hp" ? "hp" : "mp"], kind === "recover-hp" ? 80 : 20);
    assert.equal(full.roster[0]![kind === "recover-hp" ? "mp" : "hp"], kind === "recover-hp" ? 4 : 20);
    assert.deepEqual(full.steps, []);
  }
  const zeroPool = roster(); zeroPool[0]!.mp = 0; zeroPool[0]!.maxMp = 0;
  assert.equal(projectFieldRecovery(zeroPool, party(), command({ kind: "recover-mp", target: 12, amount: 0 }), conditions()).roster[0]!.mp, 0);
});

test("type 5 and type 11 flags are independent eligibility predicates for both resources", () => {
  for (const kind of ["recover-hp", "recover-mp"] as const)
    for (const allowUnableFight of [false, true])
      for (const allowMineralization of [false, true]) {
        const c = command({ kind, allowUnableFight, allowMineralization });
        assert.equal(fieldRecoveryEligible(c, []), true);
        assert.equal(fieldRecoveryEligible(c, [4, 6, 607]), true);
        assert.equal(fieldRecoveryEligible(c, [5]), allowUnableFight);
        assert.equal(fieldRecoveryEligible(c, [11]), allowMineralization);
        assert.equal(fieldRecoveryEligible(c, [11, 5]), allowMineralization && allowUnableFight);
      }
  for (const types of [[NaN], [-1], [0x80000000], [1.5], Array(1)])
    assert.throws(() => fieldRecoveryEligible(command(), types));
});

test("HP recovery without death permission skips the fallen owner and performs no actor refresh", () => {
  const input = roster(); input[0]!.hp = 0; input[0]!.conditionIds = [death];
  const result = projectFieldRecovery(input, party(), command(), conditions());
  assert.equal(result.roster[0]!.hp, 0);
  assert.deepEqual(result.roster[0]!.conditionIds, [death]);
  assert.equal(result.roster[2]!.hp, 73);
  assert.deepEqual(result.steps, []);
});

test("HP death removal adds exactly one after numeric recovery, removes every admitted death row, and preserves other order", () => {
  const input = roster(); input[0]!.hp = 0; input[0]!.conditionIds = [magitek, otherDeath, silence, death];
  const result = projectFieldRecovery(input, party(), command({ target: 12, allowUnableFight: true }), conditions());
  assert.equal(result.roster[0]!.hp, 4);
  assert.equal(result.roster[0]!.mp, 4);
  assert.deepEqual(result.roster[0]!.conditionIds, [magitek, silence, dying]);
  assert.deepEqual(result.steps.map((step) => step.targetId), ["current-disabled"]);
  const capped = roster(); capped[0]!.hp = 0; capped[0]!.maxHp = 2; capped[0]!.conditionIds = [death];
  assert.equal(projectFieldRecovery(capped, party(), command({ target: 12, amount: 2, allowUnableFight: true }), conditions()).roster[0]!.hp, 2);
});

test("HP setters keep source dying updates, including the two numeric calls and one death-removal call", () => {
  class ObservedConditions extends BattleConditions {
    readonly calls: number[] = [];
    override updateDying(hp: number, maxHp: number, ids: readonly number[]): number[] {
      this.calls.push(hp); return super.updateDying(hp, maxHp, ids);
    }
  }
  const input = roster(); input[0]!.hp = 0; input[0]!.conditionIds = [death];
  const engine = new ObservedConditions(catalog());
  projectFieldRecovery(input, party(), command({ target: 12, allowUnableFight: true }), engine);
  assert.deepEqual(engine.calls, [3, 3, 4]);
  const skipped = new ObservedConditions(catalog());
  projectFieldRecovery(input, party(), command({ target: 12 }), skipped);
  assert.deepEqual(skipped.calls, []);
  const alive = roster(); alive[0]!.hp = 9; alive[0]!.conditionIds = [silence, dying, magitek];
  assert.deepEqual(projectFieldRecovery(alive, party(), command({ target: 12, amount: 1 }), conditions()).roster[0]!.conditionIds,
    [silence, dying, magitek]);
  assert.deepEqual(projectFieldRecovery(alive, party(), command({ target: 12, amount: 2 }), conditions()).roster[0]!.conditionIds,
    [silence, magitek]);
});

test("MP death permission permits numeric recovery without removal, HP writes, dying updates or refresh", () => {
  class NoDyingUpdates extends BattleConditions {
    override updateDying(): never { throw new Error("MP must not update dying"); }
  }
  const input = roster(); input[0]!.hp = 0; input[0]!.conditionIds = [death];
  const engine = new NoDyingUpdates(catalog());
  const skipped = projectFieldRecovery(input, party(), command({ kind: "recover-mp", target: 12 }), engine);
  assert.equal(skipped.roster[0]!.mp, 4);
  const recovered = projectFieldRecovery(input, party(), command({ kind: "recover-mp", target: 12, allowUnableFight: true }), engine);
  assert.equal(recovered.roster[0]!.mp, 7);
  assert.equal(recovered.roster[0]!.hp, 0);
  assert.deepEqual(recovered.roster[0]!.conditionIds, [death]);
  assert.deepEqual(recovered.steps, []);
});

test("HP permission produces one ordered detached actor snapshot per target even without a death record", () => {
  const input = roster(), before = structuredClone(input);
  const result = projectFieldRecovery(input, party(), command({ allowUnableFight: true }), conditions());
  assert.deepEqual(result.steps.map((step) => [step.targetId, step.roster.map((m) => m.hp)]), [
    ["current-enabled", [20, 40, 73]], ["current-disabled", [23, 40, 73]],
  ]);
  result.steps[0]!.roster[0]!.gear.slots.push(111);
  result.roster[1]!.gear.slots.push(222);
  result.roster[2]!.conditionIds.push(silence);
  assert.deepEqual(result.steps[1]!.roster[0]!.gear.slots, [1, 2]);
  assert.deepEqual(result.steps[0]!.roster[2]!.conditionIds, []);
  assert.deepEqual(input, before);
});

test("empty current Corps has no target or presentation obligation and still returns a detached roster", () => {
  const input = roster(), result = projectFieldRecovery(input, fixtureParty([]), command({ allowUnableFight: true }), conditions());
  assert.deepEqual(result.targets, []); assert.deepEqual(result.steps, []);
  assert.deepEqual(result.roster, input); assert.notEqual(result.roster[0], input[0]);
  result.roster[0]!.gear.slots.push(123); assert.deepEqual(input[0]!.gear.slots, [1, 2]);
});

test("commands reject malformed flags, selectors, amounts, omitted keys and unsupported MP-count metadata", () => {
  for (const changes of [
    { kind: "remove-condition" }, { amount: NaN }, { amount: Infinity }, { amount: 1.5 },
    { amount: -0x80000000 }, { amount: 0x80000000 }, { target: -2 }, { target: 1.5 },
    { target: 0x80000000 }, { allowUnableFight: 1 }, { allowMineralization: 0 }, { countPool: true },
  ]) assert.throws(() => validateFieldRecoveryCommand({ ...command(), ...changes } as FieldRecoveryCommand));
  for (const key of Object.keys(command())) {
    const c = { ...command() }; delete c[key as keyof typeof c];
    assert.throws(() => validateFieldRecoveryCommand(c));
  }
  assert.doesNotThrow(() => validateFieldRecoveryCommand(command({ amount: -0x7fffffff, target: -1 })));
});

test("all selected resources and identities are validated before the first numeric projection", () => {
  class NoNumericUpdates extends BattleConditions {
    override updateDying(): never { throw new Error("premature numeric projection"); }
  }
  const input = roster(), before = structuredClone(input); input[0]!.mp = 21;
  const invalidBefore = structuredClone(input);
  assert.throws(() => projectFieldRecovery(input, party(), command({ allowUnableFight: true }), new NoNumericUpdates(catalog())), /Invalid field recovery resources/);
  assert.deepEqual(input, invalidBefore);
  const unknown = roster(); unknown[0]!.conditionIds = [9999];
  assert.throws(() => projectFieldRecovery(unknown, party(), command(), conditions()), /Unknown battle condition/);
  const ambiguous = roster(); ambiguous[1]!.sourceId = 12;
  assert.throws(() => projectFieldRecovery(ambiguous, party(), command(), conditions()), /Ambiguous/);
  const repeatedOwner = roster(); repeatedOwner[1]!.ownedId = 41;
  assert.throws(() => projectFieldRecovery(repeatedOwner, party(), command(), conditions()), /identity/);
  const sparse = roster(); delete sparse[1];
  assert.throws(() => projectFieldRecovery(sparse, party(), command(), conditions()), /Sparse/);
  assert.deepEqual(before, roster());
});

test("late addition overflow leaves every target untouched and is rejected before maximum clipping", () => {
  const input = roster(); input[0]!.hp = 2; input[0]!.maxHp = 0x7fffffff;
  input[2]!.hp = 1; // First Corps target fits int32; the later target overflows.
  const before = structuredClone(input);
  assert.throws(() => projectFieldRecovery(input, party(), command({ amount: 0x7ffffffe, allowUnableFight: true }), conditions()), /addition overflow/);
  assert.deepEqual(input, before);
  assert.throws(() => projectFieldRecovery(input, party(), command({ target: 12, amount: 0 }), conditions()), /addition overflow/);
  const deathCap = roster(); deathCap[0]!.hp = 0; deathCap[0]!.maxHp = 0x7fffffff; deathCap[0]!.conditionIds = [death];
  const deadBefore = structuredClone(deathCap);
  assert.throws(() => projectFieldRecovery(deathCap, party(), command({ target: 12, amount: 0, allowUnableFight: true }), conditions()), /addition overflow/);
  assert.deepEqual(deathCap, deadBefore);
});

test("recovery cannot repair invalid HP/death ownership or erase an unimplemented condition into admission", () => {
  const input = roster(); input[0]!.hp = 1; input[0]!.conditionIds = [death];
  assert.throws(() => projectFieldRecovery(input, party(), command({ allowUnableFight: true }), conditions()), /HP\/death state mismatch/);
  for (const id of [100, 11]) {
    const unported = roster(); unported[0]!.conditionIds = [id];
    if (id === 100) unported[0]!.hp = 0;
    const before = structuredClone(unported);
    assert.deepEqual(conditions().referenceTypes([id]), [id === 100 ? 5 : 11]);
    assert.throws(() => projectFieldRecovery(unported, party(), command({ target: 12, allowUnableFight: true, allowMineralization: true }), conditions()),
      /Unimplemented active battle condition/);
    assert.deepEqual(unported, before);
  }
});

function presentationStep(targetId: string): OwnedConditionAppearanceStep {
  return { targetId, appearance: { activeMembers: [], parties: [] }, setDummy: false, affectLeader: true };
}

test("event prepares the complete appearance sequence and publishes actors before the final owned write", () => {
  const calls: string[] = [], steps = [presentationStep("a"), presentationStep("b")];
  const op = event({ allowUnableFight: true }), original = structuredClone(op);
  const port: FieldRecoveryPort = { prepare(c) {
    calls.push("prepare-owned"); assert.deepEqual(c, op.command); assert('amount'in c);c.amount = 999;
    return { targets: ["a", "b"], steps, commit: () => { calls.push("commit-owned"); },
      commitWith: (publish) => { publish(); calls.push("commit-owned"); } };
  } };
  executeFieldRecoveryEvent(op, port, (candidate) => {
    calls.push("prepare-actors"); assert.deepEqual(candidate, steps);
    candidate[0]!.appearance.parties.push([]);
    return Object.assign(() => { calls.push("publish-actors"); }, { validate: () => { calls.push("validate-actors"); } });
  });
  assert.deepEqual(calls, ["prepare-owned", "prepare-actors", "validate-actors", "publish-actors", "commit-owned"]);
  assert.deepEqual(op, original); assert.deepEqual(steps[0]!.appearance.parties, []);
});

test("missing presentation, late actor preparation failure or rejected validation never commits recovery", () => {
  let commits = 0, publications = 0;
  const port: FieldRecoveryPort = { prepare: () => ({ targets: ["a", "b"], steps: [presentationStep("a"), presentationStep("b")],
    commit: () => { commits++; }, commitWith: (publish) => { publish(); commits++; } }) };
  const op = event({ allowUnableFight: true });
  assert.throws(() => executeFieldRecoveryEvent(op, undefined), /owned state is unavailable/);
  assert.throws(() => executeFieldRecoveryEvent(op, port), /actor refresh is unavailable/);
  assert.throws(() => executeFieldRecoveryEvent(op, port, (steps) => {
    assert.equal(steps.length, 2); throw new Error("second actor media unavailable");
  }), /second actor/);
  assert.throws(() => executeFieldRecoveryEvent(op, port, () => Object.assign(() => { publications++; }, {
    validate: () => { throw new Error("actor generation changed"); },
  })), /generation changed/);
  assert.throws(() => executeFieldRecoveryEvent(op, port, () => null as never), /Invalid field recovery presentation/);
  assert.equal(commits, 0); assert.equal(publications, 0);
});

test("a stale owned commit leaves the prepared presentation unpublished", () => {
  let published = false;
  const port: FieldRecoveryPort = { prepare: () => ({ targets: ["a"], steps: [presentationStep("a")],
    commit: () => { throw new Error("Stale field recovery transaction"); },
    commitWith: () => { throw new Error("Stale field recovery transaction"); } }) };
  assert.throws(() => executeFieldRecoveryEvent(event({ allowUnableFight: true }), port, () => () => { published = true; }), /Stale/);
  assert.equal(published, false);
});

test("scalar HP/MP and empty targets do not manufacture a presentation requirement", () => {
  let commits = 0;
  const port: FieldRecoveryPort = { prepare: () => ({ targets: ["a"], steps: [], commit: () => { commits++; },
    commitWith: (publish) => { publish(); commits++; } }) };
  for (const kind of ["recover-hp", "recover-mp"] as const)
    executeFieldRecoveryEvent(event({ kind }), port, () => assert.fail("numeric-only recovery has no Refresh"));
  executeFieldRecoveryEvent(event({ allowUnableFight: true }), { prepare: () => ({ targets: [], steps: [], commit: () => { commits++; },
    commitWith: (publish) => { publish(); commits++; } }) },
    () => assert.fail("empty Corps has no Refresh"));
  assert.equal(commits, 3);
  let prepares = 0;
  assert.throws(() => executeFieldRecoveryEvent({ ...event(), kind: "owned-condition" } as unknown as FieldRecoveryEventOp,
    { prepare: () => { prepares++; throw new Error("unexpected"); } }), /Invalid field recovery event/);
  assert.equal(prepares, 0);
});
