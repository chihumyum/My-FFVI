import { validateBattleEventRules, type BattleEventBranchOp, type BattleEventRules } from "../core/battle-event-context.js";
import { int32, isOperator } from "../core/script-integer.js";
import type { BattleRow } from "./battle.js";
import { tableInteger } from "./table.js";

export function compileBattleEventRules(
  reader: { row(table: string, id: string | number): BattleRow },
  conditionIds: readonly number[],
): { rules: BattleEventRules; sources: BattleRow[] } {
  if (!conditionIds.length || new Set(conditionIds).size !== conditionIds.length ||
      conditionIds.some((id) => int32(id) <= 0)) throw new Error("Invalid battle event condition selection");
  const sources = conditionIds.map((id) => {
    const row = reader.row("condition.csv", id);
    if (row.source.rowId !== String(id) || tableInteger(row.values.id) !== id)
      throw new Error("Changed battle event condition source identity");
    return row;
  });
  const rules: BattleEventRules = { conditions: sources.map(({ values: row }) => ({
    id: tableInteger(row.id), type: tableInteger(row.condition_type),
    attackTarget: tableInteger(row.attack_target), gameOverTarget: tableInteger(row.game_over_target),
  })) };
  validateBattleEventRules(rules);
  return { rules, sources };
}

/** The enclosing compiler has established the type1 instruction and segment.
 * Unsupported encodings remain a source-PC stop, never an implicit branch. */
export function compileBattleEventBranch(
  mnemonic: string,
  operands: { iValues: number[]; rValues: number[]; sValues: string[] },
  range: { entry: number; end: number },
): BattleEventBranchOp | { kind: "blocked"; reason: string } | null {
  if (!["IsOnlyAlive", "IsUnitAliveCount"].includes(mnemonic)) return null;
  const blocked = { kind: "blocked" as const, reason: `unsupported AI instruction or operands: ${mnemonic}` };
  const { iValues: i, rValues: r, sValues: s } = operands;
  const signed = (v: number) => Number.isInteger(v) && v >= -0x80000000 && v <= 0x7fffffff;
  if (!i.every(signed) || !r.every((v) => v === 0) ||
      !Number.isInteger(range.entry) || !Number.isInteger(range.end) || range.entry < 0 || range.end <= range.entry)
    return blocked;
  const target = (v: number | undefined): v is number => v !== undefined && v >= range.entry && v < range.end;
  if (mnemonic === "IsOnlyAlive") {
    if (target(i[0]) && i.slice(1).every((v) => v === 0) && s.every((v) => v === ""))
      return { kind: "only-alive", target: i[0] };
  } else if ([1, 2].includes(i[0]!) && i[1] !== undefined && target(i[2]) &&
      i.slice(3).every((v) => v === 0) && s[0] !== undefined && isOperator(s[0]) &&
      s.slice(1).every((v) => v === "")) {
    return { kind: "unit-alive-count", side: i[0] === 1 ? "player" : "enemy",
      value: i[1], operator: s[0], target: i[2] };
  }
  return blocked;
}
