import type { BattleRow } from "./battle.js";
import { tableInteger as int } from "./table.js";
import {
  specialPhysicalWeaponIds,
  validateOrdinaryWeapon,
  validateOrdinaryWeaponEffects,
  type OrdinaryWeapon,
  type OrdinaryWeaponEffectsCatalog,
} from "../core/ordinary-weapon.js";

type Reader = { row(table: string, id: string | number): BattleRow };

export function compileOrdinaryWeaponEffects(reader: Reader, rawBattleExtraDesc: unknown): {
  catalog: OrdinaryWeaponEffectsCatalog;
  sources: BattleRow["source"][];
} {
  if (!rawBattleExtraDesc || typeof rawBattleExtraDesc !== "object" ||
      !Array.isArray((rawBattleExtraDesc as Record<string, unknown>).add_ability_weapon))
    throw new Error("Missing source weapon additional-ability list");
  const entries = (rawBattleExtraDesc as { add_ability_weapon: Record<string, unknown>[] }).add_ability_weapon;
  const catalog: OrdinaryWeaponEffectsCatalog = { kind: "ordinary-weapon-effects-v1",
    additionalAbilities: entries.map((entry) => ({
      weaponId: entry?.weapon_id as number, abilityId: entry?.ability_id as number, chance: entry?.ability_per as number,
    })) };
  validateOrdinaryWeaponEffects(catalog);
  const sources: BattleRow["source"][] = [];
  for (const entry of catalog.additionalAbilities) {
    sources.push(reader.row("weapon.csv", entry.weaponId).source, reader.row("ability.csv", entry.abilityId).source);
  }
  return { catalog, sources };
}

/** Source-only ordinary action admission. The surrounding equipment compiler
 * still checks six-slot/job rights, wear providers and all parameter fields. */
export function compileOrdinaryWeapon(reader: Reader, contentId: number, effects: OrdinaryWeaponEffectsCatalog): {
  provider: OrdinaryWeapon | null;
  blockers: string[];
  sources: BattleRow["source"][];
} {
  validateOrdinaryWeaponEffects(effects);
  const content = reader.row("content.csv", contentId);
  if (int(content.values.type_id) !== 2)
    throw new Error("Ordinary weapon requires weapon content identity");
  const weapon = reader.row("weapon.csv", int(content.values.type_value));
  const r = weapon.values, weaponId = int(r.id), typeId = int(r.type_id), backFlag = int(r.back_flag);
  const blockers: string[] = [];
  const block = (detail: string) => blockers.push(`weapon:${weaponId} ${detail}`);
  if (![1, 2].includes(typeId)) block("type_id=" + typeId);
  if (![0, 1].includes(backFlag)) block("back_flag=" + backFlag);
  if (typeId === 2 && backFlag !== 0) block("empty weapon back_flag=" + backFlag);
  if (r.process_prog !== "None") block("process_prog=" + r.process_prog);
  for (const column of ["attribute_group_id", "weak_attribute", "effective_species",
    "two_handed_flag", "additional_condition_group_id"])
    if (int(r[column]) !== 0) block(column + "=" + r[column]);
  // Table process=None is not sufficient: both are explicit native id branches.
  if (specialPhysicalWeaponIds.includes(weaponId))
    block("special physical weapon provider=" + weaponId);
  for (const entry of effects.additionalAbilities.filter((entry) => entry.weaponId === weaponId))
    block(`additional ability provider=${entry.abilityId},chance=${entry.chance}`);
  const provider: OrdinaryWeapon | null = blockers.length ? null : {
    kind: "ordinary-weapon-v1", contentId, weaponId,
    typeId: typeId as 1 | 2, backFlag: backFlag as 0 | 1,
  };
  if (provider) validateOrdinaryWeapon(provider);
  return { provider, blockers, sources: [content.source, weapon.source] };
}
