import type { BattleRandom } from "./battle-hit.js";
import { drawBattleRandom } from "./battle-hit.js";

export type BattleSide = "player" | "enemy";
export type TargetMode = "single" | "side" | "all";
export type TargetRule = {
  life: "alive" | "include-fallen-players";
  relation: "ally" | "enemy" | "self" | "either";
  modes: TargetMode[];
  defaultMode: TargetMode;
  defaultRelation: "ally" | "enemy";
  /** Side-attack position groups are not represented by this profile yet. */
  normalFormationOnly: boolean;
};
export type TargetSelection =
  | { kind: "single"; id: string }
  | { kind: "side"; side: BattleSide }
  | { kind: "all" };
export type TargetChoice = {
  selection: TargetSelection;
  targetIds: string[];
};
type Unit = { id: string; side: BattleSide; hp: number };

/** Bounded development context. Hidden/untargetable units, confusion,
 * reflection and position-group scopes require their own admitted state inputs. */
export function battleTargetChoices(
  rule: TargetRule,
  actor: Unit,
  units: readonly Unit[],
  formation: "normal" | "opposed",
): TargetChoice[] {
  return targetChoices(rule, actor, units, formation);
}

/** Final caller supplies the native staged first-target predicate. A missing
 * predicate cannot acquire fallen targets; ordinary menus remain unchanged. */
export function battleFinalTargetChoices(rule: TargetRule, actor: Unit, units: readonly Unit[],
  formation: "normal" | "opposed", firstTargetSide: BattleSide | null): TargetChoice[] {
  if (firstTargetSide !== null && firstTargetSide !== "player" && firstTargetSide !== "enemy")
    throw new Error("Invalid staged Final first-target side");
  return targetChoices(rule, actor, units, formation, firstTargetSide);
}

function targetChoices(rule: TargetRule, actor: Unit, units: readonly Unit[],
  formation: "normal" | "opposed", finalFirstTargetSide?: BattleSide | null): TargetChoice[] {
  if (
    !["alive", "include-fallen-players"].includes(rule.life) ||
    !["ally", "enemy", "self", "either"].includes(rule.relation) ||
    !rule.modes.length ||
    new Set(rule.modes).size !== rule.modes.length ||
    rule.modes.some((m) => !["single", "side", "all"].includes(m)) ||
    !rule.modes.includes(rule.defaultMode) ||
    !["ally", "enemy"].includes(rule.defaultRelation) ||
    typeof rule.normalFormationOnly !== "boolean" ||
    (rule.relation === "self" && rule.modes.some((m) => m !== "single")) ||
    (rule.modes.includes("all") && rule.relation !== "either")
  )
    throw new Error("Invalid battle target rule");
  if (actor.hp <= 0 && finalFirstTargetSide === undefined || (rule.normalFormationOnly && formation !== "normal"))
    return [];
  const eligible = units.filter(
    (u) =>
      (u.hp > 0 || finalFirstTargetSide === "enemy" ||
        (rule.life === "include-fallen-players" && u.side === "player")) &&
      (rule.relation === "self"
        ? u.id === actor.id
        : rule.relation === "either" ||
          (rule.relation === "ally"
            ? u.side === actor.side
            : u.side !== actor.side)),
  );
  const preferred =
    rule.defaultRelation === "ally"
      ? actor.side
      : actor.side === "player"
        ? "enemy"
        : "player";
  const sides: BattleSide[] = [
    preferred,
    preferred === "player" ? "enemy" : "player",
  ];
  const modes = [
    rule.defaultMode,
    ...rule.modes.filter((m) => m !== rule.defaultMode),
  ];
  return modes.flatMap((mode): TargetChoice[] => {
    if (mode === "all")
      return eligible.length
        ? [{ selection: { kind: "all" }, targetIds: eligible.map((u) => u.id) }]
        : [];
    return sides.flatMap((side): TargetChoice[] => {
      const group = eligible.filter((u) => u.side === side);
      if (mode === "single")
        return group.map((u) => ({
          selection: { kind: "single", id: u.id },
          targetIds: [u.id],
        }));
      return group.length
        ? [
            {
              selection: { kind: "side", side },
              targetIds: group.map((u) => u.id),
            },
          ]
        : [];
    });
  });
}

export function sameTargetSelection(a: TargetSelection, b: TargetSelection) {
  return a.kind === "single"
    ? b.kind === "single" && a.id === b.id
    : a.kind === "side"
      ? b.kind === "side" && a.side === b.side
      : a.kind === "all" && b.kind === "all";
}

/** Preserve the selected faction across the wait, never fall back across sides.
 * Native 0x901190 chooses the first surviving enemy, or a random player. Player
 * weighting and Unity RNG remain outside this development profile. */
export function resolveBattleTargets(
  selection: TargetSelection,
  choices: readonly TargetChoice[],
  units: readonly Unit[],
  random: BattleRandom,
): TargetChoice | null {
  const current = choices.find((c) =>
    sameTargetSelection(c.selection, selection),
  );
  if (current) return structuredClone(current);
  if (selection.kind !== "single") return null;
  const original = units.find((u) => u.id === selection.id);
  if (!original) return null;
  const candidates = choices.filter(
    (c) =>
      c.selection.kind === "single" &&
      units.some((u) => u.id === c.targetIds[0] && u.side === original.side),
  );
  if (!candidates.length) return null;
  const index =
    original.side === "enemy"
      ? 0
      : drawBattleRandom(random, 0, candidates.length - 1);
  return structuredClone(candidates[index]!);
}
