import test from "node:test";
import assert from "node:assert/strict";
import { FieldGame } from "../src/core/field.js";
import { EventState } from "../src/core/event-state.js";
import { DEVELOPMENT_TRANSPARENT_FADE } from "../src/core/field-fade.js";
import type { FieldContent, Op, Site } from "../src/field/types.js";

const source = { file: "synthetic", assetPath: "scheduler" };
type Instruction<T> = T extends Site ? Omit<T, keyof Site> : never;
function content(...instructions: Instruction<Op>[]): FieldContent {
  return { formatVersion: 1, kind: "field-development", contentHash: "synthetic",
    sourceSetHash: "synthetic", parentSourceSetHash: "synthetic",
    characters: {}, limitations: [], scripts: { main: instructions.map((op, index) =>
      ({ ...op, index, script: "main", source } as Op)) },
    map: { id: "synthetic", width: 10, height: 10, tileSize: 16, layers: [], tilesets: [], textures: {},
      source, collisions: { 1: Array(100).fill(0) }, entities: ["a", "b"].map((id) => ({
        id, kind: 6, asset: id, x: 1, y: 1, direction: "down", layer: 1,
        width: 1, height: 1, script: null, collision: null, destinationLayer: null, source })) },
    entry: { description: "synthetic", evidence: [source], fade: structuredClone(DEVELOPMENT_TRANSPARENT_FADE),
      player: { x: 3, y: 3, layer: 1, direction: "down", asset: "hero", mount: "" } } };
}
const set = (value: number): Instruction<Extract<Op, { kind: "calc" }>> => ({ kind: "calc", left: { category: "MapLocalVariable", index: 0 },
  operator: "←", right: { kind: "immediate", value } });
const add = (value: number): Instruction<Op> => ({ ...set(value), operator: "＋" });
const exit: Instruction<Op> = { kind: "exit" };
const wait: Instruction<Op> = { kind: "wait", seconds: 0 };
function start(c: FieldContent) {
  const state = new EventState();
  state.write({ category: "MapLocalVariable", index: 0 }, 0);
  const game = new FieldGame(c, state);
  assert.equal(game.startEvent("main"), true);
  return game;
}

test("main drains Next before slot order; a synchronous join observes completion on the next clock", () => {
  const game = start(content(
    { kind: "puppet", slot: 5, actor: "a", target: 5 },
    { kind: "puppet", slot: 0, actor: "b", target: 8 },
    { kind: "exec-puppets", asynchronous: false }, set(100), exit,
    set(5), add(5), exit, set(1), add(1), exit,
  ));
  assert.equal(game.stop, null);
  assert.equal(game.eventState.read({ category: "MapLocalVariable", index: 0 }), 10);
  assert.equal(game.busy, true);
  game.advance(10);
  assert.equal(game.eventState.read({ category: "MapLocalVariable", index: 0 }), 100);
  assert.equal(game.busy, false);
});

test("asynchronous puppets advance while the main dialogue waits; Finish joins the global slots", () => {
  const game = start(content(
    { kind: "puppet", slot: 0, actor: "a", target: 6 },
    { kind: "exec-puppets", asynchronous: true },
    { kind: "message", key: "line", text: "continue", speaker: "" },
    { kind: "finish-puppets" }, set(9), exit,
    wait, set(1), wait, set(2), exit,
  ));
  assert.equal(game.dialogue?.text, "continue");
  assert.equal(game.eventState.read({ category: "MapLocalVariable", index: 0 }), 0);
  game.advance(10);
  assert.equal(game.eventState.read({ category: "MapLocalVariable", index: 0 }), 1);
  game.confirm();
  assert.equal(game.busy, true);
  game.advance(10);
  assert.equal(game.eventState.read({ category: "MapLocalVariable", index: 0 }), 2);
  game.advance(10);
  assert.equal(game.eventState.read({ category: "MapLocalVariable", index: 0 }), 9);
  assert.equal(game.busy, false);
});

test("a halted main permits one puppet clock then prevents later instructions from leaking", () => {
  const game = start(content({ kind: "puppet", slot: 0, actor: "a", target: 3 },
    { kind: "exec-puppets", asynchronous: true }, exit, set(1), wait, set(2), exit));
  assert.equal(game.busy, false);
  assert.equal(game.eventState.read({ category: "MapLocalVariable", index: 0 }), 1);
  game.advance(100);
  assert.equal(game.eventState.read({ category: "MapLocalVariable", index: 0 }), 1);
});

test("a puppet moving the player's actor cannot suspend the main core's independent instructions", () => {
  const game = start(content(
    { kind: "puppet", slot: 0, actor: "-1001", target: 6 },
    { kind: "exec-puppets", asynchronous: true }, wait, set(77),
    { kind: "finish-puppets" }, exit,
    { kind: "move", direction: "right", steps: 1, secondsPerCell: 0.1 }, exit,
  ));
  assert.ok(game.player.motion);
  game.advance(10);
  assert.ok(game.player.motion);
  assert.equal(game.eventState.read({ category: "MapLocalVariable", index: 0 }), 77);
  game.advance(100);
  assert.equal(game.stop, null);
  assert.equal(game.busy, false);
});

test("competing movement controllers are rejected instead of silently serializing shared actor tracks", () => {
  const game = start(content(
    { kind: "puppet", slot: 0, actor: "a", target: 4 },
    { kind: "puppet", slot: 1, actor: "a", target: 4 },
    { kind: "exec-puppets", asynchronous: false }, exit,
    { kind: "move", direction: "right", steps: 1, secondsPerCell: 0.1 }, exit,
  ));
  assert.match(game.stop?.message ?? "", /movement arbitration/);
  assert.equal(game.checkpointReady, false);
});

test("global slot conflicts and a later unresolved actor publish no partial Ready visibility", () => {
  const c = content({ kind: "puppet", slot: 0, actor: "a", target: 4 },
    { kind: "puppet", slot: 1, actor: "missing", target: 4 },
    { kind: "exec-puppets", asynchronous: true }, exit, exit);
  const game = new FieldGame(c);
  game.hiddenEntities.add("a");
  game.startEvent("main");
  assert.equal(game.stop?.kind, "unsupported");
  assert.equal(game.hiddenEntities.has("a"), true);
  const conflict = start(content({ kind: "puppet", slot: 1, actor: "a", target: 3 },
    { kind: "puppet", slot: 1, actor: "b", target: 3 }, exit, exit));
  assert.match(conflict.stop?.message ?? "", /occupied/);
});

test("source task bounds reject a valid script-wide branch outside the puppet's first Exit", () => {
  const game = start(content({ kind: "puppet", slot: 0, actor: "a", target: 3 },
    { kind: "exec-puppets", asynchronous: false }, exit,
    { kind: "jump", target: 5 }, exit, { kind: "nop" }, set(99), exit));
  assert.match(game.stop?.message ?? "", /task range/);
  assert.equal(game.eventState.read({ category: "MapLocalVariable", index: 0 }), 0);
});

test("ordinary fade is global, survives stable saves, and a save cannot manufacture its host", () => {
  const c = content({ kind: "field-fade", direction: "out", seconds: 0, color: null }, exit);
  const game = start(c);
  assert.equal(game.busy, true, "even a synchronous zero-duration command yields once");
  game.advance(10);
  assert.equal(game.busy, false);
  const saved = game.checkpoint();
  assert.equal(saved.fade?.rendererColor.a, 1);
  assert.deepEqual(FieldGame.restore(c, saved).checkpoint(), saved);
  delete c.entry.fade;
  assert.throws(() => FieldGame.restore(c, saved), /missing fade host/);
  const unknown = start(c);
  assert.match(unknown.stop?.message ?? "", /Unknown initial field fade/);
});
