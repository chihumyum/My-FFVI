import test from "node:test";
import assert from "node:assert/strict";
import { compileFieldTransportationInstruction } from "../src/compiler/field-transportation.js";
import { GameSession, type GameCheckpoint, type GameSessionRuntime } from "../src/core/game-session.js";
import { NewGameFieldEntry } from "../src/core/new-game-field-entry.js";
import { EventState } from "../src/core/event-state.js";
import { Transportations } from "../src/core/transportation.js";
import { transportationStayMaps } from "../src/core/transportation-state.js";
import { resolveFieldPuppetActor } from "../src/core/field-puppet-actors.js";
import type { DevelopmentProfile } from "../src/core/development-profile.js";
import type { Op, Site } from "../src/field/types.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";
import { sourceNewGameFixture } from "./fixtures/source-new-game.js";

type Instruction<T> = T extends Site ? Omit<T, keyof Site> : never;
const ticks = "638958585001234567";
const place = (map = 901, layer = 0) => compileFieldTransportationInstruction({ type: 1, mnemonic: "SetVehicle",
  operands: { iValues: [6, map, 16, 24, layer, 1, 0, 0], rValues: Array(8).fill(0), sValues: Array(8).fill("") } });
const change = (id: 1 | 6) => compileFieldTransportationInstruction({ type: 1, mnemonic: "SysCall",
  operands: { iValues: Array(8).fill(0), rValues: Array(8).fill(0),
    sValues: [id === 1 ? "乗り物から降りる" : "乗り物に乗る：魔導アーマー", ...Array(7).fill("")] } });
const ride = (id: 1 | 6) => compileFieldTransportationInstruction({ type: 1, mnemonic: "RideVehicleNPC",
  operands: { iValues: [id, -1001, 0, 0, 0, 0, 0, 0], rValues: Array(8).fill(0), sValues: Array(8).fill("") } });

/** Controlled source factory/session. The transport table explicitly adopts
 * the admitted Magitek ID/type/asset; no original reachable story is claimed. */
function fixture(options: { strict?: boolean; runtime?: GameSessionRuntime } = {}) {
  const f = sourceNewGameFixture();
  const catalog = f.battle.gameState.sourceNewGame!.transportation;
  Object.assign(catalog.definitions.find((d) => d.id === 9)!, { id: 6, assetId: 38 });
  f.world.transportation = structuredClone(catalog);
  // Explicit controlled rider frames satisfy the existing source-key media
  // boundary. Their artwork is a fixture, not an original riding animation.
  for (const [asset, character] of Object.entries(f.world.characters)) {
    character.animations.RideL = structuredClone(character.animations.WalkL!);
    character.animations.RideR = structuredClone(character.animations.WalkR!);
    f.world.nativeAnimationKeys!.assets[asset]!.keys = Object.keys(character.animations);
  }
  f.content.animationKeys = structuredClone(f.world.nativeAnimationKeys!);
  const profile: DevelopmentProfile = { kind: "framework-development-v1",
    policy: "omit-anonymous-environment-particles-v1", sourceContentHash: "controlled-transport-parent",
    omissions: [], transportation: "walking-magitek-framework-v1" };
  if (!options.strict) {
    f.content.developmentProfile = structuredClone(profile);
    f.map.developmentProfile = structuredClone(profile); f.world.developmentProfile = structuredClone(profile);
  }
  const emit = (script: string, instructions: Instruction<Op>[]): Op[] => instructions.map((instruction, index) =>
    ({ ...instruction, script, index, source: f.source }) as Op);
  const add = (script: string, instructions: Instruction<Op>[]) => {
    f.map.scripts[script] = emit(script, instructions);
    f.map.scriptPuppetContexts![script] = { ...f.map.scriptPuppetContexts!.reserved!, scriptHash: "d".repeat(64) };
    f.map.scriptLocals![script] = null;
  };
  for (const [name, command] of [["park", place()], ["park_upper", place(902, 2)],
    ["board", change(6)], ["walk", change(1)], ["ride_puppet", ride(6)], ["unride_puppet", ride(1)]] as const)
    add(name, [{ kind: "wait", seconds: 0 }, command, { kind: "wait", seconds: 0 }, { kind: "exit" }]);
  const entry = new NewGameFieldEntry(f.content.entry, f.presentation), start = entry.prepareStart(f.fade,
    { active: true, callbacks: "absent" }); start.commit();
  let fade = start.fade; fade.advance(0.5);
  for (let i = 0; i < 3; i++) { const next = entry.prepareResume(fade, true)!; next.commit(); fade = next.fade; }
  const runtime = options.runtime ?? { transportationTimestamp: () => ticks };
  const game = GameSession.prepareNewGame(f.content, f.world, f.map, f.battle, fade, f.presentation, runtime);
  const launch = entry.prepareLaunch(fade, game.newGamePreparation(true)); game.launchNewGame(launch.launch); launch.commit();
  game.advance(10); assert.equal(game.field.stop, null); assert.equal(game.checkpointReady, true);
  const initial = checkpointFixture().field; initial.parentSourceSetHash = f.content.parentSourceSetHash;
  const dependencies = { catalog: f.world, map: f.map, source: { content: f.content, initialMap: f.map } };
  const restore = (saved: GameCheckpoint, map = f.map, boundRuntime = runtime) => GameSession.restore(saved, initial,
    f.battle, { ...dependencies, map }, boundRuntime);
  const rules = new Transportations(catalog), flag = rules.releaseFlagRef(6);
  const begin = (script: string, session = game) => { assert.equal(session.field.startEvent(script), true); };
  const run = (script: string, session = game) => {
    begin(script, session); session.advance(20);
    assert.equal(session.field.stop, null); assert.equal(session.checkpointReady, true);
  };
  const target = (commands: Instruction<Op>[]) => {
    const map = structuredClone(f.map);
    map.mapId = 902; map.contentHash = "controlled-transport-destination";
    map.map!.identity!.mapId = 902; map.partyEntry!.mapId = 902; map.map!.entryContext!.mapId = 902;
    map.actorView!.contextId = "e".repeat(64);
    map.scripts.fallback = emit("fallback", commands);
    f.world.maps[902] = { ...f.world.maps[f.map.mapId]!, contentHash: map.contentHash, url: "/transport-destination.json" };
    return map;
  };
  return { ...f, game, flag, rules, begin, run, restore, target, ticks };
}

function stableOwners(t: ReturnType<typeof fixture>) {
  return { owned: t.game.state.snapshot(), events: t.game.field.eventState.snapshot(),
    actors: t.game.field.nativeActorStateFingerprint, party: t.game.field.partyActorCheckpoint,
    camera: t.game.field.cameraSnapshot, offset: t.game.field.cameraOffset,
    collision: t.game.field.collisionState, current: t.game.field.transportationId };
}

test("session SetVehicle jointly writes complete source parking and flag while preserving actor and controller owners", () => {
  const t = fixture(), field = t.game.field, player = field.player, entity = player.native!.entity;
  const originalPosition = { ...entity.position };
  t.begin("park"); const before = stableOwners(t);
  t.game.advance(10);
  assert.equal(field.stop, null); assert.equal(field.transportationId, 1);
  assert.equal(field.eventState.read(t.flag), 1);
  assert.deepEqual(t.game.state.nativeState!.ownedTransportations.find((r) => r.id === 6), {
    id: 6, mapId: 901, position: { x: 16, y: 24, z: 349 }, direction: 2, timeStampTicks: ticks,
  });
  assert.equal(field.player, player); assert.equal(player.native!.entity, entity);
  assert.deepEqual(entity.position, originalPosition);
  assert.equal(field.nativeActorStateFingerprint, before.actors);
  assert.deepEqual(field.partyActorCheckpoint, before.party); assert.deepEqual(field.cameraOffset, before.offset);
  assert.deepEqual(t.game.state.nativeState!.entrySeed, before.owned.nativeState!.entrySeed);
  t.game.advance(10); assert.equal(t.game.checkpointReady, true);
  const saved = JSON.parse(JSON.stringify(t.game.checkpoint())) as GameCheckpoint;
  assert.equal(saved.owned.formatVersion, 10); assert.equal(saved.owned.nativeState!.kind, "source-native-state-v2");
  const restored = t.restore(saved);
  assert.deepEqual(restored.checkpoint(), saved);
  t.run("park_upper", restored);
  assert.deepEqual(restored.state.nativeState!.ownedTransportations.find((r) => r.id === 6), {
    id: 6, mapId: 902, position: { x: 16, y: 24, z: 249 }, direction: 2, timeStampTicks: ticks,
  });
  assert.equal(t.game.state.nativeState!.ownedTransportations.find((r) => r.id === 6)!.mapId, 901);
});

test("missing clock, invalid timestamp and strict-source presentation fail before parking or flag writes", () => {
  for (const setup of [{ runtime: {} }, { runtime: { transportationTimestamp: () => "bad" } }, { strict: true }]) {
    const t = fixture(setup); t.begin("park"); const before = stableOwners(t);
    t.game.advance(10);
    assert.equal(t.game.field.stop?.kind, "unsupported");
    assert.match(t.game.field.stop!.message, /timestamp|explicit framework/);
    assert.deepEqual(stableOwners(t), before);
    assert.equal(t.game.field.transportationExecutions.length, 0);
  }
});

test("boarding honors the separate release flag, changes the same native actor and persists controller plus rider identity", () => {
  const t = fixture(), player = t.game.field.player, entity = player.native!.entity;
  t.run("board");
  assert.equal(t.game.field.transportationId, 1, "disabled requested transport leaves current controller selected");
  assert.equal(player.mount, null);
  t.run("park"); const owned = t.game.state.snapshot();
  t.run("board");
  assert.equal(t.game.field.transportationId, 6); assert.equal(t.game.field.player, player);
  assert.equal(player.native!.entity, entity); assert.equal(player.mount, "armor"); assert.equal(player.asset, "bravo");
  assert.equal(player.native!.fieldAssetId, 38); assert.equal(entity.riderAssetId, 2);
  assert.equal(t.game.field.partyActorCheckpoint!.context.currentTransport!.id, 6);
  assert.deepEqual(t.game.state.snapshot(), owned, "boarding does not overwrite parking or grant ownership");
  const saved = JSON.parse(JSON.stringify(t.game.checkpoint())) as GameCheckpoint, restored = t.restore(saved);
  assert.deepEqual(restored.checkpoint(), saved); assert.equal(restored.field.player.mount, "armor");
  t.run("walk", restored);
  assert.equal(restored.field.transportationId, 1); assert.equal(restored.field.player.mount, null);
  assert.equal(restored.field.player.asset, "bravo"); assert.equal(restored.field.player.native!.entity.riderAssetId, 2);
  assert.equal(restored.field.eventState.read(t.flag), 1, "disembarking does not disable an owned transport");
  assert.deepEqual(restored.state.nativeState, owned.nativeState);
});

test("unavailable rider media is rejected without partly changing actor, party, camera or current transport", () => {
  const t = fixture(); t.run("park"); t.begin("board");
  delete t.game.field.content.characters.armor;
  const before = stableOwners(t), player = t.game.field.player, entity = player.native!.entity;
  t.game.advance(10);
  assert.equal(t.game.field.stop?.kind, "unsupported"); assert.match(t.game.field.stop!.message, /media/);
  assert.deepEqual(stableOwners(t), before); assert.equal(t.game.field.player, player); assert.equal(player.native!.entity, entity);
});

test("RideVehicleNPC affects the selected native puppet and never changes the transportation controller or owned parking", () => {
  const t = fixture(); t.begin("ride_puppet");
  const read = t.game.field.options.puppetActors!.read();
  const actorId = resolveFieldPuppetActor(read.catalog, read.context, -1001).actor!;
  assert.notEqual(actorId, t.game.field.player.id);
  const actor = t.game.field.actors[actorId]!, entity = actor.native!.entity, owned = t.game.state.snapshot();
  t.game.advance(10);
  assert.equal(t.game.field.stop, null); assert.equal(t.game.field.actors[actorId], actor);
  assert.equal(actor.native!.entity, entity); assert.equal(actor.mount, "armor");
  assert.equal(t.game.field.transportationId, 1); assert.equal(t.game.field.player.mount, null);
  assert.deepEqual(t.game.state.snapshot(), owned); assert.equal(t.game.field.eventState.read(t.flag), 0);
  t.game.advance(10); assert.equal(t.game.field.stop, null);
});

test("destination script parking remains private until map commit and the published port keeps following owned state", () => {
  const t = fixture(), map = t.target([place(902, 2), { kind: "wait", seconds: 0 }, { kind: "exit" }]);
  t.game.field.previewMap(902, t.content.entry.entrance);
  const field = t.game.field, before = stableOwners(t), pending = t.game.world.prepare(t.world, map);
  assert.deepEqual(stableOwners(t), before); assert.equal(pending.field.eventState.read(t.flag), 1);
  assert.equal(pending.field.options.transportation!.read().find((r) => r.id === 6)!.mapId, 902);
  assert.equal(t.game.world.commit(pending), true); assert.notEqual(t.game.field, field);
  assert.equal(t.game.state.nativeState!.ownedTransportations.find((r) => r.id === 6)!.mapId, 902);
  t.game.advance(10); assert.equal(t.game.field.stop, null); assert.equal(t.game.checkpointReady, true);
  const saved = t.game.checkpoint(); assert.deepEqual(t.restore(saved, map).checkpoint(), saved);
  // This script belongs to the destination but uses the same port after its
  // private candidate has been published. It must reach the current owner.
  t.run("park");
  assert.equal(t.game.state.nativeState!.ownedTransportations.find((r) => r.id === 6)!.mapId, 901);
  assert.equal(transportationStayMaps(t.game.state.fieldTransportation!.read())[6], 901);
});

test("failed, discarded and stale map candidates cannot leak their parking or release flags to the old field", () => {
  for (const mode of ["failed", "discarded", "stale"] as const) {
    const t = fixture(), map = t.target([place(902), mode === "failed"
      ? { kind: "blocked", mnemonic: "ControlledRejected", reason: "controlled destination rejection" }
      : { kind: "wait", seconds: 0 }, { kind: "exit" }]);
    t.game.field.previewMap(902, t.content.entry.entrance);
    const field = t.game.field, player = field.player, before = stableOwners(t);
    if (mode === "failed") assert.throws(() => t.game.world.prepare(t.world, map), /controlled destination rejection/);
    else {
      const pending = t.game.world.prepare(t.world, map);
      assert.deepEqual(stableOwners(t), before);
      if (mode === "discarded") {
        t.game.world.discard(pending); assert.equal(t.game.world.commit(pending), false);
      } else {
        t.game.state.fieldTransportation!.prepare({ id: 6, enable: true, mapId: 777,
          position: null, layer: null, direction: null, timeStampTicks: ticks }).commit();
        const current = t.game.state.snapshot();
        assert.equal(t.game.world.commit(pending), false); assert.deepEqual(t.game.state.snapshot(), current);
        before.owned = current;
      }
    }
    assert.equal(t.game.field, field); assert.equal(t.game.field.player, player);
    assert.deepEqual(stableOwners(t), before); assert.equal(field.eventState.read(t.flag), 0);
  }
});

test("a mounted native session retains its current controller and parking through a new map and stable restore", () => {
  const t = fixture(); t.run("park"); t.run("board");
  const before = t.game.state.snapshot(), map = t.target([{ kind: "wait", seconds: 0 }, { kind: "exit" }]);
  t.game.field.previewMap(902, t.content.entry.entrance);
  const pending = t.game.world.prepare(t.world, map);
  assert.deepEqual(t.game.state.snapshot(), before);
  assert.equal(t.game.world.commit(pending), true); t.game.advance(10);
  assert.equal(t.game.field.stop, null); assert.equal(t.game.field.transportationId, 6);
  assert.equal(t.game.field.player.mount, "armor"); assert.equal(t.game.field.player.asset, "bravo");
  assert.deepEqual(t.game.state.snapshot(), before, "PointIn must not replace the original parking record");
  assert.equal(t.game.checkpointReady, true);
  const saved = t.game.checkpoint(); assert.deepEqual(t.restore(saved, map).checkpoint(), saved);
});

test("restoring parking rebinds the host clock without acquiring it from saved data", () => {
  const t = fixture(); t.run("park"); const saved = t.game.checkpoint();
  const restored = t.restore(saved, t.map, {});
  assert.deepEqual(restored.checkpoint(), saved); assert.equal(restored.field.options.transportationTimestamp, undefined);
  t.begin("park_upper", restored); const before = restored.state.snapshot(), events = restored.field.eventState.snapshot();
  restored.advance(10);
  assert.equal(restored.field.stop?.kind, "unsupported"); assert.match(restored.field.stop!.message, /timestamp observation/);
  assert.deepEqual(restored.state.snapshot(), before); assert.deepEqual(restored.field.eventState.snapshot(), events);
});

test("transport restore rejects old owned format and mismatched saved controller, party or availability", () => {
  const t = fixture(); t.run("park"); t.run("board"); const saved = t.game.checkpoint();
  for (const mutate of [(s: GameCheckpoint) => { Object.assign(s.owned, { formatVersion: 9 }); },
    (s: GameCheckpoint) => { s.world.field.transportationId = 1; },
    (s: GameCheckpoint) => { s.world.field.partyActors!.context.currentTransport!.id = 1; },
    (s: GameCheckpoint) => { const state = new EventState(s.world.field.eventState);
      state.write(t.flag, 0); s.world.field.eventState = state.snapshot(); },
    (s: GameCheckpoint) => { s.owned.nativeState!.ownedTransportations.splice(1); }]) {
    const bad = structuredClone(saved); mutate(bad);
    assert.throws(() => t.restore(bad)); assert.deepEqual(t.game.checkpoint(), saved);
  }
});
