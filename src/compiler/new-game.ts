import type { BattleRow } from "./battle.js";
import { tableInteger as int } from "./table.js";
import { compileOwnedCharacterInitialization } from "./owned-character.js";
import { compileEquipmentCatalog } from "./equipment.js";
import { compileInitialRosterLifecycle } from "./roster.js";
import { compileInitialPartyState } from "./party.js";
import { compileTransportationCatalog } from "./transportation.js";
import {
  createNewGame,
  type NewGameDefinition,
  type NewGameInventoryGrant,
} from "../core/new-game.js";
import type { CorpusAsset } from "./corpus.js";
import { hash, record } from "./content.js";
import type { OrdinaryWeaponEffectsCatalog } from "../core/ordinary-weapon.js";
import type { EquipmentCatalog } from "../core/equipment.js";

type Tables = Record<string, Record<string, string>[]>;
type Reader = {
  row(table: string, id: string | number): BattleRow;
  unique(table: string, key: string, value: string): BattleRow;
  matching(table: string, key: string, value: string | number): BattleRow[];
  group(table: string, key: string, value: string | number): BattleRow[];
};

/** Compiles the source initializer independently of opening battle definitions,
 * checkpoint conditions, curated entry actor positions and later plot seeds. */
export function compileNewGame(
  reader: Reader,
  tables: Tables,
  name: (key: string) => string,
  ordinaryWeaponEffects: OrdinaryWeaponEffectsCatalog,
  equipmentStateKind: EquipmentCatalog["kind"] = "equipment-development-v1",
): {
  definition: NewGameDefinition;
  sources: BattleRow["source"][];
} {
  const sources: BattleRow["source"][] = [];
  const row = (table: string, id: string | number) => {
    const found = reader.row(table, id);
    sources.push(found.source);
    return found.values;
  };
  const all = (table: string) => {
    if (!Array.isArray(tables[table]))
      throw new Error("Missing new-game table: " + table);
    return tables[table]!.map((r) => row(table, r.id!));
  };
  const initial = all("initialize_data.csv");
  const setting = (key: string, required = false) => {
    const found = initial.filter((r) => r.key_name === key);
    if (found.length > 1 || (required && !found.length))
      throw new Error("Missing or ambiguous new-game setting: " + key);
    return found[0] ?? null;
  };
  // The existing Corps owner has four positions. Preserve the fifth-owner gap
  // rather than silently dropping a configured fifth source character.
  if (setting("INIT_PARTY_5"))
    throw new Error("Fifth new-game owner is not implemented");
  const owners: { id: string; sourceId: number }[] = [];
  for (let slot = 1; slot <= 4; slot++) {
    const value = setting("INIT_PARTY_" + slot);
    if (value) {
      const sourceId = int(value.value1);
      if (sourceId <= 0 || owners.some((o) => o.sourceId === sourceId))
        throw new Error("Ambiguous new-game character creation");
      owners.push({ id: "player:" + sourceId, sourceId });
    }
  }
  const characters = owners.map((owner) => {
    const initialized = compileOwnedCharacterInitialization(
      reader,
      tables,
      owner.sourceId,
      name,
      ordinaryWeaponEffects, equipmentStateKind,
    );
    sources.push(...initialized.sources);
    return { id: owner.id, template: initialized.template };
  });
  const lifecycle = compileInitialRosterLifecycle(tables, owners);
  const party = compileInitialPartyState(
    tables,
    owners.map((o) => ({ ...o, enabled: true })),
  );
  for (const dependency of [...lifecycle.dependencies, ...party.dependencies])
    row(dependency.table, dependency.id);
  const inventory: NewGameInventoryGrant[] = [];
  for (let index = 1; index <= 5; index++) {
    const value = setting("INIT_ITEM_" + index);
    if (!value) continue;
    const id = int(value.value1),
      count = int(value.value2),
      content = row("content.csv", id);
    const type = int(content.type_id);
    if (type === 1) {
      row("item.csv", content.type_value!);
      inventory.push({ kind: "item", id, count });
    } else if (type === 2 || type === 3)
      inventory.push({ kind: "equipment", id, count });
    else
      throw new Error(
        "Unresolved new-game initial content owner: " + id + "/type" + type,
      );
  }
  const emptyEquipmentGrants = all("content.csv")
    .filter((r) => [2, 3].includes(int(r.type_id)))
    .filter(
      (r) =>
        int(
          row(int(r.type_id) === 2 ? "weapon.csv" : "armor.csv", r.type_value!)
            .type_id,
        ) === 2,
    )
    .map((r) => ({ id: int(r.id), count: 5 as const }));
  const equipmentIds = [
    ...new Set([
      ...characters.flatMap((c) => c.template.initial.equipment),
      ...emptyEquipmentGrants.map((g) => g.id),
      ...inventory.filter((g) => g.kind === "equipment").map((g) => g.id),
    ]),
  ];
  const equipment = compileEquipmentCatalog(
    reader,
    equipmentIds,
    owners.map((o) => o.sourceId),
    name,
    Object.fromEntries(
      owners.map((o) => [
        o.sourceId,
        { hasTwoSwordStyle: false, hasTwoHand: false, equipAnyJob: false },
      ]),
    ),
    ordinaryWeaponEffects, equipmentStateKind,
  );
  sources.push(...equipment.sources);
  const transportationRows = all("transportation.csv");
  if (transportationRows.some((r) => int(r.type_id) === 0))
    throw new Error("Unimplemented zero-type transportation catalog entry");
  const transportation = compileTransportationCatalog(
    reader,
    transportationRows.map((r) => int(r.id)),
  );
  sources.push(...transportation.sources.map((s) => s.source));
  const constant = (key: string) => {
    const found = reader.unique("game_constant_int.csv", "key_name", key);
    sources.push(found.source);
    return int(found.values.value1);
  };
  const definition: NewGameDefinition = {
    kind: "source-new-game-v1",
    characters,
    party: party.state,
    releasedJobIds: lifecycle.releasedJobIds,
    inventory,
    gil: int(setting("INIT_GIL")?.value1 ?? "0"),
    limits: { gil: constant("MAX_GIL"), item: constant("MAX_ITEM") },
    equipment: equipment.catalog,
    emptyEquipmentGrants,
    transportation: transportation.catalog,
  };
  createNewGame(definition);
  return {
    definition,
    sources: [...new Map(sources.map((s) => [JSON.stringify(s), s])).values()],
  };
}

export type NewGameRoute = {
  mapId: number;
  entrance: number;
  scriptId: number;
  scriptName: string;
  mapInitializerScriptId: number;
  source: CorpusAsset["source"];
  contentHash: string;
};

/** Resolves the requested start script from the source route. Merely resolving
 * it never executes the script or marks map initialization as complete. */
export function compileNewGameRoute(
  reader: Reader,
  definition: NewGameDefinition,
  scripts: readonly Pick<CorpusAsset, "source" | "data">[],
): { route: NewGameRoute; sources: BattleRow["source"][] } {
  const start = definition.transportation.newGame;
  const map = reader.row("map.csv", start.mapId),
    script = reader.row("script.csv", start.scriptId);
  const scriptName = script.values.script_name;
  if (!scriptName || !map.values.map_name || !map.values.asset_name)
    throw new Error("Missing new-game source route metadata");
  const prefix = `Assets/GameAssets/Serial/Res/Map/${map.values.map_name}/${map.values.map_name}/`;
  const matches = scripts.filter(
    (s) => s.source.assetPath === prefix + scriptName + ".json",
  );
  if (matches.length !== 1)
    throw new Error("Missing or ambiguous new-game start script");
  const selected = matches[0]!;
  if (
    typeof selected.source.objectId !== "string" ||
    !/^-?\d+$/.test(selected.source.objectId) ||
    !selected.source.serializedFile ||
    !/^[a-f0-9]{64}$/.test(selected.source.sha256) ||
    record(selected.data).Name !== scriptName
  )
    throw new Error("Invalid new-game script provenance");
  return {
    route: {
      mapId: start.mapId,
      entrance: start.entrance,
      scriptId: start.scriptId,
      scriptName,
      mapInitializerScriptId: int(map.values.script_id),
      source: { ...selected.source },
      contentHash: hash(selected.data),
    },
    sources: [map.source, script.source],
  };
}
