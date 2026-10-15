import { checkpointInteger, checkpointKeys } from "./checkpoint-validation.js";

/** A Web condition lifecycle phase; it does not grant any new active behavior. */
export const WEB_BATTLE_EVENT_CONDITIONS = "web-source-battle-condition-lists-v1" as const;
export type WebBattleEventConditions = typeof WEB_BATTLE_EVENT_CONDITIONS;
export type BattleEventCondition = {
  kind: "condition-list";
  target: { side: "player" | "enemy"; id: number };
  conditionId: number;
  action: "add" | "recover";
};
export function validateBattleEventConditions(raw: unknown): void {
  if (raw !== undefined && raw !== WEB_BATTLE_EVENT_CONDITIONS)
    throw new Error("Unknown Web battle condition-list lifecycle policy");
}
export function parseBattleEventCondition(raw: unknown): BattleEventCondition {
  checkpointKeys(raw, "kind,target,conditionId,action");
  const op = raw as BattleEventCondition;
  checkpointKeys(op.target, "side,id");
  checkpointInteger(op.target.id, -2147483648, 2147483647);
  checkpointInteger(op.conditionId, 1, 2147483647);
  if (op.kind !== "condition-list" || !["player", "enemy"].includes(op.target.side) ||
      !["add", "recover"].includes(op.action) || op.target.side === "enemy" && op.target.id > 9)
    throw new Error("Unsupported source BattleCondition selector or identity");
  return structuredClone(op);
}
