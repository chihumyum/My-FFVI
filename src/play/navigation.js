// Read-only projections choose ordinary player routes. They never execute a
// field task, emit an event, or write a game flag.
function project(
  game,
  mapId,
  name,
  { initializer = false, direction = "up" } = {},
) {
  const data = game.data,
    map = data.navigation.maps[mapId];
  let programId = data.byMap[mapId]?.[name] ?? data.global[name],
    pc = 0;
  let locals = [...(data.programs[programId]?.locals || [])],
    stack = [];
  const banks = {},
    groups = new Set(["entity_default"]),
    destinations = [],
    scripts = new Set([name]),
    scriptFrames = [];
  const resume = () => {
    if (!scriptFrames.length) return false;
    ({ programId, pc, locals, stack } = scriptFrames.pop());
    return true;
  };
  const bank = (category) => {
    if (category === "ScriptLocalVariable") return locals;
    if (!(category in banks))
      banks[category] = {
        ...((category === "MapLocalVariable" && mapId !== game.mapId) ||
        (category === "AreaLocalVariable" && map.areaId !== game.areaId)
          ? {}
          : game.banks[category]),
      };
    return banks[category];
  };
  const read = (category, index) => Number(bank(category)[index] || 0);
  for (let steps = 0; steps < 3000; steps++) {
    const op = data.programs[programId]?.ops[pc++];
    if (!op) {
      if (resume()) continue;
      break;
    }
    const [kind, i = [], , s = []] = op;
    switch (kind) {
      case "Exit":
        if (resume()) break;
        return { groups, destinations, scripts };
      case "Return":
        if (!stack.length) {
          if (!resume()) return { groups, destinations, scripts };
        } else ({ programId, pc, locals } = stack.pop());
        break;
      case "Call":
        stack.push({ programId, pc, locals });
        pc = i[0];
        break;
      case "Jump":
        pc = i[0];
        break;
      case "Branch":
        if (
          game.compare(
            read(s[0], i[0]),
            s[1],
            s[2] === "imm" ? i[1] : read(s[2], i[1]),
          )
        )
          pc = i[2];
        break;
      case "Calc":
        bank(s[0])[i[0]] = game.calculate(
          read(s[0], i[0]),
          s[1],
          s[2] === "imm" ? i[1] : read(s[2], i[1]),
        );
        break;
      case "SetFlag":
      case "ResetFlag":
      case "FlipFlag":
        bank(s[0])[i[0]] =
          kind === "SetFlag"
            ? 1
            : kind === "ResetFlag"
              ? 0
              : 1 - read(s[0], i[0]);
        break;
      case "SetEntities":
        groups.add(s[0]);
        break;
      case "Select":
        bank("MessageSelection")[0] = 0;
        locals[0] = 0;
        break;
      case "BranchByPlayerDirection":
        pc = i[["up", "right", "down", "left"].indexOf(direction)] ?? pc;
        break;
      case "ChangeMap":
        if (s[0]) scripts.add(s[0]);
        destinations.push({ mapId: i[0], entrance: i[1] });
        return { groups, destinations, scripts };
      case "Encount":
      case "EncountBoss":
        if (s[0]) scripts.add(s[0]);
        break;
      case "ChangeScript": {
        scripts.add(s[0]);
        if (initializer && /^sc_e_/.test(s[0]))
          return { groups, destinations, scripts };
        const next = data.byMap[mapId]?.[s[0]] ?? data.global[s[0]];
        if (next === undefined) break;
        if (i[0]) scriptFrames.push({ programId, pc, locals, stack });
        stack = [];
        programId = next;
        pc = 0;
        locals = [...(data.programs[next].locals || [])];
        break;
      }
    }
  }
  return { groups, destinations, scripts };
}

function navigationState(game) {
  const signature = JSON.stringify([
    game.mapId,
    game.areaId,
    game.partySlots,
    Object.fromEntries(
      Object.entries(game.banks).filter(([name]) => !name.startsWith("Play")),
    ),
    [...game.groups],
  ]);
  if (game.navigationCache?.signature === signature)
    return game.navigationCache;
  const maps = new Map(),
    projections = new Map();
  const script = (mapId, name, initializer = false) => {
    const key = `${mapId}:${name}:${initializer}`;
    if (!projections.has(key)) {
      const one = project(game, mapId, name, { initializer });
      if (!initializer) {
        for (const direction of ["right", "down", "left"]) {
          const extra = project(game, mapId, name, { direction });
          for (const dest of extra.destinations)
            if (
              !one.destinations.some(
                (d) => d.mapId === dest.mapId && d.entrance === dest.entrance,
              )
            )
              one.destinations.push(dest);
          for (const target of extra.scripts) one.scripts.add(target);
        }
      }
      projections.set(key, one);
    }
    return projections.get(key);
  };
  const entries = (mapId) => {
    if (!maps.has(mapId)) {
      const map = game.data.navigation.maps[mapId];
      if (!map) return [];
      const groups =
        mapId === game.mapId
          ? game.groups
          : script(mapId, map.initializer, true).groups;
      maps.set(
        mapId,
        map.entries
          .filter((entry) => groups.has(entry.group))
          .map((entry) => ({
            ...entry,
            destinations: entry.destination
              ? [entry.destination]
              : entry.script
                ? script(mapId, entry.script).destinations
                : [],
            scripts: entry.script
              ? script(mapId, entry.script).scripts
              : new Set(),
          })),
      );
    }
    return maps.get(mapId);
  };
  return (game.navigationCache = {
    signature,
    entries,
    script,
    distances: new Map(),
  });
}

export function routeToStory(game, objective, pathTo) {
  const navigation = game.data.navigation;
  if (!navigation) return { status: "no-navigation" };
  const state = navigationState(game),
    matches = (entry) =>
      (typeof objective === "string"
        ? [objective]
        : objective.scripts || []
      ).some((name) => entry.scripts.has(name));
  const actual = (entry) => {
    const source = game.entities.find(
      (e) => e.id === entry.id && e.script === entry.script,
    );
    if (!source) return null;
    const actor = game.actors.get(String(source.id));
    return actor?.visible === false
      ? null
      : {
          ...source,
          ...(actor ? { x: actor.x, y: actor.y, layer: actor.layer } : {}),
        };
  };
  const local = state.entries(game.mapId);
  for (const entry of local.filter(matches)) {
    const target = actual(entry);
    if (!target) continue;
    if (entry.script && [5, 6, 8].includes(entry.kind)) {
      const requested =
        typeof objective === "string" ? [objective] : objective.scripts || [];
      target.allowedDirections = ["up", "right", "down", "left"].filter(
        (direction) => {
          const projected = project(game, game.mapId, entry.script, {
            direction,
          });
          return requested.some((name) => projected.scripts.has(name));
        },
      );
    }
    const route = pathTo(game, target);
    if (route) return { status: "target", target, route };
  }
  const intersects = (a, b) => a?.some((region) => b?.includes(region));
  const cacheKey = JSON.stringify(objective);
  if (!state.distances.has(cacheKey)) {
    const reverse = new Map(),
      distances = new Map(),
      queue = [];
    const destinationKey = (dest) => {
      const map = navigation.maps[dest.mapId];
      const entrance = map?.entrances[dest.entrance]
        ? dest.entrance
        : Object.keys(map?.entrances || {})[0] || 0;
      return `${dest.mapId}:${entrance}`;
    };
    for (const map of Object.values(navigation.maps)) {
      const entries = state.entries(map.id),
        initial = state.script(map.id, map.initializer, true);
      const autoTarget =
        matches(initial) ||
        (typeof objective !== "string" &&
          objective.action === "visit-map" &&
          objective.maps?.includes(map.id));
      const entrances = Object.keys(map.entrances).length
        ? Object.entries(map.entrances)
        : [[0, { regions: [] }]];
      for (const [id, entrance] of entrances) {
        const from = `${map.id}:${id}`;
        const reachable = entries.filter(
          (entry) =>
            !entrance.regions.length ||
            intersects(entrance.regions, entry.regions),
        );
        if (autoTarget || reachable.some(matches)) {
          distances.set(from, 0);
          queue.push(from);
        }
        for (const entry of reachable)
          for (const dest of entry.destinations) {
            const key = destinationKey(dest),
              incoming = reverse.get(key) || new Set();
            incoming.add(from);
            reverse.set(key, incoming);
          }
      }
    }
    for (let head = 0; head < queue.length; head++)
      for (const from of reverse.get(queue[head]) || [])
        if (!distances.has(from)) {
          distances.set(from, distances.get(queue[head]) + 1);
          queue.push(from);
        }
    state.distances.set(cacheKey, { distances, destinationKey });
  }
  const { distances, destinationKey } = state.distances.get(cacheKey);
  const exits = local
    .map((entry) => ({
      entry,
      target: actual(entry),
      distance: Math.min(
        ...entry.destinations.map(
          (dest) => distances.get(destinationKey(dest)) ?? Infinity,
        ),
      ),
    }))
    .filter((value) => value.target && Number.isFinite(value.distance))
    .sort(
      (a, b) =>
        a.distance - b.distance ||
        Math.abs(a.target.x - game.player.x) +
          Math.abs(a.target.y - game.player.y) -
          Math.abs(b.target.x - game.player.x) -
          Math.abs(b.target.y - game.player.y),
    );
  for (const { target } of exits) {
    const route = pathTo(game, target);
    if (route) return { status: "target", target, route };
  }
  return {
    status: "no-route",
    script: typeof objective === "string" ? objective : objective.id,
  };
}
