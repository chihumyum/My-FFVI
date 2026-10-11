import { conditionSpeedAbilityFixture, conditionSpeedFixture } from "./condition-speed.js";

function addBlind<T extends ReturnType<typeof conditionSpeedFixture>>(f: T) {
  const blind = { ...f.tables["condition.csv"]![0]!, id: "109", condition_type: "9",
    mes_id_name: "STATE_BLIND", battle_effect_asset_id: "870", icon_id: "71" };
  const special = { ...blind, id: "189", condition_group_id: "9304", erase_condition_group_id: "1" };
  const effect = { id: "870", asset_name: "synthetic-blind", display_type: "0", position_type: "5",
    critical_se_asset_id: "0", se_asset_id: "874", se_asset_id_2: "0" };
  f.tables["condition.csv"]!.push(blind, special);
  f.tables["battle_effect_asset.csv"] = [effect];
  f.tables["se_asset.csv"] = [{ id: "874", asset_name: "synthetic-se" }];
  f.tables["transportation.csv"]!.push({ id: "101", type_id: "1" });
  return { ...f, blind, specialBlind: special, effect };
}

export const conditionBlindFixture = () => addBlind(conditionSpeedFixture());
export function conditionBlindAbilityFixture() {
  const f = addBlind(conditionSpeedAbilityFixture("slow"));
  Object.assign(f.ability, { type_id: "3", system_id: "5", accuracy_rate: "100",
    battle_renge_id: "3", content_flag_group_id: "0", invalid_reflection: "1" });
  f.group.function1_value1 = "109";
  return f;
}
