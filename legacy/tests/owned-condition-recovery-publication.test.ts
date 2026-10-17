import test from "node:test";
import assert from "node:assert/strict";
import { BattleConditions } from "../src/core/battle-conditions.js";
import { executeOwnedConditionEvent, type OwnedConditionAppearanceStep } from "../src/core/owned-condition.js";
import { executeFieldRecoveryEvent } from "../src/core/field-recovery.js";
import type { FieldPartyActors, FieldPartyActorRenderer } from "../src/core/field-party-actors.js";
import type { FieldPuppetHostProviders } from "../src/core/field-puppet-effects.js";
import { compileOwnedConditionInstruction } from "../src/compiler/owned-condition.js";
import { compileFieldRecoveryInstruction } from "../src/compiler/field-recovery.js";
import { magicStonesSessionFixture } from "./fixtures/magic-stones-session.js";

type Kind = "condition" | "recovery";
const condition = { kind: "add-condition" as const, conditionType: 607, target: 0 };
const recovery = { kind: "recover-hp" as const, amount: 7, target: 0,
  allowUnableFight: true, allowMineralization: true };

/** Existing authored initializer, native actor factory, real GameSession and
 * actual FieldPartyActors renderer. The resource setup is explicitly synthetic;
 * it neither claims a reachable source state nor grants new condition behavior. */
function fixture() {
  const content = magicStonesSessionFixture(), game = content.make();
  const damaged = game.state.snapshot(), rules = new BattleConditions(content.battle.common.conditions);
  for (const member of damaged.roster) {
    member.hp = 1; member.mp = 0;
    member.conditionIds = rules.updateDying(member.hp, member.maxHp, member.conditionIds);
  }
  game.state.restore(damaged);
  assert.equal(game.checkpointReady, true);
  assert.ok(Object.values(game.field.actors).every(actor => actor.native));
  return { content, game };
}
type Fixture = ReturnType<typeof fixture>;

function prepareActors(f: Fixture, steps: readonly OwnedConditionAppearanceStep[]) {
  const owner = Reflect.get(f.game.field, "partyActors") as FieldPartyActors;
  const renderer = (Reflect.get(f.game.field, "partyRenderer") as () => FieldPartyActorRenderer).call(f.game.field);
  assert.ok(owner); assert.ok(steps.length > 1, "the real source-ordered plan covers both current owners");
  return owner.prepareSequence(steps, renderer);
}
function prepare(f: Fixture, kind: Kind) {
  const transaction = kind === "condition"
    ? f.game.state.fieldOwnedConditions.prepare(condition)
    : f.game.state.fieldRecovery.prepare(recovery);
  const publication = prepareActors(f, transaction.steps);
  publication.validate();
  return { transaction, publication };
}
function execute(f: Fixture, kind: Kind) {
  if (kind === "condition") executeOwnedConditionEvent({ kind: "owned-condition", command: condition, dependencies: [] },
    f.game.state.fieldOwnedConditions, steps => prepareActors(f, steps));
  else executeFieldRecoveryEvent({ kind: "field-recovery", command: recovery, dependencies: [] },
    f.game.state.fieldRecovery, steps => prepareActors(f, steps));
}
function capture(f: Fixture) {
  return { checkpoint: f.game.checkpoint(), revision: Reflect.get(f.game.state, "revision"),
    field: f.game.field, owner: f.game.state,
    actors: Object.values(f.game.field.actors).map(actor => ({ actor, native: actor.native,
      entity: actor.native?.entity, animation: actor.native?.entity.animation })) };
}
function unchanged(f: Fixture, before: ReturnType<typeof capture>) {
  assert.equal(f.game.field, before.field); assert.equal(f.game.state, before.owner);
  assert.deepEqual(f.game.checkpoint(), before.checkpoint);
  assert.equal(Reflect.get(f.game.state, "revision"), before.revision);
  for (const ref of before.actors) {
    assert.equal(f.game.field.actors[ref.actor.id], ref.actor);
    assert.equal(ref.actor.native, ref.native); assert.equal(ref.actor.native?.entity, ref.entity);
    assert.equal(ref.actor.native?.entity.animation, ref.animation);
  }
}
function provider(f: Fixture, change: (value: FieldPuppetHostProviders, final: boolean) => FieldPuppetHostProviders) {
  const original = Reflect.get(f.game.field, "nativeActorProviders") as () => FieldPuppetHostProviders;
  let preliminary = 0, finals = 0;
  Reflect.set(f.game.field, "nativeActorProviders", () => {
    const final = Reflect.get(f.game.state, "menuPublication") === true;
    if (final) finals++; else preliminary++;
    return change(original(), final);
  });
  return { restore: () => Reflect.set(f.game.field, "nativeActorProviders", original),
    get preliminary() { return preliminary; }, get finals() { return finals; } };
}
function expectedChange(f: Fixture, kind: Kind, before: ReturnType<typeof capture>) {
  const after = f.game.state.snapshot();
  assert.equal(Reflect.get(f.game.state, "revision"), Number(before.revision) + 1);
  if (kind === "condition") {
    assert.deepEqual(after.roster.map(member => member.conditionIds),
      before.checkpoint.owned.roster.map(member => [...member.conditionIds, 9007]));
    assert.deepEqual(after.roster.map(({ hp, mp }) => [hp, mp]), before.checkpoint.owned.roster.map(({ hp, mp }) => [hp, mp]));
  } else assert.deepEqual(after.roster.map(member => member.hp),
    before.checkpoint.owned.roster.map(member => Math.min(member.maxHp, member.hp + recovery.amount)));
  assert.deepEqual(after.completedBattles, before.checkpoint.owned.completedBattles);
}

for (const kind of ["condition", "recovery"] as const) {
  test(`${kind}: final native reads observe the prior owner, then save/restore and a real battle continue without duplicate settlement`, () => {
    const f = fixture(), before = capture(f);
    const read = provider(f, value => { assert.deepEqual(f.game.state.snapshot(), before.checkpoint.owned); return value; });
    execute(f, kind); assert.ok(read.preliminary > 0); assert.ok(read.finals > 0); read.restore();
    expectedChange(f, kind, before);
    const saved = f.game.checkpoint(), restored = f.content.restore(saved);
    assert.deepEqual(restored.checkpoint(), saved);
    // Remove the admitted field condition through its actual shared port before
    // ordinary battle; no new Magitek media or command capability is granted.
    const current = { ...f, game: restored };
    if (kind === "condition") executeOwnedConditionEvent({ kind: "owned-condition",
      command: { ...condition, kind: "remove-condition" }, dependencies: [] }, restored.state.fieldOwnedConditions,
      steps => prepareActors(current, steps));
    f.content.win(restored);
    const won = restored.checkpoint();
    assert.equal(won.owned.completedBattles.length, 1);
    assert.equal(restored.continueVictory(), false); assert.deepEqual(restored.checkpoint(), won);
    assert.deepEqual(f.content.restore(won).checkpoint(), won);
    const afterBattle = capture(current); execute(current, kind); expectedChange(current, kind, afterBattle);
  });

  for (const failure of ["material", "throw"] as const) {
    test(`${kind}: a ${failure} rejection from the actual final native reader is atomic and the same candidate retries once`, () => {
      const f = fixture(), before = capture(f);
      let reject = true;
      const read = provider(f, (value, final) => {
        if (!final || !reject) return value;
        if (failure === "throw") throw new Error("Controlled host cancelled before native publication");
        return { ...value, mapRenderContext: "controlled-invalid-final-material" };
      });
      const pending = prepare(f, kind);
      assert.throws(() => pending.transaction.commitWith(pending.publication), failure === "throw"
        ? /cancelled before native publication/ : /Unknown native appearance material binding/);
      assert.ok(read.finals > 0); unchanged(f, before);
      reject = false; pending.transaction.commitWith(pending.publication); expectedChange(f, kind, before);
      const saved = f.game.checkpoint();
      assert.throws(() => pending.transaction.commitWith(pending.publication), /Stale/);
      assert.throws(pending.transaction.commit, /Stale/); assert.deepEqual(f.game.checkpoint(), saved);
      read.restore();
    });
  }

  test(`${kind}: replacing the real native animation after preparation rejects the stale actor plan before any owned write`, () => {
    const f = fixture(), pending = prepare(f, kind);
    const actor = f.game.field.player;
    // Controlled external host change to the actual actor instance. It is a
    // stale-plan fault, not a source gameplay step or a substitute actor.
    const animation = actor.native!.entity.animation; assert.ok(animation);
    actor.native!.entity.animation = animation.clone();
    const afterHostChange = capture(f);
    assert.throws(() => pending.transaction.commitWith(pending.publication), /Stale native appearance actor candidate/);
    unchanged(f, afterHostChange);
    const fresh = prepare(f, kind); fresh.transaction.commitWith(fresh.publication);
    expectedChange(f, kind, afterHostChange);
  });

  test(`${kind}: reentrant owned publication from final native validation is rejected and releases the shared lock`, () => {
    const f = fixture(), before = capture(f);
    let reenter = true;
    const read = provider(f, (value, final) => {
      if (final && reenter) f.game.state.fieldInventory.prepare({ kind: "grant-gil", amount: 1 }).commit();
      return value;
    });
    assert.throws(() => execute(f, kind), /Owned menu publication is in progress/);
    assert.ok(read.finals > 0); unchanged(f, before);
    reenter = false; execute(f, kind); expectedChange(f, kind, before); read.restore();
  });

  test(`${kind}: a newer owned revision or active battle lease rejects a retained ticket before actor dispatch`, () => {
    const f = fixture(), stale = prepare(f, kind);
    f.game.state.fieldInventory.prepare({ kind: "grant-gil", amount: 1 }).commit();
    const before = capture(f);
    assert.throws(() => stale.transaction.commitWith(stale.publication), /Stale/); unchanged(f, before);
    const pending = prepare(f, kind), owner = f.game.state.snapshot();
    const encounter = f.content.battle.encounters[f.content.encounterId]!;
    const lease = f.game.state.openBattle(f.content.encounterId, encounter.rewardPolicy, encounter.playerParticipants);
    assert.throws(() => pending.transaction.commitWith(pending.publication), /reserved by an active battle/);
    assert.deepEqual(f.game.state.snapshot(), owner);
    f.game.state.cancelBattle(lease);
    pending.transaction.commitWith(pending.publication); expectedChange(f, kind, before);
  });

  test(`${kind}: the private map draft preserves failure/reentry/generation and rebinds to the same owner after publication`, () => {
    const f = fixture(), before = f.game.state.snapshot(), draft = f.game.state.prepareFieldState();
    const make = () => kind === "condition" ? draft.ports.ownedConditions.prepare(condition) : draft.ports.recovery.prepare(recovery);
    const pending = make(), appearance = draft.ports.partyAppearance!.current();
    assert.throws(() => pending.commitWith(() => { throw new Error("Controlled private actor cancellation"); }), /actor cancellation/);
    assert.deepEqual(draft.ports.partyAppearance!.current(), appearance); assert.deepEqual(f.game.state.snapshot(), before);
    assert.throws(() => pending.commitWith(() => draft.ports.inventory.prepare({ kind: "grant-gil", amount: 1 }).commit()), /Stale candidate inventory/);
    assert.deepEqual(draft.ports.partyAppearance!.current(), appearance); assert.deepEqual(f.game.state.snapshot(), before);
    draft.ports.inventory.prepare({ kind: "grant-gil", amount: 1 }).commit();
    assert.throws(() => pending.commitWith(() => assert.fail("stale draft must not dispatch")), /Stale/);
    const fresh = make(); fresh.commitWith(() => assert.deepEqual(f.game.state.snapshot(), before));
    assert.throws(fresh.commit, /Stale/); assert.equal(draft.commit(), true); assert.equal(draft.commit(), false);
    const after = f.game.state.snapshot(); assert.equal(after.gil, before.gil + 1);
    const rebound = kind === "condition" ? draft.ports.ownedConditions.prepare({ ...condition, kind: "remove-condition" })
      : draft.ports.recovery.prepare({ ...recovery, amount: 1 });
    rebound.commitWith(() => assert.deepEqual(f.game.state.snapshot(), after));
    assert.notDeepEqual(f.game.state.snapshot(), after);
  });
}

test("scalar MP recovery has no actor obligation but still uses once-only owned publication", () => {
  const f = fixture(), before = capture(f);
  executeFieldRecoveryEvent({ kind: "field-recovery", command: { ...recovery, kind: "recover-mp", amount: 3 }, dependencies: [] },
    f.game.state.fieldRecovery, () => assert.fail("scalar MP has no source Refresh"));
  assert.deepEqual(f.game.state.snapshot().roster.map(member => member.mp), [3, 3]);
  for (const ref of before.actors) assert.equal(ref.actor.native?.entity.animation, ref.animation);
  assert.equal(Reflect.get(f.game.state, "revision"), Number(before.revision) + 1);
});

test("publication grants no 665/666 addition, unbound removal or MP-count execution", () => {
  const f = fixture(), before = capture(f);
  const raw = (mnemonic: string, values: number[]) => ({ mnemonic, type: 1,
    operands: { iValues: values, rValues: Array(8).fill(0), sValues: Array(8).fill("") } });
  for (const type of [665, 666]) {
    assert.throws(() => f.game.state.fieldOwnedConditions.prepare({ ...condition, conditionType: type }), /Unimplemented owned condition behavior/);
    assert.throws(() => compileOwnedConditionInstruction(raw("RemoveCondition", [type, 0, 0, 0, 0, 0, 0, 0]), {}), /Missing owned condition master/);
  }
  assert.throws(() => compileFieldRecoveryInstruction(raw("RecoveryMP", [0, 1, 1, 0, 0, 0, 0, 0]), {}), /MP count recovery provider is unavailable/);
  unchanged(f, before);
});
