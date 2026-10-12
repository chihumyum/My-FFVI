import assert from "node:assert/strict";
import test from "node:test";
import { WalkEncounterState, parseFrameworkWalkEncounterPolicy,
  type FrameworkWalkEncounterPolicy, type WalkEncounterSnapshot } from "../src/core/walk-encounters.js";

function policy(patch: Partial<FrameworkWalkEncounterPolicy> = {}): FrameworkWalkEncounterPolicy {
  return { kind: "framework-walk-encounters-v1", id: "controlled-walking", minSteps: 2, maxSteps: 5,
    transportationIds: [1, 6], parties: [{ partyId: 11, weight: 2 }, { partyId: 17, weight: 3 }], ...patch };
}
const publish = (): void => {};
function step(state: WalkEncounterState, mapId = 3, rule = policy()): number | null {
  const prepared = state.prepareStep(mapId, rule);
  prepared.commitWith(publish);
  return prepared.partyId;
}

test("policy parsing clones every nested collection and preserves explicit authored order", () => {
  const raw = policy(), parsed = parseFrameworkWalkEncounterPolicy(raw);
  assert.deepEqual(parsed, raw);
  parsed.transportationIds.reverse(); parsed.parties[0]!.weight = 20;
  assert.deepEqual(raw.transportationIds, [1, 6]); assert.equal(raw.parties[0]!.weight, 2);
});

test("policy schema rejects unknown fields, duplicates, missing candidates and invalid integer ranges", () => {
  const bad: unknown[] = [null, [], { ...policy(), kind: "source" }, { ...policy(), id: " " },
    { ...policy(), extra: true }, policy({ minSteps: 0 }), policy({ minSteps: 6, maxSteps: 5 }),
    policy({ maxSteps: Infinity }), policy({ maxSteps: 0x100000000 }), policy({ minSteps: 1.5 }),
    policy({ transportationIds: [] }), policy({ transportationIds: [1, 1] }), policy({ transportationIds: [0] }),
    policy({ parties: [] }), policy({ parties: [{ partyId: 11, weight: 1 }, { partyId: 11, weight: 2 }] }),
    policy({ parties: [{ partyId: 0, weight: 1 }] }), policy({ parties: [{ partyId: 11, weight: 0 }] }),
    policy({ parties: [{ partyId: 11, weight: 0xffffffff }, { partyId: 17, weight: 1 }] }),
    { ...policy(), parties: [{ partyId: 11, weight: 1, extra: true }] },
    { ...policy(), transportationIds: Object.assign([1], { extra: true }) },
    { ...policy(), transportationIds: Object.assign(new Array(1), { extra: 1 }) },
  ];
  for (const value of bad) assert.throws(() => parseFrameworkWalkEncounterPolicy(value));
  assert.deepEqual(parseFrameworkWalkEncounterPolicy(policy({ minSteps: 0xffffffff, maxSteps: 0xffffffff,
    parties: [{ partyId: 11, weight: 0xffffffff }] })).maxSteps, 0xffffffff);
});

test("zero and maximum uint32 seeds work, while malformed seeds are rejected", () => {
  for (const seed of [0, 0xffffffff]) {
    const state = new WalkEncounterState(seed); step(state);
    assert.notEqual(state.snapshot().rng, seed);
  }
  for (const seed of [-1, -0, 1.5, NaN, Infinity, 0x100000000])
    assert.throws(() => new WalkEncounterState(seed), /seed/);
});

test("preparation and policy admission never write or consume RNG", () => {
  const state = new WalkEncounterState(19), before = state.snapshot(), raw = policy();
  state.assertPolicy(3, raw);
  const a = state.prepareStep(3, raw), b = state.prepareStep(3, raw);
  a.validate(); b.validate();
  assert.equal(a.partyId, b.partyId); assert.deepEqual(state.snapshot(), before);
  raw.parties[0]!.weight = 90; raw.transportationIds[0] = 99;
  a.commitWith(() => assert.deepEqual(state.snapshot(), before));
  assert.deepEqual(state.snapshot().maps[0]!.policy, policy());
  assert.throws(() => b.commitWith(publish), /Stale/);
});

test("fixed thresholds count the first eligible step and reset only after an encounter", () => {
  const state = new WalkEncounterState(4), rule = policy({ minSteps: 3, maxSteps: 3 });
  assert.equal(step(state, 3, rule), null); assert.equal(state.snapshot().maps[0]!.remainingSteps, 2);
  assert.equal(step(state, 3, rule), null); assert.equal(state.snapshot().maps[0]!.remainingSteps, 1);
  assert.notEqual(step(state, 3, rule), null); assert.equal(state.snapshot().maps[0]!.remainingSteps, 3);
  assert.equal(state.snapshot().completedSteps, 3); assert.equal(state.snapshot().encounters, 1);
  const immediate = new WalkEncounterState(4);
  assert.notEqual(step(immediate, 3, policy({ minSteps: 1, maxSteps: 1 })), null);
  assert.equal(immediate.snapshot().encounters, 1);
});

test("weighted draws include both boundary buckets without gaps or off-by-one bias", () => {
  // Independent LCG inverse vectors: the first threshold draw leaves the second
  // uint32 draw at 0, 1, 2, 3 and 4 respectively. Weights define [0,2) and [2,5).
  const vectors = [[4150723358, 11], [1525615287, 11], [3195474512, 17],
    [570366441, 17], [2240225666, 17]] as const;
  for (const [seed, expected] of vectors)
    assert.equal(step(new WalkEncounterState(seed), 3, policy({ minSteps: 1, maxSteps: 1 })), expected);
});

test("the non-divisible uint32 tail is rejected instead of biasing the first weighted bucket", () => {
  // After the fixed threshold draw, this seed produces 0xffffffff. A range of
  // five excludes that value; the next draw is 1012239698, in the second bucket.
  // Taking modulo immediately would incorrectly select the first party.
  assert.equal(step(new WalkEncounterState(2480864133), 3, policy({ minSteps: 1, maxSteps: 1 })), 17);
});

test("variable thresholds stay within the inclusive development range and use both ends", () => {
  const state = new WalkEncounterState(0), rule = policy({ minSteps: 2, maxSteps: 4 });
  const lengths = new Set<number>(); let previousEncounter = 0;
  for (let count = 1; count <= 120; count++) if (step(state, 3, rule) !== null) {
    const length = count - previousEncounter;
    assert.ok(length >= 2 && length <= 4); lengths.add(length); previousEncounter = count;
  }
  assert.deepEqual([...lengths].sort(), [2, 3, 4]);
});

test("same seed and sequence replay exactly; different maps retain independent countdowns", () => {
  const a = new WalkEncounterState(321), b = new WalkEncounterState(321);
  const rule = policy({ minSteps: 3, maxSteps: 3 });
  for (const mapId of [3, 9, 3, 9, 9, 3, 3, 9]) assert.equal(step(a, mapId, rule), step(b, mapId, rule));
  assert.deepEqual(a.snapshot(), b.snapshot());
  assert.deepEqual(a.snapshot().maps.map(({ mapId, remainingSteps }) => [mapId, remainingSteps]), [[3, 2], [9, 2]]);
  assert.equal(a.snapshot().completedSteps, 8); assert.equal(a.snapshot().encounters, 2);
});

test("save and restore preserve future encounters without resampling, with detached snapshots", () => {
  const continuous = new WalkEncounterState(55);
  for (let n = 0; n < 11; n++) step(continuous, n % 2 ? 3 : 9);
  const saved = continuous.snapshot(), restored = new WalkEncounterState(55);
  restored.restore(saved); const expected = restored.snapshot();
  saved.rng = 999; saved.maps[0]!.policy.parties[0]!.weight = 99; saved.maps[0]!.remainingSteps = 999;
  assert.deepEqual(restored.snapshot(), expected);
  const returned = restored.snapshot(); returned.maps.length = 0;
  assert.deepEqual(restored.snapshot(), expected);
  for (let n = 0; n < 60; n++) assert.equal(step(restored, n % 3 ? 3 : 9), step(continuous, n % 3 ? 3 : 9));
  assert.deepEqual(restored.snapshot(), continuous.snapshot());
});

test("exact per-map policy binding rejects changed content without writing and does not bind unused maps", () => {
  const state = new WalkEncounterState(1), rule = policy(); step(state, 3, rule);
  const before = state.snapshot();
  const changes = [policy({ id: "replacement" }), policy({ minSteps: 1 }), policy({ maxSteps: 9 }),
    policy({ transportationIds: [6, 1] }), policy({ parties: [...rule.parties].reverse() }),
    policy({ parties: [{ partyId: 11, weight: 3 }, { partyId: 17, weight: 3 }] })];
  for (const changed of changes) {
    assert.throws(() => state.assertPolicy(3, changed), /binding/);
    assert.throws(() => state.prepareStep(3, changed), /binding/);
    state.assertPolicy(9, changed);
  }
  assert.deepEqual(state.snapshot(), before);
});

test("failed callback consumes the candidate but leaves all scheduler state retryable", () => {
  const state = new WalkEncounterState(1), before = state.snapshot(), rule = policy({ minSteps: 1, maxSteps: 1 });
  const prepared = state.prepareStep(3, rule), failure = new Error("controlled movement rejection");
  assert.throws(() => prepared.commitWith(() => { throw failure; }), (error) => error === failure);
  assert.deepEqual(state.snapshot(), before);
  assert.throws(() => prepared.validate(), /consumed/);
  assert.throws(() => prepared.commitWith(publish), /consumed/);
  const retry = state.prepareStep(3, rule); assert.equal(retry.partyId, prepared.partyId);
  retry.commitWith(publish); assert.equal(state.snapshot().completedSteps, 1); assert.equal(state.snapshot().encounters, 1);
});

test("committed candidates are single use and restore invalidates previously prepared steps", () => {
  const state = new WalkEncounterState(12), prepared = state.prepareStep(3, policy()); let writes = 0;
  prepared.commitWith(() => { writes++; }); const before = state.snapshot();
  assert.throws(() => prepared.commitWith(() => { writes++; }), /consumed/); assert.equal(writes, 1);
  const stale = state.prepareStep(3, policy()); state.restore(before);
  assert.throws(() => stale.validate(), /Stale/);
  assert.throws(() => stale.commitWith(() => { writes++; }), /Stale/);
  assert.equal(writes, 1); assert.deepEqual(state.snapshot(), before);
});

test("publication locks out reentrant prepare, restore and other commits without poisoning later steps", () => {
  const state = new WalkEncounterState(88), before = state.snapshot();
  const a = state.prepareStep(3, policy()), b = state.prepareStep(9, policy());
  a.commitWith(() => {
    assert.throws(() => state.prepareStep(9, policy()), /reentrant/);
    assert.throws(() => state.restore(before), /reentrant/);
    assert.throws(() => b.commitWith(publish), /reentrant/);
    assert.deepEqual(state.snapshot(), before);
  });
  assert.equal(state.snapshot().completedSteps, 1); step(state, 9);
  assert.equal(state.snapshot().completedSteps, 2);
});

test("restore rejects malformed snapshots atomically including all nested fields and foreign seed", () => {
  const state = new WalkEncounterState(7); step(state); const before = state.snapshot();
  const mutations: ((s: WalkEncounterSnapshot) => unknown)[] = [
    (s) => ({ ...s, extra: 1 }), (s) => ({ ...s, kind: "old" }), (s) => ({ ...s, seed: 8 }),
    (s) => ({ ...s, rng: 0x100000000 }), (s) => ({ ...s, completedSteps: -1 }),
    (s) => ({ ...s, completedSteps: 0 }), (s) => ({ ...s, encounters: s.completedSteps + 1 }),
    (s) => ({ ...s, maps: [] }), (s) => ({ ...s, maps: [s.maps[0], s.maps[0]] }),
    (s) => ({ ...s, maps: [{ ...s.maps[0], mapId: 0 }] }),
    (s) => ({ ...s, maps: [{ ...s.maps[0], remainingSteps: 0 }] }),
    (s) => ({ ...s, maps: [{ ...s.maps[0], remainingSteps: 6 }] }),
    (s) => ({ ...s, maps: [{ ...s.maps[0], extra: true }] }),
    (s) => ({ ...s, maps: [{ ...s.maps[0], policy: { ...s.maps[0]!.policy, extra: true } }] }),
  ];
  for (const mutate of mutations) {
    assert.throws(() => state.restore(mutate(structuredClone(before))));
    assert.deepEqual(state.snapshot(), before);
  }
  const empty = new WalkEncounterState(7);
  assert.throws(() => empty.restore({ ...empty.snapshot(), rng: 9 }), /Inconsistent/);
});

test("invalid map identities and exhausted counters fail before publication", () => {
  const state = new WalkEncounterState(3), before = state.snapshot();
  for (const mapId of [0, -1, 1.5, Infinity, 0x80000000]) {
    assert.throws(() => state.assertPolicy(mapId, policy()), /map identity/);
    assert.throws(() => state.prepareStep(mapId, policy()), /map identity/);
  }
  assert.deepEqual(state.snapshot(), before);
  step(state); const full = state.snapshot(); full.completedSteps = Number.MAX_SAFE_INTEGER;
  state.restore(full); assert.throws(() => state.prepareStep(3, policy()), /overflow/);
  assert.deepEqual(state.snapshot(), full);
});
