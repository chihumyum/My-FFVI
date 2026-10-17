// SNES timer.asm CheckRunAway accumulates RandA(run probability)+1 against
// gfx_buf.asm's sum of 2 per active enemy (6 for HARDER_TO_RUN). The browser
// aligns character timer phases: every 16/30 battle seconds, each status gauge
// gains normal64 / haste84 / slow32, and overflow256 permits one run attempt.
// Alignment omits the native per-slot phase, at most one 16/30 second interval.
const STATUS_PERIOD = 16 / 30;
const EPSILON = 1e-9;
const flag = (value) => value === true || Number(value) > 0;
const conditionTypes = (battle, unit) =>
  (unit.conditions || []).map((id) => Number(battle.data?.conditions?.[id]?.condition_type ?? id));
const present = (unit) => unit && unit.hp > 0 && !unit.removed && !unit.escaped;
const enemies = (battle) =>
  (battle.enemies || []).filter(
    (unit) =>
      present(unit) && !conditionTypes(battle, unit).some((type) => [5, 11, 34].includes(type)),
  );
const participants = (battle) => (battle.players || []).filter(present);

function warn(battle, message) {
  battle.escapeWarnings ??= new Set();
  if (battle.escapeWarnings.has(message)) return;
  battle.escapeWarnings.add(message);
  (battle.warning || battle.warn)?.call(battle, message);
}
export function escapeRestriction(battle) {
  if (!battle || battle.phase !== "active") return "Battle is not active.";
  const formation = battle.formation || {};
  if (flag(formation.notEscape ?? formation.not_escape)) return "PR formation forbids escape.";
  const foes = enemies(battle);
  if (!foes.length) return "No active enemies remain.";
  if (
    foes.some(
      (unit) => flag(unit.boss) || flag(unit.notEscape ?? unit.not_escape) || flag(unit.cantEscape),
    )
  )
    return "An active boss or enemy forbids escape.";
  if (battle.events?.paused || battle.events?.interactive === false)
    return "Source battle event has paused player input.";
  if (!participants(battle).length) return "No living party member can request escape.";
  return null;
}
export function canEscape(battle) {
  return escapeRestriction(battle) === null;
}
export function escapeDifficulty(battle) {
  const formation = battle.formation || {};
  const explicit = formation.escapeDifficulty ?? formation.runDifficulty;
  if (explicit !== undefined && Number.isFinite(Number(explicit)))
    return Math.max(0, Number(explicit));
  return enemies(battle).reduce(
    (sum, unit) => sum + (flag(unit.harderToRun) || flag(unit.hardToEscape) ? 6 : 2),
    0,
  );
}
function runFactor(battle, unit) {
  // runFactor/runProbability are decoded probabilities. A future PR field
  // exporter may instead retain the explicit packed CharProp selector bits.
  const explicit = unit.runProbability ?? unit.runFactor;
  if (explicit !== undefined && Number.isFinite(Number(explicit)))
    return Math.max(1, Math.min(255, Math.trunc(Number(explicit))));
  if (Number.isFinite(Number(unit.runFactorBits)))
    return (3 ^ (Number(unit.runFactorBits) & 3)) + 2;
  warn(
    battle,
    "Escape: PR has no actor run factor; using provisional probability 5. Native character timer phases are aligned in the browser.",
  );
  return 5;
}
function canRunNow(battle, unit) {
  return (
    present(unit) &&
    !unit.hidden &&
    !unit.untargetable &&
    !conditionTypes(battle, unit).some((type) => [5, 7, 11, 17, 34, 420, 608, 628].includes(type))
  );
}
export function requestEscape(battle) {
  const reason = escapeRestriction(battle);
  if (reason) {
    warn(battle, `Escape refused: ${reason}`);
    return false;
  }
  const state = (battle.escapeState ??= {
    active: false,
    complete: false,
    clock: 0,
    elapsed: 0,
    members: [],
  });
  if (state.complete) return true;
  state.active = true;
  for (const unit of participants(battle))
    if (!state.members.some((member) => member.unit === unit))
      state.members.push({
        unit,
        factor: runFactor(battle, unit),
        gauge: 0,
        progress: 0,
        attempts: 0,
      });
  return true;
}
export function cancelEscape(battle) {
  if (battle.escapeState) battle.escapeState.active = false;
}
export function tickEscape(battle, seconds) {
  const state = battle?.escapeState;
  if (!state?.active || state.complete || battle.phase !== "active") return false;
  if (battle.events?.paused || battle.events?.interactive === false) return false;
  // Recheck dynamic reinforcements and source prohibitions without converting
  // a genuine enemy defeat into an escape or overriding the source outcome.
  const reason = escapeRestriction(battle);
  if (reason) {
    state.active = false;
    warn(battle, `Escape stopped: ${reason}`);
    return false;
  }
  const dt = Number(seconds);
  if (!Number.isFinite(dt) || dt <= 0) return false;
  state.clock += dt;
  while (state.clock + EPSILON >= STATUS_PERIOD) {
    state.clock = Math.max(0, state.clock - STATUS_PERIOD);
    state.elapsed += STATUS_PERIOD;
    const difficulty = escapeDifficulty(battle);
    for (const member of state.members) {
      const unit = member.unit;
      if (!canRunNow(battle, unit)) continue;
      const types = conditionTypes(battle, unit);
      member.gauge += types.includes(15) ? 84 : types.includes(16) ? 32 : 64;
      if (member.gauge < 256 && difficulty > 0) continue;
      member.gauge %= 256;
      member.attempts++;
      const roll = Math.min(1 - EPSILON, Math.max(0, (battle.random || Math.random)()));
      member.progress += Math.floor(roll * member.factor) + 1;
      if (member.progress < difficulty) continue;
      unit.escaped = true;
      unit.hidden = true;
      unit.ready = false;
      unit.atb = 0;
      battle.addLog?.(`${unit.name || "队员"}逃离了战斗。`);
    }
    if (!participants(battle).length) {
      state.complete = true;
      state.active = false;
      state.completedAt = state.elapsed;
      state.clock = 0;
      return true;
    }
  }
  return false;
}
