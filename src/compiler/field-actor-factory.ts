import type { FieldActorFactoryCatalog } from "../core/field-actor-factory.js";
import { compilePlayerVisibilityFactory } from "./player-visibility.js";

/** Native constructors, prefab object identities and the complete inherited
 * InitInstance chain are checked by check-field-actor-factory-native. The
 * supplied manifest must be the same source set as the field/owned packages. */
export function compileFieldActorFactory(sources: readonly { file: string; sha256: string }[]): FieldActorFactoryCatalog {
  const player = compilePlayerVisibilityFactory(sources);
  return {
    kind: "native-field-actor-factory-v1", sources: player.sources.map((s) => ({ ...s })),
    offMapPosition: { x: 30000, y: 1000, z: -1000 }, residentCharaZOffset: 0.5,
    playerPrefab: { objectId: "-4981768101353485299", layer: 8, childEntityObject: "absent", rideOnEntity: "idle" },
    npcPrefab: { objectId: "-5965975858956348123", layer: 0, childEntityObject: "absent", rideOnEntity: "idle" },
    partyPrefab: { objectId: "-5338016237310088535", layer: 0, childEntityObject: "absent", rideOnEntity: "idle" },
  };
}
