import type { BattleAbilityCatalog } from "../core/battle-abilities.js";
import { validateFieldAbilityCatalog, type FieldAbilityCatalog, type FieldAbilityDefinition, type FieldAbilityPlan, type FieldAbilityRules } from "../core/field-abilities.js";
import { compileFunctionGroup } from "./ability.js";
import type { BattleRow } from "./battle.js";
import { compileConditionGroup, type ConditionReader } from "./conditions.js";
import { compileContentFlags } from "./content-flags.js";
import { compileAttackElements } from "./elements.js";
import { tableInteger } from "./table.js";

type Tables = Record<string, Record<string, string>[]>;
type Source = BattleRow["source"];

export type FieldAbilityCompilation = {
  catalog: FieldAbilityCatalog;
  sources: Source[];
  report: {
    total: number;
    menuDeclared: number;
    plans: number;
    blocked: number;
    entries: { id: number; groupId: number; range: number; contentIds: number[]; blockers: string[]; sources: Source[] }[];
    ownershipGranted: false;
    originalGameExecuted: false;
    randomParity: false;
  };
};

function integer(value: string | undefined, label: string, minimum = 0) {
  const result = tableInteger(value);
  if (result < minimum || result > 0x7fffffff) throw new Error("Invalid field ability " + label);
  return result;
}

function uniqueSources(values: readonly Source[]): Source[] {
  return structuredClone([...new Map(values.map(value => [JSON.stringify(value), value])).values()]);
}

/** Field execution uses MenuFunctionGroupId and the actual menu caller's
 * RengeId getter, independently of MenuRengeId and the battle program.
 * A decoded master is never an acquisition or a usable plan. */
export function compileFieldAbilityCatalog(
  reader: ConditionReader,
  tables: Tables,
  commands: BattleAbilityCatalog["commands"],
  resolveName: (key: string) => string | null,
  rules: FieldAbilityRules,
): FieldAbilityCompilation {
  if (rules.kind !== "field-ability-rules-v1" || !["source", "framework"].includes(rules.profile) ||
      rules.random?.kind !== "web-field-random-v1" || !Number.isInteger(rules.random.seed) ||
      rules.random.seed < 1 || rules.random.seed > 0xffffffff)
    throw new Error("Explicit field ability random policy is required");
  const indexes = new Map<string, Map<number, Record<string, string>>>();
  const index = (table: string) => {
    if (indexes.has(table)) return indexes.get(table)!;
    const rows = tables[table];
    if (!Array.isArray(rows)) throw new Error("Missing field ability source table: " + table);
    const result = new Map<number, Record<string, string>>();
    for (const row of rows) {
      const id = integer(row.id, "row identity", 1);
      if (result.has(id)) throw new Error("Duplicate field ability source identity: " + table + ":" + id);
      result.set(id, row);
    }
    indexes.set(table, result);
    return result;
  };
  const exactRow = (table: string, id: string | number) => {
    const expected = index(table).get(integer(String(id), "reference", 1));
    const found = reader.row(table, id);
    if (!expected || Object.keys(expected).length !== Object.keys(found.values).length ||
        Object.entries(expected).some(([key, value]) => found.values[key] !== value))
      throw new Error("Mismatched field ability source enumeration: " + table + ":" + id);
    return found;
  };
  const masters = [...index("ability.csv").keys()].sort((a, b) => a - b)
    .map(id => exactRow("ability.csv", id));
  if (!masters.length) throw new Error("Empty field ability source catalog");
  const contents = [...index("content.csv").keys()].sort((a, b) => a - b)
    .map(id => exactRow("content.csv", id)).filter(row => integer(row.values.type_id, "content type") === 4);
  for (const row of contents)
    if (!index("ability.csv").has(integer(row.values.type_value, "content ability reference", 1)))
      throw new Error("Unresolved field content ability reference: " + row.values.id);
  const abilities: FieldAbilityCatalog["abilities"] = {};
  const report: FieldAbilityCompilation["report"] = {
    total: masters.length, menuDeclared: 0, plans: 0, blocked: 0, entries: [],
    ownershipGranted: false, originalGameExecuted: false, randomParity: false,
  };
  const sources: Source[] = [];
  // Existing command compilation normalizes AbilityGroup.type_id through
  // Chanting. Native GetCommand first chooses the unique Chanting for an
  // ability type, then tests that row's identity in each owned command group.
  // The normalized lookup is equivalent only while that mapping is unique.
  if (commands.length) {
    const chanting = new Map<number, number>();
    const abilityTypes = new Set<number>();
    for (const id of index("chanting.csv").keys()) {
      const row = exactRow("chanting.csv", id);
      const type = integer(row.values.ability_type_id, "chanting ability type");
      if (abilityTypes.has(type)) throw new Error("Ambiguous field ability chanting type: " + type);
      abilityTypes.add(type); chanting.set(id, type); sources.push(row.source);
    }
    const groups = [...index("ability_group.csv").keys()].map(id => exactRow("ability_group.csv", id));
    for (const command of commands) {
      const row = exactRow("command.csv", command.id);
      const group = integer(row.values.ability_group_id, "command ability group");
      const matches = groups.filter(value => integer(value.values.group_id, "command group identity") === group);
      const expected = matches.map(value => {
        const type = chanting.get(integer(value.values.type_id, "command chanting reference", 1));
        if (type === undefined) throw new Error("Unresolved field command chanting reference");
        return type;
      });
      if (group && !matches.length || command.abilityTypes.length !== expected.length ||
          expected.some((type, i) => command.abilityTypes[i] !== type))
        throw new Error("Mismatched field command ability type mapping: " + command.id);
      sources.push(row.source, ...matches.map(value => value.source));
    }
  }
  for (const master of masters) {
    const a = master.values;
    const id = integer(a.id, "identity", 1);
    const matches = contents.filter(row => integer(row.values.type_value, "content ability reference", 1) === id);
    const blockers: string[] = [];
    const used: Source[] = [master.source, ...matches.map(row => row.source)];
    const tracked: ConditionReader = {
      row: (table, rowId) => { const row = exactRow(table, rowId); used.push(row.source); return row; },
      group: (table, key, value) => {
        const expected = [...index(table).values()].filter(row => row[key] === String(value));
        const found = reader.group(table, key, value);
        if (expected.length !== found.length || expected.some((row, i) => row.id !== found[i]?.values.id))
          throw new Error("Mismatched field ability source group: " + table + ":" + value);
        return found.map(row => { const checked = exactRow(table, row.values.id!); used.push(checked.source); return checked; });
      },
    };
    let name = "";
    if (matches.length !== 1) blockers.push(matches.length ? "Ambiguous field ability content identity" : "Missing field ability content identity");
    else {
      const key = matches[0]!.values.mes_id_name;
      if (typeof key !== "string" || !key) throw new Error("Missing field ability name key: " + id);
      if (key !== "None") {
        const value = resolveName(key);
        if (value !== null && typeof value !== "string") throw new Error("Invalid field ability name resolution: " + id);
        if (value === null) blockers.push("Missing or ambiguous field ability message: " + key);
        else name = value;
      }
    }
    const groupId = integer(a.menu_function_group_id, "menu function group");
    const range = integer(a.renge_id, "menu range");
    const decoded = compileFunctionGroup(tracked, groupId);
    if (typeof a.process_prog !== "string" || !a.process_prog) throw new Error("Missing field ability process key: " + id);
    const forbiddenGroup = integer(a.condition_group_id, "forbidden condition group");
    const flagGroup = integer(a.content_flag_group_id, "content flag group");
    const forbidden = forbiddenGroup === 0 ? [] : compileConditionGroup(tracked, forbiddenGroup).ids;
    const flags = flagGroup === 0 ? [] : compileContentFlags(tracked, flagGroup).ids;
    const definition: FieldAbilityDefinition = {
      id, contentId: matches.length === 1 ? integer(matches[0]!.values.id, "content identity", 1) : null,
      name, typeId: integer(a.type_id, "type"), menuFunctionGroupId: groupId, menuRange: range,
      cost: integer(a.use_value, "cost"), power: integer(a.standard_value, "power"),
      program: { groupId, range, functions: structuredClone(decoded.functions),
        process: { key: a.process_prog, values: [integer(a.data_a, "process data", -0x80000000),
          integer(a.data_b, "process data", -0x80000000), integer(a.data_c, "process data", -0x80000000)] },
        forbiddenConditionIds: [...forbidden], contentFlags: [...flags] }, plan: null, blockers,
    };
    if (groupId === 0) blockers.push("No source field ability function group");
    else {
      report.menuDeclared++;
      const plan = compileFieldPlan(tracked, master, definition, blockers);
      if (!blockers.length) definition.plan = plan;
    }
    if (definition.plan) report.plans++; else report.blocked++;
    abilities[id] = definition;
    report.entries.push({ id, groupId, range, contentIds: matches.map(row => integer(row.values.id, "content identity", 1)),
      blockers: [...blockers], sources: uniqueSources(used) });
    sources.push(...used);
  }
  const catalog: FieldAbilityCatalog = { kind: "field-abilities-v1", rules: structuredClone(rules),
    commands: structuredClone(commands), abilities };
  validateFieldAbilityCatalog(catalog);
  return { catalog, sources: uniqueSources(sources), report };
}

function compileFieldPlan(
  reader: ConditionReader, master: BattleRow, definition: FieldAbilityDefinition, blockers: string[],
): FieldAbilityPlan | null {
  const a = master.values;
  const functions = definition.program.functions;
  const modes: FieldAbilityPlan["modes"] = [1, 5, 7].includes(definition.menuRange) ? ["single"]
    : definition.menuRange === 2 ? ["all"] : definition.menuRange === 6 ? ["single", "all"] : [];
  if (!modes.length) blockers.push("Unimplemented field ability range: " + definition.menuRange);
  if (definition.typeId !== 1) blockers.push("Unimplemented field ability type: " + definition.typeId);
  if (integer(a.ability_lv, "level") !== 0) blockers.push("Unimplemented field ability level-use resource");
  if (definition.program.process.key !== "None" || definition.program.process.values.some(value => value !== 0))
    blockers.push("Unimplemented field ability process: " + definition.program.process.key);
  if (definition.program.contentFlags.some(flag => ![1, 2, 3, 5].includes(flag)))
    blockers.push("Unimplemented field ability content flags");
  if (!functions.length) blockers.push("Empty source field ability function group");
  const effects: FieldAbilityPlan["effects"] = [];
  let magic: FieldAbilityPlan["magic"] = null;
  for (const fn of functions) {
    if (fn.series !== 0) { blockers.push("Unimplemented field ability function series: " + fn.series); continue; }
    const [first, second, third] = fn.values;
    if (fn.type === 1 && first === 2 && second === 2 && third === 0) {
      // OwnedCharacterClient -> RecoveryExecution -> FF6 MagicExecution:
      // computed HP recovery, fixType=0 and no forced defense. This is compiled
      // from the menu program and never copied from a battle ability plan.
      const elements = compileAttackElements(reader, integer(a.attribute_id, "attribute"),
        integer(a.attribute_group_id, "attribute group")).elements;
      magic = { accuracy: integer(a.accuracy_rate, "accuracy"), forceDefense: false,
        // Flag 3 is Runic's battle target override. The menu consumer does not
        // run that battle target phase; its exact flag remains in raw program.
        contentFlags: definition.program.contentFlags.filter(flag => flag !== 3), elements };
      effects.push({ slot: fn.slot, kind: "recovery", resource: "hp", calculation: "magic" });
    } else if (fn.type === 23 && first === 0 && second === 0 && third === 0 &&
        definition.program.process.key === "None" && definition.program.process.values.every(value => value === 0)) {
      const preceding = effects.at(-1);
      if (functions.length !== 2 || effects.length !== 1 || preceding?.kind !== "recovery" || preceding.calculation !== "magic")
        blockers.push("Field Unique None requires the ordinary recovery function chain");
      else {
        // UniqueExection 0xaa0a60 None reaches HitType=2/value=0 with an empty
        // condition list; 0x905570 changes HP by zero. Keep the source slot.
        effects.push({ slot: fn.slot, kind: "field-unique-none", resultType: 2 });
      }
    } else if (fn.type === 12 && first > 0 && second === 0 && third === 0) {
      // RecoveryFunction 0x66eac0/0x66f4d0 consumes the complete group in source
      // order. Unknown inactive conditions do not turn a remedy into a grant.
      const group = compileConditionGroup(reader, first);
      if (!group.ids.length) blockers.push("Empty field ability recovery condition group");
      else effects.push({ slot: fn.slot, kind: "recover-condition", conditionIds: [...group.ids] });
    } else if (fn.type === 34 && first === 2 &&
        (second === 5 && third > 0 || second === 4 && third > 0 && third <= 100)) {
      const preceding = effects.at(-1);
      const restoresDeath = preceding?.kind === "recover-condition" && preceding.conditionIds.some(id =>
        integer(reader.row("condition.csv", id).values.condition_type, "recovered condition type") === 5);
      if (functions.length !== 2 || effects.length !== 1 || !restoresDeath)
        blockers.push("Field maximum-HP recovery requires the preceding revival condition function");
      else effects.push({ slot: fn.slot, kind: "recover-max-hp", mode: second === 5 ? "divide" : "percent", value: third });
    } else blockers.push("Unimplemented field ability function: " + fn.type + " (slot " + fn.slot + ")");
  }
  return blockers.length ? null : { kind: "field-ability-plan-v1", modes, effects, magic };
}
