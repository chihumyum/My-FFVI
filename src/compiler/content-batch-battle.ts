import { BattleConditions } from "../core/battle-conditions.js";
import type { BattleCatalog, BattleEncounterDiagnostic } from "../core/battle-content.js";
import { encounterFormationOptions } from "../core/battle-content.js";
import { parseBattleEscapePolicy } from "../core/battle-escape.js";
import { parseBattleRewardPolicy } from "../core/battle-result.js";
import { parseBattleLifecycle } from "../core/battle-lifecycle.js";
import { validateBattleDropCatalog } from "../core/battle-rewards.js";
import { validateBattleEventRules } from "../core/battle-event-context.js";
import { canonical } from "../core/canonical.js";
import { battleAIAbilities } from "./battle-ai.js";

export type BatchBattleDiagnostic = {
  code: string;
  reason: string;
  encounterId?: number;
  abilityId?: number;
};
export type BatchEncounterAnalysis = {
  id: number;
  /** Dependency readiness only, never a live-party or playable-story claim. */
  status: "ready" | "conditional" | "blocked";
  enemyIds: string[];
  abilityIds: number[];
  blockers: BatchBattleDiagnostic[];
  runtimeDependencies: BatchBattleDiagnostic[];
  /** Exact diagnostics published by the source selection/runtime compilers. */
  sourceDiagnostics: BattleEncounterDiagnostic[];
  limitations: string[];
};
export type BatchEncountersAnalysis = {
  encounterIds: number[];
  diagnostics: BatchBattleDiagnostic[];
  encounters: BatchEncounterAnalysis[];
  runtimeAdmission: "unassessed";
};

const identity = (id: number) => Number.isInteger(id) && id > 0 && id <= 0x7fffffff;
const reason = (error: unknown) => error instanceof Error ? error.message : String(error);
function ordered<T>(values: readonly T[]): T[] {
  const entries = new Map(values.map(value => [canonical(value), value]));
  return [...entries].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([, value]) => structuredClone(value));
}

/** Adapt the outputs of compileBattleEncounterSources ->
 * compileBattleEncounterRuntime, not a second ability capability compiler.
 * The catalog has no raw table/asset readers with which to rerun those stages.
 * Their diagnostics remain authoritative; missing compilation evidence is
 * conditional, not an empty list of successful checks. Callers must verify
 * catalog integrity before this synchronous analysis and separately exercise
 * GameSession entry, AI routes, victory/return and persistence with live owners.
 */
export function analyzeBatchEncounters(catalog: BattleCatalog, encounterIds: number[]): BatchEncountersAnalysis {
  if (!Array.isArray(encounterIds) || encounterIds.some(id => !identity(id)))
    throw new Error("Invalid encounter batch identity");
  const ids = [...new Set(encounterIds)].sort((a, b) => a - b);
  const encounters: BatchEncounterAnalysis[] = [];
  for (const id of ids) {
    const blockers: BatchBattleDiagnostic[] = [], runtimeDependencies: BatchBattleDiagnostic[] = [];
    const add = (target: BatchBattleDiagnostic[], code: string, detail: string, abilityId?: number) =>
      target.push({ code, reason: detail, encounterId: id, ...(abilityId === undefined ? {} : { abilityId }) });
    const block = (code: string, detail: string, abilityId?: number) => add(blockers, code, detail, abilityId);
    const conditional = (code: string, detail: string, abilityId?: number) => add(runtimeDependencies, code, detail, abilityId);
    const checked = (code: string, operation: () => void, abilityId?: number) => {
      try { operation(); } catch (error) { block(code, reason(error), abilityId); }
    };
    const sourceDiagnostics = ordered((catalog.encounterDiagnostics ?? []).filter(d => d.partyId === id));
    const limitations = [...catalog.common.limitations];
    for (const diagnostic of sourceDiagnostics) {
      const abilityId = diagnostic.dependency?.table === "ability.csv" ? diagnostic.dependency.id : undefined;
      if (diagnostic.kind === "blocked") block(diagnostic.code, diagnostic.reason, abilityId);
      else if (diagnostic.kind === "runtime-dependency") conditional(diagnostic.code, diagnostic.reason, abilityId);
      else limitations.push(`${diagnostic.code}: ${diagnostic.reason}`);
    }
    const encounter = catalog.encounters[String(id)];
    const compiled = catalog.encounterReport?.entries.filter(entry => entry.partyId === id) ?? [];
    if (compiled.length > 1) block("compiler-report", "Duplicate encounter compilation entries");
    else if (compiled[0]?.status === "blocked") block("compiler-report", "Source/runtime encounter compilation is blocked");
    else if (compiled.length === 0 || !catalog.encounterDiagnostics)
      conditional("compiler-evidence-missing", "Source/runtime encounter compilation diagnostics are not available");
    const abilityIds = new Set<number>();
    let formationOptions: ("normal" | "opposed")[] = [];
    if (!encounter) block("missing-encounter", `Battle catalog has no encounter ${id}`);
    else {
      if (catalog.kind !== "narshe-battle-catalog" || encounter.encounterId !== id)
        block("encounter-identity", "Encounter dictionary key and compiled identity disagree");
      checked("encounter-formation", () => { formationOptions = encounterFormationOptions(encounter); });
      checked("encounter-escape", () => {
        if (Object.hasOwn(catalog.common, "escapePolicy")) throw new Error("Escape policy must belong to an encounter");
        if (encounter.escapePolicy !== undefined) parseBattleEscapePolicy(encounter.escapePolicy);
      });
      if (encounter.escapePolicy) limitations.push("Authored ordinary-field retreat does not reproduce source escape rules or learning.");
      checked("battle-lifecycle", () => {
        if (Object.hasOwn(catalog.common, "lifecycle")) throw new Error("Battle lifecycle must belong to an encounter");
        if (encounter.lifecycle === undefined) {
          if (catalog.gameState.characterInitializations) throw new Error("Source encounter lacks battle lifecycle binding");
          conditional("battle-lifecycle-missing", "Legacy synthetic encounter has no explicit battle lifecycle binding");
          return;
        }
        const lifecycle = parseBattleLifecycle(encounter.lifecycle);
        if (lifecycle.mode === "script") {
          if (catalog.gameState.characterInitializations && lifecycle.program.source === null)
            throw new Error("Source encounter battle lifecycle lacks source identity");
          const rules = catalog.common.battleEvents;
          if (!rules) throw new Error("Battle lifecycle requires battle event condition rules");
          validateBattleEventRules(rules);
          const definitions = catalog.common.conditions.rules.definitions;
          if (rules.conditions.length !== definitions.length || definitions.some(definition =>
            !rules.conditions.some(rule => rule.id === definition.id && rule.type === definition.type)))
            throw new Error("Battle lifecycle condition rules do not cover the current condition catalog");
          limitations.push("Compiled battle-event instructions require live lifecycle/AI/action/outcome execution evidence.");
        } else if (lifecycle.mode === "development-omission") {
          const omission = sourceDiagnostics.some(d => d.code === "battle-script" && d.kind === "development-omission" &&
            d.dependency?.table === "script.csv" && d.dependency.id === lifecycle.scriptId && d.reason === lifecycle.reason);
          if (!omission) throw new Error("Battle lifecycle omission lacks matching compiler evidence");
          limitations.push(`Battle event ${lifecycle.scriptId} is explicitly omitted: ${lifecycle.reason}`);
        }
      });
      checked("encounter-rewards", () => {
        if (Object.hasOwn(catalog.common, "rewardPolicy")) throw new Error("Reward policy must belong to an encounter");
        if (encounter.rewardPolicy === undefined && catalog.gameState.characterInitializations)
          throw new Error("Source encounter lacks battle reward policy");
        if (encounter.rewardPolicy !== undefined) {
          const policy = parseBattleRewardPolicy(encounter.rewardPolicy);
          if (policy.magicPoints > 0 && !catalog.gameState.equipmentSystem)
            throw new Error("Magic point rewards require an owned progression provider");
        }
      });
      if (!encounter.enemies.length || encounter.enemies.length > 9 ||
          new Set(encounter.enemies.map(enemy => enemy.id)).size !== encounter.enemies.length)
        block("enemy-identity", "Missing, duplicate or excessive enemy identities");
      if (compiled[0]?.status === "compiled" && compiled[0].enemyCount !== encounter.enemies.length)
        block("compiler-report", "Compiled enemy count disagrees with the encounter definition");
      const media = (name: string) => {
        const sprite = catalog.common.sprites[name];
        if (!sprite || typeof sprite.file !== "string" || !sprite.file ||
            !Number.isInteger(sprite.width) || sprite.width <= 0 ||
            !Number.isInteger(sprite.height) || sprite.height <= 0)
          block("media-reference", `Missing or invalid battle sprite ${name}`);
      };
      media(encounter.background);
      let conditions: BattleConditions | null = null;
      checked("condition-catalog", () => { conditions = new BattleConditions(catalog.common.conditions); });
      // BattleGame checks these shared references at construction, even if a
      // particular enemy never selects the corresponding ability or command.
      checked("condition-reference", () => {
        if (!conditions) return;
        for (const ability of Object.values(catalog.common.abilities))
          conditions.validateReferences(ability.program.forbiddenConditionIds);
        for (const command of Object.values(catalog.common.commands))
          conditions.validateReferences(command.forbiddenConditionIds);
      });
      if (catalog.common.drops === null)
        conditional("reward-provider", "The catalog explicitly omits the battle drop provider");
      else checked("reward-reference", () => {
        const drops = catalog.common.drops!;
        validateBattleDropCatalog(drops);
        for (const enemy of encounter.enemies) {
          const monster = drops.monsters.find(monster => monster.id === enemy.sourceId);
          if (!monster)
            throw new Error(`Missing drop definition for monster ${enemy.sourceId}`);
          for (const [index, slot] of monster.slots.entries()) {
            if (monster.rate === 0 || drops.weights[index] === 0 || slot.contentId === 0) continue;
            const content = drops.contents.find(content => content.id === slot.contentId)!;
            const owned = content.kind === "item" ? catalog.gameState.items[content.id]
              : catalog.gameState.equipmentSystem?.catalog.definitions[content.id];
            if (owned?.id !== content.id)
              block("reward-ownership-reference", `Missing owned ${content.kind} definition for drop ${content.id}`);
          }
        }
      });
      for (const enemy of encounter.enemies) {
        if (!identity(enemy.sourceId) || !enemy.id || enemy.side !== "enemy")
          block("enemy-identity", `Invalid enemy identity ${enemy.id}`);
        media(enemy.sprites.idle);
        if (enemy.sprites.mount !== null) media(enemy.sprites.mount);
        checked("enemy-condition", () => {
          conditions?.validateActive(enemy.conditionIds);
          conditions?.validateResistances(enemy.conditionResistances);
        });
        const ai = enemy.ai;
        if (!ai) { block("ai-reference", `Enemy ${enemy.id} has no AI program`); continue; }
        if (ai.kind !== "battle-ai-v4" || !Number.isInteger(ai.entry) || !Number.isInteger(ai.end) ||
            ai.entry < 0 || ai.end <= ai.entry || ai.end > ai.instructions.length || ai.blockers.length)
          block("ai-entry", `Enemy ${enemy.id}: ${ai.blockers.join("; ") || "invalid AI segment"}`);
        const refs = battleAIAbilities(ai);
        for (const abilityId of [...enemy.abilities, ...refs]) abilityIds.add(abilityId);
        for (const abilityId of refs)
          if (!enemy.abilities.includes(abilityId))
            block("enemy-ability-reference", `Enemy ${enemy.id} does not own its AI ability ${abilityId}`, abilityId);
        for (const [pc, instruction] of ai.instructions.entries()) {
          const op = instruction.op;
          if ("target" in op && (!Number.isInteger(op.target) || op.target < ai.entry || op.target >= ai.end))
            block("ai-target", `Enemy ${enemy.id} PC ${pc} has an invalid branch target`);
          if (op.kind === "blocked") conditional("ai-instruction", `Enemy ${enemy.id} PC ${pc}: ${op.reason}`);
          if (op.kind === "condition") checked("ai-condition", () => conditions?.validateReferences([op.conditionId]));
          if (op.kind === "only-alive" || op.kind === "unit-alive-count") {
            if (!catalog.common.battleEvents)
              conditional("ai-event-provider", `Enemy ${enemy.id} PC ${pc} requires current unit event rules`);
            else checked("ai-event-provider", () => validateBattleEventRules(catalog.common.battleEvents!));
          }
        }
      }
      for (const abilityId of [...abilityIds].sort((a, b) => a - b)) {
        const ability = catalog.common.abilities[String(abilityId)];
        if (!identity(abilityId) || !ability || ability.id !== abilityId || ability.program.abilityId !== abilityId) {
          block("ability-reference", `Missing or inconsistent ability ${abilityId}`, abilityId); continue;
        }
        limitations.push(...ability.limitations.map(detail => `Ability ${abilityId}: ${detail}`));
        if (!ability.plan || ability.blockers.length)
          conditional("ability-plan", `Ability ${abilityId}: ${ability.blockers.join("; ") || "unimplemented plan"}`, abilityId);
        if (ability.plan?.targeting.normalFormationOnly && formationOptions.includes("opposed"))
          conditional("ability-formation", `Ability ${abilityId} cannot execute in a reachable opposed formation`, abilityId);
        // Reference checking is independent of effect capability. The existing
        // compiler's plan/diagnostics decide which function families are supported.
        for (const effect of ability.plan?.effects ?? []) {
          checked("ability-condition-reference", () => {
            if ("conditionId" in effect) conditions?.validateReferences([effect.conditionId]);
            if ("conditionIds" in effect) conditions?.validateReferences(effect.conditionIds);
          }, abilityId);
        }
      }
    }
    encounters.push({ id, status: blockers.length ? "blocked" : runtimeDependencies.length ? "conditional" : "ready",
      enemyIds: encounter?.enemies.map(enemy => enemy.id) ?? [],
      abilityIds: [...abilityIds].sort((a, b) => a - b), blockers: ordered(blockers),
      runtimeDependencies: ordered(runtimeDependencies), sourceDiagnostics, limitations: ordered(limitations) });
  }
  return { encounterIds: ids, diagnostics: ordered(encounters.flatMap(e => [...e.blockers, ...e.runtimeDependencies])),
    encounters, runtimeAdmission: "unassessed" };
}
