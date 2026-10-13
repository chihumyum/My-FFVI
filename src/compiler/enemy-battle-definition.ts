import type { BattleConditionCatalog } from "../core/battle-conditions.js";
import type { AbilityDefinition, BattleEncounterDiagnostic } from "../core/battle-content.js";
import type { EnemyBattleDefinition } from "../core/battle-participants.js";
import type { BattleFormationPlan } from "../core/battle-formations.js";
import type { ParameterLimits, ParameterValues } from "../core/parameters.js";
import type { PhysicalLimits } from "../core/physical-parameters.js";
import type { PhysicalParameters } from "../core/physical.js";
import type { BattleRow } from "./battle.js";
import type { SourceBattleEncounter } from "./battle-encounters.js";
import { battleAIAbilities, compileBattleAI } from "./battle-ai.js";
import { compileEnemyParameters } from "./parameters.js";
import { compileEnemyPhysical } from "./physical-parameters.js";
import { compileElementResistances } from "./elements.js";
import { tableInteger as int } from "./table.js";

type Reader = {
  row(table: string, id: string | number): BattleRow;
  unique(table: string, key: string, value: string): BattleRow;
  group(table: string, key: string, value: string | number): BattleRow[];
  matching(table: string, key: string, value: string | number): BattleRow[];
};
export type EnemyBattleSource = Pick<SourceBattleEncounter["enemies"][number], "monsterId" | "sprite" | "ai">;
export type EnemyBattleDefinitionInput = {
  enemy: EnemyBattleSource;
  abilities: Readonly<Record<string, AbilityDefinition>>;
  conditions: BattleConditionCatalog;
  sprites: Readonly<Record<string, { file: string; width: number; height: number }>>;
  name(key: string): string;
  parameters: { temporary: ParameterValues; limits: ParameterLimits };
  physical: { temporary: PhysicalParameters; limits: PhysicalLimits };
  formationPlan: BattleFormationPlan | null;
};
export type EnemyBattleDefinitionDiagnostic = Pick<BattleEncounterDiagnostic, "kind" | "code" | "reason"> &
  Partial<Pick<BattleEncounterDiagnostic, "dependency" | "pc">>;
export type EnemyBattleDefinitionCompilation = {
  definition: EnemyBattleDefinition | null;
  source: BattleRow["source"] | null;
  diagnostics: EnemyBattleDefinitionDiagnostic[];
};
const identity = (value: number) => Number.isInteger(value) && value > 0 && value <= 0x7fffffff;

/** The same source master compiler serves initial members and late arrivals.
 * Position and instance identity are assigned outside this immutable template.
 * Conditional capability gaps stay in the AI/ability programs and diagnostics. */
export function compileEnemyBattleDefinition(reader: Reader, input: EnemyBattleDefinitionInput): EnemyBattleDefinitionCompilation {
  const { enemy, formationPlan } = input;
  let source: BattleRow["source"] | null = null;
  const diagnostics: EnemyBattleDefinitionDiagnostic[] = [];
  const add = (kind: BattleEncounterDiagnostic["kind"], code: string, reason: string,
    extra: Partial<Pick<BattleEncounterDiagnostic, "dependency" | "pc">> = {}) =>
    diagnostics.push({ kind, code, reason, ...extra });
  try {
    if (!identity(enemy.monsterId)) throw new Error("Invalid enemy master identity");
    const sprite = input.sprites[enemy.sprite];
    if (!sprite || typeof sprite.file !== "string" || !sprite.file.length ||
        !Number.isInteger(sprite.width) || sprite.width <= 0 || !Number.isInteger(sprite.height) || sprite.height <= 0)
      throw new Error("Missing or invalid battle sprite: " + enemy.sprite);
    const found = reader.row("monster.csv", enemy.monsterId), row = found.values;
    source = found.source;
    if (int(row.id) !== enemy.monsterId || found.source.rowId !== String(enemy.monsterId))
      throw new Error("Changed enemy source identity");
    for (const key of ["attack_attribute", "attack_plus", "attack_plus_grop", "resistance_condition", "initial_condition"])
      if (int(row[key]) !== 0) throw new Error(`Unimplemented monster ${key}=${row[key]}`);
    const parameters = compileEnemyParameters(reader, enemy.monsterId,
      input.parameters.temporary, input.parameters.limits).confirmed;
    const physical = compileEnemyPhysical(reader, enemy.monsterId,
      input.physical.temporary, input.physical.limits).confirmed;
    if (!identity(int(row.lv)) || parameters.hp <= 0 || int(row.exp) < 0 || int(row.gill) < 0)
      throw new Error("Invalid initial enemy level, life or rewards");
    const ai = compileBattleAI(enemy.ai.data, enemy.ai.source);
    if (ai.blockers.length) throw new Error("Unresolved AI entry: " + ai.blockers.join("; "));
    const abilityIds = battleAIAbilities(ai);
    for (const [pc, instruction] of ai.instructions.entries()) {
      const op = instruction.op;
      if (op.kind === "blocked") add("runtime-dependency", "ai-instruction", op.reason, { pc });
      if (op.kind === "condition" && !input.conditions.rules.definitions.some(condition => condition.id === op.conditionId))
        add("blocked", "ai-condition", `Missing AI condition ${op.conditionId}`,
          { pc, dependency: { table: "condition.csv", id: op.conditionId } });
      if (!("abilities" in op) || !["act", "counter-act", "loop-act"].includes(op.kind)) continue;
      for (const id of op.abilities) {
        const ability = input.abilities[id], dependency = { table: "ability.csv", id };
        if (!ability || ability.id !== id) add("blocked", "ability-reference", `Missing AI ability ${id}`, { pc, dependency });
        else if (!ability.plan) add("runtime-dependency", "ability-plan",
          `Ability ${id}: ${ability.blockers.join("; ") || "unimplemented plan"}`, { pc, dependency });
        else if (![3, 7].includes(ability.program.range) || ability.plan.targeting.life !== "alive")
          add("runtime-dependency", "automatic-target", `Unimplemented automatic target range for ability ${id}`, { pc, dependency });
        else if (ability.plan.targeting.normalFormationOnly && formationPlan &&
          (formationPlan.kind === "fixed" ? formationPlan.pattern !== 1
            : formationPlan.patterns[2] === 1 && formationPlan.policy.weights[2] > 0))
          add("runtime-dependency", "ability-formation", `Unimplemented formation for ability ${id}`, { pc, dependency });
      }
    }
    return { source, diagnostics, definition: {
      sourceId: enemy.monsterId, name: input.name(row.mes_id_name!), side: "enemy", row: "front",
      level: int(row.lv), attackElements: [],
      elementResistances: compileElementResistances(reader, int(row.resistance_attribute)).resistances,
      physical, ...parameters, exp: int(row.exp), gil: int(row.gill), growthGroup: null,
      abilities: abilityIds, commands: [], conditionIds: [], conditionResistances: {}, ai,
      sprites: { idle: enemy.sprite, mount: null },
    } };
  } catch (error) {
    add("blocked", "enemy-provider", error instanceof Error ? error.message : String(error),
      { dependency: { table: "monster.csv", id: enemy.monsterId } });
    return { source, diagnostics, definition: null };
  }
}
