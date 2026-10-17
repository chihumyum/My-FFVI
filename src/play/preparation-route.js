function progress(game, state) {
  if (state.kind === 'shopping') return Object.values(game.banks.PlaySystems?.purchases || {}).reduce((sum, n) => sum + Number(n), 0);
  if (state.kind === 'rest') return game.party.reduce((sum, unit) => sum + unit.hp + unit.mp, 0);
  const lesson = state.lesson;
  if (lesson) return game.unit(lesson.memberId).abilities?.includes(lesson.abilityId) ? 100 :
    game.unit(lesson.memberId).magicLearning?.[lesson.abilityId] || 0;
  return Object.values(game.roster).reduce((sum, unit) => sum + (unit.exp || 0), 0);
}

export function observePreparationTravel(game) {
  for (const state of game.preparationRoutes?.values() || []) {
    const value = progress(game, state), members = game.party.map(unit => unit.id).join(',');
    if (value > state.progress || members !== state.members) {
      state.edges.clear(); state.blocked = false; state.members = members;
    }
    state.progress = value;
    if (state.active && state.mapId !== game.mapId) {
      const edge = `${state.mapId}>${game.mapId}`, count = (state.edges.get(edge) || 0) + 1;
      state.edges.set(edge, count);
      if (count >= 3 && !state.blocked) {
        state.blocked = true;
        game.warn(null, `Optional ${state.kind} travel repeated ${edge} without preparation progress; continuing the story.`);
      }
    }
    state.active = false;
  }
}

// Optional preparation yields to the story when the actual source journey
// repeatedly returns to the same maps without a paid service or learned AP.
export function preparationRoute(game, input, kind, goal = game.storyObjective?.id || 'field') {
  if (!input || ['no-route', 'no-input', 'no-navigation'].includes(input.status)) return null;
  const key = `${kind}:${goal}`;
  game.preparationRoutes ??= new Map();
  let state = game.preparationRoutes.get(key);
  if (!state) {
    state = { kind, lesson: kind === 'training' ? game.preparationTraining?.lesson : null,
      edges: new Map(), members: game.party.map(unit => unit.id).join(','), mapId: game.mapId };
    state.progress = progress(game, state);
    game.preparationRoutes.set(key, state);
    if (game.preparationRoutes.size > 12) game.preparationRoutes.delete(game.preparationRoutes.keys().next().value);
  }
  if (state.blocked) return null;
  state.mapId = game.mapId; state.active = true;
  return input;
}
