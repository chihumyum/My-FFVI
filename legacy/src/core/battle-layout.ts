/** A common Web development layout, not the original game's coordinate,
 * formation-selection or orientation rules. The battle owner chooses formation;
 * this projection never draws random numbers or changes combat state. */
export type DevelopmentBattleLayoutUnit = {
  id: string;
  side: "player" | "enemy";
  row: "front" | "back";
  placement: { group: number } | null;
};
export type DevelopmentBattlePosition = {
  x: number;
  y: number;
  facing: "left" | "right";
};
export type DevelopmentBattleLayout = Record<string, DevelopmentBattlePosition>;

/** Coordinates are ground anchors in the desktop development battle area of a
 * 512 × 288 viewport. Keep them at or above y=155 to leave space for the
 * four-member overlaid menu; this is not a contract for every viewport size.
 * Merely staying inside the canvas would hide the last row behind the menu.
 * The grid leaves room around ordinary sprites but cannot bound oversized art.
 * Array order within each faction/wing is the compiled source slot order; IDs
 * are never parsed, sorted or merged, including repeated monster templates.
 * All units participate even when fallen, so their neighbours do not jump. */
export function projectDevelopmentBattleLayout(
  units: readonly DevelopmentBattleLayoutUnit[],
  formation: "normal" | "opposed",
): DevelopmentBattleLayout {
  if (!Array.isArray(units) || !["normal", "opposed"].includes(formation))
    throw new Error("Unsupported development battle layout");
  const ids = new Set<string>(), players: DevelopmentBattleLayoutUnit[] = [], enemies: DevelopmentBattleLayoutUnit[] = [];
  for (const unit of units) {
    if (!unit || typeof unit.id !== "string" || !unit.id || unit.id.trim() !== unit.id || ids.has(unit.id) ||
        !["player", "enemy"].includes(unit.side) || !["front", "back"].includes(unit.row))
      throw new Error("Invalid or duplicate development battle layout unit");
    ids.add(unit.id);
    (unit.side === "player" ? players : enemies).push(unit);
    if (formation === "opposed" && unit.side === "enemy" &&
        (!unit.placement || ![1, 2].includes(unit.placement.group)))
      throw new Error("Opposed development layout requires enemy group 1 or 2");
  }
  if (players.length > 4 || enemies.length > 9)
    throw new Error("Development battle layout supports at most four players and nine enemies");
  const result: [string, DevelopmentBattlePosition][] = [];
  for (const [index, player] of players.entries()) result.push([player.id, {
    x: (formation === "opposed" ? 235 : 350) + index * 15 + (player.row === "back" ? 20 : 0),
    y: 78 + index * 25,
    facing: "left",
  }]);
  const grid = (members: readonly DevelopmentBattleLayoutUnit[], centerX: number, width: number,
    facing: DevelopmentBattlePosition["facing"]) => {
    const columns = Math.ceil(members.length / 3);
    const rows = columns ? Math.ceil(members.length / columns) : 0;
    for (const [index, member] of members.entries()) result.push([member.id, {
      x: columns === 1 ? centerX : centerX - width / 2 + index % columns * width / (columns - 1),
      y: 105 + (Math.floor(index / columns) - (rows - 1) / 2) * 50,
      facing,
    }]);
  };
  if (formation === "normal") grid(enemies, 160, 176, "right");
  else {
    grid(enemies.filter((unit) => unit.placement!.group === 1), 112, 112, "right");
    grid(enemies.filter((unit) => unit.placement!.group === 2), 408, 112, "left");
  }
  return Object.fromEntries(result);
}
