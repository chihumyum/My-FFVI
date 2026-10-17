import assert from "node:assert/strict";
import test from "node:test";
import { compileNewGame } from "../src/compiler/new-game.js";
import { compileNewGameFieldEntry } from "../src/compiler/new-game-field-entry.js";
import {
  FieldFadeState,
  type FieldFadeInitial,
} from "../src/core/field-fade.js";
import {
  NewGameFieldEntry,
  newGameTitleFadeComplete,
  type NewGameFieldEntryDefinition,
  type NewGameFieldPreparation,
} from "../src/core/new-game-field-entry.js";
import {
  createSourcePresentationContext,
  type SourcePresentationContext,
} from "../src/core/source-presentation.js";
import { newGameFixture } from "./fixtures/new-game.js";

const context = (): SourcePresentationContext =>
  createSourcePresentationContext({
    kind: "title-new-game",
    titleCleanupComplete: true,
    openingCallbackStarted: false,
  });
const definition = (): NewGameFieldEntryDefinition => ({
  kind: "source-new-game-field-entry-v1",
  mapId: 901,
  entrance: 7,
  reservedScript: {
    id: 22,
    name: "synthetic_new_game",
    contentHash: "a".repeat(64),
  },
  fallbackScript: { id: 902, name: "synthetic_map_initializer" },
});
const seed = (alpha = 0): FieldFadeInitial => ({
  imageColor: { r: 1, g: 0, b: 0, a: 1 },
  rendererColor: { r: 1, g: 1, b: 1, a: alpha },
  raycastTarget: alpha !== 0,
});
const receipt = (): NewGameFieldPreparation => ({
  kind: "source-new-game-field-prepared-v1",
  mapId: 901,
  entrance: 7,
  reservedScriptName: "synthetic_new_game",
  firstLoad: true,
  mapLoadComplete: true,
  mapSetupComplete: true,
  mapViewSetupComplete: true,
  firstFieldSceneInitialized: true,
  fieldUiReady: true,
});
const host = { active: true, callbacks: "absent" } as const;
function started(alpha = 0) {
  const entry = new NewGameFieldEntry(definition(), context()),
    current = new FieldFadeState(seed(alpha)),
    start = entry.prepareStart(current, host);
  start.commit();
  return { entry, fade: start.fade };
}
function fieldReady() {
  const { entry, fade } = started();
  fade.advance(0.5);
  let current = fade;
  const effects: string[] = [];
  for (let i = 0; i < 3; i++) {
    const tx = entry.prepareResume(current, true)!;
    effects.push(...tx.effects.map((e) => e.kind));
    tx.commit();
    current = tx.fade;
  }
  assert.equal(entry.phase, "field-preparing");
  return { entry, fade: current, effects };
}

test("entry compiler binds a generic source reserve independently of the map initializer", () => {
  const f = newGameFixture();
  f.tables["script.csv"]!.push({
    id: "902",
    script_name: "synthetic_map_initializer",
  });
  const initial = compileNewGame(f.reader(), f.tables, (key) => key, {
    kind: "ordinary-weapon-effects-v1",
    additionalAbilities: [],
  }).definition;
  const compiled = compileNewGameFieldEntry(f.reader(), initial, f.scripts);
  assert.deepEqual(
    [compiled.definition.mapId, compiled.definition.entrance],
    [901, 7],
  );
  assert.deepEqual(compiled.definition.fallbackScript, {
    id: 902,
    name: "synthetic_map_initializer",
  });
  assert.equal(compiled.definition.reservedScript.id, 22);
  assert.equal(compiled.reservedScriptSource.objectId, "9223372036854775807");
  f.scripts[0]!.data.Name = "wrong-script";
  assert.throws(
    () => compileNewGameFieldEntry(f.reader(), initial, f.scripts),
    /provenance/,
  );
});

test("entry compiler rejects an unresolved or duplicate fallback identity", () => {
  const f = newGameFixture(),
    initial = compileNewGame(f.reader(), f.tables, (key) => key, {
      kind: "ordinary-weapon-effects-v1",
      additionalAbilities: [],
    }).definition;
  assert.throws(() => compileNewGameFieldEntry(f.reader(), initial, f.scripts));
  f.tables["script.csv"]!.push({ id: "902", script_name: "" });
  assert.throws(
    () => compileNewGameFieldEntry(f.reader(), initial, f.scripts),
    /fallback/,
  );
  f.tables["script.csv"]!.push({ id: "902", script_name: "duplicate" });
  assert.throws(() => compileNewGameFieldEntry(f.reader(), initial, f.scripts));
});

test("missing or demonstration title context cannot manufacture an ordinary new-game host", () => {
  for (const entry of [
    { kind: "unresolved" } as const,
    { kind: "advertisement-opening", faderSetupComplete: true } as const,
  ])
    assert.throws(
      () =>
        new NewGameFieldEntry(
          definition(),
          createSourcePresentationContext(entry),
        ),
      /ordinary/,
    );
  const d = definition();
  d.reservedScript.contentHash = "unbound";
  assert.throws(() => new NewGameFieldEntry(d, context()), /Unbound/);
});

test("start prepares detached black fade from real alpha without claiming a prefab default", () => {
  const entry = new NewGameFieldEntry(definition(), context()),
    current = new FieldFadeState(seed(0.25));
  const before = current.snapshot(),
    plan = entry.prepareStart(current, host, 0.25);
  assert.equal(entry.phase, "created");
  assert.deepEqual(current.snapshot(), before);
  assert.deepEqual(plan.fade.projection!.imageColor, {
    r: 0,
    g: 0,
    b: 0,
    a: 1,
  });
  assert.equal(plan.fade.projection!.rendererColor.a, 0.625);
  assert.deepEqual(plan.effects, [
    { kind: "stop-title-bgm", channel: 0, seconds: 2 },
    { kind: "begin-map-load", mapId: 901, entrance: 7 },
  ]);
  plan.commit();
  assert.equal(entry.phase, "title-fading");
  assert.throws(() => entry.prepareStart(plan.fade, host), /already started/);
});

test("unknown fade and unresolved callback or inactive hosts reject before any state publication", () => {
  const entry = new NewGameFieldEntry(definition(), context()),
    current = new FieldFadeState(seed());
  assert.throws(
    () => entry.prepareStart(new FieldFadeState(null), host),
    /Unknown initial/,
  );
  assert.throws(
    () =>
      entry.prepareStart(current, {
        active: false,
        callbacks: "absent",
      } as unknown as typeof host),
    /hierarchy/,
  );
  assert.throws(
    () =>
      entry.prepareStart(current, {
        active: true,
        callbacks: "unknown",
      } as unknown as typeof host),
    /callbacks/,
  );
  assert.equal(entry.phase, "created");
  assert.equal(current.projection!.rendererColor.a, 0);
});

test("only the fade owner advances time; resource readiness cannot substitute for actual alpha", () => {
  const { entry, fade } = started();
  for (let i = 0; i < 100; i++)
    assert.equal(entry.prepareResume(fade, true), null);
  assert.equal(fade.projection!.rendererColor.a, 0);
  fade.advance(0.25);
  assert.equal(entry.prepareResume(fade, true), null);
  fade.advance(0.25);
  const request = entry.prepareResume(fade, true)!;
  assert.deepEqual(request.effects, [
    { kind: "hide-title" },
    { kind: "request-main-scene", fromAdvertisement: false, useFade: false },
  ]);
  assert.equal(fade.active, true); // Source uses alpha, not tween completion.
  request.commit();
  assert.equal(entry.phase, "scene-loading");
});

test("scene request and activation are separate coroutine resumes even with cached resources", () => {
  const { entry, fade } = started(1);
  const request = entry.prepareResume(fade, true)!;
  request.commit();
  assert.equal(
    request.effects.some((e) => e.kind === "activate-main-scene"),
    false,
  );
  assert.equal(entry.prepareResume(request.fade, null), null);
  assert.equal(entry.prepareResume(request.fade, false), null);
  const activate = entry.prepareResume(request.fade, true)!;
  assert.deepEqual(activate.effects, [{ kind: "activate-main-scene" }]);
  activate.commit();
  const destroy = entry.prepareResume(activate.fade, null)!;
  assert.deepEqual(destroy.effects, [{ kind: "destroy-title" }]);
  destroy.commit();
  assert.equal(entry.prepareResume(destroy.fade, null), null);
});

test("scene-loading completion is latched while the second actual fade check still waits", () => {
  const { entry, fade } = started(1);
  const request = entry.prepareResume(fade, true)!;
  request.commit();
  request.fade.start(
    { kind: "field-fade", direction: "in", seconds: -1, color: null },
    0.25,
  );
  const loaded = entry.prepareResume(request.fade, true)!;
  assert.deepEqual(loaded.effects, []);
  loaded.commit();
  assert.equal(entry.phase, "scene-loaded");
  assert.equal(entry.prepareResume(loaded.fade, null), null);
  loaded.fade.start({
    kind: "field-fade",
    direction: "out",
    seconds: 0,
    color: { r: 0, g: 0, b: 0, a: 1 },
  });
  const activate = entry.prepareResume(loaded.fade, null)!;
  assert.deepEqual(activate.effects, [{ kind: "activate-main-scene" }]);
});

test("both competing preparations and stale fade clocks are rejected without consuming a new stage", () => {
  const entry = new NewGameFieldEntry(definition(), context()),
    current = new FieldFadeState(seed());
  const first = entry.prepareStart(current, host),
    second = entry.prepareStart(current, host);
  first.commit();
  assert.throws(() => first.commit(), /repeated/);
  assert.throws(() => second.commit(), /Stale/);
  first.fade.advance(0.5);
  const request = entry.prepareResume(first.fade, true)!;
  first.fade.advance(0); // alpha unchanged, coroutine is now finished: still stale.
  assert.throws(() => request.commit(), /Stale/);
  assert.equal(entry.phase, "title-fading");
});

test("first script launch needs exact completed field preparation and never silently picks fallback", () => {
  const { entry, fade, effects } = fieldReady();
  assert.deepEqual(effects, [
    "hide-title",
    "request-main-scene",
    "activate-main-scene",
    "destroy-title",
  ]);
  for (const changed of [
    { mapId: 902 },
    { entrance: 1 },
    { reservedScriptName: "synthetic_map_initializer" },
    { firstLoad: false },
    { mapLoadComplete: false },
    { mapSetupComplete: false },
    { mapViewSetupComplete: false },
    { firstFieldSceneInitialized: false },
    { fieldUiReady: false },
  ])
    assert.throws(
      () =>
        entry.prepareLaunch(fade, {
          ...receipt(),
          ...changed,
        } as NewGameFieldPreparation),
      /Unproved/,
    );
  assert.equal(entry.phase, "field-preparing");
  const tx = entry.prepareLaunch(fade, receipt());
  assert.equal(tx.launch.scriptName, "synthetic_new_game");
  assert.equal(tx.launch.fallbackBranch, "discard-after-reserved-script");
  assert.equal(tx.launch.entrySynchronized, false);
  assert.equal(tx.launch.startChangeState, true);
  assert.equal(tx.launch.endChangeState, true);
  assert.deepEqual(tx.launch.fade.snapshot(), fade.snapshot());
  assert.equal(tx.launch.fade.active, true);
  assert.equal(tx.launch.fade.projection!.rendererColor.a, 1);
});

test("failed field candidates can retry; successful launch transfers one fade owner once", () => {
  const { entry, fade } = fieldReady(),
    original = fade.snapshot();
  const failedCandidate = entry.prepareLaunch(fade, receipt());
  failedCandidate.launch.fade.start(
    { kind: "field-fade", direction: "in", seconds: -1, color: null },
    0.25,
  );
  assert.deepEqual(fade.snapshot(), original);
  assert.equal(entry.phase, "field-preparing");
  const accepted = entry.prepareLaunch(fade, receipt());
  accepted.commit();
  assert.equal(entry.phase, "launched");
  assert.throws(() => failedCandidate.commit(), /Stale/);
  assert.throws(() => accepted.commit(), /repeated/);
  assert.throws(() => entry.prepareLaunch(fade, receipt()), /handoff/);
  assert.throws(() => entry.prepareResume(fade, true), /cannot resume/);
});

test("early launch, malformed readiness and exact-alpha mismatches remain blocked", () => {
  const { entry, fade } = started();
  assert.throws(() => entry.prepareLaunch(fade, receipt()), /handoff/);
  assert.throws(
    () => entry.prepareResume(fade, 1 as unknown as boolean),
    /readiness/,
  );
  assert.equal(newGameTitleFadeComplete(null), false);
  const p = seed(Math.fround(1 - 2 ** -24));
  assert.equal(newGameTitleFadeComplete(p), false);
  assert.equal(newGameTitleFadeComplete(seed(1)), true);
});
