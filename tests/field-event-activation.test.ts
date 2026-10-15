import assert from "node:assert/strict";
import test from "node:test";
import { compileEntityGroup } from "../src/compiler/entity-group.js";
import { compileFieldEventActivation } from "../src/compiler/field-event-activation.js";
import { captureFieldEventActivation, restoreFieldEventActivation } from "../src/core/field-event-activation.js";
import { fieldEventActivationFixture, eventActivationReady as ready } from "./fixtures/field-event-activation.js";
import { GameFlow } from "../src/core/game-flow.js";
import { GameEventSaveCoordinator } from "../src/core/game-event-save.js";
import { CheckpointStorage } from "../src/core/saved-game.js";
import { GameEntryLoader } from "../src/core/game-entry-loader.js";
import { GameBattleHandoff } from "../src/core/game-battle-handoff.js";

const source = { file: "synthetic", assetPath: "entity_default.json", pointer: "/layers/0/objects/0" },
  properties = { object_type: 2, action_id: 2, script_id: 8, gimmick: true,
    direction: 0, ignore_route_link_object_id: -1, link_object_id: 0 },
  group = (p: Record<string, unknown>) => compileEntityGroup("entity_default", { source,
    data: { layers: [{ name: "BottomObject", objects: [{ gid: 1, id: 1, x: 32, y: 48,
      width: 16, height: 16, rotation: 0, visible: true,
      properties: Object.entries(p).map(([name, value]) => ({ name, value })) }] }] } },
    { "script.csv": [{ id: 8, script_name: "source-run" }] });

test("the whole Gimmick RunScript shape is typed while other action/transport/link families remain blocked", () => {
  const typed = group(properties);
  assert.deepEqual(typed.blockers, []); assert.equal(typed.entities[0]!.eventActivation!.gimmick, true);
  assert.equal(typed.entities[0]!.eventActivation!.script, "source-run");
  const ordinary = group({ ...properties, gimmick: false });
  assert.equal(Object.hasOwn(ordinary.entities[0]!, "eventActivation"), false);
  assert.deepEqual(ordinary.blockers, []);
  for (const change of [{ action_id: 0 }, { target_transportation_ids: "1" }, { link_object_id: 4 },
    { script_id: 0 }, { direction: 1 }, { ignore_route_link_object_id: 1 }, { se_id: 2 },
    { birdview_puppet: true }, { gimmick: 1 }, { object_type: 21 }]) {
    const blocked = group({ ...properties, ...change });
    assert(blocked.blockers.length > 0, JSON.stringify(change));
  }
  assert.equal(compileFieldEventActivation("entity_default", { ...properties, object_type: 3 }, "source-run", source), null);
});

test("source contact reaches one real native task, survives failed storage and restores its exact invocation without replay", async () => {
  const f = await fieldEventActivationFixture(), { game, flow, commands } = await f.make(),
    field = game.field, player = field.player, native = player.native!.entity,
    count = (owner = game) => owner.state.snapshot().items.find(row => row.id === 701)!.count;
  const initial = count();
  assert.deepEqual(flow.directionInput("right"), { kind: "movement" }); flow.advance(240, ready);
  assert.equal(field.stop, null); assert.ok(game.eventSaveRequest); assert.equal(count(), initial + 2);
  assert.strictEqual(field.player, player); assert.strictEqual(player.native!.entity, native);
  assert.deepEqual(flow.directionInput("left"), { kind: "rejected" });
  const prepared = game.prepareEventSave(game.eventSaveRequest!), raw = prepared.checkpoint;
  assert.ok("execution" in raw.world.field);
  const execution = raw.world.field.execution;
  assert.equal(execution.kind, "field-event-continuation-v3");
  assert.deepEqual(execution.eventActivation, captureFieldEventActivation(f.trigger));
  assert.equal(execution.main.pc, 2); assert.equal(field.content.scripts["gimmick-main"]![1]!.index, 101);
  const bytes = new Map<string, string>(); let fail = true;
  const storage = new CheckpointStorage({ getItem: key => bytes.get(key) ?? null,
    setItem: (key, value) => { if (fail) throw new Error("controlled storage failure"); bytes.set(key, value); } }),
    saves = new GameEventSaveCoordinator(flow, storage), request = game.eventSaveRequest;
  assert.equal((await saves.save(100)).status, "failed");
  assert.strictEqual(game.eventSaveRequest, request); assert.equal(count(), initial + 2);
  assert.strictEqual(game.field, field); fail = false;
  assert.equal((await saves.save(101)).status, "committed");
  const saved = (await storage.load())!.checkpoint, restored = f.restore(saved);
  const load = new GameEntryLoader<null>(flow, { discard() {} });
  assert.equal((await load.begin("load").prepare(async () => ({ session: restored, presentation: null }))).status, "committed");
  flow.observeHost(ready); assert.equal(commands.menuReady, false);
  assert.equal(count(restored), initial + 2); assert.equal(restored.eventSaveRequest, null);
  const heldTime = restored.field.time; assert.equal(flow.pause(true), true); flow.advance(5000, ready);
  assert.equal(restored.field.time, heldTime); assert.equal(count(restored), initial + 2); assert.equal(flow.pause(false), true);
  assert.equal(restored.field.player.x, player.x); assert.equal(restored.field.player.y, player.y);
  flow.advance(100, ready); assert.equal(restored.field.stop, null); assert.equal(restored.checkpointReady, true);
  assert.equal(count(restored), initial + 5); flow.advance(100, ready); assert.equal(count(restored), initial + 5);
  const stable = restored.checkpoint(); assert.deepEqual(f.restore(stable).checkpoint(), stable);
  assert.equal(restored.field.sourceEventActivation, null);
  const oldField = restored.field, oldActor = oldField.player, oldNative = oldActor.native!.entity, owned = restored.state.snapshot();
  oldField.previewMap(f.secondMap.mapId, f.content.entry.entrance);
  const cancelled = restored.world.prepare(f.world, f.secondMap); restored.world.discard(cancelled);
  assert.equal(restored.world.commit(cancelled), false); assert.strictEqual(restored.field, oldField);
  assert.strictEqual(oldField.player, oldActor); assert.strictEqual(oldActor.native!.entity, oldNative);
  assert.deepEqual(restored.state.snapshot(), owned); assert.equal(oldField.sourceEventActivation, null);
  const accepted = restored.world.prepare(f.world, f.secondMap); assert.equal(restored.world.commit(accepted), true);
  assert.notStrictEqual(restored.field, oldField); assert.equal(restored.field.sourceEventActivation, null);
  assert.throws(() => prepared.commitWith(() => {}), /stale/i);
});

test("a save cannot invent a source trigger, group, definition hash, program or capability", async () => {
  const f = await fieldEventActivationFixture(), { game, flow } = await f.make();
  flow.directionInput("right"); flow.advance(240, ready);
  const saved = game.prepareEventSave(game.eventSaveRequest!).checkpoint, before = game.state.snapshot();
  for (const change of [(x: any) => { x.entityId = "missing"; }, (x: any) => { x.group = "other"; },
    (x: any) => { x.definitionHash = "f".repeat(64); }, (x: any) => { x.kind = "unknown"; },
    (x: any) => { x.gimmick = true; }]) {
    const bad = structuredClone(saved); assert.ok("execution" in bad.world.field);
    change(bad.world.field.execution.eventActivation); assert.throws(() => f.restore(bad));
  }
  const bad = structuredClone(saved); assert.ok("execution" in bad.world.field);
  bad.world.field.execution.eventRootScript = "gimmick-after"; assert.throws(() => f.restore(bad), /program|lifecycle/);
  assert.deepEqual(game.state.snapshot(), before);
  const context = game.field.content, activation = captureFieldEventActivation(f.trigger);
  assert.deepEqual(restoreFieldEventActivation(activation, context, "gimmick-main"), activation);
  assert.throws(() => restoreFieldEventActivation(activation, { ...context, map: { ...context.map, entities: [], groups: {} } }, "gimmick-main"));
  const aliased = { ...context, map: { ...context.map, groups: { ...context.map.groups,
    alias: structuredClone(context.map.groups!.entity_default!) } } };
  assert.throws(() => restoreFieldEventActivation({ ...activation, group: "alias" }, aliased, "gimmick-main"), /program binding/);
});

test("an inactive declaration does not alter old checkpoint shapes, and direct script entry does not claim a trigger", async () => {
  const f = await fieldEventActivationFixture(), { game } = await f.make();
  assert.equal(game.field.startEvent("gimmick-main"), true); assert.ok(game.eventSaveRequest);
  const saved = game.prepareEventSave(game.eventSaveRequest!).checkpoint; assert.ok("execution" in saved.world.field);
  assert.equal(saved.world.field.execution.kind, "field-event-continuation-v1");
  assert.equal(Object.hasOwn(saved.world.field.execution, "eventActivation"), false);
});

test("gimmick battle media cancellation/retry publishes one action, one return and an ordinary continuation", async () => {
  const f = await fieldEventActivationFixture(true), { game, flow, commands } = await f.make();
  flow.directionInput("right"); flow.advance(240, ready); assert.equal(game.field.stop?.kind, "encounter");
  const field = game.field, actor = field.player, native = actor.native!.entity, owned = game.state.snapshot();
  let resolve!: () => void, failing = true;
  const handoff = new GameBattleHandoff(flow, { prepareStart: async () => {
    await new Promise<void>(done => { resolve = done; }); if (failing) throw new Error("controlled media failure"); return {};
  }, prepareReturn: async () => ({}), discard() {} });
  const failed = handoff.start(); await new Promise<void>(done => setImmediate(done));
  flow.advance(500, ready); resolve(); assert.equal((await failed).status, "failed");
  assert.deepEqual(game.state.snapshot(), owned); assert.strictEqual(game.field, field);
  assert.deepEqual(field.sourceEventActivation, captureFieldEventActivation(f.trigger));
  const cancelled = handoff.start(); await new Promise<void>(done => setImmediate(done));
  handoff.cancel(); resolve(); assert.equal((await cancelled).status, "cancelled");
  failing = false; const retry = handoff.start(); await new Promise<void>(done => setImmediate(done)); resolve();
  assert.equal((await retry).status, "committed"); const battle = game.battle!;
  for (let i = 0; i < 10000 && battle.phase === "active"; i++) {
    for (const p of battle.ready) commands.command(battle, p.id, 10, battle.enemies[0]!.id, 100);
    flow.advance(10, ready);
  }
  assert.equal(battle.phase, "victory"); assert.equal((await handoff.return()).status, "committed");
  flow.advance(10, ready); assert.ok(game.eventSaveRequest); assert.equal(game.state.completedEncounters.length, 1);
  assert.strictEqual(game.field, field); assert.strictEqual(field.player, actor); assert.strictEqual(actor.native!.entity, native);
  const save = game.prepareEventSave(game.eventSaveRequest!), saved = save.checkpoint;
  assert.ok("execution" in saved.world.field); assert.equal(Object.hasOwn(saved.world.field.execution, "eventActivation"), false);
  const restored = f.restore(saved), next = new GameFlow(restored); next.start(); next.advance(100, ready);
  assert.equal(restored.checkpointReady, true); assert.equal(restored.state.completedEncounters.length, 1);
  await assert.rejects(() => handoff.return());
});
