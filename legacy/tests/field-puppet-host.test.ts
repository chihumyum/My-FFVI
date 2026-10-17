import test from "node:test";
import assert from "node:assert/strict";
import { FieldGame } from "../src/core/field.js";
import { EventState } from "../src/core/event-state.js";
import type { FieldPuppetActorsPort, FieldPuppetControlContext } from "../src/core/field-puppet-actors.js";
import type { FieldContent, Op, Site } from "../src/field/types.js";
import { fieldPuppetActorHostFixture } from "./fixtures/field-puppet-actors.js";

type Instruction<T> = T extends Site ? Omit<T, keyof Site> : never;
const source = { file: "synthetic", assetPath: "source-puppet-host" };
const exit: Instruction<Op> = { kind: "exit" };
const wait: Instruction<Op> = { kind: "wait", seconds: 0 };
function fixture(ops: Instruction<Op>[], control: FieldPuppetControlContext = { worldMapScript: false, callback: "absent" }) {
  const host = fieldPuppetActorHostFixture(control);
  const content: FieldContent = {
    formatVersion: 1, kind: "field-development", contentHash: "synthetic", sourceSetHash: "synthetic",
    parentSourceSetHash: "synthetic", characters: {}, limitations: [],
    scripts: { main: ops.map((op, index) => ({ ...op, source, script: "main", index }) as Op) },
    scriptPuppetContexts: { main: host.script },
    map: { id: "synthetic", width: 10, height: 10, tileSize: 16, layers: [], tilesets: [], textures: {}, source,
      collisions: { 1: Array(100).fill(0) }, entities: [{ id: "npc", kind: 6, asset: "npc", x: 1, y: 1,
        direction: "down", layer: 1, width: 1, height: 1, script: null, collision: null, destinationLayer: null, source }] },
    entry: { player: { x: 3, y: 3, layer: 1, direction: "down", asset: "player", mount: "" },
      evidence: [source], description: "Controlled actor/camera/render providers; no formal map admission" },
  };
  const events = new EventState();
  const game = new FieldGame(content, events, undefined, undefined, { puppetActors: host.port });
  game.hiddenEntities.add("npc");
  return { host, content, events, game };
}
const enter: Instruction<Op> = { kind: "puppet", slot: 0, actor: "17", target: 5 };
const exec: Instruction<Op> = { kind: "exec-puppets", asynchronous: false };

test("source lifecycle, Ready aliases and all collision switches share the scheduler's publication boundaries", () => {
  const { game, host } = fixture([enter, exec, { kind: "finish-puppets" }, wait, exit, wait, exit]);
  game.startEvent("main");
  assert.equal(game.stop, null);
  assert.equal(game.hiddenEntities.has("npc"), false);
  assert.equal(host.snapshot().actors.find((a) => a.id === "npc")!.visible, true);
  assert.equal(host.snapshot().actors.find((a) => a.id === "puppet:0")!.visible, false);
  assert.deepEqual(host.snapshot().camera!.position, host.snapshot().actors.find((a) => a.id === "player")!.position);
  assert.ok(Object.values(host.collision()).every((value) => value === false));
  game.advance(10); // Main still sees Ready, then the slot exits.
  assert.ok(Object.values(host.collision()).every((value) => value === false));
  game.advance(10);
  assert.ok(Object.values(host.collision()).every((value) => value === true));
  game.advance(10);
  assert.equal(game.busy, false);
  assert.equal(game.checkpointReady, false, "native host persistence has no codec yet");
  assert.throws(() => game.checkpoint(), /Cannot save/);
});

for (const callback of ["unknown", "unsupported"] as const) {
  test(`source ExecPuppet ${callback} callback blocks before Ready visibility or collision changes`, () => {
    const { game, host } = fixture([enter, wait, exec, exit, exit, exit], { worldMapScript: false, callback });
    game.startEvent("main");
    const before = host.snapshot();
    game.advance(10);
    assert.match(game.stop?.message ?? "", /callback/);
    assert.equal(game.hiddenEntities.has("npc"), true);
    assert.deepEqual(host.snapshot(), before);
    assert.ok(Object.values(host.collision()).every((value) => value === true));
  });
}

test("failed collision preparation publishes neither a prepared Show nor Ready state", () => {
  const { game, host } = fixture([enter, wait, exec, exit, exit, exit]);
  game.startEvent("main");
  const before = host.snapshot();
  host.port.prepareCollision = () => { throw new Error("unavailable source collision host"); };
  game.advance(10);
  assert.match(game.stop?.message ?? "", /collision host/);
  assert.equal(game.hiddenEntities.has("npc"), true);
  assert.deepEqual(host.snapshot(), before);
});

test("a source port with missing control context cannot inherit development callback assumptions", () => {
  const { game, host } = fixture([enter, wait, exec, exit, exit, exit]);
  game.startEvent("main");
  const before = host.snapshot();
  host.port.controlContext = () => undefined as never;
  game.advance(10);
  assert.match(game.stop?.message ?? "", /control context/);
  assert.equal(game.hiddenEntities.has("npc"), true);
  assert.deepEqual(host.snapshot(), before);
  assert.ok(Object.values(host.collision()).every((value) => value === true));
});

test("async Exec does not manufacture collision recovery at script end; world-map scripts leave it untouched", () => {
  for (const worldMapScript of [false, true]) {
    const { game, host } = fixture([
      { ...enter, target: 3 }, { kind: "exec-puppets", asynchronous: true }, exit, wait, exit,
    ], { worldMapScript, callback: "absent" });
    game.startEvent("main");
    assert.equal(game.stop, null);
    assert.equal(game.busy, false);
    assert.ok(Object.values(host.collision()).every((value) => value === worldMapScript));
  }
});

test("source context cannot silently use the legacy development actor bootstrap", () => {
  const { content, events, host } = fixture([exit]);
  const before = events.snapshot();
  const missing = new FieldGame(content, events);
  missing.startEvent("main");
  assert.match(missing.stop?.message ?? "", /host or script context/);
  assert.deepEqual(events.snapshot(), before);
  const failing: FieldPuppetActorsPort = { ...host.port, prepare: () => { throw new Error("missing shader input"); } };
  const refused = new FieldGame(content, events, undefined, undefined, { puppetActors: failing });
  refused.startEvent("main");
  assert.match(refused.stop?.message ?? "", /shader input/);
  assert.deepEqual(events.snapshot(), before);
});

test("a development save cannot restore an unpersisted source actor/camera/collision host", () => {
  const { content, host } = fixture([exit]);
  delete content.scriptPuppetContexts;
  const development = new FieldGame(content);
  const saved = development.checkpoint();
  assert.throws(() => FieldGame.restore(content, saved, { puppetActors: host.port }), /bound.*codec/);
});
