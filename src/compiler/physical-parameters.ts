import { tableInteger as int } from "./table.js";
import type { BattleRow } from "./battle.js";
import {
  confirmPlayerPhysical,
  confirmEnemyPhysical,
  type PhysicalLimits,
  type PlayerPhysicalInput,
} from "../core/physical-parameters.js";
import type { PhysicalParameters } from "../core/physical.js";

type Reader = {
  row(table: string, id: string | number): BattleRow;
  unique(table: string, key: string, value: string): BattleRow;
};
export const physicalLimitKeys = {
  attack: "MAX_ATTACK",
  strength: "MAX_STRNGTH",
  accuracy: "MAX_ACCURACY_RATE",
  criticalRate: "MAX_CRITICAL_RATE",
  criticalPercent: "MAX_CRITICAL_RATE_PERCENTAGE",
};
export function compilePhysicalLimits(reader: Reader) {
  const rows = Object.entries(physicalLimitKeys).map(
    ([key, name]) =>
      [key, reader.unique("game_constant_int.csv", "key_name", name)] as const,
  );
  return {
    values: Object.fromEntries(
      rows.map(([key, row]) => [key, int(row.values.value1)]),
    ) as PhysicalLimits,
    sources: rows.map(([, r]) => r.source),
  };
}
/** Numeric source projection only. Does not admit a weapon, action or plot state. */
export function compilePlayerPhysical(
  reader: Reader,
  characterId: number,
  context: {
    selectedArm: 1 | 2;
    additionalStrength: number;
    correctionStrength: number;
    temporary: PhysicalParameters;
  },
  limits: PhysicalLimits,
) {
  if (![1, 2].includes(context.selectedArm))
    throw new Error("Invalid selected arm");
  const character = reader.row("character_status.csv", characterId);
  const sources = [character.source];
  const equipment = Array.from({ length: 6 }, (_, i) => {
    const content = reader.row(
      "content.csv",
      int(character.values[`content_id${i + 1}`]),
    );
    const kind =
      content.values.type_id === "2"
        ? "weapon"
        : content.values.type_id === "3"
          ? "armor"
          : null;
    if (!kind) throw new Error("Unresolved physical equipment content");
    const row = reader.row(kind + ".csv", content.values.type_value!);
    sources.push(content.source, row.source);
    return { kind, row };
  });
  const selected = equipment[context.selectedArm - 1]!;
  const weapon = (key: string) =>
    selected.kind === "weapon" ? int(selected.row.values[key]) : 0;
  // GetWeaponOffensivePower 0x859320: weapon 38 is reduced outside condition 601.
  const weaponAttack =
    selected.kind === "weapon" &&
    int(selected.row.values.id) === 38 &&
    weapon("attack") > 0
      ? 1
      : weapon("attack");
  const input: PlayerPhysicalInput = {
    baseAttack: int(character.values.attack),
    bareHands: equipment
      .slice(0, 2)
      .every((e) => e.kind === "weapon" && int(e.row.values.type_id) === 2),
    weaponAttack,
    weaponAccuracy: weapon("accuracy_rate"),
    weaponCriticalRate: weapon("critical_rate"),
    strength: {
      base: int(character.values.strength),
      additional: context.additionalStrength,
      correction: context.correctionStrength,
      equipment: equipment.reduce(
        (n, e) => (n + int(e.row.values.strength)) | 0,
        0,
      ),
    },
    temporary: { ...context.temporary },
  };
  return { input, confirmed: confirmPlayerPhysical(input, limits), sources };
}
export function compileEnemyPhysical(
  reader: Reader,
  monsterId: number,
  temporary: PhysicalParameters,
  limits: PhysicalLimits,
) {
  const row = reader.row("monster.csv", monsterId);
  const base = {
    attack: int(row.values.attack),
    strength: 0,
    accuracy: int(row.values.accuracy_rate),
    criticalRate: int(row.values.critical_rate),
  };
  return {
    base,
    temporary: { ...temporary },
    confirmed: confirmEnemyPhysical(base, temporary, limits),
    sources: [row.source],
  };
}
