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
};
