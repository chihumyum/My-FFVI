import { battleTargetChoices, type TargetChoice, type TargetRule } from "./battle-targets.js";
import { drawBattleRandom, type BattleRandom } from "./battle-hit.js";
export const webSourceControlPolicyKind = "web-source-control-actions-v1" as const;

/** Original FF6 controller static command list, bound by the source compiler's
 * metadata receipt. It is an eligibility list, never the owned command order. */
export const sourceControlCommandIds: readonly number[] = Object.freeze([1, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18, 21, 22, 23, 26, 30, 31]);
export type ControlActionMetadata = { conditionId: number; kind: "confusion" | "temptation";
  policy: "web-source-control-actions-v1" };
export type ControlActionCandidate = { commandId: number; abilities: {
  id: number; range: number; rule: TargetRule;
}[] };
type Unit = { id: string; side: "player" | "enemy"; hp: number };
type ControlAbility = ControlActionCandidate["abilities"][number];

function validateTargetContext(ability: ControlAbility, actor: Unit, units: readonly Unit[], formation: "normal" | "opposed") {
  if (!ability || !Number.isSafeInteger(ability.id) || ability.id < 1 || !Number.isInteger(ability.range) ||
      !Array.isArray(units) || !units.length || !["normal", "opposed"].includes(formation))
    throw new Error("Invalid control-action target context");
  const ids = new Set<string>();
  for (const unit of units) {
    if (!unit || typeof unit.id !== "string" || !unit.id || ids.has(unit.id) ||
        !["player", "enemy"].includes(unit.side) || !Number.isSafeInteger(unit.hp) || unit.hp < 0)
      throw new Error("Invalid current control-action unit");
    ids.add(unit.id);
  }
  if (!actor || !units.some(unit => unit.id === actor.id && unit.side === actor.side && unit.hp === actor.hp) || actor.hp <= 0)
    throw new Error("Control-action actor is not a current living instance");
  battleTargetChoices(ability.rule, actor, units, formation);
  if (ability.rule.life !== "alive" || ability.rule.normalFormationOnly && formation !== "normal" ||
      ![1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 14, 16, 20, 21].includes(ability.range))
    throw new Error("Unresolved Web control-action target domain");
}

export function webControlTargetChoices(ability: ControlAbility, actor: Unit, units: readonly Unit[],
  formation: "normal" | "opposed", mode: "single" | "side" | "all"): TargetChoice[] {
  validateTargetContext(ability, actor, units, formation);
  const expected = ability.range === 5 ? ["single"] : ability.range === 9 ? ["all"] :
    [2, 4, 8, 12, 16].includes(ability.range) ? ["side"] : [6, 14, 20, 21].includes(ability.range) ? ["single", "side"] : ["single"];
  if (!expected.includes(mode)) throw new Error("Control-action target mode mismatch");
  return battleTargetChoices({ ...ability.rule, relation: ability.range === 5 ? "self" : "either", modes: [mode], defaultMode: mode },
    actor, units, formation);
}
export function planWebControlTarget(ability: ControlAbility, actor: Unit, units: readonly Unit[],
  formation: "normal" | "opposed", random: BattleRandom): TargetChoice {
  // Validate the complete target domain before even a mode-selection draw.
  validateTargetContext(ability, actor, units, formation);
  let mode: "single" | "side" | "all" = [2, 4, 8, 12, 16].includes(ability.range) ? "side" : ability.range === 9 ? "all" : "single";
  if ([6, 14, 20, 21].includes(ability.range)) mode = drawBattleRandom(random, 0, 1) === 0 ? "single" : "side";
  const choices = webControlTargetChoices(ability, actor, units, formation, mode);
  if (!choices.length) throw new Error("No current control-action target");
  return structuredClone(choices[drawBattleRandom(random, 0, choices.length - 1)]!);
}

/** An explicitly named Web controller, sharing the battle owner's RNG and
 * actions. It preserves the source command/owned ability selection sequence.
 * The flat living-unit/side projection and pre-start replan are declared Web
 * policy, as are complete executable-candidate preflight and ordinary shared
 * payment/forbidden checks; native GetAutoSelectAbility itself does not run the
 * menu Release/individual ability availability query. Native Tower, special
 * enemy providers and side coordinates stay gates.
 * Every possible candidate must be prepared by the caller before the first draw. */
export function planWebControlAction(input: {
  policy: "web-source-control-actions-v1";
  actor: Unit;
  units: readonly Unit[];
  formation: "normal" | "opposed";
  candidates: readonly ControlActionCandidate[];
}, random: BattleRandom): { commandId: number; abilityId: number; choice: TargetChoice } {
  if (!input || input.policy !== "web-source-control-actions-v1" ||
      !Array.isArray(input.candidates) || !input.candidates.length ||
      !Array.isArray(input.units) || !input.units.length ||
      !["normal", "opposed"].includes(input.formation)) throw new Error("Missing Web control-action context");
  const commands = new Set<number>();
  for (const candidate of input.candidates) {
    if (!candidate || !sourceControlCommandIds.includes(candidate.commandId) || commands.has(candidate.commandId) ||
        !Array.isArray(candidate.abilities) || !candidate.abilities.length)
      throw new Error("Invalid owned control-action command");
    commands.add(candidate.commandId);
    for (const ability of candidate.abilities) {
      // The original ability qualification/target metadata is checked even
      // for a future unselected branch. A Web override cannot hide an unknown.
      validateTargetContext(ability, input.actor, input.units, input.formation);
    }
  }
  const command = input.candidates[drawBattleRandom(random, 0, input.candidates.length - 1)]!;
  const ability = command.abilities[drawBattleRandom(random, 0, command.abilities.length - 1)]!;
  return { commandId: command.commandId, abilityId: ability.id,
    choice: planWebControlTarget(ability, input.actor, input.units, input.formation, random) };
}
