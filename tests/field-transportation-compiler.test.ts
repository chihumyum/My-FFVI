import assert from "node:assert/strict";
import test from "node:test";
import { compileFieldTransportationInstruction, fieldTransportationSelectors } from "../src/compiler/field-transportation.js";

function raw(mnemonic: string, ints: number[] = [], selector = "") {
  return { type: 1, mnemonic, operands: {
    iValues: Array.from({ length: 8 }, (_, i) => ints[i] ?? 0),
    rValues: Array(8).fill(0) as number[], sValues: [selector, ...Array<string>(7).fill("")],
  } };
}

test("placement preserves map identity, float coordinates and a live player-layer request", () => {
  assert.deepEqual(compileFieldTransportationInstruction(raw("SetVehicle", [99, 7, 13, -8, 0, 2])), {
    kind: "field-transportation", command: { kind: "place", transportationId: 99, stayMapId: 7,
      position: { x: 13, y: -8 }, layer: { kind: "player" }, direction: 4 },
  });
});

test("explicit layers are Unity layers and source direction selectors are native bit flags", () => {
  for (const [selector, expected] of [[0, 1], [1, 2], [2, 4], [3, 8]] as const) {
    const op = compileFieldTransportationInstruction(raw("SetVehicle", [3, 10, 0, 0, selector + 1, selector]));
    assert.equal(op.command.kind, "place");
    if (op.command.kind !== "place") throw new Error("Expected placement");
    assert.deepEqual(op.command.layer, { kind: "unity", value: selector + 9 });
    assert.equal(op.command.direction, expected);
  }
});

test("source int coordinates convert once to Vector2 float32 without integer wrap or scaling", () => {
  const op = compileFieldTransportationInstruction(raw("SetVehicle", [3, 1, 16777217, -16777217]));
  assert.equal(op.command.kind, "place");
  if (op.command.kind !== "place") throw new Error("Expected placement");
  assert.deepEqual(op.command.position, { x: 16777216, y: -16777216 });
});

test("NPC riding preserves source selectors and distinguishes ID1 from a player identity change", () => {
  for (const transportationId of [1, 3, 6, 99]) for (const actorSelector of [-1001, -31, 0, 14])
    assert.deepEqual(compileFieldTransportationInstruction(raw("RideVehicleNPC", [transportationId, actorSelector])), {
      kind: "field-transportation", command: { kind: "ride-npc", transportationId, actorSelector },
    });
});

const selectors = [
  ["乗り物に乗る：船", 2, false, 0],
  ["乗り物に乗る：チョコボ", 3, false, 1],
  ["乗り物に乗る：チョコボ(アニメ・BGMなし)", 3, true, 1],
  ["乗り物に乗る：ブラックジャック号", 4, false, 0],
  ["乗り物に乗る：ブラックジャック号(アニメ・BGMなし)", 4, true, 0],
  ["乗り物に乗る：ファルコン号", 5, false, 0],
  ["乗り物に乗る：ファルコン号(アニメ・BGMなし)", 5, true, 0],
  ["乗り物に乗る：魔導アーマー", 6, false, 0],
  ["乗り物に乗る：トランスティナ", 7, true, 0],
  ["乗り物に乗る：鳥", 8, true, 0],
  ["乗り物から降りる", 1, false, 0],
  ["乗り物から降りる(アニメ・BGMなし)", 1, true, 0],
] as const;
for (const [selector, transportationId, isBackground, viewType] of selectors)
  test(`source change wrapper preserves all arguments: ${selector}`, () => {
    assert.deepEqual(compileFieldTransportationInstruction(raw("SysCall", [], selector)), {
      kind: "field-transportation", command: { kind: "change", transportationId,
        changeCollisionEnable: true, isBackground, viewType },
    });
  });

test("unknown selectors, wrong instruction domains and malformed arrays stay blocked", () => {
  assert.deepEqual(fieldTransportationSelectors, selectors.map(row => row[0]));
  for (const value of [null, {}, raw("LoseVehicle", [3]), raw("OnTheVehicle"),
    raw("SysCall", [], "乗り物に乗る：未知"), raw("SysCall", [], "toString"),
    { ...raw("SetVehicle", [3, 1]), mnemonic: ["SetVehicle"] },
    { ...raw("SetVehicle", [3, 1]), type: 2 }])
    assert.throws(() => compileFieldTransportationInstruction(value));
  for (const key of ["iValues", "rValues", "sValues"] as const) {
    const op = raw("SetVehicle", [3, 1]); op.operands[key].pop();
    assert.throws(() => compileFieldTransportationInstruction(op));
  }
});

test("source map, layer and direction boundaries do not default or truncate invalid requests", () => {
  for (const ints of [[0, 1], [-1, 1], [3, 0], [3, -1], [3, 1, 0, 0, -1],
    [3, 1, 0, 0, 5], [3, 1, 0, 0, 0, -1], [3, 1, 0, 0, 0, 4],
    [3, 1, 0.5], [3, 1, 0x80000000], [NaN, 1]])
    assert.throws(() => compileFieldTransportationInstruction(raw("SetVehicle", ints)));
  for (const id of [0, -1, Infinity])
    assert.throws(() => compileFieldTransportationInstruction(raw("RideVehicleNPC", [id, 2])));
});

test("all currently unread operands must remain empty before a source operation is admitted", () => {
  const cases = [raw("SetVehicle", [3, 1]), raw("RideVehicleNPC", [3, 2]), raw("SysCall", [], selectors[0][0])];
  for (const original of cases) {
    for (let index = 0; index < 8; index++) {
      const op = structuredClone(original); op.operands.rValues[index] = .1;
      assert.throws(() => compileFieldTransportationInstruction(op));
    }
    for (let index = original.mnemonic === "SysCall" ? 1 : 0; index < 8; index++) {
      const op = structuredClone(original); op.operands.sValues[index] = "unexpected";
      assert.throws(() => compileFieldTransportationInstruction(op));
    }
    for (let index = original.mnemonic === "SetVehicle" ? 6 : original.mnemonic === "RideVehicleNPC" ? 2 : 0; index < 8; index++) {
      const op = structuredClone(original); op.operands.iValues[index] = 1;
      assert.throws(() => compileFieldTransportationInstruction(op));
    }
  }
});

test("decoding is pure and does not share mutable placement or selector definitions", () => {
  const input = raw("SetVehicle", [3, 1, 8, 9]), before = structuredClone(input),
    first = compileFieldTransportationInstruction(input);
  assert.deepEqual(input, before);
  if (first.command.kind !== "place") throw new Error("Expected placement");
  first.command.position.x = 500;
  const second = compileFieldTransportationInstruction(input);
  if (second.command.kind !== "place") throw new Error("Expected placement");
  assert.equal(second.command.position.x, 8);
  const change = compileFieldTransportationInstruction(raw("SysCall", [], selectors[0][0]));
  change.command.transportationId = 50;
  assert.equal(compileFieldTransportationInstruction(raw("SysCall", [], selectors[0][0])).command.transportationId, 2);
});
