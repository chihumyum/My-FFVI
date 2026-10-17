import test from "node:test";
import assert from "node:assert/strict";
import { removeLifeConditionSessionFixture } from "./fixtures/remove-life-condition-session.js";
import { encounterReady } from "./fixtures/source-encounter-session.js";
import { GameEventSaveCoordinator } from "../src/core/game-event-save.js";
import { CheckpointStorage } from "../src/core/saved-game.js";
import type { FieldPuppetHostProviders } from "../src/core/field-puppet-effects.js";

function memory() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}
test("legal battle death → one actual return → source target0 removal → Storage → type4 continuation does not replay HP", async () => {
  const f = removeLifeConditionSessionFixture(), live = await f.enter(), game = live.game;
  const before = game.state.snapshot(), field = game.field, actor = field.player.native!.entity;
  assert.equal(field.startEvent("life-remove"), true); live.flow.advance(10, encounterReady);
  assert.equal(field.stop, null); assert.ok(game.eventSaveRequest);
  const revived = game.state.snapshot().roster.find(row => row.id === live.deadId)!;
  assert.equal(revived.hp, 1); assert.ok(!revived.conditionIds.includes(f.battle.common.conditions.hpZeroConditionId));
  assert.ok(revived.conditionIds.includes(f.battle.common.conditions.dying.conditionId));
  assert.equal(field.player.native!.entity, actor); assert.equal(game.state.completedEncounters.length, 1);
  assert.deepEqual(game.state.snapshot().roster.map(row => [row.ownedId, row.sourceId, row.enabled, row.mp, row.equipment]),
    before.roster.map(row => [row.ownedId, row.sourceId, row.enabled, row.mp, row.equipment]));
  assert.equal(game.continueVictory(), false); await assert.rejects(() => live.handoff.return(), /pending encounter or terminal battle/);
  const storage = new CheckpointStorage(memory()), saves = new GameEventSaveCoordinator(live.flow, storage);
  assert.equal((await saves.save(100)).status, "committed");
  const loaded = (await storage.load())!, restored = f.restore(loaded.checkpoint);
  assert.equal(restored.state.snapshot().roster.find(row => row.id === live.deadId)!.hp, 1);
  restored.advance(10); assert.equal(restored.field.stop, null);
  const after = restored.state.snapshot().roster.find(row => row.id === live.deadId)!;
  assert.equal(after.hp, 1); assert.ok(!after.conditionIds.includes(f.battle.common.conditions.dying.conditionId));
  assert.equal(restored.checkpointReady, true);
  const stable = restored.checkpoint();
  assert.deepEqual(f.restore(stable).checkpoint(), stable);
  restored.field.startEvent("life-noop"); restored.advance(10);
  assert.equal(restored.state.snapshot().roster.find(row => row.id === live.deadId)!.hp, 1);
  assert.equal(restored.state.completedEncounters.length, 1);
});

test("actual native destination candidate removal stays private on failure/cancel, retries once and retires stale owner transactions", async () => {
  const f = removeLifeConditionSessionFixture(), live = await f.enter(), game = live.game;
  const before = game.state.snapshot(), field = game.field, destination = structuredClone(f.map);
  destination.initializer = "life-noop";
  const world = structuredClone(f.world);
  // The controlled content declares this same-map route before prepare; it
  // does not change the current source actor's placement or mutate owned HP.
  const stale = game.state.fieldOwnedConditions.prepare({ kind: "remove-condition", conditionType: 5, target: 0 });
  field.previewMap(destination.mapId, f.content.entry.entrance);
  assert.equal(field.stop?.kind, "map-transition");
  const failed = structuredClone(destination);
  failed.scripts["life-noop"]!.splice(-1, 0, { kind: "blocked", mnemonic: "ControlledLaterDependency",
    reason: "controlled later native map failure", script: "life-noop", index: 2, source: f.source });
  assert.throws(() => game.world.prepare(world, failed), /controlled later native map failure/);
  assert.equal(game.field, field); assert.deepEqual(game.state.snapshot(), before);
  const first = game.world.prepare(world, destination);
  assert.equal(first.field.stop, null); assert.deepEqual(game.state.snapshot(), before);
  game.world.discard(first); assert.equal(game.world.commit(first), false);
  assert.equal(game.field, field); assert.deepEqual(game.state.snapshot(), before);
  const retry = game.world.prepare(world, destination);
  assert.equal(game.world.commit(retry), true); game.advance(10);
  assert.notEqual(game.field, field); assert.equal(game.field.stop, null);
  assert.equal(game.state.snapshot().roster.find(row => row.id === live.deadId)!.hp, 1);
  const committed = game.state.snapshot();
  assert.throws(() => stale.commitWith(() => assert.fail("stale publication")), /Stale/);
  assert.equal(game.world.commit(retry), false); assert.deepEqual(game.state.snapshot(), committed);
});

test("late real native appearance failure rolls back all target resources and actor identity; saved retry commits once", async () => {
  const f = removeLifeConditionSessionFixture(), live = await f.enter(), game = live.game;
  game.field.startEvent("life-barrier"); assert.ok(game.eventSaveRequest);
  const save = game.prepareEventSave(game.eventSaveRequest!), checkpoint = save.checkpoint; save.commitWith(() => {});
  const before = game.state.snapshot(), field = game.field, appearance = field.partyActorCheckpoint;
  const actors = Object.values(field.actors).map(actor => ({ id: actor.id, actor, native: actor.native, entity: actor.native?.entity }));
  const original = Reflect.get(field, "nativeActorProviders") as () => FieldPuppetHostProviders;
  let finalReads = 0;
  Reflect.set(field, "nativeActorProviders", () => {
    if (Reflect.get(game.state, "menuPublication") === true) { finalReads++; throw new Error("controlled late life appearance failure"); }
    return original();
  });
  live.flow.advance(10, encounterReady);
  assert.match(field.stop!.message, /controlled late life appearance failure/); assert.ok(finalReads);
  assert.deepEqual(game.state.snapshot(), before); assert.deepEqual(field.partyActorCheckpoint, appearance);
  for (const row of actors) {
    assert.equal(field.actors[row.id], row.actor); assert.equal(field.actors[row.id]!.native, row.native);
    assert.equal(field.actors[row.id]!.native?.entity, row.entity);
  }
  const retry = f.restore(checkpoint); retry.advance(10); assert.equal(retry.field.stop, null); assert.ok(retry.eventSaveRequest);
  assert.equal(retry.state.snapshot().roster.find(row => row.id === live.deadId)!.hp, 1);
  const done = retry.prepareEventSave(retry.eventSaveRequest!); done.commitWith(() => {});
  assert.throws(() => done.commitWith(() => assert.fail("duplicate save owner")), /Stale|repeated|consumed/);
  retry.advance(10); assert.equal(retry.checkpointReady, true);
  assert.equal(retry.state.completedEncounters.length, 1);
  assert.equal(retry.state.snapshot().roster.find(row => row.id === live.deadId)!.hp, 1);
});
