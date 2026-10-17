import {
  equipmentAbilityCostProviders,
  type EquipmentCatalog,
  type EquipmentLoadout,
} from "./equipment.js";

/** Costs are projected, never reserved or subtracted here. The action host owns
 * the single payment together with effects/RNG/inventory in its transaction. */
export type AbilityCostOwner =
  | { side: "enemy" }
  | { side: "player"; catalog: EquipmentCatalog; loadout: EquipmentLoadout };
export type AbilityCostProjection = {
  baseMp: number;
  mp: number;
  modifier: "none" | "half" | "one";
  /** Equipped content identities, including separately worn copies. */
  contentIds: number[];
};

/** ConfirmUseValue is already compiled for admitted level-zero abilities. The
 * play-time replacement for ability 154 remains outside this input contract.
 * Item/copy/rampage/weapon-added/slot acts bypass UseMp at the action host. */
export function projectAbilityCost(
  ability: { id: number; cost: number },
  owner: AbilityCostOwner,
): AbilityCostProjection {
  if (!Number.isInteger(ability.id) || ability.id <= 0 || ability.id === 154)
    throw new Error("Unresolved ability cost provider");
  const baseMp = ability.cost;
  if (!Number.isInteger(baseMp) || baseMp < 0 || baseMp > 0x7fffffff)
    throw new Error("Invalid base ability MP cost");
  const providers = owner.side === "enemy" ? [] : owner.side === "player"
    ? equipmentAbilityCostProviders(owner.catalog, owner.loadout)
    : (() => { throw new Error("Unresolved ability cost owner"); })();
  const contentIds = providers.map((provider) => provider.contentId);
  // Native GetMPDiameter returns the original zero before checking either relic.
  const modifier = baseMp === 0 ? "none" : providers.some((p) => p.modifier === "one")
    ? "one" : providers.some((p) => p.modifier === "half") ? "half" : "none";
  // 0x85b3d0 converts int -> float32 before multiplying by 0.5f, then calls
  // Math.Round(double, MidpointRounding.AwayFromZero), not round-to-even.
  const mp = modifier === "one" ? 1 : modifier === "half"
    ? Math.floor(Math.fround(Math.fround(baseMp) * 0.5) + 0.5) : baseMp;
  return { baseMp, mp, modifier, contentIds };
}
