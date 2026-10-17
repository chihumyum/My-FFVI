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
