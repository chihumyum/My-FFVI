/** Explicit Web rules for a source default monster set. Neither the step
 * thresholds nor using source rates as weights claim native encounter rules. */
export type SourceWalkPolicyDeclaration = {
  kind: "framework-source-set-walk-v1";
  id: string;
  minSteps: number;
  maxSteps: number;
  transportationIds: number[];
  weighting: "source-rate-as-web-weight-v1";
};

/** Content evidence only. The session's existing walk scheduler owns all
 * counters and RNG; this binding never grants source or live-party admission. */
export type SourceWalkPolicyBinding = {
  kind: "framework-source-set-walk-binding-v1";
  mapId: number;
  monsterSetId: number;
  sourceMetadataHash: string;
  battleCatalogHash: string;
  declaration: SourceWalkPolicyDeclaration;
  policyHash: string;
};
