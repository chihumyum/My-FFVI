import type { BattleConditionCatalog } from "../core/battle-conditions.js";
import type { BattleEffectReader } from "./battle-event-effect.js";
import { tableInteger } from "./table.js";
import { parseBattleEventCondition, type BattleEventCondition } from "../core/battle-event-condition.js";
import type { BattleSourceInstruction } from "../core/battle-branch-execution.js";

/** External.Battle.Condition -> four IBattleAccessor list operations.
 * i2 is a condition master row ID; i3=0 recovers and i3=1 appends. */
export function compileBattleEventCondition(raw: Pick<BattleSourceInstruction, "type" | "mnemonic" | "operands">, reader?: BattleEffectReader): BattleEventCondition {
  const { iValues: i, rValues: r, sValues: s } = raw.operands;
  if (raw.type !== 1 || raw.mnemonic !== "BattleCondition" ||
      i.length !== 8 || r.length !== 8 || s.length !== 8 ||
      i.some(v => !Number.isInteger(v) || v < -2147483648 || v > 2147483647) ||
      r.some(v => v !== 0) || s.some(v => v !== "") ||
      i.slice(4).some(v => v !== 0) || ![1, 2].includes(i[0]!) || ![0, 1].includes(i[3]!))
    throw new Error("Unsupported BattleCondition original operands");
  const op = parseBattleEventCondition({ kind: "condition-list", target: {
    side: i[0] === 1 ? "player" : "enemy", id: i[1] },
    conditionId: i[2], action: i[3] === 0 ? "recover" : "add" });
  if (reader && tableInteger(reader.row("condition.csv", op.conditionId).values.id) !== op.conditionId)
    throw new Error("Source BattleCondition master identity mismatch");
  return op;
}


/** Both the directory producer and content-batch consumer retain these gates.
 * A structurally typed opcode is not live-instance or lifecycle permission. */
export function battleEventConditionDependencies(op: BattleEventCondition, catalog: BattleConditionCatalog) {
  const dependency = { table: "condition.csv", id: op.conditionId };
  const rows: { kind: "blocked" | "runtime-dependency"; code: string; reason: string;
    dependency: { table: string; id: number } }[] = [];
  const add = (code: string, reason: string) => rows.push({ kind: "runtime-dependency", code, reason, dependency });
  if (!catalog.rules.definitions.some(value => value.id === op.conditionId))
    return [{ kind: "blocked" as const, code: "battle-event-condition-reference",
      reason: "Source event condition master is absent from the bound common catalog", dependency }];
  add("battle-event-condition-host", "Reached source condition lists need the explicit Web lifecycle host and actual current instance owner");
  if (op.target.id > 0) add("battle-event-condition-target", "Reached source condition target must resolve its current source character/uniqueId; absence is not an empty provider");
  if (op.action === "add") {
    const behavior = catalog.behaviors.find(value => value.id === op.conditionId);
    if (!behavior) add("battle-event-condition-behavior", "Source event addition retains an unimplemented active condition lifecycle");
    else if (["unable-fight", "dying", "escape", "sleep", "confusion", "temptation", "doom"].includes(behavior.kind))
      add("battle-event-condition-activation", "Source direct append retains a separate life/control/instance activation requirement");
  }
  if (op.target.side === "enemy" && op.conditionId === 5)
    add("battle-event-condition-phase", "Source enemy condition5 needs down-animation synchronization and previous enemy no-act restoration");
  return rows;
}
