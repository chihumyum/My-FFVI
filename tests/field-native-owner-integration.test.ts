import test from "node:test";
import assert from "node:assert/strict";
import { decodeFieldOp } from "../src/compiler/field.js";
import { createFieldActorFactoryCandidate, type FieldActorFactoryCandidate } from "../src/core/field-actor-factory.js";
import { fieldCameraCellToWorld, fieldCameraLayerFromLogical } from "../src/core/field-camera.js";
import { EventState } from "../src/core/event-state.js";
import { DEVELOPMENT_TRANSPARENT_FADE } from "../src/core/field-fade.js";
import { FieldGame, type FieldGameOptions } from "../src/core/field.js";
import type { FieldPuppetActorCatalog, FieldPuppetScriptContext } from "../src/core/field-puppet-actors.js";
import type { FieldPuppetHostProviders } from "../src/core/field-puppet-effects.js";
import type { FieldContent, FieldEntity, Op, Site } from "../src/field/types.js";
import { fieldActorFactoryFixture } from "./fixtures/field-actor-factory.js";

type Instruction<T> = T extends Site ? Omit<T, keyof Site> : never;
const source = { file: "synthetic", assetPath: "native-owner-integration" };
const flag = { category: "ScenarioFlag1" as const, index: 19 };
const at = (instruction: Instruction<Op>, index: number): Op => ({ ...instruction, script: "controlled", index, source }) as Op;
const end = { kind: "exit" } as const;
const subtitle: Instruction<Op> = { kind: "source-message", command: { kind: "play",
  key: "synthetic-subtitle", speaker: "", seconds: -1,
  layout: { window: "none", anchor: "middle" }, document: {
    kind: "source-message-document-v1", text: "A short page", alignment: "center",
    autoPage: true, tailWaitSeconds: 63.75,
  } } };
const decodeVisibility = (mnemonic: "HidePlayer" | "ShowPlayer") => decodeFieldOp({
  type: 1, mnemonic, operands: { iValues: Array(8).fill(0), rValues: Array(8).fill(0), sValues: Array(8).fill("") },
}, { script: "controlled", index: 0, source }, {});
const entity = (id: string, kind: number, patch: Partial<FieldEntity> = {}): FieldEntity => ({
  id, kind, x: 4, y: 4, width: 1, height: 1, layer: 0, direction: "left", asset: null,
  script: null, collision: null, destinationLayer: null, source, ...patch,
});

function setup(entities: FieldEntity[] = [], install = true, nativeLifecycle = false) {
  const f = fieldActorFactoryFixture(), point = f.entry.player;
  // The old factory fixture's illustrative -2 Z is not a source PointIn pose.
  // Bind all three coordinates and the Unity layer through the actual helpers.
  f.input.player.position = fieldCameraCellToWorld(f.map.mapRange, { x: point.x, y: point.y }, point.layer);
  f.input.player.layer = fieldCameraLayerFromLogical(point.layer).layer;
  f.input.camera = { id: "native:camera", position: { x: 30000, y: 1000, z: -1000 }, layer: 0 };
  const candidate = createFieldActorFactoryCandidate({ ...f.input, player: { ...f.input.player, direction: point.direction } });
  const catalog: FieldPuppetActorCatalog = { kind: "field-puppet-actors-v1", memberCount: 4,
    characteristics: true, corpsOrder: [0, 1, 2, 3], residents: [], conditionChanges: [], miscHash: "b".repeat(64) };
  const script: FieldPuppetScriptContext = { skipInitialize: false, keepPlayerPuppet: false,
    keepBadStatusVisual: false, ridingVehicle: false, characteristics: true,
    scriptHash: "a".repeat(64), miscHash: catalog.miscHash };
  const content: FieldContent = {
    formatVersion: 1, kind: "field-development", sourceSetHash: "synthetic-native-owner",
    parentSourceSetHash: "synthetic", contentHash: "synthetic-field-native-owner", characters: f.characters,
    scripts: {}, scriptPuppetContexts: {}, limitations: [],
    cameraHost: { kind: "source-field-camera-host-v1", mapRange: { ...f.map.mapRange },
      loop: { horizontal: false, vertical: false }, playerVisualOffset: { x: 0, y: -6 },
      callbacks: "fresh-normal-field-v1", sources: f.sources.map((s) => ({ ...s })) },
    map: { id: "controlled", identity: { mapId: f.map.mapId, areaId: 1 }, width: f.map.width,
      height: f.map.height, tileSize: 16, layers: [], tilesets: [], textures: {}, source,
      collisions: { 0: Array(f.map.width * f.map.height).fill(0) }, entities },
    entry: { player: { x: point.x, y: point.y, layer: point.layer, direction: point.direction,
      asset: point.asset, mount: point.mount }, playerVisible: point.visible,
      partyActors: f.entry.checkpoint, transportationId: f.fresh.entry.transportation.id,
      cameraOffset: f.entry.cameraOffset, fade: structuredClone(DEVELOPMENT_TRANSPARENT_FADE),
      description: "Controlled source factory and shared owner", evidence: [source] },
  };
  const options: FieldGameOptions = {
    ...(nativeLifecycle ? { nativeActorPreparation: true } : {}),
    partyAppearance: { catalog: f.partyCatalog, current: () => structuredClone(f.party) },
    puppetRoster: { current: () => ({ owned: f.fresh.owned.roster.map((member) => ({
      ownedId: member.ownedId, sourceId: member.sourceId, enabled: member.enabled, conditionTypes: [],
    })), party: f.fresh.owned.party.slots[f.fresh.owned.party.selectedSlot].map((cell) =>
      cell.id === null ? 0 : f.fresh.owned.roster.find((member) => member.id === cell.id)!.ownedId,
    ) as [number, number, number, number] }) },
  };
  let providers: FieldPuppetHostProviders = f.input.providers;
  const game = new FieldGame(content, EventState.initialized(), undefined, undefined, options);
  const publish = (value: FieldActorFactoryCandidate = candidate) => game.installNativeActors(value,
    catalog, () => providers, { worldMapScript: false, callback: "absent" }, undefined,
    nativeLifecycle ? { factory: f.factory } : null);
  if (install) publish();
  const addScript = (name: string, instructions: Instruction<Op>[], skipInitialize = false) => {
    content.scripts[name] = instructions.map(at);
    content.scriptPuppetContexts![name] = { ...script, skipInitialize };
  };
  const collision = (enabled: boolean) => options.puppetActors!.prepareCollision(enabled)();
  return { f, content, game, options, candidate, publish, addScript, collision,
    setProviders: (value: FieldPuppetHostProviders) => { providers = value; } };
}

function state(game: FieldGame) {
  return structuredClone({
    actors: Object.entries(game.actors).map(([id, actor]) => ({ id, x: actor.x, y: actor.y, layer: actor.layer,
      direction: actor.direction, asset: actor.asset, mount: actor.mount, steps: actor.steps,
      animation: actor.animation?.snapshot() ?? null,
      native: actor.native ? { fieldAssetId: actor.native.fieldAssetId, charaZOffset: actor.native.charaZOffset,
        entity: { ...actor.native.entity, animation: actor.native.entity.animation?.snapshot() ?? null } } : null })),
    hidden: [...game.hiddenEntities], camera: game.cameraSnapshot,
    collision: game.collisionState, event: game.eventState.snapshot(), party: game.partyActorCheckpoint,
  });
}

test("source lifecycle writes the installed Actor and native entity identities, with a separate camera owner", () => {
  const t = setup(), owner = t.game.actors, player = t.game.player,
    refs = Object.values(owner).map((actor) => ({ actor, native: actor.native, entity: actor.native!.entity }));
  assert.deepEqual(player.native!.entity.position, { x: -104, y: 56, z: 349 });
  assert.deepEqual({ x: player.x, y: player.y, layer: player.layer }, { x: 3, y: 4, layer: 0 });
  assert.equal(owner[t.game.cameraActorId], undefined);
  assert.equal(t.game.options.puppetActors!.read().context.player, player.id);
  t.addScript("lifecycle", [{ kind: "wait", seconds: 0 }, end]);
  assert.equal(t.game.startEvent("lifecycle"), true);
  assert.equal(t.game.stop, null);
  const puppet = owner["native:puppet:0"]!;
  assert.deepEqual(puppet.native!.entity.position, player.native!.entity.position);
  assert.equal(puppet.animation, puppet.native!.entity.animation);
  assert.equal(puppet.animation!.snapshot()!.key, "WalkB");
  assert.equal(t.game.cameraSnapshot!.target, "dummy");
  t.game.advance(10);
  assert.equal(t.game.stop, null); assert.equal(t.game.busy, false);
  assert.equal(t.game.cameraSnapshot!.target, "player");
  assert.equal(t.game.actors, owner); assert.equal(t.game.player, player);
  for (const ref of refs) {
    assert.equal(owner[ref.actor.id], ref.actor);
    assert.equal(ref.actor.native, ref.native);
    assert.equal(ref.actor.native!.entity, ref.entity);
    assert.equal(ref.actor.animation, ref.entity.animation);
  }
});

function mapNpc(id: string, asset: string, updateAttribute: 2 | 10 = 2): FieldEntity {
  return entity(id, 6, { asset, direction: "up", nativeNpc: {
    kind: "native-map-npc-v1", group: "probe", entityId: id, sourceEntityId: Number(id), objectType: 6, source,
    geometry: { x: 64, y: 80, width: 16, height: 16, layer: 0 },
    sourceDirection: 1, direction: "up", asset: { id: 9001, asset, animationAsset: asset.toUpperCase(), shadowType: 1, source },
    updateAttribute, controller: "wait", turnAround: false,
  } });
}

test("native event group registers map-object NPCs in the single actor owner and excludes them from persistent handoff", () => {
  const t = setup([], true, true), player = t.game.player;
  const a = mapNpc("301", player.asset, 2), b = mapNpc("302", player.asset, 10);
  t.content.map.groups = { probe: { name: "probe", source, entities: [a, b], blockers: [] } };
  t.addScript("group", [{ kind: "entities", group: "probe" }, { kind: "wait", seconds: 0.05 }, end], true);
  t.game.startEvent("group");
  assert.equal(t.game.stop, null);
  const first = t.game.actors[a.id]!, second = t.game.actors[b.id]!;
  assert.equal(first.native!.fieldAssetId, null); assert.equal(first.native!.mapObjectAsset!.id, 9001);
  assert.equal(first.native!.scope!.group, "probe");
  assert.equal(first.native!.charaZOffset, 0);
  assert.equal(t.options.puppetActors!.read().context.entities.find((e) => e.entityId === 301)!.actor, a.id);
  const candidate = t.game.nativeActorCandidate!;
  assert.equal(candidate.snapshot.actors.some((actor) => [a.id, b.id].includes(actor.id)), false);
  assert.equal(candidate.assets.some((actor) => [a.id, b.id].includes(actor.id)), false);
  const stamp = t.game.nativeActorStateFingerprint;
  first.native!.entity.visible = false;
  assert.notEqual(t.game.nativeActorStateFingerprint, stamp, "retiring actors still invalidate pending map handoff");
  assert.equal(t.game.actors[a.id], first); assert.equal(t.game.player, player);
  for (const actor of [first, second]) actor.motion = {
    from: { x: actor.x, y: actor.y }, to: { x: actor.x + 1, y: actor.y }, elapsed: 0, duration: 240, manual: false,
  };
  t.options.sourceMessageEffects!.prepare([{ kind: "entity-update-group", group: 8, invokeCallback: false }])();
  t.game.advance(10);
  assert.equal(first.motion!.elapsed, 0); assert.equal(second.motion!.elapsed, 10);
  assert.equal(t.game.checkpointReady, false);
});

test("late NPC media failure cannot publish part of a group, its collision entities or activation flag", () => {
  const t = setup([], true, true), first = mapNpc("301", t.game.player.asset), missing = mapNpc("302", "missing-source-media");
  t.content.map.groups = { probe: { name: "probe", source, entities: [first, missing], blockers: [] } };
  const actors = Object.keys(t.game.actors), entities = [...t.game.entities];
  t.addScript("group", [{ kind: "entities", group: "probe" }, end], true);
  t.game.startEvent("group");
  assert.match(t.game.stop?.message ?? "", /Missing native NPC source media/);
  assert.deepEqual(Object.keys(t.game.actors), actors); assert.deepEqual(t.game.entities, entities);
  assert.equal(t.game.activeGroups.has("probe"), false);
});

test("fresh native default NPC preparation never exposes a legacy duplicate and validates aliases before publication", () => {
  const template = setup([], false, true), npc = mapNpc("301", template.game.player.asset);
  npc.nativeNpc!.group = "entity_default";
  const t = setup([npc], false, true);
  assert.equal(t.game.actors[npc.id], undefined);
  const oldPlayer = t.game.player;
  t.publish();
  assert.notEqual(t.game.player, oldPlayer);
  assert.ok(t.game.actors[npc.id]!.native);
  assert.equal(t.options.puppetActors!.read().context.entities.find((e) => e.entityId === 301)!.actor, npc.id);
  assert.equal(Object.keys(t.game.actors).filter((id) => id === npc.id).length, 1);
  const bad = structuredClone(npc); bad.id = "native:not-a-source-id"; bad.nativeNpc!.entityId = bad.id;
  const rejected = setup([bad], false, true), before = state(rejected.game);
  assert.throws(() => rejected.publish(), /NPC.*identity|NPC.*selector/);
  assert.deepEqual(state(rejected.game), before);
});

function anonymousMapNpc(group: string): FieldEntity {
  const npc = mapNpc("301", ""), evidence = { ...source, pointer: "/layers/0/objects/2" };
  npc.id = `${group}:0:2`; npc.source = evidence;
  Object.assign(npc.nativeNpc!, { group, entityId: npc.id, sourceEntityId: 0, source: evidence });
  return npc;
}

test("anonymous native NPCs remain owned on default and event entry without becoming camera selector zero", () => {
  const example = setup(), asset = example.game.player.asset;
  const initial = anonymousMapNpc("entity_default");
  initial.asset = asset; initial.nativeNpc!.asset.asset = asset; initial.nativeNpc!.asset.animationAsset = asset.toUpperCase();
  const t = setup([initial], true, true), later = anonymousMapNpc("probe");
  later.asset = asset; later.nativeNpc!.asset.asset = asset; later.nativeNpc!.asset.animationAsset = asset.toUpperCase();
  assert.ok(t.game.actors[initial.id]!.native);
  assert.equal(t.options.puppetActors!.read().context.entities.some((e) => e.actor === initial.id), false);
  t.content.map.groups = { probe: { name: "probe", source, entities: [later], blockers: [] } };
  t.addScript("anonymous", [{ kind: "entities", group: "probe" },
    { kind: "puppet", slot: 0, actor: "0", target: 4 }, { kind: "wait", seconds: 1 }, end,
    { kind: "wait", seconds: 2 }, end], true);
  t.game.startEvent("anonymous");
  assert.equal(t.game.stop, null); assert.ok(t.game.actors[later.id]!.native);
  const context = t.options.puppetActors!.read().context;
  assert.equal(context.entities.some((e) => e.actor === later.id || e.entityId === 0), false);
  assert.equal(context.camera, t.game.cameraActorId);
  assert.equal(t.game.checkpointReady, false);
});

test("invalid event NPC selector binding rejects before publishing actors or the group", () => {
  const t = setup([], true, true), npc = mapNpc("301", t.game.player.asset);
  npc.id = "not-the-source-selector"; npc.nativeNpc!.entityId = npc.id;
  t.content.map.groups = { probe: { name: "probe", source, entities: [npc], blockers: [] } };
  const actors = Object.keys(t.game.actors), entities = [...t.game.entities];
  t.addScript("invalid-selector", [{ kind: "entities", group: "probe" }, end], true);
  t.game.startEvent("invalid-selector");
  assert.equal(t.game.stop?.kind, "unsupported");
  assert.deepEqual(Object.keys(t.game.actors), actors); assert.deepEqual(t.game.entities, entities);
  assert.equal(t.game.activeGroups.has("probe"), false);
});

test("decoded native SetPos reaches the existing VM actor without changing visibility or corrupting other actors", () => {
  const t = setup(), player = t.game.player;
  player.native!.entity.visible = false; player.native!.entity.fadeAlpha = 0;
  const raw = { type: 2, mnemonic: "SetPos", operands: {
    iValues: [8, 7, 3, 0, 0, 0, 0, 0], rValues: Array(8).fill(0), sValues: ["wave", "", "", "", "", "", "", ""],
  } };
  const op = decodeFieldOp(raw, { script: "position", index: 0, source }, {});
  assert.equal(op.kind, "position");
  t.addScript("position", [op, { kind: "wait", seconds: 1 }, end], true);
  t.game.startEvent("position");
  assert.equal(t.game.stop, null);
  assert.equal(t.game.player, player);
  assert.deepEqual(player.native!.entity.position, { x: -24, y: 8, z: 149 });
  assert.equal(player.animation!.snapshot()!.key, "wave");
  assert.equal(player.native!.entity.visible, false);
});

test("source subtitle pauses native actor movement and animation while camera, fade and VM continue", () => {
  const t = setup();
  t.addScript("subtitle", [
    { kind: "puppet", slot: 0, actor: "0", target: 9 },
    { kind: "exec-puppets", asynchronous: true },
    { kind: "field-fade", direction: "out", seconds: -0.5, color: null },
    subtitle, { kind: "wait", seconds: 0.2 },
    { kind: "flag", ref: flag, operation: "set" },
    { kind: "source-message", command: { kind: "close" } },
    { kind: "wait", seconds: 0.5 }, end,
    { kind: "field-camera-motion", command: { kind: "lerp", x: 10, y: 9,
      layer: 0, duration: 0.5, arcHeight: 0 } }, end,
  ]);
  assert.equal(t.game.startEvent("subtitle"), true);
  assert.equal(t.game.stop, null);
  const actor = t.game.actors["native:puppet:0"]!;
  actor.animation!.play("wave", true, 1);
  actor.motion = { from: { x: actor.x, y: actor.y }, to: { x: actor.x + 1, y: actor.y },
    elapsed: 0, duration: 1000, manual: false };
  const animation = actor.animation!.snapshot(), position = { ...actor.native!.entity.position },
    camera = t.game.cameraSnapshot, fade = t.game.fade;
  assert.equal(t.game.updateAttributeMask, 9);
  t.game.advance(100);
  assert.equal(t.game.stop, null);
  assert.equal(t.game.sourceMessage.projection!.text, "A short page");
  assert.equal(actor.motion!.elapsed, 0);
  assert.deepEqual(actor.animation!.snapshot(), animation);
  assert.deepEqual(actor.native!.entity.position, position);
  assert.notDeepEqual(t.game.cameraSnapshot, camera);
  assert.notDeepEqual(t.game.fade, fade);
  assert.equal(t.game.eventState.read(flag), 0);
  t.game.advance(110);
  assert.equal(t.game.eventState.read(flag), 1);
  assert.equal(t.game.sourceMessage.active, false);
  assert.equal(t.game.updateAttributeMask, 3);
  t.game.advance(100);
  assert.ok(actor.motion!.elapsed >= 100);
  assert.notDeepEqual(actor.animation!.snapshot(), animation);
  assert.notDeepEqual(actor.native!.entity.position, position);
  assert.equal(t.game.stop, null);
});

test("source subtitle requires an accepting host before publishing text or advancing the script", () => {
  for (const reject of ["missing", "prepare", "commit"] as const) {
    const t = setup();
    t.addScript("rejected-subtitle", [subtitle, { kind: "flag", ref: flag, operation: "set" }, end]);
    if (reject === "missing") delete t.options.sourceMessageEffects;
    else t.options.sourceMessageEffects = { prepare: () => {
      if (reject === "prepare") throw new Error("Rejected message host preparation");
      return () => { throw new Error("Rejected message host commit"); };
    } };
    assert.equal(t.game.startEvent("rejected-subtitle"), true);
    assert.equal(t.game.stop?.kind, "unsupported");
    assert.equal(t.game.sourceMessage.active, false);
    assert.equal(t.game.updateAttributeMask, 3);
    assert.equal(t.game.eventState.read(flag), 0);
  }
});

test("source -1001 is the party puppet while decoded HidePlayer and ShowPlayer address the actual player", () => {
  const t = setup(), player = t.game.player, puppet = t.game.actors["native:puppet:0"]!;
  t.addScript("aliases", [
    { kind: "puppet", slot: 0, actor: "-1001", target: 4 },
    { kind: "exec-puppets", asynchronous: false }, { kind: "wait", seconds: 0 }, end,
    { kind: "look", direction: "right" }, { kind: "wait", seconds: 0 },
    decodeVisibility("HidePlayer"), { kind: "wait", seconds: 0 },
    decodeVisibility("ShowPlayer"), { kind: "wait", seconds: 0 }, end,
  ]);
  t.game.startEvent("aliases");
  assert.equal(t.game.stop, null);
  assert.equal(player.direction, "up"); assert.equal(puppet.direction, "right");
  assert.equal(t.game.isEntityVisible(player.id), false);
  assert.equal(t.game.isEntityVisible(puppet.id), true);
  assert.equal(t.game.hiddenEntities.has(player.id), false);
  assert.equal(t.game.hiddenEntities.has(puppet.id), false);
  t.game.advance(10);
  assert.equal(player.native!.entity.fadeAlpha, 0);
  assert.equal(puppet.native!.entity.fadeAlpha, 1);
  t.game.advance(10);
  assert.equal(t.game.isEntityVisible(player.id), true);
  assert.equal(player.native!.entity.fadeAlpha, 1);
  assert.equal(t.game.isEntityVisible(puppet.id), true);
  t.game.advance(40);
  assert.equal(t.game.stop, null); assert.equal(t.game.busy, false);
  assert.equal(t.game.player, player); assert.equal(player.direction, "right");
  assert.equal(player.animation!.snapshot()!.key, "WalkR");
  assert.equal(t.game.isEntityVisible(puppet.id), false);
});

test("source map-collider switches are consumed by actual walking and native position publication", () => {
  const t = setup(), grid = t.content.map.collisions[0]!;
  grid[4 * t.content.map.width + 4] = 1;
  grid[4 * t.content.map.width + 5] = 1;
  assert.equal(t.game.move("right"), false);
  assert.equal(t.game.stop, null);
  const prepared = t.options.puppetActors!.prepareCollision(false);
  assert.deepEqual(t.game.collisionState, { mapColliders: true, entityCollision: true, interactiveObservation: true });
  prepared();
  assert.deepEqual(t.game.collisionState, { mapColliders: false, entityCollision: false, interactiveObservation: false });
  assert.equal(t.game.move("right"), true);
  t.game.advance(240);
  assert.deepEqual({ x: t.game.player.x, y: t.game.player.y }, { x: 4, y: 4 });
  assert.deepEqual(t.game.player.native!.entity.position,
    fieldCameraCellToWorld(t.f.map.mapRange, { x: 4, y: 4 }, 0));
  t.collision(true);
  assert.equal(t.game.move("right"), false);
});

test("source entity-collision switches gate both dynamic cells and visible native actor occupancy", () => {
  for (const kind of ["dynamic-cell", "native-actor"] as const) {
    const t = setup(kind === "dynamic-cell" ? [entity("100", 19, { collision: 1 })] : []);
    if (kind === "native-actor") {
      const actor = t.game.actors["native:puppet:0"]!;
      actor.native!.entity.position = fieldCameraCellToWorld(t.f.map.mapRange, { x: 4, y: 4 }, 0);
      actor.native!.entity.layer = fieldCameraLayerFromLogical(0).layer;
      t.options.puppetActors!.prepare({ leaderId: null, assignments: null, effects: [{ kind: "show", actor: actor.id }] })();
      assert.equal(t.game.isEntityVisible(actor.id), true);
    }
    assert.equal(t.game.move("right"), false, kind);
    t.collision(false);
    assert.equal(t.game.move("right"), true, kind);
    t.game.advance(240);
    assert.equal(t.game.player.x, 4, kind);
    assert.equal(t.game.stop, null, kind);
  }
});

test("source observation switches suppress confirm and entry triggers without deleting their entities", () => {
  const object = setup([entity("101", 5, { script: "touched", mapObject: {
    collision: false, acceptDirection: 15, talkMounts: [""], soundId: 0,
    interaction: { kind: "script", script: "touched" },
  } })]);
  object.addScript("touched", [{ kind: "flag", ref: flag, operation: "set" }, end]);
  object.game.player.direction = "right";
  object.collision(false); object.game.confirm();
  assert.equal(object.game.eventState.read(flag), 0);
  assert.equal(object.game.busy, false);
  object.collision(true); object.game.confirm();
  assert.equal(object.game.stop, null);
  assert.equal(object.game.eventState.read(flag), 1);
  assert.equal(object.game.entities.length, 1);
  const trigger = setup([entity("102", 2, { script: "entered" })]);
  trigger.addScript("entered", [{ kind: "flag", ref: flag, operation: "set" }, end]);
  trigger.collision(false);
  assert.equal(trigger.game.move("right"), true); trigger.game.advance(240);
  assert.equal(trigger.game.eventState.read(flag), 0);
  assert.equal(trigger.game.move("left"), true); trigger.game.advance(240);
  trigger.collision(true);
  assert.equal(trigger.game.move("right"), true); trigger.game.advance(240);
  assert.equal(trigger.game.eventState.read(flag), 1);
  assert.equal(trigger.game.stop, null);
});

test("native installation rejects legacy NPC owners before replacing any actor or hidden state", () => {
  const t = setup([entity("103", 6, { asset: "alpha" })], false), owner = t.game.actors,
    player = t.game.player, npc = owner["103"], before = state(t.game);
  assert.throws(() => t.publish(), /without legacy NPC actors/);
  assert.deepEqual(state(t.game), before);
  assert.equal(t.game.actors, owner); assert.equal(t.game.player, player); assert.equal(owner["103"], npc);
  assert.equal(t.options.puppetActors, undefined);
});

test("missing media and mismatched native player bindings cannot partially install actors", () => {
  for (const change of ["player-media", "puppet-media", "player-pose", "player-id", "camera-id"] as const) {
    const t = setup([], false), candidate = t.candidate, before = state(t.game), player = t.game.player;
    if (change === "player-media") candidate.snapshot.actors[0]!.animation = null;
    if (change === "puppet-media") candidate.snapshot.actors[1]!.animation = null;
    if (change === "player-pose") candidate.snapshot.actors[0]!.position.x += 16;
    if (change === "player-id") candidate.bindings.player = "forged-player";
    if (change === "camera-id") candidate.snapshot.camera!.id = "forged-camera";
    assert.throws(() => t.publish(candidate), /media\/asset binding|PointIn|identities/, change);
    assert.deepEqual(state(t.game), before, change);
    assert.equal(t.game.player, player, change); assert.equal(t.options.puppetActors, undefined, change);
  }
});

test("all puppet and resident bindings are validated before native installation publishes", () => {
  for (const change of ["puppet", "resident"] as const) {
    const t = setup([], false), before = state(t.game), player = t.game.player;
    if (change === "puppet") t.candidate.bindings.partyPuppets[0] = "unbound-puppet";
    else t.candidate.bindings.residents[0]!.actor = "unbound-resident";
    assert.throws(() => t.publish(), /binding|incomplete/, change);
    assert.deepEqual(state(t.game), before, change);
    assert.equal(t.game.player, player, change); assert.equal(t.options.puppetActors, undefined, change);
  }
});

test("late lifecycle media and view failures leave the shared actors, camera and local variables unpublished", () => {
  for (const change of ["media", "view"] as const) {
    const t = setup();
    t.addScript("failure", [{ kind: "flag", ref: flag, operation: "set" }, end]);
    if (change === "media") delete t.game.actors["native:puppet:0"]!.animation!.character.animations.WalkB;
    else t.setProviders({ ...t.f.input.providers, applyViewProperties: () => null });
    const before = state(t.game), refs = Object.values(t.game.actors);
    assert.equal(t.game.startEvent("failure"), true);
    assert.equal(t.game.stop?.kind, "unsupported");
    assert.match(t.game.stop!.message, change === "media" ? /Missing actor animation/ : /material projection/);
    assert.deepEqual(state(t.game), before, change);
    for (const actor of refs) assert.equal(t.game.actors[actor.id], actor);
    assert.equal(t.game.eventState.read(flag), 0);
  }
});
