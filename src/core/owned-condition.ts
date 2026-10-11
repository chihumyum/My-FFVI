import { checkpointKeys } from "./checkpoint-validation.js";
import { int32 } from "./script-integer.js";
import { activePartyMembers, validatePartyState, type PartyState,
  type PartyAppearanceCandidate } from "./party.js";

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
};
export type OwnedConditionTransaction = {
  targets: string[];
  /** Native dispatch refreshes after each target, including a storage no-op. */
  steps: OwnedConditionAppearanceStep[];
  commit(): void;
};
export type FieldOwnedConditionPort = {
  prepare(command: OwnedConditionCommand): OwnedConditionTransaction;
};

export function validateOwnedConditionCommand(command: OwnedConditionCommand): void {
  checkpointKeys(command, "kind,conditionType,target");
  if (command.kind !== "add-condition" && command.kind !== "remove-condition")
    throw new Error("Unknown owned condition operation");
  if (int32(command.conditionType) !== 607)
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

/** The host must prepare the complete ordered appearance sequence, including
 * KeepBadStatusVisual semantics, before any owned or renderer publication. */
export function executeOwnedConditionEvent(
  op: OwnedConditionEventOp,
  port: FieldOwnedConditionPort | undefined,
  preparePresentation?: (steps: readonly OwnedConditionAppearanceStep[]) => () => void,
): void {
  if (op.kind !== "owned-condition") throw new Error("Invalid owned condition event");
  validateOwnedConditionCommand(op.command);
  if (!port) throw new Error("Field owned condition state is unavailable");
  const transaction = port.prepare(structuredClone(op.command));
  let publish: (() => void) | undefined;
  if (transaction.steps.length) {
    if (!preparePresentation) throw new Error("Owned condition actor refresh is unavailable");
    publish = preparePresentation(structuredClone(transaction.steps));
    if (typeof publish !== "function") throw new Error("Invalid owned condition presentation transaction");
  }
  transaction.commit();
  publish?.();
}
