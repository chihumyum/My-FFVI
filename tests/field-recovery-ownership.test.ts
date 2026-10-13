import test from "node:test";
import assert from "node:assert/strict";
import { GameState } from "../src/core/game-state.js";
import { executeFieldRecoveryEvent, type FieldRecoveryCommand } from "../src/core/field-recovery.js";
import { equipmentGameFixture } from "./fixtures/equipment-game.js";
import { characterLearningSessionFixture } from "./fixtures/character-learning-session.js";
import { fixtureParty } from "./fixtures/party.js";

const hp: FieldRecoveryCommand = { kind: "recover-hp", amount: 20, target: 0,
  allowUnableFight: true, allowMineralization: false };
const mp: FieldRecoveryCommand = { ...hp, kind: "recover-mp", amount: 7, allowUnableFight: false };

function recoveryFixture() {
  const { catalog } = equipmentGameFixture();
  const make = () => new GameState(catalog.gameState, catalog.common.players, catalog.contentHash, catalog.common.conditions);
  const state = make(), injured = state.snapshot();
  injured.roster[0]!.hp = 50; injured.roster[0]!.mp = 3;
  injured.roster[1]!.hp = 40; injured.roster[1]!.mp = 4;
  state.restore(injured);
  return { state, make, catalog };
}

test("field recovery prepares detached source-ordered appearance and commits existing owners once", () => {
  const { state } = recoveryFixture(), dead = state.snapshot();
  for (const member of dead.roster) { member.hp = 0; member.conditionIds = [305]; }
  state.restore(dead);
  const input = { ...hp }, prepared = state.fieldRecovery.prepare(input), before = state.snapshot();
  assert.deepEqual(prepared.targets, ["a", "b"]);
  assert.deepEqual(prepared.steps.map(step => [step.targetId, step.setDummy, step.affectLeader]),
    [["a", false, true], ["b", false, true]]);
  assert.deepEqual(prepared.steps[0]!.appearance.activeMembers.map(member => member.conditionIds), [[], [305]]);
  assert.deepEqual(prepared.steps[1]!.appearance.activeMembers.map(member => member.conditionIds), [[], []]);
  input.amount = 9999; prepared.targets.reverse();
  prepared.steps[0]!.appearance.activeMembers[0]!.conditionIds.push(305);
  assert.deepEqual(state.snapshot(), before);
  prepared.commit(); assert.throws(prepared.commit, /Stale/);
  const after = state.snapshot();
  assert.deepEqual(after.roster.map(member => [member.hp, member.conditionIds]), [[21, []], [21, []]]);
  assert.deepEqual(after.party, before.party);
  assert.deepEqual(after.roster.map(member => [member.id, member.enabled, member.equipment]),
    before.roster.map(member => [member.id, member.enabled, member.equipment]));
  assert.deepEqual(after.completedBattles, []);
});

test("current Corps includes held disabled owners, enabled roster includes reserves, and positive source never creates one", () => {
  const { state } = recoveryFixture(), saved = state.snapshot();
  saved.roster[0]!.enabled = false; saved.party = fixtureParty(["a"]); state.restore(saved);
  const before = state.snapshot();
  state.fieldRecovery.prepare(hp).commit();
  assert.deepEqual(state.snapshot().roster.map(member => member.hp), [70, 40]);
  state.fieldRecovery.prepare({ ...mp, target: -1 }).commit();
  assert.deepEqual(state.snapshot().roster.map(member => member.mp), [3, 11]);
  state.fieldRecovery.prepare({ ...mp, target: 1 }).commit();
  assert.deepEqual(state.snapshot().roster.map(member => member.mp), [10, 11]);
  const stable = state.snapshot();
  assert.throws(() => state.fieldRecovery.prepare({ ...hp, target: 99 }), /Unknown|owned|selector/);
  assert.deepEqual(state.snapshot(), stable);
  assert.deepEqual(stable.roster.map(member => [member.id, member.enabled]), before.roster.map(member => [member.id, member.enabled]));
  assert.deepEqual(stable.party, before.party);
});

test("discarded map recovery stays private and mixed inventory/recovery transactions share one generation", () => {
  const { state } = recoveryFixture(), before = state.snapshot(), discarded = state.prepareFieldState();
  discarded.ports.recovery.prepare(hp).commit();
  discarded.ports.inventory.prepare({ kind: "grant-gil", amount: 100 }).commit();
  assert.deepEqual(state.snapshot(), before);
  const draft = state.prepareFieldState(), staleRecovery = draft.ports.recovery.prepare(hp);
  draft.ports.inventory.prepare({ kind: "grant-gil", amount: 7 }).commit();
  assert.throws(staleRecovery.commit, /Stale/);
  const staleInventory = draft.ports.inventory.prepare({ kind: "grant-gil", amount: 200 });
  const current = draft.ports.recovery.prepare(hp); current.commit();
  assert.throws(current.commit, /Stale/); assert.throws(staleInventory.commit, /Stale/);
  const late = draft.ports.recovery.prepare(mp);
  assert.deepEqual(state.snapshot(), before);
  assert.equal(draft.commit(), true); assert.equal(draft.commit(), false); assert.equal(discarded.commit(), false);
  assert.equal(state.gil, before.gil + 7);
  assert.deepEqual(state.snapshot().roster.map(member => member.hp), [70, 60]);
  assert.throws(late.commit, /Stale/);
  // The same map's port now targets the live owner, not its obsolete candidate.
  draft.ports.recovery.prepare(mp).commit();
  assert.deepEqual(state.snapshot().roster.map(member => member.mp), [10, 11]);
});

test("a changed live owner invalidates unpublished recovery candidates without losing the last valid state", () => {
  const { state } = recoveryFixture(), draft = state.prepareFieldState(), prepared = draft.ports.recovery.prepare(hp);
  state.fieldInventory.prepare({ kind: "grant-gil", amount: 5 }).commit();
  const before = state.snapshot();
  assert.throws(prepared.commit, /Stale/);
  assert.throws(() => draft.ports.recovery.prepare(hp), /Stale/);
  assert.equal(draft.commit(), false); assert.deepEqual(state.snapshot(), before);
});

test("live and candidate recovery reject writes throughout a battle lease and retry from the owned baseline", () => {
  const { state } = recoveryFixture(), before = state.snapshot(), draft = state.prepareFieldState();
  const pending = state.fieldRecovery.prepare(hp), pendingCandidate = draft.ports.recovery.prepare(hp), lease = state.openBattle(1000);
  assert.throws(pending.commit, /reserved/);
  assert.throws(pendingCandidate.commit, /reserved/);
  assert.throws(() => state.fieldRecovery.prepare(hp), /reserved/);
  assert.throws(() => draft.ports.recovery.prepare(hp), /reserved/);
  assert.equal(draft.commit(), false); assert.deepEqual(state.snapshot(), before);
  assert.deepEqual(state.battlePlayers(lease).map(player => [player.hp, player.mp]), [[50, 3], [40, 4]]);
  state.cancelBattle(lease); state.fieldRecovery.prepare(hp).commit();
  assert.deepEqual(state.snapshot().roster.map(member => member.hp), [70, 60]);
});

test("failed appearance preparation publishes no field recovery and the same command can prepare again", () => {
  const { state } = recoveryFixture(), before = state.snapshot();
  const op = { kind: "field-recovery" as const, command: hp, dependencies: [] };
  let preparations = 0;
  assert.throws(() => executeFieldRecoveryEvent(op, state.fieldRecovery, steps => {
    preparations++; assert.deepEqual(steps.map(step => step.targetId), ["a", "b"]);
    throw new Error("Missing later actor media");
  }), /Missing later actor media/);
  assert.equal(preparations, 1); assert.deepEqual(state.snapshot(), before);
  let publications = 0;
  executeFieldRecoveryEvent(op, state.fieldRecovery, steps => {
    assert.deepEqual(state.snapshot(), before); assert.equal(steps.length, 2);
    return Object.assign(() => { publications++; }, { validate: () => { assert.deepEqual(state.snapshot(), before); } });
  });
  assert.equal(publications, 1);
  assert.deepEqual(state.snapshot().roster.map(member => member.hp), [70, 60]);
});

test("MP and HP without death removal have no actor refresh and preserve unrelated conditions", () => {
  const { state } = recoveryFixture(), saved = state.snapshot();
  saved.roster[0]!.hp = 0; saved.roster[0]!.conditionIds = [305]; state.restore(saved);
  const guarded = state.fieldRecovery.prepare({ ...hp, allowUnableFight: false });
  assert.deepEqual(guarded.steps, []); guarded.commit();
  assert.equal(state.snapshot().roster[0]!.hp, 0); assert.deepEqual(state.snapshot().roster[0]!.conditionIds, [305]);
  const mana = state.fieldRecovery.prepare({ ...mp, allowUnableFight: true }); assert.deepEqual(mana.steps, []); mana.commit();
  assert.deepEqual(state.snapshot().roster[0]!.conditionIds, [305]);
  assert.equal(state.snapshot().roster[0]!.mp, 10);
});

test("recovered resources restore durably and the next battle borrows exactly those values", () => {
  const { state, make } = recoveryFixture();
  state.fieldRecovery.prepare(hp).commit(); state.fieldRecovery.prepare(mp).commit();
  const saved = state.snapshot(), restored = make(); restored.restore(JSON.parse(JSON.stringify(saved)));
  assert.equal(saved.formatVersion, 12); assert.deepEqual(restored.snapshot(), saved);
  const lease = restored.openBattle(1000);
  assert.deepEqual(restored.battlePlayers(lease).map(player => [player.hp, player.mp, player.maxHp, player.maxMp]),
    [[70, 10, 130, 28], [60, 11, 120, 28]]);
  assert.deepEqual(restored.snapshot(), saved);
});

test("source growth/equipment maxima remain projected owners rather than recovery command input", () => {
  const f = characterLearningSessionFixture(), make = () => GameState.createNewGame(f.battle.gameState,
    f.battle.common.players, f.battle.contentHash, f.battle.common.conditions);
  const state = make(), injured = state.snapshot(); injured.roster[0]!.hp = 40; injured.roster[0]!.mp = 2; state.restore(injured);
  const before = state.snapshot();
  assert.throws(() => state.fieldRecovery.prepare({ ...hp, maxHp: 9999 } as unknown as FieldRecoveryCommand));
  const forged = state.snapshot(); forged.roster[0]!.maxHp = 9999;
  assert.throws(() => state.restore(forged), /maximum|projection|growth|equipment/i);
  assert.deepEqual(state.snapshot(), before);
  state.fieldRecovery.prepare({ ...hp, amount: 9999 }).commit(); state.fieldRecovery.prepare({ ...mp, amount: 9999 }).commit();
  const saved = state.snapshot(), owner = saved.roster[0]!;
  assert.deepEqual([owner.hp, owner.mp, owner.maxHp, owner.maxMp], [100, 25, 100, 25]);
  assert.deepEqual(owner.growth, before.roster[0]!.growth); assert.deepEqual(owner.abilities, before.roster[0]!.abilities);
  assert.equal(owner.exp, before.roster[0]!.exp); assert.equal(owner.enabled, before.roster[0]!.enabled);
  const restored = make(); restored.restore(saved);
  const lease = restored.openBattle(1000, { kind: "battle-reward-policy-v1", ap: 0, magicPoints: 0 });
  assert.deepEqual(restored.battlePlayers(lease).map(player => [player.hp, player.mp, player.maxHp, player.maxMp]), [[100, 25, 100, 25]]);
});
