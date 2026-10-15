import type { MapEntryViewPlan } from "./map-view.js";
import type { PartyActorContext } from "./party-actors.js";
import type { TransportationIdentity } from "./transportation.js";
import { checkpointKeys } from "./checkpoint-validation.js";
import { validateFieldTransportActorInstance, type FieldTransportActorPresentation } from "./field-transport-actors.js";

/** Web flat-map policy, not a claim about native world rendering or Search. */
export const WEB_RETAINED_WORLD_TRANSPORTATION = "web-retained-walking-magitek-world-entry-v1" as const;
export type WebRetainedWorldTransportation = typeof WEB_RETAINED_WORLD_TRANSPORTATION;
export type RetainedWorldTransportationEntry = {
  policy: WebRetainedWorldTransportation;
  /** Restore rebuilds trusted actor inventory, then the existing field codec
   * validates the saved actual state. It never replays MapSetup or boarding. */
  mode: "live-entry" | "source-reconstruction";
};

export function validateRetainedWorldTransportationPolicy(policy: unknown): asserts policy is WebRetainedWorldTransportation | undefined {
  if (policy !== undefined && policy !== WEB_RETAINED_WORLD_TRANSPORTATION)
    throw new Error("Unknown retained world transportation Web policy");
}

/** A narrow identity contract. Collision, source FootInfo, flags, PointIn and
 * actor media remain the responsibilities of their existing owners. */
export function assertRetainedWorldTransportation(input: {
  declaration?: RetainedWorldTransportationEntry;
  viewPlan?: MapEntryViewPlan;
  prior: NonNullable<PartyActorContext["currentTransport"]>;
  selected: TransportationIdentity;
}): void {
  const declaration = input.declaration;
  if (declaration !== undefined) {
    checkpointKeys(declaration, "policy,mode");
    validateRetainedWorldTransportationPolicy(declaration.policy);
    if (declaration.policy !== WEB_RETAINED_WORLD_TRANSPORTATION ||
        !["live-entry", "source-reconstruction"].includes(declaration.mode) || !input.viewPlan?.isWorld ||
        input.viewPlan.presentationPolicy !== "framework-world-map-flat-v1" || input.viewPlan.presentationViewType !== 0)
      throw new Error("Unbound retained world transportation Web policy");
  }
  if (!input.viewPlan?.isWorld) return;
  if (declaration === undefined) {
    if (input.selected.type !== 1 || input.prior.typeId !== 1)
      throw new Error("World map party entry requires ordinary walking transportation or explicit retained Web policy");
    return;
  }
  const selected = input.selected;
  if (!(selected.id === 1 && selected.type === 1 && selected.assetId === 0) &&
      !(selected.id === 6 && selected.type === 12 && selected.assetId === 38))
    throw new Error("Retained world transportation identity is not implemented");
  if (declaration.mode === "live-entry" &&
      (input.prior.id !== selected.id || input.prior.typeId !== selected.type || input.prior.fieldAssetId !== selected.assetId))
    throw new Error("Retained world transportation cannot silently select or disembark another identity");
}

/** Shared applicability check for the explicit flat-view composition. It
 * preserves the entry policy's source identity set instead of branching on a
 * map or reimplementing a literal transportation ID in the view controller. */
export function assertRetainedGroundViewTransportation(input:{
  policy:WebRetainedWorldTransportation|undefined;
  viewPlan:MapEntryViewPlan|undefined;
  presentation:FieldTransportActorPresentation|undefined;
  worldPresentation:"framework-world-map-flat-v1"|undefined;
  catalog:import("./party-actors.js").PartyActorCatalog;
  context:PartyActorContext;
  actual:{id:string;fieldAssetId:number|null;riderAssetId:number|null;riding:boolean;rideOnEntity:"absent"|"idle"|"riding"|"unknown"};
}):void {
  const current=input.context.currentTransport,player=input.context.player;
  if(input.policy!==WEB_RETAINED_WORLD_TRANSPORTATION||input.presentation!=="framework-development"||
    input.worldPresentation!=="framework-world-map-flat-v1"||!current||current.typeId!==12)
    throw new Error("Flat riding view requires the existing retained world transportation policy");
  const rows=input.catalog.transportations.filter(row=>row.id===current.id);
  if(rows.length!==1)throw new Error("Flat riding view has no unique source transportation identity");
  const row=rows[0]!;
  assertRetainedWorldTransportation({declaration:{policy:input.policy,mode:"live-entry"},
    ...(input.viewPlan?{viewPlan:input.viewPlan}:{}),prior:current,selected:{id:row.id,type:row.typeId,assetId:row.fieldAssetId}});
  validateFieldTransportActorInstance(input.catalog,player);
  if(!player.riding||player.fieldAssetId!==current.fieldAssetId||player.riderFieldAssetId===null||
    input.actual.id!==player.id||input.actual.fieldAssetId!==player.fieldAssetId||
    !input.actual.riding||input.actual.rideOnEntity!=="riding"||input.actual.riderAssetId!==player.riderFieldAssetId)
    throw new Error("Flat riding view must retain the actual existing inner/outer actor identities");
}
