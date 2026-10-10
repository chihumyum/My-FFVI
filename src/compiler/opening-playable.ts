import { hash, record } from "./content.js";
import { readSnapshot, snapshotFile } from "./integrity.js";
import { tableInteger as int, type compileOpeningBattle } from "./battle.js";
import {
  compilePlayerParameters,
  compileEnemyParameters,
  compileParameterLimits,
} from "./parameters.js";
import type { ParameterValues } from "../core/parameters.js";
import type {
  BattleContent,
  BattleCatalog,
  BattleEncounter,
  CombatantDefinition,
  AbilityDefinition,
} from "../core/battle-content.js";

/** Explicit temporary choices belong to this profile, not the generic source decoder. */
export async function compileOpeningPlayable(
  root: string,
  source: Awaited<ReturnType<typeof compileOpeningBattle>>,
): Promise<BattleCatalog> {
  const field = record(
    JSON.parse(
      snapshotFile(
        await readSnapshot(root + "/build/field"),
        "field.json",
      ).toString(),
    ),
  );
  if (field.parentSourceSetHash !== source.parentSourceSetHash)
    throw new Error("Mismatched field/battle sources");
  const messages = record(record(field.messages).system_zhc);
  const name = (key: string) => {
    const value = messages[key];
    if (typeof value !== "string")
      throw new Error("Missing battle name: " + key);
    return value;
  };
  const row = (table: string, id: string | number) => {
    const value = source.tables[table]?.[String(id)];
    if (!value) throw new Error(`Missing playable dependency ${table}:${id}`);
    return value.values;
  };
  const rows = (table: string) =>
    Object.values(source.tables[table] ?? {}).map((r) => r.values);
  const unique = (table: string, key: string, value: string) => {
    const found = rows(table).filter((r) => r[key] === value);
    if (found.length !== 1)
      throw new Error(`Ambiguous playable dependency ${table}:${value}`);
    return found[0]!;
  };
  const sprite = (suffix: string) => {
    const found = Object.keys(source.sprites).filter((p) =>
      p.toLowerCase().endsWith(suffix.toLowerCase()),
    );
    if (found.length !== 1)
      throw new Error("Missing exact battle pose " + suffix);
    return found[0]!;
  };
  const initialAtb = (key: string): [number, number] => {
    const r = unique("game_constant_int.csv", "key_name", key);
    return [int(r.value1), int(r.value2)];
  };
  const parameterReader = {
    row: (table: string, id: string | number) => {
      row(table, id); // Same missing-dependency diagnostic as the rest of this profile.
      return source.tables[table]![String(id)]!;
    },
    unique: (table: string, key: string, value: string) => {
      const r = unique(table, key, value);
      return source.tables[table]![r.id!]!;
    },
  };
  const parameterLimits = compileParameterLimits(parameterReader).values;
  // Explicit opening-checkpoint inputs, NOT defaults for arbitrary characters,
  // earned growth, equipment abilities or status effects.
  const noTemporary: ParameterValues = {
    hp: 0,
    mp: 0,
    magic: 0,
    attack: 0,
    defense: 0,
    magicDefense: 0,
    agility: 0,
    weight: 0,
    evasion: 0,
    magicEvasion: 0,
  };
  const abilities: BattleContent["abilities"] = {};
  for (const a of rows("ability.csv")) {
    const id = int(a.id);
    const contents = rows("content.csv").filter(
      (c) => c.type_id === "4" && c.type_value === a.id,
    );
    // Guard's unnamed physical actions get authored UI descriptions, not substituted assets.
    const displayName =
      contents.length === 1
        ? contents[0]!.mes_id_name === "None"
          ? `能力 #${id}`
          : name(contents[0]!.mes_id_name!)
        : id === 1
          ? "攻击"
          : id === 377
            ? "突击"
            : null;
    if (!displayName) throw new Error("Missing ability display identity");
    const kind: AbilityDefinition["kind"] = [218, 219, 220].includes(id)
      ? "beam"
      : id === 222
        ? "heal"
        : [1, 377].includes(id)
          ? "physical"
          : "unsupported";
    abilities[id] = {
      id,
      name: displayName,
      kind,
      power: int(a.standard_value),
      multiplier: a.process_prog === "multiply" ? int(a.data_a) / 100 : 1,
      cost: int(a.use_value),
      wait: int(a.ability_wait),
      target: kind === "heal" ? "ally" : "enemy",
      attribute: int(a.attribute_id),
    };
  }
  const players: CombatantDefinition[] = source.initialParty.map((c) => {
    const r = row("character_status.csv", c.characterId);
    const parameters = compilePlayerParameters(
      parameterReader,
      c.characterId,
      {
        additional: { hp: 0, mp: 0, magic: 0, agility: 0, weight: 0 },
        correction: { magic: 0, agility: 0 },
        temporary: noTemporary,
        passive: { hp: 0, mp: 0, magicEvasion: 0 },
        condition601: false,
        twoHandMultiplier: 1,
      },
      parameterLimits,
    ).confirmed;
    const memberships = rows("ability_random_group.csv").filter(
      (m) => m.group_id === r.ability_random_group_id,
    );
    return {
      id: `player:${c.characterId}`,
      sourceId: c.characterId,
      name: name(r.mes_id_name!),
      side: "player",
      level: int(r.lv),
      ...parameters,
      exp: int(r.exp),
      gil: 0,
      growthGroup: r.growth_curve_group_id!,
      abilities: source.magitekAbilityIds.filter((id) =>
        memberships.some((m) => int(m.ability_id) === id),
      ),
      ai: [],
      placement: null,
      sprites: {
        idle: sprite(`/${c.spriteGroup}/RideL_00.png`),
        mount: sprite("/BC_FF6_P022/WalkL_00.png"),
      },
    };
  });
  const encounters: Record<string, BattleEncounter> = {};
  for (const encounter of source.encounters) {
    const enemies: CombatantDefinition[] = encounter.enemies.map((e) => {
      const r = row("monster.csv", e.monsterId);
      const parameters = compileEnemyParameters(
        parameterReader,
        e.monsterId,
        noTemporary,
        parameterLimits,
      ).confirmed;
      const ops = record(e.ai.data).Mnemonics as {
        mnemonic: string;
        operands: { iValues: number[]; rValues: number[] };
      }[];
      const guard = [
        "Nop",
        "SyncAI",
        "IsMyCondition",
        "StartTable",
        "Act",
        "EndTable",
        "JumpBattleAI",
        "Nop",
        "StartTable",
        "Act",
        "EndTable",
        "JumpBattleAI",
        "Nop",
        "Exit",
      ];
      const lobo = [
        "Nop",
        "SyncAI",
        "IsMyCondition",
        "IsLevelCheck",
        "StartTable",
        "Act",
        "EndTable",
        "JumpBattleAI",
        "Nop",
        "StartTable",
        "Act",
        "Act",
        "EndTable",
        "JumpBattleAI",
        "Nop",
        "StartTable",
        "Act",
        "EndTable",
        "JumpBattleAI",
        "Nop",
        "Exit",
      ];
      const expected =
        e.monsterId === 1 ? guard : e.monsterId === 26 ? lobo : [];
      if (
        r.initial_condition !== "0" ||
        ops.map((o) => o.mnemonic).join() !== expected.join() ||
        ops[2]?.operands.iValues[0] !== 12 ||
        ops[2]?.operands.iValues[1] !== (e.monsterId === 1 ? 7 : 14)
      )
        throw new Error("Enemy AI outside the street profile");
      if (
        e.monsterId === 26 &&
        (ops[3]!.operands.iValues.slice(0, 3).join() !== "1,7,8" ||
          ops[3]!.operands.iValues.slice(3).some(Boolean))
      )
        throw new Error("Unreviewed Silver Lobo level branch");
      const action = ops[e.monsterId === 1 ? 4 : 5]!.operands;
      const ai = action.iValues.flatMap((id, n) =>
        id ? [{ ability: id, weight: action.rValues[n]! }] : [],
      );
      if (
        ai.some(
          (a) =>
            abilities[a.ability]?.kind !== "physical" ||
            !Number.isFinite(a.weight) ||
            a.weight <= 0,
        )
      )
        throw new Error("Unsupported Guard action");
      return {
        id: `enemy:${e.slot}`,
        sourceId: e.monsterId,
        name: name(r.mes_id_name!),
        side: "enemy",
        level: int(r.lv),
        ...parameters,
        exp: int(r.exp),
        gil: int(r.gill),
        growthGroup: null,
        abilities: ai.map((a) => a.ability),
        ai,
        placement: { x: e.x, y: e.y, group: e.group },
        sprites: { idle: e.sprite, mount: null },
      };
    });
    encounters[encounter.partyId] = {
      encounterId: encounter.partyId,
      enemies,
      background: encounter.background,
      formation: encounter.pattern === 3 ? "opposed" : "normal",
      maxPartyLevel: enemies.some((e) => e.sourceId === 26) ? 6 : null,
    };
  }
  const growth: BattleContent["growth"] = {};
  for (const r of rows("growth_curve.csv")) {
    if (
      r.insert_type_1 !== "1" ||
      r.insert_type_2 !== "1" ||
      int(r.hp_value2) ||
      int(r.mp_value2)
    )
      throw new Error("Growth outside the fixed-increment development profile");
    (growth[r.group_id!] ??= []).push({
      level: int(r.lv),
      hp: int(r.hp_value1),
      mp: int(r.mp_value1),
    });
  }
  const common: BattleCatalog["common"] = {
    kind: "opening-battle-development",
    profile: "narshe-playability-v2",
    sourceContentHash: source.contentHash,
    fieldSourceSetHash: String(field.sourceSetHash),
    atb: source.atb,
    initialAtb: {
      player: initialAtb("ACCUMULATION_ATB_NORMAL"),
      enemy: initialAtb("ENEMY_ACCUMULATION_ATB_NORMAL"),
    },
    gil: int(unique("initialize_data.csv", "key_name", "INIT_GIL").value1),
    players,
    abilities,
    growth,
    experience: rows("exp_table.csv")
      .map((r) => ({ level: int(r.lv), exp: int(r.total_exp) }))
      .sort((a, b) => a.level - b.level),
    sprites: Object.fromEntries(
      Object.entries(source.sprites).map(([key, s]) => [
        key,
        { file: "/battle/" + s.file, width: s.width, height: s.height },
      ]),
    ),
    limitations: [
      "纳尔谢街道可玩开发规则；未经原版一致性验收，不代表完整战斗系统。",
      "初始能力解锁、命中/伤害分支、蓄力/排队、经验成长采用已记录的临时规则。",
      "初始数值使用分阶段属性确认；成长追加、Correction、临时与被动输入仍按开场检查点显式给零，未恢复通用状态/装备能力。",
      "当前开放三种射线和治愈原力；其余四种魔导、道具、逃跑与通用战斗脚本尚未实现。",
      "掉落尚未结算，库存保持不变；队伍 HP、经验、Gil 只保存在本次页面会话。",
      "站位、夹击队形、骑乘拼接和光束是临时二维表现；原版音效、特效、动画时序尚未接入。",
      "狼犬只开放全队等级低于 7 的源 AI 分支；高等级分支仍明确停止。",
    ],
  };
  const result = { kind: "narshe-battle-catalog" as const, common, encounters };
  return { ...result, contentHash: hash(result) };
}
