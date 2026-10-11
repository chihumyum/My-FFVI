import { checkpointKeys } from "./checkpoint-validation.js";
import {
  initialEquipmentStock,
  validateEquipmentState,
  type EquipmentCatalog,
  type EquipmentStock,
} from "./equipment.js";
import {
  activePartyMembers,
  validatePartyState,
  type ActivePartyMember,
  type PartyPosition,
  type PartyRow,
  type PartyState,
  type PartyAppearanceCandidate,
  type PreparePartyPresentation,
} from "./party.js";
import { int32 } from "./script-integer.js";

export type OwnedJob = { id: number; level: number; proficiency: number };
/** Lifecycle inputs are persisted facts, not inferred from a battle projection. */
export type RosterMember = {
  id: string;
  sourceId: number;
  ownedId: number;
  enabled: boolean;
  jobId: number;
  additionalLevel: number;
  magicStoneId: number;
  ownedJobs: OwnedJob[];
  equipment: number[];
};
export type RosterLifecycleState<T extends RosterMember = RosterMember> = {
  roster: T[];
  party: PartyState;
  equipmentStock: EquipmentStock[];
  releasedJobIds: number[];
};
export type RosterCommand =
  | { kind: "unlock"; sourceId: number; refreshActors: false }
  | {
      kind: "join";
      sourceId: number;
      /** null is native -1: first empty current cell, or enabled reserve. */
      position: PartyPosition | null;
      row: PartyRow;
      refreshActors: boolean;
      recovery: boolean;
      refitEquipment: boolean;
    }
  | {
      kind: "secede";
      sourceId: number;
      /** true retains the loadout while removing its copies from total stock. */
      removeEquipment: boolean;
      refreshActors: true;
    };
export type RosterLifecycleCatalog = {
  equipment: EquipmentCatalog;
  jobIds: number[];
  /** Current.CorrectLevel's source-indexed first-join correction, if recovered. */
  firstJoinLevelAdjustments?: Record<string, number>;
};
export type RosterLifecycleProviders<T extends RosterMember> = {
  /** Full AddFromMaster implementation. Never substitute a battle definition. */
  initialize?: (request: {
    sourceId: number;
    ownedId: number;
    roster: T[];
    releasedJobIds: number[];
  }) => T;
  /** Includes the parameter, condition and passive consequences of SetEquip. */
  projectEquipment?: (member: T, reason: "remove-all" | "refit") => T;
  /** Source growth/learning provider, with its own deterministic random input.
   * targetLevel selects the native experience-table row, not a forced final level. */
  correctLevel?: (member: T, targetLevel: number) => T;
  /** FullRecoveryHpAndMp followed by RemoveCondition(id, 0). */
  recover?: (member: T) => T;
  /** The owner validates all additional fields, including abilities and growth. */
  validateMember: (member: T) => void;
};
export type RosterReceipt =
  | { kind: "unlocked"; id: string; ownedId: number }
  | { kind: "enabled"; id: string; enabled: boolean }
  | { kind: "released-job"; jobId: number; released: boolean }
  | { kind: "equipment-count"; id: number; before: number; after: number }
  | { kind: "equipment-projection"; id: string; reason: "remove-all" | "refit" }
  | { kind: "level-correction"; id: string; targetLevel: number }
  | { kind: "recovered"; id: string }
  | { kind: "removed-magic-stone"; id: string; magicStoneId: number };
export type RosterLifecyclePreview<T extends RosterMember> = {
  state: RosterLifecycleState<T>;
  activeMembers: ActivePartyMember[];
  refreshActors: boolean;
  receipts: RosterReceipt[];
};
export type RosterLifecycleEventOp = {
  kind: "roster";
  command: RosterCommand;
  dependencies: { table: string; id: number }[];
};
export type RosterLifecycleTransaction = {
  readonly activeMembers: ActivePartyMember[];
  readonly refreshActors: boolean;
  readonly appearance?: PartyAppearanceCandidate;
  commit(): void;
};
export interface FieldRosterPort {
  prepare(command: RosterCommand): RosterLifecycleTransaction;
}

function positive(value: number): number {
  if (int32(value) < 1) throw new Error("Invalid roster identity");
  return value;
}
function unique(values: readonly (string | number)[], label: string) {
  if (new Set(values).size !== values.length)
    throw new Error(`Duplicate roster ${label}`);
}
/** Player menu slot locks do not apply to native RemoveAllEquip/SetEquip. */
export function lifecycleEquipmentCatalog(
  catalog: EquipmentCatalog,
): EquipmentCatalog {
  return {
    ...catalog,
    characters: Object.fromEntries(
      Object.entries(catalog.characters).map(([id, value]) => [
        id,
        { ...value, accessoriesOnly: false },
      ]),
    ),
  };
}
/** Native registration rebuild enumerates GetOwnedCharactersClone(false). */
export function registeredEquipmentRoster<T extends RosterMember>(
  state: RosterLifecycleState<T>,
): T[] {
  return state.roster.filter((member) => member.enabled);
}

export function validateRosterLifecycle<T extends RosterMember>(
  state: RosterLifecycleState<T>,
  catalog: RosterLifecycleCatalog,
  validateMember: (member: T) => void,
): void {
  checkpointKeys(state, "roster,party,equipmentStock,releasedJobIds");
  if (!Array.isArray(state.roster) || !Array.isArray(state.releasedJobIds))
    throw new Error("Invalid roster lifecycle state");
  unique(
    state.roster.map((r) => r.id),
    "identity",
  );
  unique(
    state.roster.map((r) => r.ownedId),
    "owned number",
  );
  unique(
    state.roster.map((r) => r.sourceId),
    "source identity",
  );
  unique(catalog.jobIds, "job catalog");
  catalog.jobIds.forEach(positive);
  const checkJob = (id: number) => {
    if (!catalog.jobIds.includes(positive(id)))
      throw new Error("Unknown roster job");
  };
  unique(state.releasedJobIds, "released job");
  state.releasedJobIds.forEach(checkJob);
  const equipment = lifecycleEquipmentCatalog(catalog.equipment);
  for (const member of state.roster) {
    if (
      typeof member.id !== "string" ||
      !member.id ||
      typeof member.enabled !== "boolean"
    )
      throw new Error("Invalid roster member");
    positive(member.sourceId);
    positive(member.ownedId);
    if (member.ownedId > state.roster.length)
      throw new Error("Non-contiguous native owned identity");
    checkJob(member.jobId);
    if (positive(member.additionalLevel) > 99 || int32(member.magicStoneId) < 0)
      throw new Error("Invalid roster lifecycle parameter");
    if (!Array.isArray(member.ownedJobs)) throw new Error("Missing owned jobs");
    unique(
      member.ownedJobs.map((j) => j.id),
      "owned job",
    );
    for (const job of member.ownedJobs) {
      checkpointKeys(job, "id,level,proficiency");
      checkJob(job.id);
      positive(job.level);
      if (int32(job.proficiency) < 0)
        throw new Error("Invalid job proficiency");
    }
    if (!member.ownedJobs.some((j) => j.id === member.jobId))
      throw new Error("Current job is not owned");
    // Disabled loadouts retain their identities but do not reserve inventory.
    initialEquipmentStock(equipment, [member]);
    validateMember(structuredClone(member));
  }
  validatePartyState(state.party, state.roster);
  validateEquipmentState(
    equipment,
    registeredEquipmentRoster(state),
    state.equipmentStock,
  );
}

export function validateRosterCommand(command: RosterCommand): void {
  positive(command.sourceId);
  if (command.kind === "unlock") {
    checkpointKeys(command, "kind,sourceId,refreshActors");
    if (command.refreshActors !== false)
      throw new Error("Invalid unlock refresh");
  } else if (command.kind === "secede") {
    checkpointKeys(command, "kind,sourceId,removeEquipment,refreshActors");
    if (
      typeof command.removeEquipment !== "boolean" ||
      command.refreshActors !== true
    )
      throw new Error("Invalid secede command");
  } else if (command.kind === "join") {
    checkpointKeys(
      command,
      "kind,sourceId,position,row,refreshActors,recovery,refitEquipment",
    );
    if (
      (command.position !== null &&
        (!Number.isInteger(command.position) ||
          command.position < 0 ||
          command.position > 3)) ||
      !["front", "back"].includes(command.row) ||
      [command.refreshActors, command.recovery, command.refitEquipment].some(
        (b) => typeof b !== "boolean",
      )
    )
      throw new Error("Invalid join command");
  } else throw new Error("Unknown roster lifecycle command");
}

/** CorrectLevel excludes the joining owner and source IDs >= 15 from its average. */
export function rosterJoinLevel<T extends RosterMember>(
  state: RosterLifecycleState<T>,
  member: T,
  firstJoin: boolean,
  catalog: RosterLifecycleCatalog,
): number {
  const eligible = state.roster.filter(
    (m) => m.enabled && m.sourceId < 15 && m.sourceId !== member.sourceId,
  );
  const sum = eligible.reduce((n, m) => int32(n + m.additionalLevel), 0);
  let level = eligible.length ? Math.trunc(sum / eligible.length) : 1;
  if (firstJoin) {
    const adjustment = catalog.firstJoinLevelAdjustments?.[member.sourceId];
    if (adjustment === undefined)
      throw new Error("Unimplemented first-join level adjustment");
    level = int32(level + int32(adjustment));
  }
  return Math.min(99, Math.max(1, level));
}

/**
 * Pure complete-command projection. Lower-level SetEnableCorps alone is not a
 * published command: it changes the flag without rebuilding registrations.
 * All provider calls see detached copies; an exception discards the candidate.
 */
export function prepareRosterLifecycle<T extends RosterMember>(
  current: RosterLifecycleState<T>,
  command: RosterCommand,
  catalog: RosterLifecycleCatalog,
  providers: RosterLifecycleProviders<T>,
): RosterLifecyclePreview<T> {
  validateRosterCommand(command);
  validateRosterLifecycle(current, catalog, providers.validateMember);
  const state = structuredClone(current),
    receipts: RosterReceipt[] = [];
  const equipment = lifecycleEquipmentCatalog(catalog.equipment);
  let member = state.roster.find((r) => r.sourceId === command.sourceId);
  const existed = member !== undefined,
    wasEnabled = member?.enabled === true;
  const firstJoin = !existed || member!.additionalLevel === 1;
  const replace = (next: T, allowGrowth = false) => {
    if (!member) throw new Error("Missing roster provider target");
    for (const key of [
      "id",
      "sourceId",
      "ownedId",
      "enabled",
      "jobId",
      "magicStoneId",
    ] as const)
      if (next[key] !== member[key])
        throw new Error("Roster provider changed lifecycle identity");
    if (
      (!allowGrowth && next.additionalLevel !== member.additionalLevel) ||
      (allowGrowth && next.additionalLevel < member.additionalLevel) ||
      JSON.stringify(next.equipment) !== JSON.stringify(member.equipment) ||
      JSON.stringify(next.ownedJobs) !== JSON.stringify(member.ownedJobs)
    )
      throw new Error("Roster provider changed lifecycle structure");
    providers.validateMember(structuredClone(next));
    state.roster[state.roster.indexOf(member)] = structuredClone(next);
    member = state.roster.find((r) => r.sourceId === command.sourceId)!;
  };
  const equipmentCounts = (direction: 1 | -1) => {
    for (const id of member!.equipment) {
      const definition = equipment.definitions[id];
      if (!definition) throw new Error("Unknown lifecycle equipment");
      if (definition.empty) continue;
      let stack = state.equipmentStock.find((s) => s.id === id);
      if (!stack) state.equipmentStock.push((stack = { id, count: 0 }));
      const before = stack.count;
      stack.count = Math.max(0, Math.min(equipment.limit, before + direction));
      receipts.push({
        kind: "equipment-count",
        id,
        before,
        after: stack.count,
      });
    }
    state.equipmentStock.sort((a, b) => a.id - b.id);
  };
  const projectEquipment = (reason: "remove-all" | "refit") => {
    if (!providers.projectEquipment)
      throw new Error("Unimplemented lifecycle equipment projection");
    replace(providers.projectEquipment(structuredClone(member!), reason));
    receipts.push({ kind: "equipment-projection", id: member!.id, reason });
  };
  const setEnabled = (enabled: boolean) => {
    member!.enabled = enabled;
    receipts.push({ kind: "enabled", id: member!.id, enabled });
  };
  const releaseJob = (released: boolean) => {
    const jobId = member!.jobId;
    if (released) {
      if (!state.releasedJobIds.includes(jobId))
        state.releasedJobIds.push(jobId);
      // AddReleaseJob invokes ReleaseJob on all owned, even for an existing release.
      for (const owner of state.roster)
        if (!owner.ownedJobs.some((job) => job.id === jobId))
          owner.ownedJobs.push({ id: jobId, level: 1, proficiency: 0 });
    } else
      state.releasedJobIds = state.releasedJobIds.filter((id) => id !== jobId);
    receipts.push({ kind: "released-job", jobId, released });
  };

  if (!member && command.kind !== "secede") {
    if (!providers.initialize)
      throw new Error("Unimplemented complete owned-character initialization");
    const ownedId = state.roster.length + 1;
    member = structuredClone(
      providers.initialize({
        sourceId: command.sourceId,
        ownedId,
        roster: structuredClone(state.roster),
        releasedJobIds: [...state.releasedJobIds],
      }),
    );
    if (
      member.sourceId !== command.sourceId ||
      member.ownedId !== ownedId ||
      member.enabled !== true
    )
      throw new Error("Initializer changed source owned identity");
    state.roster.push(member);
    equipmentCounts(1);
    receipts.push({ kind: "unlocked", id: member.id, ownedId });
  }
  if (!member) throw new Error("Roster lifecycle references unowned character");

  if (command.kind === "secede") {
    if (!command.removeEquipment) {
      const character = equipment.characters[member.sourceId];
      if (!character || character.emptySlots.length !== 6)
        throw new Error("Missing empty equipment slots");
      member.equipment = [...character.emptySlots];
      projectEquipment("remove-all");
    }
    setEnabled(false);
    releaseJob(false);
    const slot = state.party.slots[state.party.selectedSlot];
    const cell = slot.find((cell) => cell.id === member!.id);
    if (cell) cell.id = null; // Remove keeps this cell's row and every other saved slot.
    if (command.removeEquipment) equipmentCounts(-1);
    receipts.push({
      kind: "removed-magic-stone",
      id: member.id,
      magicStoneId: member.magicStoneId,
    });
    member.magicStoneId = 0; // OwnedCharacterClient.RemoveMagicStone only clears the equipped ID.
  } else if (command.kind === "join") {
    const slot = state.party.slots[state.party.selectedSlot];
    const position =
      command.position ?? slot.findIndex((cell) => cell.id === null);
    setEnabled(true);
    releaseJob(true);
    if (position >= 0 && !slot.some((cell) => cell.id === member!.id))
      slot[position] = {
        id: member.id,
        row: command.position === null ? "front" : command.row,
      };
    if (existed && firstJoin) {
      equipmentCounts(1);
      projectEquipment("refit");
    }
    if (!wasEnabled) {
      const targetLevel = rosterJoinLevel(state, member, firstJoin, catalog);
      if (targetLevel > member.additionalLevel) {
        if (!providers.correctLevel)
          throw new Error("Unimplemented source join growth provider");
        replace(
          providers.correctLevel(structuredClone(member), targetLevel),
          true,
        );
        receipts.push({ kind: "level-correction", id: member.id, targetLevel });
      }
      if (command.refitEquipment && !firstJoin) {
        equipmentCounts(1);
        projectEquipment("refit");
      }
    }
    if (command.recovery) {
      if (!providers.recover)
        throw new Error("Unimplemented roster full recovery");
      replace(providers.recover(structuredClone(member)));
      receipts.push({ kind: "recovered", id: member.id });
    }
  }
  validateRosterLifecycle(state, catalog, providers.validateMember);
  return {
    state,
    activeMembers: activePartyMembers(state.party),
    refreshActors: command.refreshActors,
    receipts,
  };
}

export function executeRosterLifecycleEvent(
  op: RosterLifecycleEventOp,
  port: FieldRosterPort | undefined,
  preparePresentation?: PreparePartyPresentation,
): void {
  if (!port) throw new Error("Field roster state is unavailable");
  if (op.kind !== "roster") throw new Error("Invalid roster event");
  validateRosterCommand(op.command);
  const transaction = port.prepare(structuredClone(op.command));
  if (transaction.refreshActors !== op.command.refreshActors)
    throw new Error("Roster refresh transaction contract changed");
  let publishPresentation: (() => void) | undefined;
  // FullRecovery ends in RemoveCondition(type=0), which requests
  // ChangeAssetPartyCharacter(false) even for an empty condition list. The
  // explicit ChangeAssetPartyCharacter(true), when requested, occurs afterward.
  if (transaction.refreshActors || (op.command.kind === "join" && op.command.recovery)) {
    if (!preparePresentation)
      throw new Error("Roster actor refresh is unavailable");
    publishPresentation = preparePresentation(
      structuredClone(transaction.activeMembers),
      structuredClone(transaction.appearance),
      transaction.refreshActors,
    );
    if (typeof publishPresentation !== "function")
      throw new Error("Invalid roster presentation transaction");
  }
  transaction.commit();
  publishPresentation?.();
}
