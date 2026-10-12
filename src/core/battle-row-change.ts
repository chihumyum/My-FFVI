import { validateBattleRow, type BattleRow } from "./battle-row.js";

export type ChangeBattleRowEffect = { kind: "change-row"; slot: number };
export type ChangeBattleRowResult = {
  resource: "row";
  slot: number;
  before: BattleRow;
  after: BattleRow;
  missed: false;
};

/** BattleFunction17.UpdateParameter (0x97a3a0), CurrentTargetType.Self=6:
 * mutate the first target's Corps.Id through GetChangeCorpsId (0x764400).
 * The source also has a group branch that can touch non-target Corps entries;
 * that branch is deliberately not represented by this self-action provider. */
export function changeBattleRow(
  effect: ChangeBattleRowEffect,
  actor: { id: string; side: "player" | "enemy" },
  target: { id: string; side: "player" | "enemy"; row: BattleRow | undefined },
): ChangeBattleRowResult {
  if (effect.kind !== "change-row" || effect.slot !== 1 ||
      !actor.id || actor.id !== target.id || actor.side !== "player" || target.side !== "player")
    throw new Error("Change row requires the source player self target");
  validateBattleRow(target.row);
  const before = target.row as BattleRow;
  return { resource: "row", slot: effect.slot, before,
    after: before === "front" ? "back" : "front", missed: false };
}
