import {
  compilePhysicalLimits,
  compilePlayerPhysical,
  compileEnemyPhysical,
} from "./physical-parameters.js";
import { hash, record } from "./content.js";
import { readSnapshot, snapshotFile } from "./integrity.js";
import { tableInteger as int, type compileOpeningBattle } from "./battle.js";
import {
  compilePlayerParameters,
  compileEnemyParameters,
  compileParameterLimits,
} from "./parameters.js";
import type { ParameterValues } from "../core/parameters.js";
import { compileDevelopmentAbility } from "./ability.js";
import { compileBattleConditionCatalog } from "./conditions.js";
import { compileBattleCommand } from "./commands.js";
import { compileBattleAI, battleAIAbilities } from "./battle-ai.js";
import { compileGameState } from "./game-state.js";
import { compileFieldConditionCatalog } from "./field-conditions.js";
import {
  compileEquipmentCatalog,
  compileEquipmentParameterContext,
} from "./equipment.js";
import {
  compileEquipmentElements,
  compileElementResistances,
} from "./elements.js";
import type {
  BattleContent,
  BattleCatalog,
  BattleEncounter,
  CombatantDefinition,
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
    group: (table: string, key: string, value: string | number) => {
      if (int(String(value)) === 0) return [];
      const found = Object.values(source.tables[table] ?? {}).filter(
        (r) => r.values[key] === String(value),
      );
      if (!found.length)
        throw new Error(`Missing playable group ${table}.${key}=${value}`);
      return found;
    },
  };
  const conditions = compileBattleConditionCatalog(
    parameterReader,
    rows("condition.csv").map((r) => int(r.id)),
    name,
  ).catalog;
  const magitekCommand = compileBattleCommand(
    parameterReader,
    26,
    name,
  ).command;
  const itemCommand = compileBattleCommand(parameterReader, 3, name).command;
  if (itemCommand.kind !== "item")
    throw new Error("Unexpected source item command");
  if (itemCommand.kind === "item")
    for (const [key, expected] of Object.entries({
      command_type: 1,
      command_wait: 0,
      consume_type: 0,
      number_select: 1,
      release_type: 0,
      auto_execution_ability_id: 0,
    }))
      if (int(row("command.csv", itemCommand.id)[key]) !== expected)
        throw new Error(`Unimplemented item command ${key}`);
  const physicalLimits = compilePhysicalLimits(parameterReader).values;
  const noPhysicalTemporary = {
    attack: 0,
    strength: 0,
    accuracy: 0,
    criticalRate: 0,
  };
  const parameterLimits = compileParameterLimits(parameterReader).values;
  // Explicit opening-checkpoint inputs, NOT defaults for arbitrary characters,
  // earned growth, equipment abilities or status effects.
  const noTemporary: ParameterValues = {
    hp: 0,
    mp: 0,
    magic: 0,
    vitality: 0,
    attack: 0,
    defense: 0,
    magicDefense: 0,
    agility: 0,
    weight: 0,
    evasion: 0,
    magicEvasion: 0,
  };
  const abilities: BattleContent["abilities"] = {};
  // Initialization preserves locked/unused skills without admitting their
  // entire execution dependency graph into this development battle profile.
  for (const id of source.battleAbilityIds) {
    const a = row("ability.csv", id);
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
    abilities[id] = compileDevelopmentAbility(parameterReader, id, displayName);
  }
  const players: CombatantDefinition[] = source.initialParty.map((c) => {
    const r = row("character_status.csv", c.characterId);
    if (int(r.corps) !== 1)
      throw new Error("Physical profile requires front row");
    if (int(r.initial_condition_group))
      throw new Error("Unimplemented initial player conditions");
    for (let slot = 1; slot <= 6; slot++) {
      const equipment = row("content.csv", r[`content_id${slot}`]!);
      const item = row(
        equipment.type_id === "2" ? "weapon.csv" : "armor.csv",
        equipment.type_value!,
      );
      if (item.process_prog !== "None" || (slot >= 5 && item.type_id !== "2"))
        throw new Error("Unimplemented physical equipment provider");
      for (const key of [
        "wear_condition_group_id",
        "wear_function_group_id",
        "trigger_ability_id",
        ...(equipment.type_id === "2"
          ? [
              "attribute_group_id",
              "weak_attribute",
              "effective_species",
              "two_handed_flag",
              "back_flag",
            ]
          : ["resistance_species"]),
        equipment.type_id === "2"
          ? "additional_condition_group_id"
          : "resistance_condition",
      ])
        if (int(item[key]))
          throw new Error("Unimplemented equipment condition input");
    }
    const parameters = compilePlayerParameters(
      parameterReader,
      c.characterId,
      {
        additional: {
          hp: 0,
          mp: 0,
          magic: 0,
          vitality: 0,
          agility: 0,
          weight: 0,
        },
        correction: { magic: 0, vitality: 0, agility: 0 },
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
    const equipmentElements = compileEquipmentElements(
      parameterReader,
      Array.from({ length: 6 }, (_, n) => int(r[`content_id${n + 1}`])),
      1,
    );
    return {
      id: `player:${c.characterId}`,
      sourceId: c.characterId,
      name: name(r.mes_id_name!),
      side: "player",
      level: int(r.lv),
      // This checkpoint has no base/temporary element grants or resistance overrides.
      attackElements: equipmentElements.attackElements,
      elementResistances: equipmentElements.resistances,
      physical: compilePlayerPhysical(
        parameterReader,
        c.characterId,
        {
          selectedArm: 1,
          additionalStrength: 0,
          correctionStrength: 0,
          temporary: noPhysicalTemporary,
        },
        physicalLimits,
      ).confirmed,
      ...parameters,
      exp: int(r.exp),
      gil: 0,
      growthGroup: r.growth_curve_group_id!,
      abilities: source.magitekAbilityIds.filter((id) =>
        memberships.some((m) => int(m.ability_id) === id),
      ),
      commands: [
        magitekCommand.id,
        ...([1, 2, 3, 4, 5, 6].some(
          (n) => int(r[`command_id${n}`]) === itemCommand.id,
        )
          ? [itemCommand.id]
          : []),
      ],
      conditionIds: [],
      conditionResistances: {},
      ai: null,
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
      if (
        ["attack_attribute", "attack_plus", "attack_plus_grop"].some((k) =>
          int(r[k]),
        )
      )
        throw new Error("Unimplemented enemy physical modifier");
      if (int(r.resistance_condition))
        throw new Error("Unimplemented enemy resistance input");
      const parameters = compileEnemyParameters(
        parameterReader,
        e.monsterId,
        noTemporary,
        parameterLimits,
      ).confirmed;
      if (r.initial_condition !== "0")
        throw new Error("Unimplemented initial enemy conditions");
      const ai = compileBattleAI(e.ai.data, e.ai.source);
      return {
        id: `enemy:${e.slot}`,
        sourceId: e.monsterId,
        name: name(r.mes_id_name!),
        side: "enemy",
        level: int(r.lv),
        attackElements: [], // attack_attribute=0 was checked above.
        elementResistances: compileElementResistances(
          parameterReader,
          int(r.resistance_attribute),
        ).resistances,
        physical: compileEnemyPhysical(
          parameterReader,
          e.monsterId,
          noPhysicalTemporary,
          physicalLimits,
        ).confirmed,
        ...parameters,
        exp: int(r.exp),
        gil: int(r.gill),
        growthGroup: null,
        abilities: battleAIAbilities(ai),
        commands: [],
        conditionIds: [],
        conditionResistances: {},
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
    profile: "narshe-playability-v18",
    sourceContentHash: source.contentHash,
    fieldSourceSetHash: String(field.sourceSetHash),
    atb: source.atb,
    timing: { mode: "active", atbSpeed: 1 },
    reactions: source.reactions,
    initialAtb: {
      player: initialAtb("ACCUMULATION_ATB_NORMAL"),
      enemy: initialAtb("ENEMY_ACCUMULATION_ATB_NORMAL"),
    },
    players,
    abilities,
    commands: {
      [magitekCommand.id]: magitekCommand,
      [itemCommand.id]: itemCommand,
    },
    conditions,
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
      "已准入的数值分支、ATB、蓄力与时钟门控已按本版来源接入；即时/等待模式及技能、道具菜单已接入，时速固定为 1。固定 10 ms 推进与 400/900 ms 动作表现仍是临时策略，原生动态语义尚未验证。初始持有能力已来源绑定，活动战斗能力仍限受控子集，完整成长/学习未完成。",
      "初始数值使用分阶段属性确认；成长追加、Correction、临时与被动输入仍按开场检查点显式给零，未恢复通用状态/装备能力。",
      "当前开放三种射线和治愈原力，以及来源普通 HP/MP 恢复、玩家复活、解除沉默和普通毒的道具；道具目前限我方目标。普通毒的战斗周期、属性相性、地图步伤和解除已接入；开场 currentTransport 身份尚未恢复，不能从魔导装甲外观推断，有毒时移动仍明确阻塞，可先菜单解毒。特殊毒 row 88、其他活动状态、特殊道具、逃跑与完整战斗脚本仍阻塞。",
      "角色、库存、普通换装与奖励由共享状态保存，可在稳定地图检查点保存/读取。剧情普通物品授予/移除和部分收费指令已接入；特殊装备、掉落与商店尚未完成，开场没有额外发放测试药品或备用装备。",
      "站位、夹击队形、骑乘拼接和光束是临时二维表现；原版音效、特效、动画时序尚未接入。",
      "敌方行动使用来源 AI、独立回合与变量，连续行动整组入队。普通反击按命中结果触发并优先执行，保留原行动条；最终攻击、恢复专用反应、完整自动目标及特殊指令仍未接入，未知依赖会明确停止。",
    ],
  };
  const gameState = compileGameState(source, name);
  gameState.characterInitializations = Object.fromEntries(
    source.initialParty.map((p) => {
      const template = structuredClone(source.ownedInitializations[p.characterId]!);
      template.initial.name = name(template.nameKey);
      return [`player:${p.characterId}`, template];
    }),
  );
  gameState.fieldConditions = compileFieldConditionCatalog(
    parameterReader,
    conditions,
    rows("transportation.csv").map((r) => int(r.id)),
  ).catalog;
  const equipment = compileEquipmentCatalog(
    parameterReader,
    rows("content.csv")
      .filter((c) => ["2", "3"].includes(c.type_id!))
      .map((c) => int(c.id)),
    source.initialParty.map((p) => p.characterId),
    name,
    Object.fromEntries(
      source.initialParty.map((p) => [
        p.characterId,
        { hasTwoSwordStyle: false, hasTwoHand: false, equipAnyJob: false },
      ]),
    ),
  ).catalog;
  gameState.equipmentSystem = {
    catalog: equipment,
    contexts: Object.fromEntries(
      source.initialParty.map((p) => [
        `player:${p.characterId}`,
        compileEquipmentParameterContext(
          parameterReader,
          p.characterId,
          {
            additional: {
              hp: 0,
              mp: 0,
              magic: 0,
              vitality: 0,
              agility: 0,
              weight: 0,
            },
            correction: { magic: 0, vitality: 0, agility: 0 },
            temporary: noTemporary,
            passive: { hp: 0, mp: 0, magicEvasion: 0 },
            condition601: false,
            twoHandMultiplier: 1,
          },
          {
            additionalStrength: 0,
            correctionStrength: 0,
            temporary: noPhysicalTemporary,
          },
        ).context,
      ]),
    ),
    limits: { parameters: parameterLimits, physical: physicalLimits },
    growth,
  };
  const result = {
    kind: "narshe-battle-catalog" as const,
    common,
    encounters,
    gameState,
  };
  return { ...result, contentHash: hash(result) };
}
