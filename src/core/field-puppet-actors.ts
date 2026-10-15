import { int32 } from "./script-integer.js";
import type { FieldPuppetCallback } from "./field-task-control.js";

/** Source Format flags belong to each script, not to a saved scene. */
export type FieldPuppetScriptContext = {
  skipInitialize: boolean;
  keepPlayerPuppet: boolean;
  keepBadStatusVisual: boolean;
  ridingVehicle: boolean;
  characteristics: boolean;
  scriptHash: string;
  miscHash: string;
};

export type FieldPuppetActorCatalog = {
  kind: "field-puppet-actors-v1";
  memberCount: 4;
  characteristics: boolean;
  corpsOrder: number[];
  residents: { assetId: number; characterStatusId: number; isCorps: boolean }[];
  conditionChanges: { type: number; residentCharacterId: number }[];
  miscHash: string;
};

/** Native OwnedCharacterData.Id and CharacterStatus.Id are separate identities. */
export type FieldPuppetOwned = {
  ownedId: number;
  sourceId: number;
  enabled: boolean;
  conditionTypes: number[];
};
export type FieldPuppetActor = {
  id: string;
  character: boolean;
  riding: boolean;
};
/** Read-only host input. FieldGame still owns positions, playback and visibility.
 * Null instances mean source-proven absence; missing properties are rejected. */
export type FieldPuppetActorContext = {
  player: string;
  actors: FieldPuppetActor[];
  camera: string | null;
  /** Source residentPartyEntityList, not the three saved-party avatars. */
  partyPuppets: (string | null)[];
  otherParties: (string | null)[];
  residents: { assetId: number; actor: string | null }[];
  entities: { entityId: number; actor: string }[];
  /** The four current Corps cells store owned IDs (zero means an empty cell). */
  party: number[];
  owned: FieldPuppetOwned[];
  savedLeaderIndex: number;
  conditionController: "present" | "absent" | "unknown";
  companion: "absent" | "present" | "unknown";
  transport: { id: number; typeId: number } | null | "unknown";
  restorePartyInstruction: "absent" | "present" | "unknown";
};

/** Effects are ordered source calls. A host must prepare ALL of them against a
 * private actor/camera draft before publishing actors, tasks or assignment bits.
 * copy-layer includes map-property/texture refresh as separate following calls. */
export type FieldPuppetActorEffect =
  | { kind: "init-camera-dummy"; actor: string; player: string }
  | { kind: "copy-position"; actor: string; from: string; mode: "overwrite" | "local" | "player-z" }
  | { kind: "copy-layer"; actor: string; from: string }
  | { kind: "look" | "cue"; actor: string; from: string }
  | { kind: "show" | "hide" | "switch-transparent" | "apply-view-properties" | "attach-transparent"; actor: string }
  | { kind: "visibility-fade"; actor: string; visible: boolean; durationSeconds: number; nowSeconds: number }
  | { kind: "visibility-tick"; actor: string; nowSeconds: number }
  | { kind: "ride-out"; actor: string }
  | { kind: "ride-on"; actor: string; transportationId: number };

export type FieldPuppetActorPlan = {
  /** Null means native does not write this Integrator field. */
  leaderId: number | null;
  assignments: boolean[] | null;
  effects: FieldPuppetActorEffect[];
};

export type FieldPuppetControlContext = {
  /** CheckCurrentWorldMap() && Integrator.isMapScript, not map identity alone. */
  worldMapScript: boolean;
  /** This is ExecPuppetCallback; it is distinct from Puppet.SetPosCallback. */
  callback: FieldPuppetCallback;
};

/** FieldGame owns the interpreter fields and actor publication. A host reads
 * its current candidate owned/context state, then prepares all source effects
 * against the same actor revision. Preparation has no externally visible
 * writes; its synchronous publication must be non-failing and called once. */
export interface FieldPuppetActorsPort {
  read(): { catalog: FieldPuppetActorCatalog; context: FieldPuppetActorContext };
  prepare(plan: Readonly<FieldPuppetActorPlan>): () => void;
  controlContext(): FieldPuppetControlContext;
  /** Prepare all THREE source switches together: map collider enablement,
   * entity collision enablement and interactive-target observation. The host
   * must preserve every entity's intrinsic collision configuration. A busy
   * flag alone is not an implementation of these effects. */
  prepareCollision(enabled: boolean): () => void;
}

const sourcePuppets = [-1001, -1002, -1003, -1004, -1005, -1010] as const;
const validId = (id: unknown): id is string => typeof id === "string" && id.length > 0;
function integer(n: number, min = -0x80000000): number {
  if (int32(n) < min) throw new Error("Invalid source puppet integer");
  return n;
}
function bool(value: unknown): void {
  if (typeof value !== "boolean") throw new Error("Unknown source puppet boolean");
}

export function validateFieldPuppetScriptContext(script: FieldPuppetScriptContext): void {
  if (!script) throw new Error("Missing source puppet script context");
  for (const key of ["skipInitialize", "keepPlayerPuppet", "keepBadStatusVisual", "ridingVehicle", "characteristics"] as const)
    bool(script[key]);
  for (const key of ["scriptHash", "miscHash"] as const)
    if (!/^[0-9a-f]{64}$/.test(script[key])) throw new Error("Unbound source puppet script context");
}

function validateCatalog(catalog: FieldPuppetActorCatalog): void {
  if (!catalog || catalog.kind !== "field-puppet-actors-v1" || catalog.memberCount !== 4 ||
      !/^[0-9a-f]{64}$/.test(catalog.miscHash)) throw new Error("Missing source puppet actor catalog");
  bool(catalog.characteristics);
  if (!Array.isArray(catalog.corpsOrder) || catalog.corpsOrder.length !== 4 ||
      new Set(catalog.corpsOrder).size !== 4 || catalog.corpsOrder.some((n) => integer(n, 0) > 3))
    throw new Error("Invalid source puppet corps order");
  if (!Array.isArray(catalog.residents) || !Array.isArray(catalog.conditionChanges))
    throw new Error("Unknown source puppet resident/condition providers");
  const ids = new Set<number>();
  for (const resident of catalog.residents) {
    integer(resident.assetId, 1); integer(resident.characterStatusId, 1); bool(resident.isCorps);
    if (ids.has(resident.assetId)) throw new Error("Duplicate source resident asset identity");
    ids.add(resident.assetId);
  }
  for (const change of catalog.conditionChanges) {
    integer(change.type, 1); integer(change.residentCharacterId, 1);
  }
}

function validateContext(catalog: FieldPuppetActorCatalog, context: FieldPuppetActorContext): void {
  validateCatalog(catalog);
  if (!context || !validId(context.player) || !Array.isArray(context.actors))
    throw new Error("Missing source puppet actor host");
  const actors = new Set<string>();
  for (const actor of context.actors) {
    if (!validId(actor.id) || actors.has(actor.id)) throw new Error("Invalid source puppet actor identity");
    bool(actor.character); bool(actor.riding);
    if (actor.riding && !actor.character) throw new Error("Non-character source puppet cannot ride");
    actors.add(actor.id);
  }
  if (!actors.has(context.player)) throw new Error("Missing source player actor");
  const binding = (id: string | null) => {
    if (id !== null && (!validId(id) || !actors.has(id))) throw new Error("Unknown source puppet entity binding");
  };
  if (context.camera !== null && !validId(context.camera)) throw new Error("Unknown source camera dummy binding");
  if (!Array.isArray(context.partyPuppets) || !Array.isArray(context.otherParties) ||
      context.otherParties.length !== 3 || !Array.isArray(context.residents) || !Array.isArray(context.entities))
    throw new Error("Unknown source puppet entity collections");
  Array.from(context.partyPuppets).forEach(binding); Array.from(context.otherParties).forEach(binding);
  const residents = new Set<number>(), entities = new Set<number>();
  for (const row of context.residents) {
    integer(row.assetId, 1); binding(row.actor);
    if (residents.has(row.assetId)) throw new Error("Duplicate source resident binding");
    residents.add(row.assetId);
  }
  for (const row of context.entities) {
    integer(row.entityId, 1); binding(row.actor);
    if (entities.has(row.entityId)) throw new Error("Ambiguous source map entity binding");
    entities.add(row.entityId);
  }
  if (!Array.isArray(context.party) || context.party.length !== 4 || !Array.isArray(context.owned))
    throw new Error("Missing source puppet owned/corps inputs");
  const owned = new Set<number>();
  for (const row of context.owned) {
    integer(row.ownedId, 1); integer(row.sourceId, 1); bool(row.enabled);
    if (owned.has(row.ownedId) || !Array.isArray(row.conditionTypes)) throw new Error("Invalid source puppet owned state");
    owned.add(row.ownedId); row.conditionTypes.forEach((n) => integer(n, 1));
  }
  for (const id of context.party) {
    integer(id, 0);
    if (id !== 0 && !owned.has(id)) throw new Error("Source puppet Corps references missing owner");
  }
  if (new Set(context.party.filter((id) => id !== 0)).size !== context.party.filter((id) => id !== 0).length)
    throw new Error("Repeated source puppet Corps owner");
  integer(context.savedLeaderIndex);
  for (const key of ["conditionController", "companion", "restorePartyInstruction"] as const)
    if (!["absent", "present", "unknown"].includes(context[key])) throw new Error("Unknown source puppet " + key);
  if (context.transport !== null && context.transport !== "unknown") {
    if (!context.transport) throw new Error("Unknown source puppet transportation");
    integer(context.transport.id, 1); integer(context.transport.typeId, 0);
  }
}

/** SaveMapData.playableCharacterCorpsId is a Corps position, while the returned
 * puppet index counts nonempty cells in source corps_order. No enabled filter. */
export function fieldPuppetLeaderId(catalog: FieldPuppetActorCatalog, context: FieldPuppetActorContext): number {
  validateContext(catalog, context);
  const leader = Math.max(0, context.savedLeaderIndex);
  let index = 0;
  for (const position of catalog.corpsOrder) {
    if (context.party[position] === 0) continue;
    if (position === leader) return -1001 - index;
    index++;
  }
  throw new Error("Source puppet leader is not an occupied Corps position");
}

/** These flags are Integrator-owned and cleared at Initialize(start) / Exec. */
export function fieldPuppetAssignments(): boolean[] { return Array(5).fill(false); }

export function projectFieldPuppetAssignment(
  assignments: readonly boolean[], id: number, resident: boolean, memberCount: number,
): { id: number; assignments: boolean[] } {
  if (assignments.length !== 5 || Array.from(assignments).some((v) => typeof v !== "boolean") || memberCount !== 4)
    throw new Error("Invalid source puppet assignment state");
  integer(id); bool(resident);
  const index = id < 0 ? -1001 - id : id;
  if (index < 0 || index >= assignments.length) throw new Error("Source puppet assignment outside five-slot capacity");
  const next = [...assignments];
  if (!next[index]) { next[index] = true; return { id, assignments: next }; }
  if (resident) throw new Error("Resident party actor is already assigned to a puppet");
  const free = next.findIndex((assigned, n) => n < memberCount && !assigned);
  if (free < 0) throw new Error("No free source party puppet assignment");
  next[free] = true;
  return { id: -1001 - free, assignments: next };
}

function scriptBinding(catalog: FieldPuppetActorCatalog, script: FieldPuppetScriptContext): void {
  validateFieldPuppetScriptContext(script);
  if (script.miscHash !== catalog.miscHash || script.characteristics !== catalog.characteristics)
    throw new Error("Source puppet script/provider mismatch");
}
function puppetIndex(catalog: FieldPuppetActorCatalog, context: FieldPuppetActorContext, ordinal: number): number | null {
  const occupied = catalog.corpsOrder.filter((slot) => context.party[slot]! > 0);
  return occupied[ordinal] ?? null;
}
function puppet(catalog: FieldPuppetActorCatalog, context: FieldPuppetActorContext, ordinal: number): string | null {
  const index = puppetIndex(catalog, context, ordinal);
  if (index === null || index >= context.partyPuppets.length) return null;
  return context.partyPuppets[index]!;
}

/** Resident aliases select the newest ENABLED owner of that CharacterStatus,
 * then seek its owned Id in the current Corps list. They do not grant ownership. */
export function fieldPuppetResidentIndex(
  catalog: FieldPuppetActorCatalog, context: FieldPuppetActorContext, assetId: number,
): number | null {
  validateContext(catalog, context); integer(assetId, 1);
  const resident = catalog.residents.find((r) => r.assetId === assetId);
  if (!resident) throw new Error("Missing source puppet resident descriptor");
  if (!resident.isCorps) return null;
  const owned = context.owned.filter((o) => o.enabled && o.sourceId === resident.characterStatusId)
    .sort((a, b) => b.ownedId - a.ownedId)[0];
  if (!owned) return null;
  let index = 0;
  for (const slot of catalog.corpsOrder) {
    if (context.party[slot] === 0) continue;
    if (context.party[slot] === owned.ownedId) return index;
    index++;
  }
  return null;
}

function conditionLeader(catalog: FieldPuppetActorCatalog, context: FieldPuppetActorContext): number {
  if (context.conditionController !== "present") throw new Error("Source condition actor controller is absent or unknown");
  const leader = fieldPuppetLeaderId(catalog, context);
  const id = context.party[Math.max(0, context.savedLeaderIndex)]!;
  const owned = context.owned.find((o) => o.ownedId === id)!;
  // The lookup is source-backed, but executing altered-character visuals also
  // needs condition actor/media initialization. Keep that host branch explicit.
  const change = catalog.conditionChanges.find((c) => owned.conditionTypes.includes(c.type));
  if (change) throw new Error("Source leader condition stand-in actor lifecycle is unsupported: " + change.type);
  return leader;
}

/** Source IDs select native instances; the actual FieldController.player is a
 * separate key. A missing positive entity is a known null lookup, not unknown. */
export function resolveFieldPuppetActor(
  catalog: FieldPuppetActorCatalog, context: FieldPuppetActorContext, sourceEntityId: number,
): { entityId: number; actor: string | null } {
  validateContext(catalog, context); integer(sourceEntityId);
  let entityId = sourceEntityId;
  if (entityId === -1010) entityId = conditionLeader(catalog, context);
  if (entityId === 0) return { entityId, actor: context.camera };
  if (entityId === -1020) {
    if (context.companion !== "absent") throw new Error("Source companion puppet binding is unsupported or unknown");
    return { entityId, actor: null };
  }
  if (entityId < -1032) throw new Error("Invalid source entity uses native error-log path");
  if (entityId <= -1030) return { entityId, actor: context.otherParties[-1030 - entityId]! };
  if (entityId < -1000) return { entityId, actor: puppet(catalog, context, -1001 - entityId) };
  if (entityId < 0) {
    const index = fieldPuppetResidentIndex(catalog, context, -entityId);
    if (index !== null) return { entityId, actor: puppet(catalog, context, index) };
    const resident = context.residents.find((r) => r.assetId === -entityId);
    if (!resident) throw new Error("Source resident dictionary lookup is missing");
    return { entityId, actor: resident.actor };
  }
  return { entityId, actor: context.entities.find((e) => e.entityId === entityId)?.actor ?? null };
}

function actor(context: FieldPuppetActorContext, id: string | null): FieldPuppetActor {
  const value = context.actors.find((a) => a.id === id);
  if (!value) throw new Error("Required source puppet actor is absent");
  return value;
}
function layer(effects: FieldPuppetActorEffect[], target: string, from: string): void {
  effects.push({ kind: "copy-layer", actor: target, from },
    { kind: "apply-view-properties", actor: target }, { kind: "attach-transparent", actor: target });
}
function assignmentsValid(values: readonly boolean[]): void {
  if (values.length !== 5 || Array.from(values).some((v) => typeof v !== "boolean"))
    throw new Error("Missing source puppet assignment bits");
}

/** Integrator.Execute / final unhooked Update invoke this at script boundaries.
 * SkipInitialize performs neither init nor restore. Ordinary no-companion input
 * is supported; source restore-party callbacks and status stand-ins stay gated. */
export function projectFieldPuppetInitialization(input: {
  phase: "start" | "finish";
  catalog: FieldPuppetActorCatalog;
  script: FieldPuppetScriptContext;
  context: FieldPuppetActorContext;
}): FieldPuppetActorPlan {
  const { phase, catalog, script, context } = input;
  if (phase !== "start" && phase !== "finish") throw new Error("Unknown source puppet lifecycle phase");
  validateCatalog(catalog); scriptBinding(catalog, script);
  if (script.skipInitialize) return { leaderId: null, assignments: null, effects: [] };
  validateContext(catalog, context);
  if (context.companion !== "absent") throw new Error("Source companion start/finish lifecycle is unsupported or unknown");
  if (context.restorePartyInstruction !== "absent") throw new Error("Source restore-party callback is unsupported or unknown");
  const leaderId = fieldPuppetLeaderId(catalog, context);
  const leader = actor(context, resolveFieldPuppetActor(catalog, context,
    script.keepBadStatusVisual ? -1010 : leaderId).actor);
  const player = actor(context, context.player);
  const effects: FieldPuppetActorEffect[] = [];
  if (context.camera !== null) effects.push({ kind: "init-camera-dummy", actor: context.camera, player: player.id });
  if (phase === "finish") {
    effects.push({ kind: "copy-position", actor: player.id, from: leader.id, mode: "overwrite" });
    layer(effects, player.id, leader.id);
    effects.push({ kind: "look", actor: player.id, from: leader.id }, { kind: "cue", actor: player.id, from: leader.id });
    for (const id of sourcePuppets) {
      const target = resolveFieldPuppetActor(catalog, context, id).actor;
      if (target !== null) effects.push({ kind: "hide", actor: target });
    }
    const special = actor(context, resolveFieldPuppetActor(catalog, context, -1010).actor);
    effects.push({ kind: "hide", actor: special.id }, { kind: "show", actor: player.id });
    return { leaderId, assignments: null, effects };
  }
  for (const id of sourcePuppets) {
    const key = resolveFieldPuppetActor(catalog, context, id).actor;
    if (key === null) continue;
    const target = actor(context, key);
    effects.push({ kind: "copy-position", actor: key, from: player.id, mode: "overwrite" });
    layer(effects, key, player.id);
    effects.push({ kind: "look", actor: key, from: player.id }, { kind: "switch-transparent", actor: key });
    if (target.character) {
      if (player.riding) {
        if (context.transport === "unknown" || context.transport === null)
          throw new Error("Riding source puppet requires current transportation identity");
        effects.push({ kind: "ride-on", actor: key, transportationId: context.transport.id });
      } else effects.push({ kind: "ride-out", actor: key });
    }
    effects.push({ kind: "hide", actor: key });
  }
  const keep = !script.characteristics || script.keepPlayerPuppet;
  if (keep && (script.characteristics || !script.ridingVehicle)) {
    effects.push({ kind: "show", actor: leader.id }, { kind: "apply-view-properties", actor: leader.id },
      { kind: "attach-transparent", actor: leader.id }, { kind: "hide", actor: player.id });
  }
  effects.push({ kind: "cue", actor: leader.id, from: player.id });
  return { leaderId, assignments: fieldPuppetAssignments(), effects };
}

/** SetPuppet's actor-side preparation. Call before the slot/range preflight:
 * skipEntry's Hide optimization bypasses native track allocation entirely.
 * Otherwise publish neither slot nor effects until both preparations succeed. */
export function projectFieldPuppetActorEntry(input: {
  catalog: FieldPuppetActorCatalog;
  script: FieldPuppetScriptContext;
  context: FieldPuppetActorContext;
  entityId: number;
  nextMnemonic: string;
  leaderId: number | null;
  assignments: readonly boolean[];
}): FieldPuppetActorPlan & { entityId: number; skipEntry: boolean; actor: string | null } {
  const { catalog, script, context } = input;
  validateContext(catalog, context); scriptBinding(catalog, script); assignmentsValid(input.assignments);
  let entityId = integer(input.entityId), assignments = [...input.assignments];
  if (typeof input.nextMnemonic !== "string" || !input.nextMnemonic) throw new Error("Missing source puppet next mnemonic");
  if (input.leaderId !== null && (integer(input.leaderId) < -1004 || input.leaderId > -1001))
    throw new Error("Invalid saved Integrator leader entity");
  const effects: FieldPuppetActorEffect[] = [];
  if (script.characteristics && !script.keepPlayerPuppet && entityId === -1001 && input.nextMnemonic === "Hide") {
    effects.push({ kind: "hide", actor: context.player });
    return { entityId, actor: null, skipEntry: true, leaderId: null, assignments, effects };
  }
  const original = resolveFieldPuppetActor(catalog, context, entityId);
  if (entityId === -1010) {
    entityId = original.entityId;
    if (entityId !== -1001) {
      const target = actor(context, original.actor);
      effects.push({ kind: "copy-position", actor: target.id, from: context.player, mode: "local" });
      layer(effects, target.id, context.player);
      effects.push({ kind: "hide", actor: target.id });
    }
  }
  if (entityId >= -1000 && entityId < 0) {
    const resident = fieldPuppetResidentIndex(catalog, context, -entityId);
    if (resident === null) {
      const target = actor(context, original.actor);
      effects.push({ kind: "copy-position", actor: target.id, from: context.player, mode: "player-z" });
      layer(effects, target.id, context.player);
    } else {
      assignments = projectFieldPuppetAssignment(assignments, resident, true, catalog.memberCount).assignments;
      if (input.leaderId === null) throw new Error("Unknown Integrator leader for resident puppet");
      if (-1001 - resident === input.leaderId) effects.push({ kind: "hide", actor: context.player });
    }
  } else if (entityId === -1001) {
    if (script.keepBadStatusVisual) entityId = -1010;
    else {
      if (input.leaderId === null) throw new Error("Unknown Integrator leader for player puppet");
      entityId = input.leaderId;
    }
    effects.push({ kind: "hide", actor: context.player });
  } else if (entityId >= -1005 && entityId <= -1002) {
    if (input.leaderId === null) throw new Error("Unknown Integrator leader for party puppet");
    if (entityId === input.leaderId) entityId = -1001;
    const assignment = projectFieldPuppetAssignment(assignments, entityId, false, catalog.memberCount);
    entityId = assignment.id; assignments = assignment.assignments;
  }
  return { entityId, actor: resolveFieldPuppetActor(catalog, context, entityId).actor,
    skipEntry: false, leaderId: null, assignments, effects };
}
