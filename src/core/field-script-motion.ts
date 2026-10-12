import type { Direction } from "../field/types.js";

/** Source puppet commands. Entity binding is resolved by the interpreter, not
 * by the decoder; camera dummy and field actors retain separate owners. */
export type FieldScriptMove = {
  kind: "move";
  direction: Direction;
  steps: number;
  speedId: number | null;
  animation: string;
};
export type FieldScriptLerp = {
  kind: "lerp";
  x: number;
  y: number;
  layer: 0 | 1 | 2 | 3;
  duration: number;
  arcHeight: number;
  animation: string;
};
export type FieldScriptMotion = FieldScriptMove | FieldScriptLerp;
export type FieldScriptMotionOp = { kind: "field-script-motion"; command: FieldScriptMotion };

import type { Point } from "../field/types.js";
import { ActorAnimation } from "./actor-animation.js";
import { checkpointInteger, checkpointKeys } from "./checkpoint-validation.js";
import { fieldCameraCellToWorld, type FieldCameraMapRange } from "./field-camera.js";
import { projectFieldPuppetActorEffects, type FieldPuppetHostProviders, type FieldPuppetHostSnapshot } from "./field-puppet-effects.js";

const delta: Record<Direction, Point> = {
  up: { x: 0, y: -1 }, right: { x: 1, y: 0 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 },
};
const speeds = [0.24, 0.48, 0.12, 0.96, 0.06, 1.92, 0.16] as const;
const layerZ: Record<number, number> = { 9: 349, 10: 249, 11: 149 };
const f = Math.fround;
function finite(value: number): void {
  if (!Number.isFinite(value) || !Number.isFinite(f(value))) throw new Error("Invalid script motion coordinate or time");
}
function point(value: Point): void { finite(value.x); finite(value.y); }

/** SearchSimple's non-wrapping four-direction route. This intentionally does
 * not ask the exploration collision/trigger engine for another path. The
 * caller must independently admit the native MoveTo raycast context. */
export function prepareFieldScriptMove(command: FieldScriptMove, from: Point, context: {
  loop: { horizontal: boolean; vertical: boolean }; magnification: number;
}): { points: Point[]; secondsPerCell: number; animationSecondsPerCell: number } {
  checkpointKeys(command, "kind,direction,steps,speedId,animation");
  if (command.kind !== "move" || !Object.hasOwn(delta, command.direction) || typeof command.animation !== "string")
    throw new Error("Invalid source Move command");
  checkpointInteger(command.steps, 0, 4096);
  if (command.speedId !== null) checkpointInteger(command.speedId, 0, speeds.length - 1);
  point(from);
  if (!context || context.loop?.horizontal !== false || context.loop?.vertical !== false)
    throw new Error("Source Move wrap route provider is unavailable");
  finite(context.magnification);
  if (context.magnification <= 0) throw new Error("Source Move magnification provider is unavailable");
  const duration = speeds[command.speedId ?? 0]!;
  const secondsPerCell = duration / context.magnification;
  finite(secondsPerCell);
  const d = delta[command.direction], start = { x: Math.floor(from.x), y: Math.floor(from.y) };
  const points = Array.from({ length: command.steps }, (_, i) => ({ x: start.x + d.x * (i + 1), y: start.y + d.y * (i + 1) }));
  points.forEach(point);
  return { points, secondsPerCell, animationSecondsPerCell: duration };
}

/** Route is part of the existing Actor.motion owner, so resetting an
 * interpreter task cannot discard a FieldEntity's already started route. */
export type FieldScriptRoute = {
  points: Point[]; index: number; pendingSegment: boolean;
  direction: Direction; animation: string; animationSecondsPerCell: number;
};
export type FieldActorMotion = {
  from: Point; to: Point; elapsed: number; duration: number; manual: boolean;
  route?: FieldScriptRoute;
};

/** Prepare one existing actor update without touching position, elapsed, or
 * playback. A host settles its owned completion before publishing this result. */
export function prepareFieldActorMotionTick(motion: Readonly<FieldActorMotion>, animation: ActorAnimation | null,
  milliseconds: number): { motion: FieldActorMotion | null; animation: ActorAnimation | null;
    point: Point; completedSegment: boolean; completedRoute: boolean } {
  point(motion.from); point(motion.to); finite(motion.elapsed); finite(motion.duration); finite(milliseconds);
  if (motion.duration <= 0 || motion.elapsed < 0 || milliseconds < 0 || typeof motion.manual !== "boolean")
    throw new Error("Invalid field actor motion state");
  const next: FieldActorMotion = structuredClone(motion), playback = animation?.clone() ?? null;
  playback?.advance(milliseconds);
  if (next.route?.pendingSegment) {
    const route = next.route, destination = route.points[route.index + 1];
    if (!destination) {
      if (route.index !== route.points.length - 1) throw new Error("Missing next source Move waypoint");
      playback?.stop(); playback?.frame();
      return { motion: null, animation: playback, point: { ...next.to }, completedSegment: false, completedRoute: true };
    }
    route.index++; route.pendingSegment = false;
    next.from = { ...next.to }; next.to = { ...destination }; next.elapsed = 0;
    playback?.move(route.direction, route.animationSecondsPerCell, route.animation || undefined);
    playback?.frame();
    // FieldEntity.Update starts the next segment on this update and does not
    // also integrate it. The next logical entity update advances its timer.
    return { motion: next, animation: playback, point: { ...next.from }, completedSegment: false, completedRoute: false };
  }
  next.elapsed += milliseconds;
  const ratio = Math.min(1, next.elapsed / next.duration);
  const position = { x: next.from.x + (next.to.x - next.from.x) * ratio,
    y: next.from.y + (next.to.y - next.from.y) * ratio };
  point(position);
  playback?.linkToMovement(ratio);
  const completedSegment = next.elapsed >= next.duration;
  // movementPositionList still contains the just-reached point. The following
  // entity update removes it, including the final point, before IsMoving ends.
  const queued = completedSegment && !!next.route;
  if (queued) next.route!.pendingSegment = true;
  if (completedSegment && !queued) playback?.stop();
  playback?.frame();
  return { motion: completedSegment && !queued ? null : next, animation: playback,
    point: position, completedSegment, completedRoute: completedSegment && !queued };
}

/** PuppetCore instruction registers only. The actor's position remains on its
 * native entity; these registers are not a second live transform. */
export type FieldScriptLerpProgress = {
  start: Point; startedAt: number; startLayer: number; targetLayer: number; movingLayer: number;
};
export function projectFieldScriptLerp(snapshot: FieldPuppetHostSnapshot, providers: FieldPuppetHostProviders,
  actorId: string, command: FieldScriptLerp, map: FieldCameraMapRange,
  progress: FieldScriptLerpProgress | null, timeSeconds: number): {
    snapshot: FieldPuppetHostSnapshot; progress: FieldScriptLerpProgress; flow: "next" | "wait";
  } {
  checkpointKeys(command, "kind,x,y,layer,duration,arcHeight,animation");
  if (command.kind !== "lerp" || typeof command.animation !== "string") throw new Error("Invalid source Lerp command");
  checkpointInteger(command.x, -0x80000000, 0x7fffffff); checkpointInteger(command.y, -0x80000000, 0x7fffffff);
  checkpointInteger(command.layer, 0, 3); finite(command.duration); finite(command.arcHeight); finite(timeSeconds);
  if (command.duration < 0 || timeSeconds < 0) throw new Error("Negative source Lerp duration is not admitted");
  if (command.arcHeight !== 0) throw new Error("Sprite Lerp arc requires the source animation-offset owner");
  let next = projectFieldPuppetActorEffects([], snapshot, providers);
  const actor = next.actors.find((a) => a.id === actorId);
  if (!actor?.character || actor.riding || actor.riderAssetId !== null || !["absent", "idle"].includes(actor.rideOnEntity))
    throw new Error("Source Lerp requires an ordinary native actor");
  if (actor.moving) throw new Error("Source Lerp conflicts with active actor movement");
  let registers: FieldScriptLerpProgress;
  if (progress === null) {
    const sourceLayer = Object.entries(layerZ).find(([, z]) => z === Math.trunc(actor.position.z))?.[0];
    if (!sourceLayer) throw new Error("Source Lerp cannot preserve this source Z layer");
    const startLayer = Number(sourceLayer), targetLayer = command.layer === 0 ? startLayer : command.layer + 8;
    registers = { start: { x: actor.position.x, y: actor.position.y }, startedAt: timeSeconds,
      startLayer, targetLayer, movingLayer: Math.max(startLayer, targetLayer) };
    if (command.animation !== "") {
      if (!actor.animation) throw new Error("Source Lerp animation media is unavailable");
      if (command.duration === 0) actor.animation.cue(command.animation, -1);
      else actor.animation.playEntity(command.animation, true);
      actor.animation.frame();
    }
  } else {
    checkpointKeys(progress, "start,startedAt,startLayer,targetLayer,movingLayer");
    point(progress.start); finite(progress.startedAt);
    if (![progress.startLayer, progress.targetLayer, progress.movingLayer].every((layer) => Object.hasOwn(layerZ, layer)) ||
        progress.targetLayer !== (command.layer === 0 ? progress.startLayer : command.layer + 8) ||
        progress.movingLayer !== Math.max(progress.startLayer, progress.targetLayer))
      throw new Error("Invalid source Lerp instruction registers");
    registers = structuredClone(progress);
  }
  if (timeSeconds < registers.startedAt) throw new Error("Source Lerp clock precedes its first execution");
  const ratio = command.duration === 0 ? 1 : Math.min(1, (timeSeconds - registers.startedAt) / command.duration);
  const destination = fieldCameraCellToWorld(map, { x: (command.x - map.x) | 0, y: (command.y - map.y) | 0 }, 0);
  actor.position = { x: f(registers.start.x + (destination.x - registers.start.x) * ratio),
    y: f(registers.start.y + (destination.y - registers.start.y) * ratio),
    z: layerZ[ratio === 1 ? registers.targetLayer : registers.movingLayer]! - (ratio === 1 ? 0 : 5) };
  const changeLayer = progress === null && registers.startLayer < registers.targetLayer ||
    ratio === 1 && registers.targetLayer < registers.startLayer;
  if (changeLayer) {
    actor.layer = registers.targetLayer;
    next = projectFieldPuppetActorEffects([
      { kind: "apply-view-properties", actor: actorId }, { kind: "attach-transparent", actor: actorId },
    ], next, providers);
  }
  return { snapshot: next, progress: registers, flow: ratio === 1 ? "next" : "wait" };
}
