import test from "node:test";
import assert from "node:assert/strict";
import { GameSession } from "../src/core/game-session.js";
import { encodeSavedGame, decodeSavedGame } from "../src/core/saved-game.js";
import type { FieldRecoveryCommand } from "../src/core/field-recovery.js";
import type { Op, Site } from "../src/field/types.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";
import { equipmentGameFixture } from "./fixtures/equipment-game.js";
import { actorCatalog, actorContext } from "./fixtures/party-actors.js";

type Instruction<T> = T extends Site ? Omit<T, keyof Site> : never;
const source = { file: "synthetic", assetPath: "field-recovery-session" };
const marker = { category: "ScenarioFlag1" as const, index: 29 };
const instructions = (script: string, values: Instruction<Op>[]): Op[] => values.map((value, index) =>
  ({ ...value, script, index, source }) as Op);
const hp: FieldRecoveryCommand = { kind: "recover-hp", amount: 20, target: 0,
  allowUnableFight: true, allowMineralization: false };
const mp: FieldRecoveryCommand = { kind: "recover-mp", amount: 7, target: 0,
  allowUnableFight: false, allowMineralization: false };
const recovery = (command: FieldRecoveryCommand): Instruction<Op> =>
  ({ kind: "field-recovery", command, dependencies: [] });
const end = { kind: "exit" } as const;

/** Reuse the ordinary party-actor fixture without source scene reconstruction.
 * Catalog/context/media are data; the GameSession supplies every live port. */
function actorRecoveryFixture() {
  const { field, catalog: battle } = equipmentGameFixture(), actors = actorCatalog(), context = actorContext();
  actors.viewpointOffsets = [];
  actors.characterAssets = battle.common.players.map((player, index) => ({ id: index + 1,
    sourceId: player.sourceId, jobId: battle.gameState.rosterLifecycle.initial[player.id]!.jobId,
    fieldAssetId: index + 1 }));
  actors.conditionTypes[305] = 5; actors.conditionTypes[304] = 4;
  context.player.id = "-1001";
  field.characters.alpha = structuredClone(field.characters.hero!);
  field.characters.bravo = structuredClone(field.characters.hero!);
  field.entry.player.asset = "alpha"; field.entry.transportationId = 1;
  field.entry.partyActors = { kind: "field-party-actors-v1", context, playerAssetCacheId: 1 };
  battle.gameState.partyActors = actors;
  field.scripts.recover = instructions("recover", [recovery(hp), recovery(mp),
    { kind: "flag", ref: marker, operation: "set" }, end]);
  field.scriptSystemFlags = { recover: { keepBadStatusVisual: false } };
  const game = new GameSession(field, battle, 123), injured = game.state.snapshot();
  injured.roster[0]!.hp = 0; injured.roster[0]!.mp = 3; injured.roster[0]!.conditionIds = [305];
  injured.roster[1]!.hp = 40; injured.roster[1]!.mp = 4;
  game.state.restore(injured); game.field.eventState.write(marker, 0);
  return { game, field, battle };
}

test("field HP/MP recovery, actor refresh, menu, encoded save and next battle share one session owner", async () => {
  const { game, field, battle } = actorRecoveryFixture(), before = game.state.snapshot();
  const playerActor = game.field.player;
  assert.ok(game.field.partyActorCheckpoint);
  assert.equal(game.field.startEvent("recover"), true); game.advance(10);
  assert.equal(game.field.stop, null); assert.equal(game.field.eventState.read(marker), 1);
  assert.equal(game.field.player, playerActor);
  assert.deepEqual(game.state.snapshot().roster.map(member => [member.hp, member.mp, member.conditionIds]), [[21, 10, []], [60, 11, []]]);
  assert.deepEqual(game.state.snapshot().party, before.party);
  assert.deepEqual(game.state.snapshot().roster.map(member => [member.id, member.enabled, member.equipment]),
    before.roster.map(member => [member.id, member.enabled, member.equipment]));
  assert.equal(game.field.partyActorCheckpoint!.context.puppets[0]!.fieldAssetId, 1);
  assert.equal(game.field.partyActorCheckpoint!.context.puppets[1]!.fieldAssetId, 2);
  assert.equal(game.menuReady, true);
  assert.deepEqual([game.characterMenu("a").hp, game.characterMenu("a").mp], [21, 10]);
  const menu = game.characterMenu("b"); menu.hp = 1; assert.equal(game.characterMenu("b").hp, 60);
  assert.equal(game.checkpointReady, true);
  const checkpoint = game.checkpoint(), decoded = await decodeSavedGame(await encodeSavedGame(checkpoint, 1234));
  const restored = GameSession.restore(decoded.checkpoint, field, battle);
  assert.deepEqual(restored.checkpoint(), checkpoint);
  assert.deepEqual([restored.characterMenu("a").hp, restored.characterMenu("a").mp], [21, 10]);
  assert.equal(restored.field.startEvent("fight"), true); restored.advance(10);
  assert.equal(restored.battle?.phase, "active");
  assert.deepEqual(restored.battle!.players.map(player => [player.hp, player.mp]), [[21, 10], [60, 11]]);
  assert.deepEqual(restored.state.snapshot(), checkpoint.owned, "battle borrows these resources without republishing recovery");
});

test("missing recovery visual context or actor media stops the live event before any resource publication", () => {
  for (const mode of ["unknown", "keep", "media"] as const) {
    const { game, field } = actorRecoveryFixture(), before = game.state.snapshot(), actor = game.field.player;
    const appearance = game.field.partyActorCheckpoint;
    if (mode === "unknown") delete field.scriptSystemFlags;
    else if (mode === "keep") field.scriptSystemFlags!.recover = { keepBadStatusVisual: true };
    else delete field.characters.alpha;
    assert.equal(game.field.startEvent("recover"), true); game.advance(10);
    assert.equal(game.field.stop?.kind, "unsupported");
    assert.match(game.field.stop!.message, /condition-visual|Missing party appearance media/);
    assert.deepEqual(game.state.snapshot(), before);
    assert.deepEqual(game.field.partyActorCheckpoint, appearance); assert.equal(game.field.player, actor);
    assert.equal(game.field.eventState.read(marker), 0);
    assert.equal(game.battle, null); assert.equal(game.checkpointReady, false);
  }
});

test("MP recovery runs through FieldGame with no party-actor host or visual flag", () => {
  const { field, battle } = checkpointFixture();
  field.scripts.mana = instructions("mana", [recovery(mp), end]);
  const game = new GameSession(field, battle), injured = game.state.snapshot();
  injured.roster[0]!.mp = 1; injured.roster[1]!.mp = 0; game.state.restore(injured);
  const actor = game.field.player;
  assert.equal(game.field.partyActorCheckpoint, null);
  assert.equal(game.field.startEvent("mana"), true); game.advance(10);
  assert.equal(game.field.stop, null); assert.equal(game.field.player, actor);
  assert.deepEqual(game.state.snapshot().roster.map(member => member.mp), [8, 7]);
  assert.deepEqual(game.state.snapshot().roster.map(member => member.hp), injured.roster.map(member => member.hp));
  assert.equal(game.checkpointReady, true);
});

test("destination initializer recovery is private until world publication and failed or discarded maps cannot leak it", () => {
  const { game, field, battle, world, target } = checkpointFixture(), injured = game.state.snapshot();
  injured.roster[0]!.mp = 1; injured.roster[1]!.mp = 0; game.state.restore(injured);
  const initialField = game.field;
  target.scripts.init = instructions("init", [recovery(mp),
    { kind: "blocked", mnemonic: "ControlledLaterDependency", reason: "Missing later map dependency" }]);
  game.field.previewMap(2, 1); assert.equal(game.field.stop?.kind, "map-transition");
  assert.throws(() => game.world.prepare(world, target), /Missing later map dependency/);
  assert.equal(game.field, initialField); assert.deepEqual(game.state.snapshot(), injured);
  target.scripts.init = instructions("init", [recovery(mp), end]);
  const discarded = game.world.prepare(world, target);
  assert.equal(discarded.field.stop, null);
  assert.deepEqual(game.state.snapshot(), injured);
  game.world.discard(discarded); assert.equal(game.world.commit(discarded), false);
  assert.equal(game.field, initialField); assert.deepEqual(game.state.snapshot(), injured);
  const prepared = game.world.prepare(world, target);
  assert.deepEqual(game.state.snapshot(), injured); assert.equal(game.world.commit(prepared), true);
  game.advance(10);
  assert.equal(game.field, prepared.field); assert.equal(game.field.stop, null);
  assert.deepEqual(game.state.snapshot().roster.map(member => member.mp), [8, 7]);
  assert.equal(game.menuReady, true); assert.equal(game.characterMenu("b").mp, 7);
  const checkpoint = game.checkpoint(), restored = GameSession.restore(checkpoint, field, battle, { catalog: world, map: target });
  assert.deepEqual(restored.checkpoint(), checkpoint);
  assert.equal(restored.field.startEvent("fight"), true); restored.advance(10);
  assert.equal(restored.battle?.phase, "active");
  assert.deepEqual(restored.battle!.players.map(player => player.mp), [8, 7]);
});
