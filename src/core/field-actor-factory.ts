import { ActorAnimation } from "./actor-animation.js";
import { canonical } from "./canonical.js";
import { checkpointInteger } from "./checkpoint-validation.js";
import type { Character, Direction } from "../field/types.js";
import type { FieldPartyActorCheckpoint } from "./field-party-actors.js";
import type { FieldPuppetActorCatalog, FieldPuppetActorContext, FieldPuppetOwned } from "./field-puppet-actors.js";
import type { FieldPuppetHostActor, FieldPuppetHostProviders, FieldPuppetHostSnapshot } from "./field-puppet-effects.js";
import { fieldPuppetBoundTransparentTextures } from "./field-puppet-effects.js";
import { validateFieldActorViewProjection } from "./field-actor-view.js";
import type { MapPartyEntryDefinition } from "./map-party-entry.js";
import type { NewGamePlan } from "./new-game.js";
import type { PartyAppearanceCandidate } from "./party.js";
import { initialPartyActorResidents, initialPartyActorSaveState, partyActorMapArea,
  partyMemberFieldAsset, type PartyActorCatalog } from "./party-actors.js";

/** Version-bound factory capability, compiled from the native/prefab source
 * manifest. These are creation inputs, never an independently saved actor set. */
export type FieldActorFactoryCatalog = {
  kind: "native-field-actor-factory-v1";
  sources: { file: string; sha256: string }[];
  offMapPosition: { x: 30000; y: 1000; z: -1000 };
  residentCharaZOffset: 0.5;
  playerPrefab: { objectId: string; layer: 8; childEntityObject: "absent"; rideOnEntity: "idle" };
  npcPrefab: { objectId: string; layer: 0; childEntityObject: "absent"; rideOnEntity: "idle" };
  partyPrefab: { objectId: string; layer: 0; childEntityObject: "absent"; rideOnEntity: "idle" };
};

/** All identifiers name actual native instances. In particular a negative
 * script alias is NOT an actor key, even if the actual player uses '-1001'. */
export type FieldActorFactoryBindings = {
  player: string;
  partyPuppets: string[];
  otherParties: string[];
  residents: { assetId: number; actor: string }[];
};
export type FieldActorFactoryCandidate = {
  snapshot: FieldPuppetHostSnapshot;
  bindings: FieldActorFactoryBindings;
  /** Retained on the existing actor along with its native transform. Rendering
   * CharaZOffset must not overwrite Transform.position.z. */
  assets: { id: string; fieldAssetId: number | null; charaZOffset: number }[];
};

export function validateFieldActorFactory(factory: FieldActorFactoryCatalog): void {
  if (!factory || factory.kind !== "native-field-actor-factory-v1" ||
      canonical(factory.offMapPosition) !== canonical({ x: 30000, y: 1000, z: -1000 }) ||
      factory.residentCharaZOffset !== 0.5 || !Array.isArray(factory.sources) || !factory.sources.length)
    throw new Error("Unbound native field actor factory");
  const seen = new Set<string>();
  for (const source of factory.sources) {
    if (!source.file || seen.has(source.file) || !/^[0-9a-f]{64}$/.test(source.sha256))
      throw new Error("Invalid field actor factory source identity");
    seen.add(source.file);
  }
  for (const [name, layer, objectId] of [["playerPrefab", 8, "-4981768101353485299"],
    ["npcPrefab", 0, "-5965975858956348123"], ["partyPrefab", 0, "-5338016237310088535"]] as const) {
    const prefab = factory[name];
    if (!prefab || prefab.objectId !== objectId ||
        prefab.layer !== layer || prefab.childEntityObject !== "absent" || prefab.rideOnEntity !== "idle")
      throw new Error("Unbound native field actor prefab " + name);
  }
}

/** CreateFieldPartyEntities/CreateFieldCharacterEntities + SetPartyCharacterAsset,
 * before PointIn/MapSetup. The caller MUST then run prepareMapPartyEntry; this is
 * deliberately not a player position or a development-checkpoint replacement. */
export function createFreshFieldPartyActorCheckpoint(input: {
  factory: FieldActorFactoryCatalog;
  catalog: PartyActorCatalog;
  fresh: NewGamePlan;
  party: PartyAppearanceCandidate;
  map: MapPartyEntryDefinition;
  playerId: string;
}): FieldPartyActorCheckpoint {
  const { factory, catalog, fresh, party, map, playerId } = input;
  validateFieldActorFactory(factory);
  if (!playerId || fresh.kind !== "source-new-game-plan-v1" || fresh.stage !== "after-data-create-before-field-load" ||
      map.mapId !== fresh.entry.mapId || map.kind !== "map-party-entry" || fresh.entry.viewType !== 0 ||
      catalog.memberCount !== 4 || catalog.partyCount !== 3 || !Array.isArray(party.parties) || party.parties.length !== 3)
    throw new Error("Invalid fresh native field actor initialization");
  // Initial ownership comes from the source DataInitialize candidate. Merely
  // supplying a similar party, or a development checkpoint with Magitek, fails.
  const expected = fresh.owned.party.slots.map((slot) => slot.flatMap((cell, index) => {
    if (cell.id === null) return [];
    const owned = fresh.owned.roster.find((member) => member.id === cell.id);
    if (!owned) throw new Error("Fresh factory party references missing owner");
    return [{ id: owned.id, index, row: cell.row, sourceId: owned.sourceId, jobId: owned.jobId,
      enabled: owned.enabled, conditionIds: [...owned.conditionIds] }];
  }));
  if (canonical(expected) !== canonical(party.parties) ||
      canonical(expected[fresh.owned.party.selectedSlot]) !== canonical(party.activeMembers))
    throw new Error("Fresh factory party does not match source new-game ownership");
  const transport = catalog.transportations.find((t) => t.id === fresh.entry.transportation.id);
  if (!transport || transport.typeId !== 1 || transport.typeId !== fresh.entry.transportation.type ||
      transport.fieldAssetId !== fresh.entry.transportation.assetId)
    throw new Error("Fresh field actor transportation provider is not walking");
  const initial = initialPartyActorSaveState();
  const puppets = Array.from({ length: 4 }, (_, index) => {
    const member = party.activeMembers.find((m) => m.index === index);
    const asset = member ? partyMemberFieldAsset(catalog, member) : catalog.assets[1];
    if (!asset) throw new Error("Missing fresh source dummy actor asset");
    return { id: `native:puppet:${index}`, fieldAssetId: asset.id, riderFieldAssetId: null, riding: false };
  });
  if (puppets.some((p) => p.id === playerId)) throw new Error("Actual player and source puppet identities collide");
  return {
    kind: "field-party-actors-v1", playerAssetCacheId: null,
    context: {
      leaderIndex: initial.leaderIndex,
      player: { id: playerId, fieldAssetId: null, riderFieldAssetId: null, riding: false },
      puppets, currentTransport: { ...transport },
      conditionResidents: initialPartyActorResidents(catalog), companion: initial.companion,
      multiParty: initial.partyLeaderIndices.map((leaderIndex, index) => ({ leaderIndex, members: [],
        actor: { id: `native:party:${index}`, fieldAssetId: null, riderFieldAssetId: null, riding: false } })),
      conditionColliders: structuredClone(map.conditionColliders),
      camera: { mapViewType: fresh.entry.viewType,
        mapArea: partyActorMapArea(map.mapRange.width, map.mapRange.height, map.loopType) },
    },
  };
}

/** Fresh scene publication after PointIn/MapSetup. Hidden resident transforms
 * retain the factory's off-map coordinates; only the actual player takes the
 * source entry pose. SetPartyCharacterAsset constructs playback objects but
 * does not select an animation until the later Init/Look/Cue calls. */
export function createFieldActorFactoryCandidate(input: {
  factory: FieldActorFactoryCatalog;
  partyCatalog: PartyActorCatalog;
  checkpoint: FieldPartyActorCheckpoint;
  player: { position: { x: number; y: number; z: number }; layer: number; direction: Direction; visible: boolean };
  characters: Readonly<Record<string, Character>>;
  camera: FieldPuppetHostSnapshot["camera"];
  providers: FieldPuppetHostProviders;
}): FieldActorFactoryCandidate {
  const { factory, partyCatalog, checkpoint, player, characters, camera, providers } = input;
  validateFieldActorFactory(factory);
  const c = checkpoint.context;
  if (checkpoint.kind !== "field-party-actors-v1" || c.companion !== null ||
      c.puppets.length !== 4 || c.multiParty.length !== 3 || c.puppets.some((a) => a === null) ||
      c.multiParty.some((p) => p.actor === null || p.members.length) ||
      canonical(c.conditionResidents) !== canonical(initialPartyActorResidents(partyCatalog)))
    throw new Error("Incomplete fresh field actor appearance context");
  if (c.currentTransport?.typeId !== 1 || providers.transportationType !== 1)
    throw new Error("Fresh actor factory requires the source walking lifecycle");
  const instances = [c.player, ...c.puppets, ...c.multiParty.map((p) => p.actor)];
  if (instances.some((a) => !a || a.riding || a.riderFieldAssetId !== null))
    throw new Error("Fresh actor factory cannot recreate a retained riding instance");
  if (c.player.fieldAssetId === null || checkpoint.playerAssetCacheId !== c.player.fieldAssetId ||
      c.puppets.some((p) => p!.fieldAssetId === null) || c.multiParty.some((p) => p.actor!.fieldAssetId !== null))
    throw new Error("Unresolved fresh field actor asset initialization");
  if (!player.position || [player.position.x, player.position.y, player.position.z].some((n) => !Number.isFinite(Math.fround(n))) ||
      ![9, 10, 11].includes(player.layer) || !["up", "right", "down", "left"].includes(player.direction) ||
      typeof player.visible !== "boolean") throw new Error("Unknown source PointIn player pose");
  if (!providers.mapRenderContext) throw new Error("Missing source actor map render context");
  if (!providers.applyViewProperties) throw new Error("Missing fresh player source material provider");
  const view = providers.applyViewProperties(player.layer);
  if (view === null) throw new Error("Missing fresh player source material projection");
  validateFieldActorViewProjection(view, providers.mapRenderContext, player.layer);
  const bindings: FieldActorFactoryBindings = {
    player: c.player.id, partyPuppets: c.puppets.map((p) => p!.id),
    otherParties: c.multiParty.map((p) => p.actor!.id),
    residents: c.conditionResidents!.map((r) => ({ assetId: r.characterId, actor: `native:resident:${r.characterId}` })),
  };
  const allIds = [bindings.player, ...bindings.partyPuppets, ...bindings.otherParties, ...bindings.residents.map((r) => r.actor)];
  if (allIds.some((id) => !id) || new Set(allIds).size !== allIds.length ||
      (camera !== null && allIds.includes(camera.id))) throw new Error("Native field actor factory identity collision");
  const assets: FieldActorFactoryCandidate["assets"] = [];
  const create = (id: string, fieldAssetId: number | null, role: "player" | "puppet" | "party" | "resident"): FieldPuppetHostActor => {
    const isPlayer = role === "player";
    const prefab = role === "party" ? factory.partyPrefab : isPlayer ? factory.playerPrefab : factory.npcPrefab;
    let animation: ActorAnimation | null = null, shadowVisible = true;
    if (fieldAssetId !== null) {
      const asset = partyCatalog.assets[fieldAssetId], media = asset && characters[asset.asset];
      if (!asset || !media || !Object.keys(media.sprites).length || !media.animations)
        throw new Error("Missing source actor factory media: " + fieldAssetId);
      // The non-custom native shadow types are fully identified by their master
      // rows. A custom shadow sprite still needs its separate media provider.
      if (asset.shadowType !== 0 && asset.shadowType !== 1)
        throw new Error("Unsupported source actor factory custom shadow: " + fieldAssetId);
      shadowVisible = asset.shadowType === 1;
      animation = new ActorAnimation(media);
      if (isPlayer) animation.look(player.direction);
    }
    const visible = isPlayer ? player.visible : role === "resident";
    // This candidate is after PointIn.Init, not the uninitialized player
    // constructor. FieldPlayer.Init (0xe194c0) sets its own depth offset to 0.5.
    assets.push({ id, fieldAssetId, charaZOffset: isPlayer ? 0.5 : factory.residentCharaZOffset });
    return {
      id, character: true, position: isPlayer ? { ...player.position } : { ...factory.offMapPosition },
      layer: isPlayer ? player.layer : prefab.layer, direction: isPlayer ? player.direction : null,
      animation, visible, fadeAlpha: visible ? 1 : 0, childEntityObject: prefab.childEntityObject,
      moving: false, riding: false, riderAssetId: null, rideOnEntity: prefab.rideOnEntity,
      bodyOpaque: true, shadowVisible, viewBinding: isPlayer ? {
        map: providers.mapRenderContext, layer: player.layer, properties: structuredClone(view),
      } : null,
      transparentTextures: isPlayer ? fieldPuppetBoundTransparentTextures(player.layer, providers)
        : { first: null, second: null },
    };
  };
  const actors = [create(c.player.id, c.player.fieldAssetId, "player"),
    ...c.puppets.map((p) => create(p!.id, p!.fieldAssetId, "puppet")),
    ...c.multiParty.map((p) => create(p.actor!.id, p.actor!.fieldAssetId, "party")),
    ...c.conditionResidents!.map((r) => create(`native:resident:${r.characterId}`, r.fieldAssetId, "resident"))];
  return { snapshot: { actors, camera: camera && { ...camera, position: { ...camera.position } } }, bindings, assets };
}

/** Reconstruct the read-only script context from the live owners for every
 * transaction. No roster, condition list or mutable actor state is retained. */
export function fieldPuppetContextFromActors(input: {
  catalog: FieldPuppetActorCatalog;
  checkpoint: FieldPartyActorCheckpoint;
  bindings: FieldActorFactoryBindings;
  snapshot: FieldPuppetHostSnapshot;
  owned: readonly FieldPuppetOwned[];
  party: readonly number[];
  entities: readonly { entityId: number; actor: string }[];
  restorePartyInstruction: FieldPuppetActorContext["restorePartyInstruction"];
}): FieldPuppetActorContext {
  const { catalog, checkpoint, bindings, snapshot, owned, party, entities, restorePartyInstruction } = input;
  const c = checkpoint.context;
  if (checkpoint.kind !== "field-party-actors-v1" || catalog.kind !== "field-puppet-actors-v1" ||
      c.player.id !== bindings.player || bindings.partyPuppets.length !== 4 || bindings.otherParties.length !== 3 ||
      canonical(c.puppets.map((p) => p?.id ?? null)) !== canonical(bindings.partyPuppets) ||
      canonical(c.multiParty.map((p) => p.actor?.id ?? null)) !== canonical(bindings.otherParties) ||
      !Array.isArray(c.conditionResidents)) throw new Error("Native field actor owner binding changed");
  if (canonical(bindings.residents.map((r) => r.assetId)) !== canonical(c.conditionResidents.map((r) => r.characterId)))
    throw new Error("Native field resident binding changed");
  const ids = new Set<string>();
  for (const actor of snapshot.actors) {
    if (!actor.id || ids.has(actor.id) || typeof actor.character !== "boolean" || typeof actor.riding !== "boolean")
      throw new Error("Invalid native field actor snapshot identity");
    ids.add(actor.id);
  }
  const required = [bindings.player, ...bindings.partyPuppets, ...bindings.otherParties, ...bindings.residents.map((r) => r.actor)];
  if (new Set(required).size !== required.length || required.some((id) => !ids.has(id)))
    throw new Error("Native field actor snapshot is incomplete");
  if (snapshot.camera !== null && (!snapshot.camera.id || ids.has(snapshot.camera.id)))
    throw new Error("Native field camera identity collides with an actor");
  if (party.length !== 4 || !["absent", "present", "unknown"].includes(restorePartyInstruction))
    throw new Error("Unknown source field party/restore context");
  const owners = new Set<number>();
  for (const member of owned) {
    checkpointInteger(member.ownedId, 1, 0x7fffffff); checkpointInteger(member.sourceId, 1, 0x7fffffff);
    if (owners.has(member.ownedId) || typeof member.enabled !== "boolean" || !Array.isArray(member.conditionTypes))
      throw new Error("Invalid source field owned identity");
    for (const type of member.conditionTypes) checkpointInteger(type, 0, 0x7fffffff);
    owners.add(member.ownedId);
  }
  const occupied = new Set<number>();
  for (const id of party) {
    checkpointInteger(id, 0, 0x7fffffff);
    if (id && (!owners.has(id) || occupied.has(id))) throw new Error("Invalid source field Corps ownership");
    if (id) occupied.add(id);
  }
  const entityIds = new Set<number>();
  for (const entity of entities) {
    checkpointInteger(entity.entityId, 1, 0x7fffffff);
    if (!ids.has(entity.actor) || entityIds.has(entity.entityId)) throw new Error("Invalid source field entity binding");
    entityIds.add(entity.entityId);
  }
  return {
    player: bindings.player, actors: snapshot.actors.map(({ id, character, riding }) => ({ id, character, riding })),
    camera: snapshot.camera?.id ?? null, partyPuppets: [...bindings.partyPuppets], otherParties: [...bindings.otherParties],
    residents: structuredClone(bindings.residents), entities: structuredClone([...entities]),
    party: [...party], owned: structuredClone([...owned]), savedLeaderIndex: c.leaderIndex,
    conditionController: "present", companion: c.companion === null ? "absent" : "present",
    transport: c.currentTransport && { id: c.currentTransport.id, typeId: c.currentTransport.typeId },
    restorePartyInstruction,
  };
}
