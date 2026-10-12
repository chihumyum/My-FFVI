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
};

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
