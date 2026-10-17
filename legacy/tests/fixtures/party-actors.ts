import type { PartyActorCatalog, PartyActorContext, PartyActorMember } from "../../src/core/party-actors.js";

export function actorCatalog(): PartyActorCatalog {
  const assets = [
    [1, 1, "alpha"], [2, 2, "bravo"], [3, 3, "charlie"],
    [11, 11, "same-media"], [12, 12, "same-media"],
    [30, 100, "boat"], [31, 101, "bird"], [38, 107, "armor"],
    [40, 202, "small"], [41, 203, "frog"],
  ] as const;
  return {
    formatVersion: 1, memberCount: 4, partyCount: 3,
    assets: Object.fromEntries(assets.map(([id, characterId, asset]) => [id, { id, characterId, asset, shadowType: 1, shadowName: "shadow" }])),
    // Intentionally non-numeric source order and identical media at distinct IDs.
    characterAssets: [
      { id: 90, sourceId: 1, jobId: 7, fieldAssetId: 11 },
      { id: 2, sourceId: 1, jobId: 7, fieldAssetId: 12 },
      { id: 3, sourceId: 2, jobId: 8, fieldAssetId: 2 },
      { id: 4, sourceId: 3, jobId: 7, fieldAssetId: 3 },
      { id: 1, sourceId: 1, jobId: 1, fieldAssetId: 1 },
    ],
    conditionTypes: { 1: 5, 10: 401, 11: 402, 12: 665, 13: 666, 14: 401 },
    conditionChanges: [{ type: 665, residentCharacterId: 202 }, { type: 666, residentCharacterId: 203 }],
    residents: assets.map(([fieldAssetId, characterId]) => ({ fieldAssetId, characterId })),
    viewpointOffsets: [{ fieldAssetId: 11, x: 2, y: 16 }, { fieldAssetId: 2, x: 0, y: 8 },
      { fieldAssetId: 31, x: 0, y: 48 }, { fieldAssetId: 1034, x: 0, y: 16 }],
    transportations: [{ id: 1, typeId: 1, fieldAssetId: 0 }, { id: 2, typeId: 2, fieldAssetId: 30 },
      { id: 3, typeId: 9, fieldAssetId: 31 }, { id: 6, typeId: 12, fieldAssetId: 38 }],
    affectedCompanions: null, flatBirdAssets: { 3: 1034 }, checkpointInputs: null,
  };
}
export function actorMember(value: Partial<PartyActorMember> = {}): PartyActorMember {
  return { id: "one", index: 0, row: "front", sourceId: 1, jobId: 7, enabled: true, conditionIds: [], ...value };
}
export function actorContext(): PartyActorContext {
  return {
    leaderIndex: 0, player: { id: "player", fieldAssetId: 1, riderFieldAssetId: null, riding: false },
    puppets: Array.from({ length: 4 }, (_, i) => ({ id: `puppet:${i}`, fieldAssetId: null, riderFieldAssetId: null, riding: false })),
    currentTransport: { id: 1, typeId: 1, fieldAssetId: 0 },
    conditionResidents: [{ characterId: 202, fieldAssetId: 40 }, { characterId: 203, fieldAssetId: 41 }],
    companion: null,
    multiParty: Array.from({ length: 3 }, (_, i) => ({ leaderIndex: 0, members: [], actor: { id: `party:${i}`, fieldAssetId: null, riderFieldAssetId: null, riding: false } })),
    conditionColliders: null,
    camera: { mapViewType: 0, mapArea: { xMin: 0, yMin: 0, width: 0, height: 0 } },
  };
}
export function actorSourceTables() {
  const catalog = actorCatalog();
  return {
    "field_character_asset.csv": Object.values(catalog.assets).map((a) => ({ id: String(a.id), character_id: String(a.characterId), asset_name: a.asset, shadow_type: String(a.shadowType), shadow_name: a.shadowName })),
    "character_asset.csv": catalog.characterAssets.map((a) => ({ id: String(a.id), character_id: String(a.sourceId), job_id: String(a.jobId), field_character_asset_id: String(a.fieldAssetId) })),
    "condition.csv": Object.entries(catalog.conditionTypes).map(([id, condition_type]) => ({ id, condition_type: String(condition_type) })),
    "transportation.csv": catalog.transportations.map((a) => ({ id: String(a.id), type_id: String(a.typeId), asset_id: String(a.fieldAssetId) })),
  };
}
export function actorMisc() {
  const catalog = actorCatalog();
  return {
    change_character_condition_list: catalog.conditionChanges.map((a) => ({ condition_type: a.type, field_character_asset_cid: a.residentCharacterId })),
    character_viewpoint_offset_list: catalog.viewpointOffsets.map((a) => ({ asset_id: a.fieldAssetId, viewpoint_offsetx: a.x, viewpoint_offsety: a.y })),
  };
}
