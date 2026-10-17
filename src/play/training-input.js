import { routeToStory, encountersForInput } from "./navigation.js";
import { encounterPool, currentFoot, isVeldt } from "./encounters.js";
import { autoVehicleInput, vehicleInputState } from "./vehicle-input.js";
import { storyChapters } from "./story-plan.js";
import { preparationRoute } from "./preparation-route.js";

const average = (units) =>
  units.reduce((sum, unit) => sum + unit.level, 0) / Math.max(1, units.length);
const experience = (units) => units.reduce((sum, unit) => sum + (unit.exp || 0), 0);
const rosterFor = (game, all) =>
  all
    ? Object.values(game.roster).filter(
        (unit) =>
          unit.id > 0 &&
          unit.id <= 14 &&
          unit.enabled !== false &&
          (unit.enabled || game.partySlots.flat().includes(unit.id)),
      )
    : game.party;
function programFor(game, name) {
  return game.data.programs[game.data.byMap?.[game.mapId]?.[name] ?? game.data.global?.[name]];
}
function sourceBosses(game, names, seen = new Set()) {
  const ids = new Set();
  for (const name of names) {
    if (!name || seen.has(name)) continue;
    seen.add(name);
    for (const [op, ints = [], , strings = []] of programFor(game, name)?.ops || []) {
      if (op === "Encount" || op === "EncountBoss") ids.add(ints[0]);
      if (op === "ChangeScript")
        for (const id of sourceBosses(game, [strings[0]], seen)) ids.add(id);
    }
  }
  return [...ids];
}
function sourcePartyAfter(game, input) {
  const away = new Set(),
    seen = new Set();
  const visit = (name) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    for (const [op, ints = [], , strings = []] of programFor(game, name)?.ops || []) {
      if (op === "OrganizePartySlot" && ints[0] > 1)
        for (const id of ints.slice(1, 5)) if (id > 0) away.add(id);
      if (op === "ChangeScript" || op === "ChangeMap")
        for (const next of strings) if (next?.startsWith("sc_")) visit(next);
    }
  };
  visit(input?.target?.script || input?.target?.npc?.interaction?.script);
  return game.party.filter((unit) => !away.has(unit.id));
}
const knowsHealing = (game, unit) =>
  (unit.abilities || []).some(
    (id) =>
      game.battleData.abilities?.[id]?.kind === "heal" && game.battleData.abilities[id].power > 0,
  );
function healingLesson(game, members) {
  if (!members.length || members.some((unit) => knowsHealing(game, unit))) return null;
  const candidates = [];
  for (const stone of Object.values(game.battleData.magicStones || {}).filter(
    (stone) => game.inventory[stone.contentId] > 0,
  ))
    for (const entry of stone.learning || []) {
      const ability = game.battleData.abilities?.[entry.abilityId];
      if (ability?.kind !== "heal" || !(ability.power > 0) || !ability.menuFunctionGroup) continue;
      for (const unit of members.filter(
        (unit) => unit.id > 0 && unit.id <= 12 && ability.mp <= unit.maxMp * 0.5,
      )) {
        const remaining = 100 - (unit.magicLearning?.[entry.abilityId] || 0);
        candidates.push({
          memberId: unit.id,
          abilityId: entry.abilityId,
          stoneId: stone.contentId,
          score:
            ((entry.rate / Math.max(1, remaining)) * (1 + unit.magic / 100)) /
            Math.max(1, ability.mp),
        });
      }
    }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] || null;
}
const trainingRoute = (game, objective, pathTo) =>
  preparationRoute(
    game,
    routeToStory(game, objective, pathTo, { avoidBattles: true }),
    "training",
    game.preparationTraining?.key,
  );
function formationMembers(game, encounterIds) {
  return encounterIds
    .flatMap((id) => game.battleData.parties?.[id]?.members || [])
    .map((member) => game.battleData.monsters?.[member.monsterId])
    .filter(Boolean);
}
function multiPartyMenu(game, input) {
  const name = input?.target?.script || input?.target?.npc?.interaction?.script;
  return (programFor(game, name)?.ops || []).some(
    ([op, , , strings]) =>
      op === "SysCall" && /^パーティ編成[：:](?:２|３|2|3)/.test(strings?.[0] || ""),
  );
}
function viablePool(game, choices, level, learning = false) {
  const formations = choices
    .filter((choice) => choice.id && choice.weight > 0)
    .map((choice) => {
      const enemies = formationMembers(game, [choice.id]);
      return {
        enemies,
        weight: choice.weight,
        xp: enemies.reduce((sum, enemy) => sum + (enemy.exp || 0), 0),
        ap: game.battleData.parties?.[choice.id]?.ap || 0,
      };
    });
  if (
    !formations.length ||
    formations.some((formation) => formation.enemies.some((enemy) => enemy.boss)) ||
    formations.every((formation) => !(learning ? formation.ap : formation.xp))
  )
    return false;
  const enemies = formations.flatMap((formation) => formation.enemies);
  return (
    enemies.length > 0 &&
    average(enemies) <= level + 4 &&
    Math.max(...enemies.map((enemy) => enemy.level)) <= level + 6
  );
}
function currentTrainingStep(game, state) {
  if (
    game.rts?.active ||
    isVeldt(game) ||
    (game.player.vehicle || 1) > 1 ||
    currentFoot(game).subtract <= 0 ||
    !viablePool(game, encounterPool(game), average(game.party), Boolean(state.lesson))
  )
    return null;
  const directions = [
    ["right", 1, 0],
    ["left", -1, 0],
    ["down", 0, 1],
    ["up", 0, -1],
  ];
  const first = state.direction || 0;
  for (let step = 0; step < directions.length; step++) {
    const index = (first + step) % directions.length,
      [direction, dx, dy] = directions[index];
    const x = game.player.x + dx,
      y = game.player.y + dy;
    if (
      !game.canMove(x, y) ||
      (game.entities || []).some(
        (entity) =>
          entity.visible !== false &&
          [2, 3, 30].includes(entity.kind) &&
          entity.layer === game.player.layer &&
          x >= entity.x &&
          x < entity.x + (entity.width || 1) &&
          y >= entity.y &&
          y < entity.y + (entity.height || 1),
      )
    )
      continue;
    if (
      (game.entities || []).some(
        (entity) =>
          entity.kind === 23 &&
          entity.layer === game.player.layer &&
          x >= entity.x &&
          x < entity.x + entity.width &&
          y >= entity.y &&
          y < entity.y + entity.height,
      )
    )
      continue;
    if (game.map.worldTerrain && currentFoot(game, x, y).type !== currentFoot(game).type) continue;
    state.direction = index === 0 ? 1 : index === 1 ? 0 : index === 2 ? 3 : 2;
    if (!game.move(direction)) continue;
    state.steps++;
    return { status: "training-walk", targetLevel: state.level, training: true };
  }
  return null;
}

// Readiness is a player choice. A level is earned only by winning encounters
// started by ordinary movement; this code never edits units or source flags.
export function prepareBattleReadiness(game, objective, input, pathTo) {
  if (game.testBoost || game.busy || !objective || game.rts?.active) return null;
  const timer = game.banks.PlaySystems?.timer;
  if (timer && !timer.expired && !timer.dispatched) return null;
  if (game.preparationTraining && game.preparationTraining.objective !== objective.id)
    game.preparationTraining = null;
  const active = game.preparationTraining;
  const multi = active?.multi ?? multiPartyMenu(game, input);
  const chapter = storyChapters.find((chapter) => chapter.id === objective.chapter);
  const declared = multi
    ? sourceBosses(
        game,
        (chapter?.objectives || []).flatMap((item) => item.scripts || []),
      )
    : encountersForInput(game, input);
  const bosses = formationMembers(game, declared).filter((enemy) => enemy.boss);
  const after = sourcePartyAfter(game, input);
  const lesson =
    active?.lesson ??
    (bosses.length || after.length < game.party.length ? healingLesson(game, after) : null);
  if (!bosses.length && !lesson && !active) return null;
  const level =
    active?.level ??
    (bosses.length ? Math.ceil(Math.max(...bosses.map((boss) => boss.level)) * 0.65) : 0);
  const roster = rosterFor(game, multi);
  const progress = () =>
    lesson
      ? game.unit(lesson.memberId).abilities?.includes(lesson.abilityId)
        ? 100
        : game.unit(lesson.memberId).magicLearning?.[lesson.abilityId] || 0
      : experience(roster);
  const learned = !lesson || game.unit(lesson.memberId).abilities?.includes(lesson.abilityId);
  if (
    average(roster) >= level &&
    (!multi || roster.every((unit) => unit.level >= level - 2)) &&
    learned
  ) {
    if (active?.originMap && game.mapId !== active.originMap) {
      const back = trainingRoute(game, { action: "visit-map", maps: [active.originMap] }, pathTo);
      if (back) return { ...back, training: true };
      game.warn(
        null,
        `Training ${objective.id}: cannot return to the original preparation map; following the main route.`,
      );
    }
    game.preparationTraining = null;
    return null;
  }
  const key = `${objective.id}:${level}:${multi ? "all" : game.party.map((unit) => unit.id).join(",")}:${lesson ? `${lesson.memberId}:${lesson.abilityId}` : ""}`;
  let state = game.preparationTraining;
  if (state?.key !== key) {
    state = game.preparationTraining = {
      key,
      objective: objective.id,
      multi,
      originMap: game.mapId,
      level,
      lesson,
      steps: 0,
      failedMaps: [],
      battles: game.battles.length,
      progress: progress(),
      escapes: 0,
      stalledBattles: 0,
    };
    game.event("training-start", {
      targetLevel: level,
      lesson,
      objective: objective.id,
      members: roster.map((unit) => unit.id),
    });
  }
  if (state.abandoned) return null;
  if (
    lesson &&
    !learned &&
    game.unit(lesson.memberId).magicite !== lesson.stoneId &&
    !game.equipMagicite(lesson.memberId, lesson.stoneId)
  ) {
    game.warn(
      null,
      `Training ${objective.id}: cannot equip the owned teaching magicite; continuing the main route.`,
    );
    state.abandoned = true;
    return null;
  }
  if (state.battles !== game.battles.length) {
    const recent = game.battles.slice(state.battles);
    state.escapes = recent.at(-1)?.outcome === "escape" ? state.escapes + 1 : 0;
    state.stalledBattles = progress() <= state.progress ? state.stalledBattles + recent.length : 0;
    state.progress = progress();
    state.battles = game.battles.length;
    if (state.escapes >= 2 || state.stalledBattles >= 4) {
      if (!state.failedMaps.includes(game.mapId)) state.failedMaps.push(game.mapId);
      state.escapes = state.stalledBattles = 0;
    }
  }
  if (multi) {
    const selected = [...roster]
      .sort((a, b) => a.level - b.level)
      .slice(0, 4)
      .map((unit) => unit.id);
    if (!selected.every((id) => game.party.some((unit) => unit.id === id))) {
      state.partyPreference = { include: selected, count: selected.length };
      if (vehicleInputState(game).flying && autoVehicleInput(game, { action: "deck" }))
        return { status: "training-walk", training: true };
      const menu = trainingRoute(game, { syscalls: ["パーティ編成：１パーティ"] }, pathTo);
      if (menu) return { ...menu, training: true };
      game.warn(
        null,
        `Training ${objective.id}: no reachable source party menu for reserve training; continuing the main route.`,
      );
      state.partyPreference = null;
      state.abandoned = true;
      return null;
    }
    state.partyPreference = null;
  }
  if (!state.failedMaps.includes(game.mapId)) {
    const step = currentTrainingStep(game, state);
    if (step) return step;
  }
  const possible = Object.values(game.battleData.encounters?.maps || {})
    .filter(
      (map) =>
        map.subtract > 0 &&
        map.set > 0 &&
        map.id !== game.mapId &&
        !state.failedMaps.includes(map.id) &&
        viablePool(
          game,
          game.battleData.encounters.sets?.[map.set]?.choices || [],
          average(game.party),
          Boolean(lesson),
        ),
    )
    .map((map) => map.id);
  if (possible.length) {
    const route = trainingRoute(game, { action: "visit-map", maps: possible }, pathTo);
    if (route) return { ...route, training: true };
  }
  game.warn(
    null,
    `Training ${objective.id}: no reachable suitable PR encounter pool; continuing the main route.`,
  );
  state.partyPreference = null;
  state.abandoned = true;
  return null;
}
