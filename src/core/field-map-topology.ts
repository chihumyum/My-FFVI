import type { Point } from "../field/types.js";
import type { CollisionRange } from "./collision.js";

/** Web cell-space topology. The range uses the same global, half-open crop as
 * collision.ts; loop axes are explicit content inputs. This does not establish
 * a collision, world-map, transportation or source-script capability.
 *
 * Existing source evidence: GetIsLoop 0xb253e0 distinguishes the two axes and
 * ParseCollisionMappingData wraps crop neighbours on those axes. This general
 * modulo/nearest-image adapter is NOT MapUtility 0xb24510: that native helper
 * corrects Unity world coordinates at most once and retains its own contract.
 */
export type FieldMapTopology = {
  range: CollisionRange;
  loop: { horizontal: boolean; vertical: boolean };
};

export type FieldMapStep = {
  /** Canonical starting cell; finite fractional positions remain fractional. */
  from: Point;
  /** Logical destination for collision, triggers and the actor's stable cell. */
  destination: Point;
  /** Continuous endpoint beside `from`, which may lie outside the crop. */
  unwrappedDestination: Point;
  /** The requested one-cell displacement, never a map-width seam jump. */
  motionDelta: Point;
};

type ReadonlyTopology = {
  readonly range: Readonly<CollisionRange>;
  readonly loop: Readonly<FieldMapTopology["loop"]>;
};

function record(value: unknown, keys: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join(",") !== keys.split(",").sort().join(","))
    throw new Error("Invalid field map topology fields");
}

export function validateFieldMapTopology(topology: ReadonlyTopology): void {
  record(topology, "range,loop");
  record(topology.range, "x,y,width,height");
  record(topology.loop, "horizontal,vertical");
  const { x, y, width, height } = topology.range;
  if (![x, y, width, height, x + width, y + height].every(Number.isSafeInteger) ||
      x < 0 || y < 0 || width <= 0 || height <= 0)
    throw new Error("Invalid field map topology range");
  if (typeof topology.loop.horizontal !== "boolean" || typeof topology.loop.vertical !== "boolean")
    throw new Error("Invalid field map topology loop axes");
  // Binding this crop to the containing map's dimensions belongs to content
  // admission, which already has validateCollisionRange(width, height, range).
}

function point(value: Readonly<Point>): void {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      !Number.isFinite(value.x) || !Number.isFinite(value.y))
    throw new Error("Invalid field map topology point");
}

const zero = (value: number) => value === 0 ? 0 : value;

function canonicalAxis(value: number, start: number, length: number, loop: boolean): number {
  const end = start + length;
  if (value >= start && value < end) return zero(value);
  if (!loop) throw new Error("Field map point is outside a non-looping axis");
  const remainder = (value - start) % length;
  const result = start + (remainder < 0 ? remainder + length : remainder);
  // A negative sub-cell remainder can round up to the exclusive upper bound.
  return zero(result < end ? result : start);
}

function canonical(topology: ReadonlyTopology, value: Readonly<Point>): Point {
  point(value);
  const { range, loop } = topology;
  return {
    x: canonicalAxis(value.x, range.x, range.width, loop.horizontal),
    y: canonicalAxis(value.y, range.y, range.height, loop.vertical),
  };
}

/** Normalize any number of turns on enabled axes. No clamping, flooring,
 * collision lookup or caller mutation occurs; non-looping bounds reject. */
export function canonicalCell(topology: ReadonlyTopology, value: Readonly<Point>): Point {
  validateFieldMapTopology(topology);
  return canonical(topology, value);
}

/** A single cardinal or diagonal cell step. The logical destination and its
 * continuous image are distinct even on a one-cell-wide looping map. */
export function projectFieldMapStep(
  topology: ReadonlyTopology, from: Readonly<Point>, delta: Readonly<Point>,
): FieldMapStep {
  validateFieldMapTopology(topology);
  point(delta);
  if (![delta.x, delta.y].every(value => Number.isInteger(value) && Math.abs(value) <= 1) ||
      delta.x === 0 && delta.y === 0)
    throw new Error("Invalid field map one-cell step");
  const origin = canonical(topology, from);
  const motionDelta = { x: zero(delta.x), y: zero(delta.y) };
  const unwrappedDestination = { x: origin.x + motionDelta.x, y: origin.y + motionDelta.y };
  return { from: origin, destination: canonical(topology, unwrappedDestination),
    unwrappedDestination, motionDelta };
}

function nearestAxis(target: number, reference: number, length: number, loop: boolean): number {
  let delta = target - reference;
  // Exact half-period ties keep the canonical displacement's sign. This is a
  // deterministic Web convention, not a source target-priority claim.
  if (loop && delta > length / 2) delta -= length;
  else if (loop && delta < -length / 2) delta += length;
  return zero(delta);
}

/** Shortest signed displacement, suitable for interaction distance/direction.
 * Both points must remain within every non-looping crop dimension. */
export function nearestMapDelta(
  topology: ReadonlyTopology, from: Readonly<Point>, to: Readonly<Point>,
): Point {
  validateFieldMapTopology(topology);
  const origin = canonical(topology, from), target = canonical(topology, to);
  return {
    x: nearestAxis(target.x, origin.x, topology.range.width, topology.loop.horizontal),
    y: nearestAxis(target.y, origin.y, topology.range.height, topology.loop.vertical),
  };
}

/** Project a target beside a possibly unwrapped camera/reference. The returned
 * image may lie outside a looping crop and must not replace the logical cell.
 * Non-looping axes retain the target coordinate exactly. */
export function nearestMapImage(
  topology: ReadonlyTopology, value: Readonly<Point>, reference: Readonly<Point>,
): Point {
  validateFieldMapTopology(topology);
  const target = canonical(topology, value), origin = canonical(topology, reference);
  const axis = (key: "x" | "y", length: number, loop: boolean) => {
    if (!loop) return target[key];
    const raw = target[key] - origin[key];
    const delta = nearestAxis(target[key], origin[key], length, true);
    // Keep the target coordinate exact when no translation is necessary.
    return zero(target[key] + (reference[key] - origin[key]) + (delta - raw));
  };
  const image = {
    x: axis("x", topology.range.width, topology.loop.horizontal),
    y: axis("y", topology.range.height, topology.loop.vertical),
  };
  point(image);
  return image;
}
