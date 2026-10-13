import { protectionFixture } from "./protection.js";

/** Authored source-shaped records. Neither these IDs nor groups are the source
 * monster/condition IDs; the same compiler must bind their relationships. */
export function initialProtectionFixture() {
  const fixture = protectionFixture();
  fixture.special.erase_condition_group_id = "18";
  const shell = { ...fixture.magic, id: "194", condition_group_id: "909", erase_condition_group_id: "19" };
  fixture.tables["condition.csv"]!.push(shell);
  fixture.tables["condition_group.csv"] = [
    { id: "11", group_id: "908", condition_id: "123", type_id: "1", invocation_rate: "0" },
    { id: "12", group_id: "909", condition_id: "122", type_id: "1", invocation_rate: "0" },
    { id: "13", group_id: "1007", condition_id: "193", type_id: "1", invocation_rate: "0" },
    { id: "14", group_id: "1008", condition_id: "194", type_id: "1", invocation_rate: "0" },
  ];
  fixture.tables["erase_condition_group.csv"]!.push(
    { id: "3", group_id: "18", condition_id: "0", type_id: "3", erase_condition: "123" },
    { id: "4", group_id: "19", condition_id: "0", type_id: "3", erase_condition: "122" },
  );
  return { ...fixture, shell };
}
