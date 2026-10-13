import assert from "node:assert/strict";
import test from "node:test";
import { WorldSession } from "../src/core/world-session.js";
import { GameSession } from "../src/core/game-session.js";
import { GameFlow } from "../src/core/game-flow.js";
import { GameMapLoader } from "../src/core/game-map-loader.js";
import { GameContentRepository } from "../src/core/game-content.js";
import { contentDigest } from "../src/core/content-integrity.js";
import { EventState } from "../src/core/event-state.js";
import { createFieldEffectState, type FieldEffectCandidateBatch, type FieldEffectPlan,
  type FieldEffectRuntimeHost, type FieldEffectState } from "../src/core/field-effects.js";
import type { FieldContent, FieldEntity, Op } from "../src/field/types.js";
import { checkpointFixture } from "./fixtures/checkpoint-game.js";
import { effectCatalog, effectDefinition } from "./fixtures/field-effects.js";

const camera: NonNullable<FieldContent["cameraHost"]> = {
  kind: "source-field-camera-host-v1", mapRange: { x: 0, y: 0, width: 6, height: 4 },
  loop: { horizontal: false, vertical: false }, playerVisualOffset: { x: 0, y: -6 }, callbacks: "fresh-normal-field-v1",
  sources: [{ file: "controlled-native", sha256: "1".repeat(64) }, { file: "controlled-prefab", sha256: "2".repeat(64) }],
};
function board(id: string): FieldEntity {
  const source = { file: "synthetic", assetPath: "effect-map.json", pointer: "/boards/" + id };
  return { id, kind: 11, objectId: 0, x: 2, y: 2, layer: 3, width: 1, height: 1, direction: "down",
    asset: null, script: null, collision: null, destinationLayer: null, source, effect: effectDefinition({ source }) };
}
function fixture(initialEffects = true) {
  const f = checkpointFixture();
  f.field.cameraHost = structuredClone(camera);
  if (initialEffects) {
    f.field.fieldEffects = effectCatalog();
    f.field.map.entities.push(board("101"), board("102"));
  }
  f.target.cameraHost = structuredClone(camera);
  f.target.fieldEffects = effectCatalog();
  f.target.map!.groups!.entity_default!.entities.push(board("101"), board("102"));
  return f;
}
/** Controlled renderer/particle observations exercise ownership only. They do
 * not replace the five real Unity emitters or grant their source admission. */
function host() {
  const control = { state: createFieldEffectState(), commits: 0, batches: [] as FieldEffectCandidateBatch[],
    discards: 0, generation: 0, failPrepare: false, failValidate: false, failCommit: false, observations: 0,
    onValidate: null as (() => void) | null, onCommit: null as (() => void) | null };
  const apply = (plans: readonly FieldEffectPlan[]) => {
    const callback = control.onCommit; control.onCommit = null; callback?.();
    if (control.failCommit) throw new Error("controlled opaque effect publication failed");
    for (const plan of plans) {
      assert.deepEqual(plan.before, control.state);
      control.state = structuredClone(plan.after);
    }
    control.commits++; control.generation++;
  };
  const api: FieldEffectRuntimeHost = {
    prepare(plan) {
      const generation = control.generation, copy = structuredClone(plan);
      return { validate: () => { assert.equal(control.generation, generation); }, commit: () => apply([copy]) };
    },
    observe(state) {
      control.observations++; assert.deepEqual(state, control.state);
      return state.registeredCameraIds.flatMap((id) => {
        const player = state.players.find((p) => p.cameraId === id)!;
        return player.activeSelf && player.playing ? [{ cameraId: id, particlePlaying: [true] }] : [];
      });
    },
    beginCandidate(origin) {
      assert.deepEqual(origin.state, control.state);
      const generation = control.generation;
      const validate = () => {
        const callback = control.onValidate; control.onValidate = null; callback?.();
        if (generation !== control.generation || control.failValidate) throw new Error("controlled stale effect host");
      };
      return { validate, discard: () => { control.discards++; },
        prepare(batch) {
          if (control.failPrepare) throw new Error("controlled effect media failed");
          const copy = structuredClone(batch); control.batches.push(copy);
          return { validate, commit: () => apply(copy.plans) };
        } };
    },
  };
  return { api, control };
}
function worldFixture(initialEffects = true) {
  const f = fixture(initialEffects), h = host(), owner = { commits: 0, refuse: false };
  const world = new WorldSession(f.field, EventState.initialized(), {
    current: { fieldEffects: h.api },
    prepare: () => ({ ports: {}, commit: () => { if (owner.refuse) return false; owner.commits++; return true; } }),
  });
  return { ...f, ...h, session: world, owner };
}
function request(world: WorldSession, id = 2) { world.field.previewMap(id, 1); }

async function loaderFixture() {
  const f = fixture(false), h = host();
  const seal = async <T extends { contentHash: string }>(value: T): Promise<T> => {
    const { contentHash: _, ...payload } = structuredClone(value);
    return { ...payload, contentHash: await contentDigest(payload) } as T;
  };
  const field = await seal(f.field), battle = await seal(f.battle), map = await seal(f.target);
  f.world.maps[map.mapId]!.contentHash = map.contentHash;
  const catalog = await seal(f.world), game = new GameSession(field, battle, undefined, { fieldEffects: h.api });
  game.field.eventState.write({ category: "ScenarioFlag1", index: 8 }, 0);
  const flow = new GameFlow(game); flow.start();
  request(game.world);
  const previous = game.field, owned = game.state.snapshot(), effects = structuredClone(h.control.state);
  const files = new Map<string, unknown>([["/world/catalog.json", catalog], [catalog.maps[map.mapId]!.url, map]]);
  let discarded = 0;
  const presentationHost = { prepare: async (_field: import("../src/core/field.js").FieldGame) => ({ ready: true }),
    discard: () => { discarded++; } };
  const loader = new GameMapLoader(flow, new GameContentRepository(async url => {
    assert.ok(files.has(url)); return files.get(url);
  }), presentationHost);
  return { game, flow, loader, previous, owned, effects, presentationHost, ...h, get discarded() { return discarded; } };
}

test("Flow invalidation in final map validation cancels private world publication", async () => {
  for (const action of ["title", "replace", "cancel"] as const) {
    const f = await loaderFixture(), replacement = checkpointFixture().game;
    const beforeCommits = f.control.commits;
    // Arm after private preparation: this callback executes inside the final
    // world commit validation, after the loader's ordinary isCurrent check.
    const original = f.presentationHost.prepare;
    f.presentationHost.prepare = async field => {
      const presentation = await original(field);
      f.control.onValidate = () => {
        if (action === "title") f.flow.returnToTitle();
        else if (action === "replace") f.flow.start(replacement);
        else f.loader.cancel();
      };
      return presentation;
    };
    assert.equal((await f.loader.load()).status, "cancelled", action);
    assert.equal(f.game.field, f.previous);
    assert.equal(f.game.world.transitions.length, 0);
    assert.deepEqual(f.game.state.snapshot(), f.owned);
    assert.deepEqual(f.control.state, f.effects);
    assert.equal(f.control.commits, beforeCommits);
    assert.equal(f.discarded, 1); assert.equal(f.flow.busy, false);
    assert.equal(f.flow.currentSession, action === "replace" ? replacement : f.game);
    assert.equal(f.flow.started, action !== "title");
  }
});

test("map publication refuses owner replacement and cancellation after the owned write begins", async () => {
  const f = await loaderFixture(), replacement = checkpointFixture().game;
  const original = f.presentationHost.prepare;
  f.presentationHost.prepare = async field => {
    const presentation = await original(field);
    f.control.onCommit = () => {
      assert.throws(() => f.flow.start(replacement), /Cannot cancel a map after publication has started/);
      assert.throws(() => f.flow.returnToTitle(), /Cannot cancel a map after publication has started/);
      assert.throws(() => f.loader.cancel(), /Cannot cancel a map after publication has started/);
      assert.equal(f.flow.currentSession, f.game); assert.equal(f.flow.busy, true);
    };
    return presentation;
  };
  const result = await f.loader.load();
  assert.equal(result.status, "committed"); assert.equal(f.flow.currentSession, f.game);
  assert.equal(f.game.world.transitions.length, 1); assert.equal(f.discarded, 0);
  assert.equal(f.flow.busy, false); assert.notEqual(f.game.field, f.previous);
});

test("world stages old-map retirement and destination FX in one shared manager publication", () => {
  const f = worldFixture(), old = f.session.field, before = old.fieldEffectsSnapshot!;
  assert.equal(f.control.commits, 1); assert.equal(before.instanceCount, 1);
  assert.deepEqual(before.boards.map((b) => b.id), ["101", "102"]);
  request(f.session);
  const prepared = f.session.prepare(f.world, f.target), next = prepared.field.fieldEffectsSnapshot!;
  assert.equal(f.control.commits, 1); assert.equal(f.owner.commits, 0);
  assert.deepEqual(old.fieldEffectsSnapshot, before);
  assert.equal(next.instanceCount, 2); assert.equal(next.players[0]!.cameraId, 2);
  assert.equal(next.players[0]!.positionY, 148); assert.equal(next.players[0]!.references, 2);
  assert.deepEqual(next.boards.map((b) => b.id), ["101", "102"]);
  const operations = f.control.batches.at(-1)!.operations;
  assert.deepEqual(operations.map((op) => op.kind), ["release-prefab", "release-prefab", "destroy", "destroy", "create", "create", "setup"]);
  const destroyed = operations.filter((op) => op.kind === "destroy").map((op) => op.id);
  const created = operations.filter((op) => op.kind === "create").map((op) => op.id);
  assert.ok(created.every((id) => !destroyed.includes(id)), "reused local IDs have distinct map leases");
  assert.equal(f.session.commit(prepared), true); assert.equal(f.control.commits, 2); assert.equal(f.owner.commits, 1);
  assert.equal(f.session.commit(prepared), false);
  assert.equal(f.session.field, prepared.field); assert.deepEqual(old.fieldEffectsSnapshot, before);
  prepared.field.advance(10); assert.equal(prepared.field.stop, null); assert.equal(f.control.observations, 1);
  const published = structuredClone(f.control.state), commits = f.control.commits;
  old.stop = null; old.advance(10);
  assert.match(old.stop!.message, /Retired map/); assert.equal(old.time, 0);
  assert.equal(f.control.commits, commits); assert.deepEqual(f.control.state, published);
});

test("destination FX also stage when the source map has no effects", () => {
  const f = worldFixture(false); assert.equal(f.control.commits, 0);
  request(f.session); const prepared = f.session.prepare(f.world, f.target);
  assert.equal(f.control.commits, 0); assert.equal(prepared.field.fieldEffectsSnapshot!.instanceCount, 1);
  assert.equal(f.session.commit(prepared), true); assert.equal(f.control.commits, 1);
});

test("ordinary empty maps preserve effect counters and cannot save away shared manager history", () => {
  const f = worldFixture();
  f.target.map!.groups!.entity_default!.entities = f.target.map!.groups!.entity_default!.entities.filter((e) => e.kind !== 11);
  f.target.map!.entities = f.target.map!.entities.filter((e) => e.kind !== 11);
  delete f.target.fieldEffects;
  request(f.session); assert.equal(f.session.commit(f.session.prepare(f.world, f.target)), true);
  assert.equal(f.session.field.fieldEffectsSnapshot, null);
  assert.deepEqual(f.control.state.players, []); assert.deepEqual(f.control.state.shared, {});
  assert.equal(f.control.state.instanceCount, 1); assert.equal(f.control.state.nextParticlePositionY, 132);
  f.session.field.advance(20);
  assert.equal(f.session.field.checkpointReady, false); assert.throws(() => f.session.checkpoint(), /Cannot save/);
  f.target.map!.groups!.entity_default!.entities.push(board("101"), board("102"));
  f.target.fieldEffects = effectCatalog();
  request(f.session); const prepared = f.session.prepare(f.world, f.target);
  assert.equal(prepared.field.fieldEffectsSnapshot!.players[0]!.cameraId, 2);
  assert.equal(f.session.commit(prepared), true);
});

test("cancelled map candidates free private resources and do not consume global identities", () => {
  const f = worldFixture(), before = f.control.state;
  request(f.session); const discarded = f.session.prepare(f.world, f.target);
  f.session.discard(discarded); f.session.discard(discarded);
  assert.equal(f.control.discards, 1); assert.equal(f.session.commit(discarded), false);
  assert.deepEqual(f.control.state, before);
  const next = f.session.prepare(f.world, f.target);
  assert.equal(next.field.fieldEffectsSnapshot!.instanceCount, 2);
  assert.equal(f.session.commit(next), true); assert.equal(f.control.commits, 2);
});

test("host validation and owned-state refusal reject without retiring the visible field", () => {
  for (const kind of ["host", "owned", "source-state", "candidate-state"] as const) {
    const f = worldFixture(), old = f.session.field, before = f.control.state;
    request(f.session); const prepared = f.session.prepare(f.world, f.target);
    if (kind === "host") f.control.generation++;
    if (kind === "owned") f.owner.refuse = true;
    if (kind === "source-state") old.eventState.write({ category: "ScenarioFlag1", index: 90 }, 1);
    if (kind === "candidate-state") prepared.field.advance(10); // sealed private observer cannot be replaced by live observations
    assert.equal(f.session.commit(prepared), false, kind);
    assert.equal(f.control.commits, 1); assert.equal(f.owner.commits, 0); assert.equal(f.control.discards, 1);
    assert.equal(f.session.field, old); assert.deepEqual(f.control.state, before);
    assert.equal(f.control.observations, 0);
  }
});

test("cancellation during final host validation cannot publish the in-flight map", () => {
  const f = worldFixture(), old = f.session.field, before = structuredClone(f.control.state);
  request(f.session);
  const prepared = f.session.prepare(f.world, f.target);
  f.control.onValidate = () => f.session.discard(prepared);
  assert.equal(f.session.commit(prepared), false);
  assert.equal(f.session.field, old);
  assert.deepEqual(f.control.state, before);
  assert.equal(f.owner.commits, 0); assert.equal(f.control.commits, 1); assert.equal(f.control.discards, 1);
  assert.equal(f.session.commit(prepared), false);
  const retry = f.session.prepare(f.world, f.target);
  assert.equal(f.session.commit(retry), true);
});

test("media failure, unknown event pools and changed media identities leave the live pool untouched", () => {
  for (const kind of ["media", "event", "catalog", "entry"] as const) {
    const f = worldFixture(), before = f.control.state;
    if (kind === "media") f.control.failPrepare = true;
    if (kind === "event") f.target.map!.groups!.later!.entities.push(board("103"));
    if (kind === "catalog") f.target.fieldEffects!.media.controlled_effect!.particles[0]!.loop = false;
    if (kind === "entry") f.target.scripts.init = [{ kind: "blocked", reason: "controlled missing entry provider", script: "init", index: 0,
      source: { file: "synthetic" } } as Op];
    request(f.session);
    assert.throws(() => f.session.prepare(f.world, f.target), /media failed|creation order|Changed field effect media|entry provider/);
    assert.equal(f.control.commits, 1); assert.equal(f.owner.commits, 0); assert.deepEqual(f.control.state, before);
  }
});

test("successful publication cancels competing candidates and failure cancels media preparation", () => {
  const f = worldFixture(); request(f.session);
  const first = f.session.prepare(f.world, f.target), second = f.session.prepare(f.world, f.target);
  assert.equal(f.session.commit(first), true); assert.equal(f.session.commit(second), false);
  assert.equal(f.control.discards, 1); assert.equal(f.control.commits, 2);
  request(f.session); const pending = f.session.prepare(f.world, f.target), stop = f.session.field.stop!;
  assert.equal(stop.kind, "map-transition");
  if (stop.kind === "map-transition") f.session.fail(stop, "controlled missing media");
  assert.equal(f.session.commit(pending), false); assert.equal(f.control.discards, 2);
});

test("GameSession shares field inventory publication with the effect candidate", () => {
  const f = fixture(), h = host(), game = new GameSession(f.field, f.battle, 314, { fieldEffects: h.api });
  f.target.scripts.init = [{ kind: "exit", script: "init", index: 0, source: { file: "synthetic", assetPath: "effect-map.json" } }];
  request(game.world); const prepared = game.world.prepare(f.world, f.target);
  const before = game.state.snapshot();
  h.control.failValidate = true;
  assert.equal(game.world.commit(prepared), false);
  assert.deepEqual(game.state.snapshot(), before); assert.equal(h.control.commits, 1);
  h.control.failValidate = false;
  assert.equal(game.world.commit(game.world.prepare(f.world, f.target)), true);
  assert.equal(game.field.fieldEffectsSnapshot!.instanceCount, 2);
});

test("native initial setup and checkpoint restore cannot publish FX before whole-session validation", () => {
  const f = fixture(), h = host(), saved = checkpointFixture().game.checkpoint();
  assert.throws(() => new WorldSession(f.field, EventState.initialized(), {
    current: { fieldEffects: h.api, nativeActorPreparation: true }, prepare: () => { throw new Error("unreachable"); },
  }), /whole-session transactional/);
  assert.throws(() => GameSession.restore(saved, f.field, f.battle, undefined, { fieldEffects: h.api }), /particle\/RNG/);
  assert.equal(h.control.commits, 0); assert.equal(h.control.batches.length, 0);
});

test("a host violating its no-fail publication contract stops the session and is never retried", () => {
  const f = worldFixture(); request(f.session);
  const prepared = f.session.prepare(f.world, f.target);
  f.control.failCommit = true;
  assert.throws(() => f.session.commit(prepared), /opaque effect publication failed/);
  assert.equal(f.session.field.stop!.kind, "unsupported");
  assert.match(f.session.field.stop!.message, /Field effect publication failed/);
  assert.equal(f.session.commit(prepared), false); assert.equal(f.owner.commits, 1);
  assert.equal(f.control.commits, 1, "the violated host did not finish, and its manager is poisoned");
});

test("field context changed by final host validation is checked again before owned-state publication", () => {
  const f = worldFixture(), old = f.session.field, before = f.control.state;
  request(f.session); const prepared = f.session.prepare(f.world, f.target);
  f.control.onValidate = () => { old.player.x++; };
  assert.equal(f.session.commit(prepared), false);
  assert.equal(f.owner.commits, 0); assert.equal(f.control.commits, 1);
  assert.deepEqual(f.control.state, before); assert.equal(f.control.discards, 1); assert.equal(f.session.field, old);
});
