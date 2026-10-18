// Shared numeric/status hit decision. PR's percent accuracy is retained:
// zero evasion and authored 100% remain 100%, rather than SNES's 255/256
// boundary. Blind halves physical accuracy (SNES CheckHit @2352 fallback).
export function hitChance(actor, target, ability, data = {}) {
  // Explicit story-test mode skips tower combat strategy, including the
  // PR tower monsters' high evade. Ordinary authored accuracy is unchanged.
  if (actor.testBoost && actor.magicOnly && target.side === "enemy") return 100;
  const accuracy = Number.isFinite(Number(ability.accuracy))
    ? Number(ability.accuracy)
    : (actor.accuracy ?? 100);
  if (ability.flags?.includes(1) || accuracy >= 255 || ability.kind === "heal") return 100;
  const physical = ability.kind === "physical";
  const blind = (actor.conditions || []).some(
    (id) => (data.conditions?.[id]?.condition_type ?? id) === 9,
  );
  const rate = physical && blind ? Math.floor(accuracy / 2) : accuracy;
  const evade = Math.max(
    0,
    Math.min(128, Number(physical ? target.evasion : target.magicEvasion) || 0),
  );
  return Math.max(0, Math.min(100, Math.floor(((256 - evade * 2) * rate) / 256)));
}

export function attackHits(actor, target, ability, random = Math.random, data = {}) {
  // Preserve the ordinary action's one RNG draw, including a 100% authored
  // hit; undodgeable/healing actions do not consume that draw.
  if (
    ability.flags?.includes(1) ||
    (ability.accuracy ?? actor.accuracy) >= 255 ||
    ability.kind === "heal"
  )
    return true;
  return random() * 100 < hitChance(actor, target, ability, data);
}
