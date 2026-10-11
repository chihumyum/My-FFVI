import type { BattleConditionCatalog } from "../core/battle-conditions.js";
import {
  FieldConditions,
  type FieldConditionCatalog,
} from "../core/field-conditions.js";
import type { BattleRow } from "./battle.js";
import { hasMagitekBehavior, hasPoisonBehavior, type ConditionReader } from "./conditions.js";
import { tableInteger as int } from "./table.js";

/** Compile only independently admitted active conditions. Decoding the generic
 * condition damage dispatcher is not support for unknown status providers. */
export function compileFieldConditionCatalog(
  reader: ConditionReader & {
    unique(table: string, key: string, value: string): BattleRow;
  },
  battle: BattleConditionCatalog,
  transportationIds: readonly number[],
): { catalog: FieldConditionCatalog; sources: BattleRow[] } {
  const sources: BattleRow[] = [];
  // Defend, ordinary protection and speed states are removed at battle end. Their field
  // application/appearance is not admitted; a checkpoint cannot inject them
  // as passive statuses and carry them into another encounter.
  const behaviors = battle.behaviors.filter((behavior) =>
    !["defend", "physical-protection", "magic-protection", "haste", "slow"].includes(behavior.kind)).map(
    (behavior): FieldConditionCatalog["behaviors"][number] => {
      const row = reader.row("condition.csv", behavior.id);
      sources.push(row);
      const damage = int(row.values.damage_number);
      const soundId = int(row.values.field_se_asset_id);
      if (behavior.kind === "poison") {
        if (!hasPoisonBehavior(row) || soundId < 0)
          throw new Error("Unresolved field poison provider");
        if (soundId > 0) sources.push(reader.row("se_asset.csv", soundId));
        return {
          id: behavior.id,
          kind: "poison",
          hpDivisor: damage,
          soundId,
        };
      }
      if (damage !== 0 || soundId !== 0)
        throw new Error("Unresolved active field condition provider");
      if (behavior.kind === "magitek" && !hasMagitekBehavior(row))
        throw new Error("Unresolved field Magitek condition provider");
      return { id: behavior.id, kind: "none" };
    },
  );
  const dyingRows = battle.rules.definitions.filter((d) => d.type === 4);
  const threshold = reader.unique(
    "game_constant_int.csv",
    "key_name",
    "RATE_HAVE_NEAR_DEATH",
  );
  sources.push(threshold);
  if (
    dyingRows.length !== 1 ||
    dyingRows[0]!.id !== battle.dying.conditionId ||
    int(threshold.values.value1) !== battle.dying.thresholdDivisor
  )
    throw new Error("Unresolved field dying selector");
  const catalog: FieldConditionCatalog = {
    definitions: battle.rules.definitions.map(({ id, type }) => ({ id, type })),
    behaviors,
    dying: { ...battle.dying },
    transportations: transportationIds.map((id) => {
      const row = reader.row("transportation.csv", id);
      sources.push(row);
      return { id: int(row.values.id), type: int(row.values.type_id) };
    }),
  };
  new FieldConditions(catalog);
  return { catalog, sources };
}
