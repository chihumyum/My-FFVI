import type { AbilityEffect, AbilityEffectResult, AbilityFunction } from "./ability.js";
import type { ActionParticipant } from "./action-effects.js";
import { projectAbilityCost, type AbilityCostOwner, type AbilityCostProjection } from "./ability-cost.js";
import type { BattleAbilityCatalog } from "./battle-abilities.js";
import type { TargetSelection } from "./battle-targets.js";
import { validateOwnedCharacterAbilities, type OwnedCharacterAbilities } from "./owned-character.js";
import type { BattleConditions } from "./battle-conditions.js";
import { activePartyMembers, type PartyState } from "./party.js";
import { calculateMagic, validateMagic, type MagicRules } from "./magic.js";
import { equipmentOwnedAbilities } from "./equipment.js";

/** Field/menu execution is independently compiled. A battle plan has no such
 * identity and cannot grant field use merely because its effects are supported. */
export type FieldAbilityPlan = {
  kind: "field-ability-plan-v1";
  modes: ("single" | "all")[];
  effects: FieldAbilityEffect[];
  magic: MagicRules | null;
};
export type FieldAbilityEffect = Extract<AbilityEffect,
  { kind: "recovery" | "recover-condition" | "recover-max-hp" }> |
  { slot: number; kind: "field-unique-none"; resultType: 2 };
/** Source Miss2 on the None slot is a deterministic placeholder classification,
 * not a failed stochastic spell hit. Preserve it without a UI miss projection. */
export type FieldAbilityEffectResult = AbilityEffectResult |
  { slot: number; resource: "none"; resultType: 2; value: 0 };
export type FieldAbilityDefinition = {
  id: number;
  /** null preserves missing/ambiguous source content; it grants no field use. */
  contentId: number | null;
  name: string;
  typeId: number;
  menuFunctionGroupId: number;
  menuRange: number;
  cost: number;
  power: number;
  program: {
    groupId: number;
    range: number;
    functions: AbilityFunction[];
    process: { key: string; values: [number, number, number] };
    forbiddenConditionIds: number[];
    contentFlags: number[];
  };
  plan: FieldAbilityPlan | null;
  blockers: string[];
};
/** Static capability rules, never another mutable character/skill owner. The
 * source branch is implemented only from its independent menu consumers. */
export type FieldAbilityRules = {
  kind: "field-ability-rules-v1";
  profile: "source" | "framework";
  /** Source arithmetic and this explicit Web generator are independent
   * evidence. This seed never claims Unity PRNG bit parity. */
  random: { kind: "web-field-random-v1"; seed: number };
};
export type FieldAbilityCatalog = {
  kind: "field-abilities-v1";
  rules: FieldAbilityRules;
  commands: BattleAbilityCatalog["commands"];
  abilities: Record<string, FieldAbilityDefinition>;
};
/** Unknown field exclusions are not an implicitly empty set. */
export type FieldAbilityContext = { invalidContentIds: readonly number[] | null };
export type FieldAbilitySelection = Extract<TargetSelection, { kind: "single" } | { kind: "all" }>;
export type FieldAbilityRequest = { actorId: string; abilityId: number; selection: FieldAbilitySelection };
export type FieldAbilityMember = ActionParticipant & {
  sourceId: number;
  enabled: boolean;
  abilities: OwnedCharacterAbilities | null;
};
export type FieldAbilityCostOwner = Extract<AbilityCostOwner, { side: "player" }>;
export type FieldAbilityChoice = { selection: FieldAbilitySelection; targetIds: string[] };
export type FieldAbilityMenuEntry = {
  abilityId: number;
  contentId: number | null;
  name: string;
  cost: AbilityCostProjection | null;
  /** null preserves an unknown provider; false is known ineligibility. */
  available: boolean | null;
  blockers: string[];
};
export type FieldAbilityProjection<T extends FieldAbilityMember = FieldAbilityMember> = {
  roster: T[];
  actorId: string;
  abilityId: number;
  targetIds: string[];
  cost: AbilityCostProjection;
  effects: { targetId: string; effects: FieldAbilityEffectResult[] }[];
  /** Effect changes only; the payer may separately lose MP exactly once. */
  changedTargetIds: string[];
};

function record(raw: unknown, expected?: string): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid field ability record");
  const descriptors: Record<string, PropertyDescriptor> = Object.getOwnPropertyDescriptors(raw);
  if (Object.getOwnPropertySymbols(raw).length ||
      Object.values(descriptors).some(d => !d.enumerable || !Object.hasOwn(d, "value")))
    throw new Error("Field abilities require own data fields");
  if (expected !== undefined && Object.keys(descriptors).sort().join(",") !== expected.split(",").sort().join(","))
    throw new Error("Invalid field ability fields");
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}
function array(raw: unknown): readonly unknown[] {
  if (!Array.isArray(raw) || Object.getOwnPropertySymbols(raw).length ||
      Object.getOwnPropertyNames(raw).length !== raw.length + 1)
    throw new Error("Invalid field ability array");
  for (let index = 0; index < raw.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value"))
      throw new Error("Field abilities require dense data arrays");
  }
  return raw;
}
function integer(raw: unknown, minimum = -0x80000000, maximum = 0x7fffffff): number {
  if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw < minimum || raw > maximum || Object.is(raw, -0))
    throw new Error("Invalid field ability integer");
  return raw;
}
function ids(raw: unknown, minimum = 1): number[] { return array(raw).map(value => integer(value, minimum)); }
function texts(raw: unknown): string[] {
  return array(raw).map(value => {
    if (typeof value !== "string" || !value.length) throw new Error("Invalid field ability blocker");
    return value;
  });
}
function validateMagicRules(raw: unknown): void {
  const value = record(raw, "accuracy,contentFlags,forceDefense,elements");
  integer(value.accuracy, 0);
  if (typeof value.forceDefense !== "boolean" || ids(value.contentFlags).some(id => ![1, 2, 5].includes(id)))
    throw new Error("Unimplemented field ability magic rule");
  const elements = ids(value.elements);
  if (elements.length > 8 || new Set(elements).size !== elements.length)
    throw new Error("Invalid field ability elements");
}
function validatePlan(raw: unknown, conditions?: BattleConditions): void {
  const plan = record(raw, "kind,modes,effects,magic");
  if (plan.kind !== "field-ability-plan-v1") throw new Error("Invalid independent field ability plan");
  const modes = array(plan.modes);
  if (!modes.length || modes.some(mode => mode !== "single" && mode !== "all") || new Set(modes).size !== modes.length)
    throw new Error("Invalid field ability selection modes");
  const effects = array(plan.effects); let previous = 0, magic = false;
  if (!effects.length) throw new Error("Missing field ability effects");
  for (const rawEffect of effects) {
    const effect = record(rawEffect);
    const slot = integer(effect.slot, 1, 3);
    if (slot <= previous) throw new Error("Invalid field ability effect order");
    previous = slot;
    if (effect.kind === "recovery") {
      record(rawEffect, "slot,kind,resource,calculation");
      if (!["hp", "mp"].includes(effect.resource as string) || !["fixed", "magic"].includes(effect.calculation as string))
        throw new Error("Unimplemented field ability recovery effect");
      magic ||= effect.calculation === "magic";
    } else if (effect.kind === "recover-condition") {
      record(rawEffect, "slot,kind,conditionIds");
      const recoveryIds = ids(effect.conditionIds);
      if (!recoveryIds.length) throw new Error("Missing field ability condition recovery");
      conditions?.validateReferences(recoveryIds);
    } else if (effect.kind === "recover-max-hp") {
      record(rawEffect, "slot,kind,mode,value");
      integer(effect.value, 1, effect.mode === "percent" ? 100 : 0x7fffffff);
      if (effect.mode !== "percent" && effect.mode !== "divide") throw new Error("Invalid field ability maximum recovery");
    } else if (effect.kind === "field-unique-none") {
      record(rawEffect, "slot,kind,resultType");
      if (effect.resultType !== 2) throw new Error("Invalid field None result identity");
    } else throw new Error("Unimplemented field ability effect");
  }
  if (magic) validateMagicRules(plan.magic);
  else if (plan.magic !== null) throw new Error("Unused field ability magic rules");
}

/** Validate the complete static dictionary without requiring every potential
 * ability to execute. Blocked rows preserve their raw menu program and reason. */
export function validateFieldAbilityCatalog(catalog: FieldAbilityCatalog, conditions?: BattleConditions): void {
  const root = record(catalog, "kind,rules,commands,abilities"), rules = record(root.rules, "kind,profile,random");
  if (root.kind !== "field-abilities-v1" || rules.kind !== "field-ability-rules-v1" ||
      rules.profile !== "source" && rules.profile !== "framework") throw new Error("Unknown field ability rules");
  const random = record(rules.random, "kind,seed");
  if (random.kind !== "web-field-random-v1") throw new Error("Unknown field ability random policy");
  integer(random.seed, 1, 0xffffffff);
  const commandIds = new Set<number>();
  for (const rawCommand of array(root.commands)) {
    const command = record(rawCommand, "id,nameKey,type,listType,executionType,abilityId,contentId,abilityTypes,releaseType,releaseValues,forbiddenConditionIds,blockers");
    const id = integer(command.id, 1);
    if (commandIds.has(id) || typeof command.nameKey !== "string") throw new Error("Invalid field ability command identity");
    commandIds.add(id);
    for (const key of ["type", "listType", "executionType", "releaseType"] as const) integer(command[key]);
    integer(command.abilityId, 0); if (command.contentId !== null) integer(command.contentId, 1);
    ids(command.abilityTypes, 0);
    if (array(command.releaseValues).length !== 2) throw new Error("Invalid field command release values");
    array(command.releaseValues).forEach(value => integer(value));
    const forbidden = ids(command.forbiddenConditionIds); conditions?.validateReferences(forbidden);
    texts(command.blockers);
  }
  for (const [key, rawDefinition] of Object.entries(record(root.abilities))) {
    const value = record(rawDefinition, "id,contentId,name,typeId,menuFunctionGroupId,menuRange,cost,power,program,plan,blockers");
    const id = integer(value.id, 1);
    if (String(id) !== key || typeof value.name !== "string") throw new Error("Field ability dictionary identity mismatch");
    if (value.contentId !== null) integer(value.contentId, 1);
    integer(value.typeId); integer(value.menuFunctionGroupId, 0); integer(value.menuRange); integer(value.cost); integer(value.power);
    const program = record(value.program, "groupId,range,functions,process,forbiddenConditionIds,contentFlags");
    if (integer(program.groupId, 0) !== value.menuFunctionGroupId || integer(program.range) !== value.menuRange)
      throw new Error("Field ability menu program identity mismatch");
    const process = record(program.process, "key,values");
    if (typeof process.key !== "string" || !process.key.length || array(process.values).length !== 3)
      throw new Error("Invalid field ability process data");
    array(process.values).forEach(value => integer(value));
    conditions?.validateReferences(ids(program.forbiddenConditionIds)); ids(program.contentFlags);
    let previous = 0;
    for (const rawFunction of array(program.functions)) {
      const fn = record(rawFunction, "slot,functionId,type,series,values"), slot = integer(fn.slot, 1, 3);
      if (slot <= previous) throw new Error("Invalid field ability function order");
      previous = slot; integer(fn.functionId, 1); integer(fn.type, 0); integer(fn.series);
      if (array(fn.values).length !== 3) throw new Error("Invalid field ability function operands");
      array(fn.values).forEach(value => integer(value));
    }
    if (program.groupId === 0 && array(program.functions).length)
      throw new Error("Zero field ability group cannot contain functions");
    const blockers = texts(value.blockers);
    if (value.plan === null) {
      if (!blockers.length) throw new Error("Blocked field ability requires an explicit reason");
    } else {
      if (blockers.length || value.contentId === null || value.menuFunctionGroupId === 0)
        throw new Error("Field ability plan contradicts its admission");
      integer(value.cost, 0); integer(value.power, 0); validatePlan(value.plan, conditions);
      const plan = value.plan as FieldAbilityPlan;
      const functions = array(program.functions);
      if (plan.effects.length !== functions.length ||
          plan.effects.some((effect, index) => record(functions[index]).slot !== effect.slot))
        throw new Error("Field ability plan does not cover its complete menu program");
      const modes = [1, 5, 7].includes(value.menuRange as number) ? ["single"]
        : value.menuRange === 2 ? ["all"] : value.menuRange === 6 ? ["single", "all"] : [];
      if (!modes.length || plan.modes.join(",") !== modes.join(","))
        throw new Error("Field ability plan contradicts its source range");
      if (program.contentFlags && ids(program.contentFlags).some(flag => ![1, 2, 3, 5].includes(flag)) ||
          process.key !== "None" || array(process.values).some(value => value !== 0) ||
          rules.profile === "source" && value.typeId !== 1)
        throw new Error("Unimplemented field ability execution context");
      if (plan.magic && (plan.magic.forceDefense || plan.magic.contentFlags.join(",") !==
          ids(program.contentFlags).filter(flag => flag !== 3).join(",")))
        throw new Error("Field magic rules disagree with the preserved source flags");
      for (const [index, effect] of plan.effects.entries()) {
        const fn = record(functions[index]), values = array(fn.values);
        if (fn.series !== 0) throw new Error("Unimplemented field function series");
        const matches = effect.kind === "recovery"
          ? fn.type === 1 && values[0] === (effect.calculation === "magic" ? 2 : 1) &&
            values[1] === (effect.resource === "hp" ? 2 : 3) && values[2] === 0 &&
            (effect.calculation === "magic" || rules.profile === "framework")
          : effect.kind === "recover-condition"
            ? fn.type === 12 && typeof values[0] === "number" && values[0] > 0 && values[1] === 0 && values[2] === 0
            : effect.kind === "recover-max-hp"
              ? fn.type === 34 && values[0] === 2 && values[1] === (effect.mode === "percent" ? 4 : 5) &&
                values[2] === effect.value && index === 1 && functions.length === 2 &&
                plan.effects[0]?.kind === "recover-condition" && (!conditions ||
                  conditions.referenceTypes(plan.effects[0].conditionIds).includes(5))
              : fn.type === 23 && values.every(value => value === 0) && index === 1 && functions.length === 2 &&
                plan.effects[0]?.kind === "recovery" && plan.effects[0].calculation === "magic";
        if (!matches) throw new Error("Field ability effect disagrees with its source menu function");
      }
    }
  }
}

type Scope<T extends FieldAbilityMember> = { actor: T | null; members: T[]; context: FieldAbilityContext };

function identity(value: unknown): string {
  if (typeof value !== "string" || !value.length || value.length > 160 || value.trim() !== value)
    throw new Error("Invalid field ability owned identity");
  return value;
}
function scope<T extends FieldAbilityMember>(
  catalog: FieldAbilityCatalog, roster: readonly T[], party: PartyState, actorId: string,
  context: FieldAbilityContext, conditions: BattleConditions,
): Scope<T> {
  validateFieldAbilityCatalog(catalog, conditions); identity(actorId);
  const value = record(context, "invalidContentIds");
  if (value.invalidContentIds !== null) ids(value.invalidContentIds);
  const indexed = new Map<string, T>();
  for (const rawMember of array(roster)) {
    const member = rawMember as T;
    record(member); identity(member.id);
    if (indexed.has(member.id)) throw new Error("Repeated field ability owned identity");
    indexed.set(member.id, member);
  }
  // Off-party metadata is not another required parameter provider. The host
  // validates its complete saved party; this seam binds only selected cells.
  const saved = record(party, "selectedSlot,slots");
  for (const slot of array(saved.slots)) for (const cell of array(slot)) record(cell, "id,row");
  const members = activePartyMembers(party).map(({ id }) => {
    const member = indexed.get(id);
    if (!member) throw new Error("Missing selected field ability member: " + id);
    return member;
  });
  return { actor: members.find(member => member.id === actorId) ?? null, members,
    context: { invalidContentIds: value.invalidContentIds === null ? null : ids(value.invalidContentIds) } };
}
function validateMember(member: FieldAbilityMember, conditions: BattleConditions): void {
  integer(member.sourceId, 1);
  if (member.side !== "player" || typeof member.enabled !== "boolean") throw new Error("Invalid field ability participant");
  integer(member.hp, 0); integer(member.mp, 0); integer(member.maxHp, 1); integer(member.maxMp, 0);
  if (member.hp > member.maxHp || member.mp > member.maxMp) throw new Error("Invalid field ability resources");
  conditions.validateStableLife(member.hp, ids(member.conditionIds));
}
function targetReady(plan: FieldAbilityPlan, target: FieldAbilityMember, conditions: BattleConditions): boolean {
  if (!target.enabled) return false;
  const dead = conditions.isUnableFight(target.conditionIds);
  return plan.effects.some(effect => effect.kind === "recovery"
    ? !dead && target[effect.resource] < (effect.resource === "hp" ? target.maxHp : target.maxMp)
    : effect.kind === "recover-condition"
      ? effect.conditionIds.some(id => target.conditionIds.includes(id))
      : effect.kind === "recover-max-hp" ? dead : false);
}
function choices(
  definition: FieldAbilityDefinition, actor: FieldAbilityMember,
  members: readonly FieldAbilityMember[], conditions: BattleConditions,
): FieldAbilityChoice[] {
  const plan = definition.plan!;
  const sources = new Set<number>();
  for (const member of members) {
    validateMember(member, conditions);
    if (sources.has(member.sourceId)) throw new Error("Ambiguous selected field ability source identity");
    sources.add(member.sourceId);
  }
  const result: FieldAbilityChoice[] = [];
  for (const mode of plan.modes) {
    if (mode === "single") {
      for (const member of members)
        if ((definition.menuRange !== 5 || member.id === actor.id) && targetReady(plan, member, conditions))
          result.push({ selection: { kind: "single", id: member.id }, targetIds: [member.id] });
    } else if (members.some(member => targetReady(plan, member, conditions))) {
      // Native GetTargetSum uses the raw request: full/fallen owners remain in
      // the all-player count even when their recovery function is ineligible.
      result.push({ selection: { kind: "all" }, targetIds: members.map(member => member.id) });
    }
  }
  return result;
}
type Eligibility = { view: FieldAbilityMenuEntry; definition: FieldAbilityDefinition | null; choices: FieldAbilityChoice[] };
function eligibility(
  catalog: FieldAbilityCatalog, current: Scope<FieldAbilityMember>, abilityId: number,
  costOwner: FieldAbilityCostOwner, conditions: BattleConditions,
): Eligibility {
  const definition = catalog.abilities[String(abilityId)] ?? null;
  const view: FieldAbilityMenuEntry = { abilityId, contentId: definition?.contentId ?? null,
    name: definition?.name ?? "", cost: null, available: false, blockers: [] };
  const result = { view, definition, choices: [] as FieldAbilityChoice[] };
  const reject = (reason: string, unknown = false) => {
    view.available = unknown ? null : false; view.blockers.push(reason); return result;
  };
  if (!definition) return reject("Missing field ability definition", true);
  const actor = current.actor;
  if (!actor || !actor.enabled) return reject("Field ability requires an enabled selected owner");
  validateMember(actor, conditions);
  if (conditions.isUnableFight(actor.conditionIds)) return reject("Game-over field ability owner");
  if (!actor.abilities) return reject("Missing owned field ability bindings", true);
  const owner = record(costOwner, "side,catalog,loadout");
  if (owner.side !== "player" || costOwner.loadout.id !== actor.id || costOwner.loadout.sourceId !== actor.sourceId)
    throw new Error("Field ability MP cost requires the actual player owner");
  validateOwnedCharacterAbilities(actor.abilities, equipmentOwnedAbilities(costOwner.catalog, costOwner.loadout));
  const owned = actor.abilities.owned.find(owned => owned.abilityId === abilityId);
  if (!owned || owned.skillLevel < 100) return reject("Field ability has not been learned by this owner");
  if (definition.contentId === null || owned.contentId !== definition.contentId)
    return reject("Field ability owned content identity mismatch", true);
  if (!definition.plan) {
    view.blockers.push(...definition.blockers); return result;
  }
  const commandMap = new Map(catalog.commands.map(command => [command.id, command]));
  let command: FieldAbilityCatalog["commands"][number] | undefined;
  // The source compiler proves a unique Chanting type mapping. Its normalized
  // command types exactly express GetCommand's First->Any, in owned order.
  for (const commandId of actor.abilities.commandIds) {
    const candidate = commandMap.get(commandId);
    if (!candidate) return reject("Missing owned field command metadata: " + commandId, true);
    if (candidate.abilityTypes.includes(definition.typeId)) { command = candidate; break; }
  }
  if (!command) return reject("No owned command permits this field ability");
  if ([...definition.program.forbiddenConditionIds, ...command.forbiddenConditionIds]
      .some(id => actor.conditionIds.includes(id))) return reject("Current condition forbids this field ability");
  if (current.context.invalidContentIds === null) return reject("Unknown field ability content exclusions", true);
  if (current.context.invalidContentIds.includes(definition.contentId)) return reject("Field content excludes this ability");
  view.cost = projectAbilityCost(definition, costOwner);
  if (view.cost.mp > actor.mp) return reject("Insufficient field ability MP");
  result.choices = choices(definition, actor, current.members, conditions);
  if (!result.choices.length) return reject("Field ability has no effective target");
  view.available = true;
  return result;
}

export function fieldAbilityMenu(
  catalog: FieldAbilityCatalog, roster: readonly FieldAbilityMember[], party: PartyState,
  actorId: string, costOwner: FieldAbilityCostOwner, conditions: BattleConditions, context: FieldAbilityContext,
): FieldAbilityMenuEntry[] {
  const current = scope(catalog, roster, party, actorId, context, conditions);
  if (!current.actor?.abilities) return [];
  return current.actor.abilities.owned.filter(owned => !catalog.abilities[String(owned.abilityId)] ||
    catalog.abilities[String(owned.abilityId)]!.menuFunctionGroupId !== 0).map(owned =>
    structuredClone(eligibility(catalog, current, owned.abilityId, costOwner, conditions).view));
}
export function fieldAbilityTargets(
  catalog: FieldAbilityCatalog, roster: readonly FieldAbilityMember[], party: PartyState,
  actorId: string, abilityId: number, costOwner: FieldAbilityCostOwner,
  conditions: BattleConditions, context: FieldAbilityContext,
): FieldAbilityChoice[] {
  integer(abilityId, 1);
  const current = scope(catalog, roster, party, actorId, context, conditions);
  return structuredClone(eligibility(catalog, current, abilityId, costOwner, conditions).choices);
}

function request(raw: FieldAbilityRequest): FieldAbilityRequest {
  const value = record(raw, "actorId,abilityId,selection"), selection = record(value.selection);
  const actorId = identity(value.actorId), abilityId = integer(value.abilityId, 1);
  if (selection.kind === "single") {
    record(value.selection, "kind,id"); return { actorId, abilityId, selection: { kind: "single", id: identity(selection.id) } };
  }
  if (selection.kind === "all") { record(value.selection, "kind"); return { actorId, abilityId, selection: { kind: "all" } }; }
  throw new Error("Invalid field ability player selection");
}
function magicInput(definition: FieldAbilityDefinition, actor: FieldAbilityMember,
  target: FieldAbilityMember, targetCount: number, conditions: BattleConditions) {
  return { rules: definition.plan!.magic!, power: definition.power, actor,
    target: { ...target, conditionTypes: conditions.types(target.conditionIds) }, recovery: true, targetCount };
}
function clampedRecovery(current: number, amount: number, maximum: number): number {
  if (!Number.isSafeInteger(amount) || amount < 0 || current + amount > 0x7fffffff)
    throw new Error("Field ability recovery is outside the supported nonnegative range");
  return Math.min(maximum, current + amount);
}
function projectTarget<T extends FieldAbilityMember>(
  definition: FieldAbilityDefinition, actor: FieldAbilityMember, target: T,
  targetCount: number, conditions: BattleConditions, random: (minimum: number, maximum: number) => number,
): { member: T; effects: FieldAbilityEffectResult[] } {
  const member = structuredClone(target), effects: FieldAbilityEffectResult[] = [];
  let removedDeath = false;
  for (const effect of definition.plan!.effects) {
    if (effect.kind === "field-unique-none") {
      // The complete source None slot produces HitType2/value0/empty statuses;
      // it is retained in the result rather than removed from the program.
      member.conditionIds = conditions.updateDying(member.hp, member.maxHp, member.conditionIds);
      effects.push({ slot: effect.slot, resource: "none", resultType: 2, value: 0 });
    } else if (effect.kind === "recover-condition") {
      const change = conditions.recover(member.conditionIds, effect.conditionIds);
      removedDeath ||= change.removed.some(id => conditions.referenceTypes([id])[0] === 5);
      member.conditionIds = change.currentIds;
      effects.push({ slot: effect.slot, resource: "condition", recovery: true,
        added: [], removed: [...change.removed], missed: change.missed });
    } else if (effect.kind === "recover-max-hp") {
      const amount = removedDeath ? effect.mode === "percent"
        ? Math.trunc(Math.imul(member.maxHp, effect.value) / 100)
        : Math.min(9999, Math.trunc(member.maxHp / effect.value)) : 0;
      member.hp = clampedRecovery(member.hp, amount, member.maxHp);
      member.conditionIds = conditions.updateDying(member.hp, member.maxHp, member.conditionIds);
      effects.push({ slot: effect.slot, resource: "hp", recovery: true, amount, missed: !removedDeath });
    } else {
      // Both HP and calculated MP recovery use the source Type5 life guard.
      // Ineligible full/fallen targets are kept in targetSum but do not draw.
      const key = effect.resource, maximum = key === "hp" ? member.maxHp : member.maxMp;
      const missed = conditions.isUnableFight(member.conditionIds) || member[key] >= maximum;
      const result = missed ? { amount: 0, missed: true }
        : effect.calculation === "magic"
          ? calculateMagic(magicInput(definition, actor, member, targetCount, conditions), random)
          : { amount: definition.power, missed: false };
      if (!result.missed) {
        member[key] = clampedRecovery(member[key], result.amount, maximum);
        if (key === "hp") member.conditionIds = conditions.updateDying(member.hp, member.maxHp, member.conditionIds);
      }
      effects.push({ slot: effect.slot, resource: key, recovery: true, amount: result.amount, missed: result.missed });
    }
  }
  conditions.validateStableLife(member.hp, member.conditionIds);
  return { member, effects };
}
export function projectFieldAbility<T extends FieldAbilityMember>(
  catalog: FieldAbilityCatalog, roster: readonly T[], party: PartyState,
  rawRequest: FieldAbilityRequest, costOwner: FieldAbilityCostOwner,
  conditions: BattleConditions, context: FieldAbilityContext,
  random: (minimum: number, maximum: number) => number,
): FieldAbilityProjection<T> | null {
  const input = request(rawRequest), current = scope(catalog, roster, party, input.actorId, context, conditions);
  if (typeof random !== "function") throw new Error("Field ability requires a transactional random provider");
  const admitted = eligibility(catalog, current, input.abilityId, costOwner, conditions);
  if (admitted.view.available === null) throw new Error(admitted.view.blockers.join("; "));
  if (!admitted.view.available) return null;
  const choice = admitted.choices.find(choice => choice.selection.kind === input.selection.kind &&
    (choice.selection.kind !== "single" || input.selection.kind === "single" && choice.selection.id === input.selection.id));
  if (!choice) return null;
  const definition = structuredClone(admitted.definition!), before = structuredClone([...roster]);
  const actor = before.find(member => member.id === input.actorId)!, byId = new Map(before.map(member => [member.id, member]));
  const targetIds = [...choice.targetIds], cost = structuredClone(admitted.view.cost!);
  // Every applicable target finishes numeric admission before even the first
  // draw. Projection itself uses detached members and the pre-action caster.
  for (const id of targetIds) {
    const target = byId.get(id)!; validateMember(target, conditions);
    if (targetReady(definition.plan!, target, conditions) && definition.plan!.magic)
      validateMagic(magicInput(definition, actor, target, targetIds.length, conditions));
  }
  const next = structuredClone(before), effects: FieldAbilityProjection<T>["effects"] = [], changedTargetIds: string[] = [];
  for (const id of targetIds) {
    const target = byId.get(id)!;
    const projected = projectTarget(definition, actor, target, targetIds.length, conditions, random);
    next[next.findIndex(member => member.id === id)] = projected.member;
    effects.push({ targetId: id, effects: projected.effects });
    if (projected.member.hp !== target.hp || projected.member.mp !== target.mp ||
        projected.member.conditionIds.length !== target.conditionIds.length ||
        projected.member.conditionIds.some((conditionId, index) => conditionId !== target.conditionIds[index]))
      changedTargetIds.push(id);
  }
  if (!changedTargetIds.length) return null;
  // Native ConsumptionExecution follows all effects. In particular, self MP
  // recovery is clamped first and then pays exactly one cost, never pre-paid.
  next.find(member => member.id === actor.id)!.mp -= cost.mp;
  return { roster: next, actorId: actor.id, abilityId: definition.id, targetIds, cost, effects, changedTargetIds };
}
