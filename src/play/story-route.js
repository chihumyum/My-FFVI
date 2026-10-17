import { advanceM1, pathTo } from "./m1-route.js";
import { routeToStory } from "./navigation.js";
import { randomEncounterInput, vehicleJourneyInput, prepareStoryParty } from "./story-actions.js";
import { pendingEventInput } from "./event-systems.js";
import { cooperativeStoryInput } from "./cooperative-input.js";
import { prepareFieldInput, prepareBattleReadiness } from "./field-preparation.js";
import { nextStoryObjective, storyChapters, storyCondition } from "./story-plan.js";
import { fixedStoryInput } from "./fixed-story-input.js";
export const findStoryTarget = (game, objective) => routeToStory(game, objective, pathTo);
export function followTarget(game, input) {
  if (input.status === "wait-npc") return input;
  const vehicle = vehicleJourneyInput(game, input, pathTo);
  if (vehicle) return vehicle;
  if (input.route?.length) {
    game.move(input.route[0]);
    return { ...input, status: "walk" };
  }
  if (!input.target) return input;
  game.checkTriggers();
  if (!game.busy) {
    const dx = input.target.x - game.player.x,
      dy = input.target.y - game.player.y;
    game.player.direction =
      Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
    if (input.target.approach && ![5, 6, 7, 8, 10, 17].includes(input.target.kind))
      game.move(game.player.direction);
    else game.confirm();
  }
  return { ...input, status: "interact" };
}
export function advanceStory(game, { through = "all" } = {}) {
  if (game.over) return { status: "game-over" };
  if (game.busy) return { status: "busy" };
  const preparation = game.regressionOnly ? null : prepareFieldInput(game, pathTo);
  if (preparation) return followTarget(game, preparation);
  if (!game.history.some((entry) => entry.script === "sc_e_0001_0") || through === "M1")
    return advanceM1(game);
  const checkpoint = storyChapters.find((chapter) => chapter.id === through);
  if (checkpoint && storyCondition(game, checkpoint.complete))
    return { status: "done", chapter: through };
  // This is the input driver's cursor, never a game flag. Source conditions
  // must first have been observed. Consumed items and mutually exclusive
  // disguises must not make an already completed objective run backwards.
  game.completedStoryObjectives ??= [];
  if (
    game.storyObjective &&
    storyCondition(game, game.storyObjective.complete) &&
    !game.completedStoryObjectives.includes(game.storyObjective.id)
  )
    game.completedStoryObjectives.push(game.storyObjective.id);
  const objective = nextStoryObjective(game);
  game.storyObjective = objective;
  if (!objective) return { status: "plan-end" };
  const fixed = fixedStoryInput(game, objective);
  if (fixed) return { ...fixed, objective: objective.id, chapter: objective.chapter };
  // Cid's initial recovery timer only advances outside field dialogue. Let
  // its real source callback run rather than continually restarting a talk.
  if (objective.navigation === "fish-and-feed") {
    const waiting = pendingEventInput(game);
    if (waiting) return { ...waiting, objective: objective.id, chapter: objective.chapter };
  }
  if (objective.action === "await-source")
    return {
      ...(pendingEventInput(game) || { status: "needs-input" }),
      objective: objective.id,
      chapter: objective.chapter,
    };
  const cooperative = cooperativeStoryInput(game, objective, {
    condition: storyCondition,
    findTarget: findStoryTarget,
    followTarget,
  });
  if (cooperative) return { ...cooperative, objective: objective.id, chapter: objective.chapter };
  const input =
    prepareStoryParty(game, objective, pathTo) ||
    (objective.action === "random-encounter"
      ? randomEncounterInput(game, objective, pathTo)
      : findStoryTarget(game, objective));
  const readiness = game.regressionOnly
    ? null
    : prepareBattleReadiness(game, objective, input, pathTo);
  if (readiness?.status === "training-walk")
    return { ...readiness, objective: objective.id, chapter: objective.chapter };
  return {
    ...followTarget(
      game,
      readiness ||
        (["no-route", "no-input", "needs-input"].includes(input.status)
          ? pendingEventInput(game) || input
          : input),
    ),
    objective: objective.id,
    chapter: objective.chapter,
  };
}
