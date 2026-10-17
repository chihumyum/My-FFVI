import type { Direction } from "../field/types.js";
import { checkpointInteger, checkpointKeys } from "./checkpoint-validation.js";

export type FieldRelayNativePosition = Readonly<{ x: number; y: number; z: number }>;
/** Source SearchInteractiveArea probes player.localPosition while each relay's
 * IsInRange reads transform.position. The current host admits identity parents
 * explicitly; a transformed or unavailable parent cannot merge these domains. */
export type FieldRelayParentContext = Readonly<{
  translation: FieldRelayNativePosition;
  rotation: FieldRelayNativePosition;
  scale: FieldRelayNativePosition;
}>;
export type FieldRelayPlacement = Readonly<{
  worldPosition: FieldRelayNativePosition;
  horizontalCellLimit: number;
  verticalCellLimit: number;
}>;
export type FieldRelaySearchRanges = readonly [number, number, number, number];
export type FieldRelayMapArea = Readonly<{
  xMin: number; yMin: number; width: number; height: number;
}>;
export type FieldRelaySearchProjection = {
  /** Exact source order: up, right, down, left. */
  searchRanges: [number, number, number, number];
  hits: { relayIndex: number; direction: Direction; addedCells: number }[];
};

const f = Math.fround;
const maxCells = 0x7ffffff;
const directions = [
  { direction: "up", x: 0, y: 1 },
  { direction: "right", x: 1, y: 0 },
  { direction: "down", x: 0, y: -1 },
  { direction: "left", x: -1, y: 0 },
] as const;

function coordinate(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isFinite(f(value)))
    throw new Error("Invalid source relay coordinate");
  return f(value);
}
function position(value: FieldRelayNativePosition): { x: number; y: number; z: number } {
  checkpointKeys(value, "x,y,z");
  return { x: coordinate(value.x), y: coordinate(value.y), z: coordinate(value.z) };
}
function parent(value: FieldRelayParentContext): void {
  checkpointKeys(value, "translation,rotation,scale");
  const translation = position(value.translation), rotation = position(value.rotation), scale = position(value.scale);
  if ([translation.x, translation.y, translation.z, rotation.x, rotation.y, rotation.z].some(v => v !== 0) ||
      [scale.x, scale.y, scale.z].some(v => v !== 1))
    throw new Error("Source relay non-identity parent is unresolved");
}
function limits(relay: FieldRelayPlacement): void {
  checkpointKeys(relay, "worldPosition,horizontalCellLimit,verticalCellLimit");
  checkpointInteger(relay.horizontalCellLimit, 0, maxCells);
  checkpointInteger(relay.verticalCellLimit, 0, maxCells);
  position(relay.worldPosition);
}
function ranges(value: FieldRelaySearchRanges): void {
  if (!Array.isArray(value) || value.length !== 4)
    throw new Error("Missing source relay four-direction search ranges");
  for (const range of value) checkpointInteger(range, 1, maxCells);
}

/** PropertyRelayInteraction 0x9f44c0 divides the parser's signed Int32 pixel
 * dimensions by 16 with truncation. Fractional source deserialization and
 * negative object dimensions have no admitted geometry provider. */
export function fieldRelayCellLimits(originWidth: number, originHeight: number): {
  horizontalCellLimit: number; verticalCellLimit: number;
} {
  checkpointInteger(originWidth, 0, 0x7fffffff);
  checkpointInteger(originHeight, 0, 0x7fffffff);
  return { horizontalCellLimit: Math.trunc(originWidth / 16), verticalCellLimit: Math.trunc(originHeight / 16) };
}

/** FieldRelayInteraction.IsInRange 0xe1a460 uses strict world-space bounds and
 * exact Z equality. Zero-cell dimensions produce an empty interval. */
export function fieldRelayIsInRange(relay: FieldRelayPlacement, targetWorldPosition: FieldRelayNativePosition): boolean {
  limits(relay);
  const center = position(relay.worldPosition), target = position(targetWorldPosition),
    halfWidth = f(f(relay.horizontalCellLimit << 4) * .5),
    halfHeight = f(f(relay.verticalCellLimit << 4) * .5);
  return center.z === target.z &&
    f(center.x - halfWidth) < target.x && target.x < f(center.x + halfWidth) &&
    f(center.y - halfHeight) < target.y && target.y < f(center.y + halfHeight);
}

/** The caller supplies the actual registered relay collection. Native search
 * does not filter its entries by visibility or active state. Repeated rows and
 * overlaps each add a limit, and each probe remains exactly one cell from the
 * player; accumulating a range does not move later probes farther away. */
export function projectFieldRelaySearchRanges(input: {
  playerLocalPosition: FieldRelayNativePosition;
  registeredRelays: readonly FieldRelayPlacement[];
  parentContext: FieldRelayParentContext;
}): FieldRelaySearchProjection {
  parent(input.parentContext);
  const player = position(input.playerLocalPosition);
  if (!Array.isArray(input.registeredRelays)) throw new Error("Missing source registered relay collection");
  for (const relay of input.registeredRelays) limits(relay);
  const result: FieldRelaySearchProjection = { searchRanges: [1, 1, 1, 1], hits: [] };
  input.registeredRelays.forEach((relay, relayIndex) => {
    directions.forEach((direction, index) => {
      const probe = { x: f(player.x + f(direction.x * 16)), y: f(player.y + f(direction.y * 16)), z: player.z };
      if (!fieldRelayIsInRange(relay, probe)) return;
      const addedCells = direction.x !== 0 ? relay.horizontalCellLimit : relay.verticalCellLimit,
        next = result.searchRanges[index]! + addedCells;
      // Native IsFront shifts its count by four. Unclosed overflow cannot turn
      // a long source range into a negative distance or a partial projection.
      checkpointInteger(next, 1, maxCells);
      result.searchRanges[index] = next;
      result.hits.push({ relayIndex, direction: direction.direction, addedCells });
    });
  });
  return result;
}

function mapArea(value: FieldRelayMapArea): { xMin: number; yMin: number; width: number; height: number } {
  checkpointKeys(value, "xMin,yMin,width,height");
  const area = { xMin: coordinate(value.xMin), yMin: coordinate(value.yMin),
    width: coordinate(value.width), height: coordinate(value.height) };
  // GetMapArea derives a centered extent independently for each loop axis;
  // a disabled axis has both origin and extent zero. Missing is not no-loop.
  if (area.width < 0 || area.height < 0 ||
      area.xMin !== f(-area.width / 2) || area.yMin !== f(area.height / 2))
    throw new Error("Unbound source relay map area");
  return area;
}
function correct(value: number, extent: number, minimum: number, maximum: number): number {
  if (extent > 0 && (value < minimum || maximum <= value))
    return f(value - f((value >= 0 ? 1 : -1) * extent));
  return value;
}

/** This is CanPlayerInteractToEntityPosition 0x2f8ab0 plus IsFront 0x2f9450,
 * only a position predicate. The existing observer/Field owner must separately
 * admit active/interactive state, layer, action direction and target ordering.
 * objectType is the actual source Property.ObjectType, never an entity ID. */
export function canFieldRelayInteractToEntityPosition(input: {
  playerLocalPosition: FieldRelayNativePosition;
  targetLocalPosition: FieldRelayNativePosition;
  playerDirection?: Direction | null;
  objectType: number;
  searchRanges: FieldRelaySearchRanges;
  mapArea: FieldRelayMapArea;
  parentContext: FieldRelayParentContext;
}): boolean {
  parent(input.parentContext);
  const player = position(input.playerLocalPosition), target = position(input.targetLocalPosition);
  checkpointInteger(input.objectType, 0, 0x7fffffff);
  ranges(input.searchRanges);
  const area = mapArea(input.mapArea);
  // The source returns here before reading the actual player's direction and
  // does not compare Z; layer eligibility is an outer observer requirement.
  if (player.x === target.x && player.y === target.y) return true;
  const direction = input.playerDirection;
  if (direction !== null && (typeof direction !== "string" ||
      !directions.some(value => value.direction === direction)))
    throw new Error("Missing source relay actual player direction");
  const directionIndex = directions.findIndex(value => value.direction === direction),
    vector = directionIndex < 0 ? { x: 0, y: 0 } : directions[directionIndex]!,
    // MapUtility.CanRelayInteraction is the source list [6,17]. Other source
    // types keep the one-cell position test and gain no extended search.
    searchRange = (input.objectType === 6 || input.objectType === 17) && directionIndex >= 0
      ? input.searchRanges[directionIndex]! : 1;
  for (let count = 1; count <= searchRange; count++) {
    const distance = f(count << 4),
      x = correct(f(player.x + f(distance * vector.x)), area.width, area.xMin, f(area.xMin + area.width));
    if (x !== target.x) continue;
    const y = correct(f(player.y + f(distance * vector.y)), area.height, f(area.yMin - area.height), area.yMin);
    if (y === target.y) return true;
  }
  return false;
}
