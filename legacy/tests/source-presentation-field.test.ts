import test from "node:test";
import assert from "node:assert/strict";
import { FieldGame, type FieldGameOptions } from "../src/core/field.js";
import { EventState } from "../src/core/event-state.js";
import { WorldSession, type WorldStateOwner } from "../src/core/world-session.js";
import {
  createSourcePresentationContext,
  type SourcePresentationContext,
  type SourcePresentationEffect,
  type SourcePresentationPort,
} from "../src/core/source-presentation.js";
import { compileSourcePresentationInstruction, sourcePresentationSelectors } from "../src/compiler/source-presentation.js";
import type { Character, FieldContent, FieldEntity, Op } from "../src/field/types.js";
import type { WorldCatalog, WorldMapContent } from "../src/field/world.js";

const source = { file: "synthetic", assetPath: "room.json", objectId: "9007199254740993" };
const site = { script: "test", index: 0, source };
const mapFlag = { category: "MapLocalVariable" as const, index: 7 };
const flag = (index: number): Op => ({ ...site, kind: "flag", ref: { category: "ScenarioFlag1", index }, operation: "set" });
const exit: Op = { ...site, kind: "exit" };
const wait: Op = { ...site, kind: "wait", seconds: 0.01 };
function presentation(selector: 0 | 1): Op {
  return { ...site, ...compileSourcePresentationInstruction({
    type: 1, mnemonic: "SysCall", operands: {
      iValues: Array<number>(8).fill(0), rValues: Array<number>(8).fill(0),
      sValues: [sourcePresentationSelectors[selector], ...Array<string>(7).fill("")],
    },
  }) };
}
const normal = () => createSourcePresentationContext({
  kind: "title-new-game", titleCleanupComplete: true, openingCallbackStarted: false,
});
const advertisement = () => createSourcePresentationContext({ kind: "advertisement-opening", faderSetupComplete: true });
const unknown = () => createSourcePresentationContext({ kind: "unresolved" });
const expectedEffects: SourcePresentationEffect[] = [
  { kind: "fade-out", seconds: 2, color: null },
  { kind: "goto-title" }, { kind: "stop-script-input" },
];

/** Reuses world-session.test.ts's synthetic geometry and PointIn contract. Its
 * fixture is private, so this file keeps an independent minimal package rather
 * than importing a test module (which would register all its tests twice). */
function fixture() {
  const character: Character = {
    source,
    sprites: { pose: { file: "synthetic.png", width: 16, height: 24, pivot: [0.5, 0], sha256: "synthetic", source } },
    animations: Object.fromEntries(["Default", "WalkB", "WalkL", "WalkR"].map((key) => [key, {
      frames: [{ sprite: "pose", x: 0, y: 0, flip: false, alpha: 1 }],
      duration: 1, mode: 0, flip: false, next: "",
    }])),
  };
  const entrance: FieldEntity = {
    id: "99", objectId: 10, kind: 0, x: 2, y: 3, width: 1, height: 1,
    layer: 1, direction: "up", asset: null, script: null, collision: null,
    destinationLayer: null, source,
  };
  const content: FieldContent = {
    formatVersion: 1, kind: "field-development", sourceSetHash: "bootstrap",
    parentSourceSetHash: "base", contentHash: "old",
    map: {
      id: "Room", identity: { mapId: 1, areaId: 7 }, width: 5, height: 5,
      tileSize: 16, layers: [], tilesets: [], textures: {}, collisions: { 1: Array<number>(25).fill(0) },
      entities: [], source,
    },
    characters: { hero: character },
    scripts: {
      test: [exit],
      leave: [{ ...site, kind: "change-map", request: {
        mapId: 2, entrance: 10, continuation: null, birdview: false,
        skipFade: false, skipBgm: false, origin: "script",
      } }, flag(1), exit],
    },
    entry: {
      player: { x: 1, y: 1, layer: 1, direction: "down", asset: "hero", mount: "" },
      description: "synthetic source-presentation host", evidence: [source],
    },
    limitations: [],
  };
  const target: WorldMapContent = {
    formatVersion: 1, kind: "world-map-development", sourceSetHash: "full",
    parentSourceSetHash: "base", mediaSourceSetHash: "media", contentHash: "next",
    mapId: 2, areaId: 7, name: "Next",
    map: {
      ...content.map, id: "Next", identity: { mapId: 2, areaId: 7 }, entities: [entrance],
      groups: { entity_default: { name: "entity_default", source, entities: [entrance], blockers: [] } },
      initialGroups: ["entity_default"],
    },
    scripts: { probe: [presentation(0), exit], title: [presentation(1), flag(2), exit] },
    scriptLocals: {}, initializer: null, characterAssets: [], blockers: [], limitations: [],
  };
  const catalog: WorldCatalog = {
    formatVersion: 1, kind: "world-development", sourceSetHash: "full",
    parentSourceSetHash: "base", mediaSourceSetHash: "media", contentHash: "catalog",
    characters: { hero: character }, characterIssues: {},
    maps: { 2: {
      url: "/world/maps/2.json", contentHash: "next", name: "Next", areaId: 7,
      geometryReady: true, defaultGroupReady: true, blockers: [],
    } },
    limitations: [],
  };
  return { content, target, catalog };
}

function host(initial = normal()) {
  let context = structuredClone(initial), prepares = 0, ownedCommits = 0;
  const published: SourcePresentationEffect[][] = [];
  const port: SourcePresentationPort = {
    context: () => context,
    prepare: (effects) => {
      prepares++;
      let committed = false;
      return { commit() {
        if (committed) throw new Error("Repeated presentation commit");
        committed = true;
        published.push(structuredClone([...effects]));
      } };
    },
  };
  const owner: WorldStateOwner = {
    current: { sourcePresentation: port },
    prepare: () => ({ ports: {}, sealPublication: () => () => true, commit: () => { ownedCommits++; return true; } }),
  };
  return { port, owner, published, setContext: (value: SourcePresentationContext) => { context = structuredClone(value); },
    get prepares() { return prepares; }, get ownedCommits() { return ownedCommits; } };
}

test("FieldGame rejects absent and unknown probe ports before any event write or continuation", () => {
  for (const port of [undefined, { context: unknown }]) {
    const f = fixture(), state = new EventState(), before = state.snapshot();
    f.content.scripts.test = [presentation(0), flag(1), exit];
    const field = new FieldGame(f.content, state, undefined, undefined,
      port ? { sourcePresentation: port } : {});
    assert.equal(field.startEvent("test"), true);
    assert.equal(field.stop?.kind, "unsupported");
    assert.match(field.stop!.message, /host is unavailable|Unknown advertisement/);
    assert.deepEqual(state.snapshot(), before);
    field.advance(100);
    assert.deepEqual(state.snapshot(), before);
  }
});

test("FieldGame present-fader probe writes only map-local 7 and continues in the same script", () => {
  const f = fixture(), h = host(advertisement()), state = EventState.initialized();
  state.beginScript({ labels: ["local"], values: [91] });
  state.write({ category: "ScenarioVariable", index: 7 }, 42);
  const expected = state.snapshot();
  expected.map[7] = 1;
  f.content.scripts.test = [presentation(0), wait, flag(1), exit];
  const field = new FieldGame(f.content, state, undefined, undefined, h.owner.current);
  field.startEvent("test");
  assert.deepEqual(state.snapshot(), expected);
  assert.equal(field.stop, null);
  assert.equal(field.time, 0);
  assert.equal(h.prepares, 0);
  field.advance(10);
  assert.equal(state.read({ category: "ScenarioFlag1", index: 1 }), 1);
  assert.equal(field.busy, false);
  assert.equal(field.checkpointReady, false);
  assert.throws(() => field.checkpoint(), /Cannot save/);
});

test("ordinary title absence preserves known or unknown map-local 7 without clearing it", () => {
  for (const value of [null, 0, 1, -7]) {
    const f = fixture(), state = new EventState();
    if (value !== null) state.write(mapFlag, value);
    const expected = state.snapshot();
    expected.scenario[1] = 1;
    f.content.scripts.test = [presentation(0), flag(1), exit];
    const field = new FieldGame(f.content, state, undefined, undefined, { sourcePresentation: { context: normal } });
    field.startEvent("test");
    assert.equal(field.stop, null);
    assert.equal(field.busy, false);
    assert.deepEqual(state.snapshot(), expected);
    if (value === null) assert.throws(() => state.read(mapFlag), /未知事件状态/);
  }
});

test("FieldGame title effects require a host transaction and failures never reach subsequent writes", () => {
  const ports: (SourcePresentationPort | undefined)[] = [
    undefined,
    { context: normal },
    { context: normal, prepare: () => { throw new Error("Missing title controller"); } },
    { context: normal, prepare: () => ({ commit: () => { throw new Error("Stale title transaction"); } }) },
  ];
  for (const port of ports) {
    const f = fixture(), state = EventState.initialized(), before = state.snapshot();
    f.content.scripts.test = [presentation(1), flag(1), exit];
    const field = new FieldGame(f.content, state, undefined, undefined, port ? { sourcePresentation: port } : {});
    field.startEvent("test");
    assert.equal(field.stop?.kind, "unsupported");
    assert.deepEqual(state.snapshot(), before);
  }
});

test("native End terminates the current Field task rather than returning to a call or waiting two seconds", () => {
  const f = fixture(), h = host(), state = EventState.initialized(), before = state.snapshot();
  f.content.scripts.test = [{ ...site, kind: "call", target: 2 }, flag(1), exit,
    presentation(1), flag(2), { ...site, kind: "return" }];
  const field = new FieldGame(f.content, state, undefined, undefined, h.owner.current);
  field.startEvent("test");
  assert.deepEqual(h.published, [expectedEffects]);
  assert.equal(h.prepares, 1);
  assert.equal(field.time, 0);
  assert.equal(field.busy, false);
  field.advance(2000);
  assert.deepEqual(state.snapshot(), before);
  assert.equal(h.prepares, 1);
});

test("Field checkpoints distinguish null, unknown and absent by trusted context and reject present saves", () => {
  const f = fixture();
  const contexts = [null, unknown(), normal()];
  for (const context of contexts) {
    const options: FieldGameOptions = context ? { sourcePresentation: { context: () => context } } : {};
    const field = new FieldGame(f.content, new EventState(), undefined, undefined, options);
    const saved = field.checkpoint();
    assert.equal(saved.kind, "idle-field-v10");
    assert.deepEqual(saved.sourcePresentation, context);
    assert.deepEqual(FieldGame.restore(f.content, saved, options).checkpoint(), saved);
    for (const changed of contexts) {
      if (changed === context) continue;
      const forged = structuredClone(saved);
      forged.sourcePresentation = structuredClone(changed);
      assert.throws(() => FieldGame.restore(f.content, forged, options), /presentation context mismatch/);
    }
    const forged = structuredClone(saved);
    forged.sourcePresentation = advertisement();
    assert.throws(() => FieldGame.restore(f.content, forged, options), /cannot be checkpointed/);
    assert.throws(() => FieldGame.restore(f.content, saved, { sourcePresentation: { context: advertisement } }), /cannot be checkpointed/);
  }
  const active = new FieldGame(f.content, new EventState(), undefined, undefined, { sourcePresentation: { context: advertisement } });
  assert.equal(active.checkpointReady, false);
  assert.throws(() => active.checkpoint(), /Cannot save/);
});

test("World candidate inherits a detached live context and probe writes stay private until commit", () => {
  const f = fixture(), h = host(advertisement()), state = EventState.initialized();
  state.write(mapFlag, 17);
  f.target.initializer = "probe";
  // An owned draft cannot substitute an unproved ordinary-title context.
  h.owner.prepare = () => ({ ports: { sourcePresentation: { context: normal } }, sealPublication: () => () => true, commit: () => true });
  const world = new WorldSession(f.content, state, h.owner), old = world.field;
  old.startEvent("leave");
  const before = state.snapshot(), prepared = world.prepare(f.catalog, f.target);
  assert.equal(world.field, old);
  assert.deepEqual(state.snapshot(), before);
  assert.equal(prepared.field.eventState.read(mapFlag), 1);
  assert.deepEqual(prepared.field.sourcePresentationContext, advertisement());
  const exposed = prepared.field.sourcePresentationContext!;
  exposed.advertisementOpeningFader = "absent";
  assert.deepEqual(prepared.field.sourcePresentationContext, advertisement());
  assert.equal(h.prepares, 0);
  assert.equal(world.commit(prepared), true);
  assert.equal(world.field.eventState.read(mapFlag), 1);
  assert.equal(state.read(mapFlag), 17);
  assert.equal(world.field.entrySynchronized, true);
  assert.equal(world.commit(prepared), false);
});

test("World candidate rejects unknown context and draft-only presentation authority without changing the old map", () => {
  for (const owner of [host(unknown()).owner, {
    current: {}, prepare: () => ({ ports: { sourcePresentation: { context: normal } }, sealPublication: () => () => true, commit: () => true }),
  } satisfies WorldStateOwner]) {
    const f = fixture(), state = EventState.initialized();
    f.target.initializer = "probe";
    const world = new WorldSession(f.content, state, owner), old = world.field;
    old.startEvent("leave");
    const before = state.snapshot();
    assert.throws(() => world.prepare(f.catalog, f.target), /Unknown advertisement|Unbound candidate/);
    assert.equal(world.field, old);
    assert.deepEqual(state.snapshot(), before);
    assert.equal(world.transitions.length, 0);
  }
});

test("World preparation cannot publish title effects even after prior candidate event writes", () => {
  const f = fixture(), h = host(), state = EventState.initialized();
  f.target.initializer = "init";
  f.target.scripts.init = [flag(3), presentation(1), flag(4), exit];
  const world = new WorldSession(f.content, state, h.owner), old = world.field;
  old.startEvent("leave");
  const before = state.snapshot();
  assert.throws(() => world.prepare(f.catalog, f.target), /Title effects during candidate map entry/);
  assert.equal(world.field, old);
  assert.deepEqual(state.snapshot(), before);
  assert.equal(h.prepares, 0);
  assert.equal(h.ownedCommits, 0);
  assert.deepEqual(h.published, []);
});

test("changing live presentation context makes a prepared map stale before any owned commit", () => {
  for (const changed of [unknown(), advertisement()]) {
    const f = fixture(), h = host(), state = EventState.initialized();
    f.target.initializer = "probe";
    const world = new WorldSession(f.content, state, h.owner), old = world.field;
    old.startEvent("leave");
    const prepared = world.prepare(f.catalog, f.target), before = state.snapshot();
    h.setContext(changed);
    assert.deepEqual(prepared.field.sourcePresentationContext, normal(), "Candidate retains the captured read-only context");
    assert.equal(world.commit(prepared), false);
    assert.equal(world.field, old);
    assert.deepEqual(state.snapshot(), before);
    assert.equal(h.ownedCommits, 0);
    assert.equal(h.prepares, 0);
    assert.equal(world.transitions.length, 0);
  }
});

test("pending title task uses the protected candidate port before commit and live port after commit", () => {
  for (const publish of [false, true]) {
    const f = fixture(), h = host(), state = EventState.initialized();
    f.target.initializer = "init";
    f.target.scripts.init = [wait, presentation(1), flag(2), exit];
    const world = new WorldSession(f.content, state, h.owner), old = world.field;
    old.startEvent("leave");
    const prepared = world.prepare(f.catalog, f.target);
    assert.equal(h.prepares, 0);
    assert.equal(prepared.field.entrySynchronized, false);
    if (publish) assert.equal(world.commit(prepared), true);
    prepared.field.advance(10);
    assert.equal(prepared.field.eventState.read({ category: "ScenarioFlag1", index: 2 }), 0);
    if (publish) {
      assert.equal(prepared.field.stop, null);
      assert.equal(prepared.field.entrySynchronized, true);
      assert.deepEqual(h.published, [expectedEffects]);
      assert.equal(h.prepares, 1);
    } else {
      assert.equal(prepared.field.stop?.kind, "unsupported");
      assert.match(prepared.field.stop!.message, /Title effects during candidate map entry/);
      assert.equal(world.field, old);
      assert.equal(h.prepares, 0);
      assert.deepEqual(h.published, []);
    }
  }
});

test("failed owned publication leaves the candidate presentation port unpublished", () => {
  const f = fixture(), h = host(), state = EventState.initialized();
  h.owner.prepare = () => ({ ports: {}, sealPublication: () => () => true, commit: () => false });
  f.target.initializer = "init";
  f.target.scripts.init = [wait, presentation(1), flag(2), exit];
  const world = new WorldSession(f.content, state, h.owner), old = world.field;
  old.startEvent("leave");
  const before = state.snapshot(), prepared = world.prepare(f.catalog, f.target);
  assert.equal(world.commit(prepared), false);
  prepared.field.advance(10);
  assert.equal(prepared.field.stop?.kind, "unsupported");
  assert.match(prepared.field.stop!.message, /Title effects during candidate map entry/);
  assert.equal(world.field, old);
  assert.deepEqual(state.snapshot(), before);
  assert.equal(world.transitions.length, 0);
  assert.equal(h.prepares, 0);
  assert.deepEqual(h.published, []);
});

test("published maps read current presentation context and world restore does not replay entry effects", () => {
  const f = fixture(), h = host(), state = EventState.initialized();
  f.target.initializer = "probe";
  state.write(mapFlag, 17);
  const world = new WorldSession(f.content, state, h.owner);
  world.field.startEvent("leave");
  const prepared = world.prepare(f.catalog, f.target);
  assert.equal(prepared.field.eventState.read(mapFlag), 0, "PointIn cleared the old map; absence did not write one");
  assert.equal(world.commit(prepared), true);
  const saved = world.checkpoint();
  assert.equal(saved.kind, "idle-world-v10");
  const restored = new WorldSession(f.content, new EventState(), h.owner);
  restored.restore(saved, f.catalog, f.target);
  assert.deepEqual(restored.checkpoint(), saved);
  assert.equal(h.prepares, 0);
  const incompatible = new WorldSession(f.content, new EventState(), host(unknown()).owner);
  const previous = incompatible.field;
  assert.throws(() => incompatible.restore(saved, f.catalog, f.target), /presentation context mismatch/);
  assert.equal(incompatible.field, previous);
  h.setContext(advertisement());
  assert.deepEqual(world.field.sourcePresentationContext, advertisement());
  world.field.startEvent("probe");
  assert.equal(world.field.eventState.read(mapFlag), 1);
  assert.equal(world.field.checkpointReady, false);
  assert.throws(() => world.checkpoint(), /Cannot save/);
  world.field.startEvent("title");
  assert.deepEqual(h.published, [expectedEffects]);
  assert.equal(world.field.eventState.read({ category: "ScenarioFlag1", index: 2 }), 0);
});
