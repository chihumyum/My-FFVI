// Named regression inputs, recorded from real manual play. These are deliberately
// fixed routes: no NPC chasing, path search, game-flag edits or script dispatch.
import { pendingEventInput } from "./event-systems.js";
const trenchRoutes = [
  [379, false, [44, 20, 1], "U5 L1 U7"],
  [380, false, [25, 19, 1], "U2 L1 U1 L9 U10"],
  [381, false, [58, 34, 1], "U3 L4 D1 L1 D1 L1 D1 L1 D2 R2 D1 R1 D3 R3 D6 L2"],
  [381, true, [55, 46, 1], "U1 R2 U5 L3 U3 L4 D5 L1"],
  [382, false, [14, 19, 1], "D2 L3 D7 R3 D2 R1 D1 R1 D1 R3 D8 L6 U2 L4 U2"],
];
const operaRoutes = [
  [115, [120, 27, 1], "D3 L4 D1 L1 D1 L2 D2 R1 D3"],
  [114, [30, 26, 1], "D7 L2 D1 L4 D2 L1 D2 R1 D6 L12 U6 R1 U4 L1 U1 L4 U1 L2 U8"],
  [116, [117, 16, 1], "U1 R1 U2 L1 U1 L1 U1 L1 U3 R2 U2"],
  [117, [6, 17, 2], "U5 R2 D4 R3 D2 R2 U3 R5 U1 R1 U2 L6 U3 L2 U2 R3"],
];
const sealedCaveRoutes = [
  [162, [7, 17, 1], "U6 R3 U1 R1 U2 L1 U1 L1 U1 L1 U1 L1 U2 R19 D10 R2 U1 R3"],
  [1, [167, 194, 0], "R2"],
  [405, [25, 37, 1], "U2 R5 D4 R1 D4"],
  [406, [50, 43, 1], "D3 R3 D12"],
  [407, [6, 3, 1], "R2 D1 R8 D6 R3 D3 L1 D2"],
];
const burningHouseRoutes = [
  [412, [7, 14, 1], "U8"],
  [413, [9, 18, 1], "U6 L2 U6"],
  [414, [14, 21, 1], "U2 L7 U1 L1 U9 R7 U1 R1 U2"],
  [415, [7, 12, 1], "U3 R1 U1 R1 U2"],
  [417, [10, 12, 1], "U3 L2 U1 L1 U2"],
  [419, [7, 11, 1], "U5"],
];
const continentRoutes = [
  [572, [10, 23, 2], "U2 R9 U1"],
  [573, [19, 20, 2], "U2 R2 U1 R1 U1 R4 D5 L1 D2 L2 D4 R2"],
  [577, [25, 27, 2], "R1 U3 R2 U1 R4 D1"],
  [574, [40, 16, 2], "D4"],
  [578, [40, 20, 2], "D1 L2 D1 L3 D1 L2 D2 L1 D8 R2 D3"],
  [582, [34, 36, 2], "U1 L4 D3 R1 D1 R6 D1 R1 D1 R4 D2 R4 U1 R1 U3 R13 D5 R3 U5"],
  [581, [40, 34, 2], "U2"],
  [590, [63, 41, 2], "U5"],
  [592, [63, 36, 2], "U4 L1 U1 L2 U7"],
];
const towerPlatformRoutes = [
  [542, [43, 21, 1], "R6 D8 L4 U1 L2 U1 L4"],
  [553, [17, 52, 1], "U9 L5 D1 L1 D13 L2 D1 L1 D1 L1 D1"],
  [554, [86, 49, 1], "D10 L5 D1"],
  [555, [15, 11, 1], "D6 L2 D1 L2 U1 L4 U1 L2 U1 L1 U4 R2 U1 R1 U1 R1 U1 R1 U1 R3 U1"],
  [556, [18, 14, 1], "U4 L2 D3 L5"],
  [556, [11, 11, 1], "U3 L5"],
  [542, [17, 35, 1], "D4 L1 D7 R1 D4"],
  [542, [16, 47, 1], "R1 D3"],
  [560, [89, 9, 1], "D1 L1 D4 L1"],
];
const expand = (steps) =>
  steps
    .split(" ")
    .flatMap((step) =>
      Array(Number(step.slice(1))).fill({ U: "up", R: "right", D: "down", L: "left" }[step[0]]),
    );

function recordedWalk(game, x, y, layer, directions, route) {
  const deltas = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] };
  for (const direction of directions) {
    if (game.player.x === x && game.player.y === y && game.player.layer === layer) {
      game.move(direction);
      return { status: "fixed-input", route, direction };
    }
    x += deltas[direction][0];
    y += deltas[direction][1];
    const stair = game.entities.find(
      (entity) => entity.kind === 4 && entity.x === x && entity.y === y && entity.layer === layer,
    );
    if (stair?.destinationLayer != null) layer = stair.destinationLayer;
  }
  return null;
}

export function fixedStoryInput(game, objective) {
  if (objective.id === "tower-platform") {
    // The second party reaches the right-hand switch through the prison and
    // ladder. Crossing the centre room's still-closed side barriers is invalid.
    if (game.partyIndex !== 1) {
      game.switchParty();
      return { status: "fixed-input", route: "tower-platform", action: "switch-party" };
    }
    for (const [map, start, steps] of towerPlatformRoutes) {
      if (map !== game.mapId) continue;
      const walking = recordedWalk(game, ...start, expand(steps), "tower-platform");
      if (walking) return walking;
    }
    if (game.mapId === 556 && game.player.x === 11 && game.player.y === 13) {
      game.move("up");
      if (!game.busy) game.confirm();
      return { status: "fixed-input", route: "tower-platform", action: "climb-ladder" };
    }
  }
  if (objective.id === "figaro-engine-approach" && game.mapId === 454)
    return recordedWalk(
      game,
      32,
      44,
      1,
      expand("R1 D1 R1 D3 R2 D1 R1 D4 L3 D1 L11 D1 L2 D2"),
      "figaro-engine-passage",
    );
  if (
    objective.id === "cid-care" &&
    game.mapId === 191 &&
    (game.groups.has("ev_e_0610") ||
      (game.banks.ScenarioFlag3?.[13] === 1 && !game.groups.has("ev_e_0627")))
  ) {
    const waiting = pendingEventInput(game);
    if (waiting) return { ...waiting, route: "cid-house-reentry" };
    return (
      recordedWalk(game, 99, 38, 1, expand("D7 R1 D1"), "cid-house-reentry") ||
      recordedWalk(game, 101, 38, 1, expand("D7 L1 D1"), "cid-house-reentry")
    );
  }
  if (objective.id === "atma-weapon" && game.mapId === 431) {
    const route = continentRoutes.find(
      ([source]) => !game.history.some((entry) => entry.script === `sc_e_0${source}`),
    );
    if (route) {
      const walking = recordedWalk(game, ...route[1], expand(route[2]), "floating-continent");
      if (walking) return walking;
      const direction =
        route[0] === 578 && game.player.x === 34 && game.player.y === 36
          ? "right"
          : route[0] === 592 && game.player.x === 60 && game.player.y === 24
            ? "up"
            : null;
      if (direction) {
        game.move(direction);
        if (!game.busy) game.confirm();
        return { status: "fixed-input", route: "floating-continent", action: `talk-${direction}` };
      }
    }
  }
  if (objective.id === "approach-continent" && game.mapId === 119) {
    const waiting = pendingEventInput(game);
    if (waiting) return { ...waiting, route: "blackjack-interception" };
  }
  if (objective.id === "flame-eater") {
    const route = burningHouseRoutes.find(([map]) => map === game.mapId);
    if (route) return recordedWalk(game, ...route[1], expand(route[2]), "thamasa-burning-house");
  }
  if (objective.id === "sealed-gate" && game.mapId === 408) {
    if (game.banks.MapLocalVariable?.[1] === 1)
      return recordedWalk(
        game,
        104,
        17,
        1,
        expand("R6 U1 R1 U4 R1 U2 R5 D2 R1 D1 R1 D1 R1 D4 R1 D5"),
        "sealed-cave-lever-exit",
      );
    const walking = recordedWalk(
      game,
      71,
      15,
      2,
      expand("R5 D12 R2 D1 R1 D4 R3 U1 R1 U6 R1 U5 R15 D6 R1 D1 R2 U1 R3 U9 L1"),
      "sealed-cave-lever",
    );
    if (walking) return walking;
    if (game.player.x === 104 && game.player.y === 17 && game.player.layer === 1) {
      game.move("up");
      if (!game.busy) game.confirm();
      return { status: "fixed-input", route: "sealed-cave-lever", action: "talk-up" };
    }
  }
  if (objective.id === "sealed-cave-bridge") {
    const route = sealedCaveRoutes.find(([map]) => map === game.mapId);
    if (route) return recordedWalk(game, ...route[1], expand(route[2]), "sealed-cave-bridges");
  }
  if (objective.id === "imperial-base" && game.mapId === 3)
    return recordedWalk(
      game,
      18,
      24,
      1,
      expand("L2 U2 L2 U4 R9 D9 R7 D5 R3 D3 R6 D16 R2 D1 R1 D9 R1 D2"),
      "narshe-south-exit",
    );
  if (objective.id === "factory-crates" && game.mapId === 143)
    return recordedWalk(game, 44, 41, 1, expand("U1 L2 U2 R1"), "vector-factory-crates");
  if (objective.id === "opera-rafters") {
    const route = operaRoutes.find(([map]) => map === game.mapId);
    if (route) {
      const walking = recordedWalk(game, ...route[1], expand(route[2]), "opera-rafters");
      if (walking) return walking;
    }
    if (game.mapId === 117 && game.player.x === 14 && game.player.y === 7) {
      game.move("right");
      if (!game.busy) game.confirm();
      return { status: "fixed-input", route: "opera-rafters", action: "talk-right" };
    }
  }
  if (objective.id === "nikeah-ferry") {
    const drained = game.history.some((entry) => entry.script === "sc_e_1069");
    const route = trenchRoutes.find(
      ([map, afterDrain]) => map === game.mapId && (map !== 381 || afterDrain === drained),
    );
    if (route) return recordedWalk(game, ...route[2], expand(route[3]), "serpent-trench-drain");
  }
  if (objective.id === "cider-grandfather" && game.mapId === 38) {
    return recordedWalk(
      game,
      22,
      44,
      1,
      [
        ...Array(3).fill("left"),
        ...Array(10).fill("up"),
        ...Array(5).fill("right"),
        "down",
        ...Array(3).fill("right"),
        "up",
        ...Array(7).fill("right"),
        "down",
      ],
      "cider-grandson-house",
    );
  }
  if (objective.id === "cider-grandfather" && game.mapId === 60) {
    if (game.banks.MapLocalVariable?.[1] === 1) return null;
    const child = game.actors.get("8");
    if (
      !child ||
      child.visible === false ||
      !game.entities.some((entity) => entity.id === "8" && entity.script === "sc_e_0069")
    )
      return null;
    const steps = {
      "6,8,2": "down",
      "6,9,2": "right",
      "7,9,2": "down",
      "7,10,2": "down",
      "7,11,2": "down",
    };
    const cell = `${game.player.x},${game.player.y},${game.player.layer}`;
    if (steps[cell]) {
      game.move(steps[cell]);
      return { status: "fixed-input", route: "cider-child", direction: steps[cell] };
    }
    if (cell === "7,12,2") {
      game.move("right");
      if (!game.busy) game.confirm();
      return { status: "fixed-input", route: "cider-child", action: "talk-right" };
    }
  }
  if (
    objective.id === "jidoor-impresario" &&
    game.mapId === 611 &&
    game.player.layer === 1 &&
    game.player.x === 25
  ) {
    if (game.player.y >= 20 && game.player.y <= 27) {
      game.move("up");
      return { status: "fixed-input", route: "impresario-aisle", direction: "up" };
    }
    if (game.player.y === 19 && game.player.direction === "up") {
      game.confirm();
      return { status: "fixed-input", route: "impresario-aisle", action: "confirm-up" };
    }
  }
  return null;
}
