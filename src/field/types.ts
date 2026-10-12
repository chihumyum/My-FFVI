/** Browser-safe field content: no Unity readers or renderer dependencies in the runtime. */
import type { EventControlOp, ScriptLocals, VariableRef } from "../core/event-state.js";
import type { MinimapMedia } from "../core/minimap.js";
import type { AudioMedia } from "../core/static-audio.js";
import type { InventoryEventOp } from "../core/inventory-event.js";
import type { PartyEventOp } from "../core/party.js";
import type { RosterLifecycleEventOp } from "../core/roster.js";
import type { FieldPartyActorCheckpoint } from "../core/field-party-actors.js";
import type { PartyActorContext } from "../core/party-actors.js";
import type { TreasureBoxRequest, TreasureInventoryDefinition, TreasureInventoryLimits } from "../core/treasure-inventory.js";
import type { TreasureTaskMessages } from "../core/treasure-task.js";
import type { OwnedConditionEventOp } from "../core/owned-condition.js";
import type { FieldEntryContextDefinition } from "../core/field-entry-context.js";
import type { SourcePresentationOp } from "../core/source-presentation.js";
import type { AudioReadinessOp } from "../core/audio-readiness.js";
import type { PlayerVisibilityOp, PlayerVisibilityFactory } from "../core/player-visibility.js";
import type { FieldTaskControlOp } from "../core/field-task-control.js";
import type { FieldFadeOp, FieldFadeInitial } from "../core/field-fade.js";
import type { FieldPuppetScriptContext } from "../core/field-puppet-actors.js";
import type { FieldCameraOp, FieldCameraMotionOp, FieldCameraSetPosition } from "../core/field-camera.js";
import type { FieldCameraHostDefinition } from "../core/field-camera-host.js";
import type { FieldBackgroundLayer } from "../core/field-background.js";
import type { SourceMessageOp } from "../core/source-message.js";
import type { FieldEffectBoardDefinition, FieldEffectCatalog } from "../core/field-effects.js";
import type { FieldNativeNpcDefinition, FieldNativeNpcStandby } from "../core/field-native-npc.js";
import type { FieldNativePosition } from "../core/field-native-position.js";
import type { FieldNativeCompositionDefinition } from "../core/field-native-composition.js";
export type Point = { x: number; y: number };
export type Direction = "up" | "right" | "down" | "left";
export type Evidence = {
  file: string;
  assetPath: string;
  objectId?: string | undefined;
  pointer?: string;
};
export type FieldMessage = {
  key: string;
  text: string;
  speaker: string;
  /** Source MessageParser CT tag; absence retains the ordinary layout. */
  alignment?: "center";
};
export type FieldInteraction =
  | { kind: "none" }
  | { kind: "script"; script: string | null }
  | { kind: "talk"; message: FieldMessage }
  | {
      kind: "shop";
      groupId: number;
      start: FieldMessage | null;
      close: FieldMessage | null;
    }
  | { kind: "treasure"; request: TreasureBoxRequest }
  | { kind: "blocked"; reason: string };
export type InteractionProperties = {
  acceptDirection: number;
  /** Empty string denotes walking; other entries are source transportation assets. */
  talkMounts: string[];
  interaction: FieldInteraction;
  /** EventAction assigns the property SE to RunScript; ordinary Talk leaves it zero. */
  soundId: number;
};
export type NpcProperties = InteractionProperties & {
  moveType: number;
  collision: boolean;
  pushed: boolean;
  eyeContact: boolean;
  turnAround: boolean;
};
export type MapObjectProperties = InteractionProperties & {
  /** Assetless FieldMapObjectDefault has no sprite, but still has a collider. */
  collision: boolean;
};
export type FieldEntity = Point & {
  id: string;
  objectId?: number;
  minimap?: Point & { icon: number };
  destination?: { mapId: number; entrance: number };
  npc?: NpcProperties;
  nativeNpc?: FieldNativeNpcDefinition;
  nativeNpcBlockers?: string[];
  effect?: FieldEffectBoardDefinition;
  mapObject?: MapObjectProperties;
  /** Source property reward; native entityId may be zero for anonymous objects. */
  treasure?: TreasureInventoryDefinition;
  treasureMessages?: TreasureTaskMessages;
  openTrigger?: {
    /** Movement-facing mask, distinct from an actor's facing and NPC action side. */
    direction: number;
    linkObject: number;
    soundId: number;
  };
  tileAnimation?: {
    allLayers: boolean;
    loop: boolean;
    reverse: boolean;
    /** Bound by the compiler to cells, never to a shared atlas tile ID. */
    cells?: { layer: number; index: number }[];
  };
  layer: number;
  kind: number;
  width: number;
  height: number;
  asset: string | null;
  direction: Direction;
  script: string | null;
  collision: number | null;
  destinationLayer: number | null;
  source: Evidence;
};
export type EntityGroup = {
  name: string;
  source: Evidence;
  entities: FieldEntity[];
  blockers: { reason: string; source: Evidence }[];
};
export type Sprite = {
  file: string;
  width: number;
  height: number;
  pivot: number[];
  sha256: string;
  source: Evidence;
};
export type Frame = {
  sprite: string;
  x: number;
  y: number;
  flip: boolean;
  alpha: number;
};
export type Animation = {
  frames: Frame[];
  duration: number;
  mode: number;
  flip: boolean;
  next: string;
};
export type Character = {
  sprites: Record<string, Sprite>;
  animations: Record<string, Animation>;
  source: Evidence;
};
export type Site = { script: string; index: number; source: Evidence };
export type MapRequest = {
  mapId: number;
  entrance: number;
  continuation: string | null;
  birdview: boolean;
  skipFade: boolean;
  skipBgm: boolean;
  origin: "script" | "trigger" | "development";
};
export type Op = Site &
  (
    | { kind: "nop" | "exit" | "return" | "join" | "hide" }
    | EventControlOp
    | InventoryEventOp
    | TreasureBoxRequest
    | PartyEventOp
    | RosterLifecycleEventOp
    | OwnedConditionEventOp
    | SourcePresentationOp
    | AudioReadinessOp
    | PlayerVisibilityOp
    | FieldTaskControlOp
    | FieldFadeOp
    | FieldCameraOp
    | FieldCameraMotionOp
    | SourceMessageOp
    | { kind: "entities"; group: string }
    | { kind: "change-map"; request: MapRequest }
    | { kind: "ride"; actor: string; vehicle: 6 }
    | { kind: "sound"; soundId: number; channel: number; mode: number }
    | { kind: "sound-sync" }
    | {
        kind: "bgm-play";
        track: number;
        channel: number;
        fade: number;
        seek: number;
      }
    | { kind: "bgm-stop"; channel: number; fade: number }
    | {
        kind: "environment-play";
        track: number;
        channel: number;
        fade: number;
        seek: number;
      }
    | { kind: "environment-stop"; channel: number; fade: number }
    | { kind: "call"; target: number }
    | { kind: "wait"; seconds: number }
    | { kind: "puppet"; slot: number; actor: string; target: number }
    | { kind: "position"; x: number; y: number; animation: string;
        nativeCommand?: FieldNativePosition;
        /** Independent source admission when the runtime binding is dummy 0. */
        cameraCommand?: FieldCameraSetPosition }
    | {
        kind: "move";
        direction: Direction;
        steps: number;
        secondsPerCell: number;
      }
    | { kind: "look"; direction: Direction }
    | { kind: "animation-cue"; animation: string; frame: number }
    | {
        kind: "animation-play";
        animation: string;
        speed: number;
        loop: boolean;
      }
    | { kind: "message"; key: string; text: string; speaker: string }
    | { kind: "encounter"; party: number; continuation: string }
    | { kind: "blocked"; mnemonic: string; reason: string }
  );
export type TileLayer = {
  name: string;
  sourceGroup?: string;
  width: number;
  height: number;
  data: number[];
  opacity: number;
};
export type Tileset = {
  firstgid: number;
  columns: number;
  tilewidth: number;
  tileheight: number;
  image: string;
  spacing?: number;
  margin?: number;
  tiles?: { id: number; animation?: { tileid: number; duration: number }[] }[];
};
export type FieldContent = {
  formatVersion: 1;
  kind: "field-development";
  sourceSetHash: string;
  parentSourceSetHash: string;
  contentHash: string;
  map: {
    nativeComposition?: FieldNativeCompositionDefinition;
    id: string;
    identity?: { mapId: number; areaId: number };
    entryContext?: FieldEntryContextDefinition;
    width: number;
    height: number;
    tileSize: number;
    layers: TileLayer[];
    backgrounds?: FieldBackgroundLayer[];
    tilesets: Tileset[];
    textures: Record<string, string>;
    collisions: Record<string, number[]>;
    entities: FieldEntity[];
    groups?: Record<string, EntityGroup>;
    initialGroups?: string[];
    partyActorCamera?: PartyActorContext["camera"];
    source: Evidence;
  };
  characters: Record<string, Character>;
  minimap?: MinimapMedia;
  bgm?: AudioMedia;
  environment?: AudioMedia;
  treasureInventoryLimits?: TreasureInventoryLimits;
  playerFactory?: PlayerVisibilityFactory;
  /** Content-bound native camera factory and current map providers. */
  cameraHost?: FieldCameraHostDefinition;
  nativeNpcStandby?: FieldNativeNpcStandby;
  fieldEffects?: FieldEffectCatalog;
  /** Existing development checkpoint deviations only; source world packages
   * keep these entities and their full capability blockers. */
  developmentOmissions?: { kind: "field-effect"; entityId: string; group: string; source: Evidence; reason: string }[];
  scripts: Record<string, Op[]>;
  scriptLocals?: Record<string, ScriptLocals | null>;
  /** Integrator.Execute reads this per source Format; absence is unknown. */
  scriptSystemFlags?: Record<string, { keepBadStatusVisual: boolean } | null>;
  /** Full source lifecycle admission. Development checkpoints without this
   * capability retain their documented actor-bootstrap limitation. */
  scriptPuppetContexts?: Record<string, FieldPuppetScriptContext | null>;
  entry: {
    /** Explicit host seed. Missing means unknown, never an implicit clear screen. */
    fade?: FieldFadeInitial;
    /** A source MapSetup/PointIn entry. The host must finish its initializer or
     * continuation before publishing SetupEncountData qualification inputs. */
    synchronization?: { kind: "map-entry" };
    /** Native FieldEntity.Init preserves Show/Hide; ordinary entry supplies the prior visibility. */
    playerVisible?: boolean;
    /** Source map scroll offset in native pixels (native Y points upward). */
    cameraOffset?: Point;
    /** Source-proven bootstrap cells. Applied only by a new session, never save restoration. */
    initialEventValues?: { ref: VariableRef; value: number }[];
    /** Current TransportationInfo identity. Rider artwork is independent. */
    transportationId?: number;
    partyActors?: FieldPartyActorCheckpoint;
    player: Point & {
      direction: Direction;
      layer: number;
      asset: string;
      mount: string;
    };
    evidence: Evidence[];
    description: string;
    absentHideTargets?: string[];
  };
  limitations: string[];
};
