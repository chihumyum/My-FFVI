import { conditionBlindFixture } from "./condition-blind.js";
import { initialProtectionFixture } from "./initial-protection.js";
import { fixture } from "./battle-content.js";

/** Source-shaped authored identities deliberately differ from type and native ID. */
export function levitateFixture() {
  const f = conditionBlindFixture(), p = initialProtectionFixture();
  for (const id of [123, 122, 193, 194])
    f.tables["condition.csv"]!.push(structuredClone(p.tables["condition.csv"]!.find(r => Number(r.id) === id)!));
  f.tables["condition_group.csv"] = [
    { id: "1", group_id: "910", condition_id: "121", type_id: "1", invocation_rate: "0" },
    { id: "2", group_id: "910", condition_id: "125", type_id: "1", invocation_rate: "0" },
    { id: "3", group_id: "9304", condition_id: "109", type_id: "1", invocation_rate: "0" },
    { id: "4", group_id: "908", condition_id: "123", type_id: "1", invocation_rate: "0" },
    { id: "5", group_id: "909", condition_id: "122", type_id: "1", invocation_rate: "0" },
    { id: "6", group_id: "9311", condition_id: "117", type_id: "1", invocation_rate: "0" },
  ];
  f.tables["erase_condition_group.csv"]!.push(...p.tables["erase_condition_group.csv"]!.filter(r => ["18", "19"].includes(r.group_id!)).map((r,i)=>({...r,id:String(30+i)})));
  Object.assign(f.stop, {condition_type:"409",system_type:"1",until_type:"3",until_value:"0",attribute_group_id:"86",icon_id:"74"});
  const levitate = { ...f.tables["condition.csv"]![0]!, id: "196", condition_type: "409", mes_id_name: "FLOAT",
    icon_id: "74", condition_group_id: "9311", attribute_group_id: "86", erase_condition_group_id: "21" };
  f.tables["condition.csv"]!.push(levitate);
  f.tables["attribute_group.csv"] = [{ id: "12", group_id: "86", attribute_id: "4", type_id: "3", mes_id_name: "None" }];
  f.tables["attribute.csv"] = [{ id: "4", mes_id_name: "EARTH" }];
  f.tables["erase_condition_group.csv"]!.push({ id: "21", group_id: "21", condition_id: "196", type_id: "2", erase_condition: "0" });
  const group = (ids: number[]) => {
    f.tables["condition_group.csv"] = f.tables["condition_group.csv"]!.filter(r => r.group_id !== "8999");
    f.tables["condition_group.csv"]!.push(...ids.map((id, i) => ({ id: String(800 + i), group_id: "8999", condition_id: String(id), type_id: "-12", invocation_rate: "99" })));
    return 8999;
  };
  return { ...f, levitate, group };
}
export function levitateBattle() {
  const content = fixture(), f = levitateFixture();
  // Retain the existing fixture's HP-zero/AI references while adding the new family.
  const c = f.compile().catalog;
  content.conditions.rules.definitions.push(...c.rules.definitions);
  content.conditions.rules.eraseRules.push(...c.rules.eraseRules.map((r, i) => ({ ...r, id: 10000 + i })));
  content.conditions.behaviors.push(...c.behaviors);
  for (const enemy of content.enemies) { enemy.conditionIds = [196]; enemy.hp = 1000; }
  return { content, f };
}
