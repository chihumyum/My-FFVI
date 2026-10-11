import test from "node:test";
import assert from "node:assert/strict";
import { GameState } from "../src/core/game-state.js";
import { EventState } from "../src/core/event-state.js";
import { FieldGame } from "../src/core/field.js";
import { compileTreasureInventory } from "../src/compiler/treasure-inventory.js";
import { treasureFlagRef } from "../src/core/treasure-inventory.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";
import { equipmentGameFixture } from "./fixtures/equipment-game.js";
import { treasureProperties, treasureSource, treasureTables } from "./fixtures/treasure-inventory.js";
import { itemFixture } from "./fixtures/items.js";
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

test("unknown message/audio branches and inventory record-presence boundaries are atomic blockers", () => {
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
