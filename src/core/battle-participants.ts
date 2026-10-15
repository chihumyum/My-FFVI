import type { CombatantDefinition } from "./battle-content.js";
import { parameterNames } from "./parameters.js";
import { validateElements, validateElementResistances } from "./elements.js";
import { checkpointKeys, checkpointRecord } from "./checkpoint-validation.js";
import { canonical } from "./canonical.js";
import type { BattleParticipantRewardScope } from "./battle-participant-state.js";
export type { BattleParticipantRewardScope } from "./battle-participant-state.js";

/** A master is reusable content, never a current unit or persistent owner. */
export type EnemyBattleDefinition = Omit<CombatantDefinition, "id" | "placement">;
export type BattleParticipantSlot = NonNullable<CombatantDefinition["placement"]>;
export type BattleParticipantEnemyParty = {
  /** Source members select masters/slots; the battle owner assigns instance IDs. */
  members: { sourceId: number; uniqueId: number }[];
  slots: Record<string, BattleParticipantSlot>;
};
export type BattleParticipantContent = {
  kind: "battle-participant-content-v1";
  /** Explicit Web slot bounds/layout policy; not a native coordinate certificate. */
  profile: "web-unique-id-slots-v1";
  rewardScope: BattleParticipantRewardScope;
  enemyDefinitions: Record<string, EnemyBattleDefinition>;
  slots: Record<string, BattleParticipantSlot>;
  initial: { id: string; sourceId: number; uniqueId: number }[];
  enemyParties?: Record<string, BattleParticipantEnemyParty>;
};

function integer(value: unknown, minimum = -0x80000000, maximum = 0x7fffffff): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum)
    throw new Error("Invalid battle participant integer");
}
function text(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.length || value.trim() !== value)
    throw new Error("Invalid battle participant identity");
}
function identityKey(key: string, minimum = 1, maximum = 0x7fffffff): number {
  const value = Number(key);
  integer(value, minimum, maximum);
  if (String(value) !== key) throw new Error("Noncanonical battle participant key");
  return value;
}
function ids(raw: unknown): void {
  if (!Array.isArray(raw)) throw new Error("Invalid battle participant references");
  for (const id of Array.from(raw)) integer(id, 1);
}

function parseSlots(raw: unknown): Record<string, BattleParticipantSlot> {
  checkpointRecord(raw);
  const slots: Record<string, BattleParticipantSlot> = {};
  for (const [key, rawPlacement] of Object.entries(raw as Record<string, unknown>)) {
    identityKey(key, 1, 9);
    checkpointKeys(rawPlacement, "x,y,group");
    const placement = rawPlacement as BattleParticipantSlot;
    integer(placement.x); integer(placement.y); integer(placement.group, 1, 2);
    slots[key] = { ...placement };
  }
  return slots;
}

/** Structural content validation. Reached AI paths, effects, media and owned
 * drop references retain their existing compiler/runtime admission lanes. */
function definition(raw: unknown, sourceId: number): EnemyBattleDefinition {
  checkpointRecord(raw);
  const value = raw as EnemyBattleDefinition;
  const required = [...parameterNames, "sourceId", "name", "side", "row", "level", "physical",
    "attackElements", "elementResistances", "exp", "gil", "growthGroup", "abilities", "commands",
    "conditionIds", "conditionResistances", "ai", "sprites"];
  const optional = ["ownedAbilities", "magicLearningValue", "appearance", "battleRequirements", "conditionTraits"];
  checkpointKeys(raw, [...required, ...optional.filter(key => Object.hasOwn(value, key))].join(","));
  if (value.sourceId !== sourceId || value.side !== "enemy" || !["front", "back"].includes(value.row))
    throw new Error("Battle participant master identity mismatch");
  if (value.row !== "front") throw new Error("Unresolved enemy battle row");
  text(value.name);
  integer(value.level, 1);
  for (const key of parameterNames) integer(value[key]);
  if (value.hp <= 0 || value.mp < 0) throw new Error("Invalid initial battle participant resources");
  integer(value.exp, 0); integer(value.gil, 0);
  if (value.growthGroup !== null) text(value.growthGroup);
  if (value.physical !== null) {
    checkpointKeys(value.physical, "attack,strength,accuracy,criticalRate");
    for (const number of Object.values(value.physical)) integer(number, 0);
  }
  if (!Array.isArray(value.attackElements)) throw new Error("Invalid battle participant elements");
  validateElements(Array.from(value.attackElements));
  validateElementResistances(value.elementResistances);
  ids(value.abilities); ids(value.commands); ids(value.conditionIds);
  checkpointRecord(value.conditionResistances);
  for (const [key, resistance] of Object.entries(value.conditionResistances)) {
    identityKey(key); integer(resistance, 0);
  }
  if (Object.hasOwn(value, "conditionTraits")) {
    checkpointKeys(value.conditionTraits, "kind,baseUndead");
    if (value.conditionTraits?.kind !== "source-condition-traits-v1" || typeof value.conditionTraits.baseUndead !== "boolean")
      throw new Error("Invalid source condition traits provider");
  }
  checkpointKeys(value.sprites, "idle,mount");
  text(value.sprites.idle);
  if (value.sprites.mount !== null) text(value.sprites.mount);
  if (value.ai === null) throw new Error("Battle participant lacks enemy AI content");
  checkpointKeys(value.ai, "kind,source,entry,end,instructions,blockers");
  if (value.ai.kind !== "battle-ai-v4" || !Array.isArray(value.ai.instructions) ||
      !Array.isArray(value.ai.blockers) || Array.from(value.ai.blockers).some(reason => typeof reason !== "string"))
    throw new Error("Invalid battle participant AI content");
  integer(value.ai.entry, 0); integer(value.ai.end, 1);
  if (value.ai.end <= value.ai.entry || value.ai.end > value.ai.instructions.length)
    throw new Error("Invalid battle participant AI segment");
  for (const instruction of Array.from(value.ai.instructions)) {
    checkpointKeys(instruction, "mnemonic,op");
    text(instruction.mnemonic); checkpointRecord(instruction.op);
  }
  if (value.ai.source !== null) {
    checkpointKeys(value.ai.source, "sourceSetHash,battleSourceSetHash,file,sha256,assetPath,serializedFile,objectId");
    for (const field of Object.values(value.ai.source)) text(field);
    if (!/^-?(?:0|[1-9]\d*)$/.test(value.ai.source.objectId) ||
        BigInt(value.ai.source.objectId) < -(1n << 63n) || BigInt(value.ai.source.objectId) >= (1n << 63n))
      throw new Error("Invalid battle participant AI object identity");
  }
  // Ordinary enemy templates have no owned-player or transformation provider.
  // Adding one needs a reviewed version instead of copying a GameState owner.
  if (optional.filter(key => key !== "conditionTraits").some(key => Object.hasOwn(value, key)))
    throw new Error("Unsupported battle participant template provider");
  return structuredClone(value);
}

export function enemyBattleDefinition(unit: CombatantDefinition): EnemyBattleDefinition {
  const { id: _id, placement: _placement, ...template } = unit;
  return structuredClone(template);
}

export function projectBattleParticipantInitial(content: BattleParticipantContent): CombatantDefinition[] {
  return content.initial.map(entry => ({ ...structuredClone(content.enemyDefinitions[String(entry.sourceId)]!),
    id: entry.id, placement: structuredClone(content.slots[String(entry.uniqueId)]!) }));
}

/** A phase owns its source layout, not a fallback to the entry party slots. */
export function parseBattleParticipantEnemyParty(
  raw: unknown,
  enemyDefinitions: Readonly<Record<string, EnemyBattleDefinition>>,
): BattleParticipantEnemyParty {
  checkpointKeys(raw, "members,slots");
  const value = raw as BattleParticipantEnemyParty, slots = parseSlots(value.slots);
  if (!Array.isArray(value.members) || !value.members.length || value.members.length > 9)
    throw new Error("Invalid battle enemy party member collection");
  const uniqueIds = new Set<number>();
  const members = Array.from(value.members, member => {
    checkpointKeys(member, "sourceId,uniqueId");
    integer(member.sourceId, 1); integer(member.uniqueId, 1, 9);
    if (uniqueIds.has(member.uniqueId) || !enemyDefinitions[String(member.sourceId)] || !slots[String(member.uniqueId)])
      throw new Error("Missing or duplicate battle enemy party binding");
    uniqueIds.add(member.uniqueId);
    return { sourceId: member.sourceId, uniqueId: member.uniqueId };
  });
  return { members, slots };
}

/** Missing content is handled by the host as static-only legacy support. This
 * parser never fills a missing master, slot, policy or initial source binding. */
export function parseBattleParticipantContent(
  raw: unknown,
  initialEnemies?: readonly CombatantDefinition[],
): BattleParticipantContent {
  checkpointRecord(raw);
  const value = raw as BattleParticipantContent;
  const hasParties = Object.hasOwn(value, "enemyParties");
  checkpointKeys(raw, "kind,profile,rewardScope,enemyDefinitions,slots,initial" + (hasParties ? ",enemyParties" : ""));
  if (value.kind !== "battle-participant-content-v1" || value.profile !== "web-unique-id-slots-v1" ||
      !["active-units", "all-entered"].includes(value.rewardScope))
    throw new Error("Unsupported battle participant content policy");
  checkpointRecord(value.enemyDefinitions);
  const enemyDefinitions: Record<string, EnemyBattleDefinition> = {};
  for (const [key, rawDefinition] of Object.entries(value.enemyDefinitions))
    enemyDefinitions[key] = definition(rawDefinition, identityKey(key));
  const slots = parseSlots(value.slots);
  if (!Array.isArray(value.initial) || value.initial.length > 9)
    throw new Error("Invalid initial battle participant collection");
  const seenIds = new Set<string>(), seenSlots = new Set<number>();
  const initial = Array.from(value.initial, entry => {
    checkpointKeys(entry, "id,sourceId,uniqueId");
    text(entry.id); integer(entry.sourceId, 1); integer(entry.uniqueId, 1, 9);
    if (seenIds.has(entry.id) || seenSlots.has(entry.uniqueId) ||
        !enemyDefinitions[String(entry.sourceId)] || !slots[String(entry.uniqueId)])
      throw new Error("Missing or duplicate initial battle participant binding");
    seenIds.add(entry.id); seenSlots.add(entry.uniqueId);
    return { ...entry };
  });
  const result: BattleParticipantContent = { kind: value.kind, profile: value.profile,
    rewardScope: value.rewardScope, enemyDefinitions, slots, initial };
  if (hasParties) {
    checkpointRecord(value.enemyParties);
    const parties: Record<string, BattleParticipantEnemyParty> = {};
    for (const [key, rawParty] of Object.entries(value.enemyParties!)) {
      identityKey(key);
      parties[key] = parseBattleParticipantEnemyParty(rawParty, enemyDefinitions);
    }
    result.enemyParties = parties;
  }
  if (initialEnemies !== undefined && canonical(projectBattleParticipantInitial(result)) !== canonical(initialEnemies))
    throw new Error("Initial battle participant content differs from encounter enemies");
  return result;
}
