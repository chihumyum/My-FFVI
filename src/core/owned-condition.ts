import { checkpointKeys } from "./checkpoint-validation.js";
import { int32 } from "./script-integer.js";
import type { BattleConditions } from "./battle-conditions.js";
import type { FieldPuppetRosterRead } from "./field-puppet-roster.js";
import { activePartyMembers, validatePartyState, type PartyState,
  type PartyAppearanceCandidate, type PartyPresentationPublication } from "./party.js";

export type OwnedConditionCommand = {
  kind: "add-condition" | "remove-condition";
  /** External.Misc uses ConditionType here, never the stored master row ID. */
  conditionType: number;
  /** 0=current Corps, -1=enabled roster, positive=CharacterStatus.Id. */
  target: number;
};
export type OwnedConditionEventOp = {
  kind: "owned-condition";
  command: OwnedConditionCommand;
  dependencies: { table: string; id: number }[];
};
export type OwnedConditionMember = {
  id: string;
  ownedId: number;
  sourceId: number;
  enabled: boolean;
  conditionIds: number[];
};
export type OwnedConditionAppearanceStep = {
  targetId: string;
  appearance: PartyAppearanceCandidate;
  /** Internal Character.Add/RemoveCondition refresh uses false, not the
   * explicit party commands' true dummy-reset request. */
  setDummy: false;
  affectLeader: true;
  /** Same transaction's source-owned context AFTER this target. The actor
   * host starts from its actual prior roster and carries each step forward. */
  puppetRoster?: FieldPuppetRosterRead;
};
export type OwnedConditionTransaction = {
  targets: string[];
  /** Native dispatch refreshes after each target, including a storage no-op. */
  steps: OwnedConditionAppearanceStep[];
  /** Source type0 writes every snapshot row Id to this MainCore's i0,
   * including rows retained by its hook. No owned-state register is created. */
  readonly coreI0Writes?: readonly number[];
  commit(): void;
  /** The last fallible actor validation observes the prior owned state. */
  commitWith(publish: () => void): void;
};
export type FieldOwnedConditionPort = {
  prepare(command: OwnedConditionCommand): OwnedConditionTransaction;
};

export function validateOwnedConditionCommand(command: OwnedConditionCommand): void {
  checkpointKeys(command, "kind,conditionType,target");
  if (command.kind !== "add-condition" && command.kind !== "remove-condition")
    throw new Error("Unknown owned condition operation");
  if (int32(command.conditionType) !== 607 &&
      !(command.kind === "remove-condition" && command.conditionType >= 0))
    throw new Error("Unimplemented owned condition behavior: " + command.conditionType);
  if (int32(command.target) < -1)
    throw new Error("Unknown owned character status selector: " + command.target);
}

/** ActionOnCharacter 0xb4e130, GetCharacterIdFromStatusId 0xb477c0. Target 0
 * deliberately includes disabled owners still present in the selected Corps;
 * target -1 includes enabled owners outside it. Neither selector creates owners. */
export function ownedConditionTargets<T extends OwnedConditionMember>(
  roster: readonly T[], party: PartyState, target: number,
): string[] {
  int32(target);
  validatePartyState(party, roster);
  const owned = new Set<number>();
  for (const member of roster) {
    if (int32(member.ownedId) <= 0 || owned.has(member.ownedId))
      throw new Error("Invalid owned condition character identity");
    owned.add(member.ownedId);
  }
  if (target === 0) return activePartyMembers(party).map((member) => member.id);
  if (target === -1) return roster.filter((member) => member.enabled).map((member) => member.id);
  const member = roster.find((entry) => entry.sourceId === target);
  if (!member) throw new Error("Unknown owned character status selector: " + target);
  return [member.id];
}

/** These field instructions directly edit CurrentConditionList. They do not
 * call battle hit/resistance/conflict or initialize a battle-local behavior.
 * Type 607 has no HP/MP/parameter write; all other families remain blocked. */
export function projectOwnedCondition<T extends OwnedConditionMember>(
  roster: readonly T[], party: PartyState, command: OwnedConditionCommand,
  definitions: readonly { id: number; type: number }[],
): { roster: T[]; targets: string[]; steps: { targetId: string; roster: T[] }[] } {
  validateOwnedConditionCommand(command);
  if (command.conditionType !== 607)
    throw new Error("Condition removal requires the owned resource projection");
  const identities = new Set<number>();
  for (const definition of definitions) {
    if (int32(definition.id) <= 0 || int32(definition.type) < 0 || identities.has(definition.id))
      throw new Error("Invalid owned condition master identity");
    identities.add(definition.id);
  }
  const matches = definitions.filter((definition) => definition.type === command.conditionType);
  // Source 607 has one master. Other types can have multiple rows; their
  // first-row add/whole-type remove needs an independently bound catalog order.
  if (matches.length !== 1) throw new Error("Missing or ambiguous owned condition type");
  for (const member of roster) {
    if (!Array.isArray(member.conditionIds) || member.conditionIds.some((id) => !identities.has(id)))
      throw new Error("Unknown owned condition reference");
  }
  const targets = ownedConditionTargets(roster, party, command.target);
  const next = structuredClone([...roster]);
  const steps: { targetId: string; roster: T[] }[] = [];
  const rowId = matches[0]!.id;
  for (const targetId of targets) {
    const member = next.find((entry) => entry.id === targetId)!;
    if (command.kind === "add-condition") {
      if (!member.conditionIds.includes(rowId)) member.conditionIds.push(rowId);
    } else member.conditionIds = member.conditionIds.filter((id) => id !== rowId);
    // Even already-added / already-removed conditions still run Refresh and
    // AffectLeader. Keep the ordered intermediate ownership for the host.
    steps.push({ targetId, roster: structuredClone(next) });
  }
  return { roster: next, targets, steps };
}

/** Exact Current.kNotRemoveConditions row IDs for the pinned source build.
 * 0x2a3c53 InitializeArray -> private field SHA1 05FD970C... -> static+0x190.
 * Their corresponding types are checked, but same-type aliases are NOT kept. */
const retainedRows = Object.freeze([{ id: 53, type: 607 }, { id: 79, type: 665 }, { id: 80, type: 666 }]);
export type OwnedConditionResourceMember = OwnedConditionMember & { hp: number; maxHp: number };

/** Nonzero RemoveCondition: the source checks death BEFORE enumerating
 * master rows, deletes matching row IDs, then calls HP+1 at most once. There
 * is no per-master-row publication. Stable deletion of distinct IDs commutes;
 * this does not assume the native GetList<Condition> dictionary order.
 * The existing complete GameState condition catalog is the Web authority. */
export function projectOwnedConditionRemoveType<T extends OwnedConditionResourceMember>(
  roster: readonly T[], party: PartyState, command: OwnedConditionCommand,
  definitions: readonly { id: number; type: number }[], conditions: BattleConditions,
): { roster: T[]; targets: string[]; steps: { targetId: string; roster: T[] }[] } {
  validateOwnedConditionCommand(command);
  if (command.kind !== "remove-condition" || command.conditionType <= 0)
    throw new Error("Expected source nonzero RemoveCondition type");
  const identities = new Set<number>();
  for (const definition of definitions) {
    if (int32(definition.id) <= 0 || int32(definition.type) < 0 || identities.has(definition.id))
      throw new Error("Invalid owned condition master identity");
    identities.add(definition.id);
    if (conditions.referenceTypes([definition.id])[0] !== definition.type)
      throw new Error("Owned condition master type mismatch");
  }
  const matching = new Set(definitions.filter(row => row.type === command.conditionType).map(row => row.id));
  if (!matching.size) throw new Error("Missing owned condition type");
  for (const member of roster) {
    if (!Array.isArray(member.conditionIds) || member.conditionIds.some(id => !identities.has(id)))
      throw new Error("Unknown owned condition reference");
    // Identity-only removal never launders an unknown active behavior into a
    // valid state, even when the instruction would remove that very row.
    conditions.validateOwner(member.conditionIds,"player");
  }
  const targets = ownedConditionTargets(roster, party, command.target), next = structuredClone([...roster]);
  const steps: { targetId: string; roster: T[] }[] = [];
  for (const targetId of targets) {
    const member = next.find(row => row.id === targetId)!;
    if (int32(member.maxHp) < 1 || int32(member.hp) < 0 || member.hp > member.maxHp)
      throw new Error("Invalid owned condition HP");
    const hadDeath = conditions.referenceTypes(member.conditionIds).includes(5);
    if ((member.hp === 0) !== hadDeath) throw new Error("Owned HP/death state mismatch");
    member.conditionIds = member.conditionIds.filter(id => !matching.has(id));
    if (command.conditionType === 5 && hadDeath) {
      if (member.hp === 0x7fffffff) throw new Error("Owned condition HP addition overflow");
      member.hp = Math.min(member.hp + 1, member.maxHp);
      member.conditionIds = conditions.updateDying(member.hp, member.maxHp, member.conditionIds);
    }
    // Unchanged targets still refresh once; preserve target order and the
    // complete intermediate roster for the existing appearance transaction.
    steps.push({ targetId, roster: structuredClone(next) });
  }
  return { roster: next, targets, steps };
}

/** Compatibility entry for the previously closed death/dying family. The
 * common projection owns every nonzero type; this entry grants no new domain. */
export function projectOwnedConditionRemoveLife<T extends OwnedConditionResourceMember>(
  roster: readonly T[], party: PartyState, command: OwnedConditionCommand,
  definitions: readonly { id: number; type: number }[], conditions: BattleConditions,
) {
  if(command.kind!=="remove-condition"||![4,5].includes(command.conditionType))
    throw new Error("Expected source RemoveCondition type4/5");
  return projectOwnedConditionRemoveType(roster,party,command,definitions,conditions);
}

/** This pure storage projection does not admit any previously unknown active
 * condition behavior. GameState validates the complete input/result as usual.
 * CurrentConditionList is copied by 871840 -> 52e5d0 -> 536dd0 before iteration;
 * RemoveCondition(..., true) edits the actual owner, never that snapshot. */
export function projectOwnedConditionRemoveAll<T extends OwnedConditionResourceMember>(
  roster: readonly T[], party: PartyState, command: OwnedConditionCommand, conditions: BattleConditions,
): { roster: T[]; targets: string[]; steps: { targetId: string; roster: T[] }[]; coreI0Writes: readonly number[] } {
  validateOwnedConditionCommand(command);
  if (command.kind !== "remove-condition" || command.conditionType !== 0)
    throw new Error("Expected source RemoveCondition type0");
  const nativeTypes = conditions.referenceTypes(retainedRows.map(row => row.id));
  if (nativeTypes.some((type, index) => type !== retainedRows[index]!.type))
    throw new Error("Source retained condition row identity mismatch");
  if (!Array.isArray(roster)) throw new Error("Invalid owned condition roster");
  for (let index = 0; index < roster.length; index++) {
    if (!Object.hasOwn(roster, index)) throw new Error("Sparse owned condition roster");
    const member = roster[index]!;
    if (!Array.isArray(member.conditionIds)) throw new Error("Invalid owned condition references");
    for (let n = 0; n < member.conditionIds.length; n++)
      if (!Object.hasOwn(member.conditionIds, n)) throw new Error("Sparse owned condition references");
    conditions.referenceTypes(member.conditionIds);
  }
  const targets = ownedConditionTargets(roster, party, command.target);
  const next: T[] = structuredClone([...roster]), byId = new Map(next.map(member => [member.id, member]));
  for (const id of targets) {
    const member = byId.get(id)!;
    if (int32(member.maxHp) < 1 || int32(member.hp) < 0 || member.hp > member.maxHp)
      throw new Error("Invalid owned condition HP");
    if ((member.hp === 0) !== conditions.referenceTypes(member.conditionIds).includes(5))
      throw new Error("Owned HP/death state mismatch");
  }
  const keep = new Set(retainedRows.map(row => row.id)), writes: number[] = [];
  const steps: { targetId: string; roster: T[] }[] = [];
  for (const targetId of targets) {
    const member = byId.get(targetId)!, snapshot = [...member.conditionIds];
    const types = conditions.referenceTypes(snapshot);
    for (const [index, id] of snapshot.entries()) {
      writes.push(id); // Before the hook, including its false/retained branch.
      if (keep.has(id)) continue;
      member.conditionIds = member.conditionIds.filter(conditionId => conditionId !== id);
      if (types[index] === 5) {
        // This call is per original snapshot record, even when a prior call
        // already removed all duplicates of that row. Do not collapse it.
        if (member.hp === 0x7fffffff) throw new Error("Owned condition HP addition overflow");
        member.hp = Math.min(member.hp + 1, member.maxHp);
        member.conditionIds = conditions.updateDying(member.hp, member.maxHp, member.conditionIds);
      }
    }
    // Native does one Refresh(false), then AffectLeader per selected owner,
    // including an empty condition list or a hook that retained every row.
    steps.push({ targetId, roster: structuredClone(next) });
  }
  return { roster: next, targets, steps, coreI0Writes: Object.freeze(writes) };
}

export type PrepareOwnedConditionCore = (
  steps: readonly OwnedConditionAppearanceStep[], writes: readonly number[],
) => PartyPresentationPublication;

/** The host must prepare the complete ordered appearance sequence, including
 * KeepBadStatusVisual semantics, before any owned or renderer publication. */
export function executeOwnedConditionEvent(
  op: OwnedConditionEventOp,
  port: FieldOwnedConditionPort | undefined,
  preparePresentation?: (steps: readonly OwnedConditionAppearanceStep[]) => PartyPresentationPublication,
  prepareCore?: PrepareOwnedConditionCore,
): void {
  if (op.kind !== "owned-condition") throw new Error("Invalid owned condition event");
  validateOwnedConditionCommand(op.command);
  const coreRequired = op.command.kind === "remove-condition" && op.command.conditionType === 0;
  if (coreRequired && !prepareCore) throw new Error("Remove-all conditions requires the same MainCore register owner");
  if (!port) throw new Error("Field owned condition state is unavailable");
  const transaction = port.prepare(structuredClone(op.command));
  let publish: PartyPresentationPublication | undefined;
  if (coreRequired) {
    if (!transaction.coreI0Writes) throw new Error("Remove-all conditions has no register write projection");
    publish = prepareCore!(structuredClone(transaction.steps), [...transaction.coreI0Writes]);
    if (typeof publish !== "function") throw new Error("Invalid owned condition Core publication");
  } else if (transaction.steps.length) {
    if (!preparePresentation) throw new Error("Owned condition actor refresh is unavailable");
    publish = preparePresentation(structuredClone(transaction.steps));
    if (typeof publish !== "function") throw new Error("Invalid owned condition presentation transaction");
  }
  publish?.validate?.();
  transaction.commitWith(publish ?? (() => {}));
}
