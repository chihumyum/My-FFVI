import { parseFieldDynamicView, type FieldDynamicView } from './field-view-change.js';
import { parseWorldAutoPose, type WorldAutoPose } from './field-world-auto-tasks.js';
import type { Direction, Point } from "../field/types.js";
import { checkpointInteger, checkpointKeys } from "./checkpoint-validation.js";

export type FieldCameraPoint = Point & { z: number };
/** Native Transform.position and GetEntityPosition are distinct. All coordinates
 * are source world pixels (Y up), before browser/map-cell conversion. */
export type FieldCameraActor = {
  position: FieldCameraPoint;
  entityPosition: Point;
  layer: number;
  /** MapUtility.GetOnLayerZOrderByLayer, supplied by the layer provider. */
  layerZ: number;
  direction: Direction;
};
type FieldCameraBase = {
  target: "player" | "dummy" | null;
  /** The source dummy has no sprite, collider or ordinary field actor identity. */
  dummy: {
    position: FieldCameraPoint;
    entityOffset: Point;
    layer: number;
    /** null is its fresh constructor's zero direction, before entity Init. */
    direction: Direction | null;
    /** Native entity state, even though this dummy has no sprite. null retains
     * an unobserved GameObject activeSelf until source Show/Hide sets it. */
    visibility: {
      activeSelf: boolean | null;
      fadeAlpha: 0 | 1;
      /** Only constructor/zero-duration Show/Hide are admitted. */
      currentFadeStatus: 0;
    };
  };
};
export type FieldCameraState = FieldCameraBase & ({kind:"field-camera-v2"}|{kind:"field-camera-v3";view:FieldDynamicView}|
  {kind:"field-camera-v4";view:FieldDynamicView|null;worldAuto:WorldAutoPose});
export function fieldCameraView(state: FieldCameraState): FieldDynamicView | null {
  return state.kind === 'field-camera-v2' ? null : state.view;
}
export type FieldCameraCommand = { target: "player" | "dummy" };
export type FieldCameraOp = { kind: "field-camera"; command: FieldCameraCommand };
export type FieldCameraPlan = {
  state: FieldCameraState;
  /** ChangeCameraTarget(dummy) calls FieldEntity.Init; its host must reset the
   * dummy's movement start/destination/timer/autoMove with this new position. */
  resetDummyMovement: boolean;
  /** Native invokes this target's existing MoveCallback, not MoveFinished. */
  notifyMove: "player" | "dummy";
  refresh: true;
};
const f = Math.fround;
const directions = ["up", "right", "down", "left"];
function number(value: number): void {
  if (!Number.isFinite(value) || !Number.isFinite(f(value)))
    throw new Error("Invalid field camera source number");
}
function point(value: Point): void {
  checkpointKeys(value, "x,y"); number(value.x); number(value.y);
}
function position(value: FieldCameraPoint): void {
  checkpointKeys(value, "x,y,z"); number(value.x); number(value.y); number(value.z);
}
function actor(value: FieldCameraActor): void {
  checkpointKeys(value, "position,entityPosition,layer,layerZ,direction");
  position(value.position); point(value.entityPosition);
  checkpointInteger(value.layer, 0, 31); checkpointInteger(value.layerZ, -0x80000000, 0x7fffffff);
  if (!directions.includes(value.direction)) throw new Error("Unknown field camera actor direction");
}
export function validateFieldCameraState(state: FieldCameraState): void {
  checkpointKeys(state, state.kind === 'field-camera-v4' ? 'kind,target,dummy,view,worldAuto' : state.kind === "field-camera-v3" ? "kind,target,dummy,view" : "kind,target,dummy");
  if (state.kind === 'field-camera-v4') parseWorldAutoPose(state.worldAuto);
  if (state.kind==='field-camera-v3'||state.kind==='field-camera-v4'&&state.view!==null) parseFieldDynamicView(state.view!);
  if (!["field-camera-v2","field-camera-v3","field-camera-v4"].includes(state.kind) || ![null, "player", "dummy"].includes(state.target))
    throw new Error("Unknown field camera state");
  checkpointKeys(state.dummy, "position,entityOffset,layer,direction,visibility");
  position(state.dummy.position); point(state.dummy.entityOffset);
  checkpointInteger(state.dummy.layer, 0, 31);
  if (state.dummy.direction !== null && !directions.includes(state.dummy.direction))
    throw new Error("Unknown field camera dummy direction");
  const visibility = state.dummy.visibility;
  checkpointKeys(visibility, "activeSelf,fadeAlpha,currentFadeStatus");
  if (![null, true, false].includes(visibility.activeSelf) || visibility.currentFadeStatus !== 0 ||
      visibility.fadeAlpha !== (visibility.activeSelf === true ? 1 : 0))
    throw new Error("Unsupported field camera dummy visibility/fade state");
}
/** MapManager.CreateScrollDummtEntity creates a separate GameObject at these
 * exact source coordinates; AddComponent runs its zero-initialized constructor. */
export function createFieldCameraState(): FieldCameraState {
  return { kind: "field-camera-v2", target: null,
    dummy: { position: { x: 30000, y: 1000, z: -1000 }, entityOffset: { x: 0, y: 0 }, layer: 0, direction: null,
      visibility: { activeSelf: null, fadeAlpha: 0, currentFadeStatus: 0 } } };
}
/** FieldEntity.Show/Hide(0) set alpha and clear an active fade before setting
 * GameObject activeSelf. The fresh dummy has no shadow or ChildEntityObject;
 * its inherited UpdateFadeRenderer therefore has no material/child effect. */
export function projectFieldCameraVisibility(state: FieldCameraState, visible: boolean): FieldCameraState {
  validateFieldCameraState(state);
  if (typeof visible !== "boolean") throw new Error("Unknown camera visibility request");
  const candidate = structuredClone(state);
  candidate.dummy.visibility = { activeSelf: visible, fadeAlpha: visible ? 1 : 0, currentFadeStatus: 0 };
  return candidate;
}
/** Integrator.InitCameraDummy copies the actual player's local transform and
 * layer. Factory-created player/dummy share a parent, so world positions also
 * coincide. It does not change target, direction, offset or movement state. */
export function initializeFieldCameraDummy(state: FieldCameraState, player: FieldCameraActor): FieldCameraState {
  validateFieldCameraState(state); actor(player);
  const candidate = structuredClone(state);
  candidate.dummy.position = { x: f(player.position.x), y: f(player.position.y), z: f(player.position.z) };
  candidate.dummy.layer = player.layer;
  return candidate;
}
/** FieldController.ChangeCameraTarget: null source ID means the actual player;
 * source ID0 means the dummy. Re-selecting dummy reinitializes from the previous
 * dummy, not from the player. Unknown arbitrary entity targets remain separate. */
export function projectFieldCameraTarget(state: FieldCameraState, command: FieldCameraCommand,
  player: FieldCameraActor, layerZ: Readonly<Record<string, number>>): FieldCameraPlan {
  validateFieldCameraState(state); actor(player); checkpointKeys(command, "target");
  if (command.target !== "player" && command.target !== "dummy") throw new Error("Unknown field camera target");
  const candidate = structuredClone(state);
  candidate.target = command.target;
  if (command.target === "dummy") {
    let previous = player;
    if (state.target === "dummy") {
      const dummy = state.dummy, z = layerZ?.[dummy.layer];
      if (z === undefined || dummy.direction === null) throw new Error("Missing previous camera dummy layer/direction provider");
      previous = { position: { ...dummy.position }, entityPosition: {
        x: f(f(dummy.position.x) + f(dummy.entityOffset.x)),
        y: f(f(dummy.position.y) + f(dummy.entityOffset.y)),
      }, layer: dummy.layer, layerZ: z, direction: dummy.direction };
      actor(previous);
    }
    const offset = {
      x: f(f(previous.entityPosition.x) - f(previous.position.x)),
      y: f(f(previous.entityPosition.y) - f(previous.position.y)),
    };
    candidate.dummy = {
      ...candidate.dummy,
      // Preserve the native subtraction order, including float32 cancellation.
      position: { x: f(f(previous.entityPosition.x) - offset.x),
        y: f(f(previous.entityPosition.y) - offset.y), z: f(previous.layerZ) },
      entityOffset: offset, layer: previous.layer, direction: previous.direction,
    };
  }
  return { state: candidate, resetDummyMovement: command.target === "dummy",
    notifyMove: command.target, refresh: true };
}
/** CameraFollowing.UpdateController uses the root transform for camera position,
 * but GetEntityPosition for map-render tracking. These are unclamped source
 * inputs: viewport, clamp, loop and camera effect offsets belong to that host. */
export function projectFieldCamera(state: FieldCameraState, player: FieldCameraActor,
  mapScrollOffset: Point): { cameraPosition: Point; renderPosition: Point } | null {
  validateFieldCameraState(state); actor(player); point(mapScrollOffset);
  if (state.target === null) return null;
  const target = state.target === "player" ? player : {
    position: state.dummy.position,
    entityPosition: { x: f(f(state.dummy.position.x) + f(state.dummy.entityOffset.x)),
      y: f(f(state.dummy.position.y) + f(state.dummy.entityOffset.y)) },
  };
  return {
    cameraPosition: { x: f(f(target.position.x) + f(mapScrollOffset.x)),
      y: f(f(target.position.y) + f(mapScrollOffset.y)) },
    renderPosition: { x: f(f(target.entityPosition.x) + f(mapScrollOffset.x)),
      y: f(f(target.entityPosition.y) + f(mapScrollOffset.y)) },
  };
}

/** EventActionScript.End restores player tracking for these exact End codes.
 * Other codes preserve the target; this does not execute its scene/UI effects. */
export function fieldCameraRestoresPlayerAtScriptEnd(end: number): boolean {
  checkpointInteger(end, -0x80000000, 0x7fffffff);
  return [0, 2, 3, 4, 6].includes(end);
}

/** EventActionScript.RunScript selects source actor 0 after, and only after,
 * its event accessor accepts the script. startChangeState does not gate this. */
export function fieldCameraSelectsDummyAtScriptStart(accepted: boolean): boolean {
  if (typeof accepted !== "boolean") throw new Error("Unknown script start result");
  return accepted;
}

export type FieldCameraMapRange = { x: number; y: number; width: number; height: number };
export type FieldCameraSetPosition = { kind: "set-position"; x: number; y: number; layer: 0 } &
  ({ mode?: never; referenceEntityId?: never } | { mode: 1; referenceEntityId: number });
export type FieldCameraLerp = { kind: "lerp"; x: number; y: number; layer: 0; duration: number; arcHeight: number };
export type FieldCameraMotion = FieldCameraSetPosition | FieldCameraLerp;
export type FieldCameraMotionOp = { kind: "field-camera-motion"; command: FieldCameraMotion };
/** These are PuppetCore instruction-local registers, not a second dummy owner. */
export type FieldCameraLerpProgress = { start: Point; startedAt: number; startLayer: number };
const onLayerZ: Readonly<Record<number, number>> = { 9: 349, 10: 249, 11: 149, 12: 49 };
function mapRange(value: FieldCameraMapRange): void {
  checkpointKeys(value, "x,y,width,height");
  checkpointInteger(value.x, -0x80000000, 0x7fffffff);
  checkpointInteger(value.y, -0x80000000, 0x7fffffff);
  checkpointInteger(value.width, 1, 0x7fffffff);
  checkpointInteger(value.height, 1, 0x7fffffff);
}
/** MapUtility's default is layer 0, not the current actor's layer. */
function layerFromZ(z: number): number {
  number(z);
  const integerZ = Math.trunc(f(z));
  return [9, 10, 11, 12].find((layer) => onLayerZ[layer] === integerZ) ?? 0;
}
/** Source ChangeLayer supports Bottom/Ground/Upper. Logical ceiling 3 has no
 * entry in Puppet.kLayerValues and cannot be silently made a fourth entry. */
export function fieldCameraLayerFromLogical(logicalLayer: number): { layer: number; layerZ: number } {
  checkpointInteger(logicalLayer, 0, 2);
  const layer = [9, 10, 11][logicalLayer]!;
  return { layer, layerZ: onLayerZ[layer]! };
}
/** Cell coordinates here are map-local, after ConversionMapRangeCell. */
export function fieldCameraCellToWorld(map: FieldCameraMapRange, cell: Point, logicalLayer: number): FieldCameraPoint {
  mapRange(map); point(cell);
  const { layerZ } = fieldCameraLayerFromLogical(logicalLayer);
  return {
    x: f(f(f(f(cell.x) - f(f(map.width) * 0.5)) * 16) + 8),
    y: f(f(f(f(f(map.height) * 0.5) - 1) - f(cell.y)) * 16 + 8),
    z: layerZ,
  };
}
/** Source WorldPositionToCellPosition floors; it does not recover sub-cell
 * coordinates or layer. Kept-axis SetPos therefore snaps to a cell centre. */
export function fieldCameraWorldToCell(map: FieldCameraMapRange, world: Point): Point {
  mapRange(map); point(world);
  return {
    x: Math.floor(f(f(f(map.width) * 0.5) + f(f(world.x) * 0.0625))),
    y: Math.floor(f(f(f(map.height) * 0.5) - f(f(world.y) * 0.0625))),
  };
}
export function fieldCameraActorFromCell(map: FieldCameraMapRange, cell: Point,
  logicalLayer: number, direction: Direction, entityOffset: Point): FieldCameraActor {
  point(entityOffset);
  const p = fieldCameraCellToWorld(map, cell, logicalLayer);
  const result: FieldCameraActor = { position: p,
    entityPosition: { x: f(p.x + f(entityOffset.x)), y: f(p.y + f(entityOffset.y)) },
    ...fieldCameraLayerFromLogical(logicalLayer), direction };
  actor(result); return result;
}
/** Convert a native world point to continuous browser/map-cell coordinates.
 * Unlike WorldPositionToCellPosition this deliberately does not floor; renderer
 * motion must preserve the native sub-cell interpolation. */
export function fieldCameraWorldToContinuousCell(map: FieldCameraMapRange, world: Point): Point {
  mapRange(map); point(world);
  return { x: f(f(f(f(map.width) * 0.5) + f(f(world.x) * 0.0625)) - 0.5),
    y: f(f(f(f(map.height) * 0.5) - f(f(world.y) * 0.0625)) - 0.5) };
}
function motion(value: FieldCameraMotion): void {
  checkpointKeys(value, value.kind === "set-position" ? value.mode === 1
    ? "kind,x,y,layer,mode,referenceEntityId" : "kind,x,y,layer" : "kind,x,y,layer,duration,arcHeight");
  if (value.kind !== "set-position" && value.kind !== "lerp") throw new Error("Unknown camera motion");
  checkpointInteger(value.x, -0x80000000, 0x7fffffff);
  checkpointInteger(value.y, -0x80000000, 0x7fffffff);
  if (value.layer !== 0) throw new Error("Camera motion layer-change host is unresolved");
  if (value.kind === "set-position" && value.mode === 1)
    checkpointInteger(value.referenceEntityId, -0x80000000, 0x7fffffff);
  if (value.kind === "lerp") {
    if (!Number.isFinite(value.duration) || !Number.isFinite(value.arcHeight))
      throw new Error("Invalid camera motion operand");
  }
}
function localTarget(map: FieldCameraMapRange, command: FieldCameraMotion): Point {
  // C# Int32 subtraction retains wraparound before the later float conversion.
  return { x: (command.x - map.x) | 0, y: (command.y - map.y) | 0 };
}
/** Puppet.SetPos's common coordinate calculation for both actual actors and
 * the scroll dummy. The reference is a resolved current native instance. */
export function fieldSetPositionToWorld(map: FieldCameraMapRange, current: FieldCameraPoint,
  command: { x: number; y: number; layer: 0 | 1 | 2 | 3; mode?: 1 }, reference?: FieldCameraPoint): FieldCameraPoint {
  mapRange(map); position(current);
  checkpointInteger(command.x, -0x80000000, 0x7fffffff);
  checkpointInteger(command.y, -0x80000000, 0x7fffffff); checkpointInteger(command.layer, 0, 3);
  if (command.mode !== undefined && command.mode !== 1) throw new Error("Unknown source SetPos mode");
  const layer = command.layer === 0 ? [349, 249, 149].indexOf(Math.trunc(f(current.z))) : command.layer - 1;
  if (layer < 0) throw new Error("Source SetPos cannot preserve this source Z layer");
  let cell: Point;
  if (command.mode === 1) {
    if (!reference) throw new Error("Source relative SetPos reference entity is absent or unresolved");
    position(reference);
    const anchor = fieldCameraWorldToCell(map, { x: reference.x, y: reference.y });
    cell = { x: f(f(command.x) + f(anchor.x)), y: f(f(command.y) + f(anchor.y)) };
  } else {
    if (reference !== undefined) throw new Error("Absolute source SetPos cannot consume a relative reference binding");
    const anchor = fieldCameraWorldToCell(map, { x: current.x, y: current.y });
    const x = (command.x - map.x) | 0, y = (command.y - map.y) | 0;
    cell = { x: x < 0 ? anchor.x : x, y: y < 0 ? anchor.y : y };
  }
  return fieldCameraCellToWorld(map, cell, layer);
}
export function projectFieldCameraSetPosition(state: FieldCameraState,
  command: FieldCameraSetPosition, map: FieldCameraMapRange, reference?: FieldCameraPoint): {
    state: FieldCameraState;
    notifySetPosition: { sourceEntityId: 0; from: FieldCameraPoint; to: FieldCameraPoint };
  } {
  validateFieldCameraState(state); motion(command); mapRange(map);
  const layer = layerFromZ(state.dummy.position.z);
  // GetChangeLayerValue(request=0) indexes the exact three-entry kLayerValues.
  if (![9, 10, 11].includes(layer)) throw new Error("Camera SetPos cannot preserve this source Z layer");
  const p = fieldSetPositionToWorld(map, state.dummy.position, command, reference);
  const candidate = structuredClone(state); candidate.dummy.position = p;
  return { state: candidate, notifySetPosition: { sourceEntityId: 0,
    from: { ...state.dummy.position }, to: { ...p } } };
}
export function validateFieldCameraLerpProgress(progress: FieldCameraLerpProgress): void {
  checkpointKeys(progress, "start,startedAt,startLayer"); point(progress.start); number(progress.startedAt);
  if (progress.startedAt < 0 || ![0, 9, 10, 11, 12].includes(progress.startLayer))
    throw new Error("Invalid source camera Lerp progress");
}
/** Pure Mathf.Lerp/arc arithmetic shared by actual camera and non-Sprite
 * transforms. It owns no entity, camera state, register bank or callback. */
export function sourcePuppetLerpCoordinates(start:Point,target:Point,ratio:number,arcHeight:number):Point {
  const t=Math.max(0,Math.min(1,f(ratio)));
  const lerp=(a:number,b:number)=>f(f(a)+f(f(f(b)-f(a))*t));
  const arc=f((ratio-ratio*ratio)*arcHeight*4);number(arc);
  return {x:lerp(start.x,target.x),y:f(lerp(start.y,target.y)+arc)};
}
/** One native instruction call. The host passes its source Time.time equivalent
 * in seconds, including the same time on first execution. Positive durations
 * first return Wait at ratio zero; negative durations are not made positive. */
export function stepFieldCameraLerp(state: FieldCameraState, command: FieldCameraLerp,
  map: FieldCameraMapRange, progress: FieldCameraLerpProgress | null, sourceTimeSeconds: number): {
    state: FieldCameraState; progress: FieldCameraLerpProgress; flow: "next" | "wait";
  } {
  validateFieldCameraState(state); motion(command); mapRange(map); number(sourceTimeSeconds);
  if (sourceTimeSeconds < 0) throw new Error("Invalid source camera clock");
  const time = f(sourceTimeSeconds);
  const registers = progress === null ? {
    start: { x: f(state.dummy.position.x), y: f(state.dummy.position.y) },
    startedAt: time, startLayer: layerFromZ(state.dummy.position.z),
  } : structuredClone(progress);
  validateFieldCameraLerpProgress(registers);
  if (time < registers.startedAt) throw new Error("Camera clock precedes its first instruction clock");
  const ratio = command.duration === 0 ? 1 : Math.min(1, (time - registers.startedAt) / command.duration);
  const target = fieldCameraCellToWorld(map, localTarget(map, command), 0),
    coordinates=sourcePuppetLerpCoordinates(registers.start,target,ratio,command.arcHeight);
  const candidate = structuredClone(state);
  candidate.dummy.position = {
    x: coordinates.x,
    y: coordinates.y,
    z: f((onLayerZ[registers.startLayer] ?? 0) - (ratio === 1 ? 0 : 5)),
  };
  return { state: candidate, progress: registers, flow: ratio === 1 ? "next" : "wait" };
}
