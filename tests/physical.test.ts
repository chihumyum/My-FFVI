import test from "node:test";
import assert from "node:assert/strict";
import { calculatePhysical, type PhysicalInput } from "../src/core/physical.js";
import {
  confirmPlayerPhysical,
  confirmEnemyPhysical,
  type PlayerPhysicalInput,
} from "../src/core/physical-parameters.js";
import {
  compilePlayerPhysical,
  compileEnemyPhysical,
  compilePhysicalLimits,
  physicalLimitKeys,
} from "../src/compiler/physical-parameters.js";
import { battleTableIndex } from "../src/compiler/battle.js";

function input(): PhysicalInput {
  return {
    rules: { normalAttack: true, multiplyPercent: null, contentFlags: [] },
    rows: { actor: "front", target: "front", ignoreActorPenalty: false, ignoreTargetPenalty: false },
    power: 0,
    actor: {
      side: "player",
      level: 10,
      attackElements: [],
      attack: 40,
      strength: 30,
      accuracy: 100,
      criticalRate: 3,
    },
    target: { side: "enemy", defense: 64, evasion: 0, elementResistances: {} },
    targetCount: 1,
  };
}
function run(i: PhysicalInput, values: number[]) {
  const draws = [...values],
    ranges: number[][] = [];
  const result = calculatePhysical(i, (min, max) => {
    ranges.push([min, max]);
    assert.ok(draws.length, "Unexpected draw");
    return draws.shift()!;
  });
  assert.equal(draws.length, 0, "Unconsumed draw");
  return { ...result, ranges };
}
test("player physical uses selected weapon and strength; variance precedes hit and critical", () => {
  // Base trunc(40 + 100*(60+40)/256*1.5)=98; variance 85/97; defense 64/73.
  assert.deepEqual(run(input(), [0, 255, 3]), {
    amount: 64,
    missed: false,
    critical: false,
    ranges: [
      [0, 31],
      [0, 255],
      [0, 99],
    ],
  });
  assert.equal(run(input(), [31, 0, 99]).amount, 73);
  assert.equal(run(input(), [0, 0, 2]).amount, 128);
  const i = input();
  i.rules.normalAttack = false;
  i.power = 30;
  // Non-normal ability does not add the weapon's 40: base 82, variance 71.
  assert.equal(run(i, [0, 0, 99]).amount, 53);
});
test("enemy physical adds ability power and consumes a separate base draw", () => {
  const i = input();
  i.actor.side = "enemy";
  i.actor.attack = 20;
  i.power = 30;
  i.actor.criticalRate = 0;
  // At low draw, (56 + 4*(30+20))*10^2/256=100; variance87; defense65.
  assert.deepEqual(run(i, [0, 0, 255, 0]), {
    amount: 65,
    missed: false,
    critical: false,
    ranges: [
      [0, 7],
      [0, 31],
      [0, 255],
      [0, 99],
    ],
  });
  assert.equal(run(i, [7, 31, 0, 99]).amount, 76);
});
test("physical miss consumes variance but no critical; guaranteed hit skips only hit draw", () => {
  const i = input();
  i.target.evasion = 64;
  assert.equal(run(i, [0, 127, 99]).amount, 64);
  assert.deepEqual(run(i, [0, 128]), {
    amount: 0,
    missed: true,
    critical: false,
    ranges: [
      [0, 31],
      [0, 255],
    ],
  });
  i.rules.contentFlags = [1];
  i.target.evasion = 255;
  assert.deepEqual(run(i, [0, 99]).ranges, [
    [0, 31],
    [0, 99],
  ]);
  i.rules.contentFlags = [];
  i.actor.accuracy = 255;
  assert.deepEqual(run(i, [0, 99]).ranges, [
    [0, 31],
    [0, 99],
  ]);
});
test("integer multiply precedes variance, which has no plus-one", () => {
  const i = input();
  i.actor.level = 0;
  i.actor.attack = 5;
  i.rules.multiplyPercent = 150;
  i.rules.contentFlags = [5];
  // 5*150/100 truncates to 7; high variance truncates to 6, not 7.
  assert.equal(run(i, [31, 0, 99]).amount, 6);
  i.actor.attack = 1;
  assert.equal(run(i, [31, 0, 99]).amount, 0);
  i.rules.contentFlags = [];
  assert.equal(run(i, [31, 0, 99]).amount, 1); // defense contributes its own +1.
});
test("player base wraps float32 modulo 65536 instead of clamping before defense", () => {
  const i = input();
  i.actor.level = 200;
  i.actor.strength = 128;
  i.actor.attack = 255;
  i.target.defense = 254;
  // Scaled119531.25 -> remainder53995.25 -> base54250 -> low variance47468 -> 186.
  assert.equal(run(i, [0, 0, 99]).amount, 186);
  i.target.defense = 0;
  assert.equal(run(i, [0, 0, 99]).amount, 9999);
});
test("defense bypass also bypasses friendly halving; critical precedes multi-target reduction", () => {
  const i = input();
  i.target.side = "player";
  assert.equal(run(i, [0, 0, 99]).amount, 32);
  i.rules.contentFlags = [5];
  assert.equal(run(i, [0, 0, 99]).amount, 85);
  i.targetCount = 3;
  assert.equal(run(i, [0, 0, 0]).amount, 85); // 85*2 then half.
  i.rules.contentFlags = [2, 5];
  assert.equal(run(i, [0, 0, 0]).amount, 170);
});
test("single-target zero is neither a miss nor forced one damage", () => {
  const i = input();
  i.actor.level = 0;
  i.actor.attack = 0;
  i.rules.contentFlags = [5];
  assert.deepEqual(run(i, [0, 0, 99]), {
    amount: 0,
    missed: false,
    critical: false,
    ranges: [
      [0, 31],
      [0, 255],
      [0, 99],
    ],
  });
  i.targetCount = 2;
  assert.equal(run(i, [0, 0, 99]).amount, 0);
});
test("invalid physical values, flags and overflow fail before the first random draw", () => {
  const invalid = [
    { ...input(), power: NaN },
    { ...input(), power: 0x7fffffff },
    {
      ...input(),
      actor: { ...input().actor, level: 0, attack: 0 },
      rules: { ...input().rules, multiplyPercent: 0x80000000 },
    },
    { ...input(), targetCount: 0 },
    { ...input(), rules: { ...input().rules, contentFlags: [3] } },
    { ...input(), rules: { ...input().rules, multiplyPercent: Infinity } },
    { ...input(), actor: { ...input().actor, criticalRate: 101 } },
    { ...input(), target: { ...input().target, defense: 256 } },
  ];
  for (const i of invalid)
    assert.throws(
      () =>
        calculatePhysical(i, () => assert.fail("Invalid input consumed RNG")),
      /Invalid|Unimplemented|outside/,
    );
  assert.throws(() => run(input(), [32]), /Invalid battle random draw/);
});
const limits = {
  attack: 255,
  strength: 128,
  accuracy: 255,
  criticalRate: 100,
  criticalPercent: 100,
};
function parameters(): PlayerPhysicalInput {
  return {
    baseAttack: 12,
    bareHands: false,
    weaponAttack: 30,
    weaponAccuracy: 100,
    weaponCriticalRate: 3,
    strength: { base: 31, additional: 0, correction: 0, equipment: 0 },
    temporary: { attack: 0, strength: 0, accuracy: 0, criticalRate: 0 },
  };
}
test("selected-arm attack caps after temporary and weapon; strength caps at both stages", () => {
  const p = parameters();
  p.baseAttack = 300;
  p.temporary.attack = -30;
  p.weaponAttack = 40;
  p.strength = { base: 150, additional: 10, correction: -5, equipment: 5 };
  p.temporary.strength = -30;
  assert.deepEqual(confirmPlayerPhysical(p, limits), {
    attack: 255,
    strength: 103,
    accuracy: 100,
    criticalRate: 3,
  });
  p.baseAttack = 12;
  p.bareHands = true;
  p.weaponAttack = 0;
  p.temporary.attack = 0;
  assert.equal(confirmPlayerPhysical(p, limits).attack, 22);
});
test("enemy rates use raw caps; player critical uses the percentage conversion", () => {
  const p = parameters();
  p.weaponCriticalRate = 25;
  assert.equal(
    confirmPlayerPhysical(p, { ...limits, criticalRate: 200 }).criticalRate,
    12,
  );
  const b = { attack: 20, strength: 0, accuracy: 300, criticalRate: 25 };
  assert.equal(
    confirmEnemyPhysical(b, p.temporary, { ...limits, criticalRate: 200 })
      .criticalRate,
    25,
  );
  assert.equal(confirmEnemyPhysical(b, p.temporary, limits).accuracy, 255);
  p.temporary.accuracy = NaN;
  assert.throws(() => confirmPlayerPhysical(p, limits), /Invalid/);
});
test("source projection follows the selected arm and all equipment strength with exact identities", () => {
  const source = {
    file: "synthetic",
    assetPath: "synthetic",
    serializedFile: "synthetic",
    objectId: "9223372036854775807",
  };
  const tables = {
    "character_status.csv": [
      {
        id: "901",
        attack: "12",
        strength: "31",
        content_id1: "1001",
        content_id2: "1002",
        content_id3: "1003",
        content_id4: "1003",
        content_id5: "1003",
        content_id6: "1003",
      },
    ],
    "content.csv": [
      { id: "1001", type_id: "2", type_value: "801" },
      { id: "1002", type_id: "2", type_value: "802" },
      { id: "1003", type_id: "3", type_value: "803" },
    ],
    "weapon.csv": [
      {
        id: "801",
        type_id: "1",
        attack: "30",
        strength: "2",
        accuracy_rate: "90",
        critical_rate: "3",
      },
      {
        id: "802",
        type_id: "1",
        attack: "50",
        strength: "3",
        accuracy_rate: "99",
        critical_rate: "10",
      },
    ],
    "armor.csv": [{ id: "803", strength: "4" }],
    "monster.csv": [
      { id: "902", attack: "16", accuracy_rate: "100", critical_rate: "0" },
    ],
    "game_constant_int.csv": Object.entries(physicalLimitKeys).map(
      ([k, v], i) => ({
        id: String(i + 1),
        key_name: v,
        value1: String(limits[k as keyof typeof limits]),
      }),
    ),
  };
  const reader = battleTableIndex(
    tables,
    Object.fromEntries(Object.keys(tables).map((k) => [k, source])),
  );
  assert.deepEqual(compilePhysicalLimits(reader).values, limits);
  const context = {
    selectedArm: 1 as const,
    additionalStrength: 0,
    correctionStrength: 0,
    temporary: { attack: 0, strength: 0, accuracy: 0, criticalRate: 0 },
  };
  const a = compilePlayerPhysical(reader, 901, context, limits);
  assert.deepEqual(a.confirmed, {
    attack: 42,
    strength: 52,
    accuracy: 90,
    criticalRate: 3,
  });
  assert.ok(a.sources.every((s) => s.objectId === source.objectId));
  assert.deepEqual(
    compilePlayerPhysical(reader, 901, { ...context, selectedArm: 2 }, limits)
      .confirmed,
    { attack: 62, strength: 52, accuracy: 99, criticalRate: 10 },
  );
  assert.deepEqual(
    compileEnemyPhysical(reader, 902, context.temporary, limits).confirmed,
    { attack: 16, strength: 0, accuracy: 100, criticalRate: 0 },
  );
  const reversed = structuredClone(tables);
  reversed["weapon.csv"][0]!.id = "38";
  reversed["content.csv"][0]!.type_value = "38";
  assert.equal(
    compilePlayerPhysical(
      battleTableIndex(
        reversed,
        Object.fromEntries(Object.keys(reversed).map((k) => [k, source])),
      ),
      901,
      context,
      limits,
    ).confirmed.attack,
    13,
  );
  tables["weapon.csv"][1]!.critical_rate = "";
  assert.throws(
    () =>
      compilePlayerPhysical(
        reader,
        901,
        { ...context, selectedArm: 2 },
        limits,
      ),
    /Invalid/,
  );
  tables["content.csv"][0]!.type_value = "9999";
  assert.throws(
    () => compilePlayerPhysical(reader, 901, context, limits),
    /Unresolved/,
  );
});
