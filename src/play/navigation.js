// Read-only projections choose ordinary player routes. They never execute a
// field task, emit an event, or write a game flag.
import { storyCondition } from "./story-plan.js";
import { canVehicleLand } from "./vehicle-input.js";
import { fieldEntityVisible } from "./field-collision.js";
import { physicalNavigation, fieldGeometryKey } from "./navigation-geometry.js";

function landingRegions(game, map) {
  const ids = [4, 5].includes(game.player.vehicle)
    ? [game.player.vehicle]
    : Object.entries(game.banks.PlaySystems?.vehicles || {})
        .filter(
          ([id, vehicle]) =>
            [4, 5].includes(Number(id)) && vehicle.enabled !== false && vehicle.mapId === map.id,
        )
        .map(([id]) => Number(id));
  if (map.landingRegions) return new Set(ids.flatMap((id) => map.landingRegions[id] || []));
  if (map.id !== game.mapId || !game.map?.worldTerrain || !map.regionRuns?.[game.player.layer])
    return null;
  const key = ids.join(",") + ":" + game.player.layer;
  if (game.landingRegionsCache?.map === game.map && game.landingRegionsCache.key === key)
    return game.landingRegionsCache.regions;
  const regions = new Set();
  let start = 0;
  for (const [end, region] of map.regionRuns[game.player.layer]) {
    if (region && !regions.has(region))
      for (let cell = start; cell < end; cell++)
        if (
          ids.some((id) => canVehicleLand(game, id, cell % map.width, Math.floor(cell / map.width)))
        ) {
          regions.add(region);
          break;
        }
    start = end;
  }
  game.landingRegionsCache = { map: game.map, key, regions };
  return regions;
}

function project(
  game,
  mapId,
  name,
  {
    initializer = false,
    direction = "up",
    depth = 0,
    initialBanks = game.banks,
    previousArea = game.areaId,
    newEntry = false,
    followContinuations = true,
    startPc = 0,
    actor = null,
    position = null,
    sameMapContext = false,
    timedCallbacks = false,
    initialActors = mapId === game.mapId ? game.actors : new Map(),
  } = {},
) {
  const data = game.data,
    map = data.navigation.maps[mapId];
  let programId = data.byMap[mapId]?.[name] ?? data.global[name],
    pc = startPc;
  let locals = [...(data.programs[programId]?.locals || [])],
    stack = [];
  const banks = {},
    groups = new Set(["entity_default"]),
    destinations = [],
    scripts = new Set([name]),
    syscalls = new Set(),
    recoveries = new Set(),
    encounters = new Set(),
    scriptFrames = [],
    bindings = {},
    actorPositions = new Map(),
    actorStates = new Map();
  let player = { ...(position || (mapId === game.mapId ? game.player : {})) },
    moved = false,
    leavesMap = false;
  const result = () => ({
    groups,
    destinations,
    scripts,
    syscalls,
    recoveries,
    encounters,
    banks,
    actorPositions,
    actorStates,
    leavesMap,
    landing: moved && !leavesMap ? player : null,
  });
  const service = (child) => {
    for (const kind of child.recoveries || []) recoveries.add(kind);
    for (const id of child.encounters || []) encounters.add(id);
  };
  const setPosition = (x, y, layer) => {
    if (Number.isFinite(x) && Number.isFinite(y)) {
      player = { x, y, layer: layer > 0 ? layer - 1 : (player.layer ?? 1) };
      moved = true;
    }
  };
  const resume = () => {
    if (!scriptFrames.length) return false;
    ({ programId, pc, locals, stack } = scriptFrames.pop());
    return true;
  };
  const bank = (category) => {
    if (category === "ScriptLocalVariable") return locals;
    if (!(category in banks))
      banks[category] = {
        ...((category === "MapLocalVariable" &&
          (newEntry || (!sameMapContext && mapId !== game.mapId))) ||
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
    const [kind, i = [], r = [], s = []] = op;
    switch (kind) {
      case "Exit":
        if (resume()) break;
        return result();
      case "Return":
        if (!stack.length) {
          if (!resume()) return result();
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
        if (game.compare(read(s[0], i[0]), s[1], s[2] === "imm" ? i[1] : read(s[2], i[1])))
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
        bank(s[0])[i[0]] = kind === "SetFlag" ? 1 : kind === "ResetFlag" ? 0 : 1 - read(s[0], i[0]);
        break;
      case "SetEntities":
        groups.add(s[0]);
        break;
      case "Hide":
      case "Erase":
      case "Show":
        if (actor > 0)
          actorStates.set(actor, { ...actorStates.get(actor), visible: kind === "Show" });
        break;
      case "CueAnim":
      case "PlayAnim":
        if (actor > 0 && !s[0])
          actorStates.set(actor, {
            ...actorStates.get(actor),
            tileNormalized: Math.max(0, Math.min(1, Number(r[0] || i[0]) || 0)),
          });
        break;
      case "Select":
        bank("MessageSelection")[0] = 0;
        locals[0] = 0;
        break;
      case "SysCall":
        syscalls.add(s[0]);
        break;
      case "RemoveGil": {
        const fee = (game.data.systemTables?.product || []).find(
          (row) => Number(row.group_id) === i[0] && Number(row.content_id) === 0,
        );
        bank("MapLocalVariable")[0] = Number((game.gil || 0) >= Number(fee?.coefficient ?? i[0]));
        break;
      }
      case "RecoveryHP":
        recoveries.add("hp");
        break;
      case "RecoveryMP":
        recoveries.add("mp");
        break;
      case "BranchByLeader":
        if (game.partySlots?.[game.partyIndex]?.[0] === i[0]) pc = i[1];
        break;
      case "BranchByCharacter": {
        const present =
          i[2] === 0
            ? game.partySlots?.[game.partyIndex]?.includes(i[0])
            : Boolean(game.roster?.[i[0]] && game.roster[i[0]].enabled !== false);
        if (present === (i[1] === 0)) pc = i[3];
        break;
      }
      case "BranchByNumOfMember": {
        const count =
          i[0] === 0
            ? game.partySlots?.[game.partyIndex]?.length || 0
            : Object.values(game.roster || {}).filter((unit) => unit.enabled !== false).length;
        if (game.compare(count, s[0] || "＝", i[1])) pc = i[2];
        break;
      }
      case "BranchByPlayerDirection":
        pc = i[["up", "right", "down", "left"].indexOf(direction)] ?? pc;
        break;
      case "SetPuppet":
        bindings[i[0]] = { actor: i[1], pc: i[2] };
        break;
      case "ExecPuppet":
        if (i[0] === 0 && depth < 16)
          for (const binding of Object.values(bindings)) {
            if (![-1001, -1010].includes(binding.actor) && binding.actor <= 0) continue;
            const isPlayer = [-1001, -1010].includes(binding.actor);
            const initialPosition = isPlayer
              ? player
              : {
                  ...(map.geometry?.entities.find(
                    (entry) => String(entry.id) === String(binding.actor),
                  ) || map.entries.find((entry) => String(entry.id) === String(binding.actor))),
                  ...initialActors?.get(String(binding.actor)),
                  ...actorPositions.get(binding.actor),
                };
            const child = project(game, mapId, data.programs[programId].name, {
              actor: binding.actor,
              startPc: binding.pc,
              position: initialPosition,
              depth: depth + 1,
              initialBanks: { ...initialBanks, ...banks },
              previousArea: map.areaId,
              sameMapContext: true,
              direction,
              timedCallbacks,
              initialActors: new Map([
                ...(initialActors || []),
                ...[...actorStates].map(([id, value]) => [String(id), value]),
              ]),
            });
            if (child.landing) {
              if (isPlayer) {
                player = child.landing;
                moved = true;
              } else actorPositions.set(binding.actor, child.landing);
            }
            for (const [id, position] of child.actorPositions) actorPositions.set(id, position);
            for (const [id, value] of child.actorStates)
              actorStates.set(id, { ...actorStates.get(id), ...value });
            Object.assign(banks, child.banks);
            destinations.push(...child.destinations);
            for (const name of child.syscalls) syscalls.add(name);
            service(child);
          }
        for (const key of Object.keys(bindings)) delete bindings[key];
        break;
      case "SetPos":
        if (actor === null || actor > 0 || [-1001, -1010].includes(actor)) {
          if (i[3] === 1 && [-1001, -1010].includes(i[4]))
            setPosition(Math.floor(player.x) + i[0], Math.floor(player.y) + i[1], i[2]);
          else if (i[3] !== 1)
            setPosition(i[0] < 0 ? player.x : i[0], i[1] < 0 ? player.y : i[1], i[2]);
        }
        break;
      case "Lerp":
      case "Route":
        if (actor === null || actor > 0 || [-1001, -1010].includes(actor))
          setPosition(i[0], i[1], i[2]);
        break;
      case "Move":
      case "MoveBirdView":
        if (actor === null || actor > 0 || [-1001, -1010].includes(actor)) {
          const [dx, dy] = [
            [0, -1],
            [1, 0],
            [0, 1],
            [-1, 0],
          ][i[0]] || [0, 0];
          setPosition(Math.floor(player.x) + dx * i[1], Math.floor(player.y) + dy * i[1], 0);
        }
        break;
      case "ChangeMap":
        leavesMap = true;
        if (s[0]) scripts.add(s[0]);
        {
          const transitionIndex = destinations.length;
          destinations.push({ mapId: i[0], entrance: i[1] });
          // Temporary camera/staging maps return through their authored scene
          // continuation. Include that source chain in the route graph; walking
          // still enters the real first trigger and executes every transition.
          if (followContinuations && s[0] && depth < 16 && data.navigation.maps[i[0]]) {
            const next = project(game, i[0], s[0], {
              direction,
              depth: depth + 1,
              initialBanks: { ...initialBanks, ...banks },
              previousArea: map.areaId,
              newEntry: true,
              position: data.navigation.maps[i[0]].entrances[i[1]],
              timedCallbacks,
            });
            // A forced continuation owns this staging map until its next map
            // transition. It never grants the player free access to its doors.
            if (next.leavesMap || next.landing) destinations.splice(transitionIndex, 1);
            destinations.push(...next.destinations);
            for (const name of next.scripts) scripts.add(name);
            for (const name of next.syscalls) syscalls.add(name);
            service(next);
            Object.assign(banks, next.banks);
            if (next.landing) destinations.push({ mapId: i[0], position: next.landing });
          }
          return result();
        }
      case "Encount":
      case "EncountBoss":
        encounters.add(i[0]);
        if (timedCallbacks && kind === "Encount")
          for (const id of i.slice(1, 4)) if (id > 0) encounters.add(id);
        if (s[0]) {
          scripts.add(s[0]);
          if (followContinuations && depth < 16) {
            const next = project(game, mapId, s[0], {
              direction,
              depth: depth + 1,
              initialBanks: { ...initialBanks, ...banks },
              previousArea: map.areaId,
              sameMapContext: true,
              position: player,
              timedCallbacks,
            });
            destinations.push(...next.destinations);
            if (next.destinations.some((dest) => dest.entrance !== undefined)) leavesMap = true;
            for (const name of next.scripts) scripts.add(name);
            for (const name of next.syscalls) syscalls.add(name);
            service(next);
            Object.assign(banks, next.banks);
            if (next.landing) destinations.push({ mapId, position: next.landing });
          }
          return result();
        }
        break;
      case "SetTimer":
        // Preparation may look ahead through a source-owned timer, including
        // its battle continuations. A forecast never starts the timer or uses
        // its future map/flag changes as a navigation shortcut.
        if (timedCallbacks && s[0] && depth < 16)
          service(
            project(game, mapId, s[0], {
              direction,
              depth: depth + 1,
              initialBanks: { ...initialBanks, ...banks },
              previousArea: map.areaId,
              sameMapContext: true,
              position: player,
              timedCallbacks,
            }),
          );
        break;
      case "ChangeScript": {
        scripts.add(s[0]);
        if (initializer && /^sc_e_/.test(s[0])) return result();
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
  return result();
}

function navigationState(game) {
  const signature = JSON.stringify([
    game.mapId,
    game.areaId,
    game.partySlots,
    game.gil,
    game.player.vehicle,
    Object.entries(game.banks.PlaySystems?.vehicles || {})
      .filter(([id]) => [4, 5].includes(Number(id)))
      .map(([id, value]) => [
        id,
        value.mapId,
        value.enabled,
        Number(id) === game.player.vehicle ? null : [value.x, value.y, value.layer],
      ]),
    Object.values(game.roster || {})
      .filter((unit) => unit.enabled !== false)
      .map((unit) => unit.id),
    Object.fromEntries(Object.entries(game.banks).filter(([name]) => !name.startsWith("Play"))),
    [...game.groups],
    fieldGeometryKey(game),
  ]);
  if (game.navigationCache?.signature === signature) return game.navigationCache;
  const maps = new Map(),
    projections = new Map(),
    geometry = new Map();
  const script = (mapId, name, initializer = false, position = null) => {
    const key = `${mapId}:${name}:${initializer}:${position?.x},${position?.y},${position?.layer}`;
    if (!projections.has(key)) {
      const one = project(game, mapId, name, { initializer, position });
      if (!initializer) {
        for (const direction of ["right", "down", "left"]) {
          const extra = project(game, mapId, name, { direction, position });
          for (const dest of extra.destinations)
            if (
              !one.destinations.some(
                (d) =>
                  d.mapId === dest.mapId &&
                  d.entrance === dest.entrance &&
                  JSON.stringify(d.position) === JSON.stringify(dest.position),
              )
            )
              one.destinations.push(dest);
          if (
            extra.landing &&
            position &&
            (extra.landing.x !== position.x ||
              extra.landing.y !== position.y ||
              extra.landing.layer !== position.layer)
          )
            one.destinations.push({ mapId, position: extra.landing });
          for (const target of extra.scripts) one.scripts.add(target);
          for (const name of extra.syscalls) one.syscalls.add(name);
          for (const kind of extra.recoveries || []) one.recoveries.add(kind);
          for (const id of extra.encounters || []) one.encounters.add(id);
          for (const group of extra.groups) one.groups.add(group);
        }
      }
      projections.set(key, one);
    }
    return projections.get(key);
  };
  const mapFor = (mapId) => {
    if (!geometry.has(mapId)) {
      const map = game.data.navigation.maps[mapId];
      if (!map) return null;
      const initialized = script(mapId, map.initializer, true);
      geometry.set(mapId, physicalNavigation(game, map, initialized));
    }
    return geometry.get(mapId);
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
        const next = script(mapId, entry.script, false, entry);
        for (const name of next.scripts) result.add(name);
        pending.push(...next.groups);
      }
    }
    return result;
  };
  const entries = (mapId) => {
    if (!maps.has(mapId)) {
      const map = mapFor(mapId);
      if (!map) return [];
      const initialized = script(mapId, map.initializer, true);
      const groups = mapId === game.mapId ? game.groups : initialized.groups;
      maps.set(
        mapId,
        map.entries
          .filter((entry) => groups.has(entry.group))
          .map((sourceEntry) => {
            const position = initialized.actorPositions.get(Number(sourceEntry.id));
            const entry =
              position && mapId !== game.mapId && !map.geometry
                ? {
                    ...sourceEntry,
                    ...position,
                    regions: entryRegions(map, { ...sourceEntry, ...position }),
                  }
                : sourceEntry;
            const projected = entry.script ? script(mapId, entry.script, false, entry) : null,
              destinations = entry.destination
                ? [entry.destination]
                : [...(projected?.destinations || [])];
            if (
              projected?.landing &&
              (projected.landing.x !== entry.x ||
                projected.landing.y !== entry.y ||
                projected.landing.layer !== entry.layer)
            )
              destinations.push({ mapId, position: projected.landing });
            return {
              ...entry,
              destinations,
              syscalls: projected?.syscalls || new Set(),
              projectedBanks: projected?.banks || {},
              recoveries: projected?.recoveries || new Set(),
              encounters: projected?.encounters || new Set(),
              scripts: projected ? reachableScripts(mapId, projected, groups) : new Set(),
            };
          }),
      );
    }
    return maps.get(mapId);
  };
  return (game.navigationCache = {
    signature,
    entries,
    map: mapFor,
    script,
    reachableScripts,
    distances: new Map(),
    stateTravels: new Map(),
  });
}

export function isMapExit(game, entry) {
  if (!entry.script) return false;
  if (game.data.navigation?.maps[game.mapId])
    return (
      project(game, game.mapId, entry.script, { followContinuations: false }).destinations.length >
      0
    );
  return (
    game.data.programs?.[game.resolve(entry.script)]?.ops.some((op) => op[0] === "ChangeMap") ||
    false
  );
}

function pointRegions(map, point) {
  if (point.x < 0 || point.y < 0 || point.x >= map.width || point.y >= map.height) return [];
  const runs = map.regionRuns?.[point.layer] || map.regionRuns?.[0],
    cell = Math.round(point.y) * map.width + Math.round(point.x);
  if (runs) {
    let low = 0,
      high = runs.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (runs[mid][0] <= cell) low = mid + 1;
      else high = mid;
    }
    return runs[low]?.[1] ? [runs[low][1]] : [];
  }
  return (
    Object.values(map.entrances).find(
      (entrance) =>
        entrance.x === point.x && entrance.y === point.y && entrance.layer === point.layer,
    )?.regions || []
  );
}

function entryRegions(map, entry) {
  const regions = new Set(pointRegions(map, entry));
  if ([3, 5, 6, 7, 8, 10, 17].includes(entry.kind))
    for (const [dx, dy] of [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ]) {
      const near = { ...entry, x: entry.x + dx, y: entry.y + dy };
      const adjacent = pointRegions(map, near);
      for (const region of adjacent) regions.add(region);
      if (!adjacent.length && [5, 6, 7, 8, 10, 17].includes(entry.kind))
        for (const region of pointRegions(map, {
          ...entry,
          x: entry.x + dx * 2,
          y: entry.y + dy * 2,
        }))
          regions.add(region);
    }
  return [...regions];
}

export function routeToStory(
  game,
  objective,
  pathTo,
  {
    allowStateTravel = true,
    avoidBattles = typeof objective === "object" &&
      Boolean(objective.rest || objective.shops?.length),
  } = {},
) {
  const navigation = game.data.navigation;
  if (!navigation) return { status: "no-navigation" };
  const requested =
    typeof objective === "string"
      ? [objective]
      : [...(objective.scripts || []), ...(objective.after || [])];
  const state = navigationState(game),
    entriesFor = (id) =>
      state.entries(id).filter((entry) => !avoidBattles || !entry.encounters.size),
    matches = (entry) =>
      requested.some((name) => entry.scripts?.has(name)) ||
      (typeof objective !== "string" &&
        (objective.syscalls?.some((name) => entry.syscalls?.has(name)) ||
          objective.shops?.includes(entry.productGroup) ||
          (objective.rest && !entry.encounters?.size && entry.recoveries?.has(objective.rest))));
  const actual = (entry) => {
    const source = game.entities.find((e) => e.id === entry.id && e.script === entry.script);
    if (!source) return null;
    const actor = game.actors.get(String(source.id));
    return !fieldEntityVisible(game, source)
      ? null
      : {
          ...source,
          ...(actor ? { x: actor.x, y: actor.y, layer: actor.layer } : {}),
        };
  };
  const movingInput = (entry, target) => {
    const actor = game.actors.get(String(target.id)),
      task = game.assignedRouteTasks?.get(Number(target.id));
    if (!actor || !task || task.done) return null;
    if (actor.routeLoop && entry.routePoints?.length) {
      const options = entry.routePoints
        .map((point) => ({ target: { ...target, ...point }, route: null }))
        .map((value) => ({ ...value, route: pathTo(game, value.target) }))
        .filter((value) => value.route)
        .sort((a, b) => a.route.length - b.route.length);
      if (!options.length) return null;
      if (options[0].route.length) return { status: "target", ...options[0] };
    }
    return { status: "wait-npc", target };
  };
  const local = entriesFor(game.mapId);
  for (const entry of local.filter(matches)) {
    const target = actual(entry);
    if (!target) continue;
    // An authored NPC route can still be crossing cells. Leaving the map
    // here would restart it before its final source variable write.
    const moving = game.actors.get(String(target.id));
    if (
      moving &&
      game.assignedRouteTasks?.get(Number(target.id))?.done === false &&
      !moving.routeLoop
    )
      return { status: "wait-npc", target };
    if (entry.script && [5, 6, 7, 8, 10, 17].includes(entry.kind)) {
      const directions = ["up", "right", "down", "left"].map((direction) => {
        const projected = project(game, game.mapId, entry.script, {
          direction,
          position: target,
        });
        return {
          direction,
          completes:
            typeof objective !== "string" &&
            storyCondition(
              {
                ...game,
                banks: { ...game.banks, ...projected.banks },
                history: [...game.history, ...[...projected.scripts].map((script) => ({ script }))],
              },
              objective.complete,
            ),
          reaches:
            requested.some((name) =>
              state.reachableScripts(game.mapId, projected, game.groups).has(name),
            ) || matches(projected),
        };
      });
      // Some scripts keep their name on an immediate direction-guarded Exit.
      // Prefer source branches that actually produce the objective's state;
      // the projection is a copy and the real player still has to interact.
      const completing = directions.filter((value) => value.completes);
      target.allowedDirections = (
        completing.length ? completing : directions.filter((value) => value.reaches)
      ).map((value) => value.direction);
    }
    const route = pathTo(game, target);
    if (route) return { status: "target", target, route };
    const routeMotion = movingInput(entry, target);
    if (routeMotion) return routeMotion;
  }
  // Some source scenes update flags but deliberately leave their old entities
  // alive until the next map entry. Walk out and back through normal portals
  // when that initializer would publish the requested input.
  const currentMap = state.map(game.mapId);
  if (currentMap) {
    const fresh = project(game, game.mapId, currentMap.initializer, {
      initializer: true,
      newEntry: true,
    });
    const refreshedTarget =
      matches(fresh) ||
      currentMap.entries.some(
        (entry) =>
          !game.groups.has(entry.group) &&
          fresh.groups.has(entry.group) &&
          (matches(entry) ||
            (entry.script && matches(state.script(game.mapId, entry.script, false, entry)))),
      );
    if (refreshedTarget) {
      const doors = local
        .filter((entry) => entry.kind === 3 && entry.destination?.mapId !== game.mapId)
        .map((entry) => actual(entry))
        .filter(Boolean)
        .map((target) => ({ target, route: pathTo(game, target) }))
        .filter((value) => value.route)
        .sort((a, b) => a.route.length - b.route.length);
      if (doors.length) return { status: "target", ...doors[0], refresh: true };
    }
  }
  const intersects = (a, b) => a?.some((region) => b?.includes(region));
  const cacheKey = JSON.stringify([objective, avoidBattles]);
  if (!state.distances.has(cacheKey)) {
    const reverse = new Map(),
      distances = new Map(),
      queue = [],
      virtual = new Map();
    const destinationKey = (dest) => {
      const map = state.map(dest.mapId);
      if (dest.position)
        return `${dest.mapId}:p:${dest.position.x},${dest.position.y},${dest.position.layer}`;
      const entrance = map?.entrances[dest.entrance]
        ? dest.entrance
        : Object.keys(map?.entrances || {})[0] || 0;
      return `${dest.mapId}:${entrance}`;
    };
    for (const map of Object.keys(navigation.maps).map((id) => state.map(Number(id))))
      for (const entry of entriesFor(map.id))
        for (const dest of entry.destinations)
          if (dest.position && navigation.maps[dest.mapId]) {
            const key = destinationKey(dest),
              regions = pointRegions(state.map(dest.mapId), dest.position);
            if (!regions.length) continue;
            virtual.set(key, { mapId: dest.mapId, point: { ...dest.position, regions } });
          }
    for (const map of Object.keys(navigation.maps).map((id) => state.map(Number(id)))) {
      const entries = entriesFor(map.id),
        initial = state.script(map.id, map.initializer, true);
      const autoTarget =
        matches(initial) ||
        (typeof objective !== "string" &&
          objective.action === "visit-map" &&
          objective.maps?.includes(map.id));
      const entrances = Object.keys(map.entrances).length
        ? Object.entries(map.entrances)
        : [[0, { regions: [] }]];
      for (const [key, value] of virtual)
        if (value.mapId === map.id)
          entrances.push([key.slice(String(map.id).length + 1), value.point]);
      for (const [id, entrance] of entrances) {
        const from = `${map.id}:${id}`;
        const flight =
          map.world &&
          (([4, 5].includes(game.player.vehicle) && game.mapId === map.id) ||
            Object.entries(game.banks.PlaySystems?.vehicles || {}).some(
              ([id, vehicle]) =>
                [4, 5].includes(Number(id)) &&
                vehicle.mapId === map.id &&
                vehicle.enabled !== false &&
                intersects(entrance.regions, pointRegions(map, vehicle)),
            ));
        const reachable = entries.filter(
          (entry) =>
            (flight &&
              (!landingRegions(game, map) ||
                intersects(entry.regions, [...landingRegions(game, map)]))) ||
            (!entrance.regions.length && !map.regionRuns) ||
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
    .filter(
      (entry) =>
        !currentMap?.world ||
        ![4, 5].includes(game.player.vehicle) ||
        !landingRegions(game, currentMap) ||
        intersects(entry.regions, [...landingRegions(game, currentMap)]),
    )
    .map((entry) => ({
      entry,
      target: actual(entry),
      distance: Math.min(
        ...entry.destinations.map((dest) => distances.get(destinationKey(dest)) ?? Infinity),
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
      target.allowedDirections = ["up", "right", "down", "left"].filter((direction) => {
        const projected = project(game, game.mapId, entry.script, { direction, position: target });
        return (
          projected.destinations.some((dest) => distances.get(destinationKey(dest)) === distance) ||
          (projected.landing &&
            distances.get(destinationKey({ mapId: game.mapId, position: projected.landing })) ===
              distance)
        );
      });
      // Touch exits can use facing as part of their source branch too. Walk
      // up to the selected side, then cross the trigger with that facing.
      if (![5, 6, 7, 8, 10, 17].includes(target.kind))
        target.approach = target.allowedDirections.length < 4;
    }
    const route = pathTo(game, target);
    if (route) return { status: "target", target, route };
    const routeMotion = movingInput(entry, target);
    if (routeMotion) return routeMotion;
    // The world graph can use a parked airship to connect distant land
    // regions. If that best exit has no foot path, ask the ordinary vehicle
    // controller to board instead of choosing a worse town exit and looping.
    if (
      currentMap?.world &&
      ![4, 5].includes(game.player.vehicle) &&
      (!landingRegions(game, currentMap) ||
        intersects(entry.regions, [...landingRegions(game, currentMap)])) &&
      Object.entries(game.banks.PlaySystems?.vehicles || {}).some(
        ([id, vehicle]) =>
          [4, 5].includes(Number(id)) &&
          vehicle.enabled !== false &&
          vehicle.mapId === game.mapId &&
          pathTo(game, { ...vehicle, id: `board:${id}`, kind: 6 }) !== null,
      )
    )
      return { status: "no-route", requiresVehicle: true };
  }
  if (allowStateTravel) {
    const travel = stateChangingTravel(game, objective, pathTo, state, avoidBattles);
    if (travel) return travel;
  }
  return {
    status: "no-route",
    script: typeof objective === "string" ? objective : objective.id,
  };
}

// A transport can return to the same room after changing which world exit
// that room exposes. Consider that source transaction, then plan the remaining
// route against a copy. The live game still walks to the operator, chooses the
// dialogue option and runs the original journey before the graph is rebuilt.
function stateChangingTravel(game, objective, pathTo, state, avoidBattles) {
  const key = JSON.stringify([objective, avoidBattles]);
  if (state.stateTravels.has(key)) {
    const script = state.stateTravels.get(key);
    return script
      ? {
          ...routeToStory(game, { scripts: [script] }, pathTo, {
            allowStateTravel: false,
            avoidBattles,
          }),
          transport: true,
        }
      : null;
  }
  for (const map of Object.values(game.data.navigation.maps))
    for (const entry of state.entries(map.id)) {
      if (
        !entry.script ||
        ![5, 6, 17].includes(entry.kind) ||
        entry.encounters.size ||
        !entry.destinations.some((destination) => destination.mapId === map.id)
      )
        continue;
      const changes = Object.entries(entry.projectedBanks).some(
        ([category, values]) =>
          /^ScenarioFlag/.test(category) &&
          Object.entries(values).some(
            ([key, value]) => value !== Number(game.banks[category]?.[key] || 0),
          ),
      );
      if (!changes) continue;
      const after = Object.assign(Object.create(game), {
        banks: { ...game.banks, ...entry.projectedBanks },
        mapId: map.id,
        areaId: map.areaId,
        navigationCache: null,
        actors: new Map(),
        map,
      });
      const initialized = project(after, map.id, map.initializer, {
        initializer: true,
        newEntry: true,
      });
      after.groups = initialized.groups;
      after.entities = (map.geometry?.entities || map.entries)
        .filter((entity) => after.groups.has(entity.group))
        .map((entity) => {
          const position = initialized.actorPositions.get(Number(entity.id));
          const state = initialized.actorStates.get(Number(entity.id));
          return { ...entity, ...position, ...state };
        });
      after.actors = new Map(after.entities.map((entity) => [String(entity.id), { ...entity }]));
      after.actorEntitySource = after.entities;
      const destination = entry.destinations.find((destination) => destination.mapId === map.id);
      const point = destination.position || map.entrances[destination.entrance];
      if (!point) continue;
      after.player = { ...game.player, ...point };
      const afterMap = physicalNavigation(after, map, initialized);
      const regions = destination.position
        ? pointRegions(afterMap, point)
        : afterMap.entrances[destination.entrance]?.regions || [];
      const probePath = (_game, target) =>
        regions.some((region) =>
          (target.regions || entryRegions(afterMap, target)).includes(region),
        )
          ? []
          : null;
      const onward = routeToStory(after, objective, probePath, {
        allowStateTravel: false,
        avoidBattles,
      });
      if (onward.status !== "target") continue;
      const input = routeToStory(game, { scripts: [entry.script] }, pathTo, {
        allowStateTravel: false,
        avoidBattles,
      });
      if (input.status === "target" || input.status === "wait-npc") {
        state.stateTravels.set(key, entry.script);
        return { ...input, transport: true };
      }
    }
  state.stateTravels.set(key, null);
  return null;
}

// Player preparation may inspect the imminent source encounter, but still has
// to walk, train and interact through normal inputs. This projection neither
// starts that script nor changes its flags or the party's attributes.
export function encountersForInput(game, input) {
  const target = input?.target,
    name = target?.script || target?.npc?.interaction?.script;
  if (!game.data.navigation?.maps[game.mapId]) return [];
  const ids = new Set();
  const destinations = target?.destination ? [target.destination] : [];
  const upcoming = [];
  let point = { ...game.player };
  const steps = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] };
  for (const direction of input?.route || []) {
    const [dx, dy] = steps[direction] || [0, 0];
    point = { ...point, x: point.x + dx, y: point.y + dy };
    for (const entity of game.entities || []) {
      const actual = { ...entity, ...game.actors.get(String(entity.id)) };
      if (
        actual.visible === false ||
        (actual.layer != null && actual.layer !== point.layer) ||
        Math.abs(actual.x - point.x) > 0.6 ||
        Math.abs(actual.y - point.y) > 0.6
      )
        continue;
      if (entity.kind === 4 && entity.destinationLayer != null)
        point.layer = entity.destinationLayer;
      if (
        entity.kind === 2 &&
        entity.script &&
        !game.triggered?.has(`${game.mapId}:${[...game.groups].join(",")}:${entity.id}`)
      )
        upcoming.push({ ...actual, direction });
    }
  }
  for (const trigger of upcoming) {
    const preview = project(game, game.mapId, trigger.script, {
      direction: trigger.direction,
      position: trigger,
      timedCallbacks: true,
    });
    for (const id of preview.encounters) ids.add(id);
    destinations.push(...preview.destinations);
  }
  if (name)
    for (const direction of target.allowedDirections?.length
      ? target.allowedDirections
      : ["up", "right", "down", "left"]) {
      const preview = project(game, game.mapId, name, {
        direction,
        position: target,
        timedCallbacks: true,
      });
      for (const id of preview.encounters) ids.add(id);
      destinations.push(...preview.destinations);
    }
  const seen = new Set();
  for (let head = 0; head < destinations.length && head < 16; head++) {
    const destination = destinations[head],
      map = game.data.navigation.maps[destination.mapId];
    const key = `${destination.mapId}:${destination.entrance}`;
    if (!map?.initializer || seen.has(key)) continue;
    seen.add(key);
    const preview = project(game, map.id, map.initializer, {
      newEntry: true,
      previousArea: game.areaId,
      position: destination.position || map.entrances[destination.entrance],
      timedCallbacks: true,
    });
    for (const id of preview.encounters) ids.add(id);
    destinations.push(...preview.destinations);
  }
  return [...ids];
}
