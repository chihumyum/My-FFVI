import type { FieldPuppetHostActor } from "./field-puppet-effects.js";
import type { FieldTransportActorPresentation } from "./field-transport-actors.js";

/** Placement and scripted movement keep the existing outer animation owner.
 * An inactive rider cache is valid source state, not active riding. The dual
 * layer renderer is admitted only by the trusted framework profile. */
export function requireFieldTransportPose(actor: FieldPuppetHostActor | undefined,
  presentation?: FieldTransportActorPresentation): asserts actor is FieldPuppetHostActor {
  if (!actor?.character || actor.rideOnEntity === "unknown" ||
      actor.riding !== (actor.rideOnEntity === "riding") ||
      actor.rideOnEntity === "absent" && actor.riderAssetId !== null ||
      actor.riding && (actor.riderAssetId === null || presentation !== "framework-development"))
    throw new Error("Source actor pose requires a bound character/riding host");
}
