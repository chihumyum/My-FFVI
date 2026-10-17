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
import type { FieldEntity, Op, Site } from "../src/field/types.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";
import { itemFixture } from "./fixtures/items.js";
import {
  treasureProperties,
  treasureSource,
  treasureTables,
} from "./fixtures/treasure-inventory.js";
import { taskMessages, taskSystemMessages } from "./fixtures/treasure-task.js";

type Instruction<T> = T extends Site ? Omit<T, keyof Site> : never;
const script = "scheduler-treasure";
const observed = { category: "MapLocalVariable", index: 0 } as const;
const treasureOp: Instruction<Op> = {
  kind: "treasure-box",
  entityId: 42,
  after: true,
  message: true,
  actionSoundId: 0,
};

/** Real FieldGame + owned transactions, with explicitly synthetic source tables
 * and scene geometry. These tests do not establish source scene reachability. */
function fixture(instructions: Instruction<Op>[]) {
  const { field, battle } = checkpointFixture();
  const treasure = compileTreasureInventory(
    treasureProperties({ link_object_id: 7, script_id: 0 }),
    treasureTables(),
    treasureSource,
  );
  battle.gameState.items[101] = itemFixture(101);
  const owner = new GameState(
    battle.gameState,
    battle.common.players,
    battle.contentHash,
    battle.common.conditions,
  );
  const { openTrigger: _door, ...base } = field.map.entities[0]!;
  const entity: FieldEntity = {
    ...base,
    id: "treasure",
    kind: 7,
    treasure,
    treasureMessages: compileTreasureTaskMessages(
      treasure,
      taskMessages(),
      taskSystemMessages,
    ),
    mapObject: {
      collision: true,
      acceptDirection: 15,
      soundId: 909,
      talkMounts: [""],
      interaction: {
        kind: "treasure",
        request: compileTreasureInteraction(treasure),
      },
    },
  };
  field.map.entities = [
    entity,
    ...field.map.entities.filter((e) => e.kind !== 8),
  ];
  field.map.groups!.entity_default!.entities = field.map.entities;
  field.treasureInventoryLimits = { item: 99, gil: 9999999 };
  field.scripts[script] = instructions.map(
    (instruction, index) =>
      ({ ...instruction, script, index, source: treasureSource }) as Op,
  );
  const events = EventState.initialized();
  events.write(observed, 0);
  const game = new FieldGame(field, events, undefined, undefined, {
    treasure: owner.fieldTreasure,
  });
  return {
    game,
    owner,
    events,
    flag: treasureFlagRef(treasure.flagId),
    count: () =>
      owner.snapshot().items.find((item) => item.id === 101)?.count ?? 0,
  };
}

test("main termination blocks an unfinished awarded treasure instead of making its uncommitted flag replayable", () => {
  const { game, owner, events, flag, count } = fixture([
    { kind: "puppet", slot: 0, target: 3, actor: "-1001" },
    { kind: "exec-puppets", asynchronous: true },
    { kind: "exit" },
    treasureOp,
    { kind: "exit" },
  ]);
  assert.equal(game.startEvent(script), true);
  // Native frame order gives the ready slot a clock before main-end cleanup.
  // Its grant is already committed, but message completion and the flag are not.
  assert.equal(count(), 1);
  assert.equal(events.read(flag), 0);
  assert.equal(game.stop?.kind, "unsupported");
  assert.match(game.stop?.message ?? "", /treasure|宝箱/i);
  assert.equal(game.checkpointReady, false);
  assert.throws(() => game.checkpoint(), /Cannot save/);

  const before = owner.snapshot();
  game.advance(10);
  game.confirm();
  game.advance(100);
  assert.equal(game.startEvent(script), false);
  assert.equal(game.checkpointReady, false);
  assert.equal(events.read(flag), 0);
  assert.equal(count(), 1);
  assert.deepEqual(owner.snapshot(), before);
});

test("a concurrent treasure message is rejected before granting and cannot replace the main dialogue", () => {
  const { game, owner, events, flag, count } = fixture([
    { kind: "puppet", slot: 0, target: 6, actor: "-1001" },
    { kind: "exec-puppets", asynchronous: true },
    { kind: "message", key: "MAIN", text: "Await confirmation", speaker: "" },
    {
      kind: "calc",
      left: observed,
      operator: "←",
      right: { kind: "immediate", value: 77 },
    },
    { kind: "wait", seconds: 1 },
    { kind: "exit" },
    treasureOp,
    { kind: "exit" },
  ]);
  const before = owner.snapshot();
  assert.equal(game.startEvent(script), true);
  assert.equal(game.stop?.kind, "unsupported");
  assert.match(game.stop?.message ?? "", /message|消息|对话/i);
  assert.equal(game.dialogue?.key, "MAIN");
  assert.equal(game.dialogue?.text, "Await confirmation");
  assert.equal(count(), 0);
  assert.equal(events.read(flag), 0);
  assert.deepEqual(owner.snapshot(), before);

  game.advance(10);
  game.confirm();
  game.advance(100);
  assert.equal(events.read(observed), 0);
  assert.equal(game.dialogue?.key, "MAIN");
  assert.equal(game.startEvent(script), false);
  assert.equal(game.checkpointReady, false);
  assert.throws(() => game.checkpoint(), /Cannot save/);
  assert.deepEqual(owner.snapshot(), before);
});
