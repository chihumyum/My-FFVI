import {parseWebEnemySpawnConditions,type WebEnemySpawnConditions} from '../core/battle-spawn-conditions.js';
import { BattleConditions, type BattleConditionCatalog } from "../core/battle-conditions.js";
import { battleAITargetBlocker } from "../core/battle-ai-targets.js";
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
import { compileConditionResistances, ConditionResistanceCompilationError } from "./condition-resistances.js";
import { compileEnemyInitialConditions, InitialConditionCompilationError } from "./initial-conditions.js";
import { compileSourceEnemyConditionTraits } from "./source-condition-application.js";

type Reader = {
  ordered?(table: string): BattleRow[];
  row(table: string, id: string | number): BattleRow;
  unique(table: string, key: string, value: string): BattleRow;
  group(table: string, key: string, value: string | number): BattleRow[];
  matching(table: string, key: string, value: string | number): BattleRow[];
};
export type EnemyBattleSource = Pick<SourceBattleEncounter["enemies"][number], "monsterId" | "sprite" | "ai">;
export type EnemyBattleDefinitionInput = {
  enemy: EnemyBattleSource;
  entryPhase: "initial" | "late";
  spawnConditionPolicy?:WebEnemySpawnConditions;
  abilities: Readonly<Record<string, AbilityDefinition>>;
  conditions: BattleConditionCatalog;
  sprites: Readonly<Record<string, { file: string; width: number; height: number }>>;
  name(key: string): string;
  parameters: { temporary: ParameterValues; limits: ParameterLimits };
  physical: { temporary: PhysicalParameters; limits: PhysicalLimits };
  formationPlan: BattleFormationPlan | null;
  /** Explicit Web condition/action policy; absence is the strict source lane. */
  conditionControlPolicy?: { kind: "web-source-control-actions-v1" };
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
  if(input.spawnConditionPolicy!==undefined)parseWebEnemySpawnConditions(input.spawnConditionPolicy);
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
    for (const key of ["attack_attribute", "attack_plus", "attack_plus_grop"])
      if (int(row[key]) !== 0) throw new Error(`Unimplemented monster ${key}=${row[key]}`);
    let conditionIds: number[];
    try {
      if (int(row.initial_condition) !== 0 && input.entryPhase !== "initial" && input.spawnConditionPolicy===undefined)
        throw new InitialConditionCompilationError("Nonzero initial conditions require an admitted late-entry initialization phase",
          { table: "monster.csv", id: enemy.monsterId, field: "initial_condition" });
      conditionIds = compileEnemyInitialConditions(reader, int(row.initial_condition), input.conditions).conditionIds;
      if(input.entryPhase==='late'&&int(row.initial_condition)!==0&&input.spawnConditionPolicy)add('development-omission','enemy-spawn-condition-policy',
        'Explicit Web fresh-enemy group expansion in complete master order before AI, resources and timers; native direct master lookup/filtering and activation timing are not inferred',
        {dependency:{table:'monster.csv',id:enemy.monsterId,field:'initial_condition'}});
    } catch (error) {
      add("blocked", "enemy-initial-condition", `Monster ${enemy.monsterId} initial_condition=${row.initial_condition}: ` +
        (error instanceof Error ? error.message : String(error)), { dependency: error instanceof InitialConditionCompilationError
          ? error.dependency : { table: "monster.csv", id: enemy.monsterId, field: "initial_condition" } });
      return { source, diagnostics, definition: null };
    }
    let conditionResistances: Record<string, number>;
    try {
      conditionResistances = compileConditionResistances(reader, int(row.resistance_condition),
        input.conditions.rules.definitions).resistances;
      if (Object.keys(conditionResistances).length) new BattleConditions(input.conditions).validateResistances(conditionResistances);
    } catch (error) {
      add("blocked", "enemy-condition-resistance", `Monster ${enemy.monsterId} resistance_condition=${row.resistance_condition}: ` +
        (error instanceof Error ? error.message : String(error)),
        { dependency: error instanceof ConditionResistanceCompilationError ? error.dependency
          : { table: "monster.csv", id: enemy.monsterId } });
      return { source, diagnostics, definition: null };
    }
    const parameters = compileEnemyParameters(reader, enemy.monsterId,
      input.parameters.temporary, input.parameters.limits).confirmed;
    const physical = compileEnemyPhysical(reader, enemy.monsterId,
      input.physical.temporary, input.physical.limits).confirmed;
    if (!identity(int(row.lv)) || parameters.hp <= 0 || int(row.exp) < 0 || int(row.gill) < 0)
      throw new Error("Invalid initial enemy level, life or rewards");
    const ai = compileBattleAI(enemy.ai.data, enemy.ai.source);
    if (ai.blockers.length) throw new Error("Unresolved AI entry: " + ai.blockers.join("; "));
    const abilityIds = battleAIAbilities(ai);
    const dependencyAbilities = (id: number, pc: number, ancestors: readonly number[] = []): number[] => {
      if (ancestors.includes(id)) {
        add("runtime-dependency", "random-ability-cycle", `Random ability dependency cycle at ${id}`,
          { pc, dependency: { table: "ability.csv", id } });
        return [];
      }
      const definition = input.abilities[id], children = definition?.plan?.effects.flatMap(effect => {
        if (effect.kind !== "random-ability") return [];
        if (![1, 3, 5, 6, 7, 14, 20, 21].includes(definition!.program.range))
          add("runtime-dependency", "random-ability-parent-target", `Unresolved random-ability parent scope ${definition!.program.range}`,
            { pc, dependency: { table: "ability.csv", id } });
        for (const row of effect.rows) {
          const child = input.abilities[row.abilityId];
          if (child && (child.cost !== 0 || child.plan?.effects.some(part => part.kind === "random-ability")))
            add("runtime-dependency", "random-ability-child", `Unresolved random-ability child ${row.abilityId}`,
              { pc, dependency: { table: "ability.csv", id: row.abilityId } });
          if (effect.retarget && child && ![3, 5, 7].includes(child.program.range))
            add("runtime-dependency", "random-ability-child-target", `Unresolved derived target range for ability ${row.abilityId}`,
              { pc, dependency: { table: "ability.csv", id: row.abilityId } });
          if (!effect.retarget && child?.program.range === 5 && definition!.program.range !== 5)
            add("runtime-dependency", "random-ability-child-target", `Unresolved inherited self target for ability ${row.abilityId}`,
              { pc, dependency: { table: "ability.csv", id: row.abilityId } });
        }
        return effect.rows.map(row => row.abilityId);
      }) ?? [];
      return [...new Set([id, ...children.flatMap(child => dependencyAbilities(child, pc, [...ancestors, id]))])];
    };
    for (const [pc, instruction] of ai.instructions.entries()) {
      const op = instruction.op;
      if (op.kind === "blocked") add("runtime-dependency", "ai-instruction", op.reason, { pc });
      if (op.kind === "condition" && !input.conditions.rules.definitions.some(condition => condition.id === op.conditionId))
        add("blocked", "ai-condition", `Missing AI condition ${op.conditionId}`,
          { pc, dependency: { table: "condition.csv", id: op.conditionId } });
      if (!("abilities" in op) || !["act", "counter-act", "loop-act", "counter-received-command"].includes(op.kind)) continue;
      for (const id of [...new Set(op.abilities.flatMap(id => dependencyAbilities(id, pc)))]) {
        if (!abilityIds.includes(id)) abilityIds.push(id);
        const ability = input.abilities[id], dependency = { table: "ability.csv", id };
        if (!ability || ability.id !== id) add("blocked", "ability-reference", `Missing AI ability ${id}`, { pc, dependency });
        else if (!ability.plan) add("runtime-dependency", "ability-plan",
          `Ability ${id}: ${ability.blockers.join("; ") || "unimplemented plan"}`, { pc, dependency });
        else {
          const effect = ability.plan.effects[0], controlOnly = ability.plan.effects.length === 1 &&
            effect?.kind === "add-condition" && input.conditions.behaviors.some(behavior =>
              behavior.id === effect.conditionId && ["sleep", "confusion", "temptation", "doom"].includes(behavior.kind));
          if (controlOnly && input.conditionControlPolicy?.kind !== "web-source-control-actions-v1")
            add("runtime-dependency", "condition-control-policy", `Ability ${id}: source control condition requires an explicit Web lifecycle/action policy`,
              { pc, dependency });
          const targetBlocker = battleAITargetBlocker(ability.program.range, ability.plan.targeting,
            op.kind === "counter-act" && op.abilities.includes(id) ? "counter" : "normal", undefined,
            controlOnly ? input.conditionControlPolicy : undefined);
          if (targetBlocker)
            add("runtime-dependency", "automatic-target", `Ability ${id}: ${targetBlocker}`, { pc, dependency });
          else if (ability.plan.targeting.normalFormationOnly && formationPlan &&
            (formationPlan.kind === "fixed" ? formationPlan.pattern !== 1
              : formationPlan.patterns[2] === 1 && formationPlan.policy.weights[2] > 0))
            add("runtime-dependency", "ability-formation", `Unimplemented formation for ability ${id}`, { pc, dependency });
        }
      }
    }
    return { source, diagnostics, definition: {
      ...(Object.hasOwn(row, "monster_flag_group_id")
        ? { conditionTraits: compileSourceEnemyConditionTraits(reader, enemy.monsterId).metadata } : {}),
      sourceId: enemy.monsterId, name: input.name(row.mes_id_name!), side: "enemy", row: "front",
      level: int(row.lv), attackElements: [],
      elementResistances: compileElementResistances(reader, int(row.resistance_attribute)).resistances,
      physical, ...parameters, exp: int(row.exp), gil: int(row.gill), growthGroup: null,
      abilities: abilityIds, commands: [], conditionIds, conditionResistances, ai,
      sprites: { idle: enemy.sprite, mount: null },
    } };
  } catch (error) {
    add("blocked", "enemy-provider", error instanceof Error ? error.message : String(error),
      { dependency: { table: "monster.csv", id: enemy.monsterId } });
    return { source, diagnostics, definition: null };
  }
}
