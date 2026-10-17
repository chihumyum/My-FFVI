import test from "node:test";
import assert from "node:assert/strict";
import { battleTableIndex, tableInteger } from "../src/compiler/battle.js";
import { atbIncrement } from "../src/core/atb.js";

const source = { file: "synthetic.bundle", assetPath: "rows.csv",
  objectId: "-9223372036854775807", serializedFile: "synthetic-cab" };
test("battle rows preserve source identity and reject ambiguous numeric identities", () => {
  const index = battleTableIndex({ "rows.csv": [{id:"8", foreign:"250", value:"17"}, {id:"250 ", value:"19"}] }, {"rows.csv":source});
  const row = index.row("rows.csv", index.row("rows.csv", 8).values.foreign!);
  assert.equal(row.values.value, "19");
  assert.equal(row.source.rowId, "250 ");
  assert.equal(row.source.objectId, source.objectId);
  assert.throws(() => index.row("rows.csv", 9), /Unresolved/);
  assert.throws(() => index.group("rows.csv", "foreign", 7), /Unresolved/);
  assert.deepEqual(index.group("rows.csv", "foreign", 0), []);
  assert.throws(() => battleTableIndex({x:[{id:"250"},{id:"250 "}]}, {x:source}).row("x", 250), /Duplicate/);
  assert.throws(() => battleTableIndex({x:[{id:"1"}]}, {}).row("x", 1), /Unresolved/);
  assert.throws(() => battleTableIndex({x:[{id:"1", key:"same"},{id:"2", key:"same"}]}, {x:source}).unique("x", "key", "same"), /Ambiguous/);
});
test("battle numeric fields do not silently coerce malformed data", () => {
  assert.equal(tableInteger(" 250 "), 250);
  assert.equal(tableInteger("-1"), -1);
  for (const value of [undefined, "", " ", "1e3", "12x", "NaN", "1.5", "9007199254740993"])
    assert.throws(() => tableInteger(value));
});

const rules = { coefficient:21, enemyCoefficient:12, total:550, maxHighSpeed:50, maxLowSpeed:50 };
const input = { agility:21, weight:0, enemy:false, speedPercent:100, battleSpeed:1, seconds:1 };
test("source ATB arithmetic includes weight, enemy divisor and condition bounds", () => {
  // RVA 0x675950: 2 units * 30 * 100/550. Expected f32 values,
  // independently transcribed from the reviewed scalar instruction sequence.
  assert.equal(atbIncrement(rules, input), 10.909090995788574);
  assert.equal(atbIncrement(rules, {...input, enemy:true}), 9.090909004211426);
  assert.equal(atbIncrement(rules, {...input, weight:21}), 5.454545497894287);
  assert.equal(atbIncrement(rules, {...input, speedPercent:1000}), atbIncrement(rules, {...input, speedPercent:150}));
  assert.equal(atbIncrement(rules, {...input, speedPercent:-1000}), atbIncrement(rules, {...input, speedPercent:50}));
  assert.equal(atbIncrement(rules, {...input, seconds:0}), 0);
  assert.equal(atbIncrement(rules, {...input, battleSpeed:0}), 0);
  assert.equal(atbIncrement({...rules, total:0}, input), 60);
});
test("invalid ATB state cannot produce a poisoned meter", () => {
  for (const patch of [{seconds:-1}, {seconds:NaN}, {battleSpeed:Infinity}, {battleSpeed:1e300}, {agility:1.5}])
    assert.throws(() => atbIncrement(rules, {...input, ...patch}));
  for (const patch of [{coefficient:0}, {enemyCoefficient:0}, {total:-1}, {maxLowSpeed:101}])
    assert.throws(() => atbIncrement({...rules, ...patch}, input));
});
