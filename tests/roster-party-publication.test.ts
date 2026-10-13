import test from "node:test";
import assert from "node:assert/strict";
import { executePartyEvent } from "../src/core/party.js";
import { executeRosterLifecycleEvent } from "../src/core/roster.js";
import type { FieldPuppetHostProviders } from "../src/core/field-puppet-effects.js";
import { magicStonesSessionFixture } from "./fixtures/magic-stones-session.js";

function fixture() {
  const content = magicStonesSessionFixture(), game = content.make();
  content.grant(game, 901);
  assert.equal(game.changeMagicStone(content.playerIds[1], 901), true);
  return { content, game };
}
type Fixture = ReturnType<typeof fixture>;
const rosterCommand = { kind: "secede" as const, sourceId: 3, removeEquipment: true, refreshActors: true as const };
const partyCommand = { kind: "organize-slot" as const, slot: 0 as const,
  members: [3, 2, null, null] as [number | null, number | null, number | null, number | null], refreshActors: true as const };
function execute(f: Fixture, kind: "roster" | "party") {
  const prepare = (_members: unknown, appearance: Parameters<typeof f.game.field.prepareMenuPartyAppearance>[0] | undefined) => {
    assert.ok(appearance); return f.game.field.prepareMenuPartyAppearance(appearance);
  };
  if (kind === "roster") executeRosterLifecycleEvent({ kind, command: rosterCommand, dependencies: [] }, f.game.state.fieldRoster, prepare);
  else executePartyEvent({ kind, command: partyCommand, dependencies: [] }, f.game.state.fieldParty, prepare);
}
function fault(f: Fixture, change: (providers: FieldPuppetHostProviders, final: boolean) => FieldPuppetHostProviders) {
  const original = Reflect.get(f.game.field, "nativeActorProviders") as () => FieldPuppetHostProviders;
  assert.equal(typeof original, "function");
  let preliminary = 0, finalReads = 0;
  Reflect.set(f.game.field, "nativeActorProviders", () => {
    const final = Reflect.get(f.game.state, "menuPublication") === true;
    if (final) finalReads++; else preliminary++;
    return change(original(), final);
  });
  return { restore: () => Reflect.set(f.game.field, "nativeActorProviders", original),
    get preliminary() { return preliminary; }, get finalReads() { return finalReads; } };
}

for (const kind of ["roster", "party"] as const) {
  test(`${kind} event finishes real native reads against the prior owner before joint publication`, () => {
    const f = fixture(), before = f.game.checkpoint();
    const provider = fault(f, value => { assert.deepEqual(f.game.state.snapshot(), before.owned); return value; });
    execute(f, kind);
    assert.ok(provider.preliminary > 0); assert.ok(provider.finalReads > 0); provider.restore();
    const after = f.game.checkpoint();
    assert.notDeepEqual(after.owned, before.owned);
    assert.notDeepEqual(after.world.field.partyActors, before.world.field.partyActors);
    if (kind === "roster") {
      const removed = after.owned.roster.find(member => member.id === f.content.playerIds[1])!;
      assert.equal(removed.enabled, false); assert.equal(removed.magicStoneId, 0);
      assert.equal(removed.growth!.history!.at(-1)!.kind, "inventory-remove-magic-stone");
      assert.equal(removed.abilities!.commandIds.includes(7), true);
      assert.deepEqual(after.owned.nativeState!.ownedMagicStones, [901]);
    }
    assert.deepEqual(f.content.restore(after).checkpoint(), after);
  });

  test(`${kind} final native rejection preserves actors and the entire owned state and permits retry`, () => {
    const f = fixture(), before = f.game.checkpoint(), actor = f.game.field.player;
    const provider = fault(f, (value, final) => final
      ? { ...value, mapRenderContext: "controlled-final-party-material-rejection" } : value);
    assert.throws(() => execute(f, kind), /Unknown native appearance material binding/);
    assert.ok(provider.finalReads > 0);
    assert.deepEqual(f.game.checkpoint(), before); assert.equal(f.game.field.player, actor);
    provider.restore(); execute(f, kind);
    assert.notDeepEqual(f.game.state.snapshot(), before.owned);
  });

  test(`${kind} final validation refuses reentrant owned writes before any actor or history changes`, () => {
    const f = fixture(), before = f.game.checkpoint();
    const provider = fault(f, (value, final) => {
      if (final) f.game.state.fieldInventory.prepare({ kind: "grant-magic-stone", id: 902, count: 1 }).commit();
      return value;
    });
    assert.throws(() => execute(f, kind), /Owned menu publication is in progress/);
    assert.ok(provider.finalReads > 0); assert.deepEqual(f.game.checkpoint(), before);
    provider.restore(); execute(f, kind);
  });

  test(`${kind} private map draft keeps failure, reentry, stale generation and publication in one boundary`, () => {
    const f = fixture(), before = f.game.state.snapshot(), draft = f.game.state.prepareFieldState();
    const prepare = () => kind === "roster" ? draft.ports.roster.prepare(rosterCommand) : draft.ports.party.prepare(partyCommand);
    const candidate = prepare(), appearance = draft.ports.partyAppearance!.current();
    assert.throws(() => candidate.commitWith(() => { throw new Error("controlled actor rejection"); }), /actor rejection/);
    assert.deepEqual(draft.ports.partyAppearance!.current(), appearance);
    assert.throws(() => candidate.commitWith(() =>
      draft.ports.inventory.prepare({ kind: "grant-magic-stone", id: 902, count: 1 }).commit()), /Stale candidate inventory/);
    assert.deepEqual(draft.ports.partyAppearance!.current(), appearance);
    draft.ports.inventory.prepare({ kind: "grant-magic-stone", id: 902, count: 1 }).commit();
    assert.throws(() => candidate.commitWith(() => assert.fail("stale publication")), /Stale candidate/);
    const fresh = prepare(); fresh.commitWith(() => assert.deepEqual(f.game.state.snapshot(), before));
    assert.throws(fresh.commit, /Stale candidate/);
    assert.equal(draft.commit(), true); assert.equal(draft.commit(), false);
    assert.deepEqual(f.game.state.snapshot().nativeState!.ownedMagicStones, [901, 902]);
  });
}
