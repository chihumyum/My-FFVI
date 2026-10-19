// An optional player aid. Never edits levels, stats, rewards or saved characters.
// Source events can still move/remove participants and force narrative outcomes.
export function invincible(host, unit) {
  return !!host.context?.assists?.invincible && unit.side === "player" && unit.hp > 0;
}
export function incomingHpDamage(host, unit, amount) {
  return amount > 0 && invincible(host, unit) ? 0 : amount;
}
