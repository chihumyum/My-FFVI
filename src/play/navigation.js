// Read-only projections choose ordinary player routes. They never execute a
// field task, emit an event, or write a game flag.
function project(
  game,
  mapId,
  name,
  { initializer = false, direction = "up", depth = 0,
    initialBanks = game.banks, previousArea = game.areaId, newEntry = false,
    followContinuations = true } = {},
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
        ...((category === "MapLocalVariable" && (newEntry || mapId !== game.mapId)) ||
        (category === "AreaLocalVariable" && map.areaId !== previousArea)
          ? {}
          : initialBanks[category]),
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
        // Temporary camera/staging maps return through their authored scene
        // continuation. Include that source chain in the route graph; walking
        // still enters the real first trigger and executes every transition.
        if (followContinuations && s[0] && depth < 16 && data.navigation.maps[i[0]]) {
          const next = project(game, i[0], s[0], { direction, depth: depth + 1,
            initialBanks: { ...initialBanks, ...banks }, previousArea: map.areaId,
            newEntry: true });
          destinations.push(...next.destinations);
          for (const name of next.scripts) scripts.add(name);
        }
        return { groups, destinations, scripts };
      case "Encount":
      case "EncountBoss":
        if (s[0]) {
          scripts.add(s[0]);
          if (followContinuations && depth < 16) {
            const next = project(game, mapId, s[0], { direction, depth: depth + 1,
              initialBanks: { ...initialBanks, ...banks }, previousArea: map.areaId });
            destinations.push(...next.destinations);
            for (const name of next.scripts) scripts.add(name);
          }
          return { groups, destinations, scripts };
        }
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
          for (const group of extra.groups) one.groups.add(group);
        }
      }
      projections.set(key, one);
    }
    return projections.get(key);
  };
  // Some ordinary inputs reveal the next input instead of calling its script:
  // touch a tripwire, then talk to the NPC it reveals. Route to that real
  // prerequisite, but only while its group is absent. Never activate it here.
  const reachableScripts = (mapId, projected, activeGroups) => {
    const result = new Set(projected.scripts),
      pending = [...projected.groups],
      seen = new Set(activeGroups);
    seen.add("entity_default");
    for (let head = 0; head < pending.length; head++) {
      const group = pending[head];
      if (seen.has(group)) continue;
      seen.add(group);
      for (const entry of game.data.navigation.maps[mapId].entries) {
        if (entry.group !== group || !entry.script) continue;
        const next = script(mapId, entry.script);
        for (const name of next.scripts) result.add(name);
        pending.push(...next.groups);
      }
    }
    return result;
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
              ? reachableScripts(mapId, script(mapId, entry.script), groups)
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
    reachableScripts,
    distances: new Map(),
  });
}

export function isMapExit(game, entry) {
  if (!entry.script) return false;
  if (game.data.navigation?.maps[game.mapId])
    return project(game, game.mapId, entry.script, { followContinuations: false }).destinations.length > 0;
  return game.data.programs?.[game.resolve(entry.script)]?.ops.some(
    (op) => op[0] === "ChangeMap",
  ) || false;
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
          return requested.some((name) =>
            state.reachableScripts(game.mapId, projected, game.groups).has(name),
          );
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
  for (const { target, entry, distance } of exits) {
    if (entry?.script) {
      target.allowedDirections = ["up", "right", "down", "left"].filter(
        (direction) =>
          project(game, game.mapId, entry.script, { direction }).destinations.some(
            (dest) => distances.get(destinationKey(dest)) === distance,
          ),
      );
      // Touch exits can use facing as part of their source branch too. Walk
      // up to the selected side, then cross the trigger with that facing.
      target.approach = target.allowedDirections.length < 4;
    }
    const route = pathTo(game, target);
    if (route) return { status: "target", target, route };
  }
  return {
    status: "no-route",
    script: typeof objective === "string" ? objective : objective.id,
  };
}
