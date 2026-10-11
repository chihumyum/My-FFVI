import {
  validateEquipmentState,
  type EquipmentCatalog,
  type EquipmentLoadout,
  type EquipmentStock,
} from "./equipment.js";
import { int32 } from "./script-integer.js";

export type EquipmentOwnershipCommand = {
  kind: "grant-equipment" | "remove-equipment";
  /** Content identity, distinct from the weapon/armor row identity. */
  id: number;
  count: number;
};

/** Pure owned-count projection. Publication and stale-state checks belong to
 * GameState. Native Count includes worn copies; this never changes a loadout. */
export function projectEquipmentOwnership(
  catalog: EquipmentCatalog,
  fullRoster: readonly EquipmentLoadout[],
  stock: readonly EquipmentStock[],
  command: EquipmentOwnershipCommand,
): EquipmentStock[] {
  if (
    !["grant-equipment", "remove-equipment"].includes(command.kind) ||
    int32(command.id) <= 0 ||
    int32(command.count) <= 0
  )
    throw new Error("Invalid equipment ownership command");
  validateEquipmentState(catalog, fullRoster, stock);
  const definition = catalog.definitions[command.id];
  if (!definition || definition.id !== command.id)
    throw new Error("Unknown equipment ownership identity");
  if (definition.empty)
    throw new Error("Empty equipment placeholders cannot be owned stock");
  const next = stock.map((entry) => ({ ...entry }));
  let entry = next.find((entry) => entry.id === command.id);
  if (command.kind === "grant-equipment") {
    // AddOwnedItem 0x7f79a0 bounds the incoming count before merging, then
    // bounds total Count. Unsupported wear effects do not execute on receipt.
    if (!entry) next.push((entry = { id: command.id, count: 0 }));
    const total = int32(entry.count + Math.min(catalog.limit, command.count));
    entry.count = Math.min(catalog.limit, total);
  } else if (entry) {
    // RemoveOwnedItem 0x7fd6d0 subtracts Count and removes exhausted stacks.
    // set_Count 0x8e0f30 writes saveData.Count directly, without unequipping.
    const remaining = Math.max(0, entry.count - command.count);
    const occupied = fullRoster.reduce(
      (count, owner) =>
        count + owner.equipment.filter((id) => id === command.id).length,
      0,
    );
    if (remaining < occupied)
      throw new Error("Unimplemented removal of equipped ownership");
    // A zero record is the shared inventory's canonical exhausted-stack form.
    entry.count = remaining;
  }
  next.sort((a, b) => a.id - b.id);
  validateEquipmentState(catalog, fullRoster, next);
  return next;
}
