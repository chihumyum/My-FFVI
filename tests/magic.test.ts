import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateNeutralMagic,
  type NeutralMagicInput,
} from "../src/core/magic.js";
import { calculateDevelopmentEffects } from "../src/core/ability.js";
import { compileContentFlags } from "../src/compiler/content-flags.js";
import { battleTableIndex } from "../src/compiler/battle.js";

const input = (): NeutralMagicInput => ({
  rules: { accuracy: 100, contentFlags: [], forceDefense: false },
  power: 30,
  actor: { side: "player", level: 10, magic: 20 },
  target: { side: "enemy", magicDefense: 64, magicEvasion: 0 },
  recovery: false,
  targetCount: 1,
});
function run(value: NeutralMagicInput, draws: number[]) {
  const ranges: number[][] = [];
  const remaining = [...draws];
  const result = calculateNeutralMagic(value, (min, max) => {
    ranges.push([min, max]);
    assert.ok(remaining.length, "Unexpected random draw");
    return remaining.shift()!;
  });
  assert.equal(remaining.length, 0, "Random draw was not consumed");
  return { ...result, ranges };
}
test("ordinary magic preserves independent hit and variance draws and per-stage rounding", () => {
  // Reviewed scalar branch: base 307; variance endpoints 269/306;
  // defense 64 produces 201/229. Expectations are hand-calculated boundaries.
  assert.deepEqual(run(input(), [255, 0]), {
    amount: 201,
    missed: false,
    ranges: [
      [0, 255],
      [0, 31],
    ],
  });
  assert.equal(run(input(), [0, 31]).amount, 229);
});
test("a miss stops before variance; certainty bypasses evasion without a hit draw", () => {
  const i = input();
  i.target.magicEvasion = 64;
  assert.equal(run(i, [127, 0]).amount, 201);
  assert.deepEqual(run(i, [128]), {
    amount: 0,
    missed: true,
    ranges: [[0, 255]],
  });
  i.target.magicEvasion = 255;
  i.rules.contentFlags = [1];
  assert.deepEqual(run(i, [0]), {
    amount: 201,
    missed: false,
    ranges: [[0, 31]],
  });
  i.rules.contentFlags = [];
  i.rules.accuracy = 300;
  assert.deepEqual(run(i, [0]).ranges, [[0, 31]]);
});
test("enemy magic applies 1.5 to the level-magic-power product before division", () => {
  const i = input();
  i.actor.side = "enemy";
  i.target.side = "player";
  // Enemy base is 401, not 307*1.5. Low variance gives 351 then 262.
  assert.equal(run(i, [0, 0]).amount, 262);
  i.recovery = true;
  assert.equal(run(i, [0, 0]).amount, 351);
});
test("recovery shares hit and variance but bypasses defense unless its provider forces it", () => {
  const i = input();
  i.recovery = true;
  i.target.side = "player";
  i.target.magicDefense = 255;
  assert.equal(run(i, [0, 0]).amount, 269);
  i.rules.forceDefense = true;
  assert.equal(run(i, [0, 0]).amount, 1);
  i.rules.contentFlags = [5];
  assert.equal(run(i, [0, 0]).amount, 269);
  i.target.magicEvasion = 128;
  assert.equal(run(i, [0]).missed, true);
});
test("friendly damage and total-target reduction occur after defense", () => {
  const i = input();
  i.target.side = "player";
  assert.equal(run(i, [0, 0]).amount, 100);
  i.targetCount = 3;
  assert.equal(run(i, [0, 0]).amount, 50);
  i.rules.contentFlags = [2];
  assert.equal(run(i, [0, 0]).amount, 100);
  i.recovery = true;
  i.rules.contentFlags = [];
  assert.equal(run(i, [0, 0]).amount, 134);
});
test("base cap precedes defense, final cap follows it, and single-target zero stays zero", () => {
  const i = input();
  i.actor = { side: "player", level: 99, magic: 255 };
  i.power = 220;
  i.target.magicDefense = 254;
  assert.equal(run(i, [0, 31]).amount, 256);
  i.target.magicDefense = 0;
  assert.equal(run(i, [0, 31]).amount, 9999);
  i.power = 0;
  i.target.side = "player";
  assert.equal(run(i, [0, 0]).amount, 0);
  i.target.side = "enemy";
  i.targetCount = 2;
  assert.equal(run(i, [0, 0]).amount, 1);
});
test("unknown flags, invalid values and unsupported overflow stop before random consumption", () => {
  const invalid = [
    { ...input(), power: NaN },
    { ...input(), power: 0x7fffffff },
    { ...input(), targetCount: 0 },
    { ...input(), target: { ...input().target, magicDefense: 256 } },
    { ...input(), rules: { ...input().rules, contentFlags: [3] } },
  ];
  for (const i of invalid)
    assert.throws(
      () =>
        calculateNeutralMagic(i, () =>
          assert.fail("Invalid input consumed RNG"),
        ),
      /Invalid|Unimplemented|outside/,
    );
  assert.throws(() => run(input(), [256]), /Invalid battle random draw/);
  assert.throws(() => run(input(), [0, 32]), /Invalid battle random draw/);
});
test("numerical effect adapter passes an actual miss through instead of spending variance", () => {
  const i = input();
  i.target.magicEvasion = 128;
  const effects = calculateDevelopmentEffects(
    {
      effects: [{ slot: 3, kind: "magic" }],
      targeting: {
        relation: "enemy",
        modes: ["single"],
        defaultMode: "single",
        defaultRelation: "enemy",
        normalFormationOnly: false,
      },
      physical: null,
      magic: i.rules,
    },
    i.power,
    { ...i.actor, attack: 20 },
    { ...i.target, defense: 0, evasion: 0 },
    (min, max) => {
      assert.deepEqual([min, max], [0, 255]);
      return 0;
    },
  );
  assert.deepEqual(effects, [
    { slot: 3, resource: "hp", recovery: false, amount: 0, missed: true },
  ]);
});
test("content flag projection uses group rows and preserves repeated or unknown identities", () => {
  const source = {
    file: "synthetic",
    assetPath: "flags",
    objectId: "-9223372036854775807",
    serializedFile: "synthetic",
  };
  const reader = battleTableIndex(
    {
      "content_flag_group.csv": [
        { id: "1", group_id: "987", content_flag_id: "5" },
        { id: "2", group_id: "987", content_flag_id: "1" },
        { id: "3", group_id: "987", content_flag_id: "5" },
        { id: "4", group_id: "987", content_flag_id: "777" },
      ],
    },
    { "content_flag_group.csv": source },
  );
  const result = compileContentFlags(reader, 987);
  assert.deepEqual(result.ids, [5, 1, 5, 777]);
  assert.equal(result.sources[0]!.source.objectId, source.objectId);
  assert.deepEqual(compileContentFlags(reader, 0), { ids: [], sources: [] });
  assert.throws(() => compileContentFlags(reader, 5), /Unresolved/);
});
