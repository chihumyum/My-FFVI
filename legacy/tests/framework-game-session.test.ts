import test from "node:test";
import assert from "node:assert/strict";
import { GameSession } from "../src/core/game-session.js";
import { GameFlow } from "../src/core/game-flow.js";
import { GameCommands } from "../src/core/game-commands.js";
import { GameEntryLoader } from "../src/core/game-entry-loader.js";
import { createSourceNativeState } from "../src/core/source-native-state.js";
import { encodeSavedGame, decodeSavedGame, CheckpointStorage } from "../src/core/saved-game.js";
import { FieldFadeState, DEVELOPMENT_TRANSPARENT_FADE, fieldFadeOverlay } from "../src/core/field-fade.js";
import { WEB_BATTLE_GLOBAL_FADE } from "../src/core/battle-global-fade.js";
import { WEB_BATTLE_EVENT_CONTROLS } from "../src/core/battle-controls.js";
import { frameworkNewGameFixture } from "./fixtures/framework-new-game.js";
import { sourceNewGameFixture } from "./fixtures/source-new-game.js";
import { sealBatchContent } from "./fixtures/content-batch.js";
import { authoredMessageSource } from "./fixtures/battle-event-message.js";

const host = { visible: true, mediaReady: true, overlayOpen: false };
async function initialized() {
  const f = await frameworkNewGameFixture();
  const game = await GameSession.prepareFrameworkNewGame(f.content, f.world, f.map, f.battle);
  return { f, game };
}

test("framework bootstrap creates source-owned domains on its separate authored map without changing the source route", async () => {
  const { f, game } = await initialized();
  assert.equal(game.state.initialization, "source-new-game");
  assert.deepEqual(game.state.nativeState, createSourceNativeState(f.plan));
  assert.equal(game.field.content.map.identity!.mapId, f.content.entry.mapId);
  assert.notEqual(f.plan.entry.mapId, f.content.entry.mapId);
  assert.equal(game.state.nativeState!.entrySeed.mapId, f.plan.entry.mapId);
  assert.deepEqual(game.state.snapshot().roster.map(({ id, hp, mp, abilities }) => ({ id, hp, mp, abilities })),
    f.plan.owned.roster.map(({ id, hp, mp, abilities }) => ({ id, hp, mp, abilities })));
  assert.ok(game.field.player.native); assert.ok(game.field.partyActorCheckpoint); assert.ok(game.field.cameraSnapshot);
  assert.equal(game.field.entrySynchronized, true, "The private candidate completes its immediate map initializer once");
  game.advance(10);
  assert.equal(game.field.entrySynchronized, true); assert.equal(game.checkpointReady, true);
  const saved = game.checkpoint();
  assert.equal(saved.formatVersion, 6);
  assert.deepEqual(saved.origin, { kind: "framework-new-game", entryContentHash: f.content.contentHash });
  assert.equal(saved.world.initialHash, f.content.contentHash);
  assert.equal(game.field.eventState.read(f.initializerFlag), 1);
});

test("framework bootstrap captures every mutable dependency before asynchronous digest checks", async () => {
  const f = await frameworkNewGameFixture(), mapId = f.map.mapId, contentHash = f.content.contentHash;
  const pending = GameSession.prepareFrameworkNewGame(f.content, f.world, f.map, f.battle);
  f.content.entry.mapId++; f.map.mapId++; f.world.maps = {}; f.battle.gameState.sourceNewGame!.gil++;
  const game = await pending; game.advance(10);
  assert.equal(game.field.content.map.identity!.mapId, mapId);
  assert.deepEqual(game.checkpoint().origin, { kind: "framework-new-game", entryContentHash: contentHash });
  assert.equal(game.gil, f.plan.owned.gil);
});

test("a sealed framework envelope cannot relabel an altered initializer hash or a seeded legacy catalog", async () => {
  const f = await frameworkNewGameFixture();
  const wrong = sealBatchContent({ ...f.content, initializerHash: "0".repeat(64) });
  await assert.rejects(GameSession.prepareFrameworkNewGame(wrong, f.world, f.map, f.battle), /Content payload changed/);
  const old = sourceNewGameFixture();
  const seeded = sealBatchContent({ ...f.battle, gameState: { ...f.battle.gameState,
    initialOwnedConditions: old.battle.common.players.map(player => ({ id: player.id, conditionIds: [] })) } });
  const seededEntry = sealBatchContent({ ...f.content, battleCatalogHash: seeded.contentHash });
  await assert.rejects(GameSession.prepareFrameworkNewGame(seededEntry, f.world, f.map, seeded), /condition seed/);
});

test("v6 restoration rebuilds native actors and learned history without running author initialization or awarding twice", async () => {
  const { f, game } = await initialized(); game.advance(10);
  game.state.fieldInventory.prepare({ kind: "grant-magic-stone", id: f.stoneIds[0]!, count: 1 }).commit();
  assert.equal(game.changeMagicStone(f.playerIds[0]!, f.stoneIds[0]!), true);
  const before = game.checkpoint();
  const encoded = await encodeSavedGame(before, 100), saved = await decodeSavedGame(encoded);
  const restored = GameSession.restore(saved.checkpoint, undefined, f.battle,
    { catalog: f.world, map: f.map, initialized: { content: f.content, initialMap: f.map } });
  assert.notEqual(restored.state, game.state); assert.notEqual(restored.field, game.field);
  assert.ok(restored.field.player.native); assert.deepEqual(restored.checkpoint(), before);
  restored.advance(10);
  assert.deepEqual(restored.state.snapshot(), before.owned, "Normal field time cannot replay the initialization grant");
  assert.equal(restored.field.eventState.read(f.initializerFlag), 1);
  const continued = restored.checkpoint();
  assert.equal(restored.magicStoneMenu(f.playerIds[0]!).currentContentId, f.stoneIds[0]);
  const flow = new GameFlow(game); flow.start(game, { paused: true }); flow.observeHost(host);
  const oldCommands = new GameCommands(flow, game);
  flow.start(restored, { paused: true }); flow.observeHost(host);
  assert.equal(oldCommands.changeMagicStone(f.playerIds[0]!, 0), false);
  assert.deepEqual(restored.checkpoint(), continued);
});

test("framework origin cannot borrow legacy/source dependencies or a prior checkpoint version", async () => {
  const { f, game } = await initialized(); game.advance(10); const saved = game.checkpoint();
  const world = { catalog: f.world, map: f.map, initialized: { content: f.content, initialMap: f.map } };
  for (const version of [4, 5] as const) {
    const wrong = structuredClone(saved); wrong.formatVersion = version;
    if (version === 4) Reflect.deleteProperty(wrong, "walkEncounters");
    assert.throws(() => GameSession.restore(wrong, undefined, f.battle, world), /version\/origin/);
  }
  assert.throws(() => GameSession.restore(saved, undefined, f.battle, { catalog: f.world, map: f.map }), /trusted initializer/);
  assert.throws(() => GameSession.restore(saved, undefined, f.battle,
    { ...world, source: { content: f.sourceEntry, initialMap: f.sourceMap } }), /trusted initializer/);
  const relabeled = structuredClone(saved); relabeled.origin = { kind: "development-checkpoint" };
  assert.throws(() => GameSession.restore(relabeled, undefined, f.battle, world), /version\/origin/);
  const missing = structuredClone(saved); Reflect.deleteProperty(missing, "walkEncounters");
  assert.throws(() => GameSession.restore(missing, undefined, f.battle, world), /checkpoint fields/);
  assert.deepEqual(game.checkpoint(), saved);
});

test("late initialized preparation cannot replace a different published owner", async () => {
  const f = await frameworkNewGameFixture(), replacement = await GameSession.prepareFrameworkNewGame(f.content, f.world, f.map, f.battle);
  replacement.advance(10); const before = replacement.checkpoint();
  const flow = new GameFlow(), discarded: number[] = [], entries = new GameEntryLoader(flow,
    { discard: presentation => { discarded.push(presentation as number); } });
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const attempt = entries.begin("new-game"), pending = attempt.prepare(async () => {
    await wait;
    return { session: await GameSession.prepareFrameworkNewGame(f.content, f.world, f.map, f.battle), presentation: 73 };
  });
  flow.start(replacement); release();
  const result = await pending;
  assert.equal(result.status, "cancelled"); assert.equal(flow.currentSession, replacement);
  assert.deepEqual(discarded, [73]); assert.deepEqual(replacement.checkpoint(), before);
});

test("an authored framework fade is captured before digest awaits and remains separate from the caller", async () => {
  const f = await frameworkNewGameFixture(), fade = new FieldFadeState(DEVELOPMENT_TRANSPARENT_FADE), before = fade.snapshot();
  const pending = GameSession.prepareFrameworkNewGame(f.content, f.world, f.map, f.battle, {}, 17, fade);
  fade.start({ kind: "field-fade", direction: "out", seconds: 0, color: { r: 1, g: 0, b: 0, a: 1 } });
  const game = await pending;
  assert.notEqual(game.field.fader, fade);
  assert.deepEqual(game.field.fader.snapshot(), before);
  assert.equal(fade.projection!.imageColor.r, 1);
  const old = await GameSession.prepareFrameworkNewGame(f.content, f.world, f.map, f.battle, {}, 17);
  assert.equal(old.field.fader.known, false, "Existing callers never receive an inferred transparent screen");
  const unknown = await GameSession.prepareFrameworkNewGame(f.content, f.world, f.map, f.battle, {}, 17, new FieldFadeState(null));
  assert.equal(unknown.field.fader.known, false);
  const wrong = sealBatchContent({ ...f.content, initializerHash: "0".repeat(64) }), changed = fade.snapshot();
  await assert.rejects(GameSession.prepareFrameworkNewGame(wrong, f.world, f.map, f.battle, {}, 17, fade), /Content payload changed/);
  assert.deepEqual(fade.snapshot(), changed, "A failed private preparation cannot consume the external presentation owner");
  await assert.rejects(GameSession.prepareFrameworkNewGame(f.content, f.world, f.map, f.battle, {}, 17,
    null as unknown as FieldFadeState), /actual Field fade owner/);
});

test("the initialized Field and Battle use the captured fade through return and Storage; a save cannot grant startup authority", async () => {
  const f = await frameworkNewGameFixture();
  f.battle.encounters[f.encounterId]!.lifecycle = { kind: "battle-lifecycle-v1", mode: "script", scriptId: 9000,
    program: { kind: "battle-event-v1", source: authoredMessageSource, entry: 0, end: 3, localNames: [], initialLocals: [], blockers: [],
      instructions: [
        { mnemonic: "FadeOut", op: { kind: "global-fade", direction: "out", seconds: Math.fround(-.05), color: { r: 0, g: 0, b: 0, a: 1 } } },
        { mnemonic: "BattleForceExit", op: { kind: "force-return" } }, { mnemonic: "Exit", op: { kind: "exit" } },
      ] } };
  const battle = sealBatchContent(f.battle), content = sealBatchContent({ ...f.content, battleCatalogHash: battle.contentHash }),
    runtime = { battleHandoff: "prepared" as const, battleGlobalFade: WEB_BATTLE_GLOBAL_FADE, battleEventControls: WEB_BATTLE_EVENT_CONTROLS },
    external = new FieldFadeState(DEVELOPMENT_TRANSPARENT_FADE),
    game = await GameSession.prepareFrameworkNewGame(content, f.world, f.map, battle, runtime, 17, external);
  game.advance(10); const owner = game.field.fader;
  assert(game.field.startEvent("stone-battle")); game.advance(10); assert(game.prepareBattleStart()!.commit());
  const actualBattle = game.battle!; game.advance(10);
  assert.equal(actualBattle.phase, "forced"); assert(owner.active);
  assert.deepEqual(actualBattle.globalFadeOverlay, fieldFadeOverlay(owner.projection));
  assert(game.prepareBattleReturn()!.commit()); assert.equal(game.field.fader, owner);
  assert.throws(() => actualBattle.advance(10), /Retired/);
  for (let i = 0; i < 100 && !game.checkpointReady; i++) game.advance(10);
  assert(game.checkpointReady); assert.equal(owner.projection!.rendererColor.a, 1);
  assert.deepEqual(external.projection, DEVELOPMENT_TRANSPARENT_FADE);
  const entries = new Map<string, string>(), storage = new CheckpointStorage({ getItem: k => entries.get(k) ?? null,
    setItem: (k, v) => { entries.set(k, v); } });
  await storage.save(game.checkpoint(), 0); const saved = (await storage.load())!.checkpoint,
    world = { catalog: f.world, map: f.map, initialized: { content, initialMap: f.map } },
    restored = GameSession.restore(saved, undefined, battle, world, runtime);
  assert.deepEqual(restored.checkpoint(), saved); assert.deepEqual(restored.field.fader.snapshot(), owner.snapshot());
  const injected = structuredClone(saved); Reflect.set(injected, "initialFade", external.snapshot());
  assert.throws(() => GameSession.restore(injected, undefined, battle, world, runtime), /checkpoint fields/);

  const unqualified = await GameSession.prepareFrameworkNewGame(content, f.world, f.map, battle, runtime, 17);
  unqualified.advance(10); assert(unqualified.field.startEvent("stone-battle")); unqualified.advance(10);
  assert.throws(() => unqualified.prepareBattleStart()!.commit(), /actual known shared Field fade/);
  assert.equal(unqualified.field.fader.known, false);
});
