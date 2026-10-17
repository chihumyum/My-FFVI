import type {
  Direction,
  Evidence,
  FieldEntity,
  Sprite,
} from "../field/types.js";

export type MinimapMedia = {
  sourceSetHash: string;
  icons: Record<string, Sprite>;
  source: Evidence;
};
// This FFVI build's IconConstants and FF6 ShopSign tables; enum names alone are insufficient.
export const MINIMAP_ICON_TYPES = [
  0, 1, 2, 3, 4, 6, 7, 8, 11, 13, 14, 15,
] as const;
export const MINIMAP_ROTATION: Record<Direction, number> = {
  up: -180,
  right: -90,
  down: 0,
  left: -270,
};

/** Project current property-list metadata. The source marks these as layer-independent. */
export function minimapMarkers(entities: readonly FieldEntity[]) {
  return entities
    .filter((e) => e.kind === 18)
    .map((e) => {
      if (
        e.minimap === undefined ||
        !MINIMAP_ICON_TYPES.includes(
          e.minimap.icon as (typeof MINIMAP_ICON_TYPES)[number],
        )
      )
        throw new Error("Missing or unsupported minimap icon type");
      return {
        id: e.id,
        ...e.minimap,
        direction: e.direction,
        source: e.source,
      };
    });
}

export function requireMinimapMedia(
  entities: readonly FieldEntity[],
  media?: MinimapMedia,
) {
  const markers = minimapMarkers(entities);
  for (const id of new Set([0, ...markers.map((m) => m.icon)]))
    if (!media?.icons[id]) throw new Error("Missing minimap sprite " + id);
}
