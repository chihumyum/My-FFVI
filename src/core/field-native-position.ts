import type { FieldCameraMapRange } from "./field-camera.js";
import { fieldSetPositionToWorld } from "./field-camera.js";
import { checkpointInteger, checkpointKeys } from "./checkpoint-validation.js";
import { requireFieldTransportPose } from "./field-transport-pose.js";
import { projectFieldPuppetActorEffects, type FieldPuppetHostProviders, type FieldPuppetHostSnapshot } from "./field-puppet-effects.js";

/** Mode 0 retains its original four-field shape for existing content/saves.
 * Mode 1's source selector is distinct from the resolved native instance key. */
export type FieldNativePosition = {
  x: number; y: number; layer: 0 | 1 | 2 | 3; animation: string;
  mode?: never; referenceEntityId?: never;
} | {
  mode: 1; referenceEntityId: number;
  x: number; y: number; layer: 0 | 1 | 2 | 3; animation: string;
};

export function projectNativeFieldPosition(snapshot: FieldPuppetHostSnapshot,
  providers: FieldPuppetHostProviders, actorId: string, command: FieldNativePosition,
  map: FieldCameraMapRange, callback: "source-absent",
  referenceActorId?: string | null): FieldPuppetHostSnapshot {
  checkpointKeys(command, command.mode === 1 ? "mode,referenceEntityId,x,y,layer,animation" : "x,y,layer,animation");
  checkpointInteger(command.x, -0x80000000, 0x7fffffff);
  checkpointInteger(command.y, -0x80000000, 0x7fffffff);
  checkpointInteger(command.layer, 0, 3);
  if (typeof command.animation !== "string" || callback !== "source-absent")
    throw new Error("Unbound source actor SetPos callback or animation");
  if (command.mode === 1) {
    checkpointInteger(command.referenceEntityId, -0x80000000, 0x7fffffff);
    if (typeof referenceActorId !== "string" || referenceActorId.length === 0)
      throw new Error("Source relative SetPos reference entity is absent or unresolved");
  } else if (referenceActorId !== undefined) {
    throw new Error("Absolute source SetPos cannot consume a relative reference binding");
  }
  // Use the shared actor validation and detached playback projection. Neither
  // position, layer, nor CueAnimation may partially reach the existing owner.
  let next = projectFieldPuppetActorEffects([], snapshot, providers);
  const target = next.actors.find((actor) => actor.id === actorId);
  requireFieldTransportPose(target, providers.transportationPresentation);
  if (target.moving) throw new Error("Source actor SetPos during active movement is unresolved");
  let referencePosition;
  if (command.mode === 1) {
    // Puppet.SetPos resolves i4 with GetEntity, floors that entity's world
    // position to map-local cells, then adds the two Int32 offsets as floats.
    // It does not subtract mapRange again or use mode 0's negative sentinel.
    const reference = next.actors.find((actor) => actor.id === referenceActorId)
      ?? (next.camera?.id === referenceActorId ? next.camera : null);
    if (!reference) throw new Error("Source relative SetPos reference entity is absent or unresolved");
    referencePosition = reference.position;
  }
  // MoveEntityLayerWithWorldPosition uses the destination actor's current Z,
  // even when the relative reference is on another layer.
  target.position = fieldSetPositionToWorld(map, target.position, command, referencePosition);
  if (![target.position.x, target.position.y, target.position.z].every(Number.isFinite))
    throw new Error("Source actor SetPos coordinate overflow");
  if (command.layer !== 0) {
    target.layer = command.layer + 8;
    next = projectFieldPuppetActorEffects([
      { kind: "apply-view-properties", actor: actorId },
      { kind: "attach-transparent", actor: actorId },
    ], next, providers);
  }
  const positioned = next.actors.find((actor) => actor.id === actorId)!;
  if (command.animation !== "") {
    if (!positioned.animation) throw new Error("Source actor SetPos animation media is unavailable");
    positioned.animation.cue(command.animation, -1);
  }
  // Native SetPos neither calls Show nor resets FieldEntity movement/Init.
  return next;
}
