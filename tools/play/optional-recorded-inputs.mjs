// Literal ordinary-input acceptance routes, transcribed from the named real
// manual journals. These select fixed doors/cells and press normal controls;
// they do not search a puzzle, write game state or dispatch a source program.
import { phoenixLiteralSteps } from "./optional-phoenix-inputs.mjs";
const door = (mapId, entityId, toMap, kind = 3) => ({ mapId, entityId, kind, toMap });
const cell = (mapId, x, y, layer = 1) => ({ mapId, cell: [x, y, layer] });
const approach = (mapId, entityId, kind = 5) => ({ mapId, entityId, kind, approachOnly: true });
const press = (mapId, direction, confirm = false) => ({ mapId, moves: [direction], confirm });
const expand = (text) =>
  text
    .split(" ")
    .flatMap((part) =>
      Array(Number(part.slice(1))).fill({ U: "up", R: "right", D: "down", L: "left" }[part[0]]),
    );

function planFor(game, objective) {
  if (objective.id === "ultima-buster")
    return {
      id: "tower-gold-return-to-prison",
      source:
        "PR source hook1098 with original tower reset/re-entry; actual gold-dragon final boundary",
      starts: [551],
      steps: [
        { mapId: 551, party: 0 },
        door(542, "112", 268, 5),
        door(268, "4", 2, 5),
        door(2, "162", 542, 21),
        { mapId: 542, party: 1 },
        door(542, "22", 553),
        door(553, "1", 554),
        door(554, "2", null, 6),
      ],
    };
  if (objective.id.startsWith("phoenix-") || objective.id === "red-dragon") return phoenixPlan;
  if (
    ["veldt-rescue-relm", "shadow-cave-rescue", "shadow-striker-treasure"].includes(objective.id)
  ) {
    const steps = [
      door(488, "8", 489),
      door(489, "15", 490),
      door(490, "entity_default:0:3", 489),
      door(489, "19", 491),
      { ...door(491, "21", null, 5), unless: ["ScenarioFlag3", 21, 1] },
      door(491, "4", 492),
      door(492, "4", null, 2),
    ];
    return {
      id: "veldt-rescue",
      source: "build/play/relm-manual-ready-jidoor-journal.json",
      starts: [488, 491],
      startIndex: game.mapId === 491 ? 4 : 0,
      steps: objective.id === "shadow-striker-treasure" ? steps.slice(0, 4) : steps,
    };
  }
  if (
    [
      "owzer-flowers",
      "owzer-chair",
      "owzer-chest",
      "owzer-chest-two",
      "owzer-boss-door",
      "chadarnook",
      "relm",
      "esper-lakshmi-reward",
    ].includes(objective.id)
  )
    return {
      id: "owzer-basement",
      source: "build/play/relm-manual-recruited-journal.json",
      starts: [444],
      steps: [
        door(444, "4", 445),
        press(445, "up"),
        cell(445, 92, 51),
        door(445, "55", null, 2),
        press(445, "down"),
        press(445, "up", true),
        cell(445, 85, 58),
        press(445, "up", true),
        door(445, "56", null, 2),
        ...["43", "45", "47", "49"].map((id) => door(445, id, null, 2)),
        cell(445, 76, 52),
        press(445, "up", true),
        door(445, "57", null, 2),
        cell(445, 88, 37),
        press(445, "up", true),
        door(445, "10", 446),
      ],
    };
  if (objective.id === "gogo" && game.mapId === 502)
    return {
      id: "gogo-patrol-recovery",
      source: "build/play/gogo-manual-ceiling-entry-journal.json: actual fall/recovery branch",
      starts: [502],
      steps: [door(502, "8", null, 2), door(502, "2", 501)],
    };
  if (objective.id === "gogo")
    return {
      id: "gogo-jumps",
      source:
        "build/play/gogo-manual-ceiling-entry-journal.json; build/play/gogo-manual-recruited-journal.json",
      starts: [500, 501],
      startIndex: game.mapId === 501 ? 1 : 0,
      steps: [
        door(500, "3", 501),
        approach(501, "10"),
        press(501, "up", true),
        press(501, "up", true),
        approach(501, "entity_default:0:53"),
        press(501, "down", true),
        press(501, "down", true),
        approach(501, "21"),
        { mapId: 501, wait: 11.5 },
        press(501, "up", true),
        { mapId: 501, moves: ["left", "left", "left"] },
        press(501, "up", true),
        door(501, "6", 503),
        door(503, "entity_default:0:7", 504, 2),
        ...[
          [54, 46],
          [41, 44],
          [30, 42],
        ].flatMap(([x, y]) => [cell(504, x, y), { mapId: 504, wait: 5 }]),
        door(504, "4", 505),
        door(505, "entity_default:0:2", 506),
        approach(506, "11"),
        approach(506, "5"),
        press(506, "left", true),
        approach(506, "7"),
        press(506, "up", true),
        cell(506, 15, 48),
        press(506, "left", true),
        door(506, "2", 507),
        approach(507, "1", 6),
        press(507, "up", true),
      ],
    };
  if (objective.id === "ancient-cave")
    return {
      id: "figaro-lower-corridor",
      source:
        "build/play/ancient-manual-cave-entry-journal.json; ancient-manual-tonberry-complete-journal.json",
      starts: [250],
      steps: [
        cell(250, 29, 43, 2),
        cell(250, 35, 43, 2),
        { mapId: 250, wait: 2 },
        door(250, "6", 508),
      ],
    };
  if (objective.id.startsWith("dream-train-chest-") && objective.id !== "dream-train-chest-passage")
    return {
      id: "dream-furniture-levers",
      source:
        "build/play/cyan-collision-puzzle-levers.json; cyan-collision-puzzle-reached.json; cyan-collision-six-chests.json",
      starts: [524, 525],
      startIndex: game.mapId === 525 ? 2 : 0,
      steps: [
        door(524, "5", 522),
        door(522, "14", 525),
        ...["41", "26", "41", "32", "41", "26"].map((id) => door(525, id, null, 5)),
      ],
    };
  if (objective.id === "dream-train-cyan")
    return {
      id: "dream-train-outside",
      source: "PR map522 ev_e_0903 at88,5; original train roof walk",
      starts: [522],
      steps: [door(522, "9", 523), door(523, "entity_default:0:2", 522), cell(522, 88, 5, 0)],
    };
  if (objective.id === "gold-dragon")
    return {
      id: "gold-middle-party",
      source: "build/play/gold-dragon-manual-summary.json",
      starts: [542],
      steps: [
        { mapId: 542, party: 1 },
        door(542, "22", 553),
        door(553, "1", 554),
        door(554, "entity_default:0:11", 555, 2),
        door(555, "3", 556),
        { mapId: 556, moves: expand("U4 L2 D3 L5") },
        press(556, "up", true),
        door(556, "entity_default:0:1", 542),
        door(542, "14", 560),
        cell(560, 87, 14),
        door(560, "2", 542),
        door(542, "101", 558),
        door(558, "entity_default:0:0", 551),
        approach(551, "1", 6),
        press(551, "up", true),
      ],
    };
  return null;
}

const phoenixPlan = {
  id: "phoenix-recorded-sequence",
  source:
    "build/play/eight-dragons-phoenix-entry-plates-journal.json; phoenix-manual-jump-approach-journal.json; phoenix-manual-locke-arrival-journal.json",
  starts: [497],
  steps: phoenixLiteralSteps,
};

export function recordedOptionalInput(game, objective, states, { pathTo, followTarget }) {
  // The recorded Phoenix route exits by the original Locke event. In a
  // continuous eight-dragon case the next objective must not abandon its
  // second party inside the cave merely because Red Dragon has died.
  const phoenixState = states.get("ordinary-recorded:phoenix-recorded-sequence");
  const plan =
    phoenixState && phoenixState.index < phoenixPlan.steps.length
      ? phoenixPlan
      : planFor(game, objective);
  if (!plan) return null;
  const key = `ordinary-recorded:${plan.id}`;
  let state = states.get(key);
  if (!state) {
    if (!plan.starts.includes(game.mapId)) return null;
    state = { index: plan.startIndex || 0, journal: [], source: plan.source };
    states.set(key, state);
  }
  const recovery = states.get("ordinary-recorded:gogo-patrol-recovery");
  if (plan.id === "gogo-jumps" && game.mapId === 501 && recovery?.entered) {
    state.retries = (state.retries || 0) + 1;
    if (state.retries > 3)
      return {
        status: "recorded-boundary-mismatch",
        route: plan.id,
        reason: "Three fixed patrol retries exhausted",
      };
    state.index = 1;
    state.entered = false;
    delete state.moveIndex;
    states.delete("ordinary-recorded:gogo-patrol-recovery");
  }
  const view = () => ({
    mapId: game.mapId,
    x: game.player.x,
    y: game.player.y,
    layer: game.player.layer,
    party: game.partyIndex,
  });
  const record = (step, input) => {
    state.journal.push({
      time: game.time,
      index: state.index,
      at: view(),
      step,
      input: { ...input, result: input.result && { status: input.result.status } },
    });
    return { status: "recorded-ordinary-input", route: plan.id, index: state.index, ...input };
  };
  for (let n = 0; n < 20; n++) {
    const step = plan.steps[state.index];
    if (!step) return null;
    if (
      state.observedIndex === state.index &&
      state.script &&
      game.history.slice(state.historyStart).some((entry) => entry.script === state.script)
    ) {
      state.index++;
      state.entered = false;
      continue;
    }
    if (step.unless && Number(game.banks[step.unless[0]]?.[step.unless[1]]) === step.unless[2]) {
      state.index++;
      continue;
    }
    if (step.party !== undefined) {
      if (game.partyIndex === step.party) {
        state.index++;
        continue;
      }
      // Q may load a different real party map. Let that source transition
      // settle before the next Q; the original map is not a teleport target.
      return record(step, { action: "switch-party", accepted: game.switchParty() });
    }
    if (game.mapId !== step.mapId) {
      if (state.entered && step.toMap === game.mapId) {
        state.index++;
        state.entered = false;
        continue;
      }
      return {
        status: "recorded-boundary-mismatch",
        route: plan.id,
        index: state.index,
        expectedMap: step.mapId,
        actual: view(),
      };
    }
    if (
      step.arrived &&
      game.player.x === step.arrived[0] &&
      game.player.y === step.arrived[1] &&
      game.player.layer === step.arrived[2]
    ) {
      state.index++;
      state.entered = false;
      continue;
    }
    if (step.wait) {
      state.waitUntil ??= game.time + step.wait;
      if (game.time < state.waitUntil)
        return {
          status: "recorded-ordinary-wait",
          route: plan.id,
          remaining: state.waitUntil - game.time,
        };
      delete state.waitUntil;
      state.index++;
      continue;
    }
    if (step.switch) {
      state.index++;
      return record(step, { action: "switch-party", accepted: game.switchParty() });
    }
    if (step.confirm && !step.moves) {
      state.index++;
      return record(step, { action: "confirm", accepted: game.confirm() });
    }
    if (step.moves) {
      const direction = step.moves[state.moveIndex || 0];
      if (!direction) {
        state.index++;
        delete state.moveIndex;
        continue;
      }
      const accepted = game.move(direction);
      state.moveIndex = (state.moveIndex || 0) + 1;
      if (step.confirm && state.moveIndex === step.moves.length) game.confirm();
      return record(step, { action: "move", direction, accepted, confirm: !!step.confirm });
    }
    const source = step.cell
      ? {
          id: `literal-cell:${step.cell.join(",")}`,
          kind: 0,
          x: step.cell[0],
          y: step.cell[1],
          layer: step.cell[2],
        }
      : game.entities.find(
          (entity) =>
            String(entity.id) === String(step.entityId) &&
            (!step.kind || entity.kind === step.kind),
        );
    if (!source)
      return { status: "recorded-entity-unavailable", route: plan.id, index: state.index, step };
    const target = step.cell ? source : { ...source, ...game.actors.get(String(source.id)) };
    if (state.observedIndex !== state.index) {
      state.observedIndex = state.index;
      state.historyStart = game.history.length;
      state.script = step.approachOnly ? null : target.script;
    }
    const route = pathTo(game, target);
    if (!route)
      return {
        status: "recorded-local-path-blocked",
        route: plan.id,
        index: state.index,
        step,
        at: view(),
      };
    state.entered = true;
    if (!route.length) {
      state.index++;
      state.entered = false;
      if (step.cell) continue;
      if (step.approachOnly) return record(step, { action: "approach", targetId: source.id });
    }
    const result = followTarget(game, { status: "target", target, route });
    return record(step, { action: "target", targetId: source.id, result });
  }
  return {
    status: "recorded-boundary-mismatch",
    route: plan.id,
    reason: "Literal step budget exhausted",
  };
}

export function recordedInputJournal(states) {
  return [...states]
    .filter(([key]) => String(key).startsWith("ordinary-recorded:"))
    .map(([route, state]) => ({ route, ...state }));
}
