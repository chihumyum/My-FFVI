import test from "node:test";
import assert from "node:assert/strict";
import { BattleGame } from "../src/core/battle.js";
import { compileTargetRule } from "../src/compiler/battle-targets.js";
import type {
  BattleContent,
  CombatantDefinition,
} from "../src/core/battle-content.js";
function fixture(): BattleContent {
  const unit: CombatantDefinition = {
    id: "a",
    sourceId: 1000,
    name: "Synthetic ally",
    side: "player",
    level: 2,
    physical: { attack: 20, strength: 30, accuracy: 100, criticalRate: 0 },
    hp: 80,
    mp: 8,
    magic: 20,
    attack: 20,
    defense: 30,
    magicDefense: 30,
    agility: 40,
    weight: 0,
    evasion: 0,
    magicEvasion: 0,
    exp: 0,
    gil: 0,
    growthGroup: "g",
    abilities: [10, 11, 12],
    commands: [100],
    conditionIds: [],
    conditionResistances: {},
    attackElements: [],
    elementResistances: {},
    ai: [],
    placement: null,
    sprites: { idle: "synthetic", mount: null },
  };
  return {
    kind: "opening-battle-development",
    profile: "narshe-playability-v8",
    contentHash: "synthetic",
    sourceContentHash: "synthetic",
    fieldSourceSetHash: "synthetic",
    encounterId: 1000,
    formation: "normal",
    maxPartyLevel: null,
    atb: {
      coefficient: 21,
      enemyCoefficient: 12,
      total: 550,
      maxHighSpeed: 50,
      maxLowSpeed: 50,
    },
    initialAtb: { player: [100, 100], enemy: [0, 0] },
    gil: 0,
    players: [unit, { ...structuredClone(unit), id: "b", name: "Second ally" }],
    enemies: [
      {
        ...structuredClone(unit),
        id: "e1",
        name: "Enemy",
        side: "enemy",
        hp: 10,
        exp: 9,
        gil: 7,
        abilities: [13],
        ai: [{ ability: 13, weight: 1 }],
      },
      {
        ...structuredClone(unit),
        id: "e2",
        name: "Enemy",
        side: "enemy",
        hp: 10,
        exp: 9,
        gil: 7,
        abilities: [13],
        ai: [{ ability: 13, weight: 1 }],
      },
    ],
    conditions: { rules: { definitions: [], eraseRules: [] }, behaviors: [] },
    commands: {
      100: {
        id: 100,
        name: "Synthetic command",
        abilityIds: [10, 11, 12],
        forbiddenConditionIds: [],
      },
    },
    abilities: {
      10: {
        id: 10,
        name: "Beam",
        presentation: "beam",
        program: {
          abilityId: 10,
          groupId: 1,
          functions: [
            { slot: 1, functionId: 800, type: 3, series: 0, values: [1, 0, 0] },
          ],
          process: { key: "None", values: [0, 0, 0] },
          range: 3,
          rules: {},
          elements: [],
          forbiddenConditionIds: [],
          contentFlags: [],
        },
        plan: {
          effects: [{ slot: 1, kind: "magic" }],
          targeting: {
            relation: "enemy",
            modes: ["single"],
            defaultMode: "single",
            defaultRelation: "enemy",
            normalFormationOnly: false,
          },
          physical: null,
          magic: {
            accuracy: 100,
            contentFlags: [1],
            elements: [],
            forceDefense: false,
          },
        },
        blockers: [],
        limitations: [],
        power: 30,
        cost: 0,
        wait: 0,
        attribute: 0,
      },
      11: {
        id: 11,
        name: "Heal",
        presentation: "heal",
        program: {
          abilityId: 11,
          groupId: 2,
          functions: [
            { slot: 1, functionId: 801, type: 1, series: 0, values: [2, 2, 0] },
          ],
          process: { key: "None", values: [0, 0, 0] },
          range: 1,
          rules: {},
          elements: [],
          forbiddenConditionIds: [],
          contentFlags: [],
        },
        plan: {
          effects: [
            { slot: 1, kind: "recovery", resource: "hp", calculation: "magic" },
          ],
          targeting: {
            relation: "ally",
            modes: ["single"],
            defaultMode: "single",
            defaultRelation: "ally",
            normalFormationOnly: false,
          },
          physical: null,
          magic: {
            accuracy: 100,
            contentFlags: [1],
            elements: [],
            forceDefense: false,
          },
        },
        blockers: [],
        limitations: [],
        power: 20,
        cost: 2,
        wait: 0,
        attribute: 0,
      },
      12: {
        id: 12,
        name: "Unsupported",
        presentation: "unsupported",
        program: {
          abilityId: 12,
          groupId: 3,
          functions: [
            {
              slot: 1,
              functionId: 802,
              type: 999,
              series: 0,
              values: [0, 0, 0],
            },
          ],
          process: { key: "None", values: [0, 0, 0] },
          range: 3,
          rules: {},
          elements: [],
          forbiddenConditionIds: [],
          contentFlags: [],
        },
        plan: null,
        blockers: ["unsupported function 999"],
        limitations: [],
        power: 0,
        cost: 0,
        wait: 0,
        attribute: 0,
      },
      13: {
        id: 13,
        name: "Physical",
        presentation: "physical",
        program: {
          abilityId: 13,
          groupId: 4,
          functions: [
            { slot: 1, functionId: 803, type: 2, series: 0, values: [0, 0, 0] },
          ],
          process: { key: "None", values: [0, 0, 0] },
          range: 7,
          rules: {},
          elements: [],
          forbiddenConditionIds: [],
          contentFlags: [],
        },
        plan: {
          effects: [{ slot: 1, kind: "physical" }],
          targeting: {
            relation: "either",
            modes: ["single"],
            defaultMode: "single",
            defaultRelation: "enemy",
            normalFormationOnly: false,
          },
          physical: {
            normalAttack: true,
            multiplyPercent: null,
            contentFlags: [],
          },
          magic: null,
        },
        blockers: [],
        limitations: [],
        power: 0,
        cost: 0,
        wait: 0,
        attribute: 0,
      },
    },
    growth: { g: [] },
    experience: [{ level: 2, exp: 0 }],
    background: "synthetic",
    sprites: {},
    limitations: [],
  };
}

test("one group action can damage a weak target and heal an absorbing target with one cost", () => {
  const f = fixture();
  const ability = f.abilities[10]!;
  ability.plan!.magic!.elements = [1];
  ability.plan!.targeting = compileTargetRule(4, 1)!;
  ability.cost = 2;
  f.enemies.forEach((e) => {
    e.hp = 1000;
    e.agility = 0;
  });
  f.enemies[0]!.elementResistances = { 1: 1 };
  f.enemies[1]!.elementResistances = { 1: 4 };
  const run = (parts: number[]) => {
    const battle = new BattleGame(f, 71);
    battle.enemies[1]!.hp = 300;
    assert.equal(
      battle.command("a", 10, { kind: "side", side: "enemy" }),
      true,
    );
    for (const dt of parts) battle.advance(dt);
    const results = battle.action!.results;
    assert.equal(results.length, 2);
    assert.equal(battle.players[0]!.mp, 6);
    assert.ok(battle.enemies[0]!.hp < 1000);
    assert.ok(battle.enemies[1]!.hp > 300);
    assert.equal(results[0]!.effects[0]!.recovery, false);
    assert.equal(results[1]!.effects[0]!.recovery, true);
    const before = structuredClone(battle.combatants);
    battle.advance(100);
    assert.deepEqual(
      battle.combatants.map((c) => [c.hp, c.mp]),
      before.map((c) => [c.hp, c.mp]),
    );
    return { results, units: battle.combatants, events: battle.events };
  };
  assert.deepEqual(run([500]), run(Array(50).fill(10)));
});

test("a later target with unknown affinity cannot partially commit earlier damage or consume MP/RNG", () => {
  const f = fixture();
  f.abilities[10]!.plan!.targeting = compileTargetRule(4, 1)!;
  f.abilities[10]!.plan!.magic!.elements = [1];
  f.abilities[10]!.cost = 2;
  f.enemies.forEach((e) => {
    e.hp = 1000;
    e.agility = 0;
  });
  const battle = new BattleGame(f, 71);
  battle.command("a", 10, { kind: "side", side: "enemy" });
  battle.advance(10);
  const before = structuredClone(battle.combatants);
  const random = (battle as unknown as { randomState: number }).randomState;
  const events = structuredClone(battle.events);
  battle.enemies[1]!.elementResistances = { 1: 402 } as never;
  assert.throws(() => battle.advance(500), /Unimplemented elemental/);
  assert.deepEqual(
    battle.combatants.map((c) => [c.hp, c.mp]),
    before.map((c) => [c.hp, c.mp]),
  );
  assert.equal(
    (battle as unknown as { randomState: number }).randomState,
    random,
  );
  assert.deepEqual(battle.events, events);
  assert.equal(battle.action!.resolved, false);
  assert.deepEqual(battle.action!.results, []);
});
function conditionFixture() {
  const f = fixture();
  f.conditions = {
    rules: {
      definitions: [
        { id: 301, type: 6, overlapped: false, eraseGroupId: 1 },
        { id: 302, type: 8, overlapped: false, eraseGroupId: 1 },
      ],
      eraseRules: [
        { id: 1, groupId: 1, conditionId: 0, type: 2, eraseConditionId: 0 },
      ],
    },
    behaviors: [{ id: 301, kind: "silence", name: "Silence", untilType: 2 }],
  };
  f.commands[100]!.forbiddenConditionIds = [301];
  f.commands[101] = {
    id: 101,
    name: "Status",
    abilityIds: [14, 15],
    forbiddenConditionIds: [],
  };
  for (const p of f.players) {
    p.abilities.push(14, 15);
    p.commands.push(101);
  }
  f.abilities[14] = {
    ...structuredClone(f.abilities[11]!),
    id: 14,
    name: "Recover",
    wait: 0,
    plan: {
      targeting: {
        relation: "either",
        modes: ["single"],
        defaultMode: "single",
        defaultRelation: "enemy",
        normalFormationOnly: false,
      },
      physical: null,
      magic: null,
      effects: [{ slot: 1, kind: "recover-condition", conditionIds: [301] }],
    },
  };
  f.abilities[15] = {
    ...structuredClone(f.abilities[11]!),
    id: 15,
    name: "Silence",
    wait: 0,
    plan: {
      targeting: {
        relation: "either",
        modes: ["single"],
        defaultMode: "single",
        defaultRelation: "enemy",
        normalFormationOnly: false,
      },
      physical: null,
      magic: null,
      effects: [
        {
          slot: 1,
          kind: "add-condition",
          conditionId: 301,
          fixedHit: true,
          accuracy: 100,
        },
      ],
    },
  };
  return f;
}
test("player physical goes through command, cost and target settlement with deterministic replay", () => {
  const f = fixture();
  f.players[0]!.abilities = [13];
  f.commands[100]!.abilityIds.push(13);
  f.abilities[13]!.cost = 2;
  for (const e of f.enemies) e.hp = 100;
  const run = (parts: number[]) => {
    const b = new BattleGame(f, 11);
    assert.equal(b.command("a", 13, "e1", 100), true);
    for (const dt of parts) b.advance(dt);
    assert.equal(b.players[0]!.mp, 6);
    assert.ok(b.enemies[0]!.hp < 100);
    assert.equal(b.events.filter((e) => e.text.includes("点伤害")).length, 1);
    return { combatants: b.combatants, events: b.events, action: b.action };
  };
  assert.deepEqual(run([900]), run(Array(90).fill(10)));
});
test("missing physical inputs block selection, and invalid arithmetic cannot partially commit", () => {
  const f = fixture();
  f.players[0]!.abilities = [13];
  f.commands[100]!.abilityIds.push(13);
  f.players[0]!.physical = null;
  let b = new BattleGame(f, 11);
  assert.equal(b.canUse("a", 13), false);
  assert.deepEqual(b.targets("a", 13), []);
  assert.equal(b.command("a", 13, "e1"), false);
  f.players[0]!.physical = {
    attack: 20,
    strength: 30,
    accuracy: 100,
    criticalRate: 0,
  };
  f.abilities[13]!.plan!.physical!.contentFlags = [777];
  f.abilities[13]!.cost = 2;
  b = new BattleGame(f, 11);
  const before = b.combatants.map((c) => ({ hp: c.hp, mp: c.mp }));
  assert.equal(b.command("a", 13, "e1"), true);
  assert.throws(() => b.advance(500), /Unimplemented physical/);
  assert.deepEqual(
    b.combatants.map((c) => ({ hp: c.hp, mp: c.mp })),
    before,
  );
});
test("magic misses spend MP once and replay with the same later random choices", () => {
  const f = fixture();
  f.abilities[10]!.cost = 3;
  f.abilities[10]!.plan!.magic = {
    accuracy: 100,
    contentFlags: [],
    elements: [],
    forceDefense: false,
  };
  for (const e of f.enemies) e.magicEvasion = 128;
  const run = (parts: number[]) => {
    const b = new BattleGame(f, 11);
    assert.equal(b.command("a", 10, "e1"), true);
    for (const dt of parts) b.advance(dt);
    assert.equal(b.players[0]!.mp, 5);
    assert.equal(b.enemies[0]!.hp, 10);
    assert.equal(b.events.filter((e) => e.text.includes("闪避")).length, 1);
    return { combatants: b.combatants, events: b.events, action: b.action };
  };
  assert.deepEqual(run([900]), run(Array(90).fill(10)));
});
test("old profiles and unknown magic modifiers cannot silently use neutral calculations", () => {
  const f = fixture();
  assert.throws(
    () =>
      new BattleGame(
        { ...f, profile: "narshe-playability-v4" } as unknown as BattleContent,
        1,
      ),
    /Unsupported battle runtime profile/,
  );
  f.abilities[10]!.cost = 3;
  f.abilities[10]!.plan!.magic!.contentFlags = [3];
  const b = new BattleGame(f, 1);
  assert.equal(b.command("a", 10, "e1"), true);
  assert.throws(() => b.advance(500), /Unimplemented magic content flag/);
  assert.equal(b.players[0]!.mp, 8);
  assert.equal(b.enemies[0]!.hp, 10);
});
test("status changes cancel a queued command without MP cost; cure restores eligibility", () => {
  const f = conditionFixture();
  f.abilities[10]!.cost = 3;
  const run = (parts: number[]) => {
    const b = new BattleGame(f, 11);
    assert.equal(b.command("a", 15, "b", 101), true);
    assert.equal(b.command("b", 10, "e1", 100), true);
    for (const dt of parts) b.advance(dt);
    assert.deepEqual(b.players[1]!.conditionIds, [301]);
    assert.equal(b.canUse("b", 10, 100), false);
    assert.equal(b.players[1]!.mp, 8);
    assert.equal(b.players[0]!.mp, 6);
    assert.equal(b.enemies[0]!.hp, 10);
    b.players[0]!.atb = 100;
    assert.equal(b.command("a", 14, "b", 101), true);
    b.advance(500);
    assert.deepEqual(b.players[1]!.conditionIds, []);
    assert.equal(b.canUse("b", 10, 100), true);
    assert.equal(b.players[0]!.mp, 4);
    return { combatants: b.combatants, events: b.events, action: b.action };
  };
  assert.deepEqual(run([1000]), run(Array(100).fill(10)));
  assert.deepEqual(
    f.players.map((p) => p.conditionIds),
    [[], []],
  );
});
test("the selected command stays attached to an action and is checked again at resolution", () => {
  const f = conditionFixture();
  f.commands[102] = {
    id: 102,
    name: "Alternative",
    abilityIds: [10],
    forbiddenConditionIds: [],
  };
  f.players[0]!.commands.push(102);
  f.players[0]!.conditionIds = [301];
  let b = new BattleGame(f, 1);
  assert.equal(b.canUse("a", 10), false); // Ambiguous source command.
  assert.equal(b.canUse("a", 10, 100), false);
  assert.equal(b.canUse("a", 10, 102), true);
  f.abilities[10]!.program.forbiddenConditionIds = [301];
  b = new BattleGame(f, 1);
  assert.equal(b.canUse("a", 10, 102), false); // An alternative command cannot bypass ability restriction.
  b.players[0]!.conditionIds = [];
  assert.equal(b.command("a", 10, "e1", 102), true);
  b.advance(10);
  assert.equal(b.action?.commandId, 102);
  b.players[0]!.conditionIds = [301];
  b.advance(500);
  assert.deepEqual(b.action?.results, []);
  assert.equal(b.enemies[0]!.hp, 10);
});
test("unknown active states and compound status plans never partially spend MP or apply effects", () => {
  const f = conditionFixture();
  f.players[0]!.conditionIds = [302];
  assert.throws(() => new BattleGame(f, 1), /Unimplemented active/);
  f.players[0]!.conditionIds = [];
  f.abilities[15]!.plan!.effects.push({ slot: 2, kind: "magic" });
  const b = new BattleGame(f, 1);
  assert.equal(b.command("a", 15, "b", 101), true);
  assert.throws(() => b.advance(500), /Unimplemented ability effect/);
  assert.equal(b.players[0]!.mp, 8);
  assert.deepEqual(b.players[1]!.conditionIds, []);
});
test("battle-only conditions clear before the party transfers to the field", () => {
  const f = conditionFixture();
  f.players[0]!.conditionIds = [301];
  const b = new BattleGame(f, 1);
  for (const enemy of b.enemies) enemy.hp = 0;
  b.advance(10);
  assert.equal(b.phase, "victory");
  assert.deepEqual(b.takeVictory()!.players[0]!.conditionIds, []);
  assert.deepEqual(f.players[0]!.conditionIds, [301]);
});
test("compound recovery commits both resources once and consumes one action cost", () => {
  const f = fixture();
  const a = f.abilities[11]!;
  a.power = 50;
  a.plan = {
    targeting: {
      relation: "self",
      modes: ["single"],
      defaultMode: "single",
      defaultRelation: "ally",
      normalFormationOnly: false,
    },
    physical: null,
    magic: null,
    effects: [
      { slot: 1, kind: "recovery", resource: "hp", calculation: "fixed" },
      { slot: 3, kind: "recovery", resource: "mp", calculation: "fixed" },
    ],
  };
  const run = (parts: number[]) => {
    const b = new BattleGame(f, 7);
    const actor = b.players[0]!;
    actor.hp = 1;
    actor.maxMp = 100;
    actor.mp = 8;
    assert.deepEqual(
      b.targets("a", 11).map((t) => t.id),
      ["a"],
    );
    assert.equal(b.command("a", 11, "b"), false);
    assert.equal(b.command("a", 11, "a"), true);
    for (const part of parts) b.advance(part);
    assert.equal(actor.hp, 51);
    assert.equal(actor.mp, 56); // 8 - one 2 MP cost + 50 MP recovery
    assert.equal(b.events.filter((e) => e.text.includes("恢复")).length, 2);
    return b;
  };
  assert.deepEqual(run([900]).combatants, run(Array(90).fill(10)).combatants);
});
test("invalid commands do not spend turns; unsupported abilities cannot execute", () => {
  const b = new BattleGame(fixture(), 7),
    before = structuredClone(b.combatants);
  for (const args of [
    ["a", 12, "e1"],
    ["a", 10, "b"],
    ["a", 13, "e1"],
    ["unknown", 10, "e1"],
    ["a", 10, "unknown"],
  ] as const)
    assert.equal(b.command(args[0], args[1], args[2]), false);
  assert.deepEqual(b.combatants, before);
  assert.equal(b.command("a", 10, "e1"), true);
  assert.equal(b.command("a", 10, "e2"), false);
});
test("queued attacks retarget a defeated enemy, settle rewards once, and replay across frame partitions", () => {
  const run = (parts: number[]) => {
    const b = new BattleGame(fixture(), 5);
    b.command("a", 10, "e1");
    b.command("b", 10, "e1");
    for (const dt of parts) b.advance(dt);
    return b;
  };
  const a = run([4000]),
    b = run(Array(400).fill(10));
  assert.equal(a.phase, "victory");
  assert.deepEqual(a.combatants, b.combatants);
  assert.deepEqual(a.events, b.events);
  assert.deepEqual(a.reward, b.reward);
  assert.equal(a.reward?.gil, 14);
  assert.equal(a.reward?.each, 9);
  assert.ok(a.enemies.every((e) => e.hp === 0));
  assert.equal(a.takeVictory()?.gil, 14);
  assert.equal(a.takeVictory(), null);
  const after = structuredClone(a.combatants);
  a.advance(5000);
  assert.deepEqual(a.combatants, after);
});
test("healing uses a living ally, consumes MP at execution, and clamps to max HP", () => {
  const f = fixture();
  f.enemies.forEach((e) => (e.agility = 0));
  const b = new BattleGame(f, 7);
  b.players[1]!.hp = 7;
  assert.equal(b.command("a", 11, "b"), true);
  assert.equal(b.players[0]!.mp, 8);
  b.advance(1200);
  assert.equal(b.players[1]!.hp, b.players[1]!.maxHp);
  assert.equal(b.players[0]!.mp, 6);
});
test("enemy actions can defeat the party; defeat never grants victory or rewards", () => {
  const f = fixture();
  f.players.forEach((p) => (p.hp = 1));
  f.enemies.forEach((e) => {
    e.level = 10;
    e.attack = 80;
  });
  f.initialAtb.enemy = [100, 100];
  const b = new BattleGame(f, 20);
  for (let n = 0; n < 5 && b.phase === "active"; n++) b.advance(60000);
  assert.equal(b.phase, "defeat");
  assert.equal(b.reward, null);
  assert.equal(b.takeVictory(), null);
  assert.ok(b.players.every((p) => p.hp === 0));
});

test("group actions reselect living members at impact, and one remaining target gets full damage", () => {
  const f = fixture();
  f.abilities[10]!.plan!.targeting = compileTargetRule(6, 3)!;
  f.abilities[10]!.cost = 2;
  for (const enemy of f.enemies) enemy.hp = 2000;
  const run = (group: boolean, parts: number[]) => {
    const b = new BattleGame(f, 71);
    assert.equal(
      b.command("a", 10, group ? { kind: "side", side: "enemy" } : "e1"),
      true,
    );
    b.advance(10);
    b.enemies[1]!.hp = 0; // Target disappears after selection, before impact.
    for (const part of parts) b.advance(part);
    assert.deepEqual(b.action!.targetIds, ["e1"]);
    assert.equal(b.players[0]!.mp, 6);
    assert.equal(b.enemies[1]!.hp, 0);
    return b;
  };
  const all = run(true, [400]);
  assert.deepEqual(all.action!.results, run(false, [400]).action!.results);
  assert.deepEqual(all.combatants, run(true, Array(40).fill(10)).combatants);
  assert.deepEqual(all.action!.selection, { kind: "side", side: "enemy" });
});

test("multi-target numerical actions use the staged count and cannot bypass scope restrictions", () => {
  const f = fixture();
  f.abilities[10]!.plan!.targeting = compileTargetRule(4, 3)!;
  f.abilities[10]!.cost = 2;
  for (const enemy of f.enemies) enemy.hp = 2000;
  const run = (parts: number[]) => {
    const b = new BattleGame(f, 31);
    assert.equal(b.command("a", 10, "e1"), false); // All-only is not a single attack.
    assert.equal(b.command("a", 10, { kind: "side", side: "player" }), false);
    const selection = { kind: "side" as const, side: "enemy" as const };
    assert.equal(b.command("a", 10, selection), true);
    assert.equal(b.command("a", 10, selection), false);
    for (const part of parts) b.advance(part);
    assert.equal(b.players[0]!.mp, 6);
    assert.deepEqual(
      b.action!.results.map((r) => r.target),
      ["e1", "e2"],
    );
    for (const result of b.action!.results) {
      const effect = result.effects[0]!;
      assert.equal(effect.resource, "hp");
      if (effect.resource === "hp")
        assert.ok(effect.amount > 40 && effect.amount < 80);
    }
    return b;
  };
  assert.deepEqual(run([500]).combatants, run(Array(50).fill(10)).combatants);
});

test("a later target failure rolls back every result, resource and random draw", () => {
  const f = fixture();
  f.abilities[10]!.plan!.targeting = compileTargetRule(4, 3)!;
  f.abilities[10]!.cost = 2;
  for (const enemy of f.enemies) enemy.hp = 2000;
  const setup = () => {
    const b = new BattleGame(f, 9);
    assert.equal(b.command("a", 10, { kind: "side", side: "enemy" }), true);
    b.advance(10);
    return b;
  };
  const b = setup();
  const before = b.combatants.map((c) => ({
    id: c.id,
    hp: c.hp,
    mp: c.mp,
    conditionIds: c.conditionIds,
  }));
  const events = structuredClone(b.events);
  b.enemies[1]!.magicDefense = 256;
  assert.throws(() => b.advance(400), /outside supported/);
  assert.deepEqual(
    b.combatants.map((c) => ({
      id: c.id,
      hp: c.hp,
      mp: c.mp,
      conditionIds: c.conditionIds,
    })),
    before,
  );
  assert.deepEqual(b.events, events);
  assert.deepEqual(b.action!.results, []);
  assert.equal(b.action!.resolved, false);
  b.enemies[1]!.magicDefense = 30;
  b.advance(10);
  const control = setup();
  control.advance(410);
  assert.deepEqual(b.action!.results, control.action!.results);
  assert.deepEqual(b.combatants, control.combatants);
});

test("all-party compound recovery applies cost once before self MP recovery", () => {
  const f = fixture();
  const a = f.abilities[11]!;
  a.power = 50;
  a.plan = {
    targeting: compileTargetRule(2, 1)!,
    physical: null,
    magic: null,
    effects: [
      { slot: 1, kind: "recovery", resource: "hp", calculation: "fixed" },
      { slot: 3, kind: "recovery", resource: "mp", calculation: "fixed" },
    ],
  };
  const b = new BattleGame(f, 1);
  for (const player of b.players) {
    player.hp = 1;
    player.maxMp = 100;
  }
  assert.equal(b.command("a", 11, { kind: "side", side: "player" }), true);
  b.advance(500);
  assert.deepEqual(
    b.players.map((p) => [p.hp, p.mp]),
    [
      [51, 56],
      [51, 58],
    ],
  );
  assert.equal(b.action!.results.length, 2);
  b.advance(390);
  assert.deepEqual(
    b.players.map((p) => [p.hp, p.mp]),
    [
      [51, 56],
      [51, 58],
    ],
  );
});

test("group status effects keep individual resistance and recover individual identities", () => {
  const f = conditionFixture();
  f.abilities[15]!.plan!.targeting = compileTargetRule(4, 5)!;
  f.abilities[14]!.plan!.targeting = compileTargetRule(4, 1)!;
  f.enemies[1]!.conditionResistances = { 301: 1 };
  const b = new BattleGame(f, 19);
  assert.equal(b.command("a", 15, { kind: "side", side: "enemy" }, 101), true);
  b.advance(500);
  assert.deepEqual(
    b.enemies.map((e) => e.conditionIds),
    [[301], []],
  );
  assert.deepEqual(
    b.action!.results.map((r) => r.effects[0]!.missed),
    [false, true],
  );
  assert.equal(b.players[0]!.mp, 6);
  b.advance(410);
  b.players[0]!.atb = 100;
  assert.equal(b.command("a", 14, { kind: "side", side: "enemy" }, 101), true);
  b.advance(500);
  assert.deepEqual(
    b.enemies.map((e) => e.conditionIds),
    [[], []],
  );
  assert.equal(b.players[0]!.mp, 4);
});
