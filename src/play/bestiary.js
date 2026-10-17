// Record visible combatants by their PR monster IDs, including event replacements.
// The original named source-event registrations remain in PlaySystems.bestiary.
export function observeBattleMonsters(battle) {
  battle.observedMonsters ??= new Set();
  for (const unit of battle.enemies)
    if (unit.monsterId > 0 && !unit.hidden && !unit.removed) battle.observedMonsters.add(unit);
}

export function recordBattleMonsters(battle) {
  if (battle.context.colosseum || !battle.observedMonsters?.size) return;
  const systems = (battle.banks.PlaySystems ??= {}),
    records = (systems.monsterRecords ??= {}),
    grouped = new Map();
  for (const unit of battle.observedMonsters) {
    const prior = grouped.get(unit.monsterId) || { seen: true, defeated: false };
    prior.defeated ||= !unit.escaped && unit.hp <= 0;
    grouped.set(unit.monsterId, prior);
  }
  for (const [id, entry] of grouped) {
    const record = (records[id] ??= { seen: 0, defeated: 0 });
    record.seen++;
    if (entry.defeated) record.defeated++;
  }
}

export function bestiaryRecords(game, battleData) {
  const exact = game?.banks?.PlaySystems?.monsterRecords;
  // Old saves retained formations rather than individual monster observations.
  // This is a display-only migration; it never changes the loaded game state.
  const records = {};
  const history = game?.battles || [],
    legacyCount = game?.banks?.PlaySystems?.monsterRecordsLegacyCount ?? history.length;
  for (const battle of history.slice(0, legacyCount)) {
    if (battle.outcome !== "victory") continue;
    for (const member of battleData.parties[battle.encounterId]?.members || [])
      records[member.monsterId] = { seen: 1, defeated: null, historical: true };
  }
  return { ...records, ...exact };
}
