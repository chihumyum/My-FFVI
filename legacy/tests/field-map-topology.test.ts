import assert from "node:assert/strict";
import test from "node:test";
import { canonicalCell, nearestMapDelta, nearestMapImage, projectFieldMapStep,
  validateFieldMapTopology, type FieldMapTopology } from "../src/core/field-map-topology.js";

const topology = (horizontal = false, vertical = false): FieldMapTopology => ({
  range: { x: 10, y: 20, width: 8, height: 6 }, loop: { horizontal, vertical },
});

test("non-looping cells preserve finite fractional positions and use half-open crop bounds", () => {
  const map = topology(), p = { x: 10.125, y: 25.75 };
  assert.deepEqual(canonicalCell(map, p), p);
  assert.notEqual(canonicalCell(map, p), p);
  assert.deepEqual(nearestMapImage(map, p, { x: 17.5, y: 20 }), p);
  assert.deepEqual(nearestMapDelta(map, { x: 17.5, y: 20 }, p), { x: -7.375, y: 5.75 });
  for (const outside of [{ x: 18, y: 20 }, { x: 10, y: 26 }, { x: 9.999, y: 20 }, { x: 10, y: -1 }])
    assert.throws(() => canonicalCell(map, outside), /non-looping/);
});

test("horizontal and vertical loops normalize only their own axis relative to a nonzero crop", () => {
  assert.deepEqual(canonicalCell(topology(true), { x: 18.5, y: 23.25 }), { x: 10.5, y: 23.25 });
  assert.deepEqual(canonicalCell(topology(true), { x: -6.5, y: 20 }), { x: 17.5, y: 20 });
  assert.deepEqual(canonicalCell(topology(false, true), { x: 11.5, y: -4.25 }), { x: 11.5, y: 25.75 });
  assert.throws(() => canonicalCell(topology(true), { x: -100, y: 26 }), /non-looping/);
  assert.throws(() => canonicalCell(topology(false, true), { x: 18, y: -100 }), /non-looping/);
});

test("dual-axis canonicalization preserves sub-cell coordinates over negative and multiple turns", () => {
  const map = topology(true, true);
  assert.deepEqual(canonicalCell(map, { x: -14.25, y: 44.5 }), { x: 17.75, y: 20.5 });
  assert.deepEqual(canonicalCell(map, { x: 18, y: 26 }), { x: 10, y: 20 });
  for (const turns of [-100, -2, -1, 0, 1, 3, 100]) {
    const p = { x: 12.25 + turns * 8, y: 24.5 - turns * 6 };
    const projected = canonicalCell(map, p);
    assert.deepEqual(projected, { x: 12.25, y: 24.5 });
    assert.deepEqual(canonicalCell(map, projected), projected);
  }
});

test("one step across a seam keeps a short unwrapped motion beside its canonical start", () => {
  assert.deepEqual(projectFieldMapStep(topology(true), { x: 17, y: 23 }, { x: 1, y: 0 }), {
    from: { x: 17, y: 23 }, destination: { x: 10, y: 23 },
    unwrappedDestination: { x: 18, y: 23 }, motionDelta: { x: 1, y: 0 },
  });
  assert.deepEqual(projectFieldMapStep(topology(true), { x: 10, y: 23 }, { x: -1, y: 0 }), {
    from: { x: 10, y: 23 }, destination: { x: 17, y: 23 },
    unwrappedDestination: { x: 9, y: 23 }, motionDelta: { x: -1, y: 0 },
  });
  const vertical = projectFieldMapStep(topology(false, true), { x: 12.5, y: 25.5 }, { x: 0, y: 1 });
  assert.deepEqual(vertical.destination, { x: 12.5, y: 20.5 });
  assert.deepEqual(vertical.unwrappedDestination, { x: 12.5, y: 26.5 });
});

test("all four diagonal corners wrap together and a bounded axis rejects the whole step", () => {
  for (const [x, dx] of [[10, -1], [17, 1]] as const)
    for (const [y, dy] of [[20, -1], [25, 1]] as const) {
      const step = projectFieldMapStep(topology(true, true), { x, y }, { x: dx, y: dy });
      assert.deepEqual(step.destination, { x: x === 10 ? 17 : 10, y: y === 20 ? 25 : 20 });
      assert.deepEqual(step.unwrappedDestination, { x: x + dx, y: y + dy });
      assert.deepEqual(step.motionDelta, { x: dx, y: dy });
      assert.throws(() => projectFieldMapStep(topology(true), { x, y }, { x: dx, y: dy }), /non-looping/);
    }
});

test("ordinary interior movement is unchanged and a one-cell loop still has motion", () => {
  const step = projectFieldMapStep(topology(), { x: 12, y: 22 }, { x: 0, y: -1 });
  assert.deepEqual(step.destination, { x: 12, y: 21 });
  assert.deepEqual(step.unwrappedDestination, step.destination);
  const map: FieldMapTopology = { range: { x: 3, y: 4, width: 1, height: 1 },
    loop: { horizontal: true, vertical: true } };
  const wrapped = projectFieldMapStep(map, { x: 3, y: 4 }, { x: 1, y: -1 });
  assert.deepEqual(wrapped.destination, wrapped.from);
  assert.deepEqual(wrapped.unwrappedDestination, { x: 4, y: 3 });
  assert.deepEqual(wrapped.motionDelta, { x: 1, y: -1 });
});

test("nearest torus images support seam interactions and unwrapped camera references", () => {
  const map = topology(true, true), reference = { x: 17.75, y: 25.5 }, target = { x: 10.25, y: 20.5 };
  assert.deepEqual(nearestMapDelta(map, reference, target), { x: 0.5, y: 1 });
  assert.deepEqual(nearestMapImage(map, target, reference), { x: 18.25, y: 26.5 });
  assert.deepEqual(nearestMapImage(map, target, { x: reference.x + 24, y: reference.y - 12 }),
    { x: 42.25, y: 14.5 });
  assert.deepEqual(nearestMapDelta(map, target, reference), { x: -0.5, y: -1 });
  assert.deepEqual(nearestMapDelta(map, { x: 34.25, y: 8.5 }, target), { x: 0, y: 0 });
});

test("nearest image never wraps a bounded axis and rejects out-of-bounds targets and references", () => {
  const map = topology(true), from = { x: 17, y: 20 }, to = { x: 10, y: 25.5 };
  assert.deepEqual(nearestMapDelta(map, from, to), { x: 1, y: 5.5 });
  assert.deepEqual(nearestMapImage(map, to, from), { x: 18, y: 25.5 });
  assert.throws(() => nearestMapImage(map, { x: 10, y: 26 }, from), /non-looping/);
  assert.throws(() => nearestMapImage(map, to, { x: 17, y: 26 }), /non-looping/);
});

test("half-period ties retain canonical displacement direction deterministically", () => {
  const map = topology(true, true), a = { x: 10, y: 20 }, b = { x: 14, y: 23 };
  assert.deepEqual(nearestMapImage(map, b, a), b);
  assert.deepEqual(nearestMapImage(map, a, b), a);
  assert.deepEqual(nearestMapDelta(map, a, b), { x: 4, y: 3 });
  assert.deepEqual(nearestMapDelta(map, b, a), { x: -4, y: -3 });
});

test("invalid lengths, crop origins, overflow and implicit loop axes cannot grant topology", () => {
  for (const key of ["width", "height"] as const)
    for (const value of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      const map = topology(true, true); map.range[key] = value;
      assert.throws(() => validateFieldMapTopology(map), /topology range/);
    }
  for (const key of ["x", "y"] as const)
    for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
      const map = topology(); map.range[key] = value;
      assert.throws(() => validateFieldMapTopology(map), /topology range/);
    }
  for (const raw of [null, {}, { range: topology().range }, { ...topology(), loop: { horizontal: true } },
    { ...topology(), loop: { horizontal: 1, vertical: false } }, { ...topology(), loopType: 3 }])
    assert.throws(() => validateFieldMapTopology(raw as FieldMapTopology), /topology/);
});

test("invalid points and non-unit movement reject without touching caller state", () => {
  const map = topology(true, true), from = { x: 17, y: 25 }, before = structuredClone({ map, from });
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.throws(() => canonicalCell(map, { x: value, y: 20 }), /point/);
    assert.throws(() => nearestMapImage(map, from, { x: 10, y: value }), /point/);
  }
  for (const delta of [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: -2 }, { x: 0.5, y: 1 }, { x: 1, y: NaN }])
    assert.throws(() => projectFieldMapStep(map, from, delta), /step|point/);
  assert.deepEqual({ map, from }, before);
});

test("projections detach their results, normalize negative zero, and do not infer collision permission", () => {
  const map = topology(true, true), from = { x: 17, y: 25 }, delta = { x: 1, y: 1 };
  const before = structuredClone({ map, from, delta });
  const step = projectFieldMapStep(map, from, delta);
  step.from.x = 999; step.destination.y = 999; step.motionDelta.x = 999;
  const image = nearestMapImage(map, from, from); image.x = 999;
  assert.deepEqual({ map, from, delta }, before);
  const origin: FieldMapTopology = { range: { x: 0, y: 0, width: 4, height: 3 },
    loop: { horizontal: true, vertical: true } };
  assert.deepEqual(canonicalCell(origin, { x: -0, y: -3 }), { x: 0, y: 0 });
  // No collision grid is consulted: this is only a destination, not permission
  // to enter it. FieldGame must still validate both source and destination.
  assert.deepEqual(projectFieldMapStep(map, from, delta).destination, { x: 10, y: 20 });
});
