import test from "node:test";
import assert from "node:assert/strict";
import {
  projectDevelopmentBattleLayout as layout,
  type DevelopmentBattleLayoutUnit as Unit,
} from "../src/core/battle-layout.js";

const player = (id: string, row: "front" | "back" = "front"): Unit => ({
  id, side: "player", row, placement: null,
});
const enemy = (id: string, group = 1): Unit => ({
  id, side: "enemy", row: "front", placement: { group },
});
const roster = () => [
  ...Array.from({ length: 4 }, (_, i) => player(`owner:${i}`)),
  ...Array.from({ length: 9 }, (_, i) => enemy(`enemy:${i + 1}`)),
];

test("normal layout fits four players and nine enemy anchors above the desktop four-member menu", () => {
  const units = roster(), result = layout(units, "normal");
  assert.equal(Object.keys(result).length, 13);
  assert.equal(new Set(Object.values(result).map(({ x, y }) => `${x},${y}`)).size, 13);
  for (const unit of units) {
    const position = result[unit.id]!;
    assert.ok(position.x >= 48 && position.x <= 464 && position.y >= 55 && position.y <= 155);
    assert.equal(position.facing, unit.side === "player" ? "left" : "right");
    if (unit.side === "player") assert.ok(position.x > 320);
    else assert.ok(position.x < 280);
  }
});

test("all possible nine-enemy wing splits stay distinct and face the center", () => {
  for (let left = 0; left <= 9; left++) {
    const units = roster();
    units.slice(4).forEach((unit, index) => { unit.placement!.group = index < left ? 1 : 2; });
    const result = layout(units, "opposed");
    assert.equal(new Set(Object.values(result).map(({ x, y }) => `${x},${y}`)).size, 13);
    for (const unit of units) {
      const position = result[unit.id]!;
      assert.ok(position.x >= 48 && position.x <= 464 && position.y >= 55 && position.y <= 155);
      if (unit.side === "player") assert.ok(position.x > 200 && position.x < 320);
      else {
        assert.equal(position.facing, unit.placement!.group === 1 ? "right" : "left");
        assert.ok(unit.placement!.group === 1 ? position.x < 200 : position.x > 320);
      }
    }
  }
});

test("compiled slot order is preserved within each side and wing without sorting unit IDs", () => {
  const units = [enemy("enemy:9", 2), player("z"), enemy("enemy:8"),
    player("a"), enemy("enemy:1", 2), enemy("enemy:2")];
  const result = layout(units, "opposed");
  assert.ok(result.z!.y < result.a!.y);
  assert.ok(result["enemy:9"]!.y < result["enemy:1"]!.y);
  assert.ok(result["enemy:8"]!.y < result["enemy:2"]!.y);
  const interleaved = [units[1]!, units[3]!, units[0]!, units[4]!, units[2]!, units[5]!];
  assert.deepEqual(layout(interleaved, "opposed"), result);
});

test("player row is an independent offset and does not reflow either enemy wing", () => {
  for (const formation of ["normal", "opposed"] as const) {
    const units = [player("one"), player("two"), enemy("left"), enemy("right", 2)];
    const before = layout(units, formation);
    units[1]!.row = "back";
    const after = layout(units, formation);
    assert.deepEqual(after.two, { ...before.two!, x: before.two!.x + 20 });
    for (const id of ["one", "left", "right"]) assert.deepEqual(after[id], before[id]);
  }
});

test("development layout ignores native coordinates and life state without mutating either", () => {
  const units = [player("p"), { ...enemy("e"), hp: 0, sourceId: 42,
    placement: { group: 1, x: -2000, y: 6000 } }];
  const before = structuredClone(units), result = layout(units, "normal");
  assert.deepEqual(units, before);
  const changed = structuredClone(units);
  changed[1] = { ...enemy("e"), hp: 100, sourceId: 42, placement: { group: 1, x: 7, y: -19 } };
  assert.deepEqual(layout(changed, "normal"), result);
  result.e!.x = -99;
  assert.notEqual(layout(units, "normal").e!.x, -99);
});

test("empty sides work and opaque IDs remain data rather than object prototype keys", () => {
  assert.deepEqual(layout([], "normal"), {});
  const units = [player("constructor"), enemy("__proto__")], result = layout(units, "normal");
  assert.equal(Object.keys(result).length, 2);
  assert.equal(Object.hasOwn(result, "__proto__"), true);
  assert.equal(result["__proto__"]!.facing, "right");
  assert.equal(layout([enemy("only", 2)], "opposed").only!.facing, "left");
});

test("unknown formation or opposed group cannot silently inherit a normal layout", () => {
  for (const formation of [undefined, "back-attack", "", 1])
    assert.throws(() => layout([enemy("e")], formation as "normal"), /Unsupported/);
  for (const placement of [null, { group: 0 }, { group: 3 }, { group: Number.NaN }])
    assert.throws(() => layout([{ ...enemy("e"), placement }], "opposed"), /group 1 or 2/);
  assert.doesNotThrow(() => layout([{ ...enemy("e"), placement: null }], "normal"));
});

test("duplicate identities, malformed members and over-capacity arrays reject", () => {
  for (const units of [
    [player("same"), enemy("same")], [player("")], [enemy(" padded ")],
    [{ ...player("p"), side: "neutral" }], [{ ...player("p"), row: "unknown" }],
    [undefined], new Array(1),
  ]) assert.throws(() => layout(units as Unit[], "normal"), /Invalid or duplicate/);
  assert.throws(() => layout(Array.from({ length: 5 }, (_, i) => player(String(i))), "normal"), /at most/);
  assert.throws(() => layout(Array.from({ length: 10 }, (_, i) => enemy(String(i))), "opposed"), /at most/);
});
