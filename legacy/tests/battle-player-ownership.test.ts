import test from "node:test";
import assert from "node:assert/strict";
import { GameState, type BattleLease, type BattleVictoryResult } from "../src/core/game-state.js";
import type { Combatant } from "../src/core/battle.js";
import { parseBattlePlayerPlan, parseBattlePlayerBorrow, parseBattlePlayerReturn,
  type BattlePlayerPlan, type BattlePlayerBorrow, type BattlePlayerReturn } from "../src/core/battle-player-participants.js";
import { createBattlePlayerState, projectPlayerJoin, projectPlayerGroup, firstEnteredOwnerIds,
  type BattlePlayerState } from "../src/core/battle-player-state.js";
import { initialEquipmentStock } from "../src/core/equipment.js";
import { createNewGame } from "../src/core/new-game.js";
import { equipmentGameFixture } from "./fixtures/equipment-game.js";
import { equipmentContext, fixtureEquipmentGrants } from "./fixtures/equipment.js";
import { characterLearningSessionFixture } from "./fixtures/character-learning-session.js";
import { fixtureParty } from "./fixtures/party.js";

const plan = (): BattlePlayerPlan => ({ kind: "battle-player-plan-v1", profile: "web-owned-borrow-v1",
  sourceIds: [5], groups: [1, 0], rewardScope: "all-entered", returnParty: "preserve-entry" });

function ownershipFixture() {
  const { catalog } = equipmentGameFixture(), content = catalog.gameState, system = content.equipmentSystem!;
  const template = catalog.common.players[0]!;
  for (const [id, sourceId] of [["c", 3], ["d", 4], ["e", 5]] as const) {
    catalog.common.players.push({ ...structuredClone(template), id, sourceId, name: "Owned " + id });
    system.catalog.characters[sourceId] = { ...structuredClone(system.catalog.characters[1]!), sourceId };
    system.contexts[id] = equipmentContext();
    content.equipment[id] = [...content.equipment.a!];
    content.rosterLifecycle.initial[id] = { ...structuredClone(content.rosterLifecycle.initial.a!), ownedId: sourceId };
  }
  content.initialParty.slots[0][1] = { id: null, row: "back" };
  content.initialParty.slots[0][2] = { id: "b", row: "front" };
  content.initialParty.slots[1][1] = { id: "c", row: "back" };
  content.initialParty.slots[1][3] = { id: "d", row: "front" };
  system.initialStock = initialEquipmentStock(system.catalog, catalog.common.players.map(player =>
    ({ id: player.id, sourceId: player.sourceId, equipment: content.equipment[player.id]! })), fixtureEquipmentGrants(system.catalog));
  const state = new GameState(content, catalog.common.players, catalog.contentHash, catalog.common.conditions);
  const saved = state.snapshot();
  for (const id of ["c", "e"]) saved.roster.find(member => member.id === id)!.enabled = false;
  state.restore(saved);
  return { state, catalog };
}
function entered(borrow: BattlePlayerBorrow): BattlePlayerState {
  let state = createBattlePlayerState(borrow.initial);
  state = projectPlayerJoin(state, { ownedId: "e", sourceId: 5 }).state;
  state = projectPlayerGroup(state, borrow.groups[1]!).state;
  state = projectPlayerGroup(state, borrow.groups[0]!).state;
  return projectPlayerJoin(state, { ownedId: "e", sourceId: 5 }).state;
}
function returnEnvelope(state: BattlePlayerState, byOwner: Record<string, number[]> = {}): BattlePlayerReturn {
  return { state: structuredClone(state), observations: firstEnteredOwnerIds(state).map(ownedId =>
    ({ ownedId, abilityIds: [...(byOwner[ownedId] ?? [])] })) };
}
function finalPlayers(borrow: BattlePlayerBorrow, state: BattlePlayerState): Combatant[] {
  return firstEnteredOwnerIds(state).map(owner => {
    const player = structuredClone(borrow.candidates.find(candidate => candidate.id === owner)!);
    player.row = state.entries.filter(entry => entry.ownedId === owner).at(-1)!.row;
    return player;
  });
}
function victory(state: GameState, lease: BattleLease, borrow: BattlePlayerBorrow, history: BattlePlayerState): BattleVictoryResult {
  const players = finalPlayers(borrow, history), progression = state.battleProgression(lease, [
    { level: 2, exp: 0 }, { level: 3, exp: 5 }, { level: 4, exp: 20 },
  ])!;
  for (const [index, player] of players.entries()) Object.assign(player, progression(player, 7, [], 0, index));
  return { players, consumedItems: [], gil: 7, magicPoints: 0,
    awardedExperience: players.map(player => ({ id: player.id, amount: 7 })), observedAbilityIds: [],
    playerParticipants: returnEnvelope(history) };
}

test("borrow plans require explicit Web policies and unique dense source/group lists", () => {
  const input = plan(), parsed = parseBattlePlayerPlan(input);
  input.sourceIds.push(44); input.groups.pop();
  assert.deepEqual(parsed.sourceIds, [5]); assert.deepEqual(parsed.groups, [1, 0]);
  const changes: ((value: BattlePlayerPlan) => void)[] = [
    value => { value.sourceIds = [5, 5]; }, value => { value.groups = [1, 1]; },
    value => { value.sourceIds = [0]; }, value => { value.groups = [3 as 0]; },
    value => { delete (value as Partial<BattlePlayerPlan>).rewardScope; },
    value => { value.returnParty = "replace" as "preserve-entry"; },
    value => { delete value.sourceIds[0]; },
  ];
  for (const change of changes) { const bad = plan(); change(bad); assert.throws(() => parseBattlePlayerPlan(bad)); }
  assert.throws(() => parseBattlePlayerPlan({ ...plan(), implicitJoin: true }));
});

test("a lease freezes existing disabled owners, saved four-cell groups and pool gear occupancy", () => {
  const { state } = ownershipFixture(), before = state.snapshot(), input = plan(), lease = state.openBattle(1000, undefined, input);
  const borrow = state.battlePlayerBorrow(lease)!;
  assert.deepEqual(borrow.candidates.map(candidate => [candidate.id, candidate.sourceId]), [["a", 1], ["b", 2], ["e", 5], ["c", 3], ["d", 4]]);
  assert.deepEqual(borrow.initial.map(cell => [cell.ownedId, cell.row]), [["a", "front"], [null, "back"], ["b", "front"], [null, "front"]]);
  assert.deepEqual(borrow.groups[1]!.map(cell => [cell.ownedId, cell.row]), [[null, "front"], ["c", "back"], [null, "front"], ["d", "front"]]);
  assert.equal(state.battleInventory(lease).qualification!.equipmentStock.find(stock => stock.id === 201)!.equipped, 3);
  assert.equal(borrow.qualification!.equipmentStock.find(stock => stock.id === 201)!.equipped, 5);
  assert.deepEqual(state.battlePlayers(lease).map(player => player.id), ["a", "b"]);
  input.sourceIds.length = 0; borrow.candidates[2]!.hp = 1; borrow.groups[1]![1]!.row = "front";
  borrow.qualification!.members[2]!.equipment[0] = 1;
  const frozen = state.battlePlayerBorrow(lease)!;
  assert.equal(frozen.candidates[2]!.hp, 130); assert.equal(frozen.groups[1]![1]!.row, "back");
  assert.equal(frozen.qualification!.members[2]!.equipment[0], 101);
  assert.deepEqual(state.snapshot(), before);
  state.cancelBattle(lease); assert.throws(() => state.battlePlayerBorrow(lease), /Stale/);
});

test("missing held sources and declared empty groups fail before reserving any lease", () => {
  const { state } = ownershipFixture(), before = state.snapshot();
  assert.throws(() => state.openBattle(1000, undefined, { ...plan(), sourceIds: [999] }), /source owner/);
  assert.throws(() => state.openBattle(1000, undefined, { ...plan(), groups: [2] }), /must not be empty/);
  assert.deepEqual(state.snapshot(), before);
  const lease = state.openBattle(1000);
  assert.equal(state.battlePlayerBorrow(lease), undefined); state.cancelBattle(lease);
});

test("borrow parser rejects reserved, duplicate, sparse and unbound candidate identities", () => {
  const { state } = ownershipFixture(), lease = state.openBattle(1000, undefined, plan()), borrow = state.battlePlayerBorrow(lease)!;
  const changes: ((value: BattlePlayerBorrow) => void)[] = [
    value => { value.candidates[2]!.id = "player:dynamic:1"; },
    value => { value.candidates[2]!.sourceId = 1; },
    value => { value.candidates.push(structuredClone(value.candidates[0]!)); },
    value => { value.initial[1] = { ownedId: "e", sourceId: 999, row: "back" }; },
    value => { delete value.candidates[0]; },
    value => { value.candidates[2]!.atb = 100; },
    value => { value.groups[2] = structuredClone(value.groups[1]!); },
  ];
  for (const change of changes) { const bad = structuredClone(borrow); change(bad); assert.throws(() => parseBattlePlayerBorrow(bad)); }
  const detached = parseBattlePlayerBorrow(borrow); detached.candidates[0]!.hp = 1;
  assert.equal(borrow.candidates[0]!.hp, 130);
});

test("borrow qualification cannot omit candidate equipment, reuse occupied copies or duplicate stock", () => {
  const { state } = ownershipFixture(), lease = state.openBattle(1000, undefined, plan()), borrow = state.battlePlayerBorrow(lease)!;
  for (const change of [
    (value: BattlePlayerBorrow) => { value.qualification!.members.pop(); },
    (value: BattlePlayerBorrow) => { value.qualification!.equipmentStock.find(stock => stock.id === 201)!.equipped = 3; },
    (value: BattlePlayerBorrow) => { value.qualification!.equipmentStock.find(stock => stock.id === 201)!.count = 4; },
    (value: BattlePlayerBorrow) => { value.qualification!.equipmentStock.push(structuredClone(value.qualification!.equipmentStock[0]!)); },
  ]) { const bad = structuredClone(borrow); change(bad); assert.throws(() => parseBattlePlayerBorrow(bad)); }
});

test("borrowed return envelopes are mandatory and cannot be attached to a fixed-party lease", () => {
  const { state } = ownershipFixture(), before = state.snapshot(), lease = state.openBattle(1000, undefined, plan());
  const players = state.battlePlayers(lease), history = createBattlePlayerState(state.battlePlayerBorrow(lease)!.initial);
  assert.throws(() => state.prepareEscape(lease, { players, consumedItems: [] }), /envelope/);
  assert.throws(() => state.prepareEscape(lease, { players, consumedItems: [], playerParticipants: undefined } as unknown as Parameters<GameState["prepareEscape"]>[1]));
  state.cancelBattle(lease);
  const fixed = state.openBattle(1000);
  assert.throws(() => state.prepareEscape(fixed, { players, consumedItems: [], playerParticipants: returnEnvelope(history) }), /Fixed battle/);
  assert.deepEqual(state.snapshot(), before);
});

test("return ledgers must preserve initial owner/source/slot history and bind every later owner", () => {
  const { state } = ownershipFixture(), before = state.snapshot(), lease = state.openBattle(1000, undefined, plan());
  const borrow = state.battlePlayerBorrow(lease)!, history = entered(borrow), players = finalPlayers(borrow, history);
  for (const change of [
    (value: BattlePlayerReturn) => { value.state.entries[0]!.slot = 1; },
    (value: BattlePlayerReturn) => { value.state.entries[0]!.sourceId = 999; },
    (value: BattlePlayerReturn) => { value.state.entries.splice(0, 1); },
    (value: BattlePlayerReturn) => { value.state.entries.filter(entry => entry.ownedId === "e").forEach(entry => { entry.ownedId = "unknown"; entry.sourceId = 88; });
      value.observations[2]!.ownedId = "unknown"; },
    (value: BattlePlayerReturn) => { value.state.nextGeneration++; },
  ]) { const bad = returnEnvelope(history); change(bad);
    assert.throws(() => state.prepareEscape(lease, { players, consumedItems: [], playerParticipants: bad }));
    assert.deepEqual(state.snapshot(), before); }
});

test("all-entered owners settle once across repeated entry while persistent party and availability stay fixed", () => {
  const { state } = ownershipFixture(), before = state.snapshot(), lease = state.openBattle(1000, undefined, plan());
  const borrow = state.battlePlayerBorrow(lease)!, history = entered(borrow), result = victory(state, lease, borrow, history);
  assert.deepEqual(result.players.map(player => player.id), ["a", "b", "e", "c", "d"]);
  result.players[2]!.hp = 77; result.players[3]!.mp = 3;
  const returned = state.prepareVictory(lease, result);
  result.players[2]!.hp = 1; result.playerParticipants!.state.entries.length = 0;
  assert.deepEqual(state.snapshot(), before); returned();
  const after = state.snapshot();
  assert.deepEqual(after.party, before.party);
  assert.deepEqual(after.roster.map(member => [member.id, member.enabled]), before.roster.map(member => [member.id, member.enabled]));
  assert.deepEqual(after.roster.map(member => member.exp), [7, 7, 7, 7, 7]);
  assert.equal(after.roster.find(member => member.id === "e")!.hp, 77);
  assert.equal(after.roster.find(member => member.id === "c")!.mp, 3);
  assert.deepEqual(after.completedBattles, [{ serial: 0, encounterId: 1000, outcome: "victory" }]);
  assert.throws(returned, /Stale/); state.restore(after); assert.deepEqual(state.snapshot(), after);
});

test("duplicate owner returns, first-entry order, award order and latest row mismatch cannot publish rewards", () => {
  const { state } = ownershipFixture(), before = state.snapshot(), lease = state.openBattle(1000, undefined, plan());
  const borrow = state.battlePlayerBorrow(lease)!, history = entered(borrow), result = victory(state, lease, borrow, history);
  const changes: ((value: BattleVictoryResult) => void)[] = [
    value => { value.players[3] = structuredClone(value.players[2]!); },
    value => { [value.players[2], value.players[3]] = [value.players[3]!, value.players[2]!]; },
    value => { value.awardedExperience!.reverse(); },
    value => { delete value.awardedExperience; },
    value => { delete value.awardedExperience![0]; },
    value => { value.observedAbilityIds = [142]; },
    value => { value.players[3]!.row = "front"; },
    value => { value.playerParticipants!.observations.pop(); },
  ];
  for (const change of changes) { const bad = structuredClone(result); change(bad);
    assert.throws(() => state.prepareVictory(lease, bad)); assert.deepEqual(state.snapshot(), before); }
});

test("late invalid borrowed resources leave inventory and lease unchanged for a corrected atomic return", () => {
  const { state } = ownershipFixture(); state.changeItems([{ id: 10, count: 2 }], "grant");
  const before = state.snapshot(), lease = state.openBattle(1000, undefined, plan()), borrow = state.battlePlayerBorrow(lease)!;
  const result = victory(state, lease, borrow, entered(borrow)); result.consumedItems = [{ id: 10, count: 1 }];
  result.players.at(-1)!.mp = -1;
  assert.throws(() => state.prepareVictory(lease, result), /integer/); assert.deepEqual(state.snapshot(), before);
  result.players.at(-1)!.mp = 0; state.prepareVictory(lease, result)();
  assert.equal(state.snapshot().items.find(item => item.id === 10)!.count, 1);
  assert.equal(state.gil, before.gil + 7);
});

test("escape returns every entered owner without growth, learning, party mutation or awards", () => {
  const { state } = ownershipFixture(), before = state.snapshot(), lease = state.openBattle(1000, undefined, plan());
  const borrow = state.battlePlayerBorrow(lease)!, history = entered(borrow), players = finalPlayers(borrow, history);
  const observed = returnEnvelope(history, { e: [142] });
  assert.throws(() => state.prepareEscape(lease, { players, consumedItems: [], playerParticipants: observed }), /cannot learn/);
  players[2]!.level++;
  assert.throws(() => state.prepareEscape(lease, { players, consumedItems: [], playerParticipants: returnEnvelope(history) }), /cannot change owned growth/);
  players[2]!.level--; players[2]!.hp = 91;
  state.prepareEscape(lease, { players, consumedItems: [], playerParticipants: returnEnvelope(history) })();
  const after = state.snapshot();
  assert.deepEqual(after.party, before.party); assert.equal(after.gil, before.gil);
  assert.deepEqual(after.roster.map(member => [member.exp, member.level, member.enabled]), before.roster.map(member => [member.exp, member.level, member.enabled]));
  assert.equal(after.roster.find(member => member.id === "e")!.hp, 91);
  assert.equal(after.completedBattles[0]!.outcome, "escaped");
});

test("progression uses explicit first-entry ordinals as pure projections and retry restores the same pool", () => {
  const { state, catalog } = ownershipFixture(), before = state.snapshot(), lease = state.openBattle(1000, undefined, plan());
  const borrow = state.battlePlayerBorrow(lease)!, provider = state.battleProgression(lease, catalog.common.experience)!;
  const initial = borrow.candidates[0]!, later = borrow.candidates[2]!;
  assert.throws(() => provider(initial, 7, [], 0), /Missing.*index/);
  assert.throws(() => provider(initial, 7, [], 0, 1), /Initial.*index/);
  assert.throws(() => provider(later, 7, [], 0, -1), /integer/);
  assert.throws(() => provider({ ...later, id: "not-held" }, 7, [], 0, 2), /identity changed/);
  assert.deepEqual(provider(later, 7, [], 0, 2), provider(later, 7, [], 0, 9));
  assert.equal(provider(initial, 7, [], 0, 0).level, 3);
  assert.deepEqual(state.snapshot(), before);
  state.cancelBattle(lease); assert.throws(() => provider(later, 7, [], 0, 2), /Stale/);
  const retry = state.openBattle(1000, undefined, plan());
  assert.deepEqual(state.battlePlayerBorrow(retry), borrow); assert.deepEqual(state.snapshot(), before);
});

/** Five source-shaped held owners with explicit authored identities. Their
 * source8 learning provider is recovered, but this layout grants no story. */
function sourceOwnershipFixture() {
  const f = characterLearningSessionFixture(), content = f.battle.gameState, definition = content.sourceNewGame!;
  const original = content.characterInitializations![f.id]!, originalPlayer = f.battle.common.players[0]!;
  const owners = [{ id: "learner:20", sourceId: 20 }, { id: "learner:21", sourceId: 21 },
    { id: "learner:22", sourceId: 22 }, { id: "learner:23", sourceId: 23 }, { id: "observer:8", sourceId: 8 }];
  definition.characters = []; content.characterInitializations = {}; content.characterGrowth = {};
  content.equipment = {}; content.equipmentSystem!.contexts = {}; content.rosterLifecycle.initial = {};
  f.battle.common.players = [];
  for (const [index, owner] of owners.entries()) {
    const template = structuredClone(original);
    template.initial.sourceId = template.equipmentCharacter.sourceId = owner.sourceId;
    template.nameTag = "OWNER_TAG_" + owner.sourceId;
    const growth = { ...structuredClone(f.learning.plan), sourceId: owner.sourceId,
      initialAbilities: structuredClone(template.initial.abilities) };
    growth.commands.push({ id: 100, abilityTypes: [] });
    if (index < 4) definition.characters.push({ id: owner.id, template: structuredClone(template) });
    definition.equipment.characters[owner.sourceId] = structuredClone(template.equipmentCharacter);
    content.characterInitializations[owner.id] = template; content.characterGrowth[owner.id] = growth;
    content.equipment[owner.id] = [...template.initial.equipment];
    content.equipmentSystem!.catalog.characters[owner.sourceId] = structuredClone(template.equipmentCharacter);
    content.equipmentSystem!.contexts[owner.id] = structuredClone(template.parameterContext);
    content.rosterLifecycle.initial[owner.id] = { ownedId: index + 1, jobId: 12, additionalLevel: 2, magicStoneId: 0,
      ownedJobs: [{ id: 12, level: 1, proficiency: 0 }, { id: 1, level: 1, proficiency: 0 }] };
    f.battle.common.players.push({ ...structuredClone(originalPlayer), id: owner.id, sourceId: owner.sourceId });
  }
  definition.party = fixtureParty(owners.slice(0, 4).map(owner => owner.id));
  content.initialParty = structuredClone(definition.party);
  content.equipmentSystem!.initialStock = createNewGame(definition).owned.equipmentStock;
  content.battleDefinitions = structuredClone(f.battle.common.players);
  const state = GameState.createNewGame(content, f.battle.common.players.slice(0, 4), "controlled-source-owners", f.battle.common.conditions);
  state.fieldRoster.prepare({ kind: "unlock", sourceId: 8, refreshActors: false }).commit();
  const saved = state.snapshot();
  saved.party.slots[1][0] = { id: owners[0]!.id, row: "front" };
  saved.roster[4]!.enabled = false; state.restore(saved);
  return { state, f, owners };
}

test("owner observations isolate learning and first-entry receipt ordinals can exceed the four live slots", () => {
  const { state, owners } = sourceOwnershipFixture(), before = state.snapshot();
  const policy = { kind: "battle-reward-policy-v1" as const, ap: 0 as const, magicPoints: 0 };
  const lease = state.openBattle(1000, policy, { ...plan(), sourceIds: [8], groups: [1] }), borrow = state.battlePlayerBorrow(lease)!;
  let history = projectPlayerGroup(createBattlePlayerState(borrow.initial), borrow.groups[1]!).state;
  history = projectPlayerJoin(history, { ownedId: owners[4]!.id, sourceId: 8 }).state;
  const players = finalPlayers(borrow, history), provider = state.battleProgression(lease)!;
  const observations = { "observer:8": [142] }, envelope = returnEnvelope(history, observations);
  for (const [index, player] of players.entries()) Object.assign(player, provider(player, 1, envelope.observations[index]!.abilityIds, 0, index));
  const result: BattleVictoryResult = { players, consumedItems: [], gil: 0, magicPoints: 0,
    awardedExperience: players.map(player => ({ id: player.id, amount: 1 })),
    observedAbilityIds: [142], playerParticipants: envelope };
  const wrong = structuredClone(result); wrong.playerParticipants!.observations[4]!.abilityIds = [];
  assert.throws(() => state.prepareVictory(lease, wrong), /union/); assert.deepEqual(state.snapshot(), before);
  state.prepareVictory(lease, result)();
  const saved = state.snapshot(), observer = saved.roster.find(member => member.id === "observer:8")!;
  assert.deepEqual(observer.growth!.observedLearning.map(receipt => [receipt.participantIndex, receipt.observedAbilityIds]), [[4, [142]]]);
  assert.equal(observer.abilities!.owned.find(ability => ability.abilityId === 142)!.skillLevel, 100);
  for (const member of saved.roster.filter(member => member.id !== observer.id)) {
    assert.equal(member.growth!.observedLearning.length, 0);
    assert.equal(member.abilities!.owned.find(ability => ability.abilityId === 142)!.skillLevel, 0);
  }
  assert.deepEqual(saved.nativeState!.ownedMagic, [742]); assert.deepEqual(saved.party, before.party);
  state.restore(saved); assert.deepEqual(state.snapshot(), saved);
});

test("return observation parser rejects missing, repeated and sparse per-owner lists and remains detached", () => {
  const { state } = ownershipFixture(), lease = state.openBattle(1000, undefined, plan()), history = entered(state.battlePlayerBorrow(lease)!);
  const valid = returnEnvelope(history, { e: [142, 161] }), parsed = parseBattlePlayerReturn(valid);
  parsed.state.entries[0]!.sourceId = 999; parsed.observations[2]!.abilityIds.pop();
  assert.equal(valid.state.entries[0]!.sourceId, 1); assert.deepEqual(valid.observations[2]!.abilityIds, [142, 161]);
  for (const change of [
    (value: BattlePlayerReturn) => { value.observations[2]!.abilityIds = [142, 142]; },
    (value: BattlePlayerReturn) => { value.observations[2]!.ownedId = "a"; },
    (value: BattlePlayerReturn) => { delete value.observations[2]!.abilityIds[0]; },
    (value: BattlePlayerReturn) => { value.observations.pop(); },
  ]) { const bad = structuredClone(valid); change(bad); assert.throws(() => parseBattlePlayerReturn(bad)); }
});
