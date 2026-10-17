import { int32, integerOperation, isOperator, type Operator } from "./script-integer.js";

/** These are independent source fields. Targetability is not a synonym for
 * HP, presence in the formation, or the game-over predicate. */
export type BattleEventRules = {
  conditions: { id: number; type: number; attackTarget: number; gameOverTarget: number }[];
};
export type BattleEventBranchOp = (
  | { kind: "only-alive" }
  | { kind: "unit-alive-count"; side: "player" | "enemy"; value: number; operator: Operator }
) & { target: number };
export type BattleEventContext = {
  rules: BattleEventRules;
  selfId: string;
  /** Current accessor units, including defeated units. The source formation
   * has at most nine enemy slots; absent slots have no parameter. */
  units: readonly {
    id: string;
    side: "player" | "enemy";
    conditionIds: readonly number[];
    removed: boolean;
  }[];
  /** IsNotTargeting has an explicit ActType.FinalAttack exception. null means
   * no such staged action, not an unknown first target. */
  finalAttackFirstTargetSide: "player" | "enemy" | null;
};

export function validateBattleEventRules(rules: BattleEventRules) {
  if (!rules || !Array.isArray(rules.conditions))
    throw new Error("Missing battle event condition rules");
  const seen = new Set<number>();
  for (const c of rules.conditions) {
    if (!c || int32(c.id) <= 0 || int32(c.type) < 0 ||
        int32(c.attackTarget) < 0 || int32(c.gameOverTarget) < 0 || seen.has(c.id))
      throw new Error("Invalid battle event condition rule");
    seen.add(c.id);
  }
}

/** Shared IsGameOverByUnit 4d2d00 provider. It deliberately does not read HP,
 * sprite side, removed flags or the separate Escape/targeting predicates. */
export function battleEventUnitGameOver(rules: BattleEventRules, conditionIds: readonly number[]): boolean {
  validateBattleEventRules(rules);
  const active = conditionIds.map(id => {
    int32(id); const row = rules.conditions.find(c => c.id === id);
    if (!row) throw Error("Missing game-over condition metadata: " + id); return row;
  });
  if (active.some(c => c.type === 602)) throw Error("Unimplemented battle event type 602 game-over exception");
  return active.some(c => c.gameOverTarget === 1);
}

/** ConditionUtility.IsBattleEndByUnit: the game-over predicate OR type 3.
 * AI-core lifetime uses this rule plus the global executor queues; HP alone
 * cannot answer it. This does not admit new active condition controllers. */
export function battleEventUnitEnded(rules: BattleEventRules, conditionIds: readonly number[]): boolean {
  validateBattleEventRules(rules);
  const conditions = conditionIds.map(id => {
    int32(id);
    const condition = rules.conditions.find(row => row.id === id);
    if (!condition) throw new Error(`Missing battle event condition ${id}`);
    return condition;
  });
  if (conditions.some(condition => condition.type === 602))
    throw new Error("Unimplemented battle event type 602 game-over exception");
  return conditions.some(condition => condition.gameOverTarget === 1 || condition.type === 3);
}

/** BattleAI.IsOnlyAlive / IsUnitAliveCount. No normal/counter readiness gate
 * appears in either instruction. The VM owns the label+1 step and publication.
 * This function never changes the unit lists or caches a second life state. */
export function evaluateBattleEventBranch(op: BattleEventBranchOp, context: BattleEventContext | undefined): boolean {
  if (!context) throw new Error("Missing battle event unit context");
  validateBattleEventRules(context.rules);
  if (!Array.isArray(context.units) || typeof context.selfId !== "string" || !context.selfId ||
      ![null, "player", "enemy"].includes(context.finalAttackFirstTargetSide))
    throw new Error("Invalid battle event unit context");
  const rules = new Map(context.rules.conditions.map((c) => [c.id, c]));
  const ids = new Set<string>();
  const units = context.units.map((unit: BattleEventContext["units"][number]) => {
    if (!unit || typeof unit.id !== "string" || !unit.id || ids.has(unit.id) ||
        !["player", "enemy"].includes(unit.side) || typeof unit.removed !== "boolean" ||
        !Array.isArray(unit.conditionIds)) throw new Error("Invalid battle event unit identity");
    ids.add(unit.id);
    const conditions = unit.conditionIds.map((id: number) => {
      int32(id);
      const condition = rules.get(id);
      if (!condition) throw new Error(`Missing battle event condition ${id}`);
      return condition;
    });
    return { ...unit, conditions };
  });
  const enemies = units.filter((u) => u.side === "enemy");
  if (enemies.length > 9 || !enemies.some((u) => u.id === context.selfId))
    throw new Error("Missing or invalid battle event enemy owner");
  switch (op.kind) {
    case "only-alive":
      // 0x825770 skips the calling enemy slot, without testing its own life.
      return enemies.filter((u) => u.id !== context.selfId).every((unit) => {
        if (unit.removed) return true;
        // 0x769f20 checks removal BEFORE its staged-final-attack override.
        if (context.finalAttackFirstTargetSide === "enemy") return false;
        return unit.conditions.some((c) => c.attackTarget === 1 || c.attackTarget === 3) &&
          !unit.conditions.some((c) => c.type === 680);
      });
    case "unit-alive-count": {
      if (!["player", "enemy"].includes(op.side) || !isOperator(op.operator))
        throw new Error("Invalid battle event count operation");
      int32(op.value);
      const selected = units.filter((u) => u.side === op.side);
      // ConditionUtility 0x4d2d00 has an additional type602 + static-array
      // exception. That active behavior is not admitted by this host. Never
      // silently treat it as ordinary game_over_target metadata.
      if (selected.some((u) => u.conditions.some((c) => c.type === 602)))
        throw new Error("Unimplemented battle event type 602 game-over exception");
      const count = selected.filter((u) => !u.conditions.some((c) => c.gameOverTarget === 1)).length;
      return integerOperation(count, op.operator, op.value) === 1;
    }
  }
}
