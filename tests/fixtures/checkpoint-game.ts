import { itemFixture } from "./items.js";
import { fixtureParty } from "./party.js";
import type {
  Character,
  FieldContent,
  FieldEntity,
  Op,
} from "../../src/field/types.js";
import type { WorldCatalog, WorldMapContent } from "../../src/field/world.js";
import type { BattleCatalog } from "../../src/core/battle-content.js";
import { GameSession } from "../../src/core/game-session.js";
import { fixture as battleFixture } from "./battle-content.js";

const source = { file: "synthetic", assetPath: "checkpoint" };
const op = (value: Record<string, unknown>): Op =>
  ({ script: "test", index: 0, source, ...value }) as Op;
const entity = (id: string, kind: number): FieldEntity => ({
  id,
  kind,
  x: 2,
  y: 1,
  layer: 1,
  width: 1,
  height: 1,
  direction: "right",
  asset: null,
  script: null,
  collision: null,
  destinationLayer: null,
  source,
});
const character: Character = {
  source,
  sprites: {
    pose: {
      file: "synthetic.png",
      width: 16,
      height: 16,
      pivot: [0.5, 0],
      sha256: "synthetic",
      source,
    },
  },
  animations: Object.fromEntries(
    ["Default", "WalkL", "WalkR", "WalkB"].map((key) => [
      key,
      {
        duration: 0.125,
        mode: 1,
        flip: false,
        next: "",
        frames: [{ sprite: "pose", x: 0, y: 0, flip: false, alpha: 1 }],
      },
    ]),
  ),
};
export function checkpointFixture() {
  const door: FieldEntity = {
    ...entity("door", 8),
    openTrigger: { direction: 15, linkObject: 7, soundId: 0 },
  };
  const region: FieldEntity = {
    ...entity("region", 1),
    objectId: 7,
    tileAnimation: {
      allLayers: true,
      loop: false,
      reverse: false,
      cells: [{ layer: 0, index: 8 }],
    },
  };
  const npc: FieldEntity = { ...entity("npc", 6), x: 4, y: 2, asset: "hero" };
  const later = { ...entity("later", 19), x: 5, y: 2, collision: 0 };
  const entities = [door, region, npc];
  const field: FieldContent = {
    formatVersion: 1,
    kind: "field-development",
    sourceSetHash: "fixture",
    parentSourceSetHash: "base",
    contentHash: "initial",
    map: {
      id: "Start",
      identity: { mapId: 1, areaId: 7 },
      width: 6,
      height: 4,
      tileSize: 16,
      layers: [
        {
          name: "floor",
          width: 6,
          height: 4,
          opacity: 1,
          data: Array(24).fill(1),
        },
      ],
      tilesets: [
        {
          firstgid: 1,
          columns: 3,
          tilewidth: 16,
          tileheight: 16,
          image: "synthetic.png",
          tiles: [
            {
              id: 0,
              animation: [
                { tileid: 0, duration: 20 },
                { tileid: 1, duration: 20 },
                { tileid: 2, duration: 20 },
              ],
            },
          ],
        },
      ],
      textures: {},
      collisions: { 1: Array(24).fill(0) },
      source,
      entities,
      initialGroups: ["entity_default"],
      groups: {
        entity_default: {
          name: "entity_default",
          entities,
          blockers: [],
          source,
        },
        later: { name: "later", entities: [later], blockers: [], source },
      },
    },
    characters: { hero: character },
    scripts: {
      groups: [op({ kind: "entities", group: "later" }), op({ kind: "exit" })],
      fight: [op({ kind: "encounter", party: 1000, continuation: "after" })],
      after: [
        op({
          kind: "flag",
          ref: { category: "ScenarioFlag1", index: 1 },
          operation: "set",
        }),
        op({ kind: "exit" }),
      ],
    },
    entry: {
      player: {
        x: 1,
        y: 1,
        layer: 1,
        direction: "right",
        asset: "hero",
        mount: "",
      },
      description: "synthetic",
      evidence: [source],
    },
    limitations: [],
    bgm: {
      sourceSetHash: "audio",
      tracks: {
        1: {
          file: "synthetic.flac",
          sha256: "audio",
          sampleRate: 1000,
          frames: 10000,
          channels: 1,
          loop: { start: 1000, end: 9000 },
          source,
          tableSource: source,
        },
      },
    },
  };
  const battle = battleFixture();
  battle.fieldSourceSetHash = field.sourceSetHash;
  const {
    encounterId,
    formation,
    enemies,
    background,
    contentHash: _,
    ...common
  } = battle;
  const catalog: BattleCatalog = {
    kind: "narshe-battle-catalog",
    contentHash: "battle",
    common,
    encounters: {
      [encounterId]: { encounterId, formation, enemies, background },
    },
    gameState: {
      kind: "game-state-development-v1",
      initialGil: 90,
      initialParty: fixtureParty(["a", "b"]),
      limits: {
        gil: 9999999,
        item: 99,
        hp: 9999,
        mp: 999,
        level: 99,
        exp: 15000000,
      },
      items: {
        10: itemFixture(10),
      },
      initialItems: [],
      equipment: { a: [1, 2, 3, 4, 5, 5], b: [1, 2, 3, 4, 5, 5] },
    },
  };
  const entry = { ...entity("entry", 0), x: 1, y: 1, objectId: 1 };
  const target: WorldMapContent = {
    formatVersion: 1,
    kind: "world-map-development",
    sourceSetHash: "world",
    parentSourceSetHash: "base",
    mediaSourceSetHash: "media",
    contentHash: "target",
    mapId: 2,
    areaId: 7,
    name: "Next",
    map: {
      ...field.map,
      id: "Next",
      identity: { mapId: 2, areaId: 7 },
      entities: [...entities, entry],
      groups: {
        ...field.map.groups,
        entity_default: {
          name: "entity_default",
          entities: [...entities, entry],
          blockers: [],
          source,
        },
      },
    },
    scripts: {
      ...field.scripts,
      init: [
        op({
          kind: "flag",
          ref: { category: "ScenarioFlag1", index: 8 },
          operation: "flip",
        }),
        op({ kind: "exit" }),
      ],
    },
    scriptLocals: {},
    initializer: "init",
    characterAssets: ["hero"],
    blockers: [],
    limitations: [],
  };
  const world: WorldCatalog = {
    formatVersion: 1,
    kind: "world-development",
    sourceSetHash: "world",
    parentSourceSetHash: "base",
    mediaSourceSetHash: "media",
    contentHash: "world-catalog",
    characters: { hero: character },
    characterIssues: {},
    bgm: field.bgm!,
    maps: {
      2: {
        url: "/world/maps/2.json",
        contentHash: "target",
        name: "Next",
        areaId: 7,
        geometryReady: true,
        defaultGroupReady: true,
        blockers: [],
      },
    },
    limitations: [],
  };
  return {
    game: new GameSession(field, catalog, 314),
    field,
    battle: catalog,
    world,
    target,
  };
}
