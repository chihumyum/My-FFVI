import type { BattleRowCatalog } from "./battle-row.js";

/** Executable ordinary weapon metadata. Content identity and weapon-row identity
 * remain distinct. This does not grant Throw, two-handed use or weapon procs. */
export type OrdinaryWeapon = {
  kind: "ordinary-weapon-v1";
  contentId: number;
  weaponId: number;
  typeId: 1 | 2;
  backFlag: 0 | 1;
};

/** BattleExtraDesc's additional-attack list, independent from weapon.csv.
 * Order and repeated weapon identities are significant in the native loop. */
export type OrdinaryWeaponEffectsCatalog = {
  kind: "ordinary-weapon-effects-v1";
  additionalAbilities: { weaponId: number; abilityId: number; chance: number }[];
};

export function validateOrdinaryWeaponEffects(catalog: OrdinaryWeaponEffectsCatalog): void {
  if (!catalog || catalog.kind !== "ordinary-weapon-effects-v1" || !Array.isArray(catalog.additionalAbilities))
    throw new Error("Missing ordinary weapon additional-ability provider");
  for (const entry of catalog.additionalAbilities) {
    if (!entry || !Number.isSafeInteger(entry.weaponId) || entry.weaponId <= 0 || entry.weaponId > 0x7fffffff ||
        !Number.isSafeInteger(entry.abilityId) || entry.abilityId <= 0 || entry.abilityId > 0x7fffffff ||
        !Number.isSafeInteger(entry.chance) || entry.chance < 0 || entry.chance > 100)
      throw new Error("Invalid ordinary weapon additional-ability provider");
  }
}

export function validateOrdinaryWeaponEffectsAdmission(
  weapon: OrdinaryWeapon,
  catalog: OrdinaryWeaponEffectsCatalog,
): void {
  validateOrdinaryWeapon(weapon);
  validateOrdinaryWeaponEffects(catalog);
  // Even a zero-percent record draws RNG; it cannot be treated as absent.
  if (catalog.additionalAbilities.some((entry) => entry.weaponId === weapon.weaponId))
    throw new Error("Unimplemented weapon additional ability: " + weapon.weaponId);
}

/** GetFightStatus 0x3d6990 selects these by the current attack arm even when
 * Weapon.ProcessProg is None. PhysicalExecution has separate numerical paths. */
export const specialPhysicalWeaponIds: readonly number[] = [11, 30];

export function validateOrdinaryWeapon(value: OrdinaryWeapon): void {
  if (!value || value.kind !== "ordinary-weapon-v1" ||
      !Number.isSafeInteger(value.contentId) || value.contentId <= 0 || value.contentId > 0x7fffffff ||
      !Number.isSafeInteger(value.weaponId) || value.weaponId <= 0 || value.weaponId > 0x7fffffff ||
      ![1, 2].includes(value.typeId) || ![0, 1].includes(value.backFlag))
    throw new Error("Missing or invalid ordinary weapon provider");
  if (specialPhysicalWeaponIds.includes(value.weaponId))
    throw new Error("Unimplemented special physical weapon: " + value.weaponId);
  if (value.typeId === 2 && value.backFlag !== 0)
    throw new Error("Unresolved empty weapon row behavior");
}

/** The independent battle-row catalog must describe the same weapon as the
 * equipped executable provider. No inferred false value or content-ID alias. */
export function validateOrdinaryWeaponRow(
  weapon: OrdinaryWeapon,
  row: BattleRowCatalog["equipment"][number] | undefined,
): void {
  validateOrdinaryWeapon(weapon);
  if (!row || row.contentId !== weapon.contentId || !row.weapon ||
      row.weapon.typeId !== weapon.typeId || row.weapon.backFlag !== weapon.backFlag)
    throw new Error("Ordinary weapon and battle row provider mismatch");
}
