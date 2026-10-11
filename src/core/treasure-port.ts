import type { FieldInventoryTransaction } from "./inventory-event.js";
import type { TreasureInventoryLimits, TreasureInventoryRead, TreasureRewardCommand } from "./treasure-inventory.js";

/** A treasure reads and grants through the same durable owner as ordinary
 * inventory events. Candidate map ports must read their draft, not live state. */
export interface FieldTreasurePort {
  readonly limits: TreasureInventoryLimits;
  read(): TreasureInventoryRead;
  prepare(command: TreasureRewardCommand): FieldInventoryTransaction;
}
