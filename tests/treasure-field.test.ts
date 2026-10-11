import test from "node:test";
import assert from "node:assert/strict";
import { GameState } from "../src/core/game-state.js";
import { EventState } from "../src/core/event-state.js";
import { FieldGame } from "../src/core/field.js";
import { compileTreasureInventory, compileTreasureTaskMessages, compileTreasureInteraction } from "../src/compiler/treasure-inventory.js";
import { treasureFlagRef } from "../src/core/treasure-inventory.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";
import { equipmentGameFixture } from "./fixtures/equipment-game.js";
import { treasureProperties, treasureSource, treasureTables } from "./fixtures/treasure-inventory.js";
import { itemFixture } from "./fixtures/items.js";
import { taskMessages, taskSystemMessages } from "./fixtures/treasure-task.js";
import type { FieldEntity, Op } from "../src/field/types.js";

function fixture(properties: Record<string, unknown> = {}) {
  const { field, battle } = checkpointFixture();
  const tables = treasureTables();
  const treasure = compileTreasureInventory(treasureProperties({ link_object_id: 7, ...properties }), tables, treasureSource);
  battle.gameState.items[101] = itemFixture(101);
  battle.gameState.items[102] = itemFixture(102, true);
  const owner = new GameState(battle.gameState, battle.common.players, battle.contentHash, battle.common.conditions);
  const { openTrigger: _door, ...base } = field.map.entities[0]!;
  const entity: FieldEntity = { ...base, id: "treasure", kind: 7, treasure,
    mapObject: { collision: true, acceptDirection: 15, soundId: 0, talkMounts: [""],
      interaction: { kind: "blocked", reason: "ordinary treasure interaction pending" } } };
  field.map.entities = [entity, ...field.map.entities.filter((e) => e.kind !== 8)];
  field.map.groups!.entity_default!.entities = field.map.entities;
  field.treasureInventoryLimits = { item: 99, gil: 9999999 };
  const site = { script: "treasure", index: 0, source: treasureSource };
  field.scripts.treasure = [
    { ...site, kind: "treasure-box", entityId: 42, after: true, message: false, actionSoundId: 0 },
    { ...site, index: 1, kind: "exit" },
  ];
  const events = EventState.initialized();
  const game = new FieldGame(field, events, undefined, undefined, { treasure: owner.fieldTreasure });
  return { field, owner, game, events, entity, ref: treasureFlagRef(treasure.flagId) };
}

test("treasure VM caps grants, writes its flag and yields before completing; message=false can repeat", () => {
  const { game, owner, events, ref } = fixture();
  owner.fieldInventory.prepare({ kind: "grant-item", id: 101, count: 99 }).commit();
  assert.equal(game.startEvent("treasure"), true);
  assert.equal(game.stop, null);
  assert.equal(owner.snapshot().items.find((i) => i.id === 101)!.count, 99);
  assert.equal(events.read(ref), 1);
  assert.equal(game.tileAnimations.isPlaying("region"), true);
  assert.equal(game.checkpointReady, false);
  game.advance(10);
  assert.equal(game.checkpointReady, true);
  owner.fieldInventory.prepare({ kind: "remove-item", id: 101, count: 1 }).commit();
  assert.equal(game.startEvent("treasure"), true);
  assert.equal(owner.snapshot().items.find((i) => i.id === 101)!.count, 99);
  game.advance(10);
  assert.deepEqual(game.checkpoint().openedTreasures, ["treasure"]);
});

test("treasure owner failure leaves flag, pickup visibility and linked tiles unchanged", () => {
  const { field, owner, ref } = fixture({ pick_up: true });
  const events = EventState.initialized();
  const game = new FieldGame(field, events, undefined, undefined, { treasure: {
    ...owner.fieldTreasure,
    prepare() { return { result: null, commit() { throw new Error("stale owner"); } }; },
  } });
  const before = game.tileAnimations.checkpoint();
  game.startEvent("treasure");
  assert.match(game.stop!.message, /stale owner/);
  assert.equal(events.read(ref), 0);
  assert.equal(game.hiddenEntities.has("treasure"), false);
  assert.deepEqual(game.tileAnimations.checkpoint(), before);
  assert.deepEqual(owner.snapshot().items, []);
});

test("treasure entry requires a known flag and initializes only the first linked tile region", () => {
  const { field, owner, ref } = fixture({ pick_up: true });
  assert.throws(() => new FieldGame(field), /未知事件状态/);
  const duplicate: FieldEntity = { ...structuredClone(field.map.entities.find((e) => e.kind === 1)!),
    id: "second-region", tileAnimation: { allLayers: true, loop: false, reverse: false, cells: [{ layer: 0, index: 9 }] } };
  field.map.entities.push(duplicate);
  const state = EventState.initialized();
  state.write(ref, 1);
  const game = new FieldGame(field, state, undefined, undefined, { treasure: owner.fieldTreasure });
  assert.equal(game.hiddenEntities.has("treasure"), true);
  assert.equal(game.tileAnimations.tile(0, 8), 3);
  assert.equal(game.tileAnimations.tile(0, 9), 1);
  assert.deepEqual(owner.snapshot().items, []);
});

test("treasure saved isOpen survives a later flag reset without replaying a reward", () => {
  const { field, game, owner, events, ref } = fixture({ pick_up: true });
  game.startEvent("treasure");
  game.advance(10);
  events.write(ref, 0);
  const snapshot = game.checkpoint(), before = owner.snapshot();
  const restored = FieldGame.restore(field, snapshot, { treasure: owner.fieldTreasure });
  assert.deepEqual(restored.checkpoint(), snapshot);
  assert.deepEqual(owner.snapshot(), before);
  const forged = structuredClone(snapshot);
  forged.openedTreasures.push("npc");
  assert.throws(() => FieldGame.restore(field, forged), /Unknown opened treasure/);
  const visible = structuredClone(snapshot);
  visible.hiddenEntities = [];
  assert.throws(() => FieldGame.restore(field, visible), /pickup treasure/);
});

test("missing messages, invalid callers and inventory record-presence boundaries are atomic blockers", () => {
  for (const change of [{ message: true }, { actionSoundId: 1 }, { after: false }]) {
    const { field, owner } = fixture();
    Object.assign(field.scripts.treasure![0]!, change);
    const game = new FieldGame(field, EventState.initialized(), undefined, undefined, { treasure: owner.fieldTreasure });
    game.startEvent("treasure");
    assert.equal(game.stop!.kind, "unsupported");
    assert.deepEqual(owner.snapshot().items, []);
  }
  assert.throws(() => fixture({ content_num: 100 }), /record.presence/);
  const { game, owner, entity } = fixture();
  entity.treasure!.contentNum = 100;
  if (entity.treasure!.reward.kind === "grant-item") entity.treasure!.reward.count = 100;
  game.startEvent("treasure");
  assert.match(game.stop!.message, /record presence/);
  assert.deepEqual(owner.snapshot().items, []);
});

function interactive(properties: Record<string, unknown> = {}) {
  const f = fixture(properties), definition = f.entity.treasure!;
  f.entity.treasureMessages = compileTreasureTaskMessages(definition, taskMessages(), taskSystemMessages);
  f.entity.mapObject!.interaction = { kind: "treasure", request: compileTreasureInteraction(definition) };
  return { ...f, game: new FieldGame(f.field, f.events, undefined, undefined, { treasure: f.owner.fieldTreasure }) };
}

test("ordinary treasure grants once, waits for visible message and defers the flag until completion", () => {
  const { game, owner, events, ref, field } = interactive();
  game.confirm();
  assert.equal(game.stop, null);
  assert.equal(owner.snapshot().items.find((i) => i.id === 101)!.count, 1);
  assert.equal(events.read(ref), 0);
  assert.equal(game.dialogue!.alignment, "center");
  assert.match(game.dialogue!.text, /Sample medicine/);
  assert.equal(game.presentationOmissions.filter((o) => o.soundId === 909).length, 1);
  assert.throws(() => game.checkpoint());
  game.confirm(); // The first source frame must elapse before input completes.
  assert.ok(game.dialogue);
  game.advance(10);
  game.confirm();
  game.confirm();
  assert.equal(game.dialogue, null);
  assert.equal(game.messageWindow, null);
  assert.equal(events.read(ref), 0);
  game.advance(10);
  assert.equal(events.read(ref), 1);
  assert.equal(game.checkpointReady, false);
  game.advance(10);
  assert.equal(game.checkpointReady, true);
  const restored = FieldGame.restore(field, game.checkpoint(), { treasure: owner.fieldTreasure });
  restored.confirm();
  assert.equal(restored.dialogue!.key, "SYN_EMPTY");
  restored.advance(10); restored.confirm(); restored.advance(10);
  assert.equal(restored.checkpointReady, true);
  assert.equal(owner.snapshot().items.find((i) => i.id === 101)!.count, 1);
  assert.equal(restored.presentationOmissions.length, 0);
});

test("capacity overflow keeps the window between two messages and never grants twice", () => {
  const { game, owner, events, ref } = interactive();
  owner.fieldInventory.prepare({ kind: "grant-item", id: 101, count: 99 }).commit();
  game.confirm(); game.advance(10);
  const reward = structuredClone(game.dialogue);
  game.confirm();
  assert.equal(game.dialogue, null);
  assert.deepEqual(game.messageWindow, reward);
  assert.equal(events.read(ref), 0);
  game.confirm(); // No input wait during the retained window.
  assert.equal(events.read(ref), 0);
  game.advance(10);
  assert.equal(game.dialogue!.key, "SYN_FULL");
  game.advance(10); game.confirm();
  assert.equal(game.messageWindow, null);
  assert.equal(events.read(ref), 0);
  game.advance(20);
  assert.equal(events.read(ref), 1);
  assert.equal(game.checkpointReady, true);
  assert.equal(owner.snapshot().items.find((i) => i.id === 101)!.count, 99);
});

test("scripted treasure leaves an independent event alive and does not grant its property reward", () => {
  const f = fixture({ script_id: 31 });
  f.entity.treasureMessages = compileTreasureTaskMessages(f.entity.treasure!, taskMessages(), taskSystemMessages);
  f.entity.mapObject!.interaction = { kind: "treasure", request: compileTreasureInteraction(f.entity.treasure!) };
  const site = { script: "synthetic-treasure", index: 0, source: treasureSource };
  f.field.scripts["synthetic-treasure"] = [
    { ...site, kind: "wait", seconds: 0.05 },
    { ...site, index: 1, kind: "message", key: "callback", speaker: "", text: "Script still running" },
    { ...site, index: 2, kind: "exit" },
  ];
  const game = new FieldGame(f.field, f.events, undefined, undefined, { treasure: f.owner.fieldTreasure });
  game.confirm(); game.advance(10);
  assert.equal(game.busy, true);
  assert.equal(game.dialogue, null);
  game.advance(40);
  assert.equal(game.dialogue!.key, "callback");
  game.confirm();
  assert.equal(game.stop, null);
  assert.equal(game.checkpointReady, true);
  assert.deepEqual(f.owner.snapshot().items, []);
  assert.equal(f.events.read(f.ref), 0);
});

test("anonymous treasure interaction keeps the selected Web identity among source ID zero objects", () => {
  const { field, owner, entity, events, ref } = interactive({ entity_id: 0 });
  const other = structuredClone(entity);
  other.id = "other-anonymous"; other.x = 5; other.treasure!.flagId = 261;
  field.map.entities.push(other);
  const game = new FieldGame(field, events, undefined, undefined, { treasure: owner.fieldTreasure });
  game.confirm(); game.advance(10); game.confirm(); game.advance(20);
  assert.equal(game.stop, null);
  assert.equal(events.read(ref), 1);
  assert.equal(events.read(treasureFlagRef(261)), 0);
  assert.deepEqual(game.checkpoint().openedTreasures, ["treasure"]);
});

test("explicit message treasure suspends its script and a failed owner cannot open or advance it", () => {
  const f = interactive({ pick_up: true });
  (f.field.scripts.treasure![0] as Extract<Op, { kind: "treasure-box" }>).message = true;
  const game = new FieldGame(f.field, f.events, undefined, undefined, { treasure: f.owner.fieldTreasure });
  game.startEvent("treasure");
  assert.equal(game.dialogue!.key, "SYNTHETIC_TREASURE");
  assert.equal(f.events.read(f.ref), 0);
  game.advance(10); game.confirm(); game.advance(20);
  assert.equal(game.checkpointReady, true);
  assert.equal(f.events.read(f.ref), 1);
  const failed = interactive({ pick_up: true });
  const broken = new FieldGame(failed.field, failed.events, undefined, undefined, { treasure: {
    ...failed.owner.fieldTreasure,
    prepare: () => ({ result: null, commit() { throw new Error("stale treasure owner"); } }),
  } });
  broken.confirm();
  assert.match(broken.stop!.message, /stale treasure owner/);
  assert.equal(broken.dialogue, null);
  assert.equal(broken.hiddenEntities.has("treasure"), false);
  assert.equal(broken.tileAnimations.isPlaying("region"), false);
  assert.deepEqual(failed.owner.snapshot().items, []);
  assert.equal(failed.events.read(failed.ref), 0);
});

test("treasure draft reads candidate inventory, including worn equipment but excluding important records", () => {
  const { catalog } = equipmentGameFixture();
  catalog.gameState.items[9990] = itemFixture(9990, true);
  const owner = new GameState(catalog.gameState, catalog.common.players, catalog.contentHash, catalog.common.conditions);
  const draft = owner.prepareFieldState();
  draft.ports.inventory.prepare({ kind: "grant-item", id: 10, count: 3 }).commit();
  draft.ports.treasure.prepare({ kind: "grant-item", id: 9990, count: 0 }).commit();
  draft.ports.treasure.prepare({ kind: "grant-equipment", id: 501, count: 0 }).commit();
  const read = draft.ports.treasure.read();
  assert.equal(read.normalOwnedItems.find((i) => i.id === 10)!.count, 3);
  assert.equal(read.normalOwnedItems.find((i) => i.id === 501)!.count, 1);
  assert.equal(read.normalOwnedItems.some((i) => i.id === 9990), false);
  assert.deepEqual(owner.snapshot().items, []);
  const stale = draft.ports.treasure.prepare({ kind: "grant-gil", amount: 1 });
  draft.ports.inventory.prepare({ kind: "grant-gil", amount: 2 }).commit();
  assert.throws(() => stale.commit(), /Stale candidate/);
  assert.equal(draft.commit(), true);
  assert.equal(owner.snapshot().items.find((i) => i.id === 9990)!.count, 0);
  const second = draft.ports.treasure.prepare({ kind: "grant-item", id: 10, count: 1 });
  second.commit();
  assert.throws(() => second.commit(), /Stale treasure/);
  assert.equal(owner.snapshot().items.find((i) => i.id === 10)!.count, 4);
  assert.throws(() => owner.fieldInventory.prepare({ kind: "grant-item", id: 10, count: 0 }), /integer/);
});
