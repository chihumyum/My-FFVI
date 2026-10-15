import type { Evidence } from "../field/types.js";

/** Deliberate presentation changes have their own content/save identity. */
export type DevelopmentOmission = {
  kind: "field-effect";
  mapId: number;
  group: string;
  entityId: string;
  source: Evidence;
  sourceMapContentHash: string;
  reason: string;
};
export type DevelopmentProfile = {
  kind: "framework-development-v1";
  policy: "omit-anonymous-environment-particles-v1";
  sourceContentHash: string;
  omissions: DevelopmentOmission[];
  /** Explicit gameplay integration variant. Source transportation identity,
   * parking and riding assets remain authoritative; native control, encounter,
   * audio and boarding presentation providers are not inferred from them. */
  transportation?: "walking-magitek-framework-v1";
  /** Source world geometry and gameplay with explicitly flat Web presentation. */
  worldMap?: "framework-world-map-flat-v1";
  /** Ordinary source maps with explicit static RGBA character/layer display.
   * This does not grant native group-material or water-shader acceptance. */
  fieldPresentation?: "framework-ordinary-field-flat-v1";
  skyboxPresentation?: import("./field-skybox.js").WebFlatSkybox;
  screenPresentation?: import("./field-screen-presentation.js").WebFieldScreenPresentation;
  worldAutoMove?: 'web-flat-world-auto-move-v1';
  worldAutoTasks?: 'web-flat-world-auto-tasks-v1';
  mapAnimatedEntities?: "web-field-animated-map-entities-v1";
  npcActivity?: "framework-npc-area-v1";
  npcProjection?: "web-source-npc-flat-projection-v1";
  /** Explicit Web counter-range observer; source observer diagnostics remain. */
  relayInteraction?: "framework-relay-interaction-v1";
  /** Source-bound, anonymous decorative boards keep their original diagnostics. */
  passiveEffects?: "framework-passive-field-effects-v1";
  /** Logical all-loop playback is owned; particle/material display is deferred. */
  logicalFieldEffects?: "web-logical-all-loop-field-effects-v1";
  fieldEffectProjection?: "web-source-field-effect-flat-v1";
  /** Shared source event controls on a declared Web clock and screen host. */
  storyRuntime?: "web-field-story-runtime-v1";
  autoSave?: "web-field-autosave-barrier-v1";
  /** Sprite-only elevation on actual native actors; logical ground pose is unchanged. */
  mobColorFilter?: import("./field-mob-controls.js").WebFlatMobColorFilter;
  birdViewActors?: "web-flat-bird-view-actors-v1";
};
/** Explicit current Web policies for newly authored framework derivatives. */
export const FRAMEWORK_STORY_RUNTIME_DECLARATIONS: Readonly<Required<Pick<DevelopmentProfile, "storyRuntime" | "autoSave">>> =
  Object.freeze({ storyRuntime: "web-field-story-runtime-v1", autoSave: "web-field-autosave-barrier-v1" });

export function frameworkWorldMapPresentation(profile: DevelopmentProfile | undefined): "framework-world-map-flat-v1" | undefined {
  return profile?.kind === "framework-development-v1" && profile.worldMap === "framework-world-map-flat-v1"
    ? profile.worldMap : undefined;
}

export function frameworkOrdinaryFieldPresentation(profile: DevelopmentProfile | undefined): "framework-ordinary-field-flat-v1" | undefined {
  return profile?.kind === "framework-development-v1" && profile.fieldPresentation === "framework-ordinary-field-flat-v1"
    ? profile.fieldPresentation : undefined;
}

export function frameworkTransportationPresentation(profile: DevelopmentProfile | undefined): "framework-development" | undefined {
  return profile?.kind === "framework-development-v1" &&
    profile.transportation === "walking-magitek-framework-v1" ? "framework-development" : undefined;
}

/** Published with every executed transportation command in the variant. The
 * exact-source lane must supply these providers before it can execute it. */
export const FRAMEWORK_TRANSPORTATION_LIMITATIONS = Object.freeze([
  "Native boarding, rider playback, feet clipping and landing/control UI are not reproduced.",
  "Vehicle speed, collision geometry and random-encounter table switching are not reproduced.",
  "Transportation BGM and transportation-triggered condition removal are not reproduced.",
  "SetVehicle parking is persisted; automatic driving GPS/map/timestamp writeback is not implemented.",
]);
