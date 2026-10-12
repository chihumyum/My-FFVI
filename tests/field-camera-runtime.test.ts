import assert from "node:assert/strict";
import test from "node:test";
import { FieldGame } from "../src/core/field.js";
import { WorldSession } from "../src/core/world-session.js";
import { EventState } from "../src/core/event-state.js";
import { decodeFieldOp } from "../src/compiler/field.js";
import type { FieldCameraHostDefinition, FieldCameraViewport } from "../src/core/field-camera-host.js";
import type { FieldContent, Op, Site, Character } from "../src/field/types.js";
import type { WorldCatalog, WorldMapContent } from "../src/field/world.js";
import { fieldPuppetActorHostFixture } from "./fixtures/field-puppet-actors.js";

type Instruction<T> = T extends Site ? Omit<T, keyof Site> : never;
const source = { file: "synthetic", assetPath: "camera-runtime" };
const definition: FieldCameraHostDefinition = {
  kind: "source-field-camera-host-v1", mapRange: { x: 0, y: 0, width: 40, height: 40 },
  loop: { horizontal: false, vertical: false }, playerVisualOffset: { x: 0, y: -6 },
  callbacks: "fresh-normal-field-v1", sources: [{ file: "synthetic-native", sha256: "1".repeat(64) },
    { file: "synthetic-prefab", sha256: "2".repeat(64) }],
};
const view: FieldCameraViewport = { aspect: 2, orthographicSize: 100, isClamp: false, effectOffset: { x: 0, y: 0 } };
const at = (op: Instruction<Op>, index: number): Op => ({ ...op, index, source, script: "main" }) as Op;
const end = { kind: "exit" } as const;
function content(ops: Instruction<Op>[]): FieldContent {
  return {
    formatVersion: 1, kind: "field-development", sourceSetHash: "synthetic", parentSourceSetHash: "synthetic",
    contentHash: "synthetic-initial", cameraHost: structuredClone(definition), characters: {}, limitations: [],
    map: { id: "synthetic", identity: { mapId: 1, areaId: 1 }, width: 40, height: 40, tileSize: 16,
      collisions: { 1: Array(1600).fill(0) }, layers: [], tilesets: [], textures: {}, entities: [], source },
    scripts: { main: ops.map(at) },
    entry: { player: { x: 3, y: 4, layer: 1, direction: "down", asset: "player", mount: "" },
      evidence: [source], description: "Controlled native camera host; actor bootstrap is independent" },
  };
}
const raw = (mnemonic: string, ints: number[], reals: number[] = []) => ({ type: 2, mnemonic,
  operands: { iValues: [...ints, ...Array(8 - ints.length).fill(0)],
    rValues: [...reals, ...Array(8 - reals.length).fill(0)], sValues: Array(8).fill("") } });
function position(x: number, y: number): Instruction<Op> {
  const op = decodeFieldOp(raw("SetPos", [x, y]), { script: "main", index: 0, source }, {});
  assert.equal(op.kind, "position"); return op;
}
function lerp(x: number, y: number, duration: number): Instruction<Op> {
  return decodeFieldOp(raw("Lerp", [x, y], [duration]), { script: "main", index: 0, source }, {});
}
function sequence(): Instruction<Op>[] {
  return [{ kind: "puppet", slot: 0, actor: "0", target: 4 }, { kind: "exec-puppets", asynchronous: false },
    { kind: "wait", seconds: 0 }, end, position(10, 10), lerp(10, 20, 1), end];
}

test("source dummy SetPos/Lerp runs through global slots without moving or rendering a player copy", () => {
  const game = new FieldGame(content(sequence()), EventState.initialized());
  assert.equal(game.cameraSnapshot?.target, null);
  game.initializeMapCamera(); assert.equal(game.cameraSnapshot?.target, "player");
  assert.equal(game.startEvent("main"), true);
  assert.equal(game.stop, null); assert.equal(game.cameraSnapshot?.target, "dummy");
  assert.deepEqual(game.cameraProjection(view)?.cameraCell, { x: 10, y: 10 });
  assert.deepEqual(game.cameraProjection(view)?.renderCell, { x: 10, y: 10.375 });
  assert.deepEqual(Object.keys(game.actors), ["-1001"]);
  game.advance(500);
  assert.deepEqual(game.cameraProjection(view)?.cameraCell, { x: 10, y: 15 });
  assert.deepEqual({ x: game.player.x, y: game.player.y }, { x: 3, y: 4 });
  assert.equal(game.checkpointReady, false);
  game.advance(530);
  assert.equal(game.stop, null); assert.equal(game.busy, false);
  assert.equal(game.cameraSnapshot?.target, "player", "ordinary endCondition0 restores live player tracking");
  assert.deepEqual(game.cameraProjection(view)?.cameraCell, { x: 3, y: 4 });
  assert.equal(game.checkpointReady, true);
});

test("camera motion replays identically across host frame partitions and stable save reconstruction", () => {
  const definition = content(sequence());
  const a = new FieldGame(definition), b = new FieldGame(definition);
  a.startEvent("main"); b.startEvent("main");
  a.advance(1030); for (const time of [3, 497, 137, 393]) b.advance(time);
  assert.deepEqual(b.checkpoint(), a.checkpoint());
  const saved = JSON.parse(JSON.stringify(a.checkpoint()));
  const restored = FieldGame.restore(definition, saved);
  assert.deepEqual(restored.checkpoint(), saved);
  restored.player.x = 18;
  assert.equal(restored.cameraProjection(view)?.cameraCell.x, 18, "save does not own a second player position");
  const noHost = structuredClone(definition); delete noHost.cameraHost;
  assert.throws(() => FieldGame.restore(noHost, saved), /camera host/);
  const forged = structuredClone(saved); forged.camera.callbacks = "fresh-normal-field-v1";
  assert.throws(() => FieldGame.restore(definition, forged));
  const missing = structuredClone(saved); missing.camera = null;
  assert.throws(() => FieldGame.restore(definition, missing), /camera host/);
  const duplicate = structuredClone(saved); duplicate.hiddenEntities.push("native:camera");
  assert.throws(() => FieldGame.restore(definition, duplicate), /hidden saved entity/);
});

function visibilitySequence(): Instruction<Op>[] {
  return [{ kind: "puppet", slot: 0, actor: "0", target: 4 },
    { kind: "exec-puppets", asynchronous: false }, { kind: "wait", seconds: 0 }, end,
    { kind: "wait", seconds: 0 }, { kind: "hide" }, { kind: "wait", seconds: 0 }, end];
}

test("Ready Show and Hide retain sprite-less camera active/fade state in one saved owner", () => {
  const definition = content(visibilitySequence()), game = new FieldGame(definition);
  assert.deepEqual(game.cameraSnapshot?.dummy.visibility, { activeSelf: null, fadeAlpha: 0, currentFadeStatus: 0 });
  game.startEvent("main");
  assert.deepEqual(game.cameraSnapshot?.dummy.visibility, { activeSelf: true, fadeAlpha: 1, currentFadeStatus: 0 });
  game.advance(10);
  assert.deepEqual(game.cameraSnapshot?.dummy.visibility, { activeSelf: false, fadeAlpha: 0, currentFadeStatus: 0 });
  assert.equal(game.hiddenEntities.has(game.cameraActorId), false);
  game.advance(100);
  assert.equal(game.stop, null);
  const saved = game.checkpoint(), restored = FieldGame.restore(definition, saved);
  assert.deepEqual(restored.cameraSnapshot, game.cameraSnapshot);
  restored.startEvent("main");
  assert.equal(restored.cameraSnapshot?.dummy.visibility.activeSelf, true);
  assert.equal(restored.cameraSnapshot?.dummy.visibility.fadeAlpha, 1);
  for (const values of [[0.5, 0], [0, 0.5], [-0.5, 0]]) {
    assert.equal(decodeFieldOp(raw("Hide", [], values), { script: "main", index: 0, source }, {}).kind, "blocked");
  }
});

test("formal actor Ready routes dummy Show to camera, with failed collision preparation leaving it unpublished", () => {
  for (const fail of [false, true]) {
    const host = fieldPuppetActorHostFixture({ worldMapScript: false, callback: "absent" });
    host.context.player = "-1001"; host.context.camera = "native:camera";
    host.context.actors.find((actor) => actor.id === "player")!.id = "-1001";
    host.snapshot().actors.find((actor) => actor.id === "player")!.id = "-1001";
    host.snapshot().camera!.id = "native:camera";
    const definition = content(visibilitySequence()); definition.scriptPuppetContexts = { main: host.script };
    if (fail) host.port.prepareCollision = () => { throw new Error("unavailable camera batch collision host"); };
    const game = new FieldGame(definition, undefined, undefined, undefined, { puppetActors: host.port });
    const before = game.cameraSnapshot!.dummy.visibility;
    game.startEvent("main");
    if (fail) {
      assert.match(game.stop?.message ?? "", /collision host/);
      assert.deepEqual(game.cameraSnapshot?.dummy.visibility, before);
    } else {
      assert.equal(game.stop, null);
      assert.equal(game.cameraSnapshot?.dummy.visibility.activeSelf, true);
      game.advance(10);
      assert.equal(game.cameraSnapshot?.dummy.visibility.activeSelf, false);
    }
    assert.deepEqual(host.snapshot().camera?.position, { x: 0, y: 0, z: 0 }, "actor adapter never publishes a second camera");
    assert.equal(game.hiddenEntities.has(game.cameraActorId), false);
  }
});

test("source actor motion requires native providers, and source SetPos retains independent admission", () => {
  const game = new FieldGame(content([lerp(10, 20, 1), end]));
  const player = { x: game.player.x, y: game.player.y };
  game.startEvent("main");
  assert.match(game.stop?.message ?? "", /bound native actor and map providers/);
  assert.deepEqual({ x: game.player.x, y: game.player.y }, player);
  const ops = sequence(); ops[4] = { kind: "position", x: 10, y: 10, animation: "Default" };
  const unsupported = new FieldGame(content(ops)); unsupported.startEvent("main");
  assert.match(unsupported.stop?.message ?? "", /SetPos operand shape/);
  assert.deepEqual(unsupported.cameraProjection(view)?.cameraCell, { x: 3, y: 4 });
});

test("two source camera slots keep their own Lerp registers and resolve in source clock order", () => {
  const game = new FieldGame(content([
    { kind: "puppet", slot: 0, actor: "0", target: 5 },
    { kind: "puppet", slot: 1, actor: "0", target: 7 },
    { kind: "exec-puppets", asynchronous: false }, { kind: "wait", seconds: 0 }, end,
    lerp(13, 4, 1), end, lerp(3, 14, 2), end,
  ]));
  game.startEvent("main"); game.advance(1000);
  assert.equal(game.stop, null);
  assert.deepEqual(game.cameraProjection(view)?.cameraCell, { x: 3, y: 9 });
  game.advance(500);
  assert.deepEqual(game.cameraProjection(view)?.cameraCell, { x: 3, y: 11.5 });
  game.advance(530); assert.equal(game.busy, false);
});

const character: Character = { source, sprites: { pose: { file: "synthetic", width: 16, height: 16,
  pivot: [0.5, 0.5], sha256: "0".repeat(64), source } }, animations: Object.fromEntries(
  ["Default", "WalkB", "WalkL", "WalkR"].map((key) => [key, { frames: [{ sprite: "pose", x: 0, y: 0,
    flip: false, alpha: 1 }], duration: 1, mode: 0, flip: false, next: "" }])) };
function worldFixture() {
  const initial = content([{ kind: "change-map", request: { mapId: 2, entrance: 1, continuation: null,
    birdview: false, skipBgm: true, skipFade: true, origin: "script" } }]);
  initial.characters.player = character;
  const pointIn = { id: "point", objectId: 1, kind: 0, x: 12, y: 15, layer: 1, direction: "up" as const,
    width: 1, height: 1, asset: null, script: null, collision: null, destinationLayer: null, source };
  const map: WorldMapContent = { formatVersion: 1, kind: "world-map-development", sourceSetHash: "synthetic",
    parentSourceSetHash: "synthetic", mediaSourceSetHash: "media", contentHash: "destination", mapId: 2,
    areaId: 1, name: "destination", cameraHost: structuredClone(definition),
    map: { ...initial.map, identity: { mapId: 2, areaId: 1 }, entities: [pointIn], initialGroups: ["entity_default"],
      groups: { entity_default: { name: "entity_default", entities: [pointIn], source, blockers: [] } } },
    scripts: {}, scriptLocals: {}, initializer: null, characterAssets: [], blockers: [], limitations: [] };
  const catalog: WorldCatalog = { formatVersion: 1, kind: "world-development", sourceSetHash: "synthetic",
    parentSourceSetHash: "synthetic", mediaSourceSetHash: "media", contentHash: "world", characters: { player: character },
    characterIssues: {}, maps: { 2: { url: "synthetic", contentHash: "destination", name: "destination", areaId: 1,
      geometryReady: true, defaultGroupReady: true, blockers: [] } }, limitations: [] };
  const world = new WorldSession(initial, EventState.initialized());
  world.field.initializeMapCamera(); world.field.startEvent("main");
  return { world, map, catalog, initial };
}

test("map candidates fork camera state, select PointIn player and preserve stale/failed source state", () => {
  const { world, map, catalog, initial } = worldFixture(), before = world.field.cameraSnapshot;
  const first = world.prepare(catalog, map), second = world.prepare(catalog, map);
  assert.deepEqual(world.field.cameraSnapshot, before);
  assert.deepEqual(first.field.cameraProjection(view)?.cameraCell, { x: 12, y: 15 });
  assert.equal(world.commit(first), true); assert.equal(world.commit(second), false);
  const saved = world.checkpoint();
  const restored = new WorldSession(initial, EventState.initialized()); restored.restore(saved, catalog, map);
  assert.deepEqual(restored.field.cameraProjection(view), world.field.cameraProjection(view));
  const broken = worldFixture(), changed = structuredClone(broken.map); delete changed.cameraHost;
  assert.throws(() => broken.world.prepare(broken.catalog, changed), /camera host/);
  assert.equal(broken.world.field.content.map.identity?.mapId, 1);
});

test("normal camera metadata cannot upgrade a geometry preview or bypass source actor context", () => {
  const f = worldFixture(), initial = structuredClone(f.initial); delete initial.cameraHost;
  const preview = new WorldSession(initial, EventState.initialized()); preview.field.startEvent("main");
  const candidate = preview.prepare(f.catalog, f.map);
  assert.equal(candidate.field.cameraSnapshot, null);
  const blocked = worldFixture();
  blocked.map.initializer = "main"; blocked.map.scripts = { main: [at(end, 0)] };
  blocked.map.scriptPuppetContexts = { main: null };
  const before = blocked.world.field.cameraSnapshot;
  assert.throws(() => blocked.world.prepare(blocked.catalog, blocked.map), /host or script context/);
  assert.deepEqual(blocked.world.field.cameraSnapshot, before);
});
