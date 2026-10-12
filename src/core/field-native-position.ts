import type { FieldCameraMapRange } from "./field-camera.js";
import { fieldCameraCellToWorld, fieldCameraWorldToCell } from "./field-camera.js";
import { checkpointInteger, checkpointKeys } from "./checkpoint-validation.js";
import { projectFieldPuppetActorEffects, type FieldPuppetHostProviders, type FieldPuppetHostSnapshot } from "./field-puppet-effects.js";

/** Absolute source SetPos (mode 0). Layer 0 preserves Z; 1..3 select the
 * source's three kLayerValues. Mode 1 needs a separately resolved entity. */
export type FieldNativePosition = {
  x: number; y: number; layer: 0 | 1 | 2 | 3; animation: string;
};

export function projectNativeFieldPosition(snapshot: FieldPuppetHostSnapshot,
  providers: FieldPuppetHostProviders, actorId: string, command: FieldNativePosition,
  map: FieldCameraMapRange, callback: "source-absent"): FieldPuppetHostSnapshot {
  checkpointKeys(command, "x,y,layer,animation");
  checkpointInteger(command.x, -0x80000000, 0x7fffffff);
  checkpointInteger(command.y, -0x80000000, 0x7fffffff);
  checkpointInteger(command.layer, 0, 3);
  if (typeof command.animation !== "string" || callback !== "source-absent")
    throw new Error("Unbound source actor SetPos callback or animation");
  // Use the shared actor validation and detached playback projection. Neither
  // position, layer, nor CueAnimation may partially reach the existing owner.
  let next = projectFieldPuppetActorEffects([], snapshot, providers);
  const target = next.actors.find((actor) => actor.id === actorId);
  if (!target?.character || target.riding || target.riderAssetId !== null ||
      !["absent", "idle"].includes(target.rideOnEntity))
    throw new Error("Source actor SetPos requires an ordinary character host");
  if (target.moving) throw new Error("Source actor SetPos during active movement is unresolved");
  const logicalLayer = command.layer === 0
    ? [349, 249, 149].indexOf(Math.trunc(Math.fround(target.position.z))) : command.layer - 1;
  if (logicalLayer < 0) throw new Error("Source actor SetPos cannot preserve this source Z layer");
  const current = fieldCameraWorldToCell(map, { x: target.position.x, y: target.position.y });
  // ConversionMapRangeCell performs Int32 subtraction before checking each
  // axis. A kept axis is floored by WorldPositionToCellPosition, not untouched.
  const x = (command.x - map.x) | 0, y = (command.y - map.y) | 0;
  target.position = fieldCameraCellToWorld(map,
    { x: x < 0 ? current.x : x, y: y < 0 ? current.y : y }, logicalLayer);
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
