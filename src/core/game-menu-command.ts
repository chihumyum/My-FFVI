import { parseBattlePreferences, type BattlePreferences } from "./battle-preferences.js";
import { checkpointInteger } from "./checkpoint-validation.js";
import type { PartyMenuChange } from "./party-menu.js";
import type { PartyPosition, PartySlotIndex } from "./party.js";

/** Explicit user inputs. Inventory, equipment, party and preferences retain
 * their existing owners and context-dependent qualification rules. */
export type GameMenuCommand =
  | { kind: "use-item"; itemId: number; targetId: string }
  | { kind: "use-ability"; actorId: string; abilityId: number;
      selection: { kind: "single"; id: string } | { kind: "all" } }
  | { kind: "change-equipment"; playerId: string; slot: number; contentId: number }
  | { kind: "change-party"; change: PartyMenuChange }
  | { kind: "set-preferences"; preferences: BattlePreferences };

function plainObject(raw: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(raw);
  if (prototype === null) return true;
  if (typeof prototype !== "object" || Object.getPrototypeOf(prototype) !== null) return false;
  const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor");
  if (!constructor || !("value" in constructor) || typeof constructor.value !== "function") return false;
  const binding = Object.getOwnPropertyDescriptor(constructor.value, "prototype");
  return binding?.value === prototype &&
    Function.prototype.toString.call(constructor.value) === Function.prototype.toString.call(Object);
}

function record(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !plainObject(raw))
    throw new Error("Invalid game menu command object");
  const descriptors: Record<string, PropertyDescriptor> = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(raw).some(key => typeof key !== "string") ||
      Object.values(descriptors).some(descriptor => !("value" in descriptor) || !descriptor.enumerable))
    throw new Error("Invalid game menu command fields");
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}

function keys(value: Record<string, unknown>, expected: string): void {
  if (Object.keys(value).sort().join(",") !== expected.split(",").sort().join(","))
    throw new Error("Invalid game menu command fields");
}
function kind(value: Record<string, unknown>): unknown {
  return Object.getOwnPropertyDescriptor(value, "kind")?.value;
}
function integer(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== "number") throw new Error("Invalid game menu command integer");
  checkpointInteger(value, minimum, maximum);
  return value;
}
function ownedId(value: unknown): string {
  if (typeof value !== "string" || !value.length || value.length > 160 || value.trim() !== value)
    throw new Error("Invalid game menu command owned identity");
  return value;
}
function abilitySelection(raw: unknown): { kind: "single"; id: string } | { kind: "all" } {
  const value = record(raw);
  if (kind(value) === "single") {
    keys(value, "kind,id");
    return { kind: "single", id: ownedId(value.id) };
  }
  if (kind(value) === "all") {
    keys(value, "kind");
    return { kind: "all" };
  }
  throw new Error("Invalid field ability selection");
}
function partyChange(raw: unknown): PartyMenuChange {
  const value = record(raw);
  if (kind(value) === "swap") {
    keys(value, "kind,from,to");
    return { kind: "swap", from: integer(value.from, 0, 3) as PartyPosition,
      to: integer(value.to, 0, 3) as PartyPosition };
  }
  if (kind(value) === "set-row") {
    keys(value, "kind,position,row");
    if (value.row !== "front" && value.row !== "back") throw new Error("Invalid party menu row");
    return { kind: "set-row", position: integer(value.position, 0, 3) as PartyPosition, row: value.row };
  }
  if (kind(value) === "set-member") {
    keys(value, "kind,slot,position,ownedId,row");
    if (value.row !== "front" && value.row !== "back") throw new Error("Invalid party menu row");
    return { kind: "set-member", slot: integer(value.slot, 0, 2) as PartySlotIndex,
      position: integer(value.position, 0, 3) as PartyPosition,
      ownedId: value.ownedId === null ? null : ownedId(value.ownedId), row: value.row };
  }
  if (kind(value) === "select-slot") {
    keys(value, "kind,slot");
    return { kind: "select-slot", slot: integer(value.slot, 0, 2) as PartySlotIndex };
  }
  throw new Error("Unknown party menu change");
}

/** Snapshot a declared input before admission. Invalid typed inputs throw;
 * valid commands can still be refused by the actual session's existing ports. */
export function parseGameMenuCommand(raw: unknown): GameMenuCommand {
  const value = record(raw);
  switch (kind(value)) {
    case "use-item":
      keys(value, "kind,itemId,targetId");
      return { kind: "use-item", itemId: integer(value.itemId, 1, 0x7fffffff), targetId: ownedId(value.targetId) };
    case "use-ability":
      keys(value, "kind,actorId,abilityId,selection");
      return { kind: "use-ability", actorId: ownedId(value.actorId),
        abilityId: integer(value.abilityId, 1, 0x7fffffff), selection: abilitySelection(value.selection) };
    case "change-equipment":
      keys(value, "kind,playerId,slot,contentId");
      return { kind: "change-equipment", playerId: ownedId(value.playerId), slot: integer(value.slot, 1, 6),
        contentId: integer(value.contentId, 1, 0x7fffffff) };
    case "change-party":
      keys(value, "kind,change");
      return { kind: "change-party", change: partyChange(value.change) };
    case "set-preferences": {
      keys(value, "kind,preferences");
      const preferences = record(value.preferences);
      keys(preferences, "mode,speedIndex");
      return { kind: "set-preferences", preferences: parseBattlePreferences(preferences) };
    }
    default: throw new Error("Unknown game menu command");
  }
}
