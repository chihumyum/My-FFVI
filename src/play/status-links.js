// PR343→630 Charm and336→674 LoveToken need an actual caster/recipient
// relationship. Pairing, reversed affiliation and cover follow SNES
// target_effect.asm @3c91/@3d37, choose_target.asm @5937, cover.asm @123b.
// Exact random-command weights and PR's cover flag details are not exported.
import { ordinaryWeapon } from "./weapon-damage.js";
const typeOf = (host, id) => host.data.conditions?.[id]?.condition_type ?? id;
const hasType = (host, unit, types) =>
  (unit.conditions || []).some((id) => types.includes(typeOf(host, id)));
const participants = (host) => [...(host.players || []), ...(host.enemies || [])];
const present = (host, unit) =>
  participants(host).includes(unit) &&
  unit.hp > 0 &&
  !unit.removed &&
  !unit.escaped &&
  !unit.engulfed &&
  !hasType(host, unit, [5, 11, 34]);
const valid = (host, link) =>
  present(host, link.owner) &&
  present(host, link.target) &&
  (link.target.conditions || []).includes(link.conditionId);

function discard(host, link) {
  // These two source markers have no other derived stat. Remove only the
  // linked marker, not unrelated conditions or another caster's link.
  if (
    !(host.statusLinks || []).some(
      (other) =>
        other !== link && other.target === link.target && other.conditionId === link.conditionId,
    )
  ) {
    link.target.conditions = (link.target.conditions || []).filter((id) => id !== link.conditionId);
    if (link.target.conditionUntil) delete link.target.conditionUntil[link.conditionId];
  }
}

export function pruneStatusLinks(host) {
  const links = host.statusLinks || [];
  for (const link of links) if (!valid(host, link)) discard(host, link);
  host.statusLinks = links.filter((link) => valid(host, link));
}

export function clearStatusLinks(host) {
  const links = host.statusLinks || [];
  host.statusLinks = [];
  for (const link of links) discard(host, link);
}

export function statusLinkFor(host, unit, type) {
  return (host.statusLinks || []).find(
    (link) => link.type === type && link.target === unit && valid(host, link),
  );
}

export function bindStatusLink(host, owner, target, conditionId) {
  const type = typeOf(host, conditionId);
  if (![630, 674].includes(type)) return false;
  pruneStatusLinks(host);
  const links = (host.statusLinks ??= []);
  if (!present(host, owner) || !present(host, target)) return false;
  const held = links.find((link) => link.type === type && link.owner === owner);
  if (held?.target === target) return true;
  if (type === 630 && held) {
    // SNES Charm refuses a second target while the caster has one.
    if (!links.some((link) => link.target === target && link.conditionId === conditionId))
      target.conditions = (target.conditions || []).filter((id) => id !== conditionId);
    return false;
  }
  for (const link of links.filter(
    (link) => link.type === type && (link.owner === owner || link.target === target),
  ))
    discard(host, link);
  host.statusLinks = links.filter(
    (link) => !(link.type === type && (link.owner === owner || link.target === target)),
  );
  if (!(target.conditions || []).includes(conditionId))
    (target.conditions ??= []).push(conditionId);
  host.statusLinks.push({ type, conditionId, owner, target });
  host.warning?.(
    type === 630
      ? "PR Charm links its real caster and recipient. Involuntary direct-command selection and reversed target affiliation follow SNES; exact PR random-command weights are inferred."
      : "PR LoveToken links its real caster and recipient. Viable single-target physical cover follows SNES; exact PR cover flags are inferred, with undodgeable and area actions excluded.",
  );
  return true;
}

export function charmAction(host, unit, actions) {
  if (!statusLinkFor(host, unit, 630)) return null;
  const available = actions.filter(
    (ability) =>
      typeof ability.id === "number" &&
      !ability.disabled &&
      !ability.magiciteSummon &&
      // These commands require persistent role state or multi-stage input,
      // not just a direct ability execution. Do not consume a blank turn by
      // selecting their numeric menu placeholder. Row's fn17 is executable.
      ![8, 9, 20, 22, 23, 24, 25, 30, 31].includes(ability.commandId) &&
      !ability.functions?.some((fn) => [15, 18, 38, 51].includes(fn.id)),
  );
  const random = host.random || Math.random;
  const ability =
    available[Math.min(available.length - 1, Math.floor(random() * available.length))] ||
    host.data.abilities?.[1];
  if (!ability) return null;
  const own = unit.side === "enemy" ? host.enemies : host.players;
  const opposite = unit.side === "enemy" ? host.players : host.enemies;
  const pool = (
    ability.range === 5
      ? [unit]
      : ability.target === "ally" || ability.kind === "heal"
        ? opposite
        : own
  ).filter((target) => present(host, target) && !target.hidden && !target.untargetable);
  if (!pool.length) return { ability, targets: [] };
  const targets = ability.all
    ? pool
    : [pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]];
  return { ability, targets };
}

export function loveTokenCover(host, actor, target, ability, targetCount) {
  const physical =
    ability.kind === "physical" ||
    ability.process === "StealAttack" ||
    ability.functions?.some((fn) => [2, 77, 78].includes(fn.id));
  if (
    !physical ||
    targetCount !== 1 ||
    ability.all ||
    ability.flags?.includes(1) ||
    ability.accuracy >= 255
  )
    return target;
  // Resolve a target-dependent weapon plan only after choosing the actual
  // recipient. Dice's authored weapon process is already undodgeable before
  // that plan, so it cannot become coverable merely because Fight has no flag.
  if (ability.id === 1) {
    const process = ordinaryWeapon(host.data, actor)?.weapon.process_prog;
    if (["DICE", "CHEAT_DICE"].includes(process)) return target;
  }
  const link = (host.statusLinks || []).find(
    (link) => link.type === 674 && link.owner === target && valid(host, link),
  );
  const guard = link?.target;
  if (
    !guard ||
    guard === target ||
    guard.hidden ||
    guard.untargetable ||
    guard.controlledEnemyIndex != null ||
    hasType(host, guard, [7, 12, 17, 416, 627, 657])
  )
    return target;
  host.event?.("battle-cover", {
    actorSide: actor.side,
    actorIndex: actor.index,
    protectedSide: target.side,
    protectedIndex: target.index,
    targetSide: guard.side,
    targetIndex: guard.index,
    conditionId: link.conditionId,
  });
  return guard;
}
