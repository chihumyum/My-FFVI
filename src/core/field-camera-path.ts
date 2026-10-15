import type { Point } from "../field/types.js";
import { canonical } from "./canonical.js";
import { checkpointInteger, checkpointKeys } from "./checkpoint-validation.js";
import { fieldCameraCellToWorld, fieldCameraWorldToCell, validateFieldCameraState,
  type FieldCameraMapRange, type FieldCameraState } from "./field-camera.js";
import { prepareFieldActorMotionTick, prepareFieldScriptMove, resolveFieldScriptMoveToTarget,
  type FieldActorMotion, type FieldScriptMove, type FieldScriptMoveTo } from "./field-script-motion.js";

export type FieldCameraPathCommand = FieldScriptMove | FieldScriptMoveTo;
export type FieldCameraPathContext = {
  mapRange: FieldCameraMapRange;
  loop: { horizontal: boolean; vertical: boolean };
  magnification: number;
  view: "normal-field" | "bird" | "unknown";
  callbacks: "source-absent" | "unknown";
  raycast: "disabled" | "active" | "unknown";
  /** Resolved by the existing source entity selector owner, never by this route. */
  targetEntity?: { x: number; y: number; z: number };
};
/** Frozen route and elapsed instruction registers. The only authoritative
 * current transform remains FieldCameraHost.state.dummy.position. */
export type FieldCameraPathProgress = {
  kind: "field-camera-path-v1";
  command: FieldCameraPathCommand;
  mapRange: FieldCameraMapRange;
  move: FieldScriptMove | null;
  fromCell: Point;
  startWorld: Point;
  sourceZ: number;
  lastClockMs: number;
  motion: FieldActorMotion | null;
  complete: boolean;
};
export type FieldCameraPathPrepared = {
  state: FieldCameraState;
  progress: FieldCameraPathProgress;
  flow: "next" | "wait";
  completedSegment: boolean;
  completedRoute: boolean;
};
const f = Math.fround;
const zs = [349, 249, 149] as const;
function point(value: Point): void {
  checkpointKeys(value, "x,y");
  if (![value.x, value.y].every(number => Number.isFinite(number) && Number.isFinite(f(number))))
    throw new Error("Invalid source camera route point");
}
function context(value: FieldCameraPathContext): void {
  if (!value || value.view !== "normal-field") throw new Error("Camera route bird/unknown view provider is unavailable");
  if (value.callbacks !== "source-absent") throw new Error("Camera route native callback disposition is unknown");
  if (value.raycast !== "disabled") throw new Error("Camera route requires an admitted absent raycast context");
  if (value.loop?.horizontal !== false || value.loop?.vertical !== false)
    throw new Error("Camera route loop/wrap provider is unavailable");
  if (value.magnification !== 1) throw new Error("Camera route magnification provider is unavailable");
  checkpointKeys(value.mapRange, "x,y,width,height");
  checkpointInteger(value.mapRange.x, -0x80000000, 0x7fffffff);
  checkpointInteger(value.mapRange.y, -0x80000000, 0x7fffffff);
  checkpointInteger(value.mapRange.width, 1, 0x7fffffff);
  checkpointInteger(value.mapRange.height, 1, 0x7fffffff);
}
function waypoints(registers: FieldCameraPathProgress, input: FieldCameraPathContext): {
  points: Point[]; secondsPerCell: number; animationSecondsPerCell: number;
} {
  if (registers.move === null) return { points: [], secondsPerCell: 0, animationSecondsPerCell: 0 };
  const plan = prepareFieldScriptMove(registers.move, registers.fromCell, input);
  return { ...plan, points: plan.points.map(cell => {
    const world = fieldCameraCellToWorld(input.mapRange, {
      x: (cell.x - input.mapRange.x) | 0, y: (cell.y - input.mapRange.y) | 0,
    }, 0);
    return { x: world.x, y: world.y };
  }) };
}
function sample(motion: FieldActorMotion): Point {
  const ratio = Math.min(1, motion.elapsed / motion.duration);
  return { x: f(motion.from.x + (motion.to.x - motion.from.x) * ratio),
    y: f(motion.from.y + (motion.to.y - motion.from.y) * ratio) };
}
function progress(value: FieldCameraPathProgress, command: FieldCameraPathCommand,
  input: FieldCameraPathContext): void {
  checkpointKeys(value, "kind,command,mapRange,move,fromCell,startWorld,sourceZ,lastClockMs,motion,complete");
  if (value.kind !== "field-camera-path-v1" || canonical(value.command) !== canonical(command) ||
      canonical(value.mapRange) !== canonical(input.mapRange) || typeof value.complete !== "boolean")
    throw new Error("Camera route command/map registers changed");
  point(value.fromCell); point(value.startWorld); checkpointInteger(value.lastClockMs, 0);
  if (!zs.includes(value.sourceZ as typeof zs[number])) throw new Error("Camera route source Z provider is unavailable");
  const plan = waypoints(value, input), motion = value.motion;
  if (motion !== null) {
    checkpointKeys(motion, "from,to,elapsed,duration,manual,route");
    if (value.complete || !motion.route || motion.manual !== false || !Number.isFinite(motion.elapsed) || motion.elapsed < 0 ||
        motion.duration !== plan.secondsPerCell * 1000 || motion.duration <= 0)
      throw new Error("Invalid camera route movement registers");
    checkpointKeys(motion.route, "points,index,pendingSegment,direction,animation,animationSecondsPerCell");
    const route = motion.route;
    checkpointInteger(route.index, 0, plan.points.length - 1);
    if (canonical(route.points) !== canonical(plan.points) || route.direction !== value.move!.direction ||
        route.animation !== "" || route.animationSecondsPerCell !== plan.animationSecondsPerCell ||
        typeof route.pendingSegment !== "boolean" || route.pendingSegment !== (motion.elapsed >= motion.duration) ||
        canonical(motion.to) !== canonical(plan.points[route.index]) ||
        canonical(motion.from) !== canonical(route.index === 0 ? value.startWorld : plan.points[route.index - 1]))
      throw new Error("Camera route waypoints or segment registers changed");
  } else if (!value.complete && plan.points.length > 0)
    throw new Error("Camera route lost its unfinished movement registers");
}

/** One ordinary camera-dummy Move/MoveTo clock. The caller prepares/publishes
 * this candidate through the existing CameraHost transaction, and stores only
 * progress on its existing task cursor. No position or animation owner is added.
 * A segment is drained on a later clock, matching the existing actor route;
 * excess delta never fast-forwards several native movement-list entries. */
export function prepareFieldCameraPathStep(state: FieldCameraState, command: FieldCameraPathCommand,
  input: FieldCameraPathContext, prior: FieldCameraPathProgress | null,
  clockMs: number): FieldCameraPathPrepared {
  validateFieldCameraState(state); context(input); checkpointInteger(clockMs, 0);
  if (command.kind !== "move" && command.kind !== "move-to") throw new Error("Unsupported camera path command");
  if (command.animation !== "") throw new Error("Camera route animation provider is unavailable");
  const candidate = structuredClone(state);
  if (prior === null) {
    const sourceZ = state.dummy.position.z;
    if (!zs.includes(sourceZ as typeof zs[number])) throw new Error("Camera route cannot preserve this source Z layer");
    const local = fieldCameraWorldToCell(input.mapRange, {
      x: state.dummy.position.x, y: state.dummy.position.y,
    });
    const fromCell = { x: local.x + input.mapRange.x, y: local.y + input.mapRange.y };
    let move: FieldScriptMove | null;
    if (command.kind === "move") move = structuredClone(command);
    else {
      if (command.target.kind === "direct" && command.target.layer !== 0)
        throw new Error("Camera MoveTo layer-change provider is unavailable");
      const target = resolveFieldScriptMoveToTarget(command, input.mapRange, state.dummy.position, input.targetEntity);
      if (target === null) move = null; // Native nullable-empty skips without a first-clock Wait.
      else {
        if (target.logicalLayer !== zs.indexOf(sourceZ as typeof zs[number]))
          throw new Error("Camera MoveTo target source layer differs from its dummy owner");
        const distance = target.point[command.axis] - fromCell[command.axis];
        if (distance === 0) throw new Error("Camera MoveTo empty SearchSimple warning provider is unavailable");
        move = { kind: "move", direction: command.axis === "x" ? distance > 0 ? "right" : "left"
          : distance > 0 ? "down" : "up", steps: Math.abs(distance),
          speedId: command.speedId, animation: "" };
      }
    }
    const registers: FieldCameraPathProgress = { kind: "field-camera-path-v1", command: structuredClone(command),
      mapRange: structuredClone(input.mapRange), move, fromCell,
      startWorld: { x: state.dummy.position.x, y: state.dummy.position.y }, sourceZ,
      lastClockMs: clockMs, motion: null, complete: move === null };
    const plan = waypoints(registers, input);
    if (plan.points.length) {
      registers.motion = { from: { ...registers.startWorld }, to: { ...plan.points[0]! },
        duration: plan.secondsPerCell * 1000, elapsed: 0, manual: false,
        route: { points: plan.points, index: 0, pendingSegment: false,
          direction: move!.direction, animation: "", animationSecondsPerCell: plan.animationSecondsPerCell } };
      candidate.dummy.direction = move!.direction;
    }
    progress(registers, command, input);
    return { state: candidate, progress: registers, flow: registers.complete ? "next" : "wait",
      completedSegment: false, completedRoute: registers.complete };
  }
  progress(prior, command, input);
  if (clockMs < prior.lastClockMs) throw new Error("Camera route logical clock precedes its previous step");
  if (prior.complete) return { state: candidate, progress: structuredClone(prior), flow: "next",
    completedSegment: false, completedRoute: false };
  if (state.dummy.position.z !== prior.sourceZ)
    throw new Error("Camera route source Z changed during its movement");
  const expected = prior.motion ? sample(prior.motion) : prior.startWorld;
  if (state.dummy.position.x !== expected.x || state.dummy.position.y !== expected.y)
    throw new Error("Camera route dummy transform changed outside its task");
  if (prior.motion && state.dummy.direction !== prior.move!.direction)
    throw new Error("Camera route dummy direction changed outside its task");
  const registers = structuredClone(prior), dt = clockMs - prior.lastClockMs;
  if (dt === 0) return { state: candidate, progress: registers, flow: "wait",
    completedSegment: false, completedRoute: false };
  registers.lastClockMs = clockMs;
  if (registers.motion === null) {
    // Move(steps=0) still waited on its first instruction clock.
    registers.complete = true;
    return { state: candidate, progress: registers, flow: "next", completedSegment: false, completedRoute: true };
  }
  const tick = prepareFieldActorMotionTick(registers.motion, null, dt);
  registers.motion = tick.motion;
  registers.complete = tick.completedRoute;
  candidate.dummy.position = { x: f(tick.point.x), y: f(tick.point.y), z: prior.sourceZ };
  // Move preserves the exact source Z; it is not camera Lerp's transient z-5.
  progress(registers, command, input); validateFieldCameraState(candidate);
  return { state: candidate, progress: registers, flow: registers.complete ? "next" : "wait",
    completedSegment: tick.completedSegment, completedRoute: tick.completedRoute };
}
