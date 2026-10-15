// Controlled observation policy, not a game AI or permission to grant skills.
export const BATTLE_OBSERVER_INPUT_POLICY = 'current-menu-qualified-ability-v1';
export function chooseBattleObserverInput(battle, actorId) {
  const menu = battle.commandMenu(actorId);
  const options = menu.filter(command => command.kind === 'ability' && command.available)
    .flatMap(command => command.abilityIds.map(abilityId => ({ commandId: command.id, abilityId })));
  // Preserve source menu and ability order, including the concrete command
  // context when several commands offer the same ability.
  for (const option of options) {
    if (!battle.canUse(actorId, option.abilityId, option.commandId)) continue;
    const choice = battle.targetChoices(actorId, option.abilityId)[0];
    if (choice) return { kind: 'choice', policy: BATTLE_OBSERVER_INPUT_POLICY,
      actorId, ...option, selection: structuredClone(choice.selection) };
  }
  return { kind: 'unavailable', policy: BATTLE_OBSERVER_INPUT_POLICY,
    actorId, menu: structuredClone(menu) };
}
