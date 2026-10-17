import { EventState, int32, type VariableRef } from "./event-state.js";
import type { EquipmentOwnershipCommand } from "./inventory-ownership.js";

/** Inventory is owned by GameState, never by a field or event task. */
export type FieldInventoryCommand =
  | { kind: "grant-item" | "remove-item"; id: number; count: number }
  | { kind: "grant-magic-stone" | "remove-magic-stone"; id: number; count: number }
  | EquipmentOwnershipCommand
  | { kind: "grant-gil"; amount: number }
  | { kind: "pay-gil"; amount: number };

export type FieldInventoryTransaction = {
  /** Only pay-gil returns an affordability result; other commands return null. */
  readonly result: boolean | null;
  /** Publish all owned-state changes once; reject a stale or repeated transaction. */
  commit(): void;
};

export interface FieldInventoryPort {
  /** Preparation must not mutate inventory, Gil, or the owning game state. */
  prepare(command: FieldInventoryCommand): FieldInventoryTransaction;
}

export type InventoryEventOp = {
  kind: "inventory";
  command: FieldInventoryCommand;
  /** Source RemoveGil writes affordability to MapLocalVariable[0]. */
  result: VariableRef | null;
  /** Table references accompany the field script's original source identity. */
  dependencies: { table: string; id: number }[];
};

export function executeInventoryEvent(
  op: InventoryEventOp,
  state: EventState,
  inventory: FieldInventoryPort | undefined,
): void {
  if (!inventory) throw new Error("Field inventory state is unavailable");
  const command = op.command;
  if (
    command.kind === "grant-item" ||
    command.kind === "remove-item" ||
    command.kind === "grant-equipment" ||
    command.kind === "remove-equipment"
  ) {
    if (int32(command.id) <= 0 || int32(command.count) <= 0)
      throw new Error("Invalid field item amount");
  } else if (command.kind === "grant-magic-stone" || command.kind === "remove-magic-stone") {
    if (int32(command.id) <= 0) throw new Error("Invalid magic stone content identity");
    int32(command.count); // Source type-9 dispatch ignores the signed Count operand.
  } else if (command.kind === "grant-gil" || command.kind === "pay-gil") {
    if (int32(command.amount) < 0) throw new Error("Invalid field Gil amount");
  } else throw new Error("Unknown field inventory command");
  if ((command.kind === "pay-gil") !== (op.result !== null))
    throw new Error("Inventory event result contract changed");
  // Check even an uninitialized script-local destination before publishing owned
  // state. No source read is required: the instruction establishes this value.
  if (op.result) new EventState(state.snapshot()).write(op.result, 0);
  const transaction = inventory.prepare(structuredClone(command));
  if (
    (op.result && typeof transaction.result !== "boolean") ||
    (!op.result && transaction.result !== null)
  )
    throw new Error("Invalid inventory event result");
  transaction.commit();
  if (op.result) state.write(op.result, Number(transaction.result));
}
