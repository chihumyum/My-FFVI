import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { parseArgs } from "node:util";
import { PlayGame } from "../../src/play/game.js";
import { Battle } from "../../src/play/battle.js";
import { findStoryTarget, followTarget } from "../../src/play/story-route.js";
import { pathTo } from "../../src/play/m1-route.js";

const { values } = parseArgs({
  options: {
    data: { type: "string", default: "build/web-data" },
    inventory: { type: "string", default: "build/play/optional-inventory.json" },
    checkpoints: { type: "string", default: "build/play/stage1-checkpoints" },
    optional: { type: "string", default: "build/play/optional" },
    out: { type: "string", default: "build/play/optional-npc-report.json" },
    areas: { type: "string", default: "all" },
    maps: { type: "string", default: "all" },
    limit: { type: "string", default: "100" },
    ticks: { type: "string", default: "4000" },
    seconds: { type: "string", default: "8" },
    "wall-seconds": { type: "string", default: "180" },
    starts: { type: "string", default: "3" },
    previous: { type: "string", default: "build/play/optional-npc-summary.json" },
    "original-saves": {
      type: "string",
      default: path.join(homedir(), "Documents", "FFVI_PR_存档切换"),
    },
    "same-map": { type: "boolean", default: false },
    help: { type: "boolean" },
  },
});
if (values.help) {
  console.log(
    "node tools/play/optional-npc-run.mjs [--areas 7,8] [--maps 3,21] [--limit 100] [--same-map] [--starts 3] [--seconds 8] [--wall-seconds 180] [--previous REPORT_OR_SUMMARY.json] [--out REPORT.json]\n" +
      "Reads actual stage1 checkpoints and optional stop=passed saves; uses only ordinary movement/confirmation.\n" +
      "Classifies every inventory NPC, runs selected pure-message candidates, and writes JSON plus CSV.\n" +
      "A successful row proves one map/group/entity interaction in one real state, never all dialogue branches.",
  );
  process.exit(0);
}
const read = async (file) => JSON.parse(await readFile(file, "utf8"));
const optionalRead = async (file) =>
  read(file).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
const relative = (file) => path.relative(process.cwd(), path.resolve(file));
const unique = (list) => [...new Set(list)];
const filters = (text) =>
  text === "all" ? null : new Set(text.split(",").map((value) => value.trim()));
const areaFilter = filters(values.areas),
  mapFilter = filters(values.maps);
const numberOption = (key) => Math.max(0, Number(values[key]) || 0);
const maxTicks = numberOption("ticks"),
  maxSeconds = numberOption("seconds");
const maxStarts = Math.max(1, numberOption("starts")),
  limit = numberOption("limit");
const [data, battleData, inventory] = await Promise.all([
  read(path.join(values.data, "data.json")),
  read(path.join(values.data, "battle.json")),
  read(values.inventory),
]);
data.navigation = await read(path.join(values.data, "navigation.json"));
const areaNames = new Map(inventory.areas.map((area) => [area.id, area.name]));
const mapAreas = new Map(inventory.maps.map((map) => [map.id, map.areaId]));
const mapCache = new Map();
async function sourceMap(id) {
  if (!mapCache.has(id)) mapCache.set(id, await read(path.join(values.data, "maps", `${id}.json`)));
  return mapCache.get(id);
}
const resolve = (name, mapId) => data.byMap[mapId]?.[name] ?? data.global[name];

function dedicatedCategories(reasons) {
  const text = reasons.join("|"),
    result = [];
  for (const [category, pattern] of [
    ["source-missing", /missing script|dynamic\/empty/],
    ["commerce-or-payment", /shop\/product|ショップ|Gil/],
    ["choice-or-menu", /Select|名前入力|パーティ編成|コロシアム/],
    ["battle", /Encount/],
    ["source-state-change", /Flag|Calc|SetRandomValue|SetEntities|GetItem|RemoveItem/],
    ["party-or-equipment", /加入|控え|離脱|装備|PartySlot/],
    ["timer-or-special-system", /Timer|タイマー|SysCall/],
    [
      "movement-or-presentation",
      /Move|Lerp|SetPos|Route|Hide|Show|Fade|BGM|ChangeMap|Screen|Color|Shake|Flash/,
    ],
  ])
    if (pattern.test(text)) result.push(category);
  return result.length ? result : ["other-source-operation"];
}

// Conservative across every static branch. A payment/menu/plot write on even
// one branch defers the whole interaction, rather than guessing a safe choice.
const harmless = new Set([
  "Nop",
  "Exit",
  "Return",
  "Call",
  "Jump",
  "Branch",
  "Wait",
  "Blank",
  "Msg",
  "MsgClose",
  "MsgFinishWait",
  "MsgFinishWaitAll",
  "SetPuppet",
  "ExecPuppet",
  "SyncPuppet",
  "WaitPuppet",
  "FinishPuppet",
  "LookAt",
  "Orient",
  "CueAnim",
  "PlayAnim",
  "PlaySE",
  "SyncSE",
  "StopSE",
]);
const classificationCache = new Map();
function classify(npc) {
  if (npc.interaction?.actionId === 8 || npc.interaction?.productGroup > 0)
    return {
      kind: "dedicated-case",
      reasons: ["shop/product service"],
      categories: ["commerce-or-payment"],
    };
  if (!npc.script && npc.interaction?.kind === "talk")
    return {
      kind: "pure-message",
      direct: true,
      programs: [],
      messageKeys: [npc.interaction.message.key],
    };
  if (!npc.script)
    return { kind: "no-source-interaction", reasons: [npc.interaction?.kind || "none"] };
  const key = `${npc.mapId}:${npc.script}`;
  if (classificationCache.has(key)) return classificationCache.get(key);
  const pending = [npc.script],
    seen = new Set(),
    messages = new Set(),
    reasons = new Set();
  while (pending.length) {
    const name = pending.pop(),
      id = resolve(name, npc.mapId);
    if (id === undefined) {
      reasons.add(`missing script ${name}`);
      continue;
    }
    if (seen.has(String(id))) continue;
    seen.add(String(id));
    for (const [op, i, , s] of data.programs[id].ops) {
      if (op === "ChangeScript") {
        if (!s[0]) reasons.add("dynamic/empty script dispatch");
        else pending.push(s[0]);
      } else if (!harmless.has(op) && !op.startsWith("BranchBy"))
        reasons.add(op === "SysCall" ? `SysCall:${s[0]}` : op);
      if (op === "Msg" && s[0]) messages.add(s[0]);
      if (op === "Wait" && i[0] > 1) reasons.add("special wait selector");
    }
  }
  const result = {
    kind: reasons.size ? "dedicated-case" : messages.size ? "pure-message" : "no-message-source",
    programs: [...seen],
    messageKeys: [...messages],
    reasons: [...reasons],
    categories: reasons.size ? dedicatedCategories([...reasons]) : [],
  };
  classificationCache.set(key, result);
  return result;
}

const startStates = [],
  skippedStarts = [],
  startBanks = new Map();
async function addStart(file, provenance, expectedMap) {
  let saved;
  try {
    const doc = await read(file);
    saved = doc.snapshot || doc;
  } catch (error) {
    skippedStarts.push({ file: relative(file), reason: `unreadable: ${error.message}` });
    return;
  }
  const reason =
    !saved.player ||
    !saved.banks ||
    !Array.isArray(saved.history) ||
    !saved.history.length ||
    !Array.isArray(saved.visited)
      ? "unknown snapshot structure/provenance"
      : !data.maps[saved.mapId] || !saved.visited.map(Number).includes(Number(saved.mapId))
        ? "map is not an actual recorded visit"
        : expectedMap !== undefined && Number(saved.mapId) !== Number(expectedMap)
          ? "passed report and save map differ"
          : saved.rts?.active
            ? "active multi-party/RTS state needs a dedicated case"
            : saved.banks.PlaySystems?.timer &&
                !saved.banks.PlaySystems.timer.paused &&
                !saved.banks.PlaySystems.timer.expired
              ? "running source timer"
              : saved.banks.PlaySystems?.shadow && !saved.banks.PlaySystems.shadow.expired
                ? "running Shadow deadline"
                : saved.banks.PlaySystems?.cid &&
                    !saved.banks.PlaySystems.cid.paused &&
                    saved.banks.PlaySystems.cid.remaining > 0
                  ? "running Cid counter needs a dedicated case"
                  : !saved.partySlots?.[saved.partyIndex || 0]?.some(
                        (id) => saved.roster?.[id]?.hp > 0,
                      )
                    ? "no recorded surviving active member"
                    : null;
  if (reason) {
    skippedStarts.push({ file: relative(file), reason });
    return;
  }
  const map = await sourceMap(Number(saved.mapId));
  if (
    saved.player.x < 0 ||
    saved.player.y < 0 ||
    saved.player.x >= map.width ||
    saved.player.y >= map.height
  ) {
    skippedStarts.push({
      file: relative(file),
      reason: "player outside source map; state requires a dedicated case",
    });
    return;
  }
  startStates.push({
    file: relative(file),
    provenance,
    mapId: Number(saved.mapId),
    areaId: mapAreas.get(Number(saved.mapId)),
    groups: saved.groups || [],
    visited: unique(saved.visited.map(Number)),
    time: saved.time,
    phase: Number(saved.banks.ScenarioFlag2?.[41] || 0),
    testBoost: Boolean(saved.testBoost),
  });
  startBanks.set(relative(file), saved.banks);
}
for (const name of (await readdir(values.checkpoints))
  .filter((name) => name.endsWith(".json"))
  .sort()) {
  await addStart(path.join(values.checkpoints, name), "actual stage1 regression checkpoint");
}
for (const name of (await readdir(values.optional))
  .filter((name) => name.endsWith(".json") && !name.endsWith("-save.json"))
  .sort()) {
  const file = path.join(values.optional, name),
    report = await optionalRead(file);
  if (!report?.content) continue;
  if (report.stop !== "passed") {
    skippedStarts.push({
      file: relative(file),
      reason: `optional case is ${report.stop || "unknown"}, not passed`,
    });
    continue;
  }
  if (
    report.mode !== "boosted-regression" ||
    !report.startSave ||
    !report.executedPrograms?.length
  ) {
    skippedStarts.push({
      file: relative(file),
      reason: "optional report provenance is incomplete/unknown",
    });
    continue;
  }
  await addStart(
    path.join(values.optional, `${report.content}-save.json`),
    `actual passed optional case ${report.content}`,
    report.endMap,
  );
}

function guardState(npc, start) {
  if (start.mapId === npc.mapId)
    return {
      compatible: npc.group === "entity_default" || start.groups.includes(npc.group),
      basis: "actual saved active groups",
    };
  if (npc.group === "entity_default") return { compatible: true, basis: "default source group" };
  const selectors = npc.groupSelectors || [];
  if (!selectors.length) return { compatible: null, basis: "no source selector guards exported" };
  const compare = (a, op, b) => {
    if (["＝", "=", "=="].includes(op)) return a === b;
    if (["≠", "!=", "<>"].includes(op)) return a !== b;
    if (["＞", ">"].includes(op)) return a > b;
    if (["＜", "<"].includes(op)) return a < b;
    if (["≧", ">="].includes(op)) return a >= b;
    if (["≦", "<="].includes(op)) return a <= b;
    if (["＆", "&"].includes(op)) return Boolean(a & b);
    return null;
  };
  const banks = startBanks.get(start.file),
    statuses = selectors.map((selector) => {
      let unknown = false;
      for (const branch of selector.requiredBranches || []) {
        if (
          !/^Scenario|^Treasure/.test(branch.bank) ||
          (branch.compareBank !== "imm" && !/^Scenario|^Treasure/.test(branch.compareBank))
        ) {
          unknown = true;
          continue;
        }
        const left = Number(banks[branch.bank]?.[branch.index] || 0),
          right =
            branch.compareBank === "imm"
              ? Number(branch.value)
              : Number(banks[branch.compareBank]?.[branch.value] || 0),
          result = compare(left, branch.operator, right);
        if (result === null) unknown = true;
        else if (result !== branch.taken) return false;
      }
      return unknown ? null : true;
    });
  return {
    compatible: statuses.includes(true) ? true : statuses.includes(null) ? null : false,
    basis: "necessary initializer guards only; local banks are unknown, visibility not inferred",
  };
}
function rankStarts(npc) {
  const evaluated = startStates
    .filter((start) => !values["same-map"] || start.mapId === npc.mapId)
    .map((start) => ({ start, guard: guardState(npc, start) }));
  return {
    rejected: evaluated.filter(({ guard }) => guard.compatible === false).length,
    candidates: evaluated
      .filter(({ guard }) => guard.compatible !== false)
      .map(({ start, guard }) => ({
        start,
        score:
          (start.mapId === npc.mapId ? 1000 : 0) +
          (guard.compatible === true ? 200 : 0) +
          (start.mapId === npc.mapId &&
          (npc.group === "entity_default" || start.groups.includes(npc.group))
            ? 300
            : 0) +
          (start.visited.includes(npc.mapId) ? 40 : 0) +
          (start.areaId === npc.areaId ? 20 : 0) +
          (npc.sourcePhases?.includes(start.phase) ? 200 : 0),
      }))
      .sort((a, b) => b.score - a.score || a.start.time - b.start.time)
      .slice(0, maxStarts)
      .map(({ start }) => start),
  };
}
function sourceEntity(game, npc) {
  if (game.mapId !== npc.mapId) return { reason: "not-on-target-map" };
  if (npc.group !== "entity_default" && !game.groups.has(npc.group))
    return { reason: "source-group-inactive" };
  const list =
    npc.group === "entity_default"
      ? game.map.entities
      : game.map.groups?.[npc.group]?.entities || [];
  const entity = list.find(
    (entity) => String(entity.id) === String(npc.entityId) && [6, 17].includes(entity.kind),
  );
  if (!entity || !game.entities.includes(entity)) return { reason: "source-entity-not-active" };
  const actual = { ...entity, ...game.actors.get(String(entity.id)) };
  if (actual.visible === false) return { reason: "source-actor-hidden" };
  if (actual.x < 0 || actual.y < 0 || actual.x >= game.map.width || actual.y >= game.map.height)
    return { reason: "source-actor-outside-map" };
  const script = entity.script || entity.npc?.interaction?.script || null;
  if (script !== npc.script) return { reason: "source-script-differs" };
  return { entity, actual };
}
function groupFor(game, entity) {
  if (game.map.entities.includes(entity)) return "entity_default";
  return (
    [...game.groups].find((group) => game.map.groups?.[group]?.entities.includes(entity)) || null
  );
}
function facingInteractions(game) {
  const [dx, dy] = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] }[
    game.player.direction
  ] || [0, 1];
  const result = [];
  for (const distance of [1, 2])
    for (const entity of game.entities) {
      if ([2, 21].includes(entity.kind)) continue;
      const actual = { ...entity, ...game.actors.get(String(entity.id)) };
      if (actual.visible === false || !game.interactionDistance(actual)) continue;
      if (distance === 2 && game.interactionDistance(actual) !== 2) continue;
      if (
        Math.abs(actual.x - game.player.x - dx * distance) >= 0.6 ||
        Math.abs(actual.y - game.player.y - dy * distance) >= 0.6
      )
        continue;
      const script =
        entity.script || entity.npc?.interaction?.script || entity.mapObject?.interaction?.script;
      if (
        !script &&
        !entity.treasure &&
        entity.npc?.interaction?.kind !== "talk" &&
        entity.npc?.interaction?.actionId !== 8 &&
        !entity.destination
      )
        continue;
      result.push({ entity, actual, group: groupFor(game, entity), script, distance });
    }
  return result;
}
function resourceState(game) {
  // Source reads lazily create zero-valued banks. Canonicalize those reads,
  // while retaining every nonzero value so real flag changes still fail.
  const banks = Object.entries(game.banks)
    .filter(([key]) => /^Scenario|^Treasure/.test(key))
    .map(([key, bank]) => [
      key,
      Object.entries(bank)
        .filter(([, value]) => value !== 0 && value !== undefined && value !== null)
        .sort(([a], [b]) => a.localeCompare(b)),
    ])
    .filter(([, entries]) => entries.length)
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify({
    banks,
    inventory: Object.entries(game.inventory)
      .filter(([, count]) => count > 0)
      .sort(([a], [b]) => a.localeCompare(b)),
    gil: game.gil,
    partySlots: game.partySlots,
    members: Object.entries(game.roster).map(([id, unit]) => [id, unit.enabled, unit.reserve]),
  });
}
const observations = new WeakMap();
class ObservedGame extends PlayGame {
  interact() {
    const observation = observations.get(this);
    if (!observation || observation.phase !== "conversation") return super.interact();
    observation.inInteract = true;
    observation.facing = facingInteractions(this);
    observation.confirmPose = {
      mapId: this.mapId,
      x: this.player.x,
      y: this.player.y,
      layer: this.player.layer,
      direction: this.player.direction,
    };
    try {
      return super.interact();
    } finally {
      observation.inInteract = false;
    }
  }
  startScript(name, options) {
    const observation = observations.get(this),
      fromConfirm = observation?.inInteract;
    const task = super.startScript(name, options);
    if (fromConfirm) {
      const selected = observation.facing.find((candidate) => candidate.script === name);
      observation.dispatches.push({
        name,
        mapId: this.mapId,
        group: selected?.group || null,
        entityId: selected ? String(selected.entity.id) : null,
      });
      if (
        selected?.entity === observation.targetEntity &&
        selected.group === observation.npc.group
      ) {
        observation.rootTask = task;
        observation.exactDispatch = true;
      }
    }
    return task;
  }
  step(task) {
    const observation = observations.get(this);
    if (!observation) return super.step(task);
    const previous = observation.currentTask;
    observation.currentTask = task;
    if (task === observation.rootTask) observation.operations.add(`${task.program}:${task.pc}`);
    try {
      return super.step(task);
    } finally {
      observation.currentTask = previous;
    }
  }
}
function menuState(game) {
  return game.shop
    ? "shop"
    : game.colosseumMenu
      ? "colosseum"
      : game.partySelection
        ? "party-selection"
        : game.nameInput
          ? "name-input"
          : game.vehicleMenu
            ? "vehicle-menu"
            : game.dialogue?.choices
              ? "dialogue-choice"
              : null;
}
async function attempt(npc, classification, start) {
  const began = performance.now(),
    observation = {
      npc,
      phase: "restoring",
      messages: [],
      otherMessages: [],
      dispatches: [],
      operations: new Set(),
      exactDispatch: false,
    };
  let state = 1;
  const game = new ObservedGame({
    data,
    battleData,
    Battle,
    testBoost: true,
    random: () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    },
    loadMap: async (id) => structuredClone(await sourceMap(Number(id))),
    onEvent: (event) => {
      if (event.kind !== "dialogue" || observation.phase !== "conversation") return;
      const direct =
        observation.inInteract &&
        observation.facing?.[0]?.entity === observation.targetEntity &&
        observation.facing[0].group === npc.group &&
        event.key === npc.interaction?.message?.key;
      if (direct) observation.exactDispatch = true;
      const message = {
        key: event.key,
        text: event.text,
        sourceProgram: data.programs[observation.currentTask?.program]?.name || null,
        directEntity: observation.inInteract
          ? {
              group: observation.facing?.[0]?.group || null,
              entityId: String(event.entityId ?? observation.facing?.[0]?.entity.id ?? ""),
            }
          : null,
      };
      if (direct || (observation.rootTask && observation.currentTask === observation.rootTask))
        observation.messages.push(message);
      else observation.otherMessages.push(message);
    },
  });
  observations.set(game, observation);
  const doc = await read(start.file);
  await game.restore(structuredClone(doc.snapshot || doc), { testBoost: true });
  observation.phase = "route";
  const baselineBattles = game.battles.length,
    routeEvents = [],
    cells = new Map();
  let status = "tick-limit",
    reason = null,
    ticks = 0,
    lastInput = null,
    beforeConversation = null;
  for (; ticks < maxTicks; ticks++) {
    if ((performance.now() - began) / 1000 > maxSeconds) {
      status = "wall-time-limit";
      break;
    }
    const menu = menuState(game);
    if (menu) {
      status = "dedicated-case";
      reason = `actual ${menu} opened`;
      break;
    }
    if (game.over) {
      status = "game-over";
      reason = game.over.reason;
      break;
    }
    if (observation.phase === "route") {
      const scene = game.tasks.find(
        (task) =>
          !task.done &&
          !task.background &&
          !task.init &&
          /^sc_e_/.test(data.programs[task.program]?.name || ""),
      );
      if (scene) {
        status = "dedicated-route";
        reason = `ordinary navigation entered source ${data.programs[scene.program].name}`;
        break;
      }
    }
    game.tick(0.1, { auto: true });
    if (game.loading) {
      await game.pending;
      routeEvents.push({ mapId: game.mapId, time: game.time });
    }
    if (observation.phase === "conversation") {
      if (!observation.exactDispatch) {
        status = "confirmation-no-exact-effect";
        reason =
          observation.dispatches.length || observation.otherMessages.length
            ? "ordinary confirmation selected a different active declaration; no credit for the requested entity"
            : "ordinary confirmation produced no exact entity dispatch or dialogue";
        break;
      }
      if (!game.busy && !game.dialogue && (!observation.rootTask || observation.rootTask.done)) {
        status = observation.messages.length
          ? resourceState(game) === beforeConversation
            ? "message-confirmed"
            : "unexpected-state-change"
          : "no-message";
        break;
      }
      continue;
    }
    if (game.busy) continue;
    if (game.mapId !== npc.mapId) {
      const input = findStoryTarget(game, { action: "visit-map", maps: [npc.mapId] });
      if (["no-route", "no-input", "needs-input"].includes(input.status)) {
        status = "no-route";
        reason = input.reason || input.status;
        lastInput = input;
        break;
      }
      if (input.target?.script && !input.route?.length) {
        const routeNpc = {
          script: input.target.script,
          mapId: game.mapId,
          interaction: input.target.npc?.interaction,
        };
        if (classify(routeNpc).kind !== "pure-message") {
          status = "dedicated-route";
          reason = `navigation requires interaction ${input.target.script}`;
          lastInput = input;
          break;
        }
      }
      lastInput = followTarget(game, input);
    } else {
      const target = sourceEntity(game, npc);
      if (target.reason) {
        status = "unavailable-in-state";
        reason = target.reason;
        break;
      }
      const route = pathTo(game, target.actual);
      if (!route) {
        status = "no-route";
        reason = "no ordinary path to this active entity";
        break;
      }
      if (!route.length) {
        observation.phase = "conversation";
        observation.targetEntity = target.entity;
        beforeConversation = resourceState(game);
        lastInput = followTarget(game, { status: "target", target: target.actual, route });
      } else lastInput = followTarget(game, { status: "target", target: target.actual, route });
    }
    const key = JSON.stringify([
      game.mapId,
      game.player.x,
      game.player.y,
      game.player.layer,
      lastInput?.status,
      game.history.length,
    ]);
    const count = (cells.get(key) || 0) + 1;
    cells.set(key, count);
    if (count >= 40) {
      status = "input-stalled";
      reason = "same ordinary navigation state repeated";
      break;
    }
  }
  return {
    startSave: start.file,
    provenance: start.provenance,
    mode: "boosted-regression-npc",
    status,
    reason,
    ticks,
    seconds: (performance.now() - began) / 1000,
    finalMap: game.mapId,
    finalPosition: [game.player.x, game.player.y, game.player.layer],
    targetIdentity: { mapId: npc.mapId, group: npc.group, entityId: npc.entityId },
    exactDispatch: observation.exactDispatch,
    confirmPose: observation.confirmPose || null,
    dispatches: observation.dispatches,
    messages: observation.messages,
    otherMessages: observation.otherMessages,
    operationSites: [...observation.operations],
    routeEvents,
    battles: game.battles.slice(baselineBattles),
    lastInput: lastInput && {
      status: lastInput.status,
      targetId: lastInput.target?.id,
      targetScript: lastInput.target?.script,
    },
    warnings: game.warnings.slice(-12),
  };
}

// Original native saves are inspected read-only. The switcher only copies
// banks; binary payloads must never be passed to PlayGame.restore as snapshots.
async function auditOriginalSaves() {
  const root = values["original-saves"],
    config = await optionalRead(path.join(root, "分组配置.json"));
  if (!config)
    return {
      root,
      importAvailable: false,
      reason: "switcher configuration not found",
      candidates: [],
    };
  const candidates = [];
  for (const group of ["01", "02", "03"]) {
    const bank = config.banks?.[group];
    if (!bank) continue;
    for (const entry of bank.entries || []) {
      const file = path.join(root, bank.folder, config.slot_files?.[entry.slot] || "missing-slot");
      const evidence = {
        group,
        displayId: entry.displayId,
        slot: entry.slot,
        region: entry.region,
        file,
        tier: entry.tier,
        status: "skipped",
      };
      if (entry.tier !== "candidate") evidence.reason = "original save status is abnormal/unknown";
      else {
        try {
          const bytes = await readFile(file),
            text = bytes
              .toString("utf8")
              .replace(/^\uFEFF/, "")
              .trim();
          evidence.bytes = bytes.length;
          evidence.utf8Bom = bytes.subarray(0, 3).equals(Buffer.from([239, 187, 191]));
          evidence.base64 = text.length % 4 === 0 && /^[A-Za-z0-9+/=\r\n]+$/.test(text);
          const decoded = evidence.base64 ? Buffer.from(text, "base64") : bytes;
          evidence.decodedBytes = decoded.length;
          try {
            JSON.parse(decoded.toString("utf8"));
            evidence.reason =
              "native JSON is not a Web snapshot; no validated native-to-Web importer exists";
          } catch {
            evidence.reason =
              "base64 decodes to binary, not JSON; no native save decoder/importer exists in current tools";
          }
        } catch (error) {
          evidence.reason = error.message;
        }
      }
      candidates.push(evidence);
    }
  }
  return {
    root,
    importAvailable: false,
    switcher: "切换存档.py only copies save files; it does not decode their contents",
    candidates,
    excludedGroups: Object.entries(config.banks || {})
      .filter(([id]) => ["04", "05", "06", "07", "08"].includes(id))
      .map(([id, bank]) => ({
        id,
        name: bank.name,
        reason: "explicitly abnormal or uncertain; never used",
      })),
    fallback: "unaltered actual stage1 checkpoints and stop=passed optional saves",
  };
}
const originalSaves = await auditOriginalSaves(),
  previousEvidence = new Map(),
  previousReceipts = new Set();
const previous = await optionalRead(values.previous);
const previousFiles = previous?.batches || (previous?.npcs ? [values.previous] : []);
for (const file of unique(previousFiles)) {
  const report = await optionalRead(file);
  for (const npc of report?.npcs || []) {
    const key = `${npc.mapId}:${npc.group}:${npc.entityId}`;
    const accepted = [...(npc.attempts || []), ...(npc.previousAttempts || [])].filter(
      (attempt) =>
        attempt.status === "message-confirmed" &&
        attempt.exactDispatch &&
        attempt.messages?.length &&
        attempt.confirmPose?.mapId === npc.mapId &&
        attempt.targetIdentity?.mapId === npc.mapId &&
        attempt.targetIdentity?.group === npc.group &&
        String(attempt.targetIdentity?.entityId) === String(npc.entityId),
    );
    const distinct = accepted.filter((attempt) => {
      const receipt = JSON.stringify([
        key,
        attempt.batch || file,
        npc.script,
        attempt.startSave,
        attempt.confirmPose,
        attempt.messages.map((message) => message.key),
      ]);
      if (previousReceipts.has(receipt)) return false;
      previousReceipts.add(receipt);
      return true;
    });
    if (distinct.length)
      previousEvidence.set(key, [
        ...(previousEvidence.get(key) || []),
        ...distinct.map((attempt) => ({
          batch: attempt.batch || file,
          sourceScript: npc.script,
          ...attempt,
        })),
      ]);
  }
}
const began = performance.now(),
  records = [];
let attempted = 0;
for (const npc of inventory.npcInteractions) {
  const classification = classify(npc),
    area = areaNames.get(npc.areaId) || null;
  const selected =
    (!areaFilter || areaFilter.has(String(npc.areaId)) || areaFilter.has(area)) &&
    (!mapFilter || mapFilter.has(String(npc.mapId)));
  const record = {
    id: npc.id,
    mapId: npc.mapId,
    areaId: npc.areaId,
    area,
    group: npc.group,
    entityId: npc.entityId,
    sourcePosition: npc.position,
    script: npc.script,
    classification,
    status: classification.kind === "pure-message" ? "not-run" : classification.kind,
    attempts: [],
    previousAttempts: (
      previousEvidence.get(`${npc.mapId}:${npc.group}:${npc.entityId}`) || []
    ).filter((attempt) => attempt.sourceScript === npc.script),
    scope:
      "one specific declared NPC entity in one source state; all dialogue/quest branches not assessed",
  };
  if (record.previousAttempts.length && classification.kind === "pure-message")
    record.status = "message-confirmed";
  records.push(record);
  if (!selected || classification.kind !== "pure-message") continue;
  if (record.status === "message-confirmed") continue;
  if (attempted >= limit) {
    record.status = "not-run-limit";
    continue;
  }
  if ((performance.now() - began) / 1000 > numberOption("wall-seconds")) {
    record.status = "not-run-time-budget";
    continue;
  }
  attempted++;
  const { candidates, rejected } = rankStarts(npc);
  record.stateRejectedStarts = rejected;
  record.sourceGroupSelectors = npc.groupSelectors || [];
  if (!candidates.length) {
    record.status = rejected ? "no-compatible-start-in-catalog" : "no-trusted-start";
    continue;
  }
  for (const start of candidates) {
    const result = await attempt(npc, classification, start).catch((error) => ({
      startSave: start.file,
      status: "host-error",
      reason: error.stack || error.message,
    }));
    record.attempts.push(result);
    if (result.status === "message-confirmed") {
      record.status = "message-confirmed";
      break;
    }
    record.status = result.status;
  }
  console.log(
    JSON.stringify({
      npc: npc.id,
      map: npc.mapId,
      area,
      group: npc.group,
      entity: npc.entityId,
      status: record.status,
      attempts: record.attempts.length,
      messages: record.attempts.flatMap((attempt) => attempt.messages || []).length,
    }),
  );
}
const count = (list, key) =>
  Object.fromEntries(
    unique(list.map(key))
      .sort()
      .map((value) => [value, list.filter((item) => key(item) === value).length]),
  );
const areas = inventory.areas.map((area) => {
  const npcs = records.filter((row) => row.areaId === area.id);
  return {
    areaId: area.id,
    area: area.name,
    maps: unique(npcs.map((row) => row.mapId)),
    totalDeclaredNPCs: npcs.length,
    classifications: count(npcs, (row) => row.classification.kind),
    results: count(npcs, (row) => row.status),
    npcIds: npcs.map((row) => row.id),
  };
});
const report = {
  schemaVersion: 2,
  createdAt: new Date().toISOString(),
  inputs: {
    inventory: relative(values.inventory),
    data: relative(values.data),
    checkpoints: relative(values.checkpoints),
    optional: relative(values.optional),
    previousReports: previousFiles,
  },
  policy: {
    mode: "boosted-regression-npc",
    filters: { areas: values.areas, maps: values.maps },
    limit,
    startSelection:
      "actual stage1 snapshots or actual passed optional -save files; no original/abnormal/unknown import, no invented map or bank changes",
    controls:
      "ordinary navigation, movement, confirmation and existing frozen battle auto-input; no direct NPC script calls",
    acceptance:
      "exact active map/group/entity confirmation dispatch, actual source dialogue and returned control, with no plot/resource/roster changes during that conversation",
    limitation:
      "Pure-message classification conservatively considers all static branches. Dedicated cases are deferred, not failed. Previous and current confirmations remain separate. Necessary initializer guards select candidate snapshots only; actual availability and dialogue must still be observed. A pass covers this entity in this state, never all NPC content or optional quest completion.",
  },
  summary: {
    declaredNPCs: records.length,
    trustedStarts: startStates.length,
    skippedStarts: skippedStarts.length,
    scheduledNPCs: attempted,
    attemptedNPCs: records.filter((row) => row.attempts.length).length,
    actualAttempts: records.reduce((sum, row) => sum + row.attempts.length, 0),
    previouslyConfirmedNPCs: records.filter((row) => row.previousAttempts.length).length,
    newlyConfirmedNPCs: records.filter((row) =>
      row.attempts.some((attempt) => attempt.status === "message-confirmed"),
    ).length,
    dedicatedCategories: count(
      records
        .filter((row) => row.classification.kind === "dedicated-case")
        .flatMap((row) => row.classification.categories.map((category) => ({ category }))),
      (row) => row.category,
    ),
    failureReasons: count(
      records.flatMap((row) =>
        row.attempts.filter((attempt) => attempt.status !== "message-confirmed"),
      ),
      (attempt) => attempt.reason || attempt.status,
    ),
    classifications: count(records, (row) => row.classification.kind),
    results: count(records, (row) => row.status),
    elapsedSeconds: (performance.now() - began) / 1000,
  },
  starts: startStates,
  skippedStarts,
  originalSaves,
  areas,
  npcs: records,
};
await mkdir(path.dirname(values.out), { recursive: true });
await writeFile(values.out, JSON.stringify(report, null, 2) + "\n");
const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const csv = [
  [
    "npc",
    "map",
    "area",
    "group",
    "entity",
    "script",
    "classification",
    "result",
    "start",
    "previousEvidence",
    "messageKeys",
    "blockers",
  ],
];
for (const row of records)
  csv.push([
    row.id,
    row.mapId,
    row.area,
    row.group,
    row.entityId,
    row.script,
    row.classification.kind,
    row.status,
    row.attempts.map((attempt) => attempt.startSave).join("|"),
    row.previousAttempts.map((attempt) => attempt.batch).join("|"),
    unique(
      row.attempts.flatMap((attempt) => (attempt.messages || []).map((message) => message.key)),
    ).join("|"),
    [
      ...(row.classification.reasons || []),
      ...row.attempts.map((attempt) => attempt.reason).filter(Boolean),
    ].join("|"),
  ]);
await writeFile(
  values.out.replace(/\.json$/i, "") + ".csv",
  "\uFEFF" + csv.map((row) => row.map(quote).join(",")).join("\r\n") + "\r\n",
);
console.log(JSON.stringify({ report: relative(values.out), ...report.summary }, null, 2));
