import { compilePhysicalLimits } from "./physical-parameters.js";
import { hash, record } from "./content.js";
import { readSnapshot, snapshotFile } from "./integrity.js";
import { tableInteger as int, type SharedBattleSource } from "./battle.js";
import { compileParameterLimits } from "./parameters.js";
import type { ParameterValues } from "../core/parameters.js";
import { compileBattleAbilityContent } from "./battle-ability-content.js";
import { compileFieldAbilityCatalog } from "./field-abilities.js";
import { loadCorpus } from "./corpus.js";
import { bindSystemMessages } from "./system-messages.js";
import { compileBattleConditionCatalog } from "./conditions.js";
import { compileBattleCommand } from "./commands.js";
import { compileBattleAbilityCatalog } from "./battle-abilities.js";
import { compileBattleEncounterRuntime, type BattleEncounterRuntimeInput } from "./battle-encounter-runtime.js";
import { compileBattleRowCatalog } from "./battle-row.js";
import { compileBattleEventRules } from "./battle-event-context.js";
import { compileShopCatalog } from "./shop.js";
import { compilePlayerBattleDefinitions } from "./player-battle.js";
import { compileGameState, type GameStateSource } from "./game-state.js";
import type { GameStateContent } from "../core/game-state.js";
import type { NewGameDefinition } from "../core/new-game.js";
import { compileNewGame } from "./new-game.js";
import { createNewGame } from "../core/new-game.js";
import { compileFieldConditionCatalog } from "./field-conditions.js";
import { firstJoinLevelAdjustments } from "../core/character-growth.js";
import { compileEquipmentCatalog } from "./equipment.js";
import { createBattleHandoffMusicLookup } from "./battle-handoff.js";
import { loadSystemSource } from "./system-source.js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { compileMagicStoneCatalog } from "./magic-stones.js";
import { compileCharacterGrowth } from "./character-growth.js";
import type {
  BattleContent,
  BattleCatalog,
  CombatantDefinition,
} from "../core/battle-content.js";

/** Compiled capabilities are shared by independent entry composers. No
 * checkpoint state or development omission is part of this module boundary. */
export type GameCatalogModules = {
  common: Omit<BattleCatalog["common"], "players" | "limitations" | "drops">;
  owned: Pick<GameStateContent, "shops" | "characterInitializations" | "characterGrowth" |
    "partyActors" | "battleDefinitions" | "fieldConditions" | "fieldAbilities" | "magicStones"> & {
    sourceNewGame: NewGameDefinition;
    equipmentSystem: NonNullable<GameStateContent["equipmentSystem"]>;
  };
  ordinaryDefinitions: CombatantDefinition[];
  tables: GameStateSource["tables"];
  reader: Parameters<typeof compileBattleEncounterRuntime>[0];
  runtimeInput: Omit<BattleEncounterRuntimeInput, "development">;
  name(key: string): string;
};
export type GameCatalogEntry =
  | { kind: "source-new-game"; limitations: string[] }
  | { kind: "development-checkpoint"; players: CombatantDefinition[]; limitations: string[];
      development: BattleEncounterRuntimeInput["development"] };

/** The development compiler can describe known omissions, but a source
 * catalog cannot publish those encounters as admitted definitions. Preserve
 * the exact request/provenance/dependency record while tightening this lane. */
function sourceEncounterAdmission(runtime: ReturnType<typeof compileBattleEncounterRuntime>) {
  const diagnostics = runtime.diagnostics.map(diagnostic => diagnostic.kind === "development-omission"
    ? { ...diagnostic, kind: "blocked" as const,
      reason: "Source admission rejects development omission: " + diagnostic.reason }
    : diagnostic);
  const blocked = new Set(diagnostics.filter(diagnostic => diagnostic.kind === "blocked").map(diagnostic => diagnostic.partyId));
  const encounters = Object.fromEntries(Object.entries(runtime.encounters).filter(([id]) => !blocked.has(Number(id))));
  const entries = runtime.report.entries.map(entry => blocked.has(entry.partyId)
    ? { ...entry, status: "blocked" as const } : entry);
  const publishedMonsters = new Set(Object.values(encounters).flatMap(encounter =>
    Object.values(encounter.participants!.enemyDefinitions).map(definition => definition.sourceId)));
  const monsters = runtime.drops.monsters.filter(monster => publishedMonsters.has(monster.id));
  const contentIds = new Set(monsters.flatMap(monster => monster.slots.flatMap((slot, index) =>
    monster.rate > 0 && runtime.drops.weights[index]! > 0 && slot.contentId ? [slot.contentId] : [])));
  return { ...runtime, encounters, diagnostics,
    drops: { ...runtime.drops, monsters, contents: runtime.drops.contents.filter(content => contentIds.has(content.id)) },
    report: { ...runtime.report, entries, compiledDefinitions: Object.keys(encounters).length,
      blocked: entries.filter(entry => entry.status === "blocked").length, withDevelopmentOmissions: 0 },
  };
}

/** Source-bound tables/messages/media may be scoped differently. Retain their
 * original fingerprints; reading system messages does not execute a checkpoint. */
export async function compileGameCatalogModules(root: string, source: SharedBattleSource): Promise<GameCatalogModules> {
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
  // Explicit zero temporary inputs, NOT defaults for earned growth,
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
  const resolveAbilityName = (key: string) => {
      const found = [systemMessages[key], storyMessages[key]].filter((value): value is string => typeof value === "string");
      const uniqueValues = [...new Set(found)];
      return uniqueValues.length === 1 ? uniqueValues[0]! : null;
  };
  const abilityContent = compileBattleAbilityContent(parameterReader,
    Object.fromEntries(Object.keys(source.tables).map((table) => [table, rows(table)])), resolveAbilityName);
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
  // Source.tables is a selected capability closure and cannot establish that
  // an unselected music row is absent. Resolve optional handoff declarations
  // against the existing complete, verified source reader instead.
  const handoffSystem = await loadSystemSource(root, source.parentSourceSetHash);
  const [stoneReceipt, constructorC] = await Promise.all([
    readFile(resolve(root, "build/reports/v71-esper-native-complete/complete.json"), "utf8"),
    readFile(resolve(root, "build/reports/v71-esper-native-complete/856d80.c"), "utf8"),
  ]);
  const magicStones = compileMagicStoneCatalog(handoffSystem.reader, handoffSystem.tables, resolveAbilityName,
    { receipt: JSON.parse(stoneReceipt), constructorC, sourceSetHash: source.parentSourceSetHash }).catalog;
  // Menu-only function groups need the complete source tables. The selected
  // battle closure cannot establish their absence or grant field execution.
  // This named Web generator seed is an authored transaction policy, not an
  // original Unity random sequence or an initial character ability grant.
  const fieldAbilities = compileFieldAbilityCatalog(handoffSystem.reader, handoffSystem.tables,
    battleAbilities.commands, resolveAbilityName, {
      kind: "field-ability-rules-v1", profile: "source",
      random: { kind: "web-field-random-v1", seed: 0x71f6c0de },
    }).catalog;
  const reader: GameCatalogModules["reader"] = { ...parameterReader,
    matching: (table, key, value) => Object.values(source.tables[table] ?? {})
      .filter((r) => r.values[key] === String(value)),
    handoffMusic: createBattleHandoffMusicLookup(handoffSystem.tables, handoffSystem.reader),
  };
  const runtimeInput: GameCatalogModules["runtimeInput"] = {
    requestedPartyIds: source.encounterPartyIds, encounters: source.encounters,
    sourceDiagnostics: source.encounterDiagnostics, abilities, conditions, sprites: source.sprites, name,
    parameters: { temporary: noTemporary, limits: parameterLimits },
    physical: { temporary: noPhysicalTemporary, limits: physicalLimits },
  };
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
  const common: GameCatalogModules["common"] = {
    kind: "opening-battle-development",
    profile: "narshe-playability-v35",
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
    battleEvents: compileBattleEventRules(parameterReader, conditions.rules.definitions.map((row) => row.id)).rules,
    observedLearning: structuredClone(source.observedLearning),
    abilityContentIds,
    qualificationContext: {
      mode: "source", conditionContext: "current", battleType: 0,
      magicLearningValue: null, invalidContentIds: null, itemMenuAvailable: null,
    },
    reactions: source.reactions,
    initialAtb: {
      player: initialAtb("ACCUMULATION_ATB_NORMAL"),
      enemy: initialAtb("ENEMY_ACCUMULATION_ATB_NORMAL"),
    },
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
  };
  const tables = Object.fromEntries(Object.keys(source.tables).map((table) => [table, rows(table)]));
  const shops = compileShopCatalog(reader, tables, name);
  const characterInitializations = Object.fromEntries(
    Object.entries(source.ownedInitializations).map(([sourceId, value]) => {
      const template = structuredClone(value);
      template.initial.name = name(template.nameKey);
      return [`player:${sourceId}`, template];
    }),
  );
  const characterGrowth = Object.fromEntries(Object.entries(source.ownedInitializations).map(([sourceId, template]) => {
    const previous = source.characterGrowth[sourceId];
    if (!previous) throw new Error("Missing source ordinary growth template");
    const compiled = compileCharacterGrowth(handoffSystem.reader, handoffSystem.tables, template,
      previous.observedLearning, magicStones);
    return [`player:${sourceId}`, compiled.plan];
  }));
  const fieldConditions = compileFieldConditionCatalog(parameterReader, conditions,
    rows("transportation.csv").map((r) => int(r.id))).catalog;
  const equipment = compileEquipmentCatalog(
    parameterReader,
    rows("content.csv").filter((c) => ["2", "3"].includes(c.type_id!)).map((c) => int(c.id)),
    Object.values(source.ownedInitializations).map((t) => t.initial.sourceId), name,
    Object.fromEntries(Object.values(source.ownedInitializations).map((t) => [
      t.initial.sourceId, { hasTwoSwordStyle: t.equipmentCharacter.hasTwoSwordStyle,
        hasTwoHand: t.equipmentCharacter.hasTwoHand, equipAnyJob: t.equipmentCharacter.equipAnyJob },
    ])), source.ordinaryWeaponEffects.catalog,
  ).catalog;
  const newGame = compileNewGame(reader, tables, name, source.ordinaryWeaponEffects.catalog);
  const owned: GameCatalogModules["owned"] = {
    shops: shops.catalog, characterInitializations, characterGrowth,
    partyActors: structuredClone(source.partyActors),
    battleDefinitions: structuredClone(ordinary.definitions), fieldConditions, fieldAbilities, magicStones,
    sourceNewGame: newGame.definition,
    equipmentSystem: {
      catalog: equipment, initialStock: createNewGame(newGame.definition).owned.equipmentStock,
      contexts: Object.fromEntries(Object.values(source.ownedInitializations).map((t) => [
        `player:${t.initial.sourceId}`, structuredClone(t.parameterContext),
      ])),
      limits: { parameters: parameterLimits, physical: physicalLimits }, growth,
    },
  };
  return { common, owned, ordinaryDefinitions: ordinary.definitions, tables: source.tables,
    reader, runtimeInput, name };
}

/** Select initial owners once; potential templates never become additional
 * roster members. Only the explicit development entry can install a seed or
 * request an acknowledged lifecycle/flag omission. */
export function assembleGameCatalog(modules: GameCatalogModules, entry: GameCatalogEntry): BattleCatalog {
  if (entry.kind !== "source-new-game" && entry.kind !== "development-checkpoint")
    throw new Error("Unknown game catalog entry");
  const fresh = entry.kind === "source-new-game" ? createNewGame(modules.owned.sourceNewGame) : null;
  const players = entry.kind === "source-new-game" ? fresh!.owned.roster.map((member) => {
    const definition = modules.ordinaryDefinitions.find((candidate) => candidate.id === member.id &&
      candidate.sourceId === member.sourceId);
    if (!definition) throw new Error("Missing initial ordinary battle template: " + member.sourceId);
    return { ...structuredClone(definition), name: member.name, level: member.level, exp: member.exp,
      hp: member.hp, mp: member.mp, conditionIds: [...member.conditionIds] };
  }) : structuredClone(entry.players);
  const owners = players.map(({ id, sourceId }) => ({ id, sourceId }));
  for (const owner of owners)
    if (!modules.ordinaryDefinitions.some((definition) => definition.id === owner.id && definition.sourceId === owner.sourceId))
      throw new Error("Missing initial ordinary battle template: " + owner.sourceId);
  const gameState: GameStateContent = {
    ...compileGameState({ tables: modules.tables }, modules.name, { owners,
      ...(fresh ? { sourceNewGame: modules.owned.sourceNewGame } : {}) }),
    ...structuredClone(modules.owned),
  };
  gameState.rosterLifecycle.firstJoinLevelAdjustments = { ...firstJoinLevelAdjustments };
  if (entry.kind === "development-checkpoint")
    gameState.initialOwnedConditions = players.map((player) => ({ id: player.id, conditionIds: [...player.conditionIds] }));
  const compiled = compileBattleEncounterRuntime(modules.reader, { ...modules.runtimeInput,
    development: entry.kind === "development-checkpoint" ? entry.development : { scripts: [], flagGroups: [] } });
  const runtime = entry.kind === "source-new-game" ? sourceEncounterAdmission(compiled) : compiled;
  const result = {
    kind: "narshe-battle-catalog" as const,
    common: { ...modules.common, drops: runtime.drops, players, limitations: [...entry.limitations] },
    encounters: runtime.encounters, encounterDiagnostics: runtime.diagnostics, encounterReport: runtime.report,
    gameState,
  };
  return structuredClone({ ...result, contentHash: hash(result) });
}

/** The shared source build never reads, verifies or copies a field checkpoint.
 * It compiles actual reusable modules and then uses the source initializer. */
export async function compileSharedGameCatalog(root: string, source: SharedBattleSource): Promise<BattleCatalog> {
  const modules = await compileGameCatalogModules(root, source);
  return assembleGameCatalog(modules, { kind: "source-new-game", limitations: [
    "共享来源目录与来源新游戏入口；目录定义不授予角色、能力、装备或剧情可达性。",
    "初始名册、库存、装备与条件直接使用来源新游戏初始化；不装载纳尔谢开发检查点或跳过战斗脚本、旗标。",
    "已准入的玩法能力按公共系统执行；未知技能、条件、AI、地图或表现依赖保留阻塞，不代表完整游戏已迁移或原版一致性。",
    "固定临时参数、Web动作表现和现有成长子集仍有明确范围；来源静态定义不证明实际运行时提供器与故事旅程完整。",
  ] });
}
