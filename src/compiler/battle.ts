import { createHash } from "node:crypto";
import { z } from "zod";
import { ImportedProject } from "../contracts.js";
import { hash } from "./content.js";
import { readSnapshot, snapshotFile } from "./integrity.js";
import type { AtbRules } from "../core/atb.js";
import { tableInteger } from "./table.js";
import { physicalLimitKeys } from "./physical-parameters.js";
import { parameterLimitKeys } from "./parameters.js";
import { compileConditionCatalog } from "./conditions.js";
import { compileOwnedCharacterInitialization } from "./owned-character.js";
import type { OwnedCharacterInitializationTemplate } from "../core/owned-character.js";
import { compileCharacterGrowth } from "./character-growth.js";
import { compileObservedLearning } from "./character-learning.js";
import type { CharacterGrowthPlan } from "../core/character-growth.js";
import { compilePartyActorCatalog } from "./party-actors.js";
import { compileTransportationCatalog } from "./transportation.js";
import { compileBattleSourceEntry } from "./battle-source-entry.js";
import { compileBattleAppearance } from "./battle-appearance.js";
import { compileAbilityProgram } from "./ability.js";
import { compileEquipmentAbilityCost } from "./ability-cost.js";
import { compileBattleRowCatalog } from "./battle-row.js";
import { compileBattleEventRules } from "./battle-event-context.js";
import { compileShopCatalog } from "./shop.js";
import { compileOrdinaryWeaponEffects } from "./ordinary-weapon.js";
import { loadCorpus } from "./corpus.js";
import { compileBattleEncounterSources } from "./battle-encounters.js";
import {
  compileAttackElements,
  compileElementResistances,
} from "./elements.js";
export { tableInteger } from "./table.js";

const Source = z.object({
  file: z.string(),
  assetPath: z.string(),
  objectId: z.string().regex(/^-?\d+$/),
  serializedFile: z.string(),
});
const Asset = z.object({ source: Source, data: z.unknown() });
const Sprite = z.object({
  source: Source,
  name: z.string(),
  file: z.string(),
  sha256: z.string().length(64),
  representation: z.literal("source-texture-full-rect"),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  pivot: z.tuple([z.number(), z.number()]),
  pixelsPerUnit: z.number().finite().positive(),
  textureWrap: z.tuple([z.number().int().min(0).max(3), z.number().int().min(0).max(3)]),
  filterMode: z.number().int().min(0).max(2),
});
const SourceFile = z.object({
  file: z.string(),
  sha256: z.string(),
  bytes: z.number().int(),
});
const MediaMasterIds = z.array(z.number().int().positive().max(0x7fffffff)).superRefine((ids, context) => {
  if (ids.some((id, index) => index > 0 && id <= ids[index - 1]!))
    context.addIssue({ code: "custom", message: "Media master identities must be unique and strictly sorted" });
});
const MediaScope = z.object({ mode: z.enum(["all", "encounters"]), masterIds: MediaMasterIds }).strict();
const MediaSelection = z.object({
  kind: z.literal("media-selection-v1"), monsters: MediaScope, backgrounds: MediaScope,
}).strict();
const Export = z.object({
  formatVersion: z.literal(1),
  adapterVersion: z.enum(["battle-0.3.0", "battle-0.4.0"]),
  characterIds: z.array(z.number().int().positive()),
  parentSourceSetHash: z.string(),
  sourceSetHash: z.string(),
  encounterPartyIds: z.array(z.number().int().positive()),
  sources: z.array(SourceFile),
  assets: z.record(z.string(), Asset),
  sprites: z.record(z.string(), Sprite),
  tableSources: z.record(z.string(), Source),
  mediaSelection: MediaSelection.optional(),
}).superRefine((value, context) => {
  if (value.adapterVersion === "battle-0.3.0" && Object.hasOwn(value, "mediaSelection") ||
      value.adapterVersion === "battle-0.4.0" && value.mediaSelection === undefined)
    context.addIssue({ code: "custom", message: "Battle media selection does not match its adapter version" });
  if (value.mediaSelection && value.mediaSelection.monsters.mode !== "all" && value.mediaSelection.backgrounds.mode !== "all")
    context.addIssue({ code: "custom", message: "Expanded battle media requires an explicit all-master scope" });
});
const Tables = z.record(z.string(), z.array(z.record(z.string(), z.string())));
type Tables = z.infer<typeof Tables>;
type Row = Tables[string][number];
type Source = z.infer<typeof Source>;
export type BattleRow = {
  values: Row;
  source: Source & { rowId: string };
};

/** Verify the media declaration against complete source tables and actual
 * exported sprite references. No encounter, owned character or AI is admitted
 * here. The v0.3 path has no new selection fields or table requirements. */
export function validateBattleMediaSelection(raw: unknown, rawTables: unknown): void {
  const battle = Export.parse(raw), selection = battle.mediaSelection;
  if (selection === undefined) return;
  const tables = Tables.parse(rawTables), indices = new Map<string, Map<number, Row>>();
  const sourceIdentity = (value: string | undefined, label: string): number => {
    let id: number;
    try { id = tableInteger(value); }
    catch { throw new Error("Invalid media source identity: " + label); }
    if (id <= 0 || id > 0x7fffffff || value !== String(id))
      throw new Error("Invalid media source identity: " + label);
    return id;
  };
  const boundSource = (source: Source | undefined, label: string) => {
    if (!source || !source.file || !source.serializedFile ||
        !/^-?(0|[1-9]\d*)$/.test(source.objectId) || BigInt(source.objectId) === 0n ||
        BigInt(source.objectId) < -0x8000000000000000n || BigInt(source.objectId) > 0x7fffffffffffffffn)
      throw new Error("Invalid battle media source reference: " + label);
    const files = battle.sources.filter(file => file.file === source.file || file.file.endsWith("/" + source.file));
    if (files.length !== 1) throw new Error("Unbound battle media source reference: " + label);
    return files[0]!;
  };
  const index = (table: string): Map<number, Row> => {
    const existing = indices.get(table);
    if (existing) return existing;
    const source = battle.tableSources[table];
    boundSource(source, table);
    if (!source!.assetPath.endsWith("/" + table)) throw new Error("Changed battle media table source: " + table);
    const rows = tables[table];
    if (!rows) throw new Error("Missing battle media source table: " + table);
    const result = new Map<number, Row>();
    for (const row of rows) {
      const id = sourceIdentity(row.id, table);
      if (result.has(id)) throw new Error("Duplicate battle media source identity: " + table + ":" + id);
      result.set(id, row);
    }
    indices.set(table, result);
    return result;
  };
  const row = (table: string, id: number): Row => {
    const found = index(table).get(id);
    if (!found) throw new Error("Unresolved battle media source row: " + table + ":" + id);
    return found;
  };
  if (new Set(battle.encounterPartyIds).size !== battle.encounterPartyIds.length)
    throw new Error("Duplicate battle media encounter selection");
  const parties = battle.encounterPartyIds.map(id => row("monster_party.csv", id));
  const memberIds = new Set<number>(), backgroundIds = new Set<number>();
  for (const party of parties) {
    for (let slot = 1; slot <= 9; slot++) {
      const value = party[`monster${slot}`];
      if (value !== "0") memberIds.add(sourceIdentity(value, "monster_party.csv.monster" + slot));
    }
    backgroundIds.add(sourceIdentity(party.battle_background_asset_id, "monster_party.csv.background"));
  }
  const scope = (value: z.infer<typeof MediaScope>, table: string, referenced: Set<number>): Row[] => {
    for (const id of referenced) row(table, id);
    const expected = [...(value.mode === "all" ? index(table).keys() : referenced)].sort((a, b) => a - b);
    if (!expected.length || JSON.stringify(expected) !== JSON.stringify(value.masterIds))
      throw new Error("Battle media selection disagrees with source masters: " + table);
    return value.masterIds.map(id => row(table, id));
  };
  const sprite = (suffix: string, group: string): void => {
    if (!group || !/^[a-zA-Z0-9_]+$/.test(group)) throw new Error("Invalid battle media bundle group");
    const matches = Object.entries(battle.sprites).filter(([path]) => path.toLowerCase().endsWith(suffix.toLowerCase()));
    if (matches.length !== 1) throw new Error("Unresolved selected battle media sprite: " + suffix);
    const [path, value] = matches[0]!, file = boundSource(value.source, path);
    const bundleName = file.file.split("/").at(-1)!.toLowerCase();
    if (value.source.assetPath !== path || !bundleName.startsWith(group.toLowerCase() + "_assets_all_") ||
        !bundleName.endsWith(".bundle") || value.file !== "sprites/" + value.sha256 + ".png")
      throw new Error("Changed selected battle media source binding: " + path);
  };
  for (const monster of scope(selection.monsters, "monster.csv", memberIds)) {
    const asset = row("monster_asset.csv", sourceIdentity(monster.monster_asset_id, "monster.csv.monster_asset_id"));
    if (!asset.asset_name || !/^[a-zA-Z0-9_]+$/.test(asset.asset_name))
      throw new Error("Invalid monster media asset name");
    sprite("/" + asset.group_name + "_" + asset.asset_name + ".png", asset.group_name!);
  }
  for (const background of scope(selection.backgrounds, "battle_background_asset.csv", backgroundIds))
    sprite("/" + background.asset_name + ".png", background.asset_name!);
}

/** Identity, never array position or first-match, selects a source row. */
export function battleTableIndex(
  tables: Tables,
  sources: Record<string, Source>,
) {
  const selected: Record<string, Record<string, BattleRow>> = {};
  const indices: Record<string, Map<string, Row>> = {};
  const index = (name: string) => {
    if (indices[name]) return indices[name]!;
    const rows = tables[name];
    if (!rows) throw new Error("Missing source table: " + name);
    const byId = new Map<string, Row>();
    for (const row of rows) {
      const id = String(tableInteger(row.id));
      if (byId.has(id)) throw new Error(`Duplicate row ${name}:${row.id}`);
      byId.set(id, row);
    }
    indices[name] = byId;
    return byId;
  };
  const row = (name: string, id: string | number): BattleRow => {
    const identity = String(tableInteger(String(id)));
    const values = index(name).get(identity),
      source = sources[name];
    if (!values || !source)
      throw new Error(`Unresolved table row ${name}:${id}`);
    const result = { values, source: { ...source, rowId: values.id! } };
    (selected[name] ??= {})[identity] = result;
    return result;
  };
  const matching = (
    name: string,
    key: string,
    value: string | number,
  ): BattleRow[] =>
    [...index(name).values()]
      .filter((r) => r[key]?.trim() === String(value).trim())
      .map((r) => row(name, r.id!));
  const unique = (
    name: string,
    key: string,
    value: string | number,
  ): BattleRow => {
    const found = matching(name, key, value);
    if (found.length !== 1)
      throw new Error(`Ambiguous table lookup ${name}.${key}=${value}`);
    return found[0]!;
  };
  const group = (
    name: string,
    key: string,
    value: string | number,
  ): BattleRow[] => {
    const id = tableInteger(String(value));
    if (id === 0) return [];
    const found = matching(name, key, id);
    if (!found.length)
      throw new Error(`Unresolved table group ${name}.${key}=${value}`);
    return found;
  };
  return { row, matching, unique, group, selected };
}

/** Shared source definitions; no checkpoint state or development omissions. */
export async function compileSharedBattleSource(root: string) {
  const { result } = await compileSourceData(root, false);
  return { ...result, contentHash: hash(result) };
}

export type SharedBattleSource = Awaited<ReturnType<typeof compileSharedBattleSource>>;

/** Compatibility adapter for the existing, explicitly seeded opening profile.
 * The checkpoint remains mandatory, including in this function's return type. */
export async function compileOpeningBattle(root: string) {
  const { result, checkpoint } = await compileSourceData(root, true);
  if (!checkpoint) throw new Error("Missing development owned-condition checkpoint");
  const legacy = { ...result, entryProviders: {
    ...result.entryProviders, ownedConditionCheckpoint: checkpoint,
  } };
  return { ...legacy, contentHash: hash(legacy) };
}

/** Keep selection, source closure and diagnostics identical in both paths.
 * Only the compatibility path requests the separate checkpoint proof. */
async function compileSourceData(root: string, includeCheckpoint: boolean) {
  const base = await readSnapshot(root + "/build/import");
  const extra = await readSnapshot(root + "/build/battle");
  const project = ImportedProject.parse(
    JSON.parse(snapshotFile(base, "project.json").toString()),
  );
  const battle = Export.parse(
    JSON.parse(snapshotFile(extra, "battle.json").toString()),
  );
  if (
    hash(project.sources) !== project.sourceSetHash ||
    hash(battle.sources) !== battle.sourceSetHash ||
    battle.parentSourceSetHash !== project.sourceSetHash
  )
    throw new Error("Battle source manifest mismatch");
  if (new Set(battle.sources.map((s) => s.file)).size !== battle.sources.length)
    throw new Error("Duplicate battle source file");
  for (const src of project.sources)
    if (
      !battle.sources.some(
        (s) =>
          s.file === src.file &&
          s.sha256 === src.sha256 &&
          s.bytes === src.bytes,
      )
    )
      throw new Error("Battle sources dropped a parent dependency");
  const native = project.sources.find((s) => s.file === "GameAssembly.dll");
  if (
    native?.sha256 !==
    "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc"
  )
    throw new Error("Unreviewed native battle profile");
  if (
    !project.sources.some(
      (s) =>
        s.file.endsWith("/Metadata/global-metadata.dat") &&
        s.sha256 ===
          "9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45",
    )
  )
    throw new Error("Unreviewed battle metadata profile");
  const checkRef = (source: Source) => {
    if (
      battle.sources.filter(
        (s) => s.file === source.file || s.file.endsWith("/" + source.file),
      ).length !== 1
    )
      throw new Error("Unbound battle source reference: " + source.file);
  };
  for (const source of Object.values(battle.tableSources)) checkRef(source);
  for (const asset of Object.values(battle.assets)) checkRef(asset.source);
  for (const sprite of Object.values(battle.sprites)) {
    checkRef(sprite.source);
    if (
      createHash("sha256")
        .update(snapshotFile(extra, sprite.file))
        .digest("hex") !== sprite.sha256
    )
      throw new Error("Battle sprite digest mismatch");
  }
  const tables = Tables.parse(
    JSON.parse(snapshotFile(base, "tables.json").toString()),
  );
  validateBattleMediaSelection(battle, tables);
  const {
    row,
    group: tableGroup,
    matching,
    unique,
    selected,
  } = battleTableIndex(tables, battle.tableSources);
  const json = (name: string) => {
    const assets = Object.values(battle.assets).filter((a) =>
      a.source.assetPath.endsWith("/" + name + ".json"),
    );
    if (assets.length !== 1) throw new Error("Unresolved battle JSON: " + name);
    const asset = assets[0]!;
    const file = battle.sources.find(
      (s) =>
        s.file === asset.source.file ||
        s.file.endsWith("/" + asset.source.file),
    )!;
    return {
      ...asset,
      source: {
        ...asset.source,
        sha256: file.sha256,
        sourceSetHash: battle.parentSourceSetHash,
        battleSourceSetHash: battle.sourceSetHash,
      },
    };
  };
  const spritePath = (suffix: string) => {
    const paths = Object.keys(battle.sprites).filter((p) =>
      p.toLowerCase().endsWith(suffix.toLowerCase()),
    );
    if (paths.length !== 1)
      throw new Error("Unresolved battle sprite: " + suffix);
    return paths[0]!;
  };
  const encounterSources = compileBattleEncounterSources({ row, group: tableGroup }, {
    partyIds: battle.encounterPartyIds, json, spritePath,
  });
  const encounters = encounterSources.encounters;
  const initialParty = tables["initialize_data.csv"]!.filter((r) =>
    /^INIT_PARTY_\d+$/.test(r.key_name!),
  )
    .sort(
      (a, b) =>
        Number(a.key_name!.split("_").at(-1)) -
        Number(b.key_name!.split("_").at(-1)),
    )
    .map((r) => {
      row("initialize_data.csv", r.id!);
      const character = row("character_status.csv", r.value1!);
      const asset = row(
        "character_asset.csv",
        character.values.character_asset_id!,
      );
      if (
        !Object.keys(battle.sprites).some((p) =>
          p
            .toLowerCase()
            .includes(`/${asset.values.asset_name?.toLowerCase()}/`),
        )
      )
        throw new Error("Unresolved initial character sprites");
      return {
        slot: Number(r.key_name!.split("_").at(-1)),
        characterId: tableInteger(character.values.id),
        spriteGroup: asset.values.asset_name!,
      };
    });
  if (
    !initialParty.length ||
    new Set(initialParty.map((c) => c.slot)).size !== initialParty.length
  )
    throw new Error("Missing or ambiguous initial party slots");
  if (new Set(battle.characterIds).size !== battle.characterIds.length ||
      initialParty.some((c) => !battle.characterIds.includes(c.characterId)))
    throw new Error("Invalid battle character media scope");
  const characterMedia = Object.fromEntries(battle.characterIds.map((id) => {
    const character = row("character_status.csv", id);
    const asset = row("character_asset.csv", character.values.character_asset_id!);
    const spriteGroup = asset.values.asset_name!;
    if (!Object.keys(battle.sprites).some((p) =>
      p.toLowerCase().includes(`/${spriteGroup.toLowerCase()}/`)))
      throw new Error("Unresolved selected character media: " + id);
    return [id, { characterId: id, spriteGroup, source: asset.source }];
  }));
  const command = row("command.csv", 26);
  row("command.csv", 3);
  // A shared condition library, not proof that every behavior is executable.
  compileConditionCatalog(
    { row, group: tableGroup },
    tables["condition.csv"]!.map((r) => tableInteger(r.id)),
  );
  compileBattleEventRules({ row }, tables["condition.csv"]!.map((r) => tableInteger(r.id)));
  for (const condition of tables["condition.csv"]!) {
    const soundId = tableInteger(condition.field_se_asset_id);
    if (soundId > 0) row("se_asset.csv", soundId);
    if (tableInteger(condition.condition_type) === 9 && tableInteger(condition.battle_effect_asset_id) > 0) {
      const effect = row("battle_effect_asset.csv", condition.battle_effect_asset_id!);
      for (const key of ["se_asset_id", "se_asset_id_2", "critical_se_asset_id"]) {
        const id = tableInteger(effect.values[key]);
        if (id > 0) row("se_asset.csv", id);
      }
    }
  }
  for (const condition of tables["condition_group.csv"]!)
    row("condition_group.csv", condition.id!);
  const magitek = tableGroup(
    "ability.csv",
    "ability_group_id",
    command.values.ability_group_id!,
  );
  if (!magitek.length) throw new Error("Missing Magitek source group");
  const abilityIds = new Set(magitek.map((a) => tableInteger(a.values.id)));
  // References were resolved per party, so a missing Act/CounterAct/LoopAct
  // dependency cannot turn one blocked descriptor into a failed whole batch.
  for (const enemy of encounters.flatMap((e) => e.enemies))
    for (const id of enemy.aiAbilityIds) abilityIds.add(id);
  for (const id of [...abilityIds].sort((a, b) => a - b)) {
    const ability = row("ability.csv", id);
    compileAttackElements(
      { row, group: tableGroup },
      tableInteger(ability.values.attribute_id),
      tableInteger(ability.values.attribute_group_id),
    );
    tableGroup(
      "content_flag_group.csv",
      "group_id",
      ability.values.content_flag_group_id!,
    );
    const group = row(
      "function_group.csv",
      ability.values.battle_function_group_id!,
    );
    for (const [key, value] of Object.entries(group.values))
      if (/^function\d+_id$/.test(key) && tableInteger(value))
        row("function.csv", value);
    for (const content of tables["content.csv"]!)
      if (content.type_id === "4" && content.type_value === String(id))
        row("content.csv", content.id!);
  }
  // The opening encounter list is a regression selection, not an execution
  // dictionary. Preserve the complete ability reference closure so later
  // learned skills use the same compiler without expanding scene templates.
  for (const ability of tables["ability.csv"]!)
    compileAbilityProgram({ row, group: tableGroup }, tableInteger(ability.id));
  for (const content of tables["content.csv"]!)
    if (tableInteger(content.type_id) === 4) row("content.csv", content.id!);
  for (const c of initialParty) {
    const status = row("character_status.csv", c.characterId);
    const memberships = tableGroup(
      "ability_random_group.csv",
      "group_id",
      status.values.ability_random_group_id!,
    );
    // Keep all source memberships; this is not an unlocked-ability list.
    for (const member of memberships) tableInteger(member.values.ability_id);
    for (let slot = 1; slot <= 6; slot++) {
      const content = row("content.csv", status.values[`content_id${slot}`]!);
      const table = { "2": "weapon.csv", "3": "armor.csv" }[
        content.values.type_id!
      ];
      if (!table) throw new Error("Unsupported opening equipment type");
      const item = row(table, content.values.type_value!);
      if (table === "armor.csv")
        compileElementResistances(
          { row, group: tableGroup },
          tableInteger(item.values.resistance_attribute),
        );
      else
        compileAttackElements(
          { row, group: tableGroup },
          tableInteger(item.values.attribute_id),
          tableInteger(item.values.attribute_group_id),
        );
    }
    tableGroup(
      "growth_curve.csv",
      "group_id",
      status.values.growth_curve_group_id!,
    );
  }
  tableGroup("exp_table.csv", "group_id", 1);
  // Job ownership and the source experience provider are shared lifecycle
  // inputs, independent from the current battle's visible commands.
  for (const value of tables["job.csv"]!) row("job.csv", value.id!);
  for (const value of tables["intermediate_growth_curve.csv"]!.filter((r) =>
    initialParty.some((p) => p.characterId === tableInteger(r.character_id)),
  )) {
    row("intermediate_growth_curve.csv", value.id!);
    tableGroup("exp_table.csv", "group_id", value.exp_table_group_id!);
  }
  // Equipment is shared inventory content, not a list of scene-specific swaps.
  // Preserve all source identities and the eligibility/element dependencies;
  // executable effects are admitted separately by the equipment compiler.
  for (const value of tables["content.csv"]!.filter((r) =>
    ["2", "3"].includes(r.type_id!),
  )) {
    row("content.csv", value.id!);
    const kind = value.type_id === "2" ? "weapon.csv" : "armor.csv";
    const item = row(kind, value.type_value!);
    row("parts_group.csv", item.values.parts_group_id!);
    row("job_group.csv", item.values.equip_job_group_id!);
    if (kind === "weapon.csv")
      compileAttackElements(
        { row, group: tableGroup },
        tableInteger(item.values.attribute_id),
        tableInteger(item.values.attribute_group_id),
      );
    else
      compileElementResistances(
        { row, group: tableGroup },
        tableInteger(item.values.resistance_attribute),
      );
  }
  unique("initialize_data.csv", "key_name", "INIT_GIL");
  // Field status monitors dispatch on the current transport's source type.
  // A mounted sprite alone cannot supply this identity.
  for (const value of tables["transportation.csv"] ?? [])
    row("transportation.csv", value.id!);
  for (const value of tables["initialize_data.csv"]!.filter((r) =>
    /^INIT_CORPS_[1-4]$|^INT_JOB_[1-6]$/.test(r.key_name!),
  ))
    row("initialize_data.csv", value.id!);
  for (const value of tables["initialize_data.csv"]!.filter((r) =>
    /^INIT_ITEM_\d+$/.test(r.key_name!),
  )) {
    if (!/^INIT_ITEM_[1-5]$/.test(value.key_name!))
      throw new Error("Unreviewed initial item slot");
    row("initialize_data.csv", value.id!);
  }
  // Preserve content identity separately from the item table's identity. Other
  // content kinds (equipment stock, learned magic, magic stones) are not item stacks.
  for (const value of tables["content.csv"]!.filter((r) => r.type_id === "1")) {
    row("content.csv", value.id!);
    const item = row("item.csv", value.type_value!);
    for (const context of ["menu", "battle"]) {
      const id = tableInteger(item.values[`${context}_function_group_id`]);
      if (!id) continue;
      const group = row("function_group.csv", id);
      for (let slot = 1; slot <= 3; slot++) {
        const fn = tableInteger(group.values[`function${slot}_id`]);
        if (fn) row("function.csv", fn);
      }
    }
  }
  for (const key of ["MAX_GIL", "MAX_ITEM", "MAX_EXP", "MAX_LV"])
    unique("game_constant_int.csv", "key_name", key);
  // Retain the full shared row/ordinary-shop dependency closure. Localization
  // is resolved in the playable compiler; row identities remain provenance-bound.
  compileBattleRowCatalog({ row }, tables);
  const shops = compileShopCatalog({ row, matching, unique }, tables, (key) => key);
  for (let slot = 1; slot <= 8; slot++)
    unique("game_constant_int.csv", "key_name", `MONSTER_DROP_RATE_${slot}`);
  // Retain the complete wear-function -> owned passive -> menu-function chain,
  // independently of the executable battle ability dictionary.
  for (const id of [304, 305]) compileEquipmentAbilityCost({ row }, id);
  unique("game_constant_int.csv", "key_name", "ACCUMULATION_ATB_NORMAL");
  unique("game_constant_int.csv", "key_name", "ENEMY_ACCUMULATION_ATB_NORMAL");
  unique("game_constant_int.csv", "key_name", "RATE_HAVE_NEAR_DEATH");
  for (const key of [
    ...Object.values(parameterLimitKeys),
    ...Object.values(physicalLimitKeys),
  ])
    unique("game_constant_int.csv", "key_name", key);
  const constant = (key: string) =>
    tableInteger(
      unique("game_constant_int.csv", "key_name", key).values.value1,
    );
  const atb: AtbRules = {
    coefficient: constant("ATP_COEFFICIENT"),
    enemyCoefficient: constant("ENEMY_ATP_COEFFICIENT"),
    total: constant("ATB_TOTAL_AMOUNT"),
    maxHighSpeed: constant("MAX_HIGH_SPEED"),
    maxLowSpeed: constant("MAX_LOW_SPEED"),
  };
  const reactionSource = json("serial_misc_assets");
  const extraSource = json("battle_extra_data");
  const ordinaryWeaponEffects = {
    ...compileOrdinaryWeaponEffects({ row }, extraSource.data),
    source: extraSource.source,
  };
  const misc = z.record(z.string(), z.unknown()).parse(reactionSource.data);
  const observedLearning = compileObservedLearning({ row }, tables, {
    exchange_learning_ability: z.array(z.object({
      before_ability_id: z.number().int(), after_ability_id: z.number().int(),
    }).strict()).parse(misc.exchange_learning_ability),
  }).catalog;
  const excluded = misc.not_counter_ability_id;
  if (
    !Array.isArray(excluded) ||
    excluded.some((id) => !Number.isInteger(id) || Number(id) <= 0) ||
    new Set(excluded).size !== excluded.length
  )
    throw new Error("Invalid source counter exclusions");
  // Adopt CounterMiscInfo .ctor 0xb1ee50's default of one for this single-result
  // development host. The asset omits a count; effective Unity deserialization
  // is not dynamically verified. An override needs a reviewed host contract.
  if ("counter_misc_info" in misc)
    throw new Error("Unreviewed counter count override");
  const reactions = {
    counterLimit: 1 as const,
    excludedAbilityIds: excluded as number[],
  };
  const partyActors = compilePartyActorCatalog(tables, reactionSource.data);
  for (const dependency of partyActors.dependencies) row(dependency.table, dependency.id);
  const transportations = compileTransportationCatalog({ row, unique },
    (tables["transportation.csv"] ?? []).map((r) => tableInteger(r.id))).catalog;
  // Availability of a template does not grant the character or admit their
  // battle actions. The same source registry serves any later AddFromMaster.
  const ownedInitializations: Record<string, OwnedCharacterInitializationTemplate> = {};
  const ownedInitializationBlockers: { sourceId: number; reason: string }[] = [];
  for (const character of tables["character_status.csv"] ?? []) {
    const sourceId = tableInteger(character.id);
    try {
      ownedInitializations[sourceId] = compileOwnedCharacterInitialization(
        { row, matching, group: tableGroup, unique }, tables, sourceId, (key) => key,
        ordinaryWeaponEffects.catalog,
      ).template;
    } catch (error) {
      if (initialParty.some((p) => p.characterId === sourceId)) throw error;
      ownedInitializationBlockers.push({ sourceId,
        reason: error instanceof Error ? error.message : String(error) });
    }
  }
  const characterGrowth: Record<string, CharacterGrowthPlan> = {};
  const characterGrowthBlockers: { sourceId: number; reason: string }[] = [];
  for (const template of Object.values(ownedInitializations)) {
    const sourceId = template.initial.sourceId;
    try {
      characterGrowth[sourceId] = compileCharacterGrowth({ row, unique }, tables, template, observedLearning).plan;
    } catch (error) {
      if (initialParty.some((p) => p.characterId === sourceId)) throw error;
      characterGrowthBlockers.push({ sourceId,
        reason: error instanceof Error ? error.message : String(error) });
    }
  }
  const corpus = await loadCorpus(root);
  if (corpus.manifest.parentSourceSetHash !== project.sourceSetHash)
    throw new Error("Battle entry script source mismatch");
  const entryMisc = corpus.assets.filter((asset) =>
    (asset.source.file === reactionSource.source.file || asset.source.file.endsWith("/" + reactionSource.source.file)) &&
    battle.sources.some((s) => s.file === asset.source.file && s.sha256 === reactionSource.source.sha256) &&
    ["assetPath", "objectId", "serializedFile"].every((key) =>
      asset.source[key as keyof typeof asset.source] === reactionSource.source[key as keyof typeof reactionSource.source]));
  if (entryMisc.length !== 1 || hash(entryMisc[0]!.data) !== hash(reactionSource.data))
    throw new Error("Battle entry miscellaneous source mismatch");
  const { providers: entryProviders, checkpoint } = compileBattleSourceEntry(
    { row }, tables, entryMisc[0]!,
    includeCheckpoint ? "development-checkpoint" : "shared", corpus.assets,
  );
  const appearanceMisc = entryMisc[0]!;
  if (typeof appearanceMisc.source.objectId !== "string") throw new Error("Missing battle appearance source object identity");
  const battleAppearance = compileBattleAppearance({ row, matching, unique }, {
    tables, misc: { source: { ...appearanceMisc.source, objectId: appearanceMisc.source.objectId }, data: appearanceMisc.data }, sprites: battle.sprites,
    sourceIds: Object.values(ownedInitializations).map((value) => value.initial.sourceId),
  });
  const result = {
    formatVersion: 1 as const,
    kind: "battle-source-data" as const,
    sourceSetHash: battle.sourceSetHash,
    parentSourceSetHash: project.sourceSetHash,
    nativeProfile: {
      sha256: native.sha256,
      atbRva: "0x675950",
      initRva: "0x676A00",
    },
    encounters,
    encounterPartyIds: encounterSources.requestedPartyIds,
    encounterDiagnostics: encounterSources.diagnostics,
    initialParty,
    characterMedia,
    ordinaryWeaponEffects,
    ownedInitializations,
    ownedInitializationBlockers,
    characterGrowth,
    characterGrowthBlockers,
    observedLearning,
    partyActors: partyActors.catalog,
    transportations,
    entryProviders,
    battleAppearance,
    shopBlockers: shops.blockers,
    magitekAbilityIds: magitek.map((a) => tableInteger(a.values.id)),
    battleAbilityIds: [...abilityIds].sort((a, b) => a - b),
    atb,
    reactions,
    reactionSource: reactionSource.source,
    tables: selected,
    sprites: battle.sprites,
    limitations: [
      "Source definitions are not confirmed initialized character stats.",
      "Ability membership is not runtime eligibility.",
      "Battle AI, damage, rewards and presentation are not executable yet.",
    ],
  };
  return { result, checkpoint };
}
