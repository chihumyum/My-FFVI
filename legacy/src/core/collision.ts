import type { Direction, FieldEntity, Point } from "../field/types.js";

// Bound to the native profile in docs/collision.md. These are collision bits, not facing IDs.
export const COLLISION_FILTER = [
  15, 0, 14, 11, 7, 13, 6, 9, 0, 0, 0, 0, 0, 0,
] as const;
const DIRECT = [0, 0, 0, 0, 0, 0, 0, 0, 11, 22, 208, 104, 219, 126] as const;
// cmp, reverse cmp, x, y, horizontal, reverse horizontal, vertical, reverse vertical, H edge, V edge.
const DIAGONALS = [
  [11, 208, -1, -1, 2, 4, 1, 8, 32, 64],
  [104, 22, -1, 1, 2, 4, 8, 1, 128, 16],
  [22, 104, 1, -1, 4, 2, 1, 8, 16, 128],
  [208, 11, 1, 1, 4, 2, 8, 1, 64, 32],
] as const;
export type CollisionRange = Point & { width: number; height: number };
export function inCollisionRange(p: Point, range: CollisionRange): boolean {
  return (
    p.x >= range.x &&
    p.y >= range.y &&
    p.x < range.x + range.width &&
    p.y < range.y + range.height
  );
}
export function collisionMask(id: number): number {
  if (!Number.isInteger(id) || id < 0 || id >= COLLISION_FILTER.length)
    throw new Error(`Unsupported collision value ${id}`);
  return COLLISION_FILTER[id]!;
}
export function validateCollisionRange(
  width: number,
  height: number,
  range: CollisionRange,
): void {
  if (
    ![width, height, range.x, range.y, range.width, range.height].every(
      Number.isInteger,
    ) ||
    width <= 0 ||
    height <= 0 ||
    range.width <= 0 ||
    range.height <= 0 ||
    range.x < 0 ||
    range.y < 0 ||
    range.x + range.width > width ||
    range.y + range.height > height
  )
    throw new Error("Unsupported collision map range");
}
/** MapRange is editor metadata, even when its object is hidden. Never apply a sprite's bottom anchor. */
export function fieldCollisionRange(
  width: number,
  height: number,
  entities: readonly FieldEntity[],
): CollisionRange {
  const ranges = entities.filter((e) => e.kind === 27);
  if (ranges.length > 1) throw new Error("Ambiguous collision map range");
  const range = ranges[0]
    ? {
        x: ranges[0].x,
        y: ranges[0].y,
        width: ranges[0].width,
        height: ranges[0].height,
      }
    : { x: 0, y: 0, width, height };
  validateCollisionRange(width, height, range);
  return range;
}

/** Native ParseCollisionMappingData, in global Tiled coordinates. Outside the crop stays blocked. */
export function buildCollisionMapping(
  raw: readonly number[],
  width: number,
  height: number,
  range: CollisionRange = { x: 0, y: 0, width, height },
  loopHorizontal = false,
  loopVertical = false,
): number[] {
  validateCollisionRange(width, height, range);
  if (raw.length !== width * height) throw new Error("Invalid collision grid");
  const masks = Array<number>(raw.length).fill(0),
    slopes: number[] = [];
  for (let y = range.y; y < range.y + range.height; y++)
    for (let x = range.x; x < range.x + range.width; x++) {
      const i = y * width + x,
        id = raw[i]!;
      masks[i] = collisionMask(id);
      if (DIRECT[id]! > 0) slopes.push(i);
    }
  const index = (x: number, y: number) => {
    if (loopHorizontal)
      x =
        range.x + ((((x - range.x) % range.width) + range.width) % range.width);
    if (loopVertical)
      y =
        range.y +
        ((((y - range.y) % range.height) + range.height) % range.height);
    return inCollisionRange({ x, y }, range) ? y * width + x : -1;
  };
  for (const i of slopes)
    for (const [
      cmp,
      reverse,
      dx,
      dy,
      _h,
      hr,
      v,
      vr,
      hEdge,
      vEdge,
    ] of DIAGONALS) {
      if ((DIRECT[raw[i]!]! & cmp) !== cmp) continue;
      const x = i % width,
        y = Math.floor(i / width);
      const h = index(x + dx, y),
        vertical = index(x, y + dy),
        diagonal = index(x + dx, y + dy);
      const hm = masks[h] ?? 0,
        vm = masks[vertical] ?? 0,
        dm = masks[diagonal] ?? 0;
      // Preserve the native V/V-reverse test; do not 'correct' it to a symmetric H test.
      if (!(hm & hr) || !(hm & v) || !(vm & v) || !(vm & vr)) continue;
      const localDiagonal =
        diagonal < 0
          ? -1
          : (Math.floor(diagonal / width) - range.y) * range.width +
            (diagonal % width) -
            range.x;
      // Native tests > 0 here, so the upper-left crop cell does not use the opposing-slope fallback.
      if (
        !(dm & hr && dm & vr) &&
        !(localDiagonal > 0 && (DIRECT[raw[diagonal]!]! & reverse) === reverse)
      )
        continue;
      masks[h] = hm | hEdge;
      masks[vertical] = vm | vEdge;
    }
  return masks;
}

export function diagonalBit(dx: number, dy: number): number {
  if (Math.abs(dx) !== 1 || Math.abs(dy) !== 1)
    throw new Error("Invalid diagonal step");
  return dy < 0 ? (dx < 0 ? 16 : 32) : dx < 0 ? 64 : 128;
}

/** Collider redirection receives negated Unity input; convert its Y-up result to Tiled Y-down. */
export function redirectAtSlope(
  id: number,
  direction: Direction,
): Point | null {
  collisionMask(id);
  const direct = DIRECT[id]!,
    has = (bits: number) => Number((direct & bits) === bits);
  const delta: Point =
    direction === "right"
      ? { x: 1, y: has(104) - has(11) }
      : direction === "left"
        ? { x: -1, y: has(208) - has(22) }
        : direction === "up"
          ? { x: has(208) - has(104), y: -1 }
          : { x: has(22) - has(11), y: 1 };
  return delta.x && delta.y ? delta : null;
}
