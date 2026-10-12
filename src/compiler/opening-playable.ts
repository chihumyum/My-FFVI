import {
  compilePhysicalLimits,
  compileEnemyPhysical,
} from "./physical-parameters.js";
import { hash, record } from "./content.js";
import { readSnapshot, snapshotFile } from "./integrity.js";
import { tableInteger as int, type compileOpeningBattle } from "./battle.js";
import {
  compileEnemyParameters,
  compileParameterLimits,
} from "./parameters.js";
import type { ParameterValues } from "../core/parameters.js";
import { compileBattleAbilityContent } from "./battle-ability-content.js";
import { loadCorpus } from "./corpus.js";
import { bindSystemMessages } from "./system-messages.js";
import { compileBattleConditionCatalog } from "./conditions.js";
import { compileBattleCommand } from "./commands.js";
import { compileBattleAbilityCatalog } from "./battle-abilities.js";
import { compileBattleDropCatalog } from "./battle-rewards.js";
import { compileBattleRowCatalog } from "./battle-row.js";
import { compileShopCatalog } from "./shop.js";
import { compilePlayerBattleDefinitions } from "./player-battle.js";
import { compileBattleAI, battleAIAbilities } from "./battle-ai.js";
import { compileGameState } from "./game-state.js";
import { compileNewGame } from "./new-game.js";
import { createNewGame } from "../core/new-game.js";
import { compileFieldConditionCatalog } from "./field-conditions.js";
import { firstJoinLevelAdjustments } from "../core/character-growth.js";
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
  const battleAbilities = compileBattleAbilityCatalog(parameterReader,
    Object.fromEntries(Object.entries(source.tables).map(([key, values]) => [key, Object.values(values).map((r) => r.values)])),
    Object.values(source.ownedInitializations).map((t) => t.initial.sourceId)).catalog;
  const magitekCommand = compileBattleCommand(
    parameterReader,
    26,
    name,
  ).command;
  const itemCommand = compileBattleCommand(parameterReader, 3, name).command;
  const commands: BattleContent["commands"] = Object.fromEntries(battleAbilities.commands.map((c) => {
    const referenced = c.abilityId ? row("ability.csv", c.abilityId) : null;
    return [c.id, {
      id: c.id, name: c.nameKey === "None" ? `指令 #${c.id}` : name(c.nameKey),
      kind: c.executionType === 2 && c.listType === 1 && !c.abilityId ? "item" : "ability",
      abilityIds: c.abilityId ? [c.abilityId] : battleAbilities.abilities
        .filter((a) => a.groupId !== 0 && c.abilityTypes.includes(a.typeId)).map((a) => a.id),
      forbiddenConditionIds: [...c.forbiddenConditionIds],
      referencedAbility: referenced ? { id: c.abilityId, typeId: int(referenced.type_id), wait: int(referenced.ability_wait) } : null,
    }];
  }));
  // Bind these command definitions to their strict source compiler as well.
  // Membership and availability are projected from each current owned actor.
  commands[magitekCommand.id] = magitekCommand;
  commands[itemCommand.id] = itemCommand;
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
  const corpus = await loadCorpus(root);
  if (corpus.manifest.parentSourceSetHash !== source.parentSourceSetHash)
    throw new Error("Mismatched ability message sources");
  if (!Array.isArray(corpus.manifest.sources)) throw new Error("Missing ability message sources");
  const messageSources = corpus.manifest.sources.map((raw: unknown) => {
    const sourceFile = record(raw);
    if (typeof sourceFile.file !== "string" || typeof sourceFile.sha256 !== "string")
      throw new Error("Invalid ability message source identity");
    return { file: sourceFile.file, sha256: sourceFile.sha256 };
  });
  const systemMessages = bindSystemMessages(field, source.parentSourceSetHash, messageSources).messages;
  const storyMessages = record(corpus.messages.story_mes_zhc);
  const abilityContent = compileBattleAbilityContent(parameterReader,
    Object.fromEntries(Object.keys(source.tables).map((table) => [table, rows(table)])), (key) => {
      const found = [systemMessages[key], storyMessages[key]].filter((value): value is string => typeof value === "string");
      const uniqueValues = [...new Set(found)];
      return uniqueValues.length === 1 ? uniqueValues[0]! : null;
    });
  // Definitions describe executable capabilities, never acquisition. Commands
  // still use each actor's actual owned list and current source qualification.
  const { abilities, abilityContentIds } = abilityContent;
  const ordinary = compilePlayerBattleDefinitions({ ...parameterReader,
    matching: (table, key, value) => Object.values(source.tables[table] ?? {})
      .filter((r) => r.values[key] === String(value)),
  }, {
    tables: Object.fromEntries(Object.keys(source.tables).map((table) => [table, rows(table)])),
    initializations: source.ownedInitializations, characterMedia: source.characterMedia,
    ordinaryWeaponEffects: source.ordinaryWeaponEffects.catalog,
    sprites: source.sprites, name,
  });
  if (ordinary.blockers.length) throw new Error("Ordinary player template compilation failed: " + JSON.stringify(ordinary.blockers));
  if (source.battleAppearance.blockers.length)
    throw new Error("Battle appearance compilation failed: " + JSON.stringify(source.battleAppearance.blockers));
  for (const definition of ordinary.definitions) {
    const appearance = source.battleAppearance.actors[definition.sourceId];
    if (!appearance || appearance.sourceId !== definition.sourceId ||
        source.battleAppearance.catalog.conditions.find((row) => row.id === source.battleAppearance.catalog.conditionId)?.type !== 607)
      throw new Error("Missing source battle appearance binding: " + definition.sourceId);
    definition.appearance = structuredClone(appearance);
    definition.battleRequirements!.forbiddenConditionTypes =
      definition.battleRequirements!.forbiddenConditionTypes.filter((type) => type !== 607);
  }
  const checkpoint = source.entryProviders.ownedConditionCheckpoint;
  const checkpointIds = [...checkpoint.selectedSourceIds].sort((a, b) => a - b);
  const initialIds = source.initialParty.map((p) => p.characterId).sort((a, b) => a - b);
  if (checkpoint.scope !== "narshe-development-checkpoint-non-advertisement" ||
      checkpoint.target !== "selected-party" || checkpoint.conditionType !== 607 ||
      JSON.stringify(checkpointIds) !== JSON.stringify(initialIds) ||
      conditions.rules.definitions.find((d) => d.id === checkpoint.conditionId)?.type !== checkpoint.conditionType)
    throw new Error("Unbound owned condition checkpoint");
  const players: CombatantDefinition[] = source.initialParty.map((c) => {
    const definition = ordinary.definitions.find((p) => p.sourceId === c.characterId);
    if (!definition) throw new Error("Missing initial ordinary battle template");
    // A source-bound state at the existing development checkpoint. It is not
    // the AddFromMaster initial state or a replay of the skipped prelude.
    return { ...structuredClone(definition), conditionIds: [checkpoint.conditionId] };
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
        row: "front",
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
    profile: "narshe-playability-v34",
    sourceContentHash: source.contentHash,
    fieldSourceSetHash: String(field.sourceSetHash),
    atb: source.atb,
    timing: { mode: "active", speedIndex: 2 },
    battleAbilities,
    battleEntry: structuredClone(source.entryProviders.catalog),
    battleAppearance: structuredClone(source.battleAppearance.catalog),
    battleRows: compileBattleRowCatalog(parameterReader,
      Object.fromEntries(Object.entries(source.tables).map(([key, values]) =>
        [key, Object.values(values).map((r) => r.values)]))).catalog,
    abilityContentIds,
    qualificationContext: {
      mode: "source", conditionContext: "current", battleType: 0,
      magicLearningValue: null, invalidContentIds: null, itemMenuAvailable: null,
    },
    reactions: source.reactions,
    drops: (() => {
      const compiled = compileBattleDropCatalog({ ...parameterReader,
        matching: (table, key, value) => Object.values(source.tables[table] ?? {})
          .filter((r) => r.values[key] === String(value)),
      }, [...new Set(source.encounters.flatMap((encounter) => encounter.enemies.map((e) => e.monsterId)))]);
      if (compiled.blockers.length) throw new Error("Unresolved battle drops: " + JSON.stringify(compiled.blockers));
      return compiled.catalog;
    })(),
    initialAtb: {
      player: initialAtb("ACCUMULATION_ATB_NORMAL"),
      enemy: initialAtb("ENEMY_ACCUMULATION_ATB_NORMAL"),
    },
    players,
    abilities,
    commands,
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
      "战斗指令由当前持有能力、条件与来源入战资格动态投影；607魔导状态、装甲外观和剧情增删共用持有状态。开发检查点直接装载来源绑定的片头状态，尚未完整执行新游戏前导。未知地图/步行/兽原依赖仍阻塞。",
      "已准入的数值分支、ATB、蓄力与时钟门控已按本版来源接入；即时/等待模式及技能、道具菜单已接入，时速固定为 1。固定 10 ms 推进与 400/900 ms 动作表现仍是临时策略，原生动态语义尚未验证。初始持有能力已来源绑定，活动战斗能力仍限受控子集，完整成长/学习未完成。",
      "初始数值使用分阶段属性确认；来源追加经验、普通成长和自然等级学习已接入共享持有状态。特殊学习、魔石、Correction、临时与被动提供器仍未完整恢复，新持有角色的战斗动作独立准入。",
      "普通前后排伤害、加速/减速及普通商店买卖已接入。战斗换列、远程与双持装备、特殊商店和完整菜单仍待迁移。",
      "当前开放三种射线和治愈原力，以及来源普通 HP/MP 恢复、玩家复活、解除沉默和普通毒的道具；道具目前限我方目标。普通毒的战斗周期、属性相性、地图步伤和解除已接入；开场 currentTransport=6 由来源初始化与前导脚本闭合，该交通跳过普通步伤。完整上下车、特殊毒 row 88、其他活动状态、特殊道具、逃跑与完整战斗脚本仍阻塞。",
      "角色、库存、普通换装与奖励由共享状态保存，可在稳定地图检查点保存/读取。剧情普通物品授予/移除和部分收费指令已接入；普通死亡顺序掉落、两种 MP 饰品及被动持有已贯通；其他特殊装备、奖励与脚本商店尚未完成，开场没有额外发放测试药品或备用装备。",
      "魔导装甲的默认/死亡/濒死姿态使用来源别名、UV和像素偏移；站位、夹击队形、动作与光束仍为临时二维表现，原版音效、特效与完整动画时序尚未接入。",
      "敌方行动使用来源 AI、独立回合与变量，连续行动整组入队。普通反击按命中结果触发并优先执行，保留原行动条；最终攻击、恢复专用反应、完整自动目标及特殊指令仍未接入，未知依赖会明确停止。",
    ],
  };
  const gameState = compileGameState(source, name);
  const shops = compileShopCatalog({ ...parameterReader,
    matching: (table, key, value) => Object.values(source.tables[table] ?? {})
      .filter((r) => r.values[key] === String(value)),
  }, Object.fromEntries(Object.entries(source.tables).map(([key, values]) =>
    [key, Object.values(values).map((r) => r.values)])), name);
  gameState.shops = shops.catalog;
  gameState.characterInitializations = Object.fromEntries(
    Object.entries(source.ownedInitializations).map(([sourceId, value]) => {
      const template = structuredClone(value);
      template.initial.name = name(template.nameKey);
      return [`player:${sourceId}`, template];
    }),
  );
  gameState.characterGrowth = Object.fromEntries(Object.entries(source.characterGrowth)
    .map(([sourceId, plan]) => [`player:${sourceId}`, structuredClone(plan)]));
  gameState.rosterLifecycle.firstJoinLevelAdjustments = { ...firstJoinLevelAdjustments };
  gameState.partyActors = structuredClone(source.partyActors);
  gameState.battleDefinitions = structuredClone(ordinary.definitions);
  gameState.initialOwnedConditions = players.map((p) => ({ id: p.id, conditionIds: [...p.conditionIds] }));
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
    Object.values(source.ownedInitializations).map((t) => t.initial.sourceId),
    name,
    Object.fromEntries(
      Object.values(source.ownedInitializations).map((t) => [
        t.initial.sourceId,
        { hasTwoSwordStyle: t.equipmentCharacter.hasTwoSwordStyle,
          hasTwoHand: t.equipmentCharacter.hasTwoHand,
          equipAnyJob: t.equipmentCharacter.equipAnyJob },
      ]),
    ),
    source.ordinaryWeaponEffects.catalog,
  ).catalog;
  const newGame = compileNewGame({ ...parameterReader,
    matching: (table, key, value) => Object.values(source.tables[table] ?? {})
      .filter((r) => r.values[key] === String(value)),
  }, Object.fromEntries(Object.entries(source.tables).map(([key, values]) =>
    [key, Object.values(values).map((r) => r.values)])), name, source.ordinaryWeaponEffects.catalog);
  gameState.sourceNewGame = newGame.definition;
  gameState.equipmentSystem = {
    catalog: equipment,
    initialStock: createNewGame(newGame.definition).owned.equipmentStock,
    contexts: Object.fromEntries(
      Object.values(source.ownedInitializations).map((t) => [
        `player:${t.initial.sourceId}`,
        structuredClone(t.parameterContext),
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
