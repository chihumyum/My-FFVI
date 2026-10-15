import type { Direction, Point } from "../field/types.js";
import type { FieldCameraMapRange } from "./field-camera.js";
import { checkpointInteger, checkpointKeys } from "./checkpoint-validation.js";
import { searchAssignedRouteGrid } from "./field-assigned-route.js";
import { prepareFieldScriptMove } from "./field-script-motion.js";

/** Same actor/motion owner as Puppet.Move. Only the search algorithm is shared
 * with assigned NPC routes; there is no NPC controller/cursor or reassignment. */
export const WEB_PUPPET_ROUTE_POLICY = "web-source-puppet-route-grid-v1" as const;
export type WebPuppetRoutePolicy = typeof WEB_PUPPET_ROUTE_POLICY;
export type FieldPuppetRouteCommand = {
  x: number; y: number; layer: 0 | 1 | 2 | 3;
  speedId: number | null; animation: string;
};
export type FieldPuppetRouteOp = { kind: "field-puppet-route"; command: FieldPuppetRouteCommand };
export type PreparedFieldPuppetRoute = { flow: "next" } | {
  flow: "wait"; points: Point[]; direction: Direction;
  secondsPerCell: number; animationSecondsPerCell: number;
};
export function fieldRouteDirection(from: Point, to: Point): Direction {
  const dx = to.x - from.x, dy = to.y - from.y;
  if (Math.abs(dx) + Math.abs(dy) !== 1)
    throw new Error("Puppet Route requires adjacent settled grid waypoints");
  return dx === 1 ? "right" : dx === -1 ? "left" : dy === 1 ? "down" : "up";
}

/** Explicit fixed-step Web search. The native Search(..., true)/raycast is not
 * emulated. Source target/layer/speed/animation are retained without defaults
 * for missing geometry, layer, collision or entity ownership. */
export function prepareFieldPuppetRoute(command: FieldPuppetRouteCommand, input: {
  policy: WebPuppetRoutePolicy | undefined; from: Point; layer: number;
  range: FieldCameraMapRange; loop: { horizontal: boolean; vertical: boolean };
  magnification: number; canStep(from: Point, to: Point): boolean;
}): PreparedFieldPuppetRoute {
  checkpointKeys(command, "x,y,layer,speedId,animation");
  checkpointInteger(command.x, -0x80000000, 0x7fffffff);
  checkpointInteger(command.y, -0x80000000, 0x7fffffff);
  checkpointInteger(command.layer, 0, 3);
  if (command.speedId !== null) checkpointInteger(command.speedId, 0, 6);
  if (typeof command.animation !== "string") throw new Error("Invalid Puppet Route animation");
  if (input.policy !== WEB_PUPPET_ROUTE_POLICY)
    throw new Error("Puppet Route requires an explicit Web grid policy");
  if (input.loop.horizontal || input.loop.vertical)
    throw new Error("Puppet Route cyclic search provider is unavailable");
  checkpointInteger(input.layer, 0, 2);
  const targetLayer = command.layer === 0 ? input.layer : command.layer - 1;
  if (targetLayer !== input.layer)
    throw new Error("Puppet Route cross-layer search provider is unavailable");
  const points = searchAssignedRouteGrid(input.from, { x: command.x, y: command.y }, input.range, input.canStep);
  if (points === null) throw new Error("Puppet Route found no legal Web grid path");
  // Native first-clock equality skips before starting movement or animation.
  if (!points.length) return { flow: "next" };
  const direction = fieldRouteDirection(input.from, points[0]!);
  const timing = prepareFieldScriptMove({ kind: "move", direction, steps: 0,
    speedId: command.speedId, animation: command.animation }, input.from,
    { loop: input.loop, magnification: input.magnification });
  return { flow: "wait", points, direction, secondsPerCell: timing.secondsPerCell,
    animationSecondsPerCell: timing.animationSecondsPerCell };
}
