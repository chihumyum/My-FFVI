import { equipmentGameFixture } from "./equipment-game.js";
import { GameState } from "../../src/core/game-state.js";

/** Deliberately different from source row 53 and type 607. */
export const magitekRowId = 9007;
export function ownedConditionGameFixture() {
  const { catalog } = equipmentGameFixture();
  catalog.common.conditions.rules.definitions.push({ id: magitekRowId, type: 607, overlapped: false, eraseGroupId: 3 });
  catalog.common.conditions.behaviors.push({ id: magitekRowId, kind: "magitek", name: "", untilType: 3 });
  catalog.gameState.fieldConditions = {
    definitions: catalog.common.conditions.rules.definitions.map(({ id, type }) => ({ id, type })),
    behaviors: catalog.common.conditions.behaviors.map(({ id }) => ({ id, kind: "none" })),
    dying: { ...catalog.common.conditions.dying },
    transportations: [{ id: 101, type: 1 }, { id: 106, type: 12 }],
  };
  const make = () => new GameState(catalog.gameState, catalog.common.players,
    catalog.contentHash, catalog.common.conditions);
  return { catalog, make, state: make() };
}

export function magitekMasterRow() {
  return Object.fromEntries(Object.entries({
    id: magitekRowId, condition_type: 607, system_type: 4, resistance_decision: 1, until_type: 3,
    until_value: 0, overlapped_type: 0, invalid_type: 0, target_type: 0,
    condition_group_id: 0, parameter_group_id: 0, attribute_group_id: 0, species_group_id: 0,
    rate_type1: 0, rate_type2: 0, rate_value1: 0, rate_value2: 0, recovery_invalid: 0,
    attack_target: 0, game_over_target: 0, state_cover_unavailable: 0, damage_number: 0,
    battle_effect_asset_id: 0, battle_effect_shadow_cloning: 0, field_se_asset_id: 0, icon_id: 0,
  }).map(([key, value]) => [key, String(value)]));
}
