import test from "node:test";
import assert from "node:assert/strict";
import { GameState, type BattleVictoryResult, type GameStateSnapshot,
  type LegacyGameStateSnapshotV10, type LegacyGameStateSnapshotV11 } from "../src/core/game-state.js";
import type { BattleRewardPolicy } from "../src/core/battle-result.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";
import { equipmentGameFixture } from "./fixtures/equipment-game.js";
import { characterLearningSessionFixture } from "./fixtures/character-learning-session.js";

const policy = (magicPoints: number): BattleRewardPolicy => ({ kind: "battle-reward-policy-v1", ap: 0, magicPoints });

/** Authored state/transaction probes. These values are not granted to the real
 * game, and the source-shaped fixture is not evidence of story acquisition. */
function synthetic() {
  const { battle } = checkpointFixture();
  const make = () => new GameState(battle.gameState, battle.common.players, battle.contentHash, battle.common.conditions);
  return { battle, make, state: make() };
}
function sourceOwner() {
  const f = characterLearningSessionFixture();
  const make = () => GameState.createNewGame(f.battle.gameState, f.battle.common.players,
    f.battle.contentHash, f.battle.common.conditions);
  return { ...f, make, state: make() };
}
function setPoints(state: GameState, values: number[]) {
  const next = state.snapshot();
  assert.equal(next.roster.length, values.length);
  next.roster.forEach((member, index) => { member.magicLearningValue = values[index]!; });
  state.restore(next);
}
function legacy11(snapshot: GameStateSnapshot): LegacyGameStateSnapshotV11 {
  return { ...structuredClone(snapshot), formatVersion: 11,
    completedBattles: snapshot.completedBattles.map(receipt => {
      if (receipt.outcome === "forced") throw new Error("Forced receipt cannot be represented by historical v11");
      return { ...receipt, outcome: receipt.outcome };
    }),
    roster: snapshot.roster.map(({ magicLearningValue: _, ...member }) => structuredClone(member)) };
}
function legacy10(snapshot: GameStateSnapshot): LegacyGameStateSnapshotV10 {
  return { ...legacy11(snapshot), formatVersion: 10,
    completedBattles: snapshot.completedBattles.map(({ serial, encounterId }) => ({ serial, encounterId })) };
}

test("owned initialization starts at zero and battle projections are detached per character", () => {
  const { state } = synthetic();
  assert.equal(state.snapshot().formatVersion, 12);
  assert.deepEqual(state.snapshot().roster.map(p => p.magicLearningValue), [0, 0]);
  setPoints(state, [17, 31]);
  const party = state.partyPlayers();
  assert.deepEqual(party.map(p => p.magicLearningValue), [17, 31]);
  party[0]!.magicLearningValue = 127;
  const lease = state.openBattle(1000, policy(0));
  const players = state.battlePlayers(lease);
  assert.deepEqual(players.map(p => p.magicLearningValue), [17, 31]);
  players[1]!.magicLearningValue = 99;
  assert.deepEqual(state.battlePlayers(lease).map(p => p.magicLearningValue), [17, 31]);
  state.cancelBattle(lease);
  assert.deepEqual(sourceOwner().state.snapshot().roster.map(p => p.magicLearningValue), [0]);
});

test("source ownership requires a valid explicit reward policy before borrowing a battle", () => {
  const { state } = sourceOwner(), before = state.snapshot();
  assert.throws(() => state.openBattle(1000), /explicit reward policy/);
  for (const invalid of [null, {}, { ...policy(0), ap: 1 }, policy(-1), policy(0.5),
    { ...policy(0), magicPoints: "3" }, { ...policy(0), unknown: 1 }]) {
    assert.throws(() => state.openBattle(1000, invalid as BattleRewardPolicy));
    assert.deepEqual(state.snapshot(), before);
  }
  const lease = state.openBattle(1000, policy(0));
  assert.equal(lease.serial, 0);
  state.cancelBattle(lease);
  const fixture = synthetic().state;
  assert.throws(() => fixture.openBattle(1000, null as unknown as BattleRewardPolicy));
  fixture.cancelBattle(fixture.openBattle(1000));
});

test("full magic points reach each living owner, cap independently and publish once with other rewards", () => {
  const { state, make } = synthetic();
  setPoints(state, [10, 125]);
  const before = state.snapshot(), sourcePolicy = policy(7), lease = state.openBattle(1000, sourcePolicy);
  sourcePolicy.magicPoints = 99; // A caller cannot edit the leased reward.
  const players = state.battlePlayers(lease);
  players[0]!.magicLearningValue = 17;
  players[1]!.magicLearningValue = 128;
  players[0]!.mp -= 2;
  const publish = state.prepareVictory(lease, { players, magicPoints: 7, gil: 4, consumedItems: [] });
  assert.deepEqual(state.snapshot(), before);
  players[0]!.magicLearningValue = 1;
  publish();
  assert.deepEqual(state.snapshot().roster.map(p => p.magicLearningValue), [17, 128]);
  assert.equal(state.snapshot().roster[0]!.mp, before.roster[0]!.mp - 2);
  assert.equal(state.gil, before.gil + 4);
  assert.deepEqual(state.snapshot().completedBattles, [{ serial: 0, encounterId: 1000, outcome: "victory" }]);
  assert.throws(publish, /Stale/);
  const restored = make(); restored.restore(JSON.parse(JSON.stringify(state.snapshot())));
  const nextLease = restored.openBattle(1001, policy(0));
  assert.deepEqual(restored.battlePlayers(nextLease).map(p => p.magicLearningValue), [17, 128]);
  restored.cancelBattle(nextLease);
});

test("eligibility depends on surviving the battle, not a positive EXP share", () => {
  const { state, battle } = synthetic(); setPoints(state, [20, 20]);
  const lease = state.openBattle(1000, policy(3)), players = state.battlePlayers(lease);
  players[0]!.magicLearningValue = 23;
  players[1]!.hp = 0;
  players[1]!.conditionIds = [battle.common.conditions.hpZeroConditionId];
  state.prepareVictory(lease, { players, magicPoints: 3, gil: 0, consumedItems: [],
    awardedExperience: [{ id: "a", amount: 0 }, { id: "b", amount: 0 }] })();
  const after = state.snapshot();
  assert.deepEqual(after.roster.map(p => p.magicLearningValue), [23, 20]);
  assert.deepEqual(after.roster.map(p => p.exp), [0, 0]);
});

test("source growth callback reprojects the current reserve without accumulating preview calls", () => {
  const { state, battle } = sourceOwner(); setPoints(state, [126]);
  const before = state.snapshot(), lease = state.openBattle(1000, policy(5));
  const player = state.battlePlayers(lease)[0]!, project = state.battleProgression(lease, battle.common.experience)!;
  assert.throws(() => project(player, 0, [], 4), /leased reward policy/);
  const first = project(player, 0, [], 5);
  assert.equal(first.magicLearningValue, 128);
  Object.assign(player, first);
  assert.equal(project(player, 0, [], 5).magicLearningValue, 128);
  assert.deepEqual(state.snapshot(), before);
  state.prepareVictory(lease, { players: [player], magicPoints: 5, gil: 0, consumedItems: [],
    awardedExperience: [{ id: player.id, amount: 0 }], observedAbilityIds: [] })();
  assert.equal(state.snapshot().roster[0]!.magicLearningValue, 128);
  assert.deepEqual(state.snapshot().roster[0]!.growth, before.roster[0]!.growth);
  assert.throws(() => project(player, 0, [], 5), /Stale/);
});

test("synthetic equipment progression exposes points independently from level and parameter growth", () => {
  const { catalog } = equipmentGameFixture();
  const state = new GameState(catalog.gameState, catalog.common.players, catalog.contentHash, catalog.common.conditions);
  setPoints(state, [6, 11]);
  const lease = state.openBattle(1000, policy(2)), players = state.battlePlayers(lease);
  const project = state.battleProgression(lease, catalog.common.experience)!;
  const alive = project(players[0]!, 5, [], 2);
  assert.equal(alive.level, 3);
  assert.equal(alive.exp, 5);
  assert.equal(alive.maxHp, 145);
  assert.equal(alive.magicLearningValue, 8);
  players[1]!.hp = 0;
  players[1]!.conditionIds = [catalog.common.conditions.hpZeroConditionId];
  assert.equal(project(players[1]!, 0, [], 2).magicLearningValue, 11);
  state.cancelBattle(lease);
});

test("one source transaction retains observation learning while adding the separate reserve", () => {
  const { state, battle, make, id } = sourceOwner(); setPoints(state, [12]);
  const before = state.snapshot(), lease = state.openBattle(1000, policy(7));
  const player = state.battlePlayers(lease)[0]!;
  Object.assign(player, state.battleProgression(lease, battle.common.experience)!(player, 0, [142], 7));
  const commit = state.prepareVictory(lease, { players: [player], magicPoints: 7, gil: 0, consumedItems: [],
    awardedExperience: [{ id, amount: 0 }], observedAbilityIds: [142] });
  assert.deepEqual(state.snapshot(), before);
  commit();
  const saved = state.snapshot();
  assert.equal(saved.roster[0]!.magicLearningValue, 19);
  assert.equal(saved.roster[0]!.abilities!.owned.find(a => a.abilityId === 142)!.skillLevel, 100);
  assert.deepEqual(saved.nativeState!.ownedMagic, [742]);
  assert.deepEqual(saved.learnedAbilityIds, before.learnedAbilityIds);
  assert.deepEqual(saved.roster[0]!.equipment, before.roster[0]!.equipment);
  const restored = make(); restored.restore(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(restored.snapshot(), saved);
});

test("a source observer who later dies keeps recorded learning but receives no magic points", () => {
  const { state, battle, id } = sourceOwner(); setPoints(state, [15]);
  const before = state.snapshot(), lease = state.openBattle(1000, policy(9));
  const player = state.battlePlayers(lease)[0]!;
  player.hp = 0; player.conditionIds = [battle.common.conditions.hpZeroConditionId];
  const projected = state.battleProgression(lease, battle.common.experience)!(player, 0, [142], 9);
  assert.equal(projected.magicLearningValue, 15);
  Object.assign(player, projected);
  state.prepareVictory(lease, { players: [player], magicPoints: 9, gil: 0, consumedItems: [],
    awardedExperience: [{ id, amount: 0 }], observedAbilityIds: [142] })();
  const saved = state.snapshot();
  assert.equal(saved.roster[0]!.hp, 0);
  assert.equal(saved.roster[0]!.magicLearningValue, 15);
  assert.equal(saved.roster[0]!.exp, before.roster[0]!.exp);
  assert.deepEqual(saved.nativeState!.ownedMagic, [742]);
});

test("reward or late member forgery cannot publish earlier inventory, resource or currency changes", () => {
  const { state } = synthetic();
  const stock = state.snapshot(); stock.items = [{ id: 10, count: 2 }]; state.restore(stock);
  const before = state.snapshot(), lease = state.openBattle(1000, policy(3));
  const players = state.battlePlayers(lease);
  players[0]!.magicLearningValue = 3; players[1]!.magicLearningValue = 3;
  players[0]!.hp -= 10;
  const good: BattleVictoryResult = { players, magicPoints: 3, gil: 7, consumedItems: [{ id: 10, count: 1 }] };
  for (const value of [undefined, null, -1, 0, 2, 3.5, "3", Number.NaN]) {
    const bad = { ...good, magicPoints: value } as BattleVictoryResult;
    assert.throws(() => state.prepareVictory(lease, bad), /magic points/);
    assert.deepEqual(state.snapshot(), before);
  }
  for (const value of [undefined, 2, 128, -1, null]) {
    const bad = structuredClone(good);
    (bad.players[1] as unknown as Record<string, unknown>).magicLearningValue = value;
    assert.throws(() => state.prepareVictory(lease, bad), /magic learning projection/);
    assert.deepEqual(state.snapshot(), before);
  }
  state.prepareVictory(lease, good)();
  assert.deepEqual(state.snapshot().items, [{ id: 10, count: 1 }]);
  assert.deepEqual(state.snapshot().roster.map(p => p.magicLearningValue), [3, 3]);
  assert.equal(state.gil, before.gil + 7);
});

test("missing zero metadata is compatible only with old synthetic result hooks", () => {
  const { state } = synthetic(), lease = state.openBattle(1000);
  const players = state.battlePlayers(lease);
  for (const player of players) delete player.magicLearningValue;
  state.prepareVictory(lease, { players, gil: 0, consumedItems: [] })();
  const source = sourceOwner().state, sourceLease = source.openBattle(1000, policy(0));
  const result = { players: source.battlePlayers(sourceLease), gil: 0, consumedItems: [] };
  assert.throws(() => source.prepareVictory(sourceLease, result), /magic points/);
  delete result.players[0]!.magicLearningValue;
  assert.throws(() => source.prepareVictory(sourceLease, { ...result, magicPoints: 0 }), /magic learning projection/);
  source.cancelBattle(sourceLease);
});

test("cancelled and same-serial replacement leases cannot publish a stale reserve or reward", () => {
  const { state } = synthetic();
  const before = state.snapshot(), lease = state.openBattle(1000, policy(2)), players = state.battlePlayers(lease);
  players.forEach(p => { p.magicLearningValue = 2; });
  const pending = state.prepareVictory(lease, { players, magicPoints: 2, gil: 9, consumedItems: [] });
  state.cancelBattle(lease);
  const retry = state.openBattle(1000, policy(2));
  assert.equal(retry.serial, lease.serial);
  assert.throws(pending.validate, /Stale/);
  assert.throws(pending, /Stale/);
  assert.deepEqual(state.snapshot(), before);
  state.prepareVictory(retry, { players, magicPoints: 2, gil: 9, consumedItems: [] })();
  assert.equal(state.snapshot().completedBattles.length, 1);
  assert.deepEqual(state.snapshot().roster.map(p => p.magicLearningValue), [2, 2]);
});

test("escape preserves entry reserves even when the encounter has positive victory points", () => {
  const { state } = synthetic(); setPoints(state, [19, 128]);
  const before = state.snapshot(), lease = state.openBattle(1000, policy(13)), players = state.battlePlayers(lease);
  players[0]!.hp -= 5;
  const forged = structuredClone(players); forged[0]!.magicLearningValue = 32;
  assert.throws(() => state.prepareEscape(lease, { players: forged, consumedItems: [] }), /magic learning projection/);
  assert.throws(() => state.prepareEscape(lease, { players, consumedItems: [], magicPoints: 13 } as never), /field/);
  assert.deepEqual(state.snapshot(), before);
  state.prepareEscape(lease, { players, consumedItems: [] })();
  const after = state.snapshot();
  assert.deepEqual(after.roster.map(p => p.magicLearningValue), [19, 128]);
  assert.equal(after.gil, before.gil);
  assert.deepEqual(after.completedBattles, [{ serial: 0, encounterId: 1000, outcome: "escaped" }]);
  assert.deepEqual(state.completedEncounters, []);
});

test("v12 stores a bounded current reserve without inventing a second historical ledger", () => {
  const { state } = synthetic(), initial = state.snapshot();
  for (const value of [0, 17, 128]) {
    const candidate = structuredClone(initial); candidate.roster[0]!.magicLearningValue = value;
    state.restore(candidate);
    assert.equal(state.snapshot().roster[0]!.magicLearningValue, value);
    assert.deepEqual(state.snapshot().completedBattles, []);
  }
  const before = state.snapshot();
  for (const value of [undefined, null, false, "2", -0, -1, 129, 1.5, Number.NaN]) {
    const bad = structuredClone(before);
    (bad.roster[0] as unknown as Record<string, unknown>).magicLearningValue = value;
    assert.throws(() => state.restore(bad));
    assert.deepEqual(state.snapshot(), before);
  }
  const missing = structuredClone(before);
  delete (missing.roster[0] as unknown as Record<string, unknown>).magicLearningValue;
  assert.throws(() => state.restore(missing), /field/);
});

test("strict v11 and v10 migration supplies only the previously unavailable reserve", () => {
  const { state, make } = synthetic(), current = state.snapshot();
  current.completedBattles = [{ serial: 0, encounterId: 1000, outcome: "escaped" }];
  const old11 = legacy11(current), original11 = structuredClone(old11);
  state.restore(old11);
  assert.equal(state.snapshot().formatVersion, 12);
  assert.deepEqual(state.snapshot().roster.map(p => p.magicLearningValue), [0, 0]);
  assert.deepEqual(state.snapshot().completedBattles, current.completedBattles);
  assert.deepEqual(old11, original11);
  const old10 = legacy10(current), restored10 = make();
  restored10.restore(old10);
  assert.deepEqual(restored10.snapshot().completedBattles, [{ serial: 0, encounterId: 1000, outcome: "victory" }]);
  assert.equal(restored10.snapshot().catalogHash, current.catalogHash);
  assert.deepEqual(restored10.snapshot().roster.map(p => p.magicLearningValue), [0, 0]);
});

test("legacy migration rejects smuggled new fields, malformed receipts and mismatched identity atomically", () => {
  const { state } = synthetic(), before = state.snapshot();
  for (const version of [10, 11] as const) {
    const make = () => version === 10 ? legacy10(before) : legacy11(before);
    const cases: ((bad: ReturnType<typeof make>) => void)[] = [
      b => { (b.roster[0] as unknown as Record<string, unknown>).magicLearningValue = 0; },
      b => { delete (b.roster[0] as unknown as Record<string, unknown>).mp; },
      b => { (b as unknown as Record<string, unknown>).extra = 1; },
      b => { b.catalogHash = "different content"; },
      b => { b.completedBattles = [{ serial: 0, encounterId: 1000, other: true }] as never; },
      b => { b.completedBattles = [{ serial: 0, encounterId: 1000, outcome: "invented" }] as never; },
    ];
    for (const edit of cases) {
      const bad = make(); edit(bad);
      assert.throws(() => state.restore(bad));
      assert.deepEqual(state.snapshot(), before);
    }
  }
});

test("first Join initializes the reserve once; rejoining an existing owner preserves it", () => {
  const f = characterLearningSessionFixture(), content = f.battle.gameState, id = "controlled-second-owner";
  const template = structuredClone(content.characterInitializations![f.id]!);
  template.initial.sourceId = 9; template.equipmentCharacter.sourceId = 9;
  template.initial.name = "Second owner"; template.nameTag = "SECOND_OWNER";
  content.characterInitializations![id] = template;
  content.characterGrowth![id] = { ...structuredClone(content.characterGrowth![f.id]!), sourceId: 9 };
  content.equipmentSystem!.catalog.characters[9] = structuredClone(template.equipmentCharacter);
  content.equipmentSystem!.contexts[id] = structuredClone(template.parameterContext);
  content.rosterLifecycle.firstJoinLevelAdjustments = { 9: 0 };
  content.partyActors!.characterAssets.push({ id: 909, sourceId: 9, jobId: template.initial.jobId, fieldAssetId: 2 });
  const state = GameState.createNewGame(content, f.battle.common.players, f.battle.contentHash, f.battle.common.conditions);
  const command = { kind: "join" as const, sourceId: 9, position: null, row: "front" as const,
    refreshActors: false, recovery: false, refitEquipment: false };
  const before = state.snapshot(), pending = state.fieldRoster.prepare(command);
  assert.deepEqual(state.snapshot(), before);
  pending.commit();
  assert.equal(state.snapshot().roster.find(p => p.id === id)!.magicLearningValue, 0);
  const saved = state.snapshot(); saved.roster.find(p => p.id === id)!.magicLearningValue = 24;
  state.restore(saved);
  state.fieldRoster.prepare(command).commit();
  assert.equal(state.snapshot().roster.find(p => p.id === id)!.magicLearningValue, 24);
  assert.equal(state.snapshot().roster.filter(p => p.id === id).length, 1);
});

test("positive points do not authorize magic-stone, equipment or battle-background learning", () => {
  for (const blocked of ["equipment", "background"] as const) {
    const fixture = sourceOwner(), { battle, id } = fixture;
    const plan = battle.gameState.characterGrowth![id]!;
    if (blocked === "equipment") plan.equipmentLearningContentIds = [fixture.state.snapshot().roster[0]!.equipment[0]!];
    else plan.hasBattleBackgroundLearning = true;
    const state = fixture.make(), before = state.snapshot();
    const lease = state.openBattle(1000, policy(5)), player = state.battlePlayers(lease)[0]!;
    assert.throws(() => state.battleProgression(lease, battle.common.experience)!(player, 0, [], 5), /learning provider/);
    player.magicLearningValue = 5;
    assert.throws(() => state.prepareVictory(lease, { players: [player], magicPoints: 5, gil: 0, consumedItems: [],
      awardedExperience: [{ id, amount: 0 }], observedAbilityIds: [] }), /learning provider/);
    assert.deepEqual(state.snapshot(), before);
    state.cancelBattle(lease);
  }
  const { state } = sourceOwner(), before = state.snapshot(), invalid = state.snapshot();
  invalid.roster[0]!.magicLearningValue = 128;
  invalid.roster[0]!.magicStoneId = 1;
  assert.throws(() => state.restore(invalid), /magic stone/);
  assert.deepEqual(state.snapshot(), before);
});
