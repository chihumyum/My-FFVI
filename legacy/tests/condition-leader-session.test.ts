import test from "node:test";
import assert from "node:assert/strict";
import { type0ConditionSessionFixture, removeAll, removeMagitek, eventBarrier, type0Exit,
  type Type0Instruction } from "./fixtures/type0-condition-session.js";
import { sealBatchContent } from "./fixtures/content-batch.js";
import type { GameSession } from "../src/core/game-session.js";
import type { FieldPuppetHostProviders } from "../src/core/field-puppet-effects.js";
import { canonical } from "../src/core/canonical.js";
import { createWebFlatConditionLeaderActivityPort } from "../src/core/field-condition-activity.js";
import { GameFlow } from "../src/core/game-flow.js";
import { GameCommands } from "../src/core/game-commands.js";
import { GameEntryLoader } from "../src/core/game-entry-loader.js";
import { CheckpointStorage } from "../src/core/saved-game.js";
import { GameEventSaveCoordinator } from "../src/core/game-event-save.js";

const ready = { visible: true, mediaReady: true, overlayOpen: false };
const recovery: Type0Instruction = { kind: "field-recovery", command: { kind: "recover-hp", amount: 7,
  target: 0, allowUnableFight: true, allowMineralization: true }, dependencies: [] };
function fixture(command: Type0Instruction = removeAll(), activity: "controlled-flat-native" | "unknown" | "missing" = "controlled-flat-native") {
  const f = type0ConditionSessionFixture({ main: [eventBarrier, command, eventBarrier, removeMagitek, type0Exit],
    declared: [removeAll(), type0Exit] });
  f.map.scriptSystemFlags!.main = { keepBadStatusVisual: true };
  // Declared author context asks the existing source Init lifecycle to show
  // its actual leader. No post-launch actor is created, patched or enabled.
  Object.assign(f.map.scriptPuppetContexts!.main!, { keepBadStatusVisual: true, keepPlayerPuppet: true });
  f.map.contentHash = sealBatchContent(f.map).contentHash;
  f.world.maps[f.map.mapId]!.contentHash = f.map.contentHash;
  f.world.contentHash = sealBatchContent(f.world).contentHash;
  Object.assign(f.content, { mapContentHash: f.map.contentHash, worldCatalogHash: f.world.contentHash });
  f.content.contentHash = sealBatchContent(f.content).contentHash;
  if (activity === "controlled-flat-native") f.runtime.conditionLeaderActivity = createWebFlatConditionLeaderActivityPort();
  if (activity === "unknown") f.runtime.conditionLeaderActivity = { policy: "web-flat-condition-leader-activity-v1",
    prepare: () => ({ isActiveAndEnabled: () => "unknown", validate() {} }) };
  return f;
}
function task(game: GameSession) {
  return (Reflect.get(game.field, "tasks") as { generalRegisters: { i: readonly number[] }; slot: number | null }[])
    .find(task => task.slot === null)!;
}
function setup(f: ReturnType<typeof fixture>, death = true) {
  const game = f.make(), damaged = game.state.snapshot();
  damaged.roster[0]!.hp = death ? 0 : 1;
  damaged.roster[0]!.conditionIds = death ? [f.deathId] : [f.dyingId];
  damaged.roster[1]!.conditionIds = [53]; game.state.restore(damaged);
  game.field.startEvent("main"); assert.equal(game.field.stop, null);
  const save = game.prepareEventSave(game.eventSaveRequest!), checkpoint = save.checkpoint;
  save.commitWith(() => {}); return { game, checkpoint };
}
function actorState(game: GameSession) {
  return Object.values(game.field.actors).map(actor => ({ actor, native: actor.native, entity: actor.native!.entity,
    animation: actor.native!.entity.animation,
    value: canonical({ ...actor.native!.entity, animation: actor.native!.entity.animation?.snapshot() ?? null }) }));
}
function assertActors(game: GameSession, actors: ReturnType<typeof actorState>) {
  for (const before of actors) {
    assert.equal(game.field.actors[before.actor.id], before.actor);
    assert.equal(before.actor.native, before.native); assert.equal(before.native!.entity, before.entity);
    assert.equal(before.native!.entity.animation, before.animation);
    assert.equal(canonical({ ...before.native!.entity, animation: before.native!.entity.animation?.snapshot() ?? null }), before.value);
  }
}

for (const [name, command] of [["type0", removeAll()], ["recovery", recovery], ["607", removeMagitek]] as const)
  test(`${name}: true source flag executes actual native refresh/leader transfer, then storage/load and one battle settlement`, async () => {
    const f = fixture(command), { game, checkpoint: prior } = setup(f, name !== "recovery"),
      field = game.field, owner = game.state, actors = Object.values(field.actors).map(actor => actor.native);
    const before = game.state.snapshot(); let finalReads = 0;
    const providers = Reflect.get(field, "nativeActorProviders") as () => FieldPuppetHostProviders;
    Reflect.set(field, "nativeActorProviders", () => {
      if (Reflect.get(owner, "menuPublication") === true) { finalReads++; assert.deepEqual(owner.snapshot(), before); }
      return providers();
    });
    game.advance(10); assert.equal(field.stop, null); assert.ok(game.eventSaveRequest);
    assert.ok(finalReads); assert.equal(game.state, owner); assert.equal(game.field, field);
    Object.values(field.actors).forEach((actor, index) => assert.equal(actor.native, actors[index]));
    if (name === "type0") { assert.equal(game.state.snapshot().roster[0]!.hp, 1); assert.equal(task(game).generalRegisters.i[0], 53); }
    if (name === "recovery") assert.equal(game.state.snapshot().roster[0]!.hp, Math.min(before.roster[0]!.maxHp, 8));
    if (name === "607") assert.deepEqual(game.state.snapshot().roster[1]!.conditionIds, []);
    const flow = new GameFlow(game); flow.start(); flow.observeHost(ready); const oldCommands = new GameCommands(flow, game);
    const bytes = new Map<string, string>(), storage = new CheckpointStorage({ getItem: key => bytes.get(key) ?? null,
      setItem: (key, value) => { bytes.set(key, value); } }), saves = new GameEventSaveCoordinator(flow, storage);
    assert.equal((await saves.save(100)).status, "committed");
    const saved = (await storage.load())!.checkpoint, restored = f.restore(saved);
    const loader = new GameEntryLoader<null>(flow, { discard() {} });
    assert.equal((await loader.begin("load").prepare(async () => ({ session: restored, presentation: null }))).status, "committed");
    flow.observeHost(ready); assert.equal(oldCommands.menuReady, false);
    restored.advance(10); assert.equal(restored.field.stop, null); assert.equal(restored.checkpointReady, true);
    assert.equal(restored.state.snapshot().roster[0]!.hp, game.state.snapshot().roster[0]!.hp);
    f.win(restored); assert.equal(restored.state.snapshot().completedBattles.length, 1);
    assert.equal(restored.continueVictory(), false);
    assert.deepEqual(f.restore(restored.checkpoint()).checkpoint(), restored.checkpoint());
  });

for (const failure of ["provider", "clock", "flag"] as const) test(`${failure}: last native fence retains prior actors/resources/bank and a restored retry commits once`, () => {
  const f = fixture(), { game, checkpoint } = setup(f), field = game.field, before = game.state.snapshot(), actors = actorState(game);
  const provider = Reflect.get(field, "nativeActorProviders") as () => FieldPuppetHostProviders;
  let finals = 0;
  Reflect.set(field, "nativeActorProviders", () => {
    if (Reflect.get(game.state, "menuPublication") === true) {
      finals++;
      if (failure === "clock") field.advance(10);
      if (failure === "flag") field.content.scriptSystemFlags!.main!.keepBadStatusVisual = false;
      else throw new Error("Controlled leader final provider failure");
    }
    return provider();
  });
  game.advance(10); assert.equal(field.stop?.kind, "unsupported"); assert.ok(finals);
  assert.deepEqual(game.state.snapshot(), before); assert.equal(task(game).generalRegisters.i[0], 0); assertActors(game, actors);
  if (failure === "flag") field.content.scriptSystemFlags!.main!.keepBadStatusVisual = true;
  const retry = f.restore(checkpoint); retry.advance(10); assert.equal(retry.field.stop, null);
  assert.equal(task(retry).generalRegisters.i[0], 53); assert.equal(retry.state.snapshot().roster[0]!.hp, 1);
  const save = retry.prepareEventSave(retry.eventSaveRequest!); save.commitWith(() => {});
  assert.throws(() => save.commitWith(() => assert.fail("old save dispatched")), /Stale|repeated|consumed/);
  retry.advance(10); assert.equal(retry.state.snapshot().roster[0]!.hp, 1);
});

for (const activity of ["missing", "unknown"] as const) test(`${activity} source activity remains blocked without publishing owned/native/Core state`, () => {
  const f = fixture(removeAll(), activity), { game } = setup(f), before = game.state.snapshot(), actors = actorState(game);
  game.advance(10); assert.equal(game.field.stop?.kind, "unsupported");
  assert.deepEqual(game.state.snapshot(), before); assert.equal(task(game).generalRegisters.i[0], 0); assertActors(game, actors);
});

// Same native instance remains authoritative while a delayed source callback
// is pending. Immediate AffectLeader Hide/Show must not erase its old ticket.
test("delayed source Hide survives actual condition Refresh/Affect and later fires once on that same entity", () => {
  const f = type0ConditionSessionFixture({ main: [
    { kind: "puppet", slot: 0, actor: "-1010", target: 7 },
    { kind: "exec-puppets", asynchronous: true }, { kind: "finish-puppets" },
    removeAll(), { kind: "wait", seconds: .3 }, eventBarrier, type0Exit,
    { kind: "actor-visibility", visible: false, timing: { durationSeconds: Math.fround(.05), delaySeconds: .1 } }, type0Exit,
  ] });
  f.map.scriptSystemFlags!.main = { keepBadStatusVisual: true };
  Object.assign(f.map.scriptPuppetContexts!.main!, { keepBadStatusVisual: true, keepPlayerPuppet: true });
  f.map.contentHash = sealBatchContent(f.map).contentHash;
  f.world.maps[f.map.mapId]!.contentHash = f.map.contentHash;
  f.world.contentHash = sealBatchContent(f.world).contentHash;
  Object.assign(f.content, { mapContentHash: f.map.contentHash, worldCatalogHash: f.world.contentHash });
  f.content.contentHash = sealBatchContent(f.content).contentHash;
  const observed: { actor: string; visible: boolean }[] = [];
  const activity = createWebFlatConditionLeaderActivityPort();
  f.runtime.conditionLeaderActivity = { ...activity, prepare: host => {
    const scope = activity.prepare(host);
    return { validate: scope.validate, isActiveAndEnabled: (id, entity) => {
      observed.push({ actor: id, visible: entity.visible }); return scope.isActiveAndEnabled(id, entity);
    } };
  } };
  const game = f.make(), field = game.field, before = game.state.snapshot(), actor = field.actors["native:puppet:0"]!, entity = actor.native!.entity;
  assert.ok(actor); field.startEvent("main");
  for (let index = 0; index < 200 && !game.eventSaveRequest && !field.stop; index++) game.advance(10);
  assert.equal(field.stop, null); assert.ok(game.eventSaveRequest);
  const queued = field.actorVisibilityExecutions.filter(row => row.phase === "queued"),
    applied = field.actorVisibilityExecutions.filter(row => row.phase === "applied");
  assert.equal(queued.length, 1); assert.equal(applied.length, 1);
  assert.equal(applied[0]!.ticket, queued[0]!.ticket); assert.equal(applied[0]!.actorId, actor.id);
  assert.ok(observed.some(row => row.actor === actor.id && row.visible), "actual transfer branch must have run");
  assert.equal(field.actors[actor.id], actor); assert.equal(actor.native!.entity, entity);
  assert.equal(entity.visible, false); assert.equal(entity.visibilityFade, null);
  assert.equal(field.actorVisibilityBusy, false); assert.deepEqual(game.state.snapshot().completedBattles, before.completedBattles);
  const saved = game.prepareEventSave(game.eventSaveRequest!), restored = f.restore(saved.checkpoint);
  assert.equal(restored.field.actorVisibilityExecutions.length, 0);
  assert.equal(restored.field.actors[actor.id]!.native!.entity.visible, false);
  saved.commitWith(() => {}); restored.advance(10);
  assert.equal(restored.field.stop, null); assert.equal(restored.checkpointReady, true);
});

test("production Web activity factory follows map cancellation/retry and restore through the existing owners", async () => {
  const { worldLoopSessionFixture } = await import("./fixtures/world-loop-session.js");
  const { compileFrameworkNewGame } = await import("../src/compiler/framework-new-game.js");
  const { GameSession } = await import("../src/core/game-session.js");
  const { GameContentRepository } = await import("../src/core/game-content.js");
  const { GameMapLoader } = await import("../src/core/game-map-loader.js");
  const f = await worldLoopSessionFixture(), nativePolicy = createWebFlatConditionLeaderActivityPort(), scopes: object[] = [];
  const policy = { ...nativePolicy, prepare: (host: Parameters<typeof nativePolicy.prepare>[0]) => {
    scopes.push(host.readActors()); return nativePolicy.prepare(host);
  } };
  const runtime = { conditionLeaderActivity: policy };
  const maps = [f.map, f.worldMap].map(raw => {
    const map = structuredClone(raw), name = "condition-activity";
    map.scripts[name] = [removeMagitek, type0Exit].map((op, index) => ({ ...op, script: name, index, source: f.source })) as typeof map.scripts[string];
    map.scriptPuppetContexts![name] = { ...structuredClone(f.map.scriptPuppetContexts!["authored-initialize"]!),
      scriptHash: "c".repeat(64), keepBadStatusVisual: true, keepPlayerPuppet: true };
    (map.scriptSystemFlags ??= {})[name] = { keepBadStatusVisual: true };
    (map.scriptLocals ??= {})[name] = null;
    return sealBatchContent(map);
  });
  const map = maps[0]!, target = maps[1]!, catalog = structuredClone(f.world);
  for (const item of maps) catalog.maps[item.mapId]!.contentHash = item.contentHash;
  const world = sealBatchContent(catalog), content = await compileFrameworkNewGame({ sourceEntry: f.sourceEntry,
    sourceBattle: f.sourceBattle, sourceMap: f.sourceMap, world, map, battle: f.battle, entrance: f.content.entry.entrance });
  const game = await GameSession.prepareFrameworkNewGame(content, world, map, f.battle, runtime);
  const idle = () => {
    for (let index = 0; index < 500 && !game.checkpointReady && !game.field.stop; index++) game.advance(10);
    assert.equal(game.field.stop, null); assert.equal(game.checkpointReady, true);
  };
  idle(); const first = game.field; first.startEvent("condition-activity"); idle();
  assert.ok(scopes.includes(first.actors));
  const flow = new GameFlow(game); flow.start(); flow.observeHost(ready);
  const commands = new GameCommands(flow, game);
  first.startEvent("go-world"); assert.equal(first.stop?.kind, "map-transition");
  const request = first.stop, before = game.state.snapshot(), nativeBefore = first.nativeActorStateFingerprint;
  const files = new Map<string, unknown>([["/framework/world/catalog.json", world],
    ...maps.map(item => [world.maps[item.mapId]!.url, item] as [string, unknown])]);
  const repository = new GameContentRepository(async url => {
    if (!files.has(url)) throw new Error("Unknown controlled activity file: " + url); return files.get(url);
  }, "framework");
  let resume!: () => void, prepared!: () => void;
  const hold = new Promise<void>(resolve => { resume = resolve; }), entered = new Promise<void>(resolve => { prepared = resolve; });
  let firstAttempt = true;
  const loader = new GameMapLoader(flow, repository, { prepare: async () => {
    if (firstAttempt) { firstAttempt = false; prepared(); await hold; } return null;
  }, discard() {} });
  const pending = loader.load();
  const entering = await Promise.race([entered.then(() => "entered"), pending.then(result => result)]);
  assert.ok(entering === "entered", typeof entering === "object" && entering.status === "failed" ? String(entering.error) : "map did not prepare");
  loader.cancel(); resume();
  assert.equal((await pending).status, "cancelled");
  assert.equal(game.field, first); assert.equal(first.stop, request); assert.deepEqual(game.state.snapshot(), before);
  assert.equal(first.nativeActorStateFingerprint, nativeBefore);
  assert.equal((await loader.load()).status, "committed"); idle(); assert.notEqual(game.field, first);
  const second = game.field; assert.equal(second.content.map.identity!.mapId, target.mapId);
  second.startEvent("condition-activity"); idle(); assert.ok(scopes.includes(second.actors));
  const saved = game.checkpoint(), restored = GameSession.restore(saved, undefined, f.battle,
    { catalog: world, map: target, initialized: { content, initialMap: map } }, runtime);
  const entries = new GameEntryLoader<null>(flow, { discard() {} });
  assert.equal(entries.begin("load").commit({ session: restored, presentation: null }).status, "committed");
  flow.observeHost(ready); assert.equal(commands.menuReady, false);
  restored.field.startEvent("condition-activity");
  for (let index = 0; index < 500 && !restored.checkpointReady && !restored.field.stop; index++) restored.advance(10);
  assert.equal(restored.field.stop, null); assert.equal(restored.checkpointReady, true);
  assert.ok(scopes.includes(restored.field.actors)); assert.notEqual(restored.field.actors, second.actors);
  assert.deepEqual(restored.state.snapshot(), saved.owned, "restoring and no-op refresh cannot replay grants or condition resources");
});
