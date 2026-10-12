import type { Character, Evidence, FieldContent, Op } from "./types.js";
import type { ScriptLocals } from "../core/event-state.js";
import type { MapPartyEntryDefinition } from "../core/map-party-entry.js";
import type { TransportationCatalog } from "../core/transportation.js";
import type { FieldActorViewDefinition } from "../core/field-actor-view.js";
import type { FieldNativeAnimationKeys } from "../core/field-native-appearance.js";
import type { FieldNativeFootDefinition } from "../core/field-native-foot.js";

export type ContentIssue = { reason: string; source: Evidence };
export type WorldMapContent = {
  formatVersion: 1;
  kind: "world-map-development";
  sourceSetHash: string;
  parentSourceSetHash: string;
  mediaSourceSetHash: string;
  contentHash: string;
  mapId: number;
  areaId: number;
  name: string;
  map: FieldContent["map"] | null;
  /** Source MapSetup inputs, independent of geometry compilation/admission. */
  partyEntry?: MapPartyEntryDefinition;
  partyEntryBlockers?: ContentIssue[];
  scripts: Record<string, Op[]>;
  scriptLocals: Record<string, ScriptLocals | null>;
  scriptSystemFlags?: FieldContent["scriptSystemFlags"];
  scriptPuppetContexts?: FieldContent["scriptPuppetContexts"];
  cameraHost?: FieldContent["cameraHost"];
  cameraHostBlockers?: ContentIssue[];
  /** Destination material inputs for persistent native actors. Availability
   * alone does not admit that map's entity or lifecycle dependencies. */
  actorView?: FieldActorViewDefinition;
  actorViewBlockers?: ContentIssue[];
  nativeFoot?: FieldNativeFootDefinition;
  nativeFootBlockers?: ContentIssue[];
  initializer: string | null;
  characterAssets: string[];
  blockers: ContentIssue[];
  limitations: string[];
};
export type WorldCatalog = {
  formatVersion: 1;
  kind: "world-development";
  sourceSetHash: string;
  parentSourceSetHash: string;
  mediaSourceSetHash: string;
  contentHash: string;
  characters: Record<string, Character>;
  nativeAnimationKeys?: FieldNativeAnimationKeys;
  transportation?: TransportationCatalog;
  playerFactory?: FieldContent["playerFactory"];
  treasureInventoryLimits?: FieldContent["treasureInventoryLimits"];
  systemMessageSource?: Evidence & { sourceSetHash: string; sha256: string };
  minimap?: FieldContent["minimap"];
  bgm?: FieldContent["bgm"];
  environment?: FieldContent["environment"];
  characterIssues: Record<string, ContentIssue[]>;
  maps: Record<
    string,
    {
      url: string;
      contentHash: string;
      name: string;
      areaId: number;
      geometryReady: boolean;
      defaultGroupReady: boolean;
      blockers: ContentIssue[];
    }
  >;
  limitations: string[];
};
