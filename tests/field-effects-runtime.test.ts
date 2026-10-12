import assert from "node:assert/strict";
import test from "node:test";
import { FieldGame } from "../src/core/field.js";
import { WorldSession } from "../src/core/world-session.js";
import { EventState } from "../src/core/event-state.js";
import { decodeFieldOp } from "../src/compiler/field.js";
import type { FieldContent, FieldEntity, Op, Site } from "../src/field/types.js";
import type { FieldEffectPlan, FieldEffectRuntimeHost, FieldEffectState } from "../src/core/field-effects.js";
import { effectCatalog, effectDefinition } from "./fixtures/field-effects.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";

type Instruction<T> = T extends Site ? Omit<T, keyof Site> : never;
const source = { file: "synthetic", assetPath: "effect-runtime.json" };
const at = (op: Instruction<Op>, index: number): Op => ({ ...op, index, source, script: "main" }) as Op;
const end = { kind: "exit" } as const;
function entity(id: string): FieldEntity {
  const evidence = { ...source, pointer: "/entities/" + id }, definition = effectDefinition({ source: evidence });
  return { id, kind: 11, objectId: 0, x: 2, y: 2, layer: 3, width: 1, height: 1, direction: "down",
    asset: null, script: null, collision: null, destinationLayer: null, source: evidence, effect: definition };
}
function content(ops: Instruction<Op>[] = [end]): FieldContent {
  const entities = [entity("101"), entity("102")];
  return { formatVersion: 1, kind: "field-development", sourceSetHash: "synthetic", parentSourceSetHash: "base",
    contentHash: "controlled-effects", characters: {}, limitations: [], fieldEffects: effectCatalog(false),
    cameraHost: { kind: "source-field-camera-host-v1", mapRange: { x: 0, y: 0, width: 6, height: 4 },
      loop: { horizontal: false, vertical: false }, playerVisualOffset: { x: 0, y: -6 }, callbacks: "fresh-normal-field-v1",
      sources: [{ file: "controlled-native", sha256: "1".repeat(64) }, { file: "controlled-prefab", sha256: "2".repeat(64) }] },
    map: { id: "controlled-effects", identity: { mapId: 1, areaId: 7 }, width: 6, height: 4, tileSize: 16,
      collisions: { 1: Array(24).fill(0) }, layers: [], tilesets: [], textures: {}, entities,
      groups: { entity_default: { name: "entity_default", entities, blockers: [], source },
        later: { name: "later", entities: [], blockers: [], source } }, initialGroups: ["entity_default"], source },
    scripts: { main: ops.map(at) }, entry: { player: { x: 1, y: 1, layer: 1, direction: "down", asset: "player", mount: "" },
      description: "Controlled effect observation/material host, never original Unity particle simulation", evidence: [source] } };
}
function host() {
  let committed: FieldEffectState | null = null, commits = 0, fail: ((plan: Readonly<FieldEffectPlan>) => boolean) | null = null;
  let completed = false, missingObservation = false;
  const api: FieldEffectRuntimeHost = {
    prepare(plan) {
      if (fail?.(plan)) throw new Error("controlled material preparation failed");
      const candidate = structuredClone(plan.after);
      return { validate() { if (fail?.(plan)) throw new Error("controlled material preparation failed"); },
        commit() { committed = candidate; commits++; } };
    },
    observe(state) { return missingObservation ? [] : state.registeredCameraIds.flatMap((id) => {
      const p = state.players.find((player) => player.cameraId === id)!;
      return p.activeSelf && p.playing ? [{ cameraId: id, particlePlaying: [!completed] }] : [];
    }); },
  };
  return { api, get commits() { return commits; }, get state() { return committed; },
    failWhen(predicate: typeof fail) { fail = predicate; }, complete() { completed = true; },
    omitObservation() { missingObservation = true; } };
}
function sequence(body: Instruction<Op>[]): Instruction<Op>[] {
  return [{ kind: "puppet", slot: 0, actor: "101", target: 4 }, { kind: "exec-puppets", asynchronous: false },
    { kind: "wait", seconds: 0 }, end, ...body, end];
}
const wait = { kind: "wait", seconds: 0 } as const;

test("FieldGame prepares one ordered default effect pool, distinct from actors and hiddenEntities", () => {
  const renderer = host(), game = new FieldGame(content(), EventState.initialized(), undefined, undefined, { fieldEffects: renderer.api });
  assert.equal(renderer.commits, 1); assert.deepEqual(Object.keys(game.actors), ["-1001"]);
  assert.deepEqual([...game.hiddenEntities], []); assert.deepEqual(game.fieldEffectsSnapshot, renderer.state);
  const snapshot = game.fieldEffectsSnapshot!;
  assert.deepEqual(snapshot.boards.map((b) => b.id), ["101", "102"]); assert.equal(snapshot.players.length, 1);
  assert.equal(snapshot.players[0]!.references, 2); assert.deepEqual(snapshot.registeredCameraIds, [1]);
  snapshot.boards[0]!.fadeAlpha = 0; assert.equal(game.isEntityVisible("101"), true);
  game.advance(100); assert.equal(game.stop, null); assert.equal(game.fieldEffectsSnapshot!.players[0]!.elapsedSec, Math.fround(.09999998658895493));
  assert.deepEqual(game.fieldEffectsSnapshot, renderer.state);
});

test("missing FX media/host, event pools and native candidate allocation fail before any renderer publish", () => {
  const renderer = host(), data = content();
  assert.throws(() => new FieldGame(data), /observation host/);
  const noMedia = structuredClone(data); delete noMedia.fieldEffects;
  assert.throws(() => new FieldGame(noMedia, undefined, undefined, undefined, { fieldEffects: renderer.api }), /catalog/);
  const blocked = structuredClone(data); blocked.fieldEffects!.media.controlled_effect!.blockers = ["source noise provider missing"];
  assert.throws(() => new FieldGame(blocked, undefined, undefined, undefined, { fieldEffects: renderer.api }), /noise provider/);
  const later = structuredClone(data); later.map.groups!.later!.entities.push(entity("103"));
  assert.throws(() => new FieldGame(later, undefined, undefined, undefined, { fieldEffects: renderer.api }), /creation order/);
  assert.throws(() => new FieldGame(data, undefined, undefined, undefined,
    { fieldEffects: renderer.api, nativeActorPreparation: true }), /transactional native map/);
  assert.equal(renderer.commits, 0);
});

test("source-decoded board Hide/Cue/Play use one owner and wait for the shared particle", () => {
  const raw = (mnemonic: string, ints: number[], reals: number[], strings: string[]) => ({ type: 2, mnemonic,
    operands: { iValues: [...ints, ...Array(8 - ints.length).fill(0)],
      rValues: [...reals, ...Array(8 - reals.length).fill(0)], sValues: [...strings, ...Array(8 - strings.length).fill("")] } });
  const decode = (mnemonic: string, ints: number[] = [], reals: number[] = [], strings: string[] = []) =>
    decodeFieldOp(raw(mnemonic, ints, reals, strings), { script: "main", index: 0, source }, {});
  const body = [wait, decode("Hide"), wait, decode("CueAnim", [], [.75], ["ignored-board-key"]),
    decode("PlayAnim", [0, 1], [2], ["also-ignored"]), wait];
  assert.ok(body.every((op) => op.kind !== "blocked"));
  const renderer = host(), game = new FieldGame(content(sequence(body)), EventState.initialized(), undefined, undefined, { fieldEffects: renderer.api });
  game.startEvent("main"); assert.equal(game.stop, null); assert.equal(game.isEntityVisible("101"), true);
  game.advance(10); assert.equal(game.isEntityVisible("101"), false); assert.equal(game.isEntityVisible("102"), true);
  assert.equal(game.fieldEffectsSnapshot!.players[0]!.playing, true); assert.deepEqual([...game.hiddenEntities], []);
  game.advance(10); assert.equal(game.stop, null); assert.equal(game.busy, true);
  assert.equal(game.fieldEffectsSnapshot!.players[0]!.loopLimit, 1);
  renderer.complete(); game.advance(50); assert.equal(game.stop, null); assert.equal(game.busy, false);
  assert.equal(game.fieldEffectsSnapshot!.players[0]!.playing, false);
  assert.equal(game.fieldEffectsSnapshot!.players[0]!.loopCount, 1);
  assert.equal(game.isEntityVisible("101"), false, "Play does not imply board Show");
  assert.equal(game.startEvent("main"), true); assert.equal(game.isEntityVisible("101"), true, "Ready explicitly shows the board");
});

test("failed Ready and group setup leave FX, task side effects, entities and collision unpublished", () => {
  const renderer = host(), data = content(sequence([wait]));
  const { effect: _, ...npc } = entity("npc");
  data.map.groups!.later!.entities.push({ ...npc, kind: 6, asset: "unmounted" });
  data.scripts.group = [at({ kind: "entities", group: "later" }, 0), at(end, 1)];
  const game = new FieldGame(data, EventState.initialized(), undefined, undefined, { fieldEffects: renderer.api });
  const before = game.fieldEffectsSnapshot, collision = game.collisionState, entities = [...game.entities];
  renderer.failWhen(() => true); game.startEvent("main");
  assert.match(game.stop!.message, /material preparation/); assert.deepEqual(game.fieldEffectsSnapshot, before);
  assert.deepEqual(game.collisionState, collision); assert.equal(renderer.commits, 1);
  const secondHost = host(), second = new FieldGame(data, EventState.initialized(), undefined, undefined, { fieldEffects: secondHost.api });
  secondHost.failWhen(() => true); second.startEvent("group");
  assert.match(second.stop!.message, /material preparation/); assert.deepEqual([...second.entities], entities);
  assert.equal(second.actors.npc, undefined); assert.deepEqual([...second.activeGroups], ["entity_default"]);
  assert.deepEqual(second.fieldEffectsSnapshot, before); assert.equal(secondHost.commits, 1);
});

test("group activation reuses the already-created camera and native missing observations stop before clock mutation", () => {
  const data = content([{ kind: "entities", group: "later" }, end]), renderer = host();
  const game = new FieldGame(data, EventState.initialized(), undefined, undefined, { fieldEffects: renderer.api });
  game.startEvent("main"); assert.equal(game.stop, null); assert.equal(game.fieldEffectsSnapshot!.instanceCount, 1);
  assert.equal(game.fieldEffectsSnapshot!.players[0]!.references, 2); assert.equal(renderer.commits, 2);
  const before = game.fieldEffectsSnapshot; renderer.omitObservation(); game.advance(10);
  assert.match(game.stop!.message, /observations/); assert.equal(game.time, 0); assert.deepEqual(game.fieldEffectsSnapshot, before);
  assert.equal(renderer.commits, 2);
});

test("effect logical snapshots cannot masquerade as stable particle saves or silently leave their map", () => {
  const renderer = host(), game = new FieldGame(content(), undefined, undefined, undefined, { fieldEffects: renderer.api });
  assert.equal(game.checkpointReady, false); assert.throws(() => game.checkpoint(), /Cannot save/);
  assert.throws(() => FieldGame.restore(content(), {} as never, { fieldEffects: renderer.api }), /particle\/RNG/);
  assert.throws(() => game.previewMap(2, 1), /retirement/);
  const request = { mapId: 2, entrance: 1, continuation: null, birdview: false, skipFade: false, skipBgm: false, origin: "script" } as const;
  game.content.scripts.leave = [at({ kind: "change-map", request }, 0)];
  const before = game.fieldEffectsSnapshot; game.startEvent("leave");
  assert.equal(game.stop!.kind, "unsupported"); assert.match(game.stop!.message, /retirement/); assert.deepEqual(game.fieldEffectsSnapshot, before);
});

test("WorldSession refuses source retirement and destination allocation without leaking host or candidate state", () => {
  const f = checkpointFixture(), renderer = host(), data = content();
  const owned = { current: { fieldEffects: renderer.api }, prepare() { throw new Error("must reject before owned candidate"); } };
  const world = new WorldSession(data, EventState.initialized(), owned), request = { mapId: 2, entrance: 1,
    continuation: null, birdview: false, skipFade: false, skipBgm: false, origin: "script" } as const;
  world.field.stop = { kind: "map-transition", message: "controlled external handoff", site: null, request };
  const original = world.field, before = original.fieldEffectsSnapshot;
  assert.throws(() => world.prepare(f.world, f.target), /retirement/);
  assert.equal(world.field, original); assert.deepEqual(original.fieldEffectsSnapshot, before); assert.equal(renderer.commits, 1);
  const empty = new WorldSession(f.field, EventState.initialized(), owned); empty.field.stop = { kind: "map-transition", message: "controlled handoff", site: null, request };
  f.target.map!.groups!.entity_default!.entities.push(entity("1001"));
  assert.throws(() => empty.prepare(f.world, f.target), /transactional map lifecycle/);
  assert.equal(renderer.commits, 1); assert.deepEqual(empty.transitions, []);
});
