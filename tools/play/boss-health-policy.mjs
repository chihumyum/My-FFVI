// Statistics fixture only; never imported by the game's automatic player.
export function isHpRecovery(action) {
  return (
    !action.revive &&
    !action.magiciteSummon &&
    (String(action.id).startsWith("item:") || action.kind === "heal") &&
    (action.functions || []).some((fn) => fn.id === 34 || (fn.id === 1 && fn.values?.[1] !== 3))
  );
}
