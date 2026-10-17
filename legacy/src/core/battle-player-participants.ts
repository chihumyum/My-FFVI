import type { Combatant } from "./battle.js";
import type { BattleEntryInventory } from "./battle-entry.js";
import type { BattlePlayerGroupSlot, BattlePlayerState } from "./battle-player-state.js";
import { createBattlePlayerState, parseBattlePlayerState, firstEnteredOwnerIds } from "./battle-player-state.js";
import { checkpointKeys, checkpointRecord } from "./checkpoint-validation.js";
import { parameterNames } from "./parameters.js";
import { validateElements, validateElementResistances } from "./elements.js";
import { validateEquipmentState } from "./equipment.js";

/** These policies describe the Web owner boundary, not native result scope. */
export type BattlePlayerPlan = {
  kind: "battle-player-plan-v1";
  profile: "web-owned-borrow-v1";
  sourceIds: number[];
  groups: (0 | 1 | 2)[];
  rewardScope: "all-entered";
  returnParty: "preserve-entry";
};
export type BattlePlayerBorrow = {
  kind: "battle-player-borrow-v1";
  plan: BattlePlayerPlan;
  initial: BattlePlayerGroupSlot[];
  candidates: Combatant[];
  groups: Record<string, BattlePlayerGroupSlot[]>;
  qualification: BattleEntryInventory | null;
};
export type BattlePlayerReturn = {
  state: BattlePlayerState;
  observations: { ownedId: string; abilityIds: number[] }[];
};

function integer(value: unknown, minimum = 0, maximum = 0x7fffffff): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum)
    throw new Error("Invalid borrowed player integer");
}
function owner(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.length || /\s/.test(value) || value.startsWith("player:dynamic:"))
    throw new Error("Invalid or reserved borrowed player owner identity");
}
function dense(value: unknown, length?: number): asserts value is unknown[] {
  if (!Array.isArray(value) || length !== undefined && value.length !== length ||
      Object.keys(value).length !== value.length || Array.from({ length: value.length }, (_, i) => !Object.hasOwn(value, i)).some(Boolean))
    throw new Error("Invalid or sparse borrowed player collection");
}
function numbers(value: unknown, minimum = 1, maximum = 0x7fffffff, unique = false): number[] {
  dense(value);
  const values = value.map(value => { integer(value, minimum, maximum); return value; });
  if (unique && new Set(values).size !== values.length) throw new Error("Duplicate borrowed player reference");
  return values;
}

export function parseBattlePlayerPlan(raw: unknown): BattlePlayerPlan {
  checkpointKeys(raw, "kind,profile,sourceIds,groups,rewardScope,returnParty");
  const value = raw as BattlePlayerPlan;
  if (value.kind !== "battle-player-plan-v1" || value.profile !== "web-owned-borrow-v1" ||
      value.rewardScope !== "all-entered" || value.returnParty !== "preserve-entry")
    throw new Error("Unsupported borrowed player policy");
  return { kind: value.kind, profile: value.profile, sourceIds: numbers(value.sourceIds, 1, 0x7fffffff, true),
    groups: numbers(value.groups, 0, 2, true) as (0 | 1 | 2)[], rewardScope: value.rewardScope, returnParty: value.returnParty };
}

/** Structural projection checks only. Live command/condition/effect admission
 * remains the battle host's duty; the durable owner supplies frozen resources. */
function candidate(raw: unknown): Combatant {
  checkpointRecord(raw);
  const value = raw as Combatant;
  const required = [...parameterNames, "id", "sourceId", "name", "side", "row", "level", "physical", "attackElements",
    "elementResistances", "exp", "gil", "growthGroup", "abilities", "commands", "conditionIds", "conditionResistances",
    "ai", "placement", "sprites", "maxHp", "maxMp", "atb", "queued", "behavior", "magicLearningValue"];
  const optional = ["ownedAbilities", "appearance", "battleRequirements", "appearanceState"];
  checkpointKeys(raw, [...required, ...optional.filter(key => Object.hasOwn(value, key))].join(","));
  owner(value.id); integer(value.sourceId, 1);
  if (value.side !== "player" || !["front", "back"].includes(value.row) || value.ai !== null || value.behavior !== null ||
      value.atb !== 0 || value.queued !== false || value.placement !== null)
    throw new Error("Unresolved borrowed player template or mutable state");
  if (typeof value.name !== "string" || !value.name.length) throw new Error("Missing borrowed player name");
  integer(value.level, 1); integer(value.exp); integer(value.gil);
  integer(value.maxHp, 1); integer(value.maxMp); integer(value.magicLearningValue, 0, 128);
  for (const key of parameterNames) integer(value[key], key === "weight" ? -0x80000000 : 0);
  if (value.hp > value.maxHp || value.mp > value.maxMp) throw new Error("Borrowed player resource exceeds owned maximum");
  if (value.growthGroup !== null && typeof value.growthGroup !== "string") throw new Error("Invalid borrowed player growth reference");
  if (value.physical !== null) {
    checkpointKeys(value.physical, "attack,strength,accuracy,criticalRate");
    Object.values(value.physical).forEach(value => integer(value));
  }
  numbers(value.attackElements, 1, 8); validateElements(value.attackElements); validateElementResistances(value.elementResistances);
  numbers(value.abilities); numbers(value.commands); numbers(value.conditionIds);
  checkpointRecord(value.conditionResistances);
  for (const [key, resistance] of Object.entries(value.conditionResistances)) {
    const id = Number(key); integer(id, 1); if (String(id) !== key) throw new Error("Invalid borrowed condition identity");
    integer(resistance);
  }
  checkpointKeys(value.sprites, "idle,mount");
  if (typeof value.sprites.idle !== "string" || !value.sprites.idle.length ||
      value.sprites.mount !== null && typeof value.sprites.mount !== "string") throw new Error("Invalid borrowed player media");
  if (value.ownedAbilities && value.ownedAbilities.sourceId !== value.sourceId)
    throw new Error("Borrowed ability owner/source mismatch");
  return structuredClone(value);
}

function cells(raw: unknown, pool: ReadonlyMap<string, Combatant>): BattlePlayerGroupSlot[] {
  dense(raw, 4);
  const values = raw as BattlePlayerGroupSlot[];
  // The shared ledger parser owns exact cell fields, source uniqueness and row rules.
  createBattlePlayerState(values);
  for (const cell of values) if (cell.ownedId !== null && pool.get(cell.ownedId)?.sourceId !== cell.sourceId)
    throw new Error("Borrowed player group references an unadmitted owner");
  return structuredClone(values);
}

export function parseBattlePlayerBorrow(raw: unknown): BattlePlayerBorrow {
  checkpointKeys(raw, "kind,plan,initial,candidates,groups,qualification");
  const value = raw as BattlePlayerBorrow;
  if (value.kind !== "battle-player-borrow-v1") throw new Error("Invalid borrowed player kind");
  const plan = parseBattlePlayerPlan(value.plan);
  dense(value.candidates);
  const candidates = value.candidates.map(candidate), pool = new Map(candidates.map(player => [player.id, player]));
  if (pool.size !== candidates.length || new Set(candidates.map(player => player.sourceId)).size !== candidates.length)
    throw new Error("Ambiguous borrowed player pool identity");
  const initial = cells(value.initial, pool), groups: BattlePlayerBorrow["groups"] = {};
  checkpointRecord(value.groups);
  if (Object.keys(value.groups).sort().join(",") !== plan.groups.map(String).sort().join(","))
    throw new Error("Borrowed player groups differ from admitted plan");
  for (const group of plan.groups) {
    const members = cells(value.groups[String(group)], pool);
    if (!members.some(cell => cell.ownedId !== null)) throw new Error("Admitted borrowed player group must not be empty");
    groups[String(group)] = members;
  }
  const admitted = new Set(initial.flatMap(cell => cell.ownedId === null ? [] : [cell.ownedId]));
  for (const sourceId of plan.sourceIds) {
    const player = candidates.find(player => player.sourceId === sourceId);
    if (!player) throw new Error("Borrowed source owner is absent");
    admitted.add(player.id);
  }
  for (const group of Object.values(groups)) for (const cell of group) if (cell.ownedId !== null) admitted.add(cell.ownedId);
  if (admitted.size !== candidates.length || candidates.some(player => !admitted.has(player.id)))
    throw new Error("Borrowed pool contains an owner outside the frozen plan");
  const qualification = value.qualification;
  if (qualification !== null) {
    checkpointKeys(qualification, "equipmentCatalog,equipmentStock,members");
    checkpointRecord(qualification.equipmentCatalog); dense(qualification.members); dense(qualification.equipmentStock);
    if (qualification.members.length !== candidates.length) throw new Error("Borrowed equipment owner count mismatch");
    for (const [index, member] of qualification.members.entries()) {
      checkpointKeys(member, "id,sourceId,equipment"); owner(member.id); integer(member.sourceId, 1);
      numbers(member.equipment); if (member.equipment.length !== 6 || member.id !== candidates[index]!.id ||
        member.sourceId !== candidates[index]!.sourceId) throw new Error("Borrowed equipment owner identity mismatch");
    }
    for (const stock of qualification.equipmentStock) {
      checkpointKeys(stock, "id,count,equipped"); integer(stock.id, 1); integer(stock.count); integer(stock.equipped);
      if (stock.equipped > stock.count) throw new Error("Borrowed equipment occupancy exceeds stock");
    }
    if (new Set(qualification.equipmentStock.map(stock => stock.id)).size !== qualification.equipmentStock.length)
      throw new Error("Duplicate borrowed equipment stock identity");
    validateEquipmentState(qualification.equipmentCatalog, qualification.members,
      qualification.equipmentStock.map(({ id, count }) => ({ id, count })));
    for (const stock of qualification.equipmentStock) {
      const minimum = qualification.members.reduce((count, member) => count + member.equipment.filter(id => id === stock.id).length, 0);
      if (stock.equipped < minimum) throw new Error("Borrowed equipment occupancy omits an admitted owner");
    }
  }
  return { kind: value.kind, plan, initial, candidates, groups, qualification: structuredClone(qualification) };
}

/** Resource values are deliberately absent from the identity ledger. They
 * settle once per first-entered held owner through GameState's transaction. */
export function parseBattlePlayerReturn(raw: unknown): BattlePlayerReturn {
  checkpointKeys(raw, "state,observations");
  const value = raw as BattlePlayerReturn, state = parseBattlePlayerState(value.state);
  const entered = firstEnteredOwnerIds(state);
  dense(value.observations, entered.length);
  const observations = value.observations.map((observation, index) => {
    checkpointKeys(observation, "ownedId,abilityIds");
    owner(observation.ownedId);
    if (observation.ownedId !== entered[index]) throw new Error("Borrowed observation owner order differs from entry history");
    return { ownedId: observation.ownedId, abilityIds: numbers(observation.abilityIds, 1, 0x7fffffff, true) };
  });
  return { state, observations };
}
