import type { GameStateContent } from "../core/game-state.js";
import type { compileOpeningBattle } from "./battle.js";
import { tableInteger as int } from "./table.js";
import { compileItem } from "./items.js";

/** Explicit opening bootstrap. It does not initialize unknown plot flags or
 * extend item stacks to the equipment-count/magic-stone ownership providers. */
export function compileGameState(
  source: Awaited<ReturnType<typeof compileOpeningBattle>>,
  name: (key: string) => string,
): GameStateContent {
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
  const initialItems = rows("initialize_data.csv")
    .filter((r) => /^INIT_ITEM_[1-5]$/.test(r.key_name!))
    .map((r) => ({ id: int(r.value1), count: int(r.value2) }));
  if (initialItems.some((i) => !items[i.id]))
    throw new Error("Unimplemented initial inventory content");
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
    initialGil: unique("initialize_data.csv", "INIT_GIL"),
    items,
    initialItems,
    equipment: Object.fromEntries(
      source.initialParty.map((p) => {
        const status =
          source.tables["character_status.csv"]![p.characterId]!.values;
        return [
          `player:${p.characterId}`,
          Array.from({ length: 6 }, (_, n) =>
            int(status[`content_id${n + 1}`]),
          ),
        ];
      }),
    ),
  };
}
