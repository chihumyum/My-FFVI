import type { PartyPosition, PartyRow } from "./party.js";

/** The candidate owned state supplies these identities, never the old live roster. */
export type PartyActorMember = {
  id: string;
  index: PartyPosition;
  row: PartyRow;
  sourceId: number;
  jobId: number;
  enabled: boolean;
  conditionIds: number[];
};
export type PartyActorAsset = {
  id: number;
  characterId: number;
  asset: string;
  shadowType: number;
  shadowName: string;
};
export type PartyActorCatalog = {
  formatVersion: 1;
  memberCount: 4;
  partyCount: 3;
  assets: Record<string, PartyActorAsset>;
  characterAssets: {
    id: number;
    sourceId: number;
    jobId: number;
    fieldAssetId: number;
  }[];
  conditionTypes: Record<string, number>;
  conditionChanges: { type: number; residentCharacterId: number }[];
  residents: { characterId: number; fieldAssetId: number }[];
  viewpointOffsets: { fieldAssetId: number; x: number; y: number }[];
  transportations: { id: number; typeId: number; fieldAssetId: number }[];
  affectedCompanions: { fieldAssetId: number; affected: boolean }[] | null;
  flatBirdAssets: Record<string, number>;
  /** Source inputs for the explicitly bounded development checkpoint only. */
  checkpointInputs: {
    initialMapId: number;
    initialPointIn: number;
    initialScriptId: number;
    initialMapSourceId: number;
    initialPointSourceId: number;
    mapLoopTypes: Record<string, number>;
    corpsOrder: number[];
  } | null;
};
export type PartyActorInstance = {
  id: string;
  /** null means this existing native actor has no AssetStructure. */
  fieldAssetId: number | null;
  /** FieldCharaEntity.ridingAssetStructure; RideOut does not clear this cache. */
  riderFieldAssetId: number | null;
  riding: boolean;
};
export type PartyActorCompanion = {
  fieldAssetId: number;
  conditionTypes: number[];
  actor: PartyActorInstance | null;
  puppet: PartyActorInstance | null;
};
/** Every property is mandatory. Missing runtime context is not an empty list. */
export type PartyActorContext = {
  leaderIndex: number;
  player: PartyActorInstance;
  /** Source residentPartyEntityList order, including null/missing instances. */
  puppets: (PartyActorInstance | null)[];
  currentTransport: { id: number; typeId: number; fieldAssetId: number } | null;
  /** null means the controller is actually absent; [] means initialized empty. */
  conditionResidents: { characterId: number; fieldAssetId: number | null }[] | null;
  /** SaveMapManager owns this record, separately from companion sprite instances. */
  companion: PartyActorCompanion | null;
  /** Source partyEntityList and saved per-party leader positions, including hidden actors. */
  multiParty: {
    leaderIndex: number;
    members: PartyActorMember[];
    actor: PartyActorInstance | null;
  }[];
  conditionColliders: { id: string; collisionType: number; throughConditionType: number }[] | null;
  camera: {
    mapViewType: number;
    /** Native Rect uses xMin and the top Y origin; height extends towards negative Y. */
    mapArea: { xMin: number; yMin: number; width: number; height: number };
  };
};
export type PartyActorPlan = {
  selectedLeaderIndex: number;
  /** GetPickupCharacterCorpsId leaves a previously negative saved position unchanged. */
  savedLeaderIndex: number;
  changes: {
    actorId: string;
    asset: PartyActorAsset;
    mode: "replace" | "rider";
    reason: "leader" | "puppet" | "dummy" | "condition" | "companion" | "other-party";
  }[];
  /** null means no SetPlayerAsset call, not clearing the cache. */
  playerAssetCache: PartyActorAsset | null;
  cameraOffset: { x: number; y: number } | null;
  colliderChanges: { actorId: string; active: boolean }[];
  /** null means there is no companion save record. */
  companionConditionTypes: number[] | null;
};

const f = Math.fround;
function integer(value: number, what: string, minimum = 0): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > 0x7fffffff)
    throw new Error(`Invalid party appearance ${what}`);
}
function fieldAsset(catalog: PartyActorCatalog, id: number): PartyActorAsset {
  integer(id, "field asset", 1);
  const asset = catalog.assets[id];
  if (!asset || asset.id !== id || !asset.asset)
    throw new Error(`Missing party appearance field asset ${id}`);
  return structuredClone(asset);
}
function membersByPosition(members: readonly PartyActorMember[]) {
  if (!Array.isArray(members)) throw new Error("Missing party appearance members");
  const positions = new Map<number, PartyActorMember>();
  const identities = new Set<string>();
  for (const member of members) {
    if (!member || !member.id || identities.has(member.id))
      throw new Error("Invalid party appearance owned identity");
    integer(member.index, "position");
    integer(member.sourceId, "source identity", 1);
    integer(member.jobId, "job identity", 1);
    if (member.index > 3 || positions.has(member.index) ||
        !["front", "back"].includes(member.row) ||
        typeof member.enabled !== "boolean" || !Array.isArray(member.conditionIds))
      throw new Error("Invalid party appearance member");
    const conditions = new Set<number>();
    for (const id of member.conditionIds) {
      integer(id, "condition identity", 1);
      if (conditions.has(id)) throw new Error("Repeated party appearance condition identity");
      conditions.add(id);
    }
    positions.set(member.index, member);
    identities.add(member.id);
  }
  return positions;
}
function sourceConditionTypes(catalog: PartyActorCatalog, member: PartyActorMember) {
  return member.conditionIds.map((id) => {
    const type = catalog.conditionTypes[id];
    if (!Number.isSafeInteger(type)) throw new Error(`Unknown party appearance condition ${id}`);
    return type!;
  });
}

/** GetPartyAssetMaster: first matching row in the source master dictionary's insertion order. */
export function partyMemberFieldAsset(catalog: PartyActorCatalog, member: Pick<PartyActorMember, "sourceId" | "jobId">) {
  const row = catalog.characterAssets.find((row) =>
    row.sourceId === member.sourceId && row.jobId === member.jobId);
  if (!row) throw new Error(`Missing party appearance character/job ${member.sourceId}/${member.jobId}`);
  return fieldAsset(catalog, row.fieldAssetId);
}

/** GetMapArea uses MapAssetData.mapRange dimensions * 16, ignoring its x/y origin. */
export function partyActorMapArea(width: number, height: number, loopType: number) {
  integer(width, "map width", 1);
  integer(height, "map height", 1);
  integer(loopType, "map loop type");
  if (width > 0x7ffffff || height > 0x7ffffff || loopType > 3)
    throw new Error("Unsupported party appearance map geometry");
  const w = width * 16, h = height * 16;
  const x = loopType === 1 || loopType === 3, y = loopType === 2 || loopType === 3;
  return { xMin: x ? f(-w / 2) : 0, yMin: y ? f(h / 2) : 0,
    width: x ? f(w) : 0, height: y ? f(h) : 0 };
}

/** Source correction wraps at most once; it is neither a clamp nor modulo. */
export function partyActorCameraOffset(catalog: PartyActorCatalog, assetId: number,
  camera: PartyActorContext["camera"]): { x: number; y: number } {
  validateCamera(camera);
  const area = camera.mapArea;
  const transport = catalog.transportations.find((t) => t.fieldAssetId === assetId);
  // FF6 ContainsBird checks the transportation identity (not its type or actor).
  if (transport?.id === 3 && camera.mapViewType === 2) {
    const replacement = catalog.flatBirdAssets[transport.id];
    if (replacement !== undefined) assetId = replacement;
  }
  const value = catalog.viewpointOffsets.find((v) => v.fieldAssetId === assetId);
  let x = f(value?.x ?? 0), y = f(value?.y ?? 0);
  const xMin = f(area.xMin), yMin = f(area.yMin), w = f(area.width), h = f(area.height);
  if (w > 0 && (x < xMin || x >= f(xMin + w))) x = f(x - f((x >= 0 ? 1 : -1) * w));
  if (h > 0 && (y < f(yMin - h) || y >= yMin)) y = f(y - f((y >= 0 ? 1 : -1) * h));
  return { x, y };
}

function validateCamera(camera: PartyActorContext["camera"]): void {
  if (!camera || !camera.mapArea) throw new Error("Missing party appearance camera context");
  integer(camera.mapViewType, "map view type");
  for (const value of Object.values(camera.mapArea))
    if (!Number.isFinite(value) || !Number.isFinite(f(value)))
      throw new Error("Invalid party appearance map area");
  for (const key of ["xMin", "yMin", "width", "height"] as const)
    if (!Number.isFinite(camera.mapArea[key])) throw new Error("Incomplete party appearance map area");
}

/** SaveMapManager.InitializeSaveData + SaveMapData constructor, not JSON omission. */
export function initialPartyActorSaveState() {
  return { leaderIndex: -1, companion: null,
    partyLeaderIndices: [0, 0, 0], otherPartyPlacements: [null, null, null] };
}

/** FF6 Action.OnChangeMap initializes the negative saved leader exactly once. */
export function partyActorLeaderOnMapChange(savedLeader: number, members: readonly PartyActorMember[]): number {
  integer(savedLeader, "saved leader", -1);
  if (savedLeader > 3) throw new Error("Invalid saved party appearance leader");
  const byPosition = membersByPosition(members);
  return savedLeader === -1 ? [...byPosition.keys()].sort((a, b) => a - b)[0] ?? -1 : savedLeader;
}

/** SetPartyCharacterAsset initializes every field character resident, keyed by character_id. */
export function initialPartyActorResidents(catalog: PartyActorCatalog) {
  return structuredClone(catalog.residents);
}

/**
 * Pure ChangeAssetPartyCharacter preparation. Source order is retained, including
 * the second player assignment for a condition appearance. It creates no actor,
 * loads no media and publishes no owned or field state.
 */
export function preparePartyActors(catalog: PartyActorCatalog, members: readonly PartyActorMember[],
  context: PartyActorContext, setDummy: boolean): PartyActorPlan {
  if (!catalog || catalog.formatVersion !== 1 || catalog.memberCount !== 4 || catalog.partyCount !== 3)
    throw new Error("Unsupported party appearance catalog");
  if (!context || typeof setDummy !== "boolean") throw new Error("Missing party appearance context");
  integer(context.leaderIndex, "saved leader", -1);
  if (context.leaderIndex > 3 || !Array.isArray(context.puppets) ||
      !Array.isArray(context.multiParty) || context.multiParty.length !== catalog.partyCount ||
      (context.conditionResidents !== null && !Array.isArray(context.conditionResidents)) ||
      (context.conditionColliders !== null && !Array.isArray(context.conditionColliders)) ||
      context.currentTransport === undefined || context.companion === undefined || !context.camera)
    throw new Error("Incomplete party appearance context");
  validateCamera(context.camera);
  const actorIds = new Set<string>();
  const validateActor = (actor: PartyActorInstance) => {
    if (!actor || typeof actor.id !== "string" || !actor.id || actorIds.has(actor.id) ||
        typeof actor.riding !== "boolean") throw new Error("Invalid or repeated party appearance actor");
    if (actor.fieldAssetId !== null) fieldAsset(catalog, actor.fieldAssetId);
    if (actor.riderFieldAssetId !== null) fieldAsset(catalog, actor.riderFieldAssetId);
    actorIds.add(actor.id);
  };
  validateActor(context.player);
  for (const actor of context.puppets) if (actor !== null) validateActor(actor);
  for (const party of context.multiParty) {
    if (!party) throw new Error("Missing saved party appearance context");
    integer(party.leaderIndex, "saved party leader");
    if (party.leaderIndex > 3) throw new Error("Invalid saved party leader");
    membersByPosition(party.members);
    if (party.actor !== null) validateActor(party.actor);
  }
  if (context.companion !== null) {
    integer(context.companion.fieldAssetId, "companion field asset", 1);
    if (!Array.isArray(context.companion.conditionTypes)) throw new Error("Missing companion condition list");
    for (const type of context.companion.conditionTypes) integer(type, "companion condition type");
    if (context.companion.actor !== null) validateActor(context.companion.actor);
    if (context.companion.puppet !== null) validateActor(context.companion.puppet);
  }
  if (context.currentTransport !== null) {
    const row = catalog.transportations.find((r) => r.id === context.currentTransport!.id);
    if (!row || row.typeId !== context.currentTransport.typeId || row.fieldAssetId !== context.currentTransport.fieldAssetId)
      throw new Error("Unknown or mismatched party appearance transportation");
  }
  const byPosition = membersByPosition(members);
  // Validate every supplied condition reference before forming any publication.
  const typesById = new Map(members.map((m) => [m.id, sourceConditionTypes(catalog, m)]));
  const index = byPosition.has(context.leaderIndex) ? context.leaderIndex :
    [...byPosition.keys()].sort((a, b) => a - b)[0] ?? -1;
  const leader = byPosition.get(index);
  const plan: PartyActorPlan = {
    selectedLeaderIndex: index,
    savedLeaderIndex: context.leaderIndex >= 0 ? index : context.leaderIndex,
    changes: [], playerAssetCache: null, cameraOffset: null, colliderChanges: [],
    companionConditionTypes: context.companion ? [...context.companion.conditionTypes] : null,
  };
  const change = (actor: PartyActorInstance, asset: PartyActorAsset,
    reason: PartyActorPlan["changes"][number]["reason"], mode: "replace" | "rider" = actor.riding ? "rider" : "replace") => {
    plan.changes.push({ actorId: actor.id, asset: structuredClone(asset), mode, reason });
  };
  const isPlayer = context.currentTransport?.typeId === 1;
  if (leader) {
    const asset = partyMemberFieldAsset(catalog, leader);
    plan.playerAssetCache = asset;
    if (isPlayer) {
      // Source checks IsPlayer before IsRiging in the ordinary player branch.
      change(context.player, asset, "leader", "replace");
      plan.cameraOffset = partyActorCameraOffset(catalog, asset.id, context.camera);
    } else if (context.player.riding) change(context.player, asset, "leader", "rider");
    else if (context.currentTransport !== null)
      plan.cameraOffset = partyActorCameraOffset(catalog, context.currentTransport.fieldAssetId, context.camera);
  }
  // The source requests dummy field asset 1 even when no puppet needs replacement.
  const dummy = fieldAsset(catalog, 1);
  for (let position = 0; position < Math.max(catalog.memberCount, context.puppets.length); position++) {
    const actor = context.puppets[position];
    const member = byPosition.get(position);
    // GetPartyAssetMaster is called for occupied positions even without a puppet.
    const asset = member ? partyMemberFieldAsset(catalog, member) : dummy;
    if (!actor) continue;
    if (!member && position < catalog.memberCount && actor.fieldAssetId !== null && !setDummy) continue;
    change(actor, asset, member ? "puppet" : "dummy");
  }
  const residentIds = new Set<number>();
  if (context.conditionResidents !== null) for (const resident of context.conditionResidents) {
    integer(resident.characterId, "resident character", 1);
    if (residentIds.has(resident.characterId)) throw new Error("Repeated condition resident");
    if (resident.fieldAssetId !== null) fieldAsset(catalog, resident.fieldAssetId);
    residentIds.add(resident.characterId);
  }
  const conditionRegistry = new Map<number, { characterId: number; fieldAssetId: number | null }>();
  if (context.conditionResidents !== null) for (const rule of catalog.conditionChanges) {
    const resident = context.conditionResidents.find((r) => r.characterId === rule.residentCharacterId);
    if (resident) conditionRegistry.set(rule.type, resident);
  }
  const conditionAsset = (types: readonly number[]): { matched: boolean; asset: PartyActorAsset | null } => {
    // SetConditionData registers only residents actually present; dictionary insertion
    // follows the source Misc list. Search returns its first matching condition type.
    for (const [type, resident] of conditionRegistry) {
      if (types.includes(type))
        return { matched: true, asset: resident.fieldAssetId === null ? null : fieldAsset(catalog, resident.fieldAssetId) };
    }
    return { matched: false, asset: null };
  };
  if (leader) {
    const appearance = conditionAsset(typesById.get(leader.id)!);
    // Owner overload returns null on no match or on a resident without an asset.
    if (appearance.asset) {
      plan.playerAssetCache = appearance.asset;
      if (context.currentTransport === null || isPlayer) change(context.player, appearance.asset, "condition");
    }
  }
  const companion = context.companion;
  const affected = companion === null ? false :
    catalog.affectedCompanions?.find((r) => r.fieldAssetId === companion.fieldAssetId)?.affected ?? true;
  if (companion !== null && catalog.assets[companion.fieldAssetId]) {
    if (affected) {
      // Source hysteresis: add when every member has the type, remove only when
      // none has it; a mixed party preserves the saved value. Only 401/402 sync.
      for (const type of [401, 402]) {
        const count = [...typesById.values()].flat().filter((t) => t === type).length;
        const list = plan.companionConditionTypes!;
        if (list.includes(type)) {
          if (count === 0) list.splice(list.indexOf(type), 1);
        } else if (count === members.length) list.push(type);
      }
    }
    const appearance = conditionAsset(plan.companionConditionTypes!);
    if (appearance.matched && !appearance.asset)
      throw new Error("Companion condition selected a null asset structure");
    const asset = appearance.matched ? appearance.asset! : fieldAsset(catalog, companion.fieldAssetId);
    // Companion sprites use Clear/Set directly, independent of their riding flag.
    for (const actor of [companion.actor, companion.puppet]) if (actor) change(actor, asset, "companion", "replace");
  }
  if (context.conditionColliders !== null) for (const collider of context.conditionColliders) {
    if (!collider.id) throw new Error("Invalid condition collider identity");
    integer(collider.collisionType, "collision type");
    integer(collider.throughConditionType, "through condition type");
    if (collider.collisionType === 0 || collider.throughConditionType === 0) continue;
    let active = !leader || !typesById.get(leader.id)!.includes(collider.throughConditionType);
    if (companion && affected && !plan.companionConditionTypes!.includes(collider.throughConditionType)) active = true;
    plan.colliderChanges.push({ actorId: collider.id, active });
  }
  for (const party of context.multiParty) {
    const member = party.members.find((m) => m.index === party.leaderIndex && m.enabled);
    if (!member) continue;
    // ChangePartyEntityAsset selects by source character, ignoring JobId.
    const asset = Object.values(catalog.assets).find((a) => a.characterId === member.sourceId);
    if (!asset) continue;
    if (!party.actor) throw new Error("Missing existing multi-party actor");
    change(party.actor, asset, "other-party", "replace");
  }
  return plan;
}
