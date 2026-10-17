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
export const fieldTileOrder = (layer) => fieldTilePlane(layer) * 2;
export const fieldActorOrder = (actor) => fieldActorPlane(actor) * 2 + 1;

// PR actor/path positions mark cell centers. Sprite pivots are applied at this
// point, rather than at the bottom edge of the cell (half a tile too low).
export function fieldActorPosition(actor, tileSize) {
  return { x: (actor.x + 0.5) * tileSize, y: (actor.y + 0.5) * tileSize };
}
