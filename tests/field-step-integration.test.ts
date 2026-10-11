import test from "node:test";
import assert from "node:assert/strict";
import { GameSession } from "../src/core/game-session.js";
import { FieldGame } from "../src/core/field.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";
import { recoveryItemFixture } from "./fixtures/items.js";
import type { Op } from "../src/field/types.js";

function setup(transportationId: number | null = 101) {
  const f = checkpointFixture();
  f.battle.common.conditions.rules.definitions.push({
    id: 310, type: 10, overlapped: false, eraseGroupId: 3,
  });
  f.battle.common.conditions.behaviors.push({
    id: 310, kind: "poison", name: "Poison", untilType: 3, hpDivisor: 16,
  });
  f.battle.common.players[0]!.conditionIds = [310];
  f.battle.gameState.fieldConditions = {
    definitions: f.battle.common.conditions.rules.definitions.map(({ id, type }) => ({ id, type })),
    behaviors: [
      { id: 304, kind: "none" }, { id: 305, kind: "none" },
      { id: 310, kind: "poison", hpDivisor: 32, soundId: 55 },
    ],
    dying: { conditionId: 304, thresholdDivisor: 8 },
    transportations: [{ id: 101, type: 1 }, { id: 106, type: 12 }],
  };
  if (transportationId !== null) f.field.entry.transportationId = transportationId;
  f.battle.gameState.items[30] = recoveryItemFixture(30, [310]);
  f.battle.gameState.initialItems = [{ id: 30, count: 1 }];
  return { ...f, game: new GameSession(f.field, f.battle) };
}
const hp = (g: GameSession) => g.state.snapshot().roster[0]!.hp;

test("field poison settles once at cell completion before a destination battle borrows HP", () => {
  const f = setup();
  f.field.map.entities.push({
    id: "fight-trigger", kind: 2, x: 1, y: 2, width: 1, height: 1,
    layer: 1, direction: "down", asset: null, script: "fight",
    collision: null, destinationLayer: null, source: f.field.map.source,
  });
  const game = new GameSession(f.field, f.battle);
  assert.equal(game.field.move("down"), true);
  game.advance(230);
  assert.equal(hp(game), 80);
  assert.equal(game.field.player.y, 1);
  game.advance(10);
  assert.equal(hp(game), 78);
  assert.equal(game.field.player.y, 2);
  assert.equal(game.field.player.steps, 1);
  assert.equal(game.battle!.players[0]!.hp, 78);
  assert.equal(game.field.presentationOmissions.at(-1)!.soundId, 55);
});

test("collision, idle time, frame partition and checkpoint restore cannot duplicate a step", () => {
  const f = setup();
  assert.equal(f.game.field.move("right"), false); // Closed door, no cell finish.
  f.game.advance(80);
  assert.equal(hp(f.game), 80);
  assert.equal(f.game.field.move("down"), true);
  for (const ms of [23, 47, 80, 90]) f.game.advance(ms);
  assert.equal(hp(f.game), 78);
  const copy = GameSession.restore(f.game.checkpoint(), f.field, f.battle);
  copy.advance(2000);
  assert.equal(hp(copy), 78);
  assert.equal(copy.field.move("up"), true);
  copy.advance(240);
  assert.equal(hp(copy), 76);
  assert.equal(copy.field.player.steps, 2);
  assert.equal(copy.useMenuItem(30, "a"), true);
  copy.field.move("down");
  copy.advance(240);
  assert.equal(hp(copy), 76);
});

test("transportation identity is independent of mounted artwork and survives a map handoff", () => {
  for (const [id, expected] of [[101, 78], [106, 80]] as const) {
    const f = setup(id);
    for (const pose of ["RideL", "RideR"])
      f.field.characters.hero!.animations[pose] = structuredClone(f.field.characters.hero!.animations.WalkL!);
    f.field.entry.player.mount = "hero";
    const game = new GameSession(f.field, f.battle);
    game.field.eventState.write({ category: "ScenarioFlag1", index: 8 }, 0);
    game.field.previewMap(2, 1);
    assert.equal(game.world.commit(game.world.prepare(f.world, f.target)), true);
    game.advance(10);
    assert.equal(game.field.transportationId, id);
    game.field.move("down");
    game.advance(240);
    assert.equal(hp(game), expected);
    const copy = GameSession.restore(game.checkpoint(), f.field, f.battle, {
      catalog: f.world, map: f.target,
    });
    assert.equal(copy.field.transportationId, id);
    assert.deepEqual(copy.checkpoint(), game.checkpoint());
    for (const invalid of [999, id === 101 ? 106 : 101]) {
      const bad = game.checkpoint();
      assert.ok(bad.world.location!.traveler, "independent geometry fixture keeps its explicit traveler");
      bad.world.location!.traveler.transportationId = invalid;
      bad.world.field.transportationId = invalid;
      assert.throws(() => GameSession.restore(bad, f.field, f.battle, {
        catalog: f.world, map: f.target,
      }), /transportation identity/);
    }
  }
  const unknown = setup(null);
  assert.equal(unknown.game.field.move("down"), false);
  assert.match(unknown.game.field.movementBlocker!, /交通状态/);
  assert.equal(unknown.game.checkpointReady, true); // Menu cure is still possible.
});

test("scripted player steps settle at each move finish; NPC movement does not damage the party", () => {
  const f = setup();
  const op = (value: Record<string, unknown>): Op => ({
    script: "walk", index: 0, source: f.field.map.source, ...value,
  }) as Op;
  f.field.scripts.walk = [
    op({ kind: "move", direction: "down", steps: 2, secondsPerCell: 0.5 }),
    op({ kind: "exit" }),
  ];
  const game = new GameSession(f.field, f.battle);
  game.field.startEvent("walk");
  game.advance(490);
  assert.equal(hp(game), 80);
  game.advance(10);
  assert.equal(hp(game), 78);
  game.advance(500);
  assert.equal(hp(game), 76);
  f.field.scripts.npc = [
    op({ kind: "puppet", slot: 0, actor: "npc", target: 3 }),
    op({ kind: "join" }), op({ kind: "exit" }),
    op({ kind: "move", direction: "left", steps: 1, secondsPerCell: 0.24 }),
    op({ kind: "exit" }),
  ];
  game.field.startEvent("npc");
  game.advance(240);
  assert.equal(hp(game), 76);
});

test("live and candidate step transactions reject stale publication across every shared owner", () => {
  const { game } = setup();
  const old = game.state.fieldSteps.prepareStep(101);
  game.state.changeItems([{ id: 30, count: 1 }], "grant");
  assert.throws(() => old.commit(), /Stale/);
  assert.equal(hp(game), 80);
  const draft = game.state.prepareFieldState();
  const first = draft.ports.fieldSteps!.prepareStep(101);
  const second = draft.ports.fieldSteps!.prepareStep(101);
  first.result.members[0]!.hp = 1; // Returned receipts are not writable owned state.
  first.commit();
  assert.throws(() => second.commit(), /Stale/);
  assert.equal(hp(game), 80);
  assert.equal(draft.commit(), true);
  assert.equal(hp(game), 78);
  const after = draft.ports.fieldSteps!.prepareStep(101);
  after.commit();
  assert.equal(hp(game), 76);
  assert.throws(() => after.commit(), /Stale/);
});

test("logic-only hosts without field effects keep the same capabilities across map publication", () => {
  const f = checkpointFixture();
  f.field.entry.transportationId = 101;
  const game = new GameSession(f.field, f.battle);
  game.field.move("down");
  game.advance(240);
  assert.equal(game.field.stop, null);
  game.field.eventState.write({ category: "ScenarioFlag1", index: 8 }, 0);
  game.field.previewMap(2, 1);
  game.world.commit(game.world.prepare(f.world, f.target));
  game.advance(10);
  assert.equal(game.field.options.fieldSteps, undefined);
  assert.equal(game.field.move("down"), true);
  game.advance(240);
  assert.equal(game.field.stop, null);
  assert.equal(game.field.player.y, 2);
});

test("a failed field step provider cannot publish HP, coordinates, or destination events", () => {
  const f = setup();
  const field = new FieldGame(f.field, undefined, undefined, undefined, {
    fieldSteps: { prepareStep: () => { throw new Error("missing source provider"); } },
  });
  assert.equal(field.move("down"), false);
  field.advance(240);
  assert.equal(field.player.y, 1);
  assert.equal(field.player.steps, 0);
  assert.equal(field.stop?.kind, "unsupported");
  assert.match(field.stop!.message, /missing source provider/);
  assert.equal(hp(f.game), 80);
});

test("movement captures owned state at start and rejects changes before publishing its destination", () => {
  const f = setup();
  assert.equal(f.game.field.move("down"), true);
  f.game.advance(230);
  f.game.state.changeItems([{ id: 30, count: 1 }], "grant");
  f.game.advance(10);
  assert.equal(hp(f.game), 80);
  assert.equal(f.game.field.player.y, 1);
  assert.equal(f.game.field.player.steps, 0);
  assert.match(f.game.field.stop!.message, /Stale field step/);
});

test("an initializer's prepared movement survives map publication but rejects later owner changes", () => {
  for (const changeDuringMove of [false, true]) {
    const f = setup();
    f.target.scripts.init = [
      { kind: "move", direction: "down", steps: 1, secondsPerCell: 0.24, script: "init", index: 0, source: f.field.map.source },
      { kind: "exit", script: "init", index: 1, source: f.field.map.source },
    ];
    f.game.field.previewMap(2, 1);
    const prepared = f.game.world.prepare(f.world, f.target);
    assert.ok(prepared.field.player.motion);
    assert.equal(hp(f.game), 80);
    assert.equal(f.game.world.commit(prepared), true);
    if (changeDuringMove) f.game.state.changeItems([{ id: 30, count: 1 }], "grant");
    f.game.advance(240);
    if (changeDuringMove) {
      assert.equal(hp(f.game), 80);
      assert.equal(f.game.field.player.y, 1);
      assert.match(f.game.field.stop!.message, /Stale candidate field step/);
    } else {
      assert.equal(hp(f.game), 78);
      assert.equal(f.game.field.player.y, 2);
      assert.equal(f.game.field.stop, null);
      f.game.field.move("up");
      f.game.advance(240);
      assert.equal(hp(f.game), 76);
    }
  }
});
