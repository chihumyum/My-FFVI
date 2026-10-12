import test from "node:test";
import assert from "node:assert/strict";
import { ActorAnimation } from "../src/core/actor-animation.js";
import { FieldGame } from "../src/core/field.js";
import { GameSession, type GameCheckpoint } from "../src/core/game-session.js";
import { NewGameFieldEntry } from "../src/core/new-game-field-entry.js";
import { encodeSavedGame, decodeSavedGame, CheckpointStorage } from "../src/core/saved-game.js";
import { compileFieldNativeNpc } from "../src/compiler/field-native-npc.js";
import { sourceNewGameFixture, reservedFlag, fallbackFlag } from "./fixtures/source-new-game.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";
import type { FieldEntity } from "../src/field/types.js";

function fixture(withNpcs: boolean | "mixed" = false, configure?: (f: ReturnType<typeof sourceNewGameFixture>) => void) {
  const f = sourceNewGameFixture();
  configure?.(f);
  if (withNpcs) {
    const asset = f.world.characters.bravo ? "bravo" : Object.keys(f.world.characters)[0]!;
    const npcs: FieldEntity[] = [601, 0].map((sourceId, index) => {
      const source = { ...f.source, pointer: `/layers/0/objects/${index}` }, id = sourceId ? String(sourceId) : `probe:0:${index}`;
      const definition = compileFieldNativeNpc({ group: "probe", object: { x: 80, y: 96, width: 16, height: 16 },
        entity: { id, kind: 6, layer: 0, source }, properties: { entity_id: sourceId, asset_id: 77,
          direction: 1, move_type: 0, turn_around: true, move_while_display_message: index === 1 },
        tables: { "mapobject.csv": [{ id: 77, asset_name: asset, shadow_type: 1 }] } }).definition!;
      assert.ok(definition);
      return { id, kind: 6, x: 5, y: 6, width: 1, height: 1, layer: 0, direction: "up", asset,
        script: null, collision: null, destinationLayer: null, source, nativeNpc: definition };
    });
    if (withNpcs === "mixed") {
      const initial = npcs.shift()!; initial.nativeNpc!.group = "entity_default";
      f.map.map!.groups!.entity_default!.entities.push(initial);
    }
    f.map.map!.groups!.probe = { name: "probe", entities: npcs, blockers: [], source: f.source };
    f.map.scripts.reserved!.splice(1, 0, { kind: "entities", group: "probe", script: "reserved", index: 1, source: f.source });
    f.map.map!.entryContext!.groups.probe = { savePointCount: 0, reason: null, source: f.source };
  }
  const entry = new NewGameFieldEntry(f.content.entry, f.presentation);
  const start = entry.prepareStart(f.fade, { active: true, callbacks: "absent" }); start.commit();
  let fade = start.fade; fade.advance(0.5);
  for (let i = 0; i < 3; i++) { const step = entry.prepareResume(fade, true)!; step.commit(); fade = step.fade; }
  const game = GameSession.prepareNewGame(f.content, f.world, f.map, f.battle, fade, f.presentation);
  const launch = entry.prepareLaunch(fade, game.newGamePreparation(true)); game.launchNewGame(launch.launch); launch.commit();
  game.advance(10);
  assert.equal(game.field.stop, null); assert.equal(game.checkpointReady, true);
  const initial = checkpointFixture().field;
  initial.parentSourceSetHash = f.content.parentSourceSetHash;
  const deps = { catalog: f.world, map: f.map, source: { content: f.content, initialMap: f.map } };
  return { f, game, initial, deps, restore: (raw: GameCheckpoint) => GameSession.restore(raw, initial, f.battle, deps) };
}

test("native source session round-trips explicit origin, complete actors and completed lifecycle", async () => {
  const t = fixture(true), { game } = t;
  game.field.eventState.write(reservedFlag, 0);
  game.field.actors["601"]!.native!.entity.visible = false;
  game.field.actors["601"]!.native!.entity.fadeAlpha = Math.fround(0.25);
  game.field.actors["601"]!.steps = 27;
  game.field.actors["probe:0:1"]!.animation!.play("wave", true, 1.5);
  game.advance(73);
  game.field.options.puppetActors!.prepareCollision(false)();
  game.field.options.sourceMessageEffects!.prepare([{ kind: "entity-update-group", group: 8, invokeCallback: false }])();
  const raw = game.checkpoint();
  assert.equal(raw.formatVersion, 4); assert.equal(raw.world.kind, "idle-world-v10");
  assert.equal(raw.world.field.kind, "idle-field-v10"); assert.equal(raw.world.field.actors.length, 0);
  assert.deepEqual(raw.origin, { kind: "source-new-game", sourceContentHash: t.f.content.contentHash });
  assert.equal(raw.world.field.native!.completedScript!.name, "reserved");
  const restored = t.restore((await decodeSavedGame(await encodeSavedGame(raw, 0))).checkpoint);
  assert.deepEqual(restored.checkpoint(), raw);
  assert.equal(restored.field.eventState.read(reservedFlag), 0, "source entry effects must not replay");
  assert.equal(restored.field.eventState.read(fallbackFlag), 0);
  assert.equal(restored.field.options.puppetActors!.read().context.camera, "native:camera");
  assert.deepEqual(restored.field.options.puppetActors!.read().context.entities, [{ entityId: 601, actor: "601" }]);
  assert.equal(restored.field.actors["probe:0:1"]!.native!.scope!.kind, "map-npc");
  assert.throws(() => restored.newGamePreparation(true), /incomplete/);
  for (const elapsed of [10, 91, 220]) { game.advance(elapsed); restored.advance(elapsed); }
  assert.deepEqual(restored.checkpoint(), game.checkpoint());
});

test("whole-session restore never invokes native factory, NPC initialization, Look or Cue", () => {
  const t = fixture(true), raw = t.game.checkpoint();
  const look = ActorAnimation.prototype.look, cue = ActorAnimation.prototype.cue, install = FieldGame.prototype.installNativeActors;
  ActorAnimation.prototype.look = () => { throw new Error("Unexpected Look replay"); };
  ActorAnimation.prototype.cue = () => { throw new Error("Unexpected Cue replay"); };
  FieldGame.prototype.installNativeActors = () => { throw new Error("Unexpected factory/NPC initialization"); };
  try {
    assert.deepEqual(t.restore(raw).checkpoint(), raw);
    assert.deepEqual(GameSession.restore(raw, undefined, t.f.battle, t.deps).checkpoint(), raw);
  }
  finally { ActorAnimation.prototype.look = look; ActorAnimation.prototype.cue = cue; FieldGame.prototype.installNativeActors = install; }
});

test("source restore has no legacy initial-field dependency and requires its own trusted source resources", () => {
  const t = fixture(true), raw = t.game.checkpoint();
  const unrelatedInitial = new Proxy(t.initial, { get: () => { throw new Error("Legacy field must not be read"); } });
  assert.deepEqual(GameSession.restore(raw, unrelatedInitial, t.f.battle, t.deps).checkpoint(), raw);
  assert.throws(() => GameSession.restore(raw, undefined, t.f.battle), /trusted native/);
  const wrongOrigin = structuredClone(raw); wrongOrigin.world.initialHash = "different-source-entry";
  assert.throws(() => GameSession.restore(wrongOrigin, undefined, t.f.battle, t.deps), /trusted native/);
  const wrongBattle = structuredClone(t.f.battle); wrongBattle.contentHash = "different-battle";
  assert.throws(() => GameSession.restore(raw, undefined, wrongBattle, t.deps), /source\/version mismatch/);
  const wrongWorld = structuredClone(t.deps); wrongWorld.catalog.contentHash = "different-world";
  assert.throws(() => GameSession.restore(raw, undefined, t.f.battle, wrongWorld), /binding mismatch/);
  assert.deepEqual(t.game.checkpoint(), raw);
});

test("development restore still requires its initial package and cannot borrow source restore dependencies", () => {
  const f = checkpointFixture(), raw = f.game.checkpoint(), source = fixture();
  assert.throws(() => GameSession.restore(raw, undefined, f.battle), /development initial content is required/);
  assert.throws(() => GameSession.restore(raw, undefined, f.battle, source.deps), /development initial content is required/);
  const wrongInitial = structuredClone(f.field); wrongInitial.parentSourceSetHash = "another-source";
  assert.throws(() => GameSession.restore(raw, wrongInitial, f.battle), /source\/version mismatch/);
  assert.deepEqual(GameSession.restore(raw, f.field, f.battle).checkpoint(), raw);
});

test("source restore keeps the trusted initial-map FX gate before host preparation", () => {
  const t = fixture(), raw = t.game.checkpoint(), deps = structuredClone(t.deps);
  const entity = structuredClone(checkpointFixture().target.map!.entities[0]!);
  entity.kind = 11;
  deps.source.initialMap.map!.entities.push(entity);
  let prepared = 0;
  assert.throws(() => GameSession.restore(raw, undefined, t.f.battle, deps, {
    fieldEffects: { prepare: () => { prepared++; throw new Error("Unexpected FX host publication"); },
      observe: () => { throw new Error("Unexpected FX observation"); } },
  }), /particle\/RNG/);
  assert.equal(prepared, 0);
  assert.deepEqual(t.game.checkpoint(), raw);
});

test("default NPCs and subsequently activated anonymous NPCs restore into one owner", () => {
  const t = fixture("mixed");
  assert.equal(t.game.field.actors["601"]!.native!.scope!.group, "entity_default");
  assert.equal(t.game.field.actors["probe:0:1"]!.native!.scope!.group, "probe");
  const saved = t.game.checkpoint(), restored = t.restore(saved);
  assert.deepEqual(restored.checkpoint(), saved);
  assert.equal(Object.keys(restored.field.actors).filter((id) => id === "601").length, 1);
  assert.equal(restored.field.options.puppetActors!.read().context.entities.length, 1);
});

test("native restore source capabilities cannot be acquired from owned origin or saved actor metadata", () => {
  const t = fixture(true), raw = t.game.checkpoint(), before = structuredClone(raw);
  const changes: ((s: GameCheckpoint) => void)[] = [
    (s) => { Object.assign(s, { formatVersion: 3 }); },
    (s) => { Object.assign(s.world, { kind: "idle-world-v8" }); },
    (s) => { Object.assign(s.world.field, { kind: "idle-field-v8" }); },
    (s) => { s.origin = { kind: "development-checkpoint" }; },
    (s) => { s.owned.initialization = "development-checkpoint"; },
    (s) => { Object.assign(s.origin, { sourceContentHash: "foreign" }); },
    (s) => { s.world.field.native = null; },
    (s) => { s.world.field.native!.actors.actors.pop(); },
    (s) => { s.world.field.native!.actors.actors.push(s.world.field.native!.actors.actors[0]!); },
    (s) => { Object.assign(s.world.field.native!.actors.actors[0]!, { fieldAssetId: 1 }); },
    (s) => { s.world.field.native!.actors.actors[0]!.position.x = NaN; },
    (s) => { s.world.field.native!.collision.entityCollision = false; },
    (s) => { s.world.field.native!.updateMask = 0; },
    (s) => { s.world.field.native!.completedScript!.name = "not-a-source-script"; },
    (s) => { s.world.field.native!.completedScript!.assignments.pop(); },
    (s) => { s.world.field.camera = null; },
    (s) => { s.world.field.fade = null; },
    (s) => { s.world.field.hiddenEntities.push("601"); },
    (s) => { s.world.field.activeGroups = ["entity_default"]; },
    (s) => { s.world.field.native!.actors.actors.find((a) => a.id === "601")!.view!.map = "f".repeat(64); },
  ];
  for (const change of changes) {
    const bad = structuredClone(raw); change(bad);
    assert.throws(() => t.restore(bad));
    assert.deepEqual(t.game.checkpoint(), before);
  }
  assert.throws(() => GameSession.restore(raw, t.initial, t.f.battle), /trusted native/);
  assert.throws(() => GameSession.restore(raw, t.initial, t.f.battle, { catalog: t.f.world, map: t.f.map }), /trusted native/);
  const wrong = structuredClone(t.deps); wrong.source.initialMap.contentHash = "foreign";
  assert.throws(() => GameSession.restore(raw, t.initial, t.f.battle, wrong), /binding mismatch/);
  assert.deepEqual(t.game.checkpoint(), before);
});

test("reconstructed native ports can run the next script without reactivating saved groups", () => {
  const t = fixture(true), raw = t.game.checkpoint(), restored = t.restore(raw);
  const before = Object.keys(restored.field.actors);
  assert.equal(restored.field.startEvent("fallback"), true);
  restored.advance(10);
  assert.equal(restored.field.stop, null); assert.equal(restored.field.eventState.read(fallbackFlag), 1);
  assert.deepEqual(Object.keys(restored.field.actors), before);
  assert.equal(restored.checkpointReady, true);
  const second = t.restore(restored.checkpoint()); assert.deepEqual(second.checkpoint(), restored.checkpoint());
});

test("native world-location restore binds its destination while retaining the trusted fresh origin", () => {
  const t = fixture(true);
  t.f.world.transportation = structuredClone(t.f.battle.gameState.sourceNewGame!.transportation);
  const target = structuredClone(t.f.map);
  target.mapId = 902; target.contentHash = "controlled-second-map";
  target.map!.identity!.mapId = 902; target.partyEntry!.mapId = 902;
  target.map!.entryContext!.mapId = 902;
  target.actorView!.contextId = "e".repeat(64);
  // The source map initializer is a real VM task in this controlled fixture.
  // It creates its own local NPCs; the old map's instances are retired.
  target.scripts.fallback!.unshift({ kind: "entities", group: "probe", script: "fallback", index: 0, source: t.f.source });
  t.f.world.maps[902] = { ...t.f.world.maps[t.f.map.mapId]!, contentHash: target.contentHash, url: "/controlled-second.json" };
  const oldNpc = t.game.field.actors["601"]!;
  t.game.field.previewMap(902, t.f.content.entry.entrance);
  assert.equal(t.game.world.commit(t.game.world.prepare(t.f.world, target)), true); t.game.advance(10);
  assert.equal(t.game.field.stop, null); assert.equal(t.game.checkpointReady, true);
  assert.notEqual(t.game.field.actors["601"], oldNpc);
  t.game.field.actors["601"]!.steps = 9;
  const raw = t.game.checkpoint(), deps = { ...t.deps, map: target };
  assert.equal(raw.world.location!.mapId, 902); assert.equal(raw.world.initialHash, t.f.content.contentHash);
  const restored = GameSession.restore(raw, t.initial, t.f.battle, deps);
  assert.deepEqual(restored.checkpoint(), raw);
  assert.deepEqual(GameSession.restore(raw, undefined, t.f.battle, deps).checkpoint(), raw);
  assert.equal(restored.field.content.contentHash, target.contentHash);
  assert.equal(restored.field.actors["601"]!.steps, 9);
  assert.equal(restored.field.eventState.read(fallbackFlag), 1);
  assert.throws(() => GameSession.restore(raw, t.initial, t.f.battle, t.deps), /identity mismatch/);
  const before = t.game.checkpoint(), sameField = t.game.field;
  const bad = structuredClone(raw); bad.world.field.native!.actors.actors[0]!.animation!.key = "foreign-key";
  assert.throws(() => t.game.world.restore(bad.world, t.f.world, target, deps.source), /Missing actor animation/);
  assert.equal(t.game.field, sameField); assert.deepEqual(t.game.checkpoint(), before);
});

test("source session restore rebinds host observations without persisting or reusing the old port", () => {
  const t = fixture(), raw = t.game.checkpoint(), readiness = { isReady: () => true };
  const restored = GameSession.restore(raw, t.initial, t.f.battle, t.deps, { audioReadiness: readiness });
  assert.equal(restored.field.options.audioReadiness, readiness);
  assert.notEqual(restored.field.options.puppetActors, t.game.field.options.puppetActors);
  assert.notEqual(restored.field.actors["native:puppet:0"], t.game.field.actors["native:puppet:0"]);
  assert.deepEqual(restored.checkpoint(), raw);
});

test("native stable saves stay unavailable during script, motion and transition", () => {
  const t = fixture(), a = t.game.field.player;
  a.motion = { from: { x: a.x, y: a.y }, to: { x: a.x + 1, y: a.y }, elapsed: 0, duration: 240, manual: false };
  assert.equal(t.game.checkpointReady, false); a.motion = null;
  t.game.field.previewMap(t.f.map.mapId, t.f.content.entry.entrance);
  assert.equal(t.game.checkpointReady, false); assert.throws(() => t.game.checkpoint(), /Cannot save/);
  const g = fixture(); g.game.field.startEvent("reserved");
  assert.equal(g.game.checkpointReady, false); assert.throws(() => g.game.checkpoint(), /Cannot save/);
});

test("source saved ownership and changed camera offset survive condition refresh without replaying its writes", () => {
  const t = fixture(false, (f) => {
    f.battle.gameState.partyActors!.conditionTypes[9007] = 607;
    f.battle.gameState.partyActors!.viewpointOffsets = [{ fieldAssetId: 2, x: 3, y: 16 }];
    f.map.scriptSystemFlags = { reserved: { keepBadStatusVisual: false } };
    f.map.scripts.reserved!.unshift({ kind: "owned-condition", script: "reserved", index: 0, source: f.source,
      command: { kind: "add-condition", conditionType: 607, target: 0 }, dependencies: [] });
  });
  const raw = t.game.checkpoint();
  assert.deepEqual(raw.owned.roster[0]!.conditionIds, [9007]);
  assert.deepEqual(raw.world.field.native!.cameraOffset, { x: 3, y: 16 });
  assert.deepEqual(t.restore(raw).checkpoint(), raw);
  assert.deepEqual(t.restore(raw).field.cameraOffset, { x: 3, y: 16 });
});

test("failed native restore and storage publication preserve both current session and prior save bytes", async () => {
  const t = fixture(true), checkpoint = t.game.checkpoint();
  let value: string | null = null, fail = false;
  const store = new CheckpointStorage({ getItem: () => value, setItem: (_key, next) => {
    if (fail) throw new Error("quota"); value = next;
  } });
  await store.save(checkpoint, 1); const savedBytes = value;
  const bad = structuredClone(checkpoint); bad.world.field.native!.actors.actors.pop();
  let published = t.game;
  assert.throws(() => { const candidate = t.restore(bad); published = candidate; });
  assert.equal(published, t.game); assert.equal(value, savedBytes);
  fail = true; await assert.rejects(store.save(checkpoint, 2), /quota/);
  assert.equal(value, savedBytes); assert.deepEqual(t.game.checkpoint(), checkpoint);
});
