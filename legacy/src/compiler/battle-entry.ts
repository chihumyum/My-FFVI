import type { BattleEntryCatalog } from "../core/battle-entry.js";
import type { BattleRow } from "./battle.js";
import type { CorpusAsset } from "./corpus.js";
import { hash, record } from "./content.js";
import { tableInteger as int } from "./table.js";

type Tables = Record<string, Record<string, string>[]>;
type Reader = { row(table: string, id: string | number): BattleRow };
type Asset = Pick<CorpusAsset, "source" | "data">;

function checkedAsset(asset: Asset) {
  if (!asset.source.assetPath || !asset.source.file || !asset.source.serializedFile ||
    typeof asset.source.objectId !== "string" || !/^-?\d+$/.test(asset.source.objectId) ||
    !/^[0-9a-f]{64}$/.test(asset.source.sha256)) throw new Error("Invalid battle entry source asset identity");
}

/** Negative constant lookups are bound to the complete table, not an omitted
 * row default. The FF6 item-restriction constructor is independently pinned by
 * native evidence and creates an empty dictionary for this source build. */
export function compileBattleEntryCatalog(reader: Reader, tables: Tables, miscAsset: Asset): {
  catalog: BattleEntryCatalog; sources: BattleRow["source"][]; assetSources: Asset["source"][];
} {
  checkedAsset(miscAsset);
  if (!miscAsset.source.assetPath.endsWith("/serial_misc_assets.json"))
    throw new Error("Wrong battle entry miscellaneous source");
  const sources: BattleRow["source"][] = [];
  const row = (table: string, id: string | number) => {
    const found = reader.row(table, id); sources.push(found.source); return found.values;
  };
  const all = (table: string) => {
    if (!Array.isArray(tables[table])) throw new Error("Missing battle entry table: " + table);
    const records = tables[table]!.map((r) => row(table, r.id!));
    if (new Set(records.map((r) => int(r.id))).size !== records.length) throw new Error("Duplicate battle entry table identity");
    return records;
  };
  const constants = all("game_constant_int.csv");
  const sequence = (prefix: string) => {
    const entries: { id: number; value2: number }[] = [];
    for (let index = 1; index <= 50; index++) {
      const matches = constants.filter((r) => r.key_name === prefix + index);
      if (matches.length > 1) throw new Error("Ambiguous battle content constant");
      if (!matches[0]) break;
      const id = int(matches[0].value1);
      if (id > 0 && !entries.some((entry) => entry.id === id)) entries.push({ id, value2: int(matches[0].value2) });
    }
    return entries;
  };
  if (constants.some((r) => r.key_name === "FOR_ENCOUNTER_CONTENTS_DECISION_1"))
    throw new Error("Unresolved map encounter-content exclusion provider");
  const beast = record(miscAsset.data).beast_field_battle_command_invalid_table;
  if (!Array.isArray(beast) || beast.some((id) => !Number.isSafeInteger(id) || id < 1) || new Set(beast).size !== beast.length)
    throw new Error("Missing or invalid beast-field content exclusions");
  const contents = all("content.csv");
  const items = contents.filter((r) => [1, 2, 3].includes(int(r.type_id))).map((content) => {
    const type = int(content.type_id) as 1 | 2 | 3;
    const value = row(type === 1 ? "item.csv" : type === 2 ? "weapon.csv" : "armor.csv", content.type_value!);
    return { id: int(content.id), type, listType: int(value.type_id),
      throwFlag: type === 1 ? int(value.throw_flag) : 0,
      battleFunctionGroupId: type === 1 ? int(value.battle_function_group_id) : 0 };
  });
  const catalog: BattleEntryCatalog = {
    kind: "battle-entry-v1",
    maps: all("map.csv").map((r) => ({ id: int(r.id), sleepingAvailability: int(r.sleeping_availability), movingAvailability: int(r.moving_availability) })),
    sleepingContents: sequence("FOR_SLEEPING_CONTENTS_DECISION_").map((r) => r.id),
    movingContents: sequence("FOR_MOVING_CONTENTS_DECISION_"),
    transportationContents: sequence("FOR_SCRIPT_CONTENTS_TRANSPORTATION_IGNORE_").map((r) => r.id),
    beastFieldContents: [...beast] as number[], encounterExclusions: "constant-absent", items,
    changeEquipmentSlots: [1, 2], characterItemRestrictions: "empty-source-provider",
  };
  for (const id of [...catalog.sleepingContents, ...catalog.movingContents.map((r) => r.id),
    ...catalog.transportationContents, ...catalog.beastFieldContents]) row("content.csv", id);
  return { catalog, sources: [...new Map(sources.map((s) => [JSON.stringify(s), s])).values()], assetSources: [{ ...miscAsset.source }] };
}

export type NarsheOwnedConditionCheckpoint = {
  scope: "narshe-development-checkpoint-non-advertisement";
  target: "selected-party";
  conditionType: 607;
  conditionId: number;
  /** These are source identities; the host resolves existing owners once. */
  selectedSourceIds: number[];
  persistence: "owned-until-explicit-removal";
  requiresBattleBehavior: "magitek-armor-and-character-size";
  sources: BattleRow["source"][];
  scripts: { source: Asset["source"]; contentHash: string; instructionIndices: number[] }[];
};

/** Bind the already-existing development checkpoint to the six inspected
 * prelude scripts. This does not execute the prelude or admit its field VM.
 * AddCondition receives a condition TYPE, stores its condition ROW, and target
 * zero iterates the current Corps using owned IDs, including disabled owners. */
export function compileNarsheOwnedConditionCheckpoint(
  reader: Reader, tables: Tables, scriptRecords: readonly Asset[],
): NarsheOwnedConditionCheckpoint {
  const specs = [
    ["Map_40037/Map_40037/sc_e_0001.json", "d03b4052156ef1fedd279fd083b2e8f6ffd94a9dbcb2f1f8b5e926816782aa63", [18, 19]],
    ["Map_20010/Map_20010/sc_e_0001_1.json", "215591f2e58902819a81b1e0294d4e74eb81e8f6640ae09ad452b911343398dd", [10]],
    ["Map_20260/Map_20260/sc_e_0001_2.json", "0a1ee4bd482642e7d46c71143001b067fc8dc7e68d4ccefb2760d6344519ad24", [2, 3, 10]],
    ["Map_40037/Map_40037/sc_e_0001_3.json", "bdeeda0216401574d642ef5a81592a0ffdd49738162139c9e5bc959290bde3c8", [4, 5, 45]],
    ["Map_40000/Map_40000/sc_e_0001_4.json", "8d1f7ebb786b4719888e3cc596592b3f1338999e61345c652d54a40353f4330e", [15, 16, 17]],
    ["Map_20010/Map_20010/sc_e_0001_5.json", "822918a9801fe2b652b2af4cd3fc10ead5b632be9e4f0897f8c07df8188efb6d", [12, 13, 14, 18]],
  ] as const;
  const scripts = specs.map(([suffix, contentHash, instructionIndices]) => {
    const found = scriptRecords.filter((s) => s.source.assetPath === "Assets/GameAssets/Serial/Res/Map/" + suffix);
    if (found.length !== 1) throw new Error("Missing or ambiguous owned-condition checkpoint script");
    const source = found[0]!; checkedAsset(source);
    if (hash(source.data) !== contentHash) throw new Error("Owned-condition checkpoint source needs review");
    return { source: { ...source.source }, contentHash, instructionIndices: [...instructionIndices], data: record(source.data) };
  });
  const sources: BattleRow["source"][] = [];
  const all = (table: string) => {
    if (!Array.isArray(tables[table])) throw new Error("Missing owned-condition checkpoint table");
    return tables[table]!.map((r) => { const found = reader.row(table, r.id!); sources.push(found.source); return found.values; });
  };
  const initial = all("initialize_data.csv");
  const setting = (key: string) => {
    const rows = initial.filter((r) => r.key_name === key);
    if (rows.length > 1) throw new Error("Ambiguous owned-condition checkpoint initialization");
    return rows[0];
  };
  const start = setting("INT_START_MAP_ID");
  if (!start || int(start.value1) !== 609 || int(start.value2) !== 1)
    throw new Error("Owned-condition checkpoint start changed");
  if (setting("INIT_PARTY_5")) throw new Error("Unresolved fifth initial owned character");
  const selectedSourceIds: number[] = [];
  for (let position = 1; position <= 4; position++) {
    const value = setting("INIT_PARTY_" + position);
    if (value) {
      const id = int(value.value1);
      if (id < 1 || selectedSourceIds.includes(id)) throw new Error("Invalid owned-condition checkpoint party");
      selectedSourceIds.push(id); sources.push(reader.row("character_status.csv", id).source);
    }
  }
  if (!selectedSourceIds.length) throw new Error("Missing owned-condition checkpoint party");
  const conditions = all("condition.csv").filter((r) => int(r.condition_type) === 607);
  if (conditions.length !== 1) throw new Error("Ambiguous owned magitek condition type");
  const condition = conditions[0]!;
  if (int(condition.system_type) !== 4 || int(condition.until_type) !== 3 || int(condition.erase_condition_group_id) !== 1 ||
    int(condition.resistance_decision) !== 1) throw new Error("Owned magitek condition shape needs review");
  for (const key of ["overlapped_type", "until_value", "parameter_group_id", "condition_group_id", "attribute_group_id", "species_group_id",
    "attack_target", "recovery_invalid", "game_over_target", "state_cover_unavailable", "invalid_type", "target_type", "rate_type1", "rate_type2",
    "rate_value1", "rate_value2", "battle_effect_asset_id", "battle_effect_shadow_cloning", "field_se_asset_id", "damage_number", "icon_id"])
    if (int(condition[key]) !== 0) throw new Error("Unresolved magitek condition dependency: " + key);
  const list = scripts[0]!.data.Mnemonics;
  if (!Array.isArray(list)) throw new Error("Missing owned-condition instructions");
  const add = record(list[18]); const operands = record(add.operands);
  if (add.mnemonic !== "AddCondition" || add.type !== 1 || !Array.isArray(operands.iValues) ||
    operands.iValues.join() !== "607,0,0,0,0,0,0,0") throw new Error("Owned-condition checkpoint target changed");
  return { scope: "narshe-development-checkpoint-non-advertisement", target: "selected-party", conditionType: 607,
    conditionId: int(condition.id), selectedSourceIds, persistence: "owned-until-explicit-removal",
    requiresBattleBehavior: "magitek-armor-and-character-size",
    sources: [...new Map(sources.map((s) => [JSON.stringify(s), s])).values()],
    scripts: scripts.map(({ data: _data, ...source }) => source) };
}
