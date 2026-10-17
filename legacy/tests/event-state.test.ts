import test from "node:test";
import assert from "node:assert/strict";
import {
  EventState,
  eventOperation,
  UnknownEventValue,
  type Category,
} from "../src/core/event-state.js";
import { FieldGame } from "../src/core/field.js";
import { decodeFieldOp, decodeScriptLocals } from "../src/compiler/field.js";
import type { FieldContent } from "../src/field/types.js";
const ref = (category: Category, index = 0) => ({ category, index });
const source = { file: "synthetic", assetPath: "Assets/Fixture/program.json" };
const instruction = (
  mnemonic: string,
  iValues: number[] = [],
  sValues: string[] = [],
) => ({ mnemonic, type: 1, operands: { iValues: [...iValues, ...Array(8 - iValues.length).fill(0)], rValues: Array(8).fill(0), sValues: [...sValues, ...Array(8 - sValues.length).fill("")] } });
function host(raw: unknown[], state = new EventState()) {
  const c: FieldContent = {
    formatVersion: 1,
    kind: "field-development",
    contentHash: "test",
    sourceSetHash: "test",
    parentSourceSetHash: "test",
    map: {
      id: "synthetic",
      width: 1,
      height: 1,
      tileSize: 16,
      layers: [],
      tilesets: [],
      textures: {},
      collisions: { 1: [0] },
      entities: [],
      source,
    },
    characters: {},
    scripts: {
      event: raw.map((r, index) =>
        decodeFieldOp(r, { script: "event", index, source }, {}),
      ),
    },
    scriptLocals: { event: { labels: [], values: [] } },
    entry: {
      player: { x: 0, y: 0, layer: 1, direction: "up", asset: "", mount: "" },
      description: "fixture",
      evidence: [source],
    },
    limitations: [],
  };
  return new FieldGame(c, state);
}
test("unknown checkpoint cells are not false; native flag segments share physical identity", () => {
  const s = new EventState();
  assert.throws(() => s.read(ref("ScenarioFlag1", 255)), UnknownEventValue);
  s.write(ref("ScenarioFlag2", -1), -7);
  assert.equal(s.read(ref("ScenarioFlag1", 255)), 1);
  assert.throws(() => s.read(ref("ScenarioFlag2", 0)), UnknownEventValue);
  assert.throws(() => s.read(ref("TreasureFlag1", 255)), UnknownEventValue);
  s.write(ref("ScenarioFlag1", 255), 0);
  assert.equal(s.read(ref("ScenarioFlag2", -1)), 0);
  assert.throws(() => s.write(ref("ScenarioFlag4", 256), 1), /Invalid/);
  assert.throws(() => s.write(ref("ScenarioVariable", 16), 1), /Invalid/);
});
test("state roundtrip preserves unknowns, validates dimensions and does not alias caller memory", () => {
  const s = new EventState();
  s.write(ref("ScenarioVariable", 3), -2147483648);
  const snapshot = s.snapshot();
  const restored = new EventState(JSON.parse(JSON.stringify(snapshot)));
  snapshot.global[3] = 12;
  assert.equal(s.read(ref("ScenarioVariable", 3)), -2147483648);
  assert.equal(restored.read(ref("ScenarioVariable", 3)), -2147483648);
  assert.throws(
    () => restored.read(ref("ScenarioVariable", 4)),
    UnknownEventValue,
  );
  const invalid = s.snapshot();
  invalid.scenario[0] = 2;
  assert.throws(() => new EventState(invalid), /flag value/);
  const truncated = s.snapshot();
  truncated.map.pop();
  assert.throws(() => new EventState(truncated), /bank/);
});
test("map, area and script-local lifetimes are independent; selection register indices alias", () => {
  const s = EventState.initialized();
  s.beginScript({ labels: ["one", "two"], values: [9] });
  assert.equal(s.read(ref("ScriptLocalVariable", 0)), 0);
  s.write(ref("AreaLocalVariable", 0), 5);
  s.write(ref("MapLocalVariable", 0), 6);
  s.write(ref("ScenarioVariable", 0), 7);
  s.write(ref("ScriptLocalVariable", 0), 8);
  s.write(ref("MessageSelection", 999), 4);
  assert.equal(s.read(ref("MessageSelection", 0)), 4);
  s.clearMap(12);
  assert.equal(s.read(ref("MapLocalVariable", 0)), 0);
  assert.equal(s.read(ref("AreaLocalVariable", 0)), 5);
  assert.equal(s.read(ref("ScriptLocalVariable", 0)), 8);
  s.clearArea(13);
  assert.equal(s.read(ref("AreaLocalVariable", 0)), 0);
  assert.equal(s.read(ref("ScenarioVariable", 0)), 7);
  s.beginScript({ labels: ["new"], values: [42] });
  assert.equal(s.read(ref("ScriptLocalVariable", 0)), 42);
  assert.equal(s.read(ref("MessageSelection", 0)), 0);
  assert.throws(() => s.read(ref("ScriptLocalVariable", 1)), /invalid/);
  s.write(ref("MessageSelection", 0), 4);
  s.beginScript(null);
  assert.equal(s.read(ref("ScriptLocalVariable", 0)), 42);
  assert.equal(s.read(ref("MessageSelection", 0)), 4);
  s.beginScript({ labels: [], values: [] });
  assert.equal(s.read(ref("MessageSelection", 0)), 0);
  assert.throws(() => s.read(ref("ScriptLocalVariable", 0)), /invalid/);
});
test("signed arithmetic wraps additions/multiplication and preserves source zero-divisor rules", () => {
  assert.equal(eventOperation(2147483647, "＋", 1), -2147483648);
  assert.equal(eventOperation(-2147483648, "－", 1), 2147483647);
  assert.equal(eventOperation(0x7fffffff, "×", 0x7fffffff), 1);
  assert.equal(eventOperation(-7, "÷", 3), -2);
  assert.equal(eventOperation(-7, "％", 3), -1);
  assert.equal(eventOperation(19, "÷", 0), 19);
  assert.equal(eventOperation(19, "％", 0), 0);
  assert.throws(() => eventOperation(-2147483648, "÷", -1), /overflow/);
  assert.throws(() => eventOperation(-2147483648, "％", -1), /overflow/);
});
test("one field VM runs a counted loop, nested call and flag branch without scene rules", () => {
  const g = host([
    instruction("Calc", [0, 3], ["MapLocalVariable", "←", "imm"]),
    instruction("Call", [5]),
    instruction("Branch", [0, 0, 4], ["MapLocalVariable", "＝", "imm"]),
    instruction("Jump", [1]),
    instruction("SetFlag", [8], ["ScenarioFlag3"]),
    instruction("Exit"),
    instruction("Calc", [0, 1], ["MapLocalVariable", "－", "imm"]),
    instruction("Return"),
  ]);
  assert.equal(g.startEvent("event"), true);
  assert.equal(g.stop, null);
  assert.equal(g.busy, false);
  assert.equal(g.eventState.read(ref("MapLocalVariable", 0)), 0);
  assert.equal(g.flags.ScenarioFlag3![8], true);
});
test("unknown branches, runaway jumps and invalid taken targets stop before side effects", () => {
  for (const op of [
    instruction("Branch", [0, 0, 2], ["ScenarioFlag1", "＝", "imm"]),
    instruction("Jump", [0]),
    instruction("Jump", [1000]),
  ]) {
    const g = host([
      op,
      instruction("SetFlag", [1], ["ScenarioFlag1"]),
      instruction("Exit"),
    ]);
    g.startEvent("event");
    assert.equal(g.stop?.kind, "unsupported");
    assert.throws(
      () => g.eventState.read(ref("ScenarioFlag1", 1)),
      UnknownEventValue,
    );
  }
  const g = host(
    [
      instruction("Branch", [0, 1, 1000], ["MapLocalVariable", "＝", "imm"]),
      instruction("Exit"),
    ],
    EventState.initialized(),
  );
  g.startEvent("event");
  assert.equal(g.stop, null); // Untaken jump does not execute its invalid target.
});
test("variable operands do not become immediates; script metadata remains distinct from missing", () => {
  const g = host([
    instruction("Calc", [0, 5], ["MapLocalVariable", "←", "imm"]),
    instruction("Calc", [1, 0], ["MapLocalVariable", "←", "MapLocalVariable"]),
    instruction("Exit"),
  ]);
  g.startEvent("event");
  assert.equal(g.eventState.read(ref("MapLocalVariable", 1)), 5);
  assert.deepEqual(
    decodeScriptLocals({ ScriptLocal: ["a"], ScriptLocalValue: [9] }),
    { labels: ["a"], values: [9] },
  );
  assert.equal(decodeScriptLocals({}), null);
  assert.equal(
    decodeFieldOp(
      instruction("Branch", [0, 1, 1], ["Unknown", "＝", "imm"]),
      { script: "bad", index: 0, source },
      {},
    ).kind,
    "blocked",
  );
});

test("stale compiled instructions cannot silently skip a state write", () => {
  const game = host([instruction("Exit")]);
  game.content.scripts.event![0] = {
    ...game.content.scripts.event![0]!,
    kind: "set-flag",
    namespace: "ScenarioFlag1",
    flag: 1,
  } as unknown as FieldContent["scripts"][string][number];
  game.startEvent("event");
  assert.equal(game.stop?.kind, "unsupported");
  assert.throws(
    () => game.eventState.read(ref("ScenarioFlag1", 1)),
    UnknownEventValue,
  );
});
