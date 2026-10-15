import { WEB_FLAT_FIELD_VIEW_CHANGE, validateFieldViewChangePolicy, parseFieldDynamicView, projectFieldViewChange, type WebFlatFieldViewChange, type FieldViewBinding, type FieldViewChangeCommand } from './field-view-change.js';
import type { Direction, Point } from "../field/types.js";
import { checkpointInteger, checkpointKeys } from "./checkpoint-validation.js";
import { prepareFieldCameraPathStep, type FieldCameraPathCommand, type FieldCameraPathProgress } from "./field-camera-path.js";
import {
  createFieldCameraState, fieldCameraActorFromCell, fieldCameraWorldToContinuousCell,
  initializeFieldCameraDummy, projectFieldCamera, projectFieldCameraSetPosition,
  projectFieldCameraTarget, projectFieldCameraVisibility, stepFieldCameraLerp, validateFieldCameraState,
  type FieldCameraCommand, type FieldCameraLerp, type FieldCameraLerpProgress,
  type FieldCameraMapRange, type FieldCameraSetPosition, type FieldCameraState,
} from "./field-camera.js";

/** Content-bound admission, never a field in a camera save. The native evidence
 * applies to the fresh actual player and dummy in the normal field lifecycle.
 * Bird view, ChangeOffset triggers and an externally rebound callback need a
 * different host; they must not retain this admission after changing lifecycle. */
export type FieldCameraHostDefinition = {
  kind: "source-field-camera-host-v1";
  mapRange: FieldCameraMapRange;
  loop: { horizontal: boolean; vertical: boolean };
  playerVisualOffset: Point;
  callbacks: "fresh-normal-field-v1";
  sources: { file: string; sha256: string }[];
};
export type FieldCameraPlayerRead = {
  /** Current global tile-map cell, including interpolation fractions. */
  cell: Point;
  logicalLayer: number;
  direction: Direction;
};
export type FieldCameraHostPorts = {
  /** Read the actual FieldGame player. A task's puppet is not this player. */
  readPlayer(): FieldCameraPlayerRead;
  /** Current MapScrollOffset, independent of offsetObject.localPosition. */
  readScrollOffset(): Point;
};
export type FieldCameraViewport = {
  aspect: number;
  orthographicSize: number;
  isClamp: boolean;
  /** Explicit effect-controller input. SetMapSize initializes this to zero;
   * this host does not fabricate shake, screenshot or effect progression. */
  effectOffset: Point;
};
export type FieldCameraHostProjection = {
  /** Source CameraController.position after clamp, before effect offset. */
  position: Point;
  /** Source camera transform position after effect offset. */
  cameraPosition: Point;
  /** GetEntityPosition + scroll + effect. Never clamped like the camera root. */
  renderPosition: Point;
  cameraCell: Point;
  renderCell: Point;
  clampTileSubY: number;
  moveCamera: { followingEntityPosition: Point; offsetPosition: Point; isScreenshot: boolean };
  moveMapRender: Point;
  frontRenderArea: { x: number; margin: 32 };
};
export type FieldCameraPrepared = {
  state: FieldCameraState;
  /** ChangeCameraTarget invokes UpdateController; InitCameraDummy does not. */
  refresh: boolean;
  /** Native ordinary MoveCallback/SetPosCallback are absent in the bound
   * lifecycle. No arbitrary user-supplied delegate is treated as a no-op. */
  callbackDisposition: "source-absent" | "not-invoked" | "web-flat-not-installed";
  validate(): void;
  commit(): void;
  /** Validate and lock this owner before the other atomic publication. */
  commitWith(commitOwned: () => boolean): boolean;
};

const f = Math.fround;
const layerZ = { 9: 349, 10: 249, 11: 149, 12: 49 };
function finite(value: number): void {
  if (!Number.isFinite(value) || !Number.isFinite(f(value))) throw new Error("Invalid camera host number");
}
function point(value: Point): void {
  checkpointKeys(value, "x,y"); finite(value.x); finite(value.y);
}
function validateDefinition(definition: FieldCameraHostDefinition): void {
  checkpointKeys(definition, "kind,mapRange,loop,playerVisualOffset,callbacks,sources");
  if (definition.kind !== "source-field-camera-host-v1" || definition.callbacks !== "fresh-normal-field-v1")
    throw new Error("Unadmitted field camera lifecycle");
  checkpointKeys(definition.mapRange, "x,y,width,height");
  checkpointInteger(definition.mapRange.x, -0x80000000, 0x7fffffff);
  checkpointInteger(definition.mapRange.y, -0x80000000, 0x7fffffff);
  checkpointInteger(definition.mapRange.width, 1, 0x7ffffff);
  checkpointInteger(definition.mapRange.height, 1, 0x7ffffff);
  checkpointKeys(definition.loop, "horizontal,vertical");
  if (typeof definition.loop.horizontal !== "boolean" || typeof definition.loop.vertical !== "boolean")
    throw new Error("Unknown source camera loop configuration");
  point(definition.playerVisualOffset);
  if (definition.playerVisualOffset.x !== 0 || definition.playerVisualOffset.y !== -6)
    throw new Error("Unreviewed player camera visual offset");
  if (!Array.isArray(definition.sources) || definition.sources.length < 2)
    throw new Error("Missing field camera factory source binding");
  const files = new Set<string>();
  for (const source of definition.sources) {
    checkpointKeys(source, "file,sha256");
    if (typeof source.file !== "string" || !source.file || files.has(source.file) ||
        !/^[a-f0-9]{64}$/.test(source.sha256)) throw new Error("Invalid camera source binding");
    files.add(source.file);
  }
}
function validatePorts(ports: FieldCameraHostPorts): void {
  if (!ports || typeof ports.readPlayer !== "function" || typeof ports.readScrollOffset !== "function")
    throw new Error("Missing current field camera read ports");
}
function validateViewport(view: FieldCameraViewport): void {
  checkpointKeys(view, "aspect,orthographicSize,isClamp,effectOffset");
  finite(view.aspect); finite(view.orthographicSize); point(view.effectOffset);
  if (view.aspect <= 0 || view.orthographicSize <= 0 || typeof view.isClamp !== "boolean")
    throw new Error("Invalid field camera viewport");
}

/** One camera owner. Live player coordinates and current scroll are read through
 * ports at use time; they are not copied into this host or its checkpoint.
 * Task-local Lerp registers are supplied/returned for each individual task. */
export class FieldCameraHost {
  readonly #definition: FieldCameraHostDefinition;
  readonly #ports: FieldCameraHostPorts;
  #state: FieldCameraState;
  #revision = 0;
  #publishing = false;

  constructor(definition: FieldCameraHostDefinition, ports: FieldCameraHostPorts,
    checkpoint: FieldCameraState = createFieldCameraState(), private readonly viewBinding?: FieldViewBinding,
    private readonly viewPolicy:WebFlatFieldViewChange=WEB_FLAT_FIELD_VIEW_CHANGE) {
    validateFieldViewChangePolicy(viewPolicy);
    validateDefinition(definition); validatePorts(ports); validateFieldCameraState(checkpoint);
    this.#definition = structuredClone(definition);
    this.#ports = ports;
    if (checkpoint.kind === "field-camera-v3") {
      if (!viewBinding) throw new Error("Saved dynamic view cannot grant a view policy");
      parseFieldDynamicView(checkpoint.view,viewBinding,viewPolicy);
    }
    this.#state = structuredClone(checkpoint);
  }
  snapshot(): FieldCameraState { return structuredClone(this.#state); }
  /** The caller supplies the destination's trusted content and live read ports.
   * A map transaction can prepare the fork without changing its source host. */
  fork(definition: FieldCameraHostDefinition, ports: FieldCameraHostPorts): FieldCameraHost {
    return new FieldCameraHost(definition, ports, this.#state, this.viewBinding,this.viewPolicy);
  }
  /** Publish a completely prepared fork or restore into this existing owner.
   * The snapshot supplies state only; this host keeps its content and ports. */
  prepareState(checkpoint: FieldCameraState): FieldCameraPrepared {
    return this.#prepare(checkpoint, true, "not-invoked");
  }
  #player() {
    const player = this.#ports.readPlayer();
    checkpointKeys(player, "cell,logicalLayer,direction");
    point(player.cell);
    const map = this.#definition.mapRange;
    return fieldCameraActorFromCell(map,
      { x: f(f(player.cell.x) - map.x), y: f(f(player.cell.y) - map.y) }, player.logicalLayer,
      player.direction, this.#definition.playerVisualOffset);
  }
  #prepare(state: FieldCameraState, refresh: boolean,
    callbackDisposition: FieldCameraPrepared["callbackDisposition"]): FieldCameraPrepared {
    if (this.#publishing) throw new Error("Field camera publication is already in progress");
    validateFieldCameraState(state);
    if(state.kind === "field-camera-v3") { if(!this.viewBinding)throw new Error("Unbound dynamic camera view");parseFieldDynamicView(state.view,this.viewBinding,this.viewPolicy); }
    if(callbackDisposition === "source-absent" && state.kind === "field-camera-v3") callbackDisposition="web-flat-not-installed";
    const candidate = structuredClone(state), revision = this.#revision;
    let committed = false;
    const validate = () => {
      if (committed || this.#publishing || revision !== this.#revision) throw new Error("Stale field camera transaction");
    };
    const commitWith = (commitOwned: () => boolean): boolean => {
      validate(); committed = true; this.#publishing = true;
      try {
        if (commitOwned() !== true) return false;
        this.#state = candidate; this.#revision += 1; return true;
      } finally { this.#publishing = false; }
    };
    return { state: structuredClone(candidate), refresh, callbackDisposition, validate,
      commit: () => { commitWith(() => true); }, commitWith };
  }
  /** The existing camera owns current view. A prepared candidate has no live
   * callback/registry effects; its containing Field transaction fences actors. */
  prepareView(command: FieldViewChangeCommand): (FieldCameraPrepared & { branchReturn:boolean }) {
    if(!this.viewBinding)throw new Error("Trusted Web field view binding is unavailable");
    const view=projectFieldViewChange(this.viewBinding,command,this.viewPolicy);
    if(!view)return {...this.#prepare(this.#state,false,"not-invoked"),branchReturn:true};
    const next:FieldCameraState={kind:"field-camera-v3",target:this.#state.target,dummy:structuredClone(this.#state.dummy),view};
    return {...this.#prepare(next,true,"web-flat-not-installed"),branchReturn:false};
  }
  prepareInitializeDummy(): FieldCameraPrepared {
    return this.#prepare(initializeFieldCameraDummy(this.#state, this.#player()), false, "not-invoked");
  }
  prepareSelect(command: FieldCameraCommand): FieldCameraPrepared & { resetDummyMovement: boolean } {
    const plan = projectFieldCameraTarget(this.#state, command, this.#player(), layerZ);
    return { ...this.#prepare(plan.state, true, "source-absent"), resetDummyMovement: plan.resetDummyMovement };
  }
  prepareSetPosition(command: FieldCameraSetPosition): FieldCameraPrepared {
    const plan = projectFieldCameraSetPosition(this.#state, command, this.#definition.mapRange);
    return this.#prepare(plan.state, false, "source-absent");
  }
  /** Ready and exact zero-duration Hide publish native dummy visibility here,
   * never into FieldGame.hiddenEntities or an actor-host camera copy. */
  prepareVisibility(visible: boolean): FieldCameraPrepared {
    return this.#prepare(projectFieldCameraVisibility(this.#state, visible), false, "not-invoked");
  }
  prepareLerp(command: FieldCameraLerp, progress: FieldCameraLerpProgress | null,
    sourceTimeSeconds: number): FieldCameraPrepared & { progress: FieldCameraLerpProgress; flow: "next" | "wait" } {
    const plan = stepFieldCameraLerp(this.#state, command, this.#definition.mapRange, progress, sourceTimeSeconds);
    return { ...this.#prepare(plan.state, false, "not-invoked"), progress: plan.progress, flow: plan.flow };
  }
  preparePath(command: FieldCameraPathCommand, progress: FieldCameraPathProgress | null,
    clockMs: number, targetEntity?: { x: number; y: number; z: number },
    grid?: import("./field-camera-path.js").FieldCameraPathContext["grid"]) {
    const plan = prepareFieldCameraPathStep(this.#state, command, {
      mapRange: this.#definition.mapRange, loop: this.#definition.loop, magnification: 1,
      view: "normal-field", callbacks: "source-absent", raycast: "disabled",
      ...(targetEntity ? { targetEntity } : {}), ...(grid ? { grid } : {}),
    }, progress, clockMs);
    return { ...this.#prepare(plan.state, false, "source-absent"), progress: plan.progress, flow: plan.flow };
  }
  projection(view: FieldCameraViewport): FieldCameraHostProjection | null {
    validateViewport(view);
    const projected = projectFieldCamera(this.#state, this.#player(), this.#ports.readScrollOffset());
    if (projected === null) return null;
    let { x, y } = projected.cameraPosition;
    const size = f(f(view.orthographicSize) + f(view.orthographicSize));
    finite(size);
    let clampTileSubY = 0;
    if (!this.#definition.loop.horizontal && view.isClamp) {
      const aspect = Math.min(f(view.aspect), f(2.3703704));
      const viewportWidth = f(aspect * size); finite(viewportWidth);
      const width = f(Math.max(0, f(f(this.#definition.mapRange.width * 16) - viewportWidth)));
      const half = f(width * 0.5); x = f(Math.min(half, Math.max(-half, x)));
    }
    if (!this.#definition.loop.vertical && view.isClamp) {
      let extent = f(f(f(this.#definition.mapRange.height * 16) - size) * 0.5);
      const signExtent = extent >= 0 ? 1 : -1, signY = y >= 0 ? 1 : -1;
      const absoluteExtent = f(signExtent * extent);
      const steps = Math.ceil(f(f(absoluteExtent + 8) * 0.0625));
      if (!Number.isSafeInteger(steps) || steps < -0x8000000 || steps > 0x7ffffff)
        throw new Error("Camera clamp source integer overflow");
      const snapped = f(steps * 16 - 8);
      const tileEdge = Math.min(f(y * signY), snapped);
      clampTileSubY = f(f(Math.max(0, f(tileEdge - absoluteExtent))) * signY);
      extent = f(Math.max(0, extent)); y = f(Math.min(extent, Math.max(-extent, y)));
    }
    const offset = { x: f(view.effectOffset.x), y: f(view.effectOffset.y) };
    const add = (p: Point): Point => ({ x: f(p.x + offset.x), y: f(p.y + offset.y) });
    const position = { x, y }, cameraPosition = add(position), renderPosition = add(projected.renderPosition);
    point(cameraPosition); point(renderPosition);
    const globalCell = (p: Point): Point => {
      const map = this.#definition.mapRange, local = fieldCameraWorldToContinuousCell(map, p);
      return { x: f(local.x + map.x), y: f(local.y + map.y) };
    };
    return { position, cameraPosition, renderPosition,
      cameraCell: globalCell(cameraPosition), renderCell: globalCell(renderPosition),
      clampTileSubY,
      moveCamera: { followingEntityPosition: { ...projected.cameraPosition }, offsetPosition: offset,
        isScreenshot: !view.isClamp },
      moveMapRender: { ...renderPosition }, frontRenderArea: { x: renderPosition.x, margin: 32 } };
  }
}
