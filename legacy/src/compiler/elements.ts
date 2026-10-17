import { tableInteger as int } from "./table.js";
import type { BattleRow } from "./battle.js";
import {
  mergeElementResistances,
  validateElements,
  validateElementResistances,
  type ElementResistances,
  type ElementResistance,
} from "../core/elements.js";

type Reader = {
  row(table: string, id: string | number): BattleRow;
  group(table: string, key: string, value: string | number): BattleRow[];
};
function element(reader: Reader, id: number, sources: BattleRow[]) {
  validateElements([id]);
  sources.push(reader.row("attribute.csv", id));
  return id;
}

/** GetAbilityAttributeArray 0x3d5d60 / active-group callback 0x4ef3a0. */
export function compileAttackElements(
  reader: Reader,
  attributeId: number,
  groupId: number,
) {
  const sources: BattleRow[] = [];
  if (attributeId < 0 || groupId < 0)
    throw new Error("Negative element reference");
  const elements = groupId
    ? reader
        .group("attribute_group.csv", "group_id", groupId)
        .flatMap((row) => {
          sources.push(row);
          return [0, 5].includes(int(row.values.type_id))
            ? [element(reader, int(row.values.attribute_id), sources)]
            : [];
        })
    : attributeId
      ? [element(reader, attributeId, sources)]
      : [];
  return { elements, sources };
}

/** Native callback keeps the first enumerated row. Until master dictionary
 * order is recovered, conflicting duplicates must not inherit CSV order. */
export function compileElementResistances(reader: Reader, groupId: number) {
  if (groupId < 0) throw new Error("Negative resistance group");
  const rows = reader.group("attribute_group.csv", "group_id", groupId);
  const sources: BattleRow[] = [];
  const resistances: ElementResistances = {};
  const shadowedRowIds: string[] = [];
  for (const row of rows) {
    sources.push(row);
    const id = element(reader, int(row.values.attribute_id), sources);
    const value = int(row.values.type_id) as ElementResistance;
    validateElementResistances({ [id]: value });
    if (Object.hasOwn(resistances, id)) {
      if (resistances[id] !== value)
        throw new Error(
          `Unreviewed conflicting element rows in group ${groupId}, element ${id}`,
        );
      shadowedRowIds.push(row.source.rowId);
    } else resistances[id] = value;
  }
  return { resistances, shadowedRowIds, sources };
}

/** Projection of explicit equipment, not an equipment eligibility/unlock decision. */
export function compileEquipmentElements(
  reader: Reader,
  contentIds: number[],
  selectedArm: 1 | 2,
) {
  if (contentIds.length !== 6 || ![1, 2].includes(selectedArm))
    throw new Error("Invalid elemental equipment context");
  const sources: BattleRow[] = [];
  const pieces: ElementResistances[] = [];
  let attackElements: number[] = [];
  for (const [slot, id] of contentIds.entries()) {
    const content = reader.row("content.csv", id);
    sources.push(content);
    const type = int(content.values.type_id);
    if (![2, 3].includes(type))
      throw new Error("Unresolved elemental equipment content");
    const row = reader.row(
      type === 2 ? "weapon.csv" : "armor.csv",
      content.values.type_value!,
    );
    sources.push(row);
    if (type === 3) {
      const resistance = compileElementResistances(
        reader,
        int(row.values.resistance_attribute),
      );
      pieces.push(resistance.resistances);
      sources.push(...resistance.sources);
    } else if (slot + 1 === selectedArm) {
      // FF6 provider 0x858e80 uses selected weapon's single attribute, not the group.
      if (int(row.values.attribute_group_id))
        throw new Error("Unreviewed weapon attribute group");
      const attack = compileAttackElements(
        reader,
        int(row.values.attribute_id),
        0,
      );
      attackElements = attack.elements;
      sources.push(...attack.sources);
    }
  }
  return {
    attackElements,
    resistances: mergeElementResistances(...pieces),
    sources,
  };
}
