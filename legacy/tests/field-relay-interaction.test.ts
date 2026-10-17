import test from "node:test";
import assert from "node:assert/strict";
import {
  fieldRelayCellLimits, fieldRelayIsInRange, projectFieldRelaySearchRanges,
  canFieldRelayInteractToEntityPosition,
  type FieldRelayNativePosition, type FieldRelayParentContext,
  type FieldRelayPlacement, type FieldRelayMapArea, type FieldRelaySearchRanges,
} from "../src/core/field-relay-interaction.js";

const point = (x = 0, y = 0, z = 249): FieldRelayNativePosition => ({ x, y, z });
const parent = (): FieldRelayParentContext => ({
  translation: point(0, 0, 0), rotation: point(0, 0, 0), scale: point(1, 1, 1),
});
const relay = (x: number, y: number, horizontalCellLimit = 1, verticalCellLimit = 1): FieldRelayPlacement => ({
  worldPosition: point(x, y), horizontalCellLimit, verticalCellLimit,
});
const noLoop = (): FieldRelayMapArea => ({ xMin: 0, yMin: 0, width: 0, height: 0 });
const projection = (registeredRelays: readonly FieldRelayPlacement[]) =>
  projectFieldRelaySearchRanges({ playerLocalPosition: point(), registeredRelays, parentContext: parent() });
const candidate = (target: FieldRelayNativePosition, changes: Partial<Parameters<typeof canFieldRelayInteractToEntityPosition>[0]> = {}) =>
  canFieldRelayInteractToEntityPosition({
    playerLocalPosition: point(), targetLocalPosition: target, playerDirection: "right",
    objectType: 6, searchRanges: [1, 3, 1, 1], mapArea: noLoop(), parentContext: parent(), ...changes,
  });

test("source pixel dimensions use integer division with truncation and retain zero-cell intervals", () => {
  assert.deepEqual(fieldRelayCellLimits(31, 48), { horizontalCellLimit: 1, verticalCellLimit: 3 });
  assert.deepEqual(fieldRelayCellLimits(15, 16), { horizontalCellLimit: 0, verticalCellLimit: 1 });
  assert.deepEqual(fieldRelayCellLimits(0, 0), { horizontalCellLimit: 0, verticalCellLimit: 0 });
  for (const size of [-1, 16.5, NaN, Infinity, 0x80000000])
    assert.throws(() => fieldRelayCellLimits(size, 16));
});

test("relay membership uses strict native world-space rectangle edges and exact source Z", () => {
  const source = relay(0, 0);
  assert.equal(fieldRelayIsInRange(source, point()), true);
  for (const target of [point(-8, 0), point(8, 0), point(0, -8), point(0, 8), point(0, 0, 149)])
    assert.equal(fieldRelayIsInRange(source, target), false);
  assert.equal(fieldRelayIsInRange(source, point(7.999, 0)), true);
  assert.equal(fieldRelayIsInRange(source, point(8 - Number.EPSILON, 0)), false,
    "Native float32 rounding reaches the excluded right edge");
  assert.equal(fieldRelayIsInRange(relay(0, 0, 0, 1), point()), false);
  assert.equal(fieldRelayIsInRange(relay(0, 0, 1, 0), point()), false);
});

test("search ranges preserve up, right, down, left source order and native positive-Y north", () => {
  const result = projection([relay(0, 16), relay(16, 0), relay(0, -16), relay(-16, 0)]);
  assert.deepEqual(result.searchRanges, [2, 2, 2, 2]);
  assert.deepEqual(result.hits, [
    { relayIndex: 0, direction: "up", addedCells: 1 },
    { relayIndex: 1, direction: "right", addedCells: 1 },
    { relayIndex: 2, direction: "down", addedCells: 1 },
    { relayIndex: 3, direction: "left", addedCells: 1 },
  ]);
});

test("overlapping and repeated registered relays accumulate individually without deduplication", () => {
  const source = relay(16, 0);
  const result = projection([source, source]);
  assert.deepEqual(result.searchRanges, [1, 3, 1, 1]);
  assert.deepEqual(result.hits.map(hit => hit.relayIndex), [0, 1]);
});

test("later probes stay one cell from the player rather than tracing the accumulated range", () => {
  const result = projection([relay(16, 0), relay(32, 0)]);
  assert.deepEqual(result.searchRanges, [1, 2, 1, 1]);
  assert.deepEqual(result.hits, [{ relayIndex: 0, direction: "right", addedCells: 1 }]);
});

test("rectangular relays add the horizontal or vertical limit for the actual probe axis", () => {
  assert.deepEqual(projection([relay(16, 0, 2, 1)]).searchRanges, [1, 3, 1, 1]);
  assert.deepEqual(projection([relay(0, 16, 1, 3)]).searchRanges, [4, 1, 1, 1]);
  assert.deepEqual(projection([]), { searchRanges: [1, 1, 1, 1], hits: [] });
});

test("only exact source NPC and ShopNPC types consume the extended direction range", () => {
  for (const objectType of [6, 17]) {
    assert.equal(candidate(point(48, 0), { objectType }), true);
    assert.equal(candidate(point(64, 0), { objectType }), false);
  }
  for (const objectType of [0, 4, 9, 16, 28, 99]) {
    assert.equal(candidate(point(16, 0), { objectType }), true);
    assert.equal(candidate(point(32, 0), { objectType }), false);
  }
  assert.throws(() => candidate(point(16, 0), { objectType: "6" as unknown as number }));
  assert.throws(() => candidate(point(16, 0), { objectType: 6.5 }));
});

test("position helper reads the player's actual direction and preserves the source zero vector", () => {
  assert.equal(candidate(point(0, 48), { playerDirection: "up", searchRanges: [3, 1, 1, 1] }), true);
  assert.equal(candidate(point(0, -48), { playerDirection: "down", searchRanges: [1, 1, 3, 1] }), true);
  assert.equal(candidate(point(-48, 0), { playerDirection: "left", searchRanges: [1, 1, 1, 3] }), true);
  assert.equal(candidate(point(0, 16), { playerDirection: "right" }), false);
  assert.equal(candidate(point(16, 0), { playerDirection: null }), false);
  const input = { playerLocalPosition: point(), targetLocalPosition: point(16, 0), objectType: 6,
    searchRanges: [1, 3, 1, 1] as FieldRelaySearchRanges, mapArea: noLoop(), parentContext: parent() };
  assert.throws(() => canFieldRelayInteractToEntityPosition(input), /actual player direction/);
});

test("same XY is the source early result while layer and activity remain separate owner requirements", () => {
  assert.equal(candidate(point(0, 0, 149)), true, "The lower source helper does not compare Z");
  assert.equal(candidate(point(32, 0, 149)), true);
  assert.equal(canFieldRelayInteractToEntityPosition({ playerLocalPosition: point(),
    targetLocalPosition: point(), objectType: 6, searchRanges: [1, 1, 1, 1],
    mapArea: noLoop(), parentContext: parent() }), true,
  "Same XY returns before reading player direction");
});

test("source loop correction applies one signed extent at the exact half-open boundary", () => {
  const mapArea = { xMin: -32, yMin: 32, width: 64, height: 64 };
  assert.equal(candidate(point(-32, 0), { playerLocalPosition: point(16, 0), mapArea }), true);
  assert.equal(candidate(point(-32, 0), { playerLocalPosition: point(-16, 0), playerDirection: "left", mapArea }), true);
  assert.equal(candidate(point(0, -32), { playerLocalPosition: point(0, 16), playerDirection: "up", mapArea }), true);
  assert.equal(candidate(point(0, -32), { playerLocalPosition: point(0, -16), playerDirection: "down", mapArea }), true);
  assert.equal(candidate(point(48, 0), { playerLocalPosition: point(96, 0), mapArea }), true);
  assert.equal(candidate(point(-16, 0), { playerLocalPosition: point(96, 0), mapArea }), false,
    "Modulo would wrap this twice; the source corrects only once");
});

test("ordinary no-loop MapArea must be explicit; missing or foreign geometry cannot default to zero", () => {
  assert.equal(candidate(point(48, 0)), true);
  assert.throws(() => candidate(point(16, 0), { mapArea: undefined as unknown as FieldRelayMapArea }));
  for (const mapArea of [
    { xMin: 0, yMin: 0, width: 64, height: 0 },
    { xMin: -32, yMin: 0, width: -64, height: 0 },
    { xMin: 0, yMin: 1, width: 0, height: 0 },
  ]) assert.throws(() => candidate(point(16, 0), { mapArea }), /map area/);
});

test("unknown or transformed parents cannot mix source local probes with relay world coordinates", () => {
  const parents: FieldRelayParentContext[] = [
    { ...parent(), translation: point(16, 0, 0) },
    { ...parent(), rotation: point(0, 0, 90) },
    { ...parent(), scale: point(2, 1, 1) },
  ];
  for (const parentContext of parents) {
    assert.throws(() => projectFieldRelaySearchRanges({ playerLocalPosition: point(),
      registeredRelays: [relay(16, 0)], parentContext }), /non-identity parent/);
    assert.throws(() => candidate(point(16, 0), { parentContext }), /non-identity parent/);
  }
  assert.throws(() => candidate(point(16, 0), { parentContext: undefined as unknown as FieldRelayParentContext }));
});

test("invalid later relays and search-distance overflow leave all supplied data unchanged", () => {
  const registeredRelays = [relay(16, 0), relay(NaN, 0)],
    input = { playerLocalPosition: point(), registeredRelays, parentContext: parent() }, before = structuredClone(input);
  assert.throws(() => projectFieldRelaySearchRanges(input));
  assert.deepEqual(input, before);
  assert.throws(() => projection([relay(16, 0, 0x7ffffff, 1)]));
  assert.throws(() => candidate(point(16, 0), { searchRanges: [1, 0, 1, 1] }));
  assert.throws(() => candidate(point(Infinity, 0)));
});

test("pure predicates expose all geometric candidates without choosing a nearest target or retaining state", () => {
  const near = point(32, 0), far = point(48, 0);
  assert.equal(candidate(far), true);
  assert.equal(candidate(near), true);
  const registeredRelays = [relay(16, 0)], first = projection(registeredRelays);
  first.searchRanges[1] = 9;
  registeredRelays[0] = relay(0, 16);
  assert.deepEqual(projection(registeredRelays).searchRanges, [2, 1, 1, 1]);
});
