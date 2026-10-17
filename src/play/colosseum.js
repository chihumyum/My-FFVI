// PR's native wager/reward/formation dictionaries are exported independently.
// This is a compulsory game rule, never the automatic regression player's policy.
import { partyInputMembers } from "./party-input.js";
import { changeInventory } from "./resources.js";

export function colosseumWagers(game) {
  const data = game.battleData,
    special = data.colosseum?.special,
    flags = game.banks.ScenarioFlag2 ?? {};
  return Object.entries(game.inventory).flatMap(([id, count]) => {
    const row = data.colosseum?.wagers[id];
    if (!(count > 0) || !(Number(id) > 0) || !row) return [];
    const hidden = Number(id) === special?.contentId,
      shadow = hidden && flags[special.requiredFlag] === 1 && !flags[special.absentFlag],
      formationId = shadow ? special.formationId : row.formationId,
      formation = data.parties[formationId];
    if (!formation) return [];
    return [
      {
        contentId: Number(id),
        count,
        formationId,
        rewardId: row.rewardId,
        name: data.contentNames?.[id] || `道具 ${id}`,
        opponent: formation.members
          .map((m) => data.monsters[m.monsterId]?.name || `敌人 ${m.monsterId}`)
          .join("、"),
        reward: hidden ? "？？？" : data.contentNames?.[row.rewardId] || `道具 ${row.rewardId}`,
        shadow,
      },
    ];
  });
}
export function openColosseum(game, task) {
  if (game.colosseumMenu || game.battle) return false;
  task.waitFor = "colosseum";
  game.colosseumMenu = { task, selected: null, challenger: null, phase: "wager" };
  game.event("colosseum", { available: colosseumWagers(game).map((w) => w.contentId) });
  return true;
}
export function selectColosseumWager(game, contentId) {
  const menu = game.colosseumMenu;
  if (!menu || !colosseumWagers(game).some((w) => w.contentId === Number(contentId))) return false;
  menu.selected = Number(contentId);
  menu.challenger = null;
  menu.phase = "challenger";
  return true;
}
export function selectColosseumChallenger(game, memberId) {
  const menu = game.colosseumMenu;
  if (!menu?.selected || !partyInputMembers(game).some((u) => u.id === Number(memberId)))
    return false;
  menu.challenger = Number(memberId);
  menu.phase = "confirm";
  return true;
}
export function cancelColosseum(game) {
  const menu = game.colosseumMenu;
  if (!menu) return false;
  menu.task.waitFor = null;
  menu.task.locals[0] = 0;
  game.colosseumMenu = null;
  game.event("colosseum-cancel");
  return true;
}
const recover = (unit) => {
  unit.hp = unit.maxHp;
  unit.mp = unit.maxMp;
  unit.conditions = [];
  for (const key of ["hidden", "removed", "escaped", "engulfed", "berserk", "trance", "runic"])
    unit[key] = false;
};
export function confirmColosseum(game) {
  const menu = game.colosseumMenu,
    wager = colosseumWagers(game).find((w) => w.contentId === menu?.selected),
    member = partyInputMembers(game).find((u) => u.id === menu?.challenger);
  if (!menu || menu.phase !== "confirm" || !wager || !member) return false;
  // Nothing is consumed until both selections are explicitly confirmed.
  changeInventory(game, wager.contentId, -1);
  recover(member);
  game.colosseumMenu = null;
  game.warn(
    menu.task,
    "Colosseum uses PR wager/formation/reward data; full recovery and source sc_e_0750 after winning party1021 are inferred native-host transitions.",
  );
  game.encounter(wager.formationId, null, menu.task, {
    colosseum: true,
    party: [member],
    onColosseumEnd(result) {
      recover(member);
      if (result.outcome === "victory") changeInventory(game, wager.rewardId, 1);
      game.event("colosseum-result", { ...wager, memberId: member.id, outcome: result.outcome });
      if (wager.shadow && result.outcome === "victory") {
        menu.task.done = true;
        game.startScript("sc_e_0750");
      } else {
        menu.task.waitFor = "message";
        game.dialogue = {
          task: menu.task,
          speaker: "斗技场",
          elapsed: 0,
          text:
            result.outcome === "victory"
              ? `获胜！获得${game.battleData.contentNames?.[wager.rewardId] || `道具 ${wager.rewardId}`}。`
              : `挑战结束，失去押注${wager.name}。`,
        };
      }
    },
  });
  return true;
}

// SNES RandCharAction explains non-player control and random command/spell
// selection. PR's full native eligibility predicate isn't serialized; this
// uniform command-then-action selection and target choice are logged guesses.
const randomCommands = new Set([
  1, 5, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18, 21, 22, 23, 25, 26, 27, 28, 30, 31,
]);
export function colosseumTurn(battle, unit) {
  const index = battle.players.indexOf(unit);
  const menus = battle
    .commandsFor(index)
    .filter(
      (m) =>
        randomCommands.has(m.commandId) &&
        !m.disabled &&
        m.actions.some((a) => !a.disabled && !a.magiciteSummon),
    );
  battle.warning(
    "Colosseum compulsory random actions: PR native command eligibility/weights are approximated from SNES RandCharAction; no regression strategy is used.",
  );
  const menu = menus[Math.floor(battle.random() * menus.length)],
    actions = menu?.actions.filter((a) => !a.disabled && !a.magiciteSummon) ?? [],
    action = actions[Math.floor(battle.random() * actions.length)];
  if (!action) {
    battle.consumeTurn(unit);
    return;
  }
  const side = action.target === "ally" ? "player" : "enemy",
    pool = side === "player" ? battle.players : battle.enemies,
    candidates = pool
      .map((target, i) => ({ target, i }))
      .filter(({ target }) => battle.eligibleTarget(target, action)),
    target = candidates[Math.floor(battle.random() * candidates.length)];
  if (!target || !battle.choose(index, action.id, { side, index: target.i }, { validated: true }))
    battle.consumeTurn(unit);
}
