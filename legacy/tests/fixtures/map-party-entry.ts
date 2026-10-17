import type { MapPartyEntryDefinition, MapPartyEntryInput } from "../../src/core/map-party-entry.js";
import { actorContext, actorMember } from "./party-actors.js";

export function mapEntryDefinition(): MapPartyEntryDefinition {
  return {
    formatVersion: 1, kind: "map-party-entry", mapId: 42, width: 32, height: 24,
    mapRange: { x: 2, y: 1, width: 25, height: 20 }, loopType: 0,
    pointIns: [{ id: 2, x: 8, y: 9, layer: 2, direction: "left", linkObject: 0,
      source: { file: "controlled", assetPath: "destination/entity_default.json", pointer: "/layers/0/objects/0" } }],
    conditionColliders: [],
  };
}

export function mapEntryInput(): MapPartyEntryInput {
  const member = actorMember();
  return {
    definition: mapEntryDefinition(), entrance: 2, mapViewType: 0,
    prior: { kind: "field-party-actors-v1", context: actorContext(), playerAssetCacheId: 1 },
    playerVisible: true, party: { activeMembers: [member], parties: [[{ ...member, conditionIds: [] }], [], []] },
    transportation: { id: 1, type: 1, assetId: 0 }, canPartySwitching: false,
  };
}
