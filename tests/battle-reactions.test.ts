import test from "node:test";
import assert from "node:assert/strict";
import {
  battleReaction,
  validateReactionRules,
  type BattleReactionRules,
} from "../src/core/battle-reactions.js";

const rules: BattleReactionRules = {
  counterLimit: 1,
  excludedAbilityIds: [90],
};
const input = {
  actor: "a",
  target: "b",
  isCounter: false,
  abilityId: 10,
  systemId: 3,
  primarySlot: 1,
  effects: [
    {
      slot: 1,
      resource: "hp" as const,
      recovery: false,
      missed: false,
      amount: 0,
    },
  ],
};

test("reaction eligibility follows the primary result, not resource deltas or a later effect", () => {
  assert.equal(battleReaction(rules, input)!.counterReady, true);
  assert.equal(
    battleReaction(rules, {
      ...input,
      effects: [{ ...input.effects[0]!, recovery: true }],
    })!.counterReady,
    true,
  );
  assert.equal(
    battleReaction(rules, {
      ...input,
      effects: [
        { ...input.effects[0]!, missed: true },
        { ...input.effects[0]!, amount: 100 },
      ],
    })!.counterReady,
    false,
  );
  assert.equal(
    battleReaction(rules, {
      ...input,
      effects: [
        {
          slot: 1,
          resource: "condition",
          recovery: false,
          missed: false,
          added: [],
          removed: [],
        },
      ],
    })!.counterReady,
    true,
  );
});

test("self actions and counter chains cannot wake ordinary reaction AI; exclusions do not mask misses", () => {
  assert.equal(battleReaction(rules, { ...input, target: "a" }), null);
  assert.equal(battleReaction(rules, { ...input, isCounter: true }), null);
  assert.equal(battleReaction(rules, { ...input, abilityId: 90 }), null);
  assert.equal(
    battleReaction(rules, {
      ...input,
      abilityId: 90,
      effects: [{ ...input.effects[0]!, missed: true }],
    })!.counterReady,
    false,
  );
  assert.throws(
    () => battleReaction(rules, { ...input, abilityId: 90, systemId: 2 }),
    /recovery reaction/,
  );
  assert.throws(
    () => battleReaction(rules, { ...input, effects: [] }),
    /primary/,
  );
  assert.throws(
    () => battleReaction(rules, { ...input, primarySlot: 2 }),
    /primary function reaction/,
  );
  assert.throws(
    () => battleReaction(rules, { ...input, systemId: NaN }),
    /system identity/,
  );
  assert.throws(
    () =>
      validateReactionRules({
        ...rules,
        counterLimit: 2,
      } as unknown as BattleReactionRules),
    /reaction rules/,
  );
});
