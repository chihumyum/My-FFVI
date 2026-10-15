import type { BattleConditionCatalog } from "../core/battle-conditions.js";
import {
  FieldConditions,
  type FieldConditionCatalog,
} from "../core/field-conditions.js";
import type { BattleRow } from "./battle.js";
import { hasMagitekBehavior, hasPoisonBehavior, type ConditionReader } from "./conditions.js";
import { tableInteger as int } from "./table.js";
import { hasBlindBehavior } from "./condition-blind.js";

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
  // Enemy-only Leviteto has no admitted player renderer/field persistence.
  // Escape, Defend, ordinary protection, speed and action-control states are removed at battle end. Their field
  // application/appearance is not admitted; a checkpoint cannot inject them
  // as passive statuses and carry them into another encounter.
  const behaviors = battle.behaviors.filter((behavior) =>
    !["levitate", "escape", "defend", "physical-protection", "magic-protection", "haste", "slow", "sleep", "confusion", "temptation", "doom"].includes(behavior.kind)).flatMap(
    (behavior): FieldConditionCatalog["behaviors"] => {
      const row = reader.row("condition.csv", behavior.id);
      sources.push(row);
      // A separately admitted battle function does not grant field persistence.
      // Keep its master definition/reference, but expose no active field behavior.
      // Only the known generic dictionary differs; malformed ordinary lifecycle
      // data must still fail instead of becoming an implicit omission.
      if ((behavior.kind === "blind" || behavior.kind === "poison") && behavior.resistanceProvider !== undefined) {
        const ordinary = { ...row, values: { ...row.values, condition_group_id: "0" } };
        if (behavior.resistanceProvider.groupId <= 0 ||
            int(row.values.condition_group_id) !== behavior.resistanceProvider.groupId ||
            !(behavior.kind === "blind" ? hasBlindBehavior(ordinary) : hasPoisonBehavior(ordinary)))
          throw new Error("Changed battle-only condition provider");
        return [];
      }
      const damage = int(row.values.damage_number);
      const soundId = int(row.values.field_se_asset_id);
      if (behavior.kind === "poison") {
        if (!hasPoisonBehavior(row) || soundId < 0)
          throw new Error("Unresolved field poison provider");
        if (soundId > 0) sources.push(reader.row("se_asset.csv", soundId));
        return [{
          id: behavior.id,
          kind: "poison",
          hpDivisor: damage,
          soundId,
        }];
      }
      if (damage !== 0 || soundId !== 0)
        throw new Error("Unresolved active field condition provider");
      if (behavior.kind === "magitek" && !hasMagitekBehavior(row))
        throw new Error("Unresolved field Magitek condition provider");
      if (behavior.kind === "blind" && !hasBlindBehavior(row))
        throw new Error("Unresolved field Blind condition provider");
      return [{ id: behavior.id, kind: "none" }];
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
