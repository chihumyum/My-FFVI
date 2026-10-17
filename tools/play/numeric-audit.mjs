import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { calculateDamage } from "../../src/play/battle.js";
import { createCharacter, raiseLevel, applyBattleRewards } from "../../src/play/progression.js";
import {
  executeAbilityEffects,
  periodicStatusAmount,
  periodicStatusInterval,
  setCondition,
} from "../../src/play/ability-effects.js";
import {
  referenceSources,
  numericRows,
  physicalBase,
  magicBase,
  damageReference,
  hitThreshold,
  periodicInterval,
  periodicAmount,
  snesDuration,
  levelForExp,
  growthAtLevel,
  rewardReference,
} from "./numeric-reference.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export async function auditNumbers({
  dataDir = path.join(ROOT, "build/web-data"),
  report = path.join(ROOT, "build/play/acceptance/step-6/numeric-audit.json"),
} = {}) {
  const raw = JSON.parse(await fs.readFile(path.join(dataDir, "raw/tables.json"), "utf8"));
  const battle = JSON.parse(await fs.readFile(path.join(dataDir, "battle.json"), "utf8"));
  const rows = (name) => numericRows(raw[`${name}.csv`]);
  const growth = rows("growth_curve"),
    exp = rows("exp_table"),
    characters = rows("character_status"),
    monsters = rows("monster"),
    abilities = rows("ability"),
    conditions = rows("condition"),
    contents = rows("content");
  const cases = [],
    unknown = [];
  const record = (category, name, input, expected, actual, basis = "PR-explicit") =>
    cases.push({
      category,
      name,
      basis,
      input,
      expected,
      actual,
      equal: JSON.stringify(expected) === JSON.stringify(actual),
    });
  const dataChar = (id) => battle.characters[id];
  const neutral = {
    side: "enemy",
    hp: 9999,
    maxHp: 9999,
    mp: 999,
    maxMp: 999,
    conditions: [],
    defense: 0,
    magicDefense: 0,
    evasion: 0,
    magicEvasion: 0,
    affinities: {},
  };

  // Fresh operands come from raw PR rows; the reference never calls a runtime
  // damage/status/equipment selector. Actual functions are used only as DUT.
  const levels = [1, 3, 7, 15, 30, 50, 75, 99],
    defenses = [0, 40, 100, 180];
  for (const enemy of [false, true])
    for (const physical of [false, true])
      for (const level of levels)
        for (const defense of defenses) {
          const row = characters[(level + defense) % Math.min(14, characters.length)];
          const monster = monsters[(level + defense) % monsters.length];
          const source = physical
            ? { id: 1, standard_value: 0 }
            : abilities.find((r) => r.id === [40, 45, 49][(level + defense) % 3]);
          const actor = {
            side: enemy ? "enemy" : "player",
            level,
            strength: row.strength,
            magic: enemy ? monster.ability_attack : row.magic,
            attack: enemy ? monster.attack : row.attack + 30,
            criticalRate: 0,
            conditions: [],
          };
          const target = {
            ...neutral,
            side: enemy ? "player" : "enemy",
            defense,
            magicDefense: defense,
          };
          const ability = {
            id: source.id,
            kind: physical ? "physical" : "magic",
            power: source.standard_value,
            accuracy: 255,
            flags: [1],
            elements: [],
          };
          const base = physical
            ? physicalBase({
                level,
                battlePower: actor.attack,
                vigor: actor.strength,
                monsterStrength: 60,
                enemy,
              })
            : magicBase({ level, battlePower: ability.power, magic: actor.magic, enemy });
          const expected = damageReference({ base, defense, varianceByte: 16, physical }).amount;
          const actual = calculateDamage(actor, target, ability, () => 0.5).amount;
          record(
            "damage",
            `${enemy ? "enemy" : "player"}-${physical ? "physical-fight" : "magic"}`,
            {
              actor,
              defense,
              ability,
              varianceByte: 16,
              monsterStrength: enemy && physical ? 60 : undefined,
            },
            expected,
            actual,
            "SNES-fallback-unconfirmed-for-PR",
          );
        }

  const physicalSkills = abilities
    .filter(
      (a) =>
        battle.abilities[a.id]?.kind === "physical" &&
        a.standard_value > 0 &&
        a.process_prog === "None",
    )
    .slice(0, 12);
  for (const source of physicalSkills)
    for (const attack of [0, 40, 120]) {
      const actor = {
        side: "player",
        level: 30,
        strength: 37,
        magic: 28,
        attack,
        conditions: [],
        criticalRate: 0,
      };
      const ability = {
        id: source.id,
        kind: "physical",
        power: source.standard_value,
        accuracy: 255,
        flags: [1],
        elements: [],
      };
      const expected = damageReference({
        base: physicalBase({ level: 30, vigor: 37, battlePower: source.standard_value }),
        varianceByte: 16,
        physical: true,
      }).amount;
      record(
        "physical-skill-power",
        `PR ability ${source.id}`,
        { actor, ability, source: `ability.csv#${source.id}.standard_value` },
        expected,
        calculateDamage(actor, neutral, ability, () => 0.5).amount,
        "SNES-fallback-unconfirmed-for-PR",
      );
    }
  const physicalInventory = Object.values(battle.abilities)
    .filter(
      (a) =>
        a.kind === "physical" ||
        a.functions.some((f) => [2, 77, 78].includes(f.id)) ||
        a.process === "StealAttack",
    )
    .map((ability) => {
      const normalized = { ...ability, kind: "physical", accuracy: 255, flags: [1] };
      const actor = {
        side: "player",
        level: 30,
        strength: 37,
        attack: 40,
        conditions: [],
        criticalRate: 0,
      };
      const low = calculateDamage(actor, { defense: 20 }, normalized, () => 0.5).amount;
      const high = calculateDamage(
        { ...actor, attack: 120 },
        { defense: 20 },
        normalized,
        () => 0.5,
      ).amount;
      const parents = Object.values(battle.abilities).filter((a) =>
        a.functions.some((f) => f.id === 41 && f.values[0] === ability.id),
      );
      const commandRoots = [ability, ...parents];
      const commandIds = rows("command")
        .filter((c) =>
          commandRoots.some(
            (a) =>
              c.ability_id === a.id ||
              c.auto_execution_ability_id === a.id ||
              (c.ability_group_id > 0 && c.ability_group_id === a.groupId),
          ),
        )
        .map((c) => c.id);
      record(
        "physical-power-global",
        `PR ability ${ability.id}`,
        {
          id: ability.id,
          power: ability.power,
          process: ability.process,
          attackPair: [40, 120],
          damagePair: [low, high],
        },
        true,
        ability.power > 0 ? low === high : high > low,
        "source-power dependency invariant",
      );
      return {
        abilityId: ability.id,
        name: ability.name,
        power: ability.power,
        process: ability.process,
        functionIds: ability.functions.map((f) => f.id),
        powerSource:
          ability.power > 0 ? "PR ability.standard_value" : "actor weapon/Fight BattlePower",
        commandIds,
        parentAbilityIds: parents.map((a) => a.id),
        commandAssociation:
          "direct ability_id, auto_execution_ability_id or authored nonzero ability_group_id; Jump parent follows explicit function41 child",
      };
    });

  for (const accuracy of [50, 80, 100, 120, 150, 255])
    for (const evade of [0, 1, 32, 64, 100, 128])
      for (const blind of [false, true]) {
        const actor = {
          side: "player",
          level: 10,
          attack: 40,
          strength: 30,
          conditions: blind ? [9] : [],
          criticalRate: 0,
        };
        let hits = 0;
        for (let roll = 0; roll < 100; roll++)
          if (
            !calculateDamage(
              actor,
              { ...neutral, evasion: evade },
              { id: 1, kind: "physical", power: 0, accuracy, flags: [] },
              () => (roll + 0.5) / 100,
            ).missed
          )
            hits++;
        record(
          "hit",
          "100 equally weighted percentile rolls",
          { accuracy, evade, blind },
          Math.min(100, hitThreshold({ accuracy, evade, blind, physical: true })),
          hits,
          "SNES-fallback-unconfirmed-for-PR",
        );
      }

  for (const source of conditions.filter((r) => [10, 25].includes(r.condition_type)))
    for (const maxHp of [16, 31, 32, 100, 999, 9999]) {
      const expected = periodicAmount(source, maxHp) * (source.condition_type === 25 ? -1 : 1);
      record(
        "periodic-amount",
        `condition ${source.id}`,
        { row: source, maxHp },
        expected,
        periodicStatusAmount({ maxHp }, source),
      );
    }
  for (const type of [10, 25, 407])
    for (const state of ["normal", "haste", "slow"]) {
      const unit = { conditions: state === "haste" ? [21] : state === "slow" ? [25] : [] };
      record(
        "periodic-cadence",
        `type ${type}/${state}`,
        { type, state },
        periodicInterval({ type, haste: state === "haste", slow: state === "slow" }),
        periodicStatusInterval(battle, unit, type),
        "SNES-fallback-unconfirmed-for-PR",
      );
    }
  for (const row of conditions.filter(
    (r) => [7, 17, 413].includes(r.condition_type) && r.until_value > 0,
  )) {
    const unit = { hp: 100, maxHp: 100, conditions: [] },
      host = { data: battle, elapsed: 0, warning: () => {} };
    setCondition(host, unit, row.id);
    record(
      "status-duration",
      `condition ${row.id}`,
      { row, secondsUnit: "PR until enum clock units unconfirmed" },
      snesDuration({ type: row.condition_type }),
      unit.conditionUntil?.[row.id] ?? null,
      "SNES-fallback-unconfirmed-for-PR",
    );
  }
  const stop = battle.abilities[72];
  if (stop)
    for (const evade of [0, 32, 64, 100, 128]) {
      let hits = 0;
      for (let roll = 0; roll < 100; roll++) {
        const target = { ...neutral, conditions: [], magicEvasion: evade },
          actor = { side: "player", hp: 100, maxHp: 100, conditions: [] };
        const host = {
          data: battle,
          elapsed: 0,
          random: () => (roll + 0.5) / 100,
          warning: () => {},
          addLog: () => {},
          players: [actor],
          enemies: [target],
        };
        executeAbilityEffects(host, actor, target, stop, 1, {}, calculateDamage);
        if (target.conditions.length) hits++;
      }
      record(
        "status-hit",
        "PR Stop ability72",
        { accuracy: stop.accuracy, magicEvasion: evade, function: stop.functions },
        Math.min(100, hitThreshold({ accuracy: stop.accuracy, evade })),
        hits,
        "SNES-fallback-unconfirmed-for-PR",
      );
    }
  for (const source of abilities.filter((a) => [53, 58, 70, 96].includes(a.id))) {
    const ability = battle.abilities[source.id];
    let applications = 0;
    for (let roll = 0; roll < 100; roll++) {
      const target = { ...neutral, conditions: [] },
        actor = { side: "player", hp: 100, maxHp: 100, conditions: [] };
      const host = {
        data: battle,
        elapsed: 0,
        random: () => (roll + 0.5) / 100,
        warning: () => {},
        addLog: () => {},
        players: [actor],
        enemies: [target],
      };
      executeAbilityEffects(host, actor, target, ability, 1, {}, calculateDamage);
      if (target.conditions.length) applications++;
    }
    record(
      "status-authored-accuracy",
      `PR ${ability.name} ability${source.id}`,
      {
        source: `ability.csv#${source.id}.accuracy_rate`,
        accuracy: source.accuracy_rate,
        magicEvasion: 0,
        rollGrid: "0.5..99.5",
        functions: ability.functions,
      },
      Math.min(100, source.accuracy_rate),
      applications,
      "PR-explicit-accuracy-operand; exact-evasion-order-unconfirmed",
    );
  }
  // Original PR ability314 supplies a real 70% counterexample; no invented
  // ability, immunity, evasion, forced flag or numeric-damage path is involved.
  const wave = battle.abilities[314],
    waveTarget = { ...neutral, conditions: [] },
    waveActor = { side: "player", hp: 100, maxHp: 100, conditions: [] };
  executeAbilityEffects(
    {
      data: battle,
      elapsed: 0,
      random: () => 0.8,
      warning: () => {},
      addLog: () => {},
      players: [waveActor],
      enemies: [waveTarget],
    },
    waveActor,
    waveTarget,
    wave,
    1,
    {},
    calculateDamage,
  );
  record(
    "status-operand-counterexample",
    "PR Shockwave314, roll80 against authored70",
    {
      abilityId: 314,
      accuracy: 70,
      random: 0.8,
      functionGroup: 442,
      functions: wave.functions,
      flags: wave.flags,
      targetImmunities: [],
      targetMagicEvasion: 0,
    },
    [],
    waveTarget.conditions,
    "PR-explicit-accuracy-operand",
  );

  for (const character of characters.filter((c) => battle.characters[c.id]))
    for (const level of [3, 10, 20, 40, 60, 80, 99].filter(
      (lv) => lv >= dataChar(character.id).level,
    )) {
      const unit = createCharacter(battle, character.id);
      raiseLevel(battle, unit, level, { magicite: false });
      const expected = growthAtLevel(character, growth, level);
      record(
        "growth",
        `character ${character.id}/level ${level}`,
        { characterId: character.id, level },
        expected,
        { hp: unit.naturalMaxHp, mp: unit.naturalMaxMp },
      );
    }
  for (const row of exp) {
    const unit = createCharacter(battle, 2);
    unit.exp = Math.max(0, row.total_exp - 1);
    const before = unit.exp;
    applyBattleRewards(battle, [unit], { outcome: "victory", exp: 1, ap: 0 });
    record(
      "experience",
      `PR threshold level ${row.lv}`,
      { before, awarded: 1, group: row.group_id },
      levelForExp(exp, before + 1, row.group_id),
      unit.level,
    );
  }

  for (let i = 0; i < 64; i++) {
    const picked = [monsters[(i * 7) % monsters.length], monsters[(i * 13 + 1) % monsters.length]];
    const players = Array.from({ length: 1 + (i % 4) }, (_, index) => ({
      id: index + 1,
      hp: index === 1 && i % 3 === 0 ? 0 : 100,
      maxHp: 100,
      maxMp: 20,
      mp: 20,
      naturalMaxHp: 100,
      naturalMaxMp: 20,
      level: 1,
      exp: 0,
      conditions: [],
      expGroup: 1,
      growthGroup: 1,
      abilities: [1, 2],
      magicite: 0,
    }));
    const expected = rewardReference({
      monsters: picked.map((m) => ({ ...m, defeated: true })),
      participants: players,
    });
    applyBattleRewards(battle, players, { outcome: "victory", exp: expected.exp, ap: 0 });
    record(
      "reward-division",
      "EXP survivor partition",
      {
        monsterIds: picked.map((m) => m.id),
        exp: expected.exp,
        participants: players.map((p) => ({ id: p.id, hp: p.hp })),
      },
      players.map((p) => (expected.eligibleIds.includes(p.id) ? expected.share : 0)),
      players.map((p) => p.exp),
    );
  }
  const learning = rows("learning").filter((r) => r.type_id === 2);
  for (const row of learning.slice(0, 80)) {
    const abilityId = contents.find((c) => c.id === row.content_id)?.type_value;
    const unit = {
      id: 2,
      level: 99,
      hp: 100,
      maxHp: 100,
      maxMp: 20,
      exp: 0,
      conditions: [],
      abilities: [1, 2],
      magicLearning: {},
      magicite: row.value1,
    };
    const ap = 1 + (row.id % 10);
    applyBattleRewards(battle, [unit], { outcome: "victory", exp: 0, ap });
    record(
      "ap-learning",
      `PR learning row ${row.id}`,
      { row, ap, abilityId },
      Math.min(100, row.value2 * ap),
      unit.magicLearning[abilityId] ?? 0,
    );
  }
  for (const row of monsters.filter((m) => battle.monsters[m.id]))
    record(
      "monster-reward-export",
      `monster ${row.id}`,
      { monsterId: row.id },
      { exp: row.exp, gil: row.gill },
      { exp: battle.monsters[row.id].exp, gil: battle.monsters[row.id].gil },
    );
  for (const row of rows("monster_party").filter((p) => battle.parties[p.id]))
    record(
      "ap-export",
      `party ${row.id}`,
      { partyId: row.id, get_ap: row.get_ap, get_value: row.get_value },
      row.get_value,
      battle.parties[row.id].ap,
      "PR-get_value-semantic-fallback",
    );

  unknown.push(
    "Damage, hit and status-duration mismatches are SNES fallback discrepancies, not proof of PR native formula. No new native investigation was performed.",
    "PR accuracy can exceed 100; SNES inverse-evade 255/256 boundary and stat=128 saturation need original PR sampling before strict parity claims.",
    "PR until_type clock unit is not declared in CSV. Source until_value is retained; SNES counter seconds are a comparison, not an override.",
    "Sap has no PR rate_value; its runtime maxHP/32 fallback is not independently numerically verified.",
    "PR monster_party get_ap is zero in every row; get_value carries 0..10. The AP semantic mapping is retained but not proven by field names alone.",
    "Magicite bonus dictionaries are already native-derived output, not independent raw CSV, so this audit excludes their percentage/stat bonus parity.",
    "Multi-element ordering, special weapons, counters, critical/morph/berserk stacking, ATB and status removal clock phases remain outside this first reference grid.",
  );
  const categories = Object.fromEntries(
    [...new Set(cases.map((c) => c.category))].map((category) => {
      const subset = cases.filter((c) => c.category === category);
      return [
        category,
        {
          cases: subset.length,
          equal: subset.filter((c) => c.equal).length,
          differences: subset.filter((c) => !c.equal).length,
        },
      ];
    }),
  );
  const currentResolution = (predicate) => {
    const checked = cases.filter(predicate);
    return {
      status:
        checked.length === 0
          ? "not-checked"
          : checked.every((c) => c.equal)
            ? "resolved-in-current-reference-grid"
            : "current-differences-remain",
      cases: checked.length,
      differences: checked.filter((c) => !c.equal).length,
      limitation:
        "Agreement with this reference grid is not independently measured native PR parity.",
    };
  };
  const remainingDifferences = [
    {
      category: "hit",
      count: cases.filter((c) => c.category === "hit" && !c.equal).length,
      reason:
        "Intentional PR percent boundary: zero evade retains 100% rather than SNES inverse 255/256; Blind is applied before this boundary.",
      allDifferencesAtZeroEvade: cases
        .filter((c) => c.category === "hit" && !c.equal)
        .every((c) => c.input.evade === 0),
    },
    {
      category: "status-hit",
      count: cases.filter((c) => c.category === "status-hit" && !c.equal).length,
      reason:
        "Same PR percent boundary for Stop at zero magic evasion; no repeated base roll on damage+status.",
    },
    {
      category: "status-duration",
      count: cases.filter((c) => c.category === "status-duration" && !c.equal).length,
      reason:
        "PR until_value30/60 retained; SNES sleep/stop18 and reflect26 status-counter cycles differ. No PR clock-unit proof, so no duration override.",
    },
  ];
  const output = {
    schema: "ffvi-numeric-reference-audit",
    version: 1,
    createdAt: new Date().toISOString(),
    mode: "ordinary numeric operands; no story runner or testBoost",
    sources: {
      pr: path.relative(ROOT, dataDir),
      snesCommit: "8130132",
      formulas: referenceSources,
    },
    summary: {
      cases: cases.length,
      equal: cases.filter((c) => c.equal).length,
      differences: cases.filter((c) => !c.equal).length,
      categories,
    },
    unknown,
    remainingDifferences,
    physicalInventory,
    findings: [
      {
        observation: "Historical pre-fix finding; present state is evaluated below.",
        classification:
          "confirmed-PR-operand-loss observed before correction; exact PR evasion ordering remains unknown",
        historicalSource: "src/play/ability-effects.js:1081-1089 before this correction",
        reference:
          "PR ability.csv#314 accuracy_rate=70; function_group.csv#442 function1_id=9/value1=5/value2=0; condition.csv#5",
        reason:
          "Before correction, fn9 manufactured invocation_rate=100 and selected it before ability.accuracy, losing the authored accuracy. This was distinct from the unresolved native PR evasion ordering.",
        minimalCase:
          "Before correction: ability314, target without resistance/evasion, RNG=.80: authored accuracy rejects; target.conditions=[5]. After correction: no condition.",
        affectedSourceAbilityIds: Object.values(battle.abilities)
          .filter(
            (a) =>
              a.power === 0 &&
              a.functions.length === 1 &&
              a.functions[0].id === 9 &&
              a.functions[0].values[1] !== 1 &&
              !a.flags.includes(1) &&
              a.accuracy < 100,
          )
          .map((a) => a.id),
        appliedFix:
          "Preserve an explicit distinction between the base ability hit roll and a group member invocation roll. A single-condition fn9 must not manufacture an overriding 100% base accuracy. Retain explicit forced flags.",
        currentResolution: currentResolution((c) =>
          ["status-authored-accuracy", "status-operand-counterexample"].includes(c.category),
        ),
      },
      {
        observation: "Historical pre-fix finding; present state is evaluated below.",
        classification: "SNES-fallback-deviation; PR formula not independently proven",
        historicalSource: "src/play/battle.js:77 before this correction",
        reference:
          "PR ability.csv#132 standard_value=110; SNES init_attacker.asm LoadMagicProp:261-280, CalcDmg:612-666",
        reason:
          "Before correction, physical skills added weapon attack to authored power, whereas the declared SNES fallback consumes the loaded spell/item BattlePower. Ordinary Fight and explicit weapon-backed actions now retain weapon power.",
        minimalCase: cases.find(
          (c) =>
            c.category === "physical-skill-power" &&
            c.input.ability.id === 132 &&
            c.input.actor.attack === 40,
        ),
        currentResolution: currentResolution((c) =>
          ["physical-skill-power", "physical-power-global"].includes(c.category),
        ),
      },
      {
        observation: "Historical pre-fix finding; present state is evaluated below.",
        classification: "SNES-fallback-deviation; PR formula not independently proven",
        historicalSource: "src/play/battle.js:69-71 before this correction",
        reference: "PR condition.csv#9=Blind; SNES check_hit.asm:173-176",
        reason:
          "Before correction, the numeric hit path ignored Blind. The remaining intentional zero-evade percent boundary is separate from the now-applied Blind penalty.",
        minimalCase:
          "Before correction, accuracy100/evasion64 produced 50/100 both normally and while Blind; the declared SNES fallback expects normal50/Blind25.",
        currentResolution: currentResolution(
          (c) => c.category === "hit" && c.input.blind && c.input.evade > 0,
        ),
      },
      {
        observation: "Historical pre-fix finding; present state is evaluated below.",
        classification: "SNES-fallback-rounding-deviation; PR arithmetic precision unknown",
        historicalSource: "src/play/battle.js:82-96 before this correction",
        reference: "SNES init_attacker.asm:643-666; init_2.asm:111-113; math.asm AddHalf",
        reason:
          "Before correction, player physical growth truncated after float*1.5 and enemy magic retained odd-stat half fractions. Both now follow the declared SNES integer fallback; native PR arithmetic precision remains unmeasured.",
        minimalCase:
          "Before correction, physical L30/Vigor37/BattlePower40 gave base641 instead of640; enemy magic7/L30/power21 gave base290 instead of280.",
        currentResolution: currentResolution((c) => c.category === "damage"),
      },
    ],
    cases,
  };
  await fs.mkdir(path.dirname(report), { recursive: true });
  await fs.writeFile(report, JSON.stringify(output, null, 2) + "\n");
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const report = option("--report"),
    dataDir = option("--data");
  const result = await auditNumbers({
    ...(report ? { report: path.resolve(report) } : {}),
    ...(dataDir ? { dataDir: path.resolve(dataDir) } : {}),
  });
  console.log(JSON.stringify(result.summary, null, 2));
}
