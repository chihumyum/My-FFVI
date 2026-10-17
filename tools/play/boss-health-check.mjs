import fs from "node:fs/promises";
import path from "node:path";
import { Battle } from "../../src/play/battle.js";
import { createCharacter, raiseLevel, recalculateEquipment } from "../../src/play/progression.js";
import { encounterPool, currentFoot } from "../../src/play/encounters.js";
import { decodeAcceptanceState } from "../../apps/play/acceptance-state.js";
import { isHpRecovery } from "./boss-health-policy.mjs";

// Isolated measurements only. This file never imports, trains or modifies the
// story player's policy. A loss is a measurement, never a reason to tune it.
const dataRoot = process.env.PLAY_DATA_DIR || "build/web-data",
  directory = process.env.PLAY_BOSS_FRAMES || "build/play/acceptance/step-4/boundaries",
  output = process.env.PLAY_BOSS_REPORT || "build/play/acceptance/step-6/bosses.json",
  data = JSON.parse(await fs.readFile(path.join(dataRoot, "battle.json"))),
  manifest = JSON.parse(await fs.readFile(path.join(directory, "manifest.json"))),
  trials = Number(process.env.PLAY_BOSS_TRIALS || 30),
  selected = new Set((process.env.PLAY_BOSS_IDS || "").split(",").filter(Boolean).map(Number)),
  results = [],
  seen = new Set(),
  recentAreas = [],
  recentPools = [],
  excludedEraPools = [];

const levelForExp = (unit) =>
  Math.max(
    data.characters[unit.id]?.level || 1,
    ...data.expTable
      .filter((row) => row.group_id === (unit.expGroup || 1) && row.total_exp <= (unit.exp || 0))
      .map((row) => row.lv),
  );
function quantile(rows, fraction) {
  const sorted = [...rows].sort((a, b) => a.level - b.level),
    total = sorted.reduce((sum, row) => sum + row.weight, 0);
  let left = fraction * total;
  for (const row of sorted) {
    left -= row.weight;
    if (left <= 0) return row.level;
  }
  return sorted.at(-1)?.level ?? null;
}
async function readFrame(row) {
  const map = JSON.parse(await fs.readFile(path.join(dataRoot, "maps", `${row.mapId}.json`)));
  return decodeAcceptanceState(JSON.parse(await fs.readFile(path.join(directory, row.file))), {
    data: {},
    battleData: data,
    map,
  }).state;
}
function observeEligibleArea(state, row) {
  const player = state.player;
  // PR reuses set129 on Narshe's shared maps: Garm/Lukhavi/Test Rider
  // are the lv32 ruined-town pool, not the scripted opening guards. Record
  // the explicit era interpretation instead of calling that lv32 "typical".
  if (
    [129, 131, 138].includes(data.encounters.maps[row.mapId]?.set) &&
    Number(state.banks.ScenarioFlag2?.[44] || 0) !== 1
  ) {
    if (!excludedEraPools.some((entry) => entry.mapId === row.mapId))
      excludedEraPools.push({
        mapId: row.mapId,
        set: data.encounters.maps[row.mapId]?.set,
        reason:
          "Pre-ruin Narshe; shared lv32 Garm/Lukhavi/Test Rider/Wizard/Psychos pool belongs to the ruined town; era interpretation inferred.",
      });
    return;
  }
  if (
    player.visible === false ||
    (player.vehicle && player.vehicle !== 1) ||
    currentFoot(state).subtract <= 0
  )
    return;
  if (
    (state.entities || []).some(
      (entity) =>
        entity.kind === 23 &&
        entity.visible !== false &&
        (entity.layer == null || entity.layer === player.layer) &&
        player.x >= entity.x &&
        player.y >= entity.y &&
        player.x < entity.x + entity.width &&
        player.y < entity.y + entity.height,
    )
  )
    return;
  const samples = encounterPool({ ...state, warn() {} }).flatMap((choice) => {
    const formation = data.parties[choice.id],
      monsters = formation?.members.map((member) => data.monsters[member.monsterId]);
    if (
      !(choice.weight > 0) ||
      !monsters?.length ||
      monsters.some((monster) => !monster || monster.boss)
    )
      return [];
    return monsters.map((monster) => ({
      level: monster.level,
      weight: choice.weight / monsters.length,
      monsterId: monster.id,
      formation: choice.id,
    }));
  });
  if (!samples.length) return;
  const old = recentPools.findIndex((area) => area.mapId === row.mapId);
  if (old >= 0) recentPools.splice(old, 1);
  recentPools.push({ mapId: row.mapId, sequence: row.sequence, samples });
  if (recentPools.length > 3) recentPools.shift();
}
function observeEncounter(row, formation) {
  if (!formation?.members.length) return;
  const monsters = formation.members.map((member) => data.monsters[member.monsterId]);
  if (monsters.some((monster) => !monster || monster.boss)) return;
  const samples = monsters.map((monster) => ({
    level: monster.level,
    weight: 1 / monsters.length,
    monsterId: monster.id,
    formation: row.encounterId,
  }));
  if (!samples.length) return;
  const previous = recentAreas.findIndex((area) => area.encounterId === row.encounterId);
  if (previous >= 0) recentAreas.splice(previous, 1);
  recentAreas.push({
    mapId: row.mapId,
    encounterId: row.encounterId,
    sequence: row.sequence,
    samples,
  });
  if (recentAreas.length > 8) recentAreas.shift();
}
function ordinaryUnit(source, estimatedLevel) {
  const unit = createCharacter(data, source.id);
  // Preserve acquired commands/knowledge/equipment and source battle modes,
  // never copy boosted combat statistics or boosted max HP/MP.
  for (const key of [
    "equipment",
    "abilities",
    "commands",
    "magicite",
    "magicLearning",
    "rageAbilities",
    "lores",
    "dances",
    "gogoCommands",
    "row",
    "magitek",
    "costume",
    "appearance",
  ])
    if (source[key] !== undefined) unit[key] = structuredClone(source[key]);
  unit.abilities = (unit.abilities || []).filter((ability) => {
    const id = typeof ability === "object" ? ability.id : ability,
      natural = unit.naturalLearning?.find((row) => row.abilityId === id);
    return !natural || natural.level <= estimatedLevel || Number(unit.magicLearning?.[id]) >= 100;
  });
  unit.exp =
    data.expTable.find((row) => row.group_id === (unit.expGroup || 1) && row.lv === estimatedLevel)
      ?.total_exp ??
    source.exp ??
    unit.exp;
  raiseLevel(data, unit, estimatedLevel, { magicite: false });
  recalculateEquipment(data, unit);
  unit.hp = unit.maxHp;
  unit.mp = unit.maxMp;
  return unit;
}
function simpleInput(battle, counts) {
  for (const actor of battle.readyPlayers) {
    if (battle.phase !== "active") break;
    const index = battle.players.indexOf(actor),
      actions = battle.actionsFor(index).filter((action) => !action.disabled),
      wounded = battle.players.find(
        (unit) => battle.targetable(unit) && unit.hp > 0 && unit.hp / unit.maxHp < 0.35,
      );
    if (wounded) {
      // Fixed order: first owned HP recovery item by content number, otherwise
      // first already learned HP recovery spell by ability number. No forecast,
      // supplies, purchases, MP planning, revival plan or boss-specific choice.
      const recovery = [...actions]
        .filter(isHpRecovery)
        .sort(
          (a, b) =>
            Number(!String(a.id).startsWith("item:")) - Number(!String(b.id).startsWith("item:")) ||
            Number(a.contentId ?? a.id) - Number(b.contentId ?? b.id),
        )[0];
      if (
        recovery &&
        battle.choose(index, recovery.id, {
          side: "player",
          index: battle.players.indexOf(wounded),
        })
      ) {
        counts.heal++;
        continue;
      }
    }
    const target = battle.enemies.find((unit) => battle.targetable(unit)),
      fight = actions.find((action) => action.id === 1);
    if (
      fight &&
      target &&
      battle.choose(index, 1, { side: "enemy", index: battle.enemies.indexOf(target) })
    )
      counts.fight++;
    else counts.unavailable++;
  }
}
function sample(state, estimate, seed) {
  const available =
      state.roster instanceof Map ? Object.fromEntries(state.roster) : state.roster || {},
    units = new Map(),
    resolve = (id) => {
      if (!units.has(id))
        units.set(
          id,
          ordinaryUnit(
            available[id] || { id },
            Math.max(data.characters[id]?.level || 1, estimate),
          ),
        );
      return units.get(id);
    },
    warnings = new Set(),
    counts = { fight: 0, heal: 0, unavailable: 0 },
    random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296,
    source = state.battle,
    battle = new Battle({
      data,
      encounterId: source.encounterId,
      party: source.players.map((unit) => {
        const fresh = ordinaryUnit(unit, Math.max(levelForExp(unit), estimate));
        units.set(unit.id, fresh);
        return fresh;
      }),
      inventory: structuredClone(state.inventory),
      banks: structuredClone(state.banks),
      context: structuredClone(source.context),
      finalParty: (source.finalParty || []).map((unit) =>
        resolve(typeof unit === "object" ? unit.id : unit),
      ),
      character: resolve,
      random,
      warn: (warning) => warnings.add(warning),
    }),
    started = performance.now();
  let ticks = 0,
    error = null;
  try {
    while (battle.phase === "active" && battle.elapsed < 1200 && battle.turns < 1200) {
      battle.tick(0.25, false);
      simpleInput(battle, counts);
      if (++ticks % 100 === 0 && performance.now() - started > 10000) break;
    }
  } catch (caught) {
    error = { message: caught.message, stack: caught.stack };
  }
  return {
    outcome: error ? "error" : battle.outcome || "timeout",
    seconds: battle.elapsed,
    turns: battle.turns,
    playerActions: counts.fight + counts.heal,
    inputs: counts,
    warnings: [...warnings],
    lastLog: battle.log.slice(-12),
    enemies: battle.enemies.map((unit) => ({
      id: unit.monsterId,
      hp: unit.hp,
      maxHp: unit.maxHp,
      ai: unit.aiName,
    })),
    error,
  };
}
await fs.mkdir(path.dirname(output), { recursive: true });
for (const row of manifest.entries) {
  if (row.kind === "context") {
    await observeEligibleArea(await readFrame(row), row);
    continue;
  }
  if (row.kind !== "battle") continue;
  const formation = data.parties[row.encounterId];
  observeEncounter(row, formation);
  if (
    seen.has(row.encounterId) ||
    !formation?.members.some((member) => data.monsters[member.monsterId]?.boss)
  )
    continue;
  seen.add(row.encounterId);
  if (selected.size && !selected.has(row.encounterId)) continue;
  const state = await readFrame(row),
    distribution = (recentPools.length ? recentPools : recentAreas).flatMap((area) => area.samples),
    ordinaryLevels = [0.25, 0.5, 0.75].map((fraction) => quantile(distribution, fraction)),
    minimum = Math.max(...state.battle.players.map(levelForExp)),
    estimate = Math.max(minimum, ordinaryLevels[1] || minimum),
    party = state.battle.players.map((unit) => {
      const fresh = ordinaryUnit(unit, Math.max(levelForExp(unit), estimate));
      return {
        id: unit.id,
        name: fresh.name,
        checkpointExp: unit.exp,
        levelFromCheckpointExp: levelForExp(unit),
        estimatedLevel: fresh.level,
        hp: fresh.maxHp,
        mp: fresh.maxMp,
        equipment: fresh.equipment,
      };
    }),
    runs = [];
  for (let trial = 0; trial < trials; trial++)
    runs.push(sample(state, estimate, 11092026 + row.encounterId * 1009 + trial * 7919));
  const wins = runs.filter((run) => run.outcome === "victory"),
    rate = wins.length / trials,
    result = {
      encounterId: row.encounterId,
      name: formation.members.map((member) => data.monsters[member.monsterId]?.name).join(" / "),
      source: {
        frame: row.file,
        mapId: row.mapId,
        script: row.script,
        instruction: row.instruction,
        eventProgram: data.scriptNames[formation.script] || formation.script,
      },
      estimate: {
        level: estimate,
        ordinaryEnemyP25MedianP75: ordinaryLevels,
        levelSource: recentPools.length
          ? "last3 eligible actually visited PR encounter areas"
          : "last8 actually fought non-boss formations",
        eligibleAreas: recentPools.map(({ mapId, sequence }) => ({ mapId, sequence })),
        recentEncounterSamples: recentAreas.map(({ mapId, encounterId, sequence }) => ({
          mapId,
          encounterId,
          sequence,
        })),
        note: "Explicit regional estimate, not a native typical-level fact. Only actually visited visible on-foot contexts outside active no-encounter regions contribute PR pools; this excludes the opening Magitek maps' future lv32 pools. Fallback is actually fought non-boss formations. Boosted99 is ignored. Actual-route EXP levels and ordinary-enemy quartiles are both retained. Gear/party are exactly available in the source checkpoint; no later acquisitions, purchases or optimization. Underfull groups and starter gear can bias failure rates.",
      },
      party,
      trials,
      winRate: rate,
      averageTurnsAll: runs.reduce((sum, run) => sum + run.turns, 0) / trials,
      averageTurnsWon: wins.length
        ? wins.reduce((sum, run) => sum + run.turns, 0) / wins.length
        : null,
      outcomes: Object.fromEntries(
        [...new Set(runs.map((run) => run.outcome))].map((outcome) => [
          outcome,
          runs.filter((run) => run.outcome === outcome).length,
        ]),
      ),
      investigate: rate <= 0.1 ? "low-win-rate" : rate >= 0.9 ? "high-win-rate" : null,
      runs,
    };
  results.push(result);
  console.log(`${row.encounterId} ${result.name}: ${wins.length}/${trials}, level${estimate}`);
  await fs.writeFile(output, JSON.stringify({ status: "running", results }, null, 2) + "\n");
}
await fs.writeFile(
  output,
  JSON.stringify(
    {
      status: results.some((row) => row.outcomes.error) ? "has-errors" : "sampled",
      policy:
        "Fight first target; below35% HP, first owned HP recovery item then first learned recovery spell. Fixed across every boss/trial. No shopping/grinding/resource planning/AI optimization. Forced source conditions and scripted events remain active.",
      scope:
        "Every distinct PR boss-flagged formation actually encountered in the complete main regression, including source demonstrations/forced returns; not optional bosses. Rates alone never certify balance or a game bug.",
      trialsPerBoss: trials,
      bosses: results.length,
      excludedEraPools,
      results,
    },
    null,
    2,
  ) + "\n",
);
