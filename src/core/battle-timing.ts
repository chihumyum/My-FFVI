/** Timing for the supplied FFVI PR build. These functions do not own queues,
 * action presentation, condition lifetimes, or the outer replay step.
 * Native bindings and unresolved host dependencies: docs/battle-timing.md. */
import { conditionChantingModifier } from "./condition-speed.js";
export type ChantingAbility = { id: number; typeId: number; wait: number };
export type ChantingCommand = {
  id: number;
  /** command.csv ability_id, including a resolved null for source value 0. */
  referencedAbility: ChantingAbility | null;
};
export type ChantingInput = {
  actor: "player" | "enemy";
  firstAbility: ChantingAbility | null;
  command: ChantingCommand | null;
  agility: number;
  /** Confirmed condition TYPES, not master row IDs. */
  conditionTypes: readonly number[];
  atbSpeed: number;
};

const f = Math.fround;
function finite(value: number, label: string): number {
  if (!Number.isFinite(value) || !Number.isFinite(f(value)))
    throw new Error(`Invalid ${label}`);
  return f(value);
}
function integer(value: number, label: string, minimum = 0): void {
  if (!Number.isInteger(value) || value < minimum || value > 2147483647)
    throw new Error(`Invalid ${label}`);
}
function flag(value: boolean, label: string): void {
  if (typeof value !== "boolean") throw new Error(`Unresolved ${label}`);
}
function ability(value: ChantingAbility): void {
  integer(value.id, "chanting ability identity", 1);
  integer(value.typeId, "chanting ability type");
  integer(value.wait, "chanting ability wait");
}

/** GetChantingTime 0x6765d0, FF6 KillingSwordData 0x856010.
 * Float seconds are stored as float32, never rounded to integer milliseconds.
 * Reading this formula does not admit the referenced ability or active status. */
export function chantingSeconds(input: ChantingInput): number {
  if (input.actor !== "player" && input.actor !== "enemy")
    throw new Error("Invalid chanting actor kind");
  integer(input.agility, "confirmed chanting agility");
  const speed = finite(input.atbSpeed, "chanting ATB speed");
  if (speed <= 0) throw new Error("Unresolved nonpositive chanting ATB speed");
  for (const type of input.conditionTypes)
    integer(type, "confirmed condition type");
  if (input.firstAbility !== null) ability(input.firstAbility);
  if (input.command !== null) {
    integer(input.command.id, "chanting command identity", 1);
    if (input.command.referencedAbility !== null)
      ability(input.command.referencedAbility);
  }

  if (
    input.actor === "enemy" &&
    input.firstAbility?.typeId !== 15 &&
    input.firstAbility?.typeId !== 16
  )
    return 0;

  let wait = input.firstAbility?.wait ?? 0;
  if (input.command?.referencedAbility?.typeId === 623)
    wait = input.command.referencedAbility.wait;
  const conditionModifier = conditionChantingModifier(input.conditionTypes);
  // The FF6 provider checks Command.Id == 12, not its ability or list type.
  const killingSword = input.command?.id === 12;
  const agilityContribution = killingSword ? 0 : f(f(input.agility) * 0.5);
  const denominator = f(
    f(f(agilityContribution + 20) * (killingSword ? 1 : conditionModifier)) *
      speed,
  );
  const result = f(f(f(wait) * 20) / denominator);
  if (!Number.isFinite(result)) throw new Error("Chanting arithmetic overflow");
  return result;
}

/** UpdateChantTime 0x67ac60, serial type 6 branch. ATBSpeed also affected
 * the initial value; it independently scales each subsequent decrement.
 * Preserve negative remainder: readiness is decided when the host collects it. */
export function advanceChanting(
  remainingSeconds: number,
  deltaSeconds: number,
  atbSpeed: number,
): number {
  const remaining = finite(remainingSeconds, "chanting remainder");
  const delta = finite(deltaSeconds, "chanting delta");
  const speed = finite(atbSpeed, "chanting ATB speed");
  if (delta < 0 || speed < 0) throw new Error("Negative chanting clock input");
  const result = f(remaining - f(delta * speed));
  if (!Number.isFinite(result)) throw new Error("Chanting arithmetic overflow");
  return result;
}

/** GetStackBattleActDatas 0x678330 checks this duration before its separate
 * field-condition/queue eligibility rules. Passing is not permission to execute. */
export function chantingTimeComplete(remainingSeconds: number): boolean {
  return finite(remainingSeconds, "chanting remainder") <= 0;
}

/** UpdateGaugeIncrease 0x67b590, its predicates 0x687260 / 0x67a8e0,
 * and BattleUnitData.IsActable 0x7086c0. This counter is NOT current HP. */
export function atbGaugeCanAdvance(input: {
  gauge: number;
  actNotPossibleCounter: number;
  notUpdateGauge: boolean;
}): boolean {
  const gauge = finite(input.gauge, "ATB gauge");
  integer(
    input.actNotPossibleCounter,
    "action prohibition counter",
    -2147483648,
  );
  flag(input.notUpdateGauge, "unit gauge exclusion");
  return (
    input.actNotPossibleCounter <= 0 && gauge < 100 && !input.notUpdateGauge
  );
}

/** The native caller tests gauge < 100 BEFORE addition; it does not clamp the
 * resulting sum. Renderers may clamp the visual width, not this stored value. */
export function addAtbGauge(gauge: number, increment: number): number {
  return finite(
    f(finite(gauge, "ATB gauge") + finite(increment, "ATB increment")),
    "ATB gauge sum",
  );
}

/** Source KeyInput information-state values (dump TypeDefIndex 9030).
 * null is an explicitly absent menu/information controller. The Touch enum has
 * a different special-help/slot layout; do not pass it as this enum. */
export function keyInputMenuWaiting(state: number | null) {
  if (state === null) return { uiWaiting: false, forceWaiting: false };
  integer(state, "key-input menu state");
  if (state > 10) throw new Error("Unresolved key-input menu state");
  return {
    uiWaiting: state >= 2 && state <= 8,
    forceWaiting: state === 9 || state === 10,
  };
}

export type BattleClockInput = {
  paused: boolean;
  helpPaused: boolean;
  progressEnabled: boolean;
  mode: "wait" | "active";
  /** Resolved by the UI state provider, not by the existence of a ready actor. */
  uiWaiting: boolean;
  forceWaiting: boolean;
  /** Native BattleEndJugment.ResultType; 0 means the result is undecided. */
  battleResult: number;
};

/** UpdateBattle 0x465560 -> BattleMainUpdate 0x1588930 -> FF6 Update
 * 0x676ee0 -> ConditionController.Update 0x45a4d0. FF6 deliberately overrides
 * the base ATB Update that returns early during action staging. */
export function battleClockGate(input: BattleClockInput) {
  for (const name of [
    "paused",
    "helpPaused",
    "progressEnabled",
    "uiWaiting",
    "forceWaiting",
  ] as const)
    flag(input[name], name);
  if (input.mode !== "wait" && input.mode !== "active")
    throw new Error("Unresolved ATB battle mode");
  integer(input.battleResult, "battle result");
  const simulation = !input.paused && !input.helpPaused;
  const progress =
    simulation &&
    input.progressEnabled &&
    !input.forceWaiting &&
    !(input.mode === "wait" && input.uiWaiting);
  return {
    simulation,
    progress,
    // Per-unit IsOutBattle and per-condition gates remain with their owners.
    conditions: progress && input.battleResult === 0,
  };
}

/** UpdateBattle 0x465560 sets Unity timeScale from the source option; auto
 * multiplies by 1.5. The caller passes this scaled delta to the clocks above.
 * ATBSpeed is a distinct scalar and must not be folded into Unity timeScale. */
export function battleTimeScale(input: {
  paused: boolean;
  helpPaused: boolean;
  optionTimeScale: number;
  auto: boolean;
}): number {
  flag(input.paused, "paused");
  flag(input.helpPaused, "helpPaused");
  flag(input.auto, "auto");
  const scale = finite(input.optionTimeScale, "battle option time scale");
  if (scale < 0) throw new Error("Negative battle option time scale");
  if (input.paused || input.helpPaused) return 0;
  return finite(input.auto ? f(scale * 1.5) : scale, "battle time scale");
}
