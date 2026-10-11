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
});
const SourceFile = z.object({
  file: z.string(),
  sha256: z.string(),
  bytes: z.number().int(),
});
const Export = z.object({
  formatVersion: z.literal(1),
  adapterVersion: z.literal("battle-0.2.0"),
  parentSourceSetHash: z.string(),
  sourceSetHash: z.string(),
  encounterPartyIds: z.array(z.number().int().positive()),
  sources: z.array(SourceFile),
  assets: z.record(z.string(), Asset),
  sprites: z.record(z.string(), Sprite),
  tableSources: z.record(z.string(), Source),
});
const Tables = z.record(z.string(), z.array(z.record(z.string(), z.string())));
type Tables = z.infer<typeof Tables>;
type Row = Tables[string][number];
type Source = z.infer<typeof Source>;
export type BattleRow = {
  values: Row;
  source: Source & { rowId: string };
};

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

/** Source data for the opening encounter; does not certify runtime support. */
export async function compileOpeningBattle(root: string) {
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
  if (battle.encounterPartyIds.join() !== "1,2,3,42")
    throw new Error("Unreviewed street encounter scope");
  const encounters = battle.encounterPartyIds.map((partyId) => {
    const party = row("monster_party.csv", partyId);
    const enemies = [];
    for (let slot = 1; slot <= 9; slot++) {
      const id = tableInteger(party.values[`monster${slot}`]);
      if (!id) continue;
      const monster = row("monster.csv", id),
        asset = row("monster_asset.csv", monster.values.monster_asset_id!);
      const ai = row("monster_ai_script.csv", monster.values.script_id!);
      enemies.push({
        slot,
        monsterId: id,
        group: tableInteger(party.values[`monster${slot}_group`]),
        x: tableInteger(party.values[`monster${slot}_x_position`]),
        y: tableInteger(party.values[`monster${slot}_y_position`]),
        sprite: spritePath(
          `/${asset.values.group_name}_${asset.values.asset_name}.png`,
        ),
        ai: json(ai.values.script_name!),
      });
      compileElementResistances(
        { row, group: tableGroup },
        tableInteger(monster.values.resistance_attribute),
      );
    }
    const patterns = Array.from({ length: 5 }, (_, n) => n + 1).filter((n) =>
      tableInteger(party.values[`battle_pattern${n}`]),
    );
    if (patterns.length !== 1 || ![1, 3].includes(patterns[0]!))
      throw new Error("Unsupported street battle formation");
    const background = row(
      "battle_background_asset.csv",
      party.values.battle_background_asset_id!,
    );
    const battleScript = row("script.csv", party.values.script_name!);
    return {
      partyId,
      enemies,
      pattern: patterns[0]!,
      script: json(battleScript.values.script_name!),
      background: spritePath(`/${background.values.asset_name}.png`),
    };
  });
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
  const command = row("command.csv", 26);
  row("command.csv", 3);
  // A shared condition library, not proof that every behavior is executable.
  compileConditionCatalog(
    { row, group: tableGroup },
    tables["condition.csv"]!.map((r) => tableInteger(r.id)),
  );
  for (const condition of tables["condition.csv"]!) {
    const soundId = tableInteger(condition.field_se_asset_id);
    if (soundId > 0) row("se_asset.csv", soundId);
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
  // The exported guard AI contains both references. This preserves definitions;
  // interpreting its branches and weighting remains a separate runtime task.
  for (const enemy of encounters.flatMap((e) => e.enemies)) {
    const script = z
      .object({
        Mnemonics: z.array(
          z.object({
            mnemonic: z.string(),
            operands: z.object({ iValues: z.array(z.number().int()) }),
          }),
        ),
      })
      .parse(enemy.ai.data);
    for (const op of script.Mnemonics)
      if (op.mnemonic === "Act")
        for (const id of op.operands.iValues) if (id !== 0) abilityIds.add(id);
  }
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
  const misc = z.record(z.string(), z.unknown()).parse(reactionSource.data);
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
  const ownedInitializations = Object.fromEntries(initialParty.map((p) => [
    p.characterId,
    compileOwnedCharacterInitialization(
      { row, matching, group: tableGroup, unique }, tables, p.characterId, (key) => key,
    ).template,
  ]));
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
    initialParty,
    ownedInitializations,
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
  return { ...result, contentHash: hash(result) };
}
