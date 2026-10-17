import type { EntityGroup, TileLayer, Tileset } from "../field/types.js";
import { fieldCollisionRange } from "../core/collision.js";

// GetSceneryByLayerName/GetLayerByLayerName, RVAs 0xB25970/0xB25580.
// Native layers 9..12 correspond to Web logical layers 0..3. Water participates.
const layers: Record<string, number> = {
  BottomLayer: 0,
  GroundLayer: 1,
  UpperLayer: 2,
  CeilLayer: 3,
  BottomWater: 0,
  GroundWater: 1,
  UpperWater: 2,
  CeilWater: 3,
};

/** Resolve native region rectangles against the same geometry consumed by the renderer. */
export function bindTileAnimationRegions(
  groups: Record<string, EntityGroup>,
  map: {
    width: number;
    height: number;
    layers: TileLayer[];
    tilesets: Tileset[];
  },
): void {
  const range = fieldCollisionRange(
    map.width,
    map.height,
    groups.entity_default?.entities ?? [],
  );
  const sets = [...map.tilesets].sort((a, b) => b.firstgid - a.firstgid);
  for (const group of Object.values(groups))
    for (const e of group.entities) {
      const region = e.tileAnimation;
      if (!region) continue;
      const cells: { layer: number; index: number }[] = [];
      const reasons = new Set<string>();
      // ParseMapObjectGroupData + CreateEntity cancel their center offsets. The first
      // mesh vertex is the tile's top left; inclusion is [x,x+w) and [y,y+h).
      for (const [li, l] of map.layers.entries()) {
        // ParseMapTileGroupData combines exactly these two source groups.
        if (l.sourceGroup === undefined) {
          reasons.add("Missing tile animation source group");
          continue;
        }
        if (!["TileGroup", "WaterGroup"].includes(l.sourceGroup)) continue;
        const logical = layers[l.name];
        const eligible = logical !== undefined || l.name.includes("Water");
        if (!eligible) continue; // Far/Near scenery and unknown names have scenery != 2.
        if (logical === undefined) {
          reasons.add("Unsupported tile animation water layer " + l.name);
          continue;
        }
        if (!region.allLayers && e.layer !== logical) continue;
        for (
          let y = Math.max(range.y, Math.ceil(e.y));
          y < Math.min(range.y + range.height, e.y + e.height);
          y++
        )
          for (
            let x = Math.max(range.x, Math.ceil(e.x));
            x < Math.min(range.x + range.width, e.x + e.width);
            x++
          ) {
            const index = y * l.width + x,
              raw = l.data[index]! >>> 0,
              gid = raw & 0x0fffffff;
            const set = sets.find((s) => s.firstgid <= gid);
            const animation = set?.tiles?.find(
              (t) => t.id === gid - set.firstgid,
            )?.animation;
            if (!animation?.length) continue;
            if (raw !== gid)
              reasons.add("Unsupported flipped region animation tile");
            cells.push({ layer: li, index });
          }
      }
      for (const reason of reasons)
        group.blockers.push({ reason, source: e.source });
      region.cells = cells;
      group.blockers = group.blockers.filter(
        (b) =>
          !(
            b.reason === "Unbound tile animation geometry" &&
            b.source === e.source
          ),
      );
    }
}
