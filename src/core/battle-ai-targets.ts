import { drawBattleRandom, type BattleRandom } from "./battle-hit.js";
import type { BattleSide, TargetChoice, TargetMode, TargetRule } from "./battle-targets.js";

export type BattleAITargetUnit = { id: string; side: BattleSide; hp: number };
export type BattleAITargetInput = {
  actor: BattleAITargetUnit;
  /** Current, unremoved instances in roster order. Fallen members stay here. */
  units: readonly BattleAITargetUnit[];
  /** The host's admitted ordinary IsNotTargeting projection, in source order. */
  eligiblePlayers: readonly BattleAITargetUnit[];
  range: number;
  rule: TargetRule;
  formation: "normal" | "opposed";
};

type RangeShape = { relation: TargetRule["relation"]; modes: readonly TargetMode[]; normalFormationOnly: boolean };
const rangeShapes: Readonly<Record<number, RangeShape>> = {
  1: { relation: "ally", modes: ["single"], normalFormationOnly: false },
  2: { relation: "ally", modes: ["side"], normalFormationOnly: false },
  3: { relation: "enemy", modes: ["single"], normalFormationOnly: false },
  4: { relation: "enemy", modes: ["side"], normalFormationOnly: false },
  5: { relation: "self", modes: ["single"], normalFormationOnly: false },
  6: { relation: "either", modes: ["single", "side"], normalFormationOnly: true },
  7: { relation: "either", modes: ["single"], normalFormationOnly: false },
  8: { relation: "either", modes: ["side"], normalFormationOnly: false },
  9: { relation: "either", modes: ["all"], normalFormationOnly: false },
  14: { relation: "enemy", modes: ["single", "side"], normalFormationOnly: true },
  20: { relation: "either", modes: ["single", "side"], normalFormationOnly: true },
  21: { relation: "enemy", modes: ["single", "side"], normalFormationOnly: true },
};

function dataFields(value: unknown): Record<string, PropertyDescriptor> | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getOwnPropertySymbols(value).length)
    return null;
  const fields = Object.getOwnPropertyDescriptors(value);
  return Object.values(fields).every(field => Object.hasOwn(field, "value")) ? fields : null;
}

function arrayValues(value: unknown): unknown[] | null {
  if (!Array.isArray(value) || Object.getOwnPropertySymbols(value).length) return null;
  const fields = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>, length = fields.length?.value;
  if (!Number.isInteger(length) || length < 0 || Object.keys(fields).length !== length + 1) return null;
  const values: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const field = fields[index];
    if (!field || !Object.hasOwn(field, "value")) return null;
    values.push(field.value);
  }
  return values;
}

/** Shared compiler/runtime capability gate. No target or probability draw is
 * made here: an unselected future row need not have a target on this clock.
 * Menu defaults are validated as metadata, never used for an AI decision. */
export function battleAITargetBlocker(
  range: number,
  rule: TargetRule,
  kind: "normal" | "counter",
  formation?: "normal" | "opposed",
): string | null {
  if (!Number.isInteger(range) || range <= 0 || range > 0x7fffffff)
    return "Invalid automatic target range";
  if (kind !== "normal" && kind !== "counter") return "Invalid automatic target action kind";
  if (formation !== undefined && formation !== "normal" && formation !== "opposed")
    return "Invalid automatic target formation";
  const fields = dataFields(rule);
  if (!fields || Object.keys(fields).sort().join(",") !==
      "defaultMode,defaultRelation,life,modes,normalFormationOnly,relation")
    return "Invalid automatic target rule";
  const modes = arrayValues(fields.modes!.value);
  if (!modes || !modes.length || modes.some(mode =>
      mode !== "single" && mode !== "side" && mode !== "all") ||
      new Set(modes).size !== modes.length ||
      !modes.includes(fields.defaultMode!.value) ||
      !["ally", "enemy"].includes(fields.defaultRelation!.value) ||
      typeof fields.normalFormationOnly!.value !== "boolean" ||
      !["ally", "enemy", "self", "either"].includes(fields.relation!.value) ||
      !["alive", "include-fallen-players"].includes(fields.life!.value))
    return "Invalid automatic target rule";
  if (fields.life!.value !== "alive") return "Unimplemented automatic target life rule";
  const shape = rangeShapes[range];
  if (!shape || kind === "counter" && range !== 3 && range !== 7)
    return `Unimplemented ${kind === "counter" ? "counter" : "automatic"} target range ${range}`;
  if (fields.relation!.value !== shape.relation || modes.length !== shape.modes.length ||
      shape.modes.some(mode => !modes.includes(mode)) ||
      fields.normalFormationOnly!.value !== shape.normalFormationOnly ||
      (shape.relation === "ally" || shape.relation === "self") && fields.defaultRelation!.value !== "ally" ||
      shape.relation === "enemy" && fields.defaultRelation!.value !== "enemy")
    return "Automatic target range and rule mismatch";
  if (shape.normalFormationOnly && formation === "opposed")
    return "Unimplemented automatic target formation";
  return null;
}

function unitFields(value: unknown): BattleAITargetUnit {
  const fields = dataFields(value);
  if (!fields || !fields.id || !fields.side || !fields.hp ||
      typeof fields.id.value !== "string" || fields.id.value.length === 0 ||
      (fields.side.value !== "player" && fields.side.value !== "enemy") ||
      !Number.isInteger(fields.hp.value) || fields.hp.value < 0 || fields.hp.value > 0x7fffffff)
    throw new Error("Invalid automatic target unit");
  return { id: fields.id.value, side: fields.side.value, hp: fields.hp.value };
}

function currentUnits(value: unknown): BattleAITargetUnit[] {
  const values = arrayValues(value);
  if (!values) throw new Error("Invalid automatic target roster");
  const units = values.map(unitFields);
  if (new Set(units.map(unit => unit.id)).size !== units.length)
    throw new Error("Duplicate automatic target instance");
  return units;
}

/** GetTargetType 0x15a6bc0 preserves forced range 2/4 groups even at length 1.
 * Other ranges derive type from RAW cardinality and faction, before the final
 * action's alive/condition filtering. Thus range 8 can explicitly be single,
 * and range 9 can be single, side or all. */
function rawChoice(range: number, targets: readonly BattleAITargetUnit[]): TargetChoice | null {
  if (!targets.length) return null;
  const targetIds = targets.map(target => target.id);
  if (range === 2 || range === 4)
    return { selection: { kind: "side", side: range === 2 ? "enemy" : "player" }, targetIds };
  if (targets.length === 1) return { selection: { kind: "single", id: targets[0]!.id }, targetIds };
  const side = targets[0]!.side;
  return { selection: targets.every(target => target.side === side) ? { kind: "side", side } : { kind: "all" }, targetIds };
}

/** Normal AI raw target decision, separate from player menu defaults and the
 * explicit-attacker CounterAct lane. Native range 1/2 reads the unfiltered live
 * enemy list; 4/8 reads the raw player list; 9 concatenates raw players then
 * raw enemies, preserving each faction's order as native AddRange does.
 * Random player selection retains the existing UNIFORM Web PRNG policy, not
 * native player weights. Ability 303's special fallen-player append and empty
 * GetDefaultTarget fallback are outside this ordinary capability.
 * Every input is checked before a draw. The battle owner restores its RNG if a
 * later decision/effect fails, and revalidates the returned selection at start
 * and resolution; these raw IDs alone do not authorize effects on fallen units. */
export function planBattleAITarget(input: BattleAITargetInput, random: BattleRandom): TargetChoice | null {
  const fields = dataFields(input);
  if (!fields || Object.keys(fields).sort().join(",") !== "actor,eligiblePlayers,formation,range,rule,units")
    throw new Error("Invalid automatic target input");
  if (input.formation !== "normal" && input.formation !== "opposed")
    throw new Error("Invalid automatic target formation");
  const blocker = battleAITargetBlocker(input.range, input.rule, "normal", input.formation);
  if (blocker) throw new Error(blocker);
  if (typeof random !== "function") throw new Error("Missing automatic target random provider");
  const units = currentUnits(input.units), actor = unitFields(input.actor), eligible = currentUnits(input.eligiblePlayers);
  const liveActor = units.find(unit => unit.id === actor.id);
  if (!liveActor || actor.side !== "enemy" || liveActor.side !== actor.side || liveActor.hp !== actor.hp)
    throw new Error("Automatic target actor is not the current enemy instance");
  let previousPlayerIndex = -1;
  for (const player of eligible) {
    const index = units.findIndex(unit => unit.id === player.id), live = units[index];
    if (!live || player.side !== "player" || player.hp <= 0 || live.side !== player.side || live.hp !== player.hp)
      throw new Error("Invalid eligible automatic player instance");
    if (index <= previousPlayerIndex) throw new Error("Invalid eligible automatic player order");
    previousPlayerIndex = index;
  }
  if (actor.hp <= 0) return null;
  const rawPlayers = units.filter(unit => unit.side === "player"), rawEnemies = units.filter(unit => unit.side === "enemy");
  const draw = (candidates: readonly BattleAITargetUnit[]) => candidates.length
    ? rawChoice(input.range, [candidates[drawBattleRandom(random, 0, candidates.length - 1)]!]) : null;
  switch (input.range) {
    case 1: return draw(rawEnemies);
    case 2: return rawChoice(input.range, rawEnemies);
    case 4:
    case 8: return rawChoice(input.range, rawPlayers);
    case 5: return rawChoice(input.range, [actor]);
    case 9: return rawChoice(input.range, rawPlayers.concat(rawEnemies));
    default: return draw(eligible);
  }
}
