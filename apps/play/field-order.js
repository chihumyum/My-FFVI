const planes = { Bottom: 0, Ground: 1, Upper: 2, Ceil: 3 };

export function fieldTilePlane(layer) {
  const name = layer.name || "";
  const prefix = Object.keys(planes).find((prefix) => name.startsWith(prefix));
  return prefix === undefined ? 0 : planes[prefix];
}

export function fieldActorPlane(actor) {
  return Math.max(0, Math.min(3, Math.floor(actor.layer ?? 1)));
}

// Each PR walking floor follows its matching tile plane, before the next
// floor's foreground. A character on UpperObject must be above UpperLayer.
export const fieldFloorOrder = (layer) => fieldTilePlane(layer) * 4;
// Water composites the completed lower tile scene. Equal zIndex values made
// reused containers depend on the preceding map's sorted order: opaque black
// pool-floor tiles could be painted over the already shaded water.
export const fieldTileOrder = (layer) =>
  fieldTilePlane(layer) * 4 + (layer.sourceGroup === "WaterGroup" ? 2.5 : 2);
export const fieldActorOrder = (actor) => fieldActorPlane(actor) * 4 + 3;
export const fieldBodyOrder = (actor) => fieldActorPlane(actor) * 4 + 1;

// The body must sit above its walking floor, while authored furniture can
// cover its lower pass. The next floor still covers both passes below it.
// PR collision zero marks ordinary walking terrain. Nonzero/unknown cells
// retain the foreground pass; water keeps its own compositing semantics.
export function fieldTileIsFloor(map, layer, x, y) {
  return (
    layer.sourceGroup === "TileGroup" &&
    map.collisions?.[fieldTilePlane(layer)]?.[y * map.width + x] === 0
  );
}

// PR FieldCharaEntity uses VisualInstanceBody/Head materials (_IsUpper=0/1)
// and a map-specific horizontal border. The body sits behind furniture in its
// walking plane, while the head remains above it. Crops share the same source
// image, pose, clock and anchor; this never changes the actor's logical floor.
export function fieldBodySegments({ asset, height, pivotY = 0, threshold, hideFeet = 0, vehicle }) {
  if (!/^mo_ff6_[pn]/i.test(asset || "") || vehicle || hideFeet || !Number.isFinite(threshold))
    return [{ name: "whole", top: 0, height }];
  const border = Math.max(0, Math.min(height, height * (1 - pivotY) - threshold));
  return [
    ...(border < height ? [{ name: "body", top: border, height: height - border }] : []),
    ...(border > 0 ? [{ name: "head", top: 0, height: border }] : []),
  ];
}

// PR actor/path positions mark cell centers. Sprite pivots are applied at this
// point, rather than at the bottom edge of the cell (half a tile too low).
export function fieldActorPosition(actor, tileSize) {
  return { x: (actor.x + 0.5) * tileSize, y: (actor.y + 0.5) * tileSize };
}
