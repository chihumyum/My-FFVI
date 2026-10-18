// PR object_type=27 is MapRange. ParseMapRange stores the authored rectangle;
// FieldController passes it to CameraFollowing.SetMapSize before clamping.
// Entity coordinates remain in their original editor grid in this web runtime.
export function fieldCameraFrame(map, focus, width, height, options = {}) {
  const tile = map.tileSize || 16,
    world = /^Map_100(?:10|20|30)/i.test(map.name || ""),
    loop = options.loop ?? (world ? (map.worldTerrain?.loopType ?? 3) : 0),
    authored = map.entities?.find(
      (entity) => entity.kind === 27 && entity.width > 0 && entity.height > 0,
    ),
    range =
      !options.ignoreRange && !world && authored
        ? {
            x: authored.x * tile,
            y: authored.y * tile,
            width: authored.width * tile,
            height: authored.height * tile,
          }
        : { x: 0, y: 0, width: map.width * tile, height: map.height * tile };
  const axis = (position, start, extent, viewport, wrap) => {
    const desired = (position || 0) * tile - viewport / 2;
    if (wrap) return Math.floor(desired);
    if (extent < viewport) return Math.floor(start + (extent - viewport) / 2);
    return Math.floor(Math.max(start, Math.min(start + extent - viewport, desired)));
  };
  return {
    x: axis(focus?.x, range.x, range.width, width, loop & 1),
    y: axis(focus?.y, range.y, range.height, height, loop & 2),
    width,
    height,
    range,
    loop,
  };
}
