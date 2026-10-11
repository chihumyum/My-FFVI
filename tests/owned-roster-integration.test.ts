import test from "node:test";
import assert from "node:assert/strict";
import { GameState, type GameStateContent } from "../src/core/game-state.js";
import { compileEquipmentCatalog } from "../src/compiler/equipment.js";
import { characterGrowthFixture } from "./fixtures/character-growth.js";
import { fixture } from "./fixtures/battle-content.js";
import { fixtureParty } from "./fixtures/party.js";
import { itemFixture } from "./fixtures/items.js";
import { fixtureWeaponEffects } from "./fixtures/equipment.js";

/** Synthetic owners use two distinct source IDs with the same numerical plan.
 * No real game resource or region is needed to prove transaction semantics. */
function setup(missingJoinGrowth = false) {
  const f = characterGrowthFixture();
  const battle = fixture();
  const original = f.template, joining = structuredClone(original);
  joining.initial.sourceId = 3;
  joining.initial.name = "Synthetic joining owner";
  joining.nameTag = "JOINING";
  joining.equipmentCharacter.sourceId = 3;
  const gear = compileEquipmentCatalog(f.reader(), f.tables["content.csv"]!
    .filter((r) => ["2", "3"].includes(r.type_id!)).map((r) => Number(r.id)),
    [2], (key) => key, { 2: { hasTwoSwordStyle: false, hasTwoHand: false, equipAnyJob: false } }, fixtureWeaponEffects()).catalog;
  gear.characters[3] = structuredClone(joining.equipmentCharacter);
  const player = { ...battle.players[0]!, ...original.confirmed, id: "first", sourceId: 2,
    name: original.initial.name, level: original.initial.level, exp: original.initial.exp,
    hp: original.initial.hp, mp: original.initial.mp };
  const content: GameStateContent = {
    kind: "game-state-development-v1", limits: { gil: 1000, item: 99, hp: 9999, mp: 999, level: 5, exp: 400 },
    initialGil: 10, initialParty: fixtureParty(["first"]),
    characterInitializations: { first: original, joining },
    characterGrowth: { first: f.plan, ...(missingJoinGrowth ? {} : { joining: { ...f.plan, sourceId: 3 } }) },
    rosterLifecycle: { initial: { first: { ownedId: 1, jobId: 12, additionalLevel: 2,
      magicStoneId: 0, ownedJobs: [{ id: 12, level: 1, proficiency: 0 }] } },
      releasedJobIds: [12], jobIds: [1, 12], firstJoinLevelAdjustments: { 3: 1 } },
    items: { 10: itemFixture(10) }, initialItems: [{ id: 10, count: 1 }],
    equipment: { first: [...original.initial.equipment] },
    equipmentSystem: { catalog: gear, contexts: { first: original.parameterContext, joining: joining.parameterContext },
      limits: original.limits, growth: {} },
  };
  const make = () => new GameState(content, [player], "synthetic-owned-growth", battle.conditions);
  return { state: make(), make, content };
}
const join = { kind: "join" as const, sourceId: 3, position: null, row: "front" as const,
  refreshActors: false, recovery: false, refitEquipment: false };

test("new owner joins with native experience correction, one gear registration and owned-only learning", () => {
  const { state, make } = setup();
  const before = state.snapshot(), prepared = state.fieldRoster.prepare(join);
  assert.deepEqual(state.snapshot(), before);
  prepared.commit();
  const after = state.snapshot(), member = after.roster[1]!;
  assert.equal(member.ownedId, 2);
  // Target level 3 means additionalExp=100; source baseExp=30 produces level 4.
  assert.equal(member.level, 4);
  assert.equal(member.exp, 130);
  assert.equal(member.growth!.additionalExp, 100);
  assert.equal(member.maxHp, 150);
  assert.equal(member.hp, 100);
  assert.ok(member.abilities!.owned.some((a) => a.abilityId === 101 && a.skillLevel === 100));
  assert.deepEqual(after.learnedAbilityIds, before.learnedAbilityIds);
  assert.equal(after.characterNames.JOINING, member.name);
  for (const entry of before.equipmentStock)
    assert.equal(after.equipmentStock.find((s) => s.id === entry.id)!.count, entry.count * 2);
  state.fieldRoster.prepare({ kind: "unlock", sourceId: 3, refreshActors: false }).commit();
  assert.deepEqual(state.snapshot(), after);
  const restored = make();
  restored.restore(JSON.parse(JSON.stringify(after)));
  assert.deepEqual(restored.snapshot(), after);
  assert.throws(prepared.commit, /Stale/);
});

test("owned menu actions and equipment work before a new owner's battle presentation is admitted", () => {
  const { state } = setup();
  state.fieldRoster.prepare(join).commit();
  assert.match(state.battlePartyBlocker!, /战斗动作/);
  assert.throws(() => state.openBattle(1), /战斗动作/);
  assert.deepEqual(state.menuItemTargets(10), ["joining"]);
  assert.equal(state.useMenuItem(10, "joining"), true);
  assert.equal(state.snapshot().roster[1]!.hp, 150);
  assert.equal(state.snapshot().items[0]!.count, 0);
  assert.ok(state.equipmentChoices("joining", 1).length > 0);
});

test("missing growth or stale ownership discards the new member, names, history and equipment together", () => {
  const unavailable = setup(true).state, before = unavailable.snapshot();
  assert.throws(() => unavailable.fieldRoster.prepare(join), /source character growth/);
  assert.deepEqual(unavailable.snapshot(), before);
  const { state } = setup(), prepared = state.fieldRoster.prepare(join);
  state.fieldInventory.prepare({ kind: "grant-gil", amount: 1 }).commit();
  const live = state.snapshot();
  assert.throws(prepared.commit, /Stale/);
  assert.deepEqual(state.snapshot(), live);
  assert.equal(live.roster.length, 1);
});

test("source growth restore rejects forged additions, levels and learned state atomically", () => {
  const { state } = setup();
  state.fieldRoster.prepare(join).commit();
  const stable = state.snapshot();
  for (const mutate of [
    (s: typeof stable) => { s.roster[1]!.growth!.additional.hp++; },
    (s: typeof stable) => { s.roster[1]!.growth!.additionalExp = 0; },
    (s: typeof stable) => { s.roster[1]!.level++; s.roster[1]!.additionalLevel++; },
    (s: typeof stable) => { s.roster[1]!.abilities!.owned.at(-1)!.skillLevel = 0; },
    (s: typeof stable) => { s.roster[1]!.maxHp++; },
    (s: typeof stable) => { s.roster[1]!.growth = null; },
  ]) {
    const forged = structuredClone(stable);
    mutate(forged);
    assert.throws(() => state.restore(forged));
    assert.deepEqual(state.snapshot(), stable);
  }
});

test("battle projection and victory share source growth, learning and a single durable publication", () => {
  const { state } = setup(), before = state.snapshot();
  const lease = state.openBattle(1), player = state.battlePlayers(lease)[0]!;
  Object.assign(player, state.battleProgression(lease)!(player, 100, []));
  assert.equal(player.level, 4);
  assert.equal(player.maxHp, 150);
  assert.deepEqual(state.snapshot(), before);
  assert.throws(() => state.prepareVictory(lease, { players: [player], gil: 0, consumedItems: [] }), /experience award/);
  const result = { players: [player], gil: 2, consumedItems: [], awardedExperience: [{ id: player.id, amount: 100 }], observedAbilityIds: [] };
  const wrong = structuredClone(result);
  wrong.players[0]!.level++;
  assert.throws(() => state.prepareVictory(lease, wrong), /growth projection/);
  assert.deepEqual(state.snapshot(), before);
  state.prepareVictory(lease, result)();
  const after = state.snapshot();
  assert.equal(after.roster[0]!.growth!.additionalExp, 100);
  assert.ok(after.roster[0]!.abilities!.owned.some((a) => a.abilityId === 101));
  assert.deepEqual(after.learnedAbilityIds, before.learnedAbilityIds);
  assert.equal(after.completedBattles.length, 1);
});

test("candidate map initialization keeps acquired owners private until the map publishes", () => {
  const { state } = setup(), before = state.snapshot(), candidate = state.prepareFieldState();
  candidate.ports.roster.prepare(join).commit();
  assert.deepEqual(state.snapshot(), before);
  assert.equal(candidate.commit(), true);
  assert.equal(state.snapshot().roster[1]!.level, 4);
  assert.equal(candidate.commit(), false);
});
