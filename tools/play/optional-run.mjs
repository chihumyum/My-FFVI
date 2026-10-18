import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { WebData } from "../../apps/play/data.js";
import { PlayGame } from "../../src/play/game.js";
import { Battle } from "../../src/play/battle.js";
import { findStoryTarget, followTarget } from "../../src/play/story-route.js";
import { storyCondition, storyChoice } from "../../src/play/story-plan.js";
import { prepareStoryParty } from "../../src/play/story-actions.js";
import { pendingEventInput } from "../../src/play/event-systems.js";
import { cooperativeStoryInput } from "../../src/play/cooperative-input.js";
import { fixedStoryInput } from "../../src/play/fixed-story-input.js";
import { pathTo } from "../../src/play/m1-route.js";
import { partyInputMembers } from "../../src/play/party-input.js";
import { submitVehicleInput } from "../../src/play/vehicle-input.js";
import { optionalCases as recruitmentCases } from "./optional-cases.mjs";
import { extraOptionalCases } from "./optional-extra-cases.mjs";
import { recruitOptionalCases } from "./optional-recruit-cases.mjs";
import { esperOptionalCases } from "./optional-esper-cases.mjs";
import { questOptionalCases } from "./optional-quest-cases.mjs";
import { recordedOptionalInput, recordedInputJournal } from "./optional-recorded-inputs.mjs";
import { PresentationAudit } from "./audit-presentation.mjs";
import { AppearanceObserver } from "./appearance-observer.mjs";
import {
  selectColosseumWager,
  selectColosseumChallenger,
  confirmColosseum,
} from "../../src/play/colosseum.js";

const optionalCases = [
  ...recruitmentCases,
  ...extraOptionalCases,
  ...recruitOptionalCases,
  ...esperOptionalCases,
  ...questOptionalCases,
];
function condition(game, test) {
  if (test?.learnedAbility) {
    const [id, ability] = test.learnedAbility;
    return game.roster[id]?.abilities?.includes(ability) || false;
  }
  if (test?.variableAtLeast) {
    const [bank, index, minimum] = test.variableAtLeast;
    return Number(game.banks?.[bank]?.[index] || 0) >= minimum;
  }
  if (test?.memberAvailable)
    return partyInputMembers(game).some((u) => u.id === test.memberAvailable);
  if (test?.all) return test.all.every((c) => condition(game, c));
  if (test?.any) return test.any.some((c) => condition(game, c));
  return storyCondition(game, test);
}

const args = process.argv.slice(2),
  option = (key, fallback) => (args.includes(key) ? args[args.indexOf(key) + 1] : fallback);
const root = path.resolve(import.meta.dirname, "../.."),
  dataRoot = path.resolve(option("--data", path.join(root, "build/web-data")));
const startFile = path.resolve(
  option("--start", path.join(root, "build/play/stage1-checkpoints/kefka-tower.json")),
);
const out = path.resolve(option("--out", path.join(root, "build/play/optional")));
const mapCheckpointDir = args.includes("--map-checkpoints")
  ? path.resolve(option("--map-checkpoints"))
  : null;
const selected = option("--cases", "all").split(","),
  summarizeOnly = args.includes("--summarize-only"),
  cases = summarizeOnly
    ? []
    : optionalCases.filter((c) => selected.includes("all") || selected.includes(c.id));
if (!cases.length && !summarizeOnly) throw Error("No matching optional content cases");
if (args.includes("--resume-report") && cases.length !== 1)
  throw Error("A continuation report belongs to exactly one optional case");
const json = async (file) => JSON.parse(await readFile(file));
const packed = process.env.PLAY_STATIC_DIR
  ? new WebData(pathToFileURL(path.resolve(process.env.PLAY_STATIC_DIR, "data/index.json")), {
      fetcher: async (url) => new Response(await readFile(fileURLToPath(url))),
    })
  : null;
const [loaded, saved] = await Promise.all([
  packed
    ? packed.open()
    : Promise.all([
        json(path.join(dataRoot, "data.json")),
        json(path.join(dataRoot, "battle.json")),
      ]).then(([data, battleData]) => ({ data, battleData })),
  json(startFile),
]);
const { data, battleData } = loaded;
if (packed) await packed.preloadRegression();
else data.navigation = await json(path.join(dataRoot, "navigation.json"));
const assetAuditDir = args.includes("--no-asset-audit")
  ? null
  : path.resolve(option("--asset-audit", path.join(out, "asset-audit")));
const auditTemplate = assetAuditDir
  ? await PresentationAudit.open({
      dataRoot,
      assetRoot: process.env.PLAY_STATIC_DIR,
      data,
      battleData,
    })
  : null;
if (auditTemplate) {
  await mkdir(assetAuditDir, { recursive: true });
  await auditTemplate.write(path.join(assetAuditDir, "static.json"), {
    start: "static-catalog",
    stop: "static-only",
  });
}
const assetAuditResults = [];
const appearanceAuditDir = assetAuditDir
  ? path.resolve(option("--appearance-audit", path.join(out, "appearance-audit")))
  : null;
const appearanceTemplate =
  appearanceAuditDir && cases.length ? await AppearanceObserver.open({ dataRoot }) : null;
await mkdir(out, { recursive: true });
if (mapCheckpointDir) await mkdir(mapCheckpointDir, { recursive: true });
const maxTicks = Number(option("--ticks", "40000")),
  maxSeconds = Number(option("--seconds", "90"));
const results = [];
function objectiveTarget(game, objective, fixedRoutes) {
  // Reuse the existing story plan's input phases verbatim. This reader adds
  // no shopping, training, battle tactics or fish-selection policy.
  if (objective.navigation === "fish-and-feed" || objective.action === "await-source") {
    const waiting = pendingEventInput(game);
    if (waiting) return waiting;
  }
  const cycle = objective.cycle?.find(
    (step) =>
      (!step.when || condition(game, step.when)) && (!step.unless || !condition(game, step.unless)),
  );
  if (cycle) objective = { ...objective, scripts: cycle.scripts };
  if (objective.flightEncounter) {
    const fixture = objective.flightEncounter;
    if (!game.map?.worldTerrain)
      return findStoryTarget(game, { scripts: [fixture.departureScript] });
    if (Number(game.player.vehicle) !== fixture.vehicleId)
      return { status: "needs-input", reason: "source flight vehicle unavailable" };
    const body = game.entities.find(
        (e) => e.script === fixture.sourceScript && fixture.entityIds.includes(String(e.id)),
      ),
      target = body && game.actors.get(String(body.id));
    if (
      !target ||
      target.x < 0 ||
      target.y < 0 ||
      target.x >= game.map.width ||
      target.y >= game.map.height
    ) {
      const accepted = submitVehicleInput(game, { action: "deck", vehicleId: fixture.vehicleId });
      return { status: accepted ? "fixed-flight-deck-input" : "needs-input" };
    }
    // A regression fixture may locate the actual hidden contact body, then
    // fly with ordinary cardinal inputs. It never places it or starts a script.
    const dx = (target.x - game.player.x + game.map.width) % game.map.width,
      dy = (target.y - game.player.y + game.map.height) % game.map.height,
      direction = dx
        ? dx < game.map.width / 2
          ? "right"
          : "left"
        : dy
          ? dy < game.map.height / 2
            ? "down"
            : "up"
          : "left";
    return {
      status: game.move(direction) ? "fixed-flight-contact-input" : "needs-input",
      direction,
    };
  }
  if (objective.waitUntil && !condition(game, objective.waitUntil))
    return (
      pendingEventInput(game) || { status: "needs-input", reason: "source timer is not advancing" }
    );
  if (
    objective.repeat &&
    game.mapId === objective.repeat.leaveMap &&
    condition(game, objective.repeat.when)
  )
    return findStoryTarget(game, { action: "visit-map", maps: [objective.repeat.viaMap] });
  // Literal acceptance waypoints, like a human's written route. These select
  // an existing live doorway or parked vehicle, never project a future event
  // as a shortcut or change the frozen automatic player's navigation policy.
  for (const point of objective.approach || []) {
    if (point.mapId !== game.mapId) continue;
    if (point.when && !condition(game, point.when)) continue;
    if (point.boardVehicle) {
      const key = `${objective.id}:board:${point.boardVehicle}`;
      if (Number(game.player.vehicle) === point.boardVehicle) fixedRoutes.set(key, true);
      // This is a sequential manual fixture: once the source takeoff has
      // happened, its later landing must not restart the boarding step.
      if (fixedRoutes.get(key)) continue;
      const parked = game.banks.PlaySystems?.vehicles?.[point.boardVehicle];
      if (!parked || parked.enabled === false || parked.mapId !== game.mapId)
        return { status: "needs-input", reason: "fixture's real parked vehicle unavailable" };
      const target = {
          ...parked,
          id: `fixture-board:${point.boardVehicle}`,
          kind: 6,
          // Public boarding checks world-cell adjacency, not the parked
          // sprite's authored render layer.
          layer: game.player.layer,
        },
        route = pathTo(game, target);
      if (!route) return { status: "no-route", reason: "no foot path to the parked vehicle" };
      if (route.length) return { status: "target", target, route };
      return {
        status: submitVehicleInput(game, { action: "takeoff", vehicleId: point.boardVehicle })
          ? "fixed-boarding-input"
          : "needs-input",
      };
    }
    const entity = game.entities.find((e) => e.id === point.entityId),
      actor = entity && game.actors.get(String(entity.id));
    if (!entity || actor?.visible === false)
      return { status: "needs-input", reason: "fixture's real source doorway unavailable" };
    const target = { ...entity, ...actor },
      route = pathTo(game, target);
    return route
      ? { status: "target", target, route }
      : { status: "no-route", reason: `no ordinary path to source entity ${point.entityId}` };
  }
  if (objective.action === "fixed-field-route") {
    if (!objective.maps.includes(game.mapId))
      return findStoryTarget(game, { action: "visit-map", maps: objective.maps });
    const points = objective.walkBetween;
    let index = game.player.vehicle > 1 ? 0 : fixedRoutes.get(objective.id) || 0;
    if (
      !(game.player.vehicle > 1) &&
      game.player.x === points[index][0] &&
      game.player.y === points[index][1]
    )
      index = (index + 1) % points.length;
    fixedRoutes.set(objective.id, index);
    const point = points[index],
      entity =
        index === points.length - 1 && objective.finalEntityId
          ? game.entities.find((entry) => entry.id === objective.finalEntityId)
          : null,
      target = entity
        ? { ...entity, ...game.actors.get(String(entity.id)) }
        : {
            id: `fixed-field-route:${point.join(",")}`,
            kind: 0,
            x: point[0],
            y: point[1],
            layer: game.player.layer,
          },
      route = pathTo(game, target);
    return route ? { status: "target", target, route } : { status: "no-route" };
  }
  const projected = findStoryTarget(game, objective);
  if (objective.scripts?.includes(projected.target?.script)) return projected;
  // Prefer the exact authored local interaction over a broader projection
  // which merely says an earlier NPC could publish its entity group again.
  for (const entity of game.entities) {
    if (!objective.scripts?.includes(entity.script)) continue;
    const actor = game.actors.get(String(entity.id));
    if (actor?.visible === false) continue;
    const target = { ...entity, ...actor },
      route = pathTo(game, target);
    if (route) return { status: "target", target, route };
  }
  return projected;
}
for (const test of cases) {
  const assetAudit = auditTemplate?.fork();
  appearanceTemplate?.field.reset();
  appearanceTemplate?.battle.reset();
  const appearanceAudit = appearanceTemplate
    ? new AppearanceObserver(appearanceTemplate.field, appearanceTemplate.battle)
    : null;
  if (packed) packed.boundaryChunks.clear();
  let caseStart = args.includes("--start")
    ? startFile
    : path.resolve(root, test.startSave || startFile);
  if (!args.includes("--start") && test.requiresCases?.length) {
    const dependency = test.requiresCases.at(-1),
      report = await json(path.join(out, `${dependency}.json`)).catch(() => null);
    if (report?.stop !== "passed") {
      const result = {
        assetAudit: assetAuditDir ? path.join(assetAuditDir, `${test.id}.json`) : null,
        acceptanceNote: assetAuditDir
          ? null
          : "Asset audit explicitly disabled; development probe only, not formal acceptance.",
        content: test.id,
        title: test.title,
        stop: "dependency-unverified",
        objectives: test.objectives,
        completed: [],
        blockers: [{ dependency }],
        startSave: null,
        mode: "boosted-regression",
      };
      await writeFile(path.join(out, `${test.id}.json`), JSON.stringify(result, null, 2));
      if (assetAudit) {
        const file = path.join(assetAuditDir, `${test.id}.json`);
        const audit = await assetAudit.write(
          file,
          {
            caseId: test.id,
            stop: result.stop,
            mode: result.mode,
            start: "dependency-not-entered",
          },
          { includeStatic: false },
        );
        assetAuditResults.push({
          caseId: test.id,
          stop: result.stop,
          file,
          scope: audit.scope.runtime,
          coverageGaps: audit.coverageGaps,
        });
      }
      results.push(result);
      if (appearanceAudit)
        await appearanceAudit.write(path.join(appearanceAuditDir, `${test.id}.json`), {
          caseId: test.id,
          start: "dependency-not-entered",
          stop: result.stop,
        });
      continue;
    }
    caseStart = path.join(out, `${dependency}-save.json`);
  }
  const caseSaved = caseStart === startFile ? saved : await json(caseStart);
  const resumeFile = option("--resume-report", null);
  const prior = resumeFile ? await json(path.resolve(resumeFile)) : null;
  if (prior) {
    const snapshot = caseSaved.snapshot || caseSaved;
    if (
      prior.content !== test.id ||
      path.resolve(resumeFile.replace(/\.json$/, "-save.json")) !== caseStart ||
      snapshot.mapId !== prior.endMap ||
      ["x", "y", "layer"].some((key) => snapshot.player[key] !== prior.position?.[key])
    )
      throw Error(
        "Continuation must use the exact real final snapshot belonging to its case report",
      );
    if (
      [...(prior.completed || []), ...(prior.skipped || [])].some(
        (id) => !test.objectives.some((o) => o.id === id),
      )
    )
      throw Error("Continuation report contains an objective absent from the unchanged case");
  }
  const began = performance.now(),
    events = [],
    inputs = {},
    visits = new Map(),
    fixedRoutes = new Map();
  // Resume only the host's literal-input cursor from the paired real report.
  // No game state is reconstructed from acceptance objectives or this cursor.
  for (const recorded of prior?.recordedInputs || []) {
    if (!String(recorded.route).startsWith("ordinary-recorded:")) continue;
    const { route, observedIndex, historyStart, script, ...cursor } = recorded;
    fixedRoutes.set(route, structuredClone(cursor));
  }
  let current = null,
    state = 1;
  const executedPrograms = new Set(),
    executedOps = new Set();
  class ObservedGame extends PlayGame {
    step(task) {
      const sourceIndex = task.pc,
        sourceProgram = assetAudit && this.data.programs[task.program],
        sourceOp = sourceProgram?.ops[sourceIndex];
      appearanceAudit?.instruction(this, task, sourceProgram, sourceIndex, sourceOp);
      executedPrograms.add(String(task.program));
      executedOps.add(`${task.program}:${task.pc}`);
      if (
        packed &&
        packed.index.programFiles[task.program] &&
        !packed.boundaryChunks.has(packed.index.programFiles[task.program])
      )
        throw Error(
          `Executed program ${task.program} missing from map ${this.mapId} preload closure`,
        );
      const result = super.step(task);
      appearanceAudit?.completedInstruction(this, task, sourceProgram, sourceIndex, sourceOp);
      if (sourceOp)
        assetAudit.instruction(this, {
          name: sourceOp[0],
          i: sourceOp[1],
          r: sourceOp[2],
          s: sourceOp[3],
          script: sourceProgram.name,
          program: sourceProgram,
          index: sourceIndex,
          actor: task.actor,
        });
      return result;
    }
  }
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const game = new ObservedGame({
    data,
    battleData,
    Battle,
    testBoost: true,
    random,
    loadMap: async (id) =>
      packed ? packed.loadMap(id) : json(path.join(dataRoot, `maps/${id}.json`)),
    onEvent: (event) => {
      assetAudit?.event(game, event);
      if (["map", "script", "battle", "battle-end"].includes(event.kind)) events.push(event);
    },
  });
  // Restore a real save, then apply the existing explicit boosted mode. No plot
  // flags, actor positions, available members or event program counters are set.
  await game.restore(structuredClone(caseSaved.snapshot || caseSaved), { testBoost: true });
  assetAudit?.observe(game);
  appearanceAudit?.observe(game, assetAudit);
  const initialBattles = game.battles.length,
    initialHistory = game.history.length;
  const checkpointStates = new Set(),
    checkpointFiles = [];
  async function recordMapCheckpoint() {
    if (!mapCheckpointDir || game.busy || game.over || !game.mapId) return;
    // Capture real stable field states, not source script entry points. The
    // checkpoint itself is an unmodified normal snapshot. No tasks, flags,
    // positions or available characters are supplied by this recorder.
    const groups = [...game.groups],
      key = JSON.stringify([
        game.mapId,
        groups,
        game.banks.ScenarioFlag1,
        game.banks.ScenarioFlag2,
        game.banks.ScenarioFlag3,
      ]);
    if (checkpointStates.has(key)) return;
    checkpointStates.add(key);
    const file = path.join(
      mapCheckpointDir,
      `${test.id}-${String(checkpointFiles.length + 1).padStart(3, "0")}-map${game.mapId}.json`,
    );
    await writeFile(file, JSON.stringify(game.snapshot()));
    checkpointFiles.push({
      file: path.relative(root, file),
      mapId: game.mapId,
      groups,
      time: game.time,
      objective: current?.id || null,
    });
  }
  game.autoChoice = (host) =>
    storyChoice(host, 0, [
      { id: test.id, title: test.title, objectives: current ? [current] : [] },
    ]);
  const alreadyComplete = [...(prior?.completed || [])],
    completed = [...(prior?.completed || [])],
    skipped = [...(prior?.skipped || [])];
  const nextObjective = () =>
    test.objectives.find((o) => !completed.includes(o.id) && !skipped.includes(o.id));
  const recordCompletions = (initial = false) => {
    if (!initial && game.busy) return;
    // A location is a momentary assertion. Do not credit a later "leave
    // Thamasa" step merely because the initial save is on the world map.
    for (
      let next = test.objectives[completed.length + skipped.length];
      next;
      next = test.objectives[completed.length + skipped.length]
    ) {
      if (next.when && !condition(game, next.when)) {
        skipped.push(next.id);
        continue;
      }
      if (!condition(game, next.complete)) break;
      completed.push(next.id);
      if (initial) alreadyComplete.push(next.id);
    }
  };
  recordCompletions(true);
  await recordMapCheckpoint();
  let stop = "tick-limit",
    lastInput = null,
    ticks = 0;
  for (; ticks < maxTicks; ticks++) {
    if ((performance.now() - began) / 1000 > maxSeconds) {
      stop = "wall-time-limit";
      break;
    }
    current = nextObjective();
    if (game.over) {
      stop = "game-over";
      break;
    }
    if (!current) {
      if (game.busy) {
        game.tick(0.1, { auto: true });
        if (game.loading) await game.pending;
        assetAudit?.observe(game);
        appearanceAudit?.observe(game, assetAudit);
        continue;
      }
      stop = completed.length > alreadyComplete.length ? "passed" : "already-complete";
      break;
    }
    game.storyObjective = current;
    if (game.colosseumMenu && current.colosseum) {
      const { wagerContentId, challengerId = game.party[0]?.id } = current.colosseum;
      if (
        selectColosseumWager(game, wagerContentId) &&
        selectColosseumChallenger(game, challengerId) &&
        confirmColosseum(game)
      )
        inputs["fixed-colosseum-input"] = (inputs["fixed-colosseum-input"] || 0) + 1;
    }
    const fixedBattleInput = current.battleInput,
      fixedBattle =
        fixedBattleInput &&
        game.battle?.enemies.some((unit) => unit.monsterId === fixedBattleInput.monsterId);
    game.tick(0.1, { auto: !fixedBattle });
    if (fixedBattle && game.battle)
      for (const [index, unit] of game.battle.players.entries())
        if (unit.ready && game.battle.choose(index, fixedBattleInput.abilityId))
          inputs["fixed-quest-battle-input"] = (inputs["fixed-quest-battle-input"] || 0) + 1;
    if (game.loading) await game.pending;
    assetAudit?.observe(game);
    appearanceAudit?.observe(game, assetAudit);
    recordCompletions();
    await recordMapCheckpoint();
    if (game.busy) continue;
    current = nextObjective();
    if (!current) {
      stop = completed.length > alreadyComplete.length ? "passed" : "already-complete";
      break;
    }
    game.storyObjective = current;
    const cooperative =
      recordedOptionalInput(game, current, fixedRoutes, { pathTo, followTarget }) ||
      fixedStoryInput(game, current) ||
      cooperativeStoryInput(game, current, {
        condition,
        findTarget: (host, objective) => objectiveTarget(host, objective, fixedRoutes),
        followTarget,
      });
    let input = cooperative;
    if (!input) {
      const target =
        prepareStoryParty(game, current, pathTo) || objectiveTarget(game, current, fixedRoutes);
      input = followTarget(
        game,
        ["no-route", "no-input", "needs-input"].includes(target.status)
          ? pendingEventInput(game) || target
          : target,
      );
    }
    if (game.loading) await game.pending;
    lastInput = input;
    inputs[input.status] = (inputs[input.status] || 0) + 1;
    const cell = JSON.stringify([
      current.id,
      game.mapId,
      game.player.x,
      game.player.y,
      game.player.layer,
      input.status,
      input.target?.id,
    ]);
    const waiting =
      (input.status === "wait-event" && input.timer?.advancing) ||
      input.status === "recorded-ordinary-wait";
    const count = waiting ? 0 : (visits.get(cell) || 0) + 1;
    visits.set(cell, count);
    if (count >= 80) {
      stop = "input-stalled";
      break;
    }
  }
  const availableMembers = partyInputMembers(game).map((unit) => unit.id);
  if (stop === "passed" && test.complete && !condition(game, test.complete))
    stop = "completion-condition-failed";
  if (stop === "passed" && test.members?.some((id) => !availableMembers.includes(id)))
    stop = "member-unavailable";
  const result = {
    assetAudit: assetAuditDir ? path.join(assetAuditDir, `${test.id}.json`) : null,
    acceptanceNote: assetAuditDir
      ? null
      : "Source-route acceptance only: asset-reference audit explicitly disabled; no GPU or pixel validation is claimed.",
    content: test.id,
    title: test.title,
    startSave: path.relative(root, caseStart),
    continuationOf: resumeFile ? path.relative(root, path.resolve(resumeFile)) : null,
    mode: "boosted-regression",
    executionBudget: { maxTicks, maxWallSeconds: maxSeconds },
    stop,
    completed,
    skipped,
    alreadyComplete,
    ticks,
    seconds: (performance.now() - began) / 1000,
    endMap: game.mapId,
    position: { x: game.player.x, y: game.player.y, layer: game.player.layer },
    objective: current?.id,
    objectives: test.objectives,
    requiredMembers: test.members || [],
    availableMembers,
    inspectionNotes: test.notes || [],
    recordedInputs: recordedInputJournal(fixedRoutes),
    unresolvedBeforeRun: test.unresolved || [],
    executedPrograms: [...executedPrograms].map((id) => ({ id, name: data.programs[id]?.name })),
    executedOpCount: executedOps.size,
    executedOps: [...executedOps],
    lastInput,
    inputs,
    battles: game.battles.slice(initialBattles),
    newScripts: game.history.slice(initialHistory),
    events,
    warnings: game.warnings,
    blockers:
      stop === "passed"
        ? []
        : [
            {
              kind: stop,
              objective: current?.id,
              tasks: game.tasks.map((t) => ({
                script: data.programs[t.program]?.name,
                index: t.pc,
                waitFor: t.waitFor,
                wait: t.wait,
              })),
              dialogue: game.dialogue?.text,
            },
          ],
  };
  await writeFile(path.join(out, `${test.id}.json`), JSON.stringify(result, null, 2));
  await writeFile(path.join(out, `${test.id}-save.json`), JSON.stringify(game.snapshot()));
  if (appearanceAudit)
    await appearanceAudit.write(path.join(appearanceAuditDir, `${test.id}.json`), {
      caseId: test.id,
      startSave: result.startSave,
      mode: result.mode,
      stop,
    });
  if (
    [
      "puppetVisibility",
      "vehicleVisibility",
      "puppetHandoff",
      "mobVisibility",
      "emptyPuppets",
    ].some((key) => appearanceAudit?.[key].mismatches.length)
  )
    process.exitCode = 1;
  if (assetAudit) {
    const file = path.join(assetAuditDir, `${test.id}.json`);
    const audit = await assetAudit.write(
      file,
      {
        caseId: test.id,
        startSave: result.startSave,
        mode: result.mode,
        executionBudget: result.executionBudget,
        stop,
        battleCount: result.battles.length,
      },
      { includeStatic: false },
    );
    assetAuditResults.push({
      caseId: test.id,
      stop,
      file,
      scope: audit.scope.runtime,
      coverageGaps: audit.coverageGaps,
    });
  }
  if (mapCheckpointDir)
    await writeFile(
      path.join(mapCheckpointDir, `${test.id}.manifest.json`),
      JSON.stringify(
        {
          caseId: test.id,
          startSave: result.startSave,
          report: path.relative(root, path.join(out, `${test.id}.json`)),
          stop,
          mode: "boosted-regression",
          method:
            "Unmodified PlayGame snapshots captured only after pending map loads settle and game.busy is false. No flag, position or event-task writes. Each map/groups/persistent ScenarioFlag state is captured once; these are ordinary-input boundaries, not mid-scene saves.",
          checkpoints: checkpointFiles,
        },
        null,
        2,
      ),
    );
  results.push(result);
  console.log(
    JSON.stringify({
      content: test.id,
      stop,
      completed,
      map: game.mapId,
      battles: result.battles.length,
      seconds: result.seconds,
      input: lastInput?.status,
    }),
  );
}
const currentReports = await Promise.all(
  optionalCases.map(async (test) => {
    let report;
    try {
      report = await json(path.join(out, `${test.id}.json`));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const sameObjectives =
        report && JSON.stringify(report.objectives) === JSON.stringify(test.objectives),
      sameMembers =
        JSON.stringify(report?.requiredMembers || []) === JSON.stringify(test.members || []);
    return sameObjectives && (report.stop !== "passed" || sameMembers)
      ? report
      : {
          content: test.id,
          title: test.title,
          stop: "not-run",
          blockers: [{ kind: report ? "acceptance-manifest-changed" : "not-run" }],
        };
  }),
);
if (assetAuditDir) {
  const audits = [];
  for (const test of optionalCases) {
    const report = await json(path.join(assetAuditDir, `${test.id}.json`)).catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return null;
    });
    if (report) audits.push(report);
  }
  const unique = new Map(),
    maps = new Set(),
    scripts = new Set(),
    categories = {};
  for (const report of audits) {
    for (const id of report.coverage.maps) maps.add(id);
    for (const name of report.coverage.scripts) scripts.add(name);
    for (const row of report.issues) {
      const key = JSON.stringify([
        row.category,
        row.mapId,
        row.script,
        row.instructionIndex,
        row.entityId,
        row.resource,
        row.asset,
        row.animation,
        row.reason,
        row.fallback,
      ]);
      let combined = unique.get(key);
      if (!combined) unique.set(key, (combined = { ...row, count: 0, cases: [] }));
      combined.count += row.count;
      combined.cases.push(report.run.caseId);
    }
  }
  for (const row of unique.values()) {
    const category = (categories[row.category] ||= { contexts: 0, calls: 0 });
    category.contexts++;
    category.calls += row.count;
  }
  await writeFile(
    path.join(assetAuditDir, "summary.json"),
    JSON.stringify(
      {
        mode: "headless-presentation-reference-audit",
        static: "static.json",
        expectedCases: optionalCases.length,
        observedCases: audits.length,
        cases: audits.map((report) => ({
          caseId: report.run.caseId,
          stop: report.run.stop,
          file: `${report.run.caseId}.json`,
          scope: report.scope.runtime,
        })),
        currentInvocation: assetAuditResults.map((row) => row.caseId),
        runtime: { categories, contexts: unique.size },
        coveredSources: { maps: [...maps].sort((a, b) => a - b), scripts: [...scripts].sort() },
        issues: [...unique.values()].sort((a, b) => b.count - a.count),
        coverageGaps: currentReports
          .filter((r) => r.stop !== "passed")
          .map((r) => ({ caseId: r.content, stop: r.stop, blockers: r.blockers })),
        note: "Cases that did not pass remain coverage gaps; partial runtime resource observations do not credit their completion. No GPU validation.",
      },
      null,
      2,
    ) + "\n",
  );
}
await writeFile(
  path.join(out, "summary.json"),
  JSON.stringify(
    currentReports.map(({ events, warnings = [], newScripts = [], ...row }) => ({
      ...row,
      scriptCount: newScripts.length,
      warningCount: warnings.length,
    })),
    null,
    2,
  ),
);
const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
await writeFile(
  path.join(out, "results.csv"),
  "content,start_save,mode,result,blocker\n" +
    currentReports
      .map((r) =>
        [
          r.title,
          r.startSave,
          r.mode,
          r.stop,
          r.blockers.map((x) => `${x.objective}: ${x.kind}`).join("; "),
        ]
          .map(quote)
          .join(","),
      )
      .join("\n") +
    "\n",
);
if (results.some((r) => r.stop !== "passed")) process.exitCode = 1;

if (!args.includes("--no-visual")) {
  const { visualRegression } = await import("./visual-regression.mjs"),
    visualResult = await visualRegression({
      reportFile: path.join(out, "visual-regression/report.json"),
      dataRoot: process.env.PLAY_DATA_DIR || "build/web-data",
      staticRoot: process.env.PLAY_STATIC_DIR,
    });
  console.log(JSON.stringify({ visualRegression: visualResult.status }));
  if (visualResult.status !== "passed") process.exitCode = 1;
} else
  console.log(
    JSON.stringify({
      visualRegression: "not-run",
      reason: "Headless optional-route evidence only; root owns static browser acceptance.",
    }),
  );
