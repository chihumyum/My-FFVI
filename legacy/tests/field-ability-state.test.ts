import test from "node:test";
import assert from "node:assert/strict";
import { sourceNativeStateFixture } from "./fixtures/source-native-state.js";
import type { FieldAbilityCatalog, FieldAbilityRequest } from "../src/core/field-abilities.js";

/** Authored held ability and wounded initialization, not an original-game
 * acquisition. Both initializer bindings are changed before owner creation. */
function fixture() {
  const f = sourceNativeStateFixture(), id = f.player.id;
  const initial = f.content.characterInitializations![id]!.initial;
  const held = initial.abilities.owned.find(ability => ability.skillLevel === 100 && ability.contentId > 0)!;
  initial.hp = Math.max(1, initial.maxHp - 45);
  f.content.sourceNewGame!.characters[0]!.template.initial.hp = initial.hp;
  const commandId = initial.abilities.commandIds[0]!;
  const catalog: FieldAbilityCatalog = {
    kind: "field-abilities-v1",
    rules: { kind: "field-ability-rules-v1", profile: "framework",
      random: { kind: "web-field-random-v1", seed: 0x71f6c0de } },
    commands: [{ id: commandId, nameKey: "authored-field-command", type: 1, listType: 3,
      executionType: 2, abilityId: 0, contentId: null, abilityTypes: [604],
      releaseType: 0, releaseValues: [0, 0], forbiddenConditionIds: [], blockers: [] }],
    abilities: { [held.abilityId]: { id: held.abilityId, contentId: held.contentId, name: "Authored field healing",
      typeId: 604, menuFunctionGroupId: 70001, menuRange: 6, cost: 5, power: 1,
      program: { groupId: 70001, range: 6, functions: [{ slot: 1, functionId: 1, type: 1, series: 0, values: [2, 2, 0] }],
        process: { key: "None", values: [0, 0, 0] }, forbiddenConditionIds: [], contentFlags: [1, 2] },
      plan: { kind: "field-ability-plan-v1", modes: ["single", "all"],
        effects: [{ slot: 1, kind: "recovery", resource: "hp", calculation: "magic" }],
        magic: { accuracy: 255, contentFlags: [1, 2], forceDefense: false, elements: [] } }, blockers: [] } },
  };
  f.content.fieldAbilities = catalog;
  const game = f.fresh(), request: FieldAbilityRequest = { actorId: id, abilityId: held.abilityId,
    selection: { kind: "single", id } };
  return { ...f, id, catalog, game, request, context: { invalidContentIds: [] } };
}

test("field ability preparation preserves all owners and stale or reused candidates cannot consume resources or randomness", () => {
  const f = fixture(), before = f.game.snapshot();
  const candidate = f.game.prepareFieldAbility(f.request, f.context)!;
  assert.ok(candidate); assert.deepEqual(f.game.snapshot(), before);
  f.game.changeItems([{ id: 701, count: 1 }], "consume");
  const afterInventory = f.game.snapshot();
  assert.throws(candidate.commit, /Stale/);
  assert.deepEqual(f.game.snapshot(), afterInventory);
  assert.deepEqual(afterInventory.fieldRandom, before.fieldRandom);
  const next = f.game.prepareFieldAbility(f.request, f.context)!;
  next.commit(); const settled = f.game.snapshot();
  assert.ok(settled.roster[0]!.hp > before.roster[0]!.hp);
  assert.equal(settled.roster[0]!.mp, before.roster[0]!.mp - 5);
  assert.ok(settled.fieldRandom!.draws > before.fieldRandom!.draws);
  assert.throws(next.commit, /Stale/); assert.deepEqual(f.game.snapshot(), settled);
  for (const key of ["abilities", "equipment", "growth", "ownedId", "ownedJobs"] as const)
    assert.deepEqual(settled.roster[0]![key], before.roster[0]![key]);
});

test("field ability model reads and refused targets leave the stream unchanged; save restore continues the same future draw", () => {
  const f = fixture(), before = f.game.snapshot();
  for (let i = 0; i < 5; i++) {
    f.game.menuAbilities(f.id, f.context); f.game.menuAbilityTargets(f.id, f.request.abilityId, f.context);
  }
  assert.deepEqual(f.game.snapshot(), before);
  assert.equal(f.game.prepareFieldAbility({ ...f.request, selection: { kind: "single", id: "not-held" } }, f.context), null);
  assert.deepEqual(f.game.snapshot(), before);
  f.game.prepareFieldAbility(f.request, f.context)!.commit();
  const checkpoint = f.game.snapshot(), restored = f.fresh(); restored.restore(checkpoint);
  f.game.prepareFieldAbility(f.request, f.context)!.commit();
  restored.prepareFieldAbility(f.request, f.context)!.commit();
  assert.deepEqual(restored.snapshot(), f.game.snapshot());
});

test("v13 field random ownership is required and old packages cannot admit or silently seed it", () => {
  const f = fixture(), saved = f.game.snapshot(); assert.equal(saved.formatVersion, 13);
  const missing = structuredClone(saved); delete missing.fieldRandom;
  assert.throws(() => f.game.restore(missing));
  const bad = structuredClone(saved); bad.fieldRandom!.state = 0;
  assert.throws(() => f.game.restore(bad));
  const old = sourceNativeStateFixture(), oldState = old.fresh();
  assert.equal(oldState.snapshot().formatVersion, 12);
  assert.equal(oldState.prepareFieldAbility(f.request, f.context), null);
  assert.throws(() => oldState.restore(saved));
  const historical = { ...saved, formatVersion: 12 as const }; delete historical.fieldRandom;
  assert.throws(() => f.game.restore(historical));
  assert.deepEqual(f.game.snapshot(), saved);
});
