import type { GameStateContent } from "../core/game-state.js";
import type { BattleRow } from "./battle.js";
import { createNewGame, type NewGameDefinition } from "../core/new-game.js";
import { canonical } from "../core/canonical.js";
import { tableInteger as int } from "./table.js";
import { compileItem } from "./items.js";
import { compileInitialPartyState } from "./party.js";
import { compileInitialRosterLifecycle } from "./roster.js";

export type GameStateSource = {
  tables: Record<string, Record<string, BattleRow>>;
  initialParty?: readonly { characterId: number }[];
};
export type GameStateEntry = {
  owners: readonly { id: string; sourceId: number }[];
  /** The source initializer, rather than a field checkpoint, owns these grants. */
  sourceNewGame?: NewGameDefinition;
};

/** Item definitions and limits do not create a roster, grant inventory or
 * imply that a field checkpoint has executed. */
export function compileGameStateCatalog(
  source: Pick<GameStateSource, "tables">,
  name: (key: string) => string,
): Pick<GameStateContent, "kind" | "limits" | "items"> {
  const rows = (table: string) =>
    Object.values(source.tables[table] ?? {}).map((r) => r.values);
  const unique = (table: string, key: string) => {
    const values = rows(table).filter((r) => r.key_name === key);
    if (values.length !== 1)
      throw new Error("Missing/ambiguous game-state constant: " + key);
    return int(values[0]!.value1);
  };
  const items: GameStateContent["items"] = {};
  const reader = {
    row: (table: string, id: string | number) => {
      const r = source.tables[table]?.[String(id)];
      if (!r) throw new Error(`Missing item dependency ${table}:${id}`);
      return r;
    },
    group: (table: string, key: string, value: string | number) => {
      if (String(value) === "0") return [];
      const found = Object.values(source.tables[table] ?? {}).filter(
        (r) => r.values[key] === String(value),
      );
      if (!found.length)
        throw new Error(`Missing item group ${table}:${value}`);
      return found;
    },
  };
  for (const content of rows("content.csv").filter((c) => c.type_id === "1")) {
    const item = source.tables["item.csv"]?.[content.type_value!]?.values;
    if (!item) throw new Error("Missing source item: " + content.type_value);
    const id = int(content.id);
    items[id] = compileItem(reader, id, name(content.mes_id_name!)).definition;
  }
  return {
    kind: "game-state-development-v1",
    limits: {
      gil: unique("game_constant_int.csv", "MAX_GIL"),
      item: unique("game_constant_int.csv", "MAX_ITEM"),
      hp: unique("game_constant_int.csv", "MAX_HP"),
      mp: unique("game_constant_int.csv", "MAX_MP"),
      exp: unique("game_constant_int.csv", "MAX_EXP"),
      level: unique("game_constant_int.csv", "MAX_LV"),
    },
    items,
  };
}

/** The optional explicit entry removes the source decoder's initialParty
 * shape from shared catalog construction. The two-argument legacy call retains
 * its exact initial field values and source creation order. */
export function compileGameState(
  source: GameStateSource,
  name: (key: string) => string,
  entry?: GameStateEntry,
): GameStateContent {
  const catalog = compileGameStateCatalog(source, name);
  const rows = (table: string) => Object.values(source.tables[table] ?? {}).map((r) => r.values);
  const owners = entry?.owners ?? source.initialParty?.map((p) => ({
    id: `player:${p.characterId}`, sourceId: p.characterId,
  }));
  if (!owners?.length || owners.some((owner) => typeof owner.id !== "string" || !owner.id ||
      !Number.isInteger(owner.sourceId) || owner.sourceId < 1 || owner.sourceId > 0x7fffffff) ||
      new Set(owners.map((owner) => owner.id)).size !== owners.length ||
      new Set(owners.map((owner) => owner.sourceId)).size !== owners.length)
    throw new Error("Missing or ambiguous game-state entry owners");
  const fresh = entry?.sourceNewGame === undefined ? null : createNewGame(entry.sourceNewGame);
  if (fresh && canonical(owners) !== canonical(fresh.owned.roster.map(({ id, sourceId }) => ({ id, sourceId }))))
    throw new Error("Source new-game entry owners differ from initializer");
  const initialItems = fresh ? structuredClone(fresh.owned.items) : rows("initialize_data.csv")
    .filter((r) => /^INIT_ITEM_[1-5]$/.test(r.key_name!))
    .map((r) => ({ id: int(r.value1), count: int(r.value2) }));
  if (initialItems.some((i) => !catalog.items[i.id]))
    throw new Error("Unimplemented initial inventory content");
  const { dependencies: _rosterDependencies, ...rosterLifecycle } =
    compileInitialRosterLifecycle(
      Object.fromEntries(
        Object.keys(source.tables).map((table) => [table, rows(table)]),
      ),
      [...owners],
    );
  return {
    ...catalog,
    initialGil: fresh ? fresh.owned.gil : (() => {
      const values = rows("initialize_data.csv").filter((r) => r.key_name === "INIT_GIL");
      if (values.length !== 1) throw new Error("Missing/ambiguous game-state constant: INIT_GIL");
      return int(values[0]!.value1);
    })(),
    rosterLifecycle,
    initialParty: fresh ? structuredClone(fresh.owned.party) : compileInitialPartyState(
      Object.fromEntries(
        Object.keys(source.tables).map((table) => [table, rows(table)]),
      ),
      owners.map((owner) => ({ ...owner, enabled: true })),
    ).state,
    initialItems,
    equipment: Object.fromEntries(
      owners.map((owner) => {
        const loadout = fresh?.owned.roster.find((member) => member.id === owner.id)?.equipment;
        const status = source.tables["character_status.csv"]?.[owner.sourceId]?.values;
        if (!loadout && !status) throw new Error("Missing source character equipment: " + owner.sourceId);
        return [
          owner.id,
          loadout ? [...loadout] : Array.from({ length: 6 }, (_, n) => int(status![`content_id${n + 1}`])),
        ];
      }),
    ),
  };
}
