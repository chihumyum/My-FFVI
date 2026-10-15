import type { FieldContent, Op, Site } from "../field/types.js";

export const fieldProviders = Object.freeze([
  "inventory", "messageNames", "recovery", "ownedConditions", "party", "roster", "treasure", "transportation", "puppetRoster",
  "partyActors", "audioReadiness", "soundPresentation", "actorControl", "actorMotion", "cameraMotion", "effectMotion",
  "sourceMessageSequence", "eventSaveCompletion", "battleHandoff", "sourceEncounter", "assignedNpcRoutes", "sourceLeader", "scriptShop", "storyTimer", "screenEffects", "cameraShake", "sourceAutoSaveSync",
] as const);
export type FieldProvider = typeof fieldProviders[number];
export type FieldProviderStatus = "available" | "missing" | "unknown";
export type FieldCapability = FieldProvider | "conditionVisual" | "scriptMotion";
export type FieldRequirement = {
  capability: FieldCapability;
  site: Site;
  code: string;
  reason: string;
  when: "always" | "refresh" | "active-voice" | "deferred";
};
export type FieldAdmissionContext = {
  providers: Partial<Record<FieldProvider, FieldProviderStatus>>;
  actorKind: "actor" | "camera" | "effect" | "none" | "unknown";
  refreshRequired?: boolean;
  keepBadStatusVisual?: boolean;
  /** A real native joint Refresh/Affect host; does not itself grant an actor
   * activity/condition-resident/media provider. Missing retains old gates. */
  conditionLeaderAvailable?: boolean;
  soundVoiceActive?: boolean;
};
export type FieldAdmissionDiagnostic = Pick<FieldRequirement, "capability" | "site" | "code" | "reason"> & {
  status: "blocked" | "conditional";
};
export type FieldAdmissionAssessment = {
  status: "ready" | "blocked" | "conditional";
  diagnostics: FieldAdmissionDiagnostic[];
};
export type FieldContentRequirements = {
  kind: "field-content-requirements-v1";
  contentHash: string;
  /** Includes instructions with zero external requirements. These records do
   * not assert execution, reachability or support for the instruction itself. */
  instructions: { site: Site; requirements: FieldRequirement[] }[];
};

const codes: Record<FieldCapability, string> = {
  inventory: "FIELD_INVENTORY_PROVIDER", recovery: "FIELD_RECOVERY_PROVIDER",
  messageNames: "FIELD_MESSAGE_NAMES_PROVIDER", sourceMessageSequence: "FIELD_SOURCE_MESSAGE_SEQUENCE_PROVIDER",
  ownedConditions: "FIELD_OWNED_CONDITIONS_PROVIDER", party: "FIELD_PARTY_PROVIDER",
  roster: "FIELD_ROSTER_PROVIDER", treasure: "FIELD_TREASURE_PROVIDER",
  transportation: "FIELD_TRANSPORTATION_PROVIDER", puppetRoster: "FIELD_PUPPET_ROSTER_PROVIDER",
  partyActors: "FIELD_PARTY_ACTORS_PROVIDER", audioReadiness: "FIELD_AUDIO_READINESS_PROVIDER",
  soundPresentation: "FIELD_SOUND_PRESENTATION_PROVIDER", actorControl: "FIELD_ACTOR_CONTROL_PROVIDER", actorMotion: "FIELD_ACTOR_MOTION_PROVIDER",
  cameraMotion: "FIELD_CAMERA_MOTION_PROVIDER", effectMotion: "FIELD_EFFECT_MOTION_PROVIDER",
  eventSaveCompletion: "FIELD_EVENT_SAVE_COMPLETION", battleHandoff: "FIELD_BATTLE_HANDOFF",
  sourceLeader: "FIELD_SOURCE_LEADER_PROVIDER", scriptShop: "FIELD_SCRIPT_SHOP_PROVIDER",
  storyTimer: "FIELD_STORY_TIMER_PROVIDER", screenEffects: "FIELD_SCREEN_EFFECTS_PROVIDER",
  cameraShake: "FIELD_CAMERA_SHAKE_PROVIDER",
  sourceAutoSaveSync: "FIELD_SOURCE_AUTO_SAVE_SYNC_PROVIDER",
  sourceEncounter: "FIELD_SOURCE_ENCOUNTER_PROVIDER",
  assignedNpcRoutes: "FIELD_ASSIGNED_NPC_ROUTE_PROVIDER",
  conditionVisual: "FIELD_CONDITION_VISUAL_CONTEXT", scriptMotion: "FIELD_SCRIPT_MOTION_PROVIDER",
};

function record(value: unknown): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    throw new Error("Invalid field admission data record");
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== "string" || !descriptor.enumerable || !Object.hasOwn(descriptor, "value"))
      throw new Error("Field admission requires plain data fields");
  }
}
function keys(value: unknown, required: readonly string[], optional: readonly string[] = []): asserts value is Record<string, unknown> {
  record(value);
  if (required.some(key => !Object.hasOwn(value, key)) ||
      Object.keys(value).some(key => !required.includes(key) && !optional.includes(key)))
    throw new Error("Invalid field admission fields");
}
function text(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.length || value.trim() !== value)
    throw new Error("Invalid field admission text");
}
function dense(value: unknown): asserts value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      Reflect.ownKeys(value).length !== value.length + 1)
    throw new Error("Invalid or sparse field admission array");
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value"))
      throw new Error("Field admission requires plain array values");
  }
}
function json(value: unknown, stack = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object" || stack.has(value)) throw new Error("Invalid field admission provenance data");
  stack.add(value);
  if (Array.isArray(value)) { dense(value); for (const item of value) json(item, stack); }
  else { record(value); for (const item of Object.values(value)) json(item, stack); }
  stack.delete(value);
}
function validateSite(value: unknown): asserts value is Site {
  keys(value, ["script", "index", "source"]);
  text(value.script);
  if (typeof value.index !== "number" || !Number.isInteger(value.index) || value.index < 0 || value.index > 0x7fffffff)
    throw new Error("Invalid field admission instruction index");
  record(value.source);
  text(value.source.file); text(value.source.assetPath);
  if (Object.hasOwn(value.source, "objectId") &&
      (typeof value.source.objectId !== "string" || !/^-?\d+$/.test(value.source.objectId)))
    throw new Error("Field admission source object identity must be a decimal string");
  // Preserve additional JSON provenance (hash/serialized file/etc.) exactly;
  // this helper does not relabel or authenticate its source build.
  json(value.source);
}
function siteOf(op: Op): Site {
  record(op); text(op.kind);
  const site = { script: op.script, index: op.index, source: op.source };
  validateSite(site);
  return structuredClone(site);
}
function commandOf(op: Op): Record<string, unknown> {
  if (!("command" in op)) throw new Error("Missing field admission command");
  const command: unknown = op.command;
  record(command); text(command.kind);
  return command;
}
function booleanField(value: Record<string, unknown>, key: string): boolean {
  if (typeof value[key] !== "boolean") throw new Error("Invalid field admission command flag: " + key);
  return value[key];
}

/** Describes only dependencies of typed instructions, never their semantics.
 * Do not use an empty list to admit a blocked/unknown opcode or latent script. */
export function fieldInstructionRequirements(op: Op): FieldRequirement[] {
  const site = siteOf(op), requirements: FieldRequirement[] = [];
  const add = (capability: FieldCapability, reason: string, when: FieldRequirement["when"] = "always") => {
    requirements.push({ capability, site: structuredClone(site), code: codes[capability], reason, when });
  };
  const refresh = (conditionVisual: boolean) => {
    add("partyActors", "Party actor refresh is unavailable", "refresh");
    if (conditionVisual) add("conditionVisual", "Unknown or unsupported owned condition-visual context", "refresh");
  };
  switch (op.kind) {
    case "actor-visibility": add("actorControl", "Source actor visibility requires its bound control owner"); break;
    case "position":
      if (op.nativeCommand?.mode === 1)
        add("actorControl", "Source relative SetPos requires its bound actor and exact selector owner");
      break;
    case "source-message":
      if (op.command.kind === "sequence" || op.command.kind === "finish-wait")
        add("sourceMessageSequence", "Source message sequence profile/timing owner is unavailable");
      if (op.command.kind === "sequence" && op.command.template !== undefined)
        add("messageNames", "Source message character name owner is unavailable");
      break;
    case "message":
      if (op.template !== undefined) add("messageNames", "Source message character name owner is unavailable");
      break;
    case "inventory": add("inventory", "Field inventory state is unavailable"); break;
    case "field-recovery": {
      add("recovery", "Field recovery owned state is unavailable");
      const command = commandOf(op);
      if (command.kind !== "recover-hp" && command.kind !== "recover-mp") throw new Error("Invalid field recovery requirement command");
      if (command.kind === "recover-hp" && booleanField(command, "allowUnableFight")) refresh(true);
      break;
    }
    case "owned-condition": add("ownedConditions", "Field owned condition state is unavailable"); refresh(true); break;
    case "party":
      add("party", "Field party state is unavailable");
      if (booleanField(commandOf(op), "refreshActors")) refresh(false);
      break;
    case "roster": {
      add("roster", "Field roster state is unavailable");
      const command = commandOf(op);
      const recovery = command.kind === "join" && booleanField(command, "recovery");
      if (recovery)
        add("conditionVisual", "Roster recovery condition-visual context is unavailable");
      if (booleanField(command, "refreshActors") || recovery) refresh(false);
      break;
    }
    case "treasure-box": add("treasure", "Field treasure state is unavailable"); break;
    case "field-transportation":
      add("transportation", "Transportation requires the shared owned, native actor and camera providers");
      add("partyActors", "Transportation requires the shared owned, native actor and camera providers");
      break;
    case "branch-character": add("puppetRoster", "Missing event context branch roster provider"); break;
    case "branch-leader":
      add("puppetRoster", "Missing source leader Corps/owned provider");
      add("sourceLeader", "Missing current source map leader index provider");
      break;
    case "field-script-shop": add("scriptShop", "Missing shared script shop lifecycle provider"); break;
    case "field-timer": {
      const command = commandOf(op);
      if (!["set", "finish", "pause", "resume", "change-script-if-expired"].includes(command.kind as string))
        throw new Error("Invalid field timer requirement command");
      add("storyTimer", "Source timer requires the declared Web story-runtime clock and callback owner");
      break;
    }
    case "field-color-fade": case "field-flash":
      add("screenEffects", "Source screen effect requires its declared Web policy and known field screen host");
      break;
    case "field-shake":
      add("cameraShake", "Source camera shake requires the explicit Web presentation stream and actual normal field camera host");
      break;
    case "field-party-query": add("puppetRoster", "Missing field party query roster provider"); break;
    case "field-sound": {
      const command = commandOf(op);
      if (command.kind === "play" || command.kind === "ready") add("audioReadiness", "Missing SE resource readiness provider");
      if (command.kind === "play") add("soundPresentation", "Missing SE presentation provider");
      // Sync/stop use the SE owner and local handle. Neither dispatch reads a
      // readiness/presentation port. Its wait is not an external completion ACK.
      break;
    }
    case "bgm-ready": add("audioReadiness", "Missing BGM resource readiness provider"); break;
    case "field-script-motion": {
      const command = commandOf(op);
      if (command.kind !== "move" && command.kind !== "move-to" && command.kind !== "lerp") throw new Error("Invalid field script motion requirement command");
      add("scriptMotion", command.kind === "move-to" ? "Source MoveTo requires an ordinary bound native actor"
        : command.kind === "move" ? "Source Move requires an ordinary bound native actor"
        : "Source actor Lerp requires the bound native actor and map providers");
      break;
    }
    case "field-camera": add("cameraMotion", "Source field camera host is unavailable"); break;
    case "field-camera-motion": add("cameraMotion", "Source motion is only admitted for camera dummy 0"); break;
    case "event-save":
      add("eventSaveCompletion", "Event-save completion requires the external save coordinator", "deferred");
      if (Object.hasOwn(op, "sourceAutoSave")) add("sourceAutoSaveSync",
        "Native AutoSave leader/player/camera synchronization is unassessed; the explicit Web barrier saves existing owners", "deferred");
      break;
    case "assign-npc-route": add("assignedNpcRoutes", "Assigned NPC route requires an explicit source-bound Web controller"); break;
    case "source-encounter":
      add("sourceEncounter", "Source encounter requires an explicit selection, native player synchronization and captured FootInfo host");
      add("battleHandoff", "Battle preparation/return host is unavailable", "deferred");
      break;
    case "encounter": add("battleHandoff", "Battle handoff completion belongs to the GameSession owner", "deferred"); break;
  }
  return requirements;
}

/** Collect every site without following control flow, creating game owners or
 * requiring latent branches to be ready at the current entry. */
export function deriveFieldContentRequirements(content: Pick<FieldContent, "contentHash" | "scripts">): FieldContentRequirements {
  keys(content, ["contentHash", "scripts"]); text(content.contentHash); record(content.scripts);
  const instructions: FieldContentRequirements["instructions"] = [];
  for (const [name, ops] of Object.entries(content.scripts)) {
    text(name); dense(ops);
    for (const op of ops) {
      const requirements = fieldInstructionRequirements(op as Op);
      instructions.push({ site: siteOf(op as Op), requirements });
    }
  }
  return { kind: "field-content-requirements-v1", contentHash: content.contentHash, instructions };
}

function validateContext(context: FieldAdmissionContext): void {
  keys(context, ["providers", "actorKind"], ["refreshRequired", "keepBadStatusVisual", "conditionLeaderAvailable", "soundVoiceActive"]);
  record(context.providers);
  for (const [provider, status] of Object.entries(context.providers))
    if (!(fieldProviders as readonly string[]).includes(provider) || !["available", "missing", "unknown"].includes(status))
      throw new Error("Invalid field admission provider state");
  if (!["actor", "camera", "effect", "none", "unknown"].includes(context.actorKind))
    throw new Error("Invalid field admission actor kind");
  for (const key of ["refreshRequired", "keepBadStatusVisual", "conditionLeaderAvailable", "soundVoiceActive"] as const)
    if (Object.hasOwn(context, key) && typeof context[key] !== "boolean")
      throw new Error("Invalid field admission context flag: " + key);
}
function validateRequirement(requirement: FieldRequirement): void {
  keys(requirement, ["capability", "site", "code", "reason", "when"]);
  if (!Object.hasOwn(codes, requirement.capability) || codes[requirement.capability] !== requirement.code ||
      !["always", "refresh", "active-voice", "deferred"].includes(requirement.when))
    throw new Error("Invalid field admission requirement identity");
  text(requirement.reason); validateSite(requirement.site);
}

/** Evaluate provider facts only. Missing context is conditional, never a
 * fabricated false world state or a semantic/playthrough acceptance verdict.
 * The caller chooses the actual instruction/entry; do not blanket-gate all
 * collected scripts. Existing owner guards still validate parameters/effects. */
export function assessFieldRequirements(requirements: readonly FieldRequirement[], context: FieldAdmissionContext): FieldAdmissionAssessment {
  dense(requirements); validateContext(context);
  for (const requirement of requirements) validateRequirement(requirement);
  const diagnostics: FieldAdmissionDiagnostic[] = [];
  for (const requirement of requirements) {
    const { capability, code, site, when } = requirement;
    let reason = requirement.reason, status: FieldProviderStatus;
    const applies = when === "refresh" ? context.refreshRequired : when === "active-voice" ? context.soundVoiceActive : true;
    if (applies === false) continue;
    if (when === "deferred" || applies === undefined) status = "unknown";
    else if (capability === "conditionVisual")
      status = context.keepBadStatusVisual === undefined ? "unknown" : context.keepBadStatusVisual
        ? context.conditionLeaderAvailable === true ? "available" : "missing" : "available";
    else if (capability === "scriptMotion") {
      if (context.actorKind === "unknown") status = "unknown";
      else if (context.actorKind === "none") { status = "missing"; reason = "Source script motion requires a bound actor"; }
      else {
        const provider = context.actorKind === "camera" ? "cameraMotion" : context.actorKind === "effect" ? "effectMotion" : "actorMotion";
        status = context.providers[provider] ?? "unknown";
        if (context.actorKind === "camera") reason = "Camera source Move, animation or layer transition requires a separate provider";
        else if (context.actorKind === "effect") reason = "Source script motion requires a bound actor";
      }
    } else status = context.providers[capability] ?? "unknown";
    if (status !== "available") diagnostics.push({ capability, code, site: structuredClone(site), reason,
      status: status === "missing" ? "blocked" : "conditional" });
  }
  return { status: diagnostics.some(diagnostic => diagnostic.status === "blocked") ? "blocked"
    : diagnostics.length ? "conditional" : "ready", diagnostics };
}
