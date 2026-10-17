import type { BattleRow } from "./battle.js";
import type { CorpusAsset } from "./corpus.js";
import { compileNewGameRoute } from "./new-game.js";
import { tableInteger } from "./table.js";
import type { NewGameDefinition } from "../core/new-game.js";
import type { NewGameFieldEntryDefinition } from "../core/new-game-field-entry.js";

type Reader = {
  row(table: string, id: string | number): BattleRow;
  unique(table: string, key: string, value: string): BattleRow;
  matching(table: string, key: string, value: string | number): BattleRow[];
  group(table: string, key: string, value: string | number): BattleRow[];
};

/** Bind the same source LoadData route used by the fresh owned initializer.
 * The map's script remains a distinct fallback identity. No scene-name branch
 * is embedded in the runtime and no compiled checkpoint seed is consulted. */
export function compileNewGameFieldEntry(
  reader: Reader,
  newGame: NewGameDefinition,
  scripts: readonly Pick<CorpusAsset, "source" | "data">[],
): {
  definition: NewGameFieldEntryDefinition;
  sources: BattleRow["source"][];
  reservedScriptSource: CorpusAsset["source"];
} {
  const compiled = compileNewGameRoute(reader, newGame, scripts),
    route = compiled.route,
    fallback = reader.row("script.csv", route.mapInitializerScriptId);
  const fallbackId = tableInteger(fallback.values.id);
  if (
    fallbackId !== route.mapInitializerScriptId ||
    fallbackId <= 0 ||
    typeof fallback.values.script_name !== "string" ||
    !fallback.values.script_name
  )
    throw new Error("Unbound first-map fallback script");
  return {
    definition: {
      kind: "source-new-game-field-entry-v1",
      mapId: route.mapId,
      entrance: route.entrance,
      reservedScript: {
        id: route.scriptId,
        name: route.scriptName,
        contentHash: route.contentHash,
      },
      fallbackScript: { id: fallbackId, name: fallback.values.script_name },
    },
    sources: [...compiled.sources, fallback.source],
    reservedScriptSource: { ...route.source },
  };
}
