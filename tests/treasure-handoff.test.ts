import test from "node:test";
import assert from "node:assert/strict";
import { FieldGame } from "../src/core/field.js";
import { EventState } from "../src/core/event-state.js";
import { GameState } from "../src/core/game-state.js";
import { treasureFlagRef } from "../src/core/treasure-inventory.js";
import {
  compileTreasureInteraction,
  compileTreasureInventory,
  compileTreasureTaskMessages,
} from "../src/compiler/treasure-inventory.js";
import type { FieldEntity, Op } from "../src/field/types.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";
import { itemFixture } from "./fixtures/items.js";
import {
  treasureProperties,
  treasureSource,
  treasureTables,
} from "./fixtures/treasure-inventory.js";
import { taskMessages, taskSystemMessages } from "./fixtures/treasure-task.js";

type Handoff = "encounter" | "change-map";
const operation = (index: number, value: { kind: Op["kind"] } & Record<string, unknown>) =>
  ({ script: "handoff", index, source: treasureSource, ...value }) as Op;
function handoff(kind: Handoff, index: number): Op {
  return operation(index, kind === "encounter"
    ? { kind, party: 1000, continuation: "resumed" }
    : { kind, request: { mapId: 2, entrance: 1, continuation: null,
      birdview: false, skipFade: true, skipBgm: true, origin: "script" } });
}
function fixture(scripted = false) {
  const { field, battle } = checkpointFixture();
  const treasure = compileTreasureInventory(treasureProperties({
    link_object_id: 7, script_id: scripted ? 31 : 0,
  }), treasureTables(), treasureSource);
  battle.gameState.items[101] = itemFixture(101);
  const owner = new GameState(battle.gameState, battle.common.players,
    battle.contentHash, battle.common.conditions);
  const { openTrigger: _door, ...base } = field.map.entities[0]!;
  const entity: FieldEntity = {
    ...base, id: "treasure", kind: 7, treasure,
    treasureMessages: compileTreasureTaskMessages(treasure, taskMessages(), taskSystemMessages),
    mapObject: { collision: true, acceptDirection: 15, soundId: 909, talkMounts: [""],
      interaction: { kind: "treasure", request: compileTreasureInteraction(treasure) } },
  };
  field.map.entities = [entity, ...field.map.entities.filter((e) => e.kind !== 8)];
  field.map.groups!.entity_default!.entities = field.map.entities;
  field.treasureInventoryLimits = { item: 99, gil: 9999999 };
  field.scripts.resumed = [operation(0, { kind: "exit" })];
  const events = EventState.initialized();
  const game = new FieldGame(field, events, undefined, undefined,
    { treasure: owner.fieldTreasure });
  const count = () => owner.snapshot().items.find((item) => item.id === 101)?.count ?? 0;
  return { field, game, owner, events, count, flag: treasureFlagRef(treasure.flagId) };
}

for (const kind of ["encounter", "change-map"] as const) {
  test(`concurrent ${kind} cannot discard an awarded treasure before its flag commits`, () => {
    const { field, game, owner, events, count, flag } = fixture();
    // Both child tasks are admitted by the public puppet/join VM. One awaits
    // treasure input while the other becomes ready to transfer out of Field.
    field.scripts.handoff = [
      operation(0, { kind: "puppet", slot: 0, target: 4, actor: "-1001" }),
      operation(1, { kind: "puppet", slot: 1, target: 6, actor: "npc" }),
      operation(2, { kind: "join" }),
      operation(3, { kind: "exit" }),
      operation(4, { kind: "treasure-box", entityId: 42, after: true,
        message: true, actionSoundId: 0 }),
      operation(5, { kind: "exit" }),
      operation(6, { kind: "wait", seconds: 0.01 }),
      handoff(kind, 7),
    ];
    assert.equal(game.startEvent("handoff"), true);
    assert.equal(count(), 1);
    assert.equal(events.read(flag), 0);
    assert.equal(game.dialogue?.key, "SYNTHETIC_TREASURE");
    game.advance(10);
    game.confirm();

    // TalkTask has a final frame before the source flag write. A transfer may
    // neither silently drop this continuation nor move the flag before input.
    assert.equal(game.stop?.kind, "unsupported");
    assert.equal(game.checkpointReady, false);
    assert.equal(events.read(flag), 0);
    assert.throws(() => game.checkpoint(), /Cannot save/);
    assert.throws(() => game.prepareEncounterReturn(1000), /No matching/);
    assert.throws(() => game.previewMap(2, 1), /Cannot preview/);
    const owned = owner.snapshot();
    game.confirm();
    game.advance(100);
    assert.equal(game.startEvent("handoff"), false);
    assert.equal(count(), 1);
    assert.deepEqual(owner.snapshot(), owned);
    assert.equal(events.read(flag), 0);
  });

  test(`scripted treasure may ${kind} after handing off its independent source script`, () => {
    const { field, game, events, count, flag } = fixture(true);
    field.scripts["synthetic-treasure"] = [handoff(kind, 0)];
    game.confirm();
    assert.equal(game.stop?.kind, kind === "encounter" ? "encounter" : "map-transition");
    assert.equal(game.dialogue, null);
    assert.equal(count(), 0);
    assert.equal(events.read(flag), 0);
    if (kind === "encounter") {
      game.finishEncounter(1000);
      assert.equal(game.checkpointReady, true);
      assert.equal(count(), 0);
      assert.equal(events.read(flag), 0);
    }
  });
}
