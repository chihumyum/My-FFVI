import test from "node:test";
import assert from "node:assert/strict";
import { GameFlow } from "../src/core/game-flow.js";
import { GameCommands } from "../src/core/game-commands.js";
import { GameEntryLoader } from "../src/core/game-entry-loader.js";
import { GameEventSaveCoordinator } from "../src/core/game-event-save.js";
import { CheckpointStorage } from "../src/core/saved-game.js";
import type { GameSession } from "../src/core/game-session.js";
import type { FieldCoreRegisters } from "../src/core/field-core-registers.js";
import type { FieldPuppetHostProviders } from "../src/core/field-puppet-effects.js";
import { type0ConditionSessionFixture, removeAll, removeMagitek, eventBarrier, type0Exit, type0Nop,
  type0SourceMessage } from "./fixtures/type0-condition-session.js";

const ready = { visible: true, mediaReady: true, overlayOpen: false };
function main(game: GameSession): { id: number; pc: number; script: string; stack: number[]; generalRegisters: FieldCoreRegisters } {
  const tasks = Reflect.get(game.field, "tasks") as { id: number; pc: number; script: string; stack: number[];
    slot: number | null; generalRegisters: FieldCoreRegisters }[];
  const task = tasks.find(task => task.slot === null); assert.ok(task); return task;
}
function damage(f: ReturnType<typeof type0ConditionSessionFixture>, game: GameSession) {
  const value = game.state.snapshot();
  value.roster[0]!.hp = 0; value.roster[0]!.conditionIds = [f.deathId];
  value.roster[1]!.conditionIds = [53];
  game.state.restore(value); return value;
}
function memory() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); } };
}
function drive(game: GameSession, limit = 500) {
  for (let index = 0; index < limit && game.field.busy && !game.field.stop && !game.eventSaveRequest; index++) {
    game.advance(10);
    if (game.field.dialogue || game.field.sourceMessage.projection?.acceptsInput) game.field.confirm();
  }
  assert.equal(game.field.stop, null);
}

test("type0 uses actual native actors, leaves ScriptLocal separate, then save/load continues through one real settlement", async () => {
  const f = type0ConditionSessionFixture(), game = f.make(), original = damage(f, game);
  // Explicit author local declaration, separate from the three source state banks.
  const locals = { category: "ScriptLocalVariable", index: 0 } as const;
  game.field.eventState.beginScript({ labels: ["controlled-local"], values: [7] });
  const field = game.field, owner = game.state, actors = Object.values(field.actors).map(actor => actor.native);
  const flow = new GameFlow(game); flow.start(); flow.observeHost(ready);
  const commands = new GameCommands(flow, game);
  assert.equal(field.startEvent("type0-main"), true); assert.equal(field.stop, null);
  assert.ok(game.eventSaveRequest); assert.equal(main(game).generalRegisters.i[0], 53);
  assert.equal(field.eventState.read(locals), 7);
  const value = game.state.snapshot();
  assert.equal(value.roster[0]!.hp, 1); assert.deepEqual(value.roster[0]!.conditionIds, [f.dyingId]);
  assert.deepEqual(value.roster[1]!.conditionIds, [53]);
  assert.deepEqual(value.roster.map(p => [p.mp, p.ownedId, p.sourceId]), original.roster.map(p => [p.mp, p.ownedId, p.sourceId]));
  assert.equal(game.state, owner); assert.equal(game.field, field);
  Object.values(field.actors).forEach((actor, index) => assert.equal(actor.native, actors[index]));
  assert.equal(commands.menuReady, false);
  const storage = new CheckpointStorage(memory()), saves = new GameEventSaveCoordinator(flow, storage);
  assert.equal((await saves.save(100)).status, "committed");
  const saved = (await storage.load())!.checkpoint;
  assert.ok("execution" in saved.world.field);
  assert.equal(saved.world.field.execution.kind, "field-event-continuation-v2");
  assert.equal(saved.world.field.execution.main.generalRegisters!.i[0], 53);
  const restored = f.restore(saved);
  assert.equal(main(restored).generalRegisters.i[0], 53);
  const entries = new GameEntryLoader<null>(flow, { discard() { assert.fail("No resources were prepared"); } });
  const result = await entries.begin("load").prepare(async () => ({ session: restored, presentation: null }));
  assert.equal(result.status, "committed"); flow.observeHost(ready);
  assert.equal(commands.menuReady, false, "old gateway must not follow the replacement owner");
  restored.advance(10); assert.equal(restored.field.stop, null); assert.equal(restored.checkpointReady, true);
  assert.equal(restored.state.snapshot().roster[0]!.hp, 1, "pre-save death recovery is not replayed");
  assert.deepEqual(restored.state.snapshot().roster.map(p => p.conditionIds), [[f.dyingId], []]);
  f.win(restored);
  const final = restored.checkpoint(); assert.equal(final.owned.completedBattles.length, 1);
  assert.equal(restored.continueVictory(), false); assert.deepEqual(restored.checkpoint(), final);
  assert.deepEqual(f.restore(final).checkpoint(), final);
});

for (const fault of ["provider", "clock"] as const) test(`${fault}: late actual native validation cannot partially publish resources, actors or i0; restored retry completes once`, () => {
  const f = type0ConditionSessionFixture({ "type0-main": [eventBarrier, removeAll(), eventBarrier, removeMagitek, type0Exit] }),
    game = f.make(); damage(f, game);
  const field = game.field;
  // Source event initialization legitimately prepares actors before its first
  // opcode. The transaction's baseline starts at the explicit prior barrier.
  field.startEvent("type0-main");
  const entry = game.prepareEventSave(game.eventSaveRequest!), before = entry.checkpoint;
  entry.commitWith(() => {});
  const owner = game.state.snapshot();
  const actors = Object.values(field.actors).map(actor => ({ actor, native: actor.native, entity: actor.native!.entity,
    animation: actor.native!.entity.animation }));
  const original = Reflect.get(field, "nativeActorProviders") as () => FieldPuppetHostProviders;
  let finalReads = 0;
  Reflect.set(field, "nativeActorProviders", () => {
    if (Reflect.get(game.state, "menuPublication") === true) {
      finalReads++;
      if (fault === "clock") field.advance(10);
      throw new Error("Controlled final appearance rejection");
    }
    return original();
  });
  game.advance(10);
  assert.match(field.stop!.message, fault === "provider" ? /Controlled final appearance rejection/ : /Core publication is in progress/);
  assert.ok(finalReads);
  assert.deepEqual(game.state.snapshot(), owner); assert.equal(main(game).generalRegisters.i[0], 0);
  for (const ref of actors) {
    assert.equal(field.actors[ref.actor.id], ref.actor); assert.equal(ref.actor.native, ref.native);
    assert.equal(ref.actor.native!.entity, ref.entity); assert.equal(ref.actor.native!.entity.animation, ref.animation);
  }
  const retry = f.restore(before); retry.advance(10);
  assert.equal(retry.field.stop, null); assert.equal(main(retry).generalRegisters.i[0], 53);
  assert.equal(retry.state.snapshot().roster[0]!.hp, 1);
  const request = retry.eventSaveRequest!, save = retry.prepareEventSave(request); save.commitWith(() => {});
  assert.throws(() => save.commitWith(() => assert.fail("old ticket dispatched")), /Stale|repeated|consumed/);
  retry.advance(10); assert.equal(retry.state.snapshot().roster[0]!.hp, 1);
});

test("retention references do not grant unknown active665/666 behavior to a live native session", () => {
  const f = type0ConditionSessionFixture(), game = f.make(), before = game.checkpoint();
  for (const id of [79, 80]) {
    const changed = game.state.snapshot(); changed.roster[0]!.conditionIds.push(id);
    assert.throws(() => game.state.restore(changed), /Unimplemented|Unsupported/);
    assert.deepEqual(game.checkpoint(), before);
  }
});

test("Call keeps the bank; ChangeScript resets it; hook return retains callee final bank and cursor rather than old caller values", () => {
  const f = type0ConditionSessionFixture({
    main: [removeAll(), { kind: "call", target: 5 }, { kind: "script-transition", targetScript: "child", returnToCaller: true },
      eventBarrier, type0Exit, type0Nop, eventBarrier, { kind: "return" }],
    child: [type0Nop, eventBarrier, type0SourceMessage(.1), eventBarrier, type0Exit],
  }), game = f.make(); damage(f, game); game.field.startEvent("main");
  assert.equal(game.field.stop, null); assert.equal(main(game).generalRegisters.i[0], 53);
  assert.deepEqual(main(game).stack, [2]);
  const first = game.prepareEventSave(game.eventSaveRequest!); first.commitWith(() => {}); game.advance(10);
  assert.equal(main(game).script, "child"); assert.equal(main(game).generalRegisters.i[0], 0);
  assert.ok(game.eventSaveRequest);
  const reset = game.prepareEventSave(game.eventSaveRequest!), restored = f.restore(reset.checkpoint);
  assert.equal(main(restored).generalRegisters.i[0], 0); reset.commitWith(() => {});
  drive(game); drive(restored);
  for (const active of [game, restored]) {
    assert.equal(main(active).script, "child"); assert.equal(main(active).generalRegisters.i[0], 1);
    assert.equal(main(active).generalRegisters.i[1], 0); assert.equal(main(active).generalRegisters.r[2], .1);
    const child = active.prepareEventSave(active.eventSaveRequest!); child.commitWith(() => {});
    active.advance(10); active.advance(10);
    assert.equal(main(active).script, "main"); assert.ok(active.eventSaveRequest);
    assert.equal(main(active).generalRegisters.i[0], 1, "no caller register snapshot exists in native HookedProcess");
  }
  assert.deepEqual(game.state.snapshot(), restored.state.snapshot());
});

test("event continuation rejects Task, source context, register shape and consumer-capability tampering", () => {
  const f = type0ConditionSessionFixture(), game = f.make(); damage(f, game); game.field.startEvent("type0-main");
  const raw = game.prepareEventSave(game.eventSaveRequest!).checkpoint;
  for (const mutate of [
    (x: any) => x.world.field.execution.contentHash = "foreign",
    (x: any) => x.world.field.execution.main.pc++, (x: any) => x.world.field.execution.main.id = 0,
    (x: any) => x.world.field.execution.main.actor = "foreign-actor",
    (x: any) => x.world.field.execution.main.sourceEntityId = 100,
    (x: any) => x.world.field.execution.main.generalRegisters.i.push(0),
    (x: any) => x.world.field.execution.main.generalRegisters.i[0] = 2 ** 31,
    (x: any) => x.world.field.execution.main.generalRegisters.r[0] = "unknown",
    (x: any) => delete x.world.field.execution.main.generalRegisters,
    (x: any) => x.world.field.execution.kind = "field-event-continuation-v1",
  ]) { const bad = structuredClone(raw); mutate(bad); assert.throws(() => f.restore(bad)); }
  const saved = JSON.stringify(raw); assert.ok(saved.includes("field-core-registers-v1"));
  assert.equal(game.state.snapshot().roster[0]!.hp, 1);
});

test("a new root resets the previous task bank, while a zero-iteration call preserves a known message-written value", () => {
  const f = type0ConditionSessionFixture({
    main: [removeAll(), type0SourceMessage(.05), removeMagitek, removeAll(), eventBarrier, type0Exit],
    next: [eventBarrier, type0Exit],
  }), game = f.make();
  // Empty lists let Msg's i0=1 survive the second type0; it is not defaulted to
  // zero or to an invented last-condition result.
  game.field.startEvent("main"); drive(game);
  assert.equal(main(game).generalRegisters.i[0], 1);
  const save = game.prepareEventSave(game.eventSaveRequest!); save.commitWith(() => {}); game.advance(10);
  game.field.startEvent("next"); assert.equal(main(game).generalRegisters.i[0], 0);
});

test("a different declared type0 program never blocks an existing map-continuation request", () => {
  const f = type0ConditionSessionFixture({
    main: [type0SourceMessage(.05), { kind: "change-map", request: { mapId: 999, entrance: 1,
      continuation: "next", birdview: false, skipFade: true, skipBgm: true, origin: "script" } }],
    next: [eventBarrier, type0Exit], declared: [removeAll(), type0Exit],
  }), game = f.make(), state = game.state.snapshot(), field = game.field;
  game.field.startEvent("main");
  for (let index = 0; index < 500 && !field.stop; index++) {
    game.advance(10); if (field.sourceMessage.projection?.acceptsInput) field.confirm();
  }
  assert.equal(field.stop?.kind, "map-transition");
  assert.equal(field.stop.request.continuation, "next");
  assert.equal(main(game).generalRegisters.i[0], 1);
  assert.deepEqual(game.state.snapshot(), state); assert.equal(game.field, field);
});
