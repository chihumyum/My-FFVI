import { checkpointInteger, checkpointKeys } from "./checkpoint-validation.js";
import type { FieldContent } from "../field/types.js";
import type { FieldScriptMove } from "./field-script-motion.js";

/** Deliberate Web sprite elevation on the existing field actor. This creates
 * no Unity BirdViewController, camera transform or extra movement owner. */
export const WEB_FLAT_BIRD_VIEW_ACTORS = "web-flat-bird-view-actors-v1" as const;
export type WebFlatBirdViewActors = typeof WEB_FLAT_BIRD_VIEW_ACTORS;
export function validateBirdViewActorsPolicy(value: unknown): asserts value is WebFlatBirdViewActors | undefined {
  if (value !== undefined && value !== WEB_FLAT_BIRD_VIEW_ACTORS) throw new Error("Unknown Web BirdView actor policy");
}
/** The recipe proof and actual FieldGame share this exact trusted map binding.
 * It grants no actor instance, movement provider or checkpoint from a marker. */
export function fieldBirdViewActorBinding(content: FieldContent, policy: WebFlatBirdViewActors | undefined):
  { mapId: number; contentHash: string } | undefined {
  validateBirdViewActorsPolicy(policy); validateBirdViewActorsPolicy(content.developmentProfile?.birdViewActors);
  if (policy === undefined || content.developmentProfile?.birdViewActors !== WEB_FLAT_BIRD_VIEW_ACTORS) return undefined;
  if (content.developmentProfile.kind !== "framework-development-v1" || !content.cameraHost || !content.map.identity ||
      !Number.isSafeInteger(content.map.identity.mapId) || content.map.identity.mapId <= 0 || !/^[0-9a-f]{64}$/.test(content.contentHash) ||
      content.entry.viewPlan && content.entry.viewPlan.mapId !== content.map.identity.mapId)
    throw new Error("BirdView actors require trusted current content and its actual map/camera binding");
  return { mapId: content.map.identity.mapId, contentHash: content.contentHash };
}
export type FieldBirdViewMoveCommand = {
  kind: "move-bird-view"; heightRatio: number; duration: number; move: FieldScriptMove | null;
};
export type FieldBirdViewMoveOp = { kind: "field-bird-view-move"; command: FieldBirdViewMoveCommand };
export type FieldBirdViewProgress = { start: number; target: number; startedAt: number };
/** Missing is unknown. Only a separately proved absent accessor uses zero and
 * discards writes. The Web host explicitly creates a present actor component. */
export type FieldBirdViewAccessor = { kind: "present"; height: number } | { kind: "absent" };
export type FieldBirdViewActorPose = {
  kind: "web-flat-bird-view-actor-pose-v1"; mapId: number; contentHash: string; actorId: string; height: number;
};
export type FieldBirdViewActorCheckpoint = {
  kind: "field-bird-view-actor-poses-v1"; poses: { actorId: string; height: number }[];
};
const f = Math.fround;
function number(value: number): void {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Invalid BirdView actor number");
}
function height(value: number): void {
  number(value);
  if (f(value) !== value || value < 0 || value > 240) throw new Error("Invalid Web BirdView actor elevation");
}
function validateCommand(command: FieldBirdViewMoveCommand): void {
  checkpointKeys(command, "kind,heightRatio,duration,move");
  if (command.kind !== "move-bird-view") throw new Error("Invalid MoveBirdView command");
  number(command.heightRatio); number(command.duration);
  if (command.duration < 0) throw new Error("Negative MoveBirdView duration");
  if (command.move !== null) {
    checkpointKeys(command.move, "kind,direction,steps,speedId,animation");
    if (command.move.kind !== "move" || !["up", "right", "down", "left"].includes(command.move.direction) ||
        typeof command.move.animation !== "string") throw new Error("Invalid delegated MoveBirdView movement");
    checkpointInteger(command.move.steps, 1, 4096);
    if (command.move.speedId !== null) checkpointInteger(command.move.speedId, 0, 6);
  }
}
function accessor(value: FieldBirdViewAccessor | undefined): number {
  if (!value) throw new Error("Unknown BirdView actor accessor presence");
  if (value.kind === "absent") { checkpointKeys(value, "kind"); return 0; }
  checkpointKeys(value, "kind,height");
  if (value.kind !== "present") throw new Error("Unknown BirdView actor accessor presence");
  height(value.height); return value.height;
}
export function prepareFieldBirdViewMove(command: FieldBirdViewMoveCommand,
  current: FieldBirdViewAccessor | undefined, timeSeconds: number): FieldBirdViewProgress {
  validateCommand(command); number(timeSeconds);
  if (timeSeconds < 0) throw new Error("Invalid BirdView actor clock");
  const start = accessor(current), ratio = Math.max(-1, Math.min(3, f(command.heightRatio)));
  return { start, target: f(f(ratio * 60) + 60), startedAt: timeSeconds };
}
/** The first instruction clock only captures registers and delegates Move.
 * Call this on later clocks; movement and height completion are both required. */
export function projectFieldBirdViewMove(command: FieldBirdViewMoveCommand, progress: FieldBirdViewProgress,
  current: FieldBirdViewAccessor | undefined, timeSeconds: number, moving: boolean): {
    height: number | null; ratio: number; flow: "wait" | "next";
  } {
  validateCommand(command); accessor(current); checkpointKeys(progress, "start,target,startedAt");
  height(progress.start); height(progress.target); number(progress.startedAt); number(timeSeconds);
  if (progress.startedAt < 0 || timeSeconds < progress.startedAt || typeof moving !== "boolean") throw new Error("Invalid BirdView actor progress clock");
  const expected = prepareFieldBirdViewMove(command, { kind: "present", height: progress.start }, progress.startedAt);
  if (expected.target !== progress.target) throw new Error("MoveBirdView target does not match its original command");
  const ratio = command.duration === 0 ? 1 : Math.max(0, Math.min(1, f((timeSeconds - progress.startedAt) / command.duration)));
  const value = f(progress.target * ratio + (1 - ratio) * progress.start); height(value);
  return { height: current!.kind === "present" ? value : null, ratio, flow: !moving && ratio >= 1 ? "next" : "wait" };
}
export function createFieldBirdViewActorPose(binding: { mapId: number; contentHash: string; actorId: string }, value = 0): FieldBirdViewActorPose {
  const pose: FieldBirdViewActorPose = { kind: "web-flat-bird-view-actor-pose-v1", ...binding, height: value };
  return parseFieldBirdViewActorPose(pose, binding);
}
export function parseFieldBirdViewActorPose(pose: FieldBirdViewActorPose,
  binding: { mapId: number; contentHash: string; actorId: string }): FieldBirdViewActorPose {
  checkpointKeys(pose, "kind,mapId,contentHash,actorId,height"); checkpointInteger(pose.mapId, 1);
  if (pose.kind !== "web-flat-bird-view-actor-pose-v1" || !/^[0-9a-f]{64}$/.test(pose.contentHash) ||
      typeof pose.actorId !== "string" || !pose.actorId || pose.mapId !== binding.mapId || pose.contentHash !== binding.contentHash || pose.actorId !== binding.actorId)
    throw new Error("BirdView actor pose belongs to another content or actor owner");
  height(pose.height); return { ...pose };
}
export function parseFieldBirdViewActorCheckpoint(raw: FieldBirdViewActorCheckpoint): FieldBirdViewActorCheckpoint {
  checkpointKeys(raw, "kind,poses");
  if (raw.kind !== "field-bird-view-actor-poses-v1" || !Array.isArray(raw.poses) ||
      Reflect.ownKeys(raw.poses).length !== raw.poses.length + 1) throw new Error("Invalid BirdView actor checkpoint");
  const seen = new Set<string>();
  return { kind: raw.kind, poses: raw.poses.map(pose => {
    checkpointKeys(pose, "actorId,height");
    if (typeof pose.actorId !== "string" || !pose.actorId || seen.has(pose.actorId)) throw new Error("Invalid BirdView actor checkpoint identity");
    seen.add(pose.actorId); height(pose.height); return { ...pose };
  }) };
}
