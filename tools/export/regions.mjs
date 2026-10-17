// A compact connectivity index over existing extracted collision grids. It does
// not regenerate maps or assets. Door cells terminate a walk inside each map.
function worldCollisionByFoot(map, foot, id = 1) {
  const rule = map.worldTerrain?.transportRules?.[id];
  if (!rule) return undefined;
  if (rule.collisionByFoot?.[foot] !== undefined) return Number(rule.collisionByFoot[foot]);
  const type = map.worldTerrain.footRows[foot]?.typeId ?? foot;
  const flag = rule.groupFlags?.[type - 1];
  return flag === undefined ? undefined : Number(flag) === 1 ? 0 : 1;
}
export function navigationRegions(map, entries, isWarp) {
  const { width, height } = map,
    size = width * height;
  const layers = [
    ...new Set([
      ...Object.keys(map.collisions || {}).map(Number),
      ...map.entities.map((e) => e.layer || 0),
    ]),
  ];
  const labels = new Map(),
    parents = [0];
  const portals = entries.filter((e) => e.kind === 3 || isWarp(e));
  const key = (x, y) => Math.round(y) * width + Math.round(x);
  const terrainGrid = map.worldTerrain?.transportRules?.[1]
    ? map.worldTerrain.cells.map((foot) => worldCollisionByFoot(map, foot) ?? 0)
    : null;
  for (const layer of layers) {
    const grid = terrainGrid || map.collisions?.[layer] || map.collisions?.[0],
      cells = new Int32Array(size);
    const blocked = new Set(portals.filter((e) => e.layer === layer).map((e) => key(e.x, e.y)));
    const open = (cell) => cell >= 0 && cell < size && grid?.[cell] !== 1 && !blocked.has(cell);
    for (let start = 0; start < size; start++) {
      if (cells[start] || !open(start)) continue;
      const id = parents.length;
      parents.push(id);
      cells[start] = id;
      const queue = [start];
      for (let head = 0; head < queue.length; head++) {
        const cell = queue[head],
          x = cell % width;
        for (const next of [
          cell >= width ? cell - width : map.worldTerrain?.loopType & 2 ? cell + size - width : -1,
          cell < size - width ? cell + width : map.worldTerrain?.loopType & 2 ? cell % width : -1,
          ...(x ? [cell - 1] : map.worldTerrain?.loopType & 1 ? [cell + width - 1] : []),
          ...(x < width - 1
            ? [cell + 1]
            : map.worldTerrain?.loopType & 1
              ? [cell - width + 1]
              : []),
        ])
          if (open(next) && !cells[next]) {
            cells[next] = id;
            queue.push(next);
          }
      }
    }
    labels.set(layer, cells);
  }
  const root = (id) => {
    while (parents[id] !== id) {
      parents[id] = parents[parents[id]];
      id = parents[id];
    }
    return id;
  };
  const around = (e, adjacent = false) => {
    const cells = labels.get(e.layer || 0),
      cell = key(e.x, e.y),
      x = Math.round(e.x);
    if (!cells) return [];
    if (!adjacent && cells[cell]) return [cells[cell]];
    return [
      ...new Set(
        [
          cells[cell],
          cells[cell - width],
          cells[cell + width],
          x ? cells[cell - 1] : 0,
          x < width - 1 ? cells[cell + 1] : 0,
        ].filter(Boolean),
      ),
    ];
  };
  for (const e of map.entities.filter((e) => e.kind === 4 && e.destinationLayer !== null)) {
    const from = around(e, true),
      to = around({ ...e, layer: e.destinationLayer }, true);
    for (const a of from) for (const b of to) parents[root(a)] = root(b);
  }
  const regions = (e, adjacent = false) => {
    const near = around(e, adjacent);
    for (const point of e.routePoints || []) near.push(...around({ ...e, ...point }, true));
    if ([5, 6, 7, 8, 10, 17].includes(e.kind)) {
      for (const position of [e, ...(e.routePoints || []).map((point) => ({ ...e, ...point }))]) {
        const grid = map.collisions?.[position.layer] || map.collisions?.[0];
        for (const [dx, dy] of [
          [0, -1],
          [1, 0],
          [0, 1],
          [-1, 0],
        ])
          if (grid?.[key(position.x + dx, position.y + dy)] === 1) {
            const far = labels.get(position.layer || 0)?.[
              key(position.x + 2 * dx, position.y + 2 * dy)
            ];
            if (far) near.push(far);
          }
      }
    }
    return [...new Set(near.map(root))];
  };
  return {
    regionRuns: Object.fromEntries(
      [...labels].map(([layer, cells]) => {
        const runs = [];
        for (let cell = 0; cell < cells.length; cell++) {
          const region = cells[cell] ? root(cells[cell]) : 0;
          if (!runs.length || runs.at(-1)[1] !== region) runs.push([cell + 1, region]);
          else runs.at(-1)[0] = cell + 1;
        }
        return [layer, runs];
      }),
    ),
    width,
    height,
    entrances: Object.fromEntries(
      map.entities
        .filter((e) => e.kind === 0)
        .map((e) => [e.objectId, { x: e.x, y: e.y, layer: e.layer, regions: regions(e) }]),
    ),
    entries: entries.map((e) => ({
      ...e,
      regions: regions(e, [3, 5, 6, 7, 8, 10, 17].includes(e.kind) || isWarp(e)),
    })),
  };
}
