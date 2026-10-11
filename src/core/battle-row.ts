/** CorpsId in this source: Front=1, Back=2. Formation and facing are separate. */
export type BattleRow = "front" | "back";

/** Source metadata, not action or equipment admission. The host must still
 * establish complete action, equipment and condition providers. */
export type BattleRowCatalog = {
  kind: "battle-row-v1";
  abilities: {
    id: number;
    typeId: number;
    ignoreRearguardAttack: boolean;
  }[];
  equipment: {
    contentId: number;
    /** Armor has no OwnedItemData.Weapon. Type 2 is the empty weapon. */
    weapon: { typeId: number; backFlag: number } | null;
  }[];
};

/** Derived for each action and target, never a persistent defending/row flag. */
export type PhysicalRowContext = {
  actor: BattleRow;
  target: BattleRow;
  ignoreActorPenalty: boolean;
  ignoreTargetPenalty: boolean;
};

export type PhysicalRowRequest = {
  /** This provider is for ability actions. Physical item/machine actions need
   * their additional native IsMachine/ignore-defense provider first. */
  abilityId: number;
  actor: {
    side: "player" | "enemy";
    row: BattleRow;
    /** Six source content IDs for a player; null means no owned data (enemy).
     * Missing player equipment is unknown, never an empty weapon default. */
    equipment: readonly number[] | null;
    conditionTypes: readonly number[];
  };
  targetRow: BattleRow;
};

// CalcExecuteCorrection..cctor 0xa91600; 12-byte metadata initializer
// 43CF64762C827FC2F2D5B1C7D4894A97AC4DCA2A. This only skips the actor penalty.
export const ignoreRearguardAttackAbilityIds: readonly number[] = [124, 127, 130];

function positiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0 && (value as number) <= 0x7fffffff;
}

export function validateBattleRow(row: unknown): asserts row is BattleRow {
  if (row !== "front" && row !== "back") throw new Error("Missing or invalid battle row");
}

export function validatePhysicalRows(rows: PhysicalRowContext): void {
  if (!rows) throw new Error("Missing physical row context");
  validateBattleRow(rows.actor);
  validateBattleRow(rows.target);
  if (typeof rows.ignoreActorPenalty !== "boolean" || typeof rows.ignoreTargetPenalty !== "boolean")
    throw new Error("Missing physical row bypass provider");
}

export function validateBattleRowCatalog(catalog: BattleRowCatalog): void {
  if (!catalog || catalog.kind !== "battle-row-v1" || !Array.isArray(catalog.abilities) ||
      !Array.isArray(catalog.equipment)) throw new Error("Missing battle row catalog");
  const abilityIds = new Set<number>();
  for (const ability of catalog.abilities) {
    if (!ability || !positiveInteger(ability.id) || !positiveInteger(ability.typeId) ||
        ability.ignoreRearguardAttack !== ignoreRearguardAttackAbilityIds.includes(ability.id) ||
        abilityIds.has(ability.id)) throw new Error("Invalid battle row ability metadata");
    abilityIds.add(ability.id);
  }
  const contentIds = new Set<number>();
  for (const item of catalog.equipment) {
    if (!item || !positiveInteger(item.contentId) || contentIds.has(item.contentId) ||
        (item.weapon !== null && (!item.weapon || !positiveInteger(item.weapon.typeId) ||
          !Number.isInteger(item.weapon.backFlag) || item.weapon.backFlag < 0 || item.weapon.backFlag > 0x7fffffff)))
      throw new Error("Invalid battle row equipment metadata");
    contentIds.add(item.contentId);
  }
}

/** GetFightStatus 0x3d6990 -> PhysicalExecution 0xa97b20. This keeps distinct
 * actor-only exceptions and the shared isIgnoreCorps equipment/type exception.
 * It neither admits special abilities nor infers ownership from a sprite. */
export function projectPhysicalRows(catalog: BattleRowCatalog, request: PhysicalRowRequest): PhysicalRowContext {
  validateBattleRowCatalog(catalog);
  if (!request || !request.actor) throw new Error("Missing physical row request");
  validateBattleRow(request.actor.row);
  validateBattleRow(request.targetRow);
  const ability = catalog.abilities.find((entry) => entry.id === request.abilityId);
  if (!ability) throw new Error("Unknown physical row ability: " + request.abilityId);
  const { actor } = request;
  if (!Array.isArray(actor.conditionTypes) || actor.conditionTypes.some((type) => !positiveInteger(type)))
    throw new Error("Missing physical row condition provider");
  let ignoreCorps = false;
  if (actor.side === "player") {
    if (!Array.isArray(actor.equipment) || actor.equipment.length !== 6)
      throw new Error("Missing physical row player equipment provider");
    const equipment = actor.equipment.map((id) => {
      const entry = catalog.equipment.find((item) => item.contentId === id);
      if (!entry) throw new Error("Unknown physical row equipment: " + id);
      return entry;
    });
    // DisplayClass27_0.b__2 requires hand-slot membership and Weapon != null;
    // b__27_4 removes TypeId2, then Count>0 && All(BackFlag==1).
    const weapons = equipment.slice(0, 2).flatMap((entry) =>
      entry.weapon !== null && entry.weapon.typeId !== 2 ? [entry.weapon] : []);
    ignoreCorps = weapons.length > 0 && weapons.every((weapon) => weapon.backFlag === 1);
  } else if (actor.side === "enemy") {
    // CalcControllerProvider.GetCorpsId returns Front for non-player params.
    if (actor.equipment !== null || actor.row !== "front")
      throw new Error("Unresolved physical row enemy context");
  } else throw new Error("Invalid physical row participant side");
  if (ability.typeId === 602) ignoreCorps = true;
  return {
    actor: actor.row,
    target: request.targetRow,
    ignoreActorPenalty: ignoreCorps || actor.conditionTypes.includes(420) ||
      ability.ignoreRearguardAttack || ability.typeId === 609,
    ignoreTargetPenalty: ignoreCorps,
  };
}
