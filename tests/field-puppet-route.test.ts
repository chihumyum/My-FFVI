import test from "node:test";
import assert from "node:assert/strict";
import { compileFieldPuppetRouteInstruction } from "../src/compiler/field-puppet-route.js";
import { prepareFieldPuppetRoute, WEB_PUPPET_ROUTE_POLICY, fieldRouteDirection,
  type FieldPuppetRouteCommand } from "../src/core/field-puppet-route.js";

const raw = () => ({ type: 2, mnemonic: "Route", operands: {
  iValues: [13, 21, 0, -1, 0, 0, 0, 0], rValues: Array(8).fill(0), sValues: ["", "", "", "", "", "", "", ""],
} });
const command = (): FieldPuppetRouteCommand => compileFieldPuppetRouteInstruction(raw()).command;
const input = () => ({ policy: WEB_PUPPET_ROUTE_POLICY, from: { x: 11, y: 21 }, layer: 0,
  range: { x: 10, y: 20, width: 5, height: 4 }, loop: { horizontal: false, vertical: false },
  magnification: 1, canStep: (_from: { x: number; y: number }, to: { x: number; y: number }) => !(to.x === 12 && to.y === 21) });

test("Puppet Route retains its two coordinates, source layer, nullable speed and exact animation", () => {
  const value = raw(); value.operands.iValues[0] = -2147483648; value.operands.iValues[1] = 2147483647;
  value.operands.iValues[2] = 2; value.operands.sValues[0] = "WalkR";
  assert.deepEqual(compileFieldPuppetRouteInstruction(value), { kind: "field-puppet-route", command: {
    x: -2147483648, y: 2147483647, layer: 2, speedId: null, animation: "WalkR",
  } });
  for (const speed of [-2147483648, -1, 0, 1, 2, 3, 4, 5, 6]) {
    value.operands.iValues[3] = speed;
    assert.equal(compileFieldPuppetRouteInstruction(value).command.speedId, speed < 0 ? null : speed);
  }
});
test("Route cannot decode External AssignMoveRoute, unknown slots or incomplete source operands", () => {
  for (const change of [(r: ReturnType<typeof raw>) => { r.type = 1; },
    (r: ReturnType<typeof raw>) => { r.mnemonic = "AssignMoveRoute"; },
    (r: ReturnType<typeof raw>) => { r.operands.iValues[4] = 1; },
    (r: ReturnType<typeof raw>) => { r.operands.rValues[0] = .1; },
    (r: ReturnType<typeof raw>) => { r.operands.sValues[1] = "reserved"; },
    (r: ReturnType<typeof raw>) => { r.operands.iValues[2] = 4; },
    (r: ReturnType<typeof raw>) => { r.operands.iValues[3] = 7; },
    (r: ReturnType<typeof raw>) => { r.operands.iValues.pop(); }]) {
    const value = raw(); change(value); assert.throws(() => compileFieldPuppetRouteInstruction(value));
  }
});
test("Route reads no accessor, custom iterator or sparse array when validating source data", () => {
  let reads = 0; const accessor = raw(); Object.defineProperty(accessor.operands.iValues, 0, { enumerable: true, get() { reads++; return 13; } });
  assert.throws(() => compileFieldPuppetRouteInstruction(accessor)); assert.equal(reads, 0);
  const iterable = raw(); Object.setPrototypeOf(iterable.operands.iValues, { [Symbol.iterator]() { reads++; return [1, 1, 0, 0, 0, 0, 0, 0][Symbol.iterator](); } });
  assert.throws(() => compileFieldPuppetRouteInstruction(iterable)); assert.equal(reads, 0);
  const sparse = raw(); delete sparse.operands.iValues[2]; assert.throws(() => compileFieldPuppetRouteInstruction(sparse));
});
test("the explicit Web path goes around source collision and keeps absolute nonzero map origins", () => {
  const before = command(), host = input(), result = prepareFieldPuppetRoute(before, host);
  assert.equal(result.flow, "wait"); if (result.flow !== "wait") assert.fail();
  assert.deepEqual(result.points, [{ x: 11, y: 20 }, { x: 12, y: 20 }, { x: 13, y: 20 }, { x: 13, y: 21 }]);
  assert.equal(result.direction, "up"); assert.equal(result.secondsPerCell, .24);
  assert.deepEqual(before, command()); assert.deepEqual(host.from, { x: 11, y: 21 });
});
test("no route never becomes a teleport; missing policy, wrap, range and layer remain explicit", () => {
  assert.throws(() => prepareFieldPuppetRoute(command(), { ...input(), canStep: () => false }), /no legal/);
  assert.throws(() => prepareFieldPuppetRoute(command(), { ...input(), policy: undefined }), /explicit Web/);
  assert.throws(() => prepareFieldPuppetRoute(command(), { ...input(), loop: { horizontal: true, vertical: false } }), /cyclic/);
  assert.throws(() => prepareFieldPuppetRoute({ ...command(), x: 15 }, input()), /outside/);
  assert.throws(() => prepareFieldPuppetRoute({ ...command(), layer: 2 }, input()), /cross-layer/);
  assert.throws(() => prepareFieldPuppetRoute(command(), { ...input(), from: { x: 11.5, y: 21 } }), /settled/);
});
test("same-cell same-layer native equality advances before pathfinding or starting animation", () => {
  const host = { ...input(), canStep() { throw new Error("must not search"); } };
  assert.deepEqual(prepareFieldPuppetRoute({ ...command(), x: 11, animation: "UnknownButNotStarted" }, host), { flow: "next" });
  assert.deepEqual(prepareFieldPuppetRoute({ ...command(), x: 11, layer: 2 }, { ...host, layer: 1 }), { flow: "next" });
  assert.throws(() => prepareFieldPuppetRoute({ ...command(), x: 11, layer: 2 }, host), /cross-layer/);
});
test("Route uses the existing seven speed timings without scaling animation twice", () => {
  for (const [speedId, seconds] of [0.24, 0.48, 0.12, 0.96, 0.06, 1.92, 0.16].entries()) {
    const result = prepareFieldPuppetRoute({ ...command(), speedId }, { ...input(), magnification: 2 });
    assert.equal(result.flow, "wait"); if (result.flow !== "wait") assert.fail();
    assert.equal(result.secondsPerCell, seconds / 2); assert.equal(result.animationSecondsPerCell, seconds);
  }
  assert.equal(fieldRouteDirection({ x: 2, y: 2 }, { x: 3, y: 2 }), "right");
  assert.throws(() => fieldRouteDirection({ x: 2, y: 2 }, { x: 3, y: 3 }));
});
