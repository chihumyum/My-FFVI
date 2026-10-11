import type { TargetRule, TargetMode } from "../core/battle-targets.js";

/** AbilityRangeType and BattleTargetSelectUtility 0x3d58c0..0x3d59f0.
 * Range names alone are insufficient: 6/14/20/21 also restrict formation sides. */
export function compileTargetRule(
  range: number,
  system: number,
): TargetRule | null {
  let relation: TargetRule["relation"];
  let modes: TargetMode[];
  switch (range) {
    case 1:
      relation = "ally";
      modes = ["single"];
      break;
    case 2:
      relation = "ally";
      modes = ["side"];
      break;
    case 3:
      relation = "enemy";
      modes = ["single"];
      break;
    case 4:
      relation = "enemy";
      modes = ["side"];
      break;
    case 5:
      relation = "self";
      modes = ["single"];
      break;
    case 6:
    case 20:
      relation = "either";
      modes = ["single", "side"];
      break;
    case 7:
      relation = "either";
      modes = ["single"];
      break;
    case 8:
      relation = "either";
      modes = ["side"];
      break;
    case 9:
      relation = "either";
      modes = ["all"];
      break;
    case 14:
    case 21:
      relation = "enemy";
      modes = ["single", "side"];
      break;
    default:
      return null;
  }
  return {
    life: "alive",
    relation,
    modes,
    defaultMode: [20, 21].includes(range) ? "side" : modes[0]!,
    defaultRelation:
      relation === "ally" ||
      relation === "self" ||
      (relation === "either" && [1, 2, 4].includes(system))
        ? "ally"
        : "enemy",
    normalFormationOnly: [6, 14, 20, 21].includes(range),
  };
}
