import type { AbilityDefinition } from "../core/battle-content.js";
import { compileDevelopmentAbility } from "./ability.js";
import type { BattleRow } from "./battle.js";
import type { ConditionReader } from "./conditions.js";
import { tableInteger } from "./table.js";

type Tables = Record<string, Record<string, string>[]>;
type Source = BattleRow["source"];

/** A source label is distinct from an authored UI fallback. In particular,
 * None is a present source value with intentionally empty display text. */
export type BattleAbilityDisplay = {
  kind: "message" | "none" | "missing-message" | "missing-content" | "ambiguous-content";
  nameKey: string | null;
  text: string | null;
};

export type BattleAbilityHostRequirement =
  | "current-owned-command-qualification"
  | "current-battle-content-exclusions"
  | "implemented-active-condition-behaviors"
  | "source-chanting-and-atb-host"
  | "development-action-presentation"
  | "mp-payment-once"
  | "no-mp-cost-equipment-provider"
  | "no-reflection-provider"
  | "no-runic-undead-or-other-value-overrides"
  | "admitted-equipment-and-parameter-providers"
  | "front-row-selected-arm-physical-inputs"
  | "normal-formation-targeting"
  | "player-only-revival-targets"
  | "target-condition-resistances";

export type BattleAbilityContentEntry = {
  id: number;
  source: BattleRow;
  /** The exact source content rows, including None and all ambiguous matches. */
  contents: BattleRow[];
  display: BattleAbilityDisplay;
  /** Formula decoding alone never grants ownership or certifies the host. */
  arithmeticPlan: boolean;
  execution: "bounded-host-plan" | "blocked";
  requirements: BattleAbilityHostRequirement[];
  conditionDependencies: { forbidden: number[]; added: number[]; recovered: number[] };
  blockers: string[];
  sources: Source[];
};

export type BattleAbilityContent = {
  kind: "battle-ability-content-v1";
  abilities: Record<number, AbilityDefinition>;
  abilityContentIds: Record<number, number | null>;
  entries: Record<number, BattleAbilityContentEntry>;
  sources: Source[];
  report: {
    total: number;
    arithmeticPlans: number;
    boundedHostPlans: number;
    blocked: number;
    display: Record<BattleAbilityDisplay["kind"], number>;
    effectPlans: Record<string, number>;
    blockers: { reason: string; abilityIds: number[] }[];
    ownershipGranted: false;
    originalGameExecuted: false;
    presentation: "development-action-host";
  };
};

function id(value: string | undefined): number {
  const result = tableInteger(value);
  if (result < 1 || result > 0x7fffffff) throw new Error("Invalid battle ability content identity");
  return result;
}

function uniqueSources(values: readonly Source[]): Source[] {
  return [...new Map(values.map((value) => [JSON.stringify(value), value])).values()];
}

/** Compile the complete master list, including unsupported abilities. A missing
 * name blocks that entry; a corrupt or missing table reference aborts compilation.
 * The resolver must use the bound source message tables, returning null for an
 * absent/ambiguous key. It must not synthesize labels from ability IDs.
 *
 * The output is an execution dictionary, not an owned-list initializer. Source
 * qualification, first-function-28 exclusions, active behaviors, parameters,
 * MP, charging and transactional application remain independently enforced by
 * the shared battle host. A successful catalog build is not a playable count. */
export function compileBattleAbilityContent(
  reader: ConditionReader,
  tables: Tables,
  resolveName: (key: string) => string | null,
): BattleAbilityContent {
  const all = (table: string): BattleRow[] => {
    const rows = tables[table];
    if (!Array.isArray(rows)) throw new Error("Missing battle ability content table: " + table);
    const ids = new Set<number>();
    return rows.map((value) => {
      const identity = id(value.id);
      if (ids.has(identity)) throw new Error("Duplicate battle ability content row: " + table + ":" + identity);
      ids.add(identity);
      const found = reader.row(table, identity);
      // The enumeration and reference resolver must refer to the same snapshot.
      if (Object.keys(found.values).length !== Object.keys(value).length ||
          Object.entries(value).some(([key, data]) => found.values[key] !== data))
        throw new Error("Mismatched battle ability source enumeration: " + table + ":" + identity);
      return found;
    });
  };
  const masters = all("ability.csv").sort((a, b) => id(a.values.id) - id(b.values.id));
  if (!masters.length) throw new Error("Empty battle ability content catalog");
  const contents = all("content.csv").filter((row) => tableInteger(row.values.type_id) === 4);
  const masterIds = new Set(masters.map((row) => id(row.values.id)));
  for (const content of contents)
    if (!masterIds.has(id(content.values.type_value)))
      throw new Error("Unresolved content ability reference: " + content.values.id);
  const abilities: BattleAbilityContent["abilities"] = {};
  const abilityContentIds: BattleAbilityContent["abilityContentIds"] = {};
  const entries: BattleAbilityContent["entries"] = {};
  const sources: Source[] = [];
  const reasons = new Map<string, number[]>();
  const report: BattleAbilityContent["report"] = {
    total: masters.length, arithmeticPlans: 0, boundedHostPlans: 0, blocked: 0,
    display: { message: 0, none: 0, "missing-message": 0, "missing-content": 0, "ambiguous-content": 0 },
    effectPlans: {}, blockers: [], ownershipGranted: false, originalGameExecuted: false,
    presentation: "development-action-host",
  };
  for (const master of masters) {
    const abilityId = id(master.values.id);
    const matches = contents.filter((row) => id(row.values.type_value) === abilityId);
    const displayBlockers: string[] = [];
    let display: BattleAbilityDisplay;
    if (matches.length !== 1) {
      display = { kind: matches.length ? "ambiguous-content" : "missing-content", nameKey: null, text: null };
      displayBlockers.push(matches.length ? "Ambiguous ability content identity" : "Missing ability content identity");
    } else {
      const key = matches[0]!.values.mes_id_name;
      if (typeof key !== "string" || !key) throw new Error("Missing source ability name key: " + abilityId);
      if (key === "None") display = { kind: "none", nameKey: key, text: "" };
      else {
        const text = resolveName(key);
        if (text !== null && typeof text !== "string") throw new Error("Invalid source ability name resolution: " + abilityId);
        display = { kind: text === null ? "missing-message" : "message", nameKey: key, text };
        if (text === null) displayBlockers.push("Missing or ambiguous ability message: " + key);
      }
    }
    const used: Source[] = [master.source, ...matches.map((row) => row.source)];
    const remember = (row: BattleRow) => { used.push(row.source); return row; };
    const tracked: ConditionReader = {
      row: (table, identity) => remember(reader.row(table, identity)),
      group: (table, key, value) => reader.group(table, key, value).map(remember),
    };
    const definition = compileDevelopmentAbility(tracked, abilityId, display.text ?? "");
    const arithmeticPlan = definition.plan !== null;
    const conditionDependencies = { forbidden: [...definition.program.forbiddenConditionIds], added: [] as number[], recovered: [] as number[] };
    const requirements: BattleAbilityHostRequirement[] = [
      "current-owned-command-qualification", "current-battle-content-exclusions",
      "implemented-active-condition-behaviors", "source-chanting-and-atb-host", "development-action-presentation",
    ];
    if (definition.plan) {
      report.arithmeticPlans++;
      const effects = definition.plan.effects;
      const kind = effects.map((effect) => effect.kind === "recovery" ? effect.calculation + "-" + effect.resource + "-recovery" : effect.kind).join("+");
      report.effectPlans[kind] = (report.effectPlans[kind] ?? 0) + 1;
      if (definition.cost > 0) requirements.push("mp-payment-once", "no-mp-cost-equipment-provider");
      if (definition.program.rules.invalid_reflection === 0) requirements.push("no-reflection-provider");
      if (definition.plan.targeting.normalFormationOnly) requirements.push("normal-formation-targeting");
      if (definition.plan.physical || definition.plan.magic) requirements.push("admitted-equipment-and-parameter-providers");
      if (definition.plan.physical) requirements.push("front-row-selected-arm-physical-inputs");
      if (effects.some((effect) => effect.kind === "recover-max-hp")) requirements.push("player-only-revival-targets");
      if (effects.some((effect) => ["physical", "magic", "recovery", "add-condition"].includes(effect.kind)))
        requirements.push("no-runic-undead-or-other-value-overrides");
      for (const effect of effects) {
        if (effect.kind === "add-condition" || effect.kind === "defend") {
          conditionDependencies.added.push(effect.conditionId);
          if (effect.kind === "add-condition") requirements.push("target-condition-resistances");
        } else if (effect.kind === "recover-condition") conditionDependencies.recovered.push(...effect.conditionIds);
      }
      // Recovery IDs are references, not newly active behaviors. Preserve order
      // and repeats; unsupported inactive statuses do not invalidate a remedy.
      for (const conditionId of [...conditionDependencies.added, ...conditionDependencies.recovered])
        tracked.row("condition.csv", conditionId);
    }
    const hostBlockers = tableInteger(master.values.ability_lv) === 0
      ? [] : ["Unresolved level-specific ability consumption"];
    // A source NonAct with a proven Function19 fixed-Hit plan has no menu
    // content identity in the master list. Preserve that absence and every raw
    // row; do not fabricate a name/content ID or grant an owned/menu ability.
    const deferredEffectOnly = definition.plan?.effects.length === 1 &&
      definition.plan.effects[0]?.kind === "non-damaging" && definition.nonDamagingPresentation !== undefined;
    const requiredDisplayBlockers = deferredEffectOnly && display.kind === "missing-content" ? [] : displayBlockers;
    if (deferredEffectOnly && display.kind === "missing-content")
      definition.limitations.push("Source non-damaging action has no content/menu identity; original absence retained, no ownership or command granted.");
    if (requiredDisplayBlockers.length || hostBlockers.length) {
      definition.blockers.push(...requiredDisplayBlockers, ...hostBlockers);
      definition.plan = null;
      definition.presentation = "unsupported";
    }
    report.display[display.kind]++;
    if (definition.plan) report.boundedHostPlans++; else report.blocked++;
    for (const reason of [...new Set(definition.blockers)]) reasons.set(reason, [...(reasons.get(reason) ?? []), abilityId]);
    const entry: BattleAbilityContentEntry = {
      id: abilityId, source: structuredClone(master), contents: structuredClone(matches), display,
      arithmeticPlan, execution: definition.plan ? "bounded-host-plan" : "blocked",
      requirements: [...new Set(requirements)], conditionDependencies,
      blockers: [...definition.blockers], sources: structuredClone(uniqueSources(used)),
    };
    abilities[abilityId] = definition;
    abilityContentIds[abilityId] = matches.length === 1 ? id(matches[0]!.values.id) : null;
    entries[abilityId] = entry;
    sources.push(...used);
  }
  report.blockers = [...reasons.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([reason, abilityIds]) => ({ reason, abilityIds }));
  return { kind: "battle-ability-content-v1", abilities, abilityContentIds, entries,
    sources: structuredClone(uniqueSources(sources)), report };
}
