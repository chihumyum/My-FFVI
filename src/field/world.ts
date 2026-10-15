import type { Character, Evidence, FieldContent, Op } from "./types.js";
import type { ScriptLocals } from "../core/event-state.js";
import type { MapPartyEntryDefinition } from "../core/map-party-entry.js";
import type { TransportationCatalog } from "../core/transportation.js";
import type { FieldActorViewDefinition } from "../core/field-actor-view.js";
import type { FieldNativeAnimationKeys } from "../core/field-native-appearance.js";
import type { FieldNativeFootDefinition } from "../core/field-native-foot.js";
import type { SourceWalkPolicyBinding } from "../core/source-walk-policy-content.js";
import type { DevelopmentProfile } from "../core/development-profile.js";
import type { FrameworkFlatFieldViewDefinition } from "../core/field-actor-view.js";
import type { FieldNativeCompositionDefinition } from "../core/field-native-composition.js";

export type ContentIssue = { reason: string; source: Evidence };
export type FieldAnimationImportObservation = {
  kind: "native-AnimAssetDatas-json-2019.4-v1"; source: Evidence; rawHash: string;
  field: "next_anim_name"; index: number; original: "missing" | "null";
  nativeValue: null; runtimeValue: ""; interpretation: "no-successor";
};
export type SourceWalkEncounterRowEvidence = Evidence & { rowId?: string; serializedFile?: string };
/** Source references only. Rates are observations, never runtime weights or
 * permission to implement native encounter timing/lottery. */
export type SourceWalkEncounterDependencies = {
  kind: "source-walk-encounter-dependencies-v1";
  mapId: number;
  map: { source: SourceWalkEncounterRowEvidence; values: Record<string, string> };
  monsterSetId: number | null;
  set: { source: SourceWalkEncounterRowEvidence; values: Record<string, string> } | null;
  slots: { index: number; partyId: number | null; rawPartyId: string | null;
    rate: number | null; rawRate: string | null; source: SourceWalkEncounterRowEvidence }[];
  blockers: { code: "source-walk-encounter-binding-invalid"; reason: string; source: Evidence }[];
};
export type WorldMapContent = {
  formatVersion: 1;
  kind: "world-map-development";
  sourceSetHash: string;
  parentSourceSetHash: string;
  mediaSourceSetHash: string;
  contentHash: string;
  developmentProfile?: DevelopmentProfile;
  developmentOmissions?: FieldContent["developmentOmissions"];
  walkEncounters?: FieldContent["walkEncounters"];
  sourceWalkEncounters?: SourceWalkEncounterDependencies;
  /** Explicit Web scheduler derived from the retained source set and this
   * package's complete battle pool. This is not native timing evidence. */
  frameworkWalkBinding?: SourceWalkPolicyBinding;
  mapId: number;
  areaId: number;
  name: string;
  map: FieldContent["map"] | null;
  /** MapModel's area.map_type predicate, independent of loop or presentation. */
  entryView?: { mapId: number; isWorld: boolean; loopType: 0 | 1 | 2 | 3;
    sources: { map: Evidence; area: Evidence } };
  /** Source MapSetup inputs, independent of geometry compilation/admission. */
  partyEntry?: MapPartyEntryDefinition;
  partyEntryBlockers?: ContentIssue[];
  scripts: Record<string, Op[]>;
  scriptLocals: Record<string, ScriptLocals | null>;
  reservedScriptBindings?: FieldContent["reservedScriptBindings"];
  scriptTransitionMetadata?: FieldContent["scriptTransitionMetadata"];
  scriptSystemFlags?: FieldContent["scriptSystemFlags"];
  scriptPuppetContexts?: FieldContent["scriptPuppetContexts"];
  cameraHost?: FieldContent["cameraHost"];
  cameraHostBlockers?: ContentIssue[];
  /** Destination material inputs for persistent native actors. Availability
   * alone does not admit that map's entity or lifecycle dependencies. */
  actorView?: FieldActorViewDefinition;
  actorViewBlockers?: ContentIssue[];
  /** Explicit alternative display. Strict source view/blockers are retained. */
  frameworkPresentation?: {
    kind: "framework-ordinary-field-presentation-v1" | "framework-world-field-presentation-v1";
    /** Exact raw top-level indices of the world backgrounds compiled below. */
    backgroundBindings?: { index: number; layerId: number }[];
    view: FrameworkFlatFieldViewDefinition;
    composition: FieldNativeCompositionDefinition;
  };
  nativeCompositionBlockers?: ContentIssue[];
  nativeFoot?: FieldNativeFootDefinition;
  nativeFootBlockers?: ContentIssue[];
  nativeNpcStandby?: FieldContent["nativeNpcStandby"];
  npcRoutes?: FieldContent["npcRoutes"];
  frameworkNpcActivity?: FieldContent["frameworkNpcActivity"];
  frameworkNpcFlat?: FieldContent["frameworkNpcFlat"];
  frameworkRelayInteraction?: FieldContent["frameworkRelayInteraction"];
  frameworkPassiveEffects?: NonNullable<FieldContent["frameworkPassiveEffects"]>;
  nativeNpcStandbyBlockers?: ContentIssue[];
  fieldEffects?: FieldContent["fieldEffects"];
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
  developmentProfile?: DevelopmentProfile;
  characters: Record<string, Character>;
  nativeAnimationKeys?: FieldNativeAnimationKeys;
  transportation?: TransportationCatalog;
  playerFactory?: FieldContent["playerFactory"];
  treasureInventoryLimits?: FieldContent["treasureInventoryLimits"];
  systemMessageSource?: Evidence & { sourceSetHash: string; sha256: string };
  minimap?: FieldContent["minimap"];
  bgm?: FieldContent["bgm"];
  environment?: FieldContent["environment"];
  se?: FieldContent["se"];
  characterIssues: Record<string, ContentIssue[]>;
  characterImports?: Record<string, FieldAnimationImportObservation[]>;
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
