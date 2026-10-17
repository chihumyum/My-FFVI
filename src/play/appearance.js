// Logical appearances only: no image loading, renderer state or presentation clocks.
export function fieldCharacterAsset(data, id) {
  const row = Object.entries(data.fieldAssets || {}).find(
    ([key, row]) => Number(row.character_id ?? key) === Number(id),
  )?.[1];
  return typeof row === "string" ? row : row?.asset_name;
}

function costume(data, unit) {
  return (data.appearanceConditions || []).find(
    (row) =>
      (row.characterId == null || Number(row.characterId) === Number(unit?.id)) &&
      unit?.conditions?.includes(row.conditionId),
  )?.asset;
}

export function partyFieldAsset(data, unit) {
  const status = data.systemTables?.characterStatus?.find(
    (row) => Number(row.id) === Number(unit?.id),
  );
  const row = data.systemTables?.characterAsset?.find(
    (row) =>
      Number(row.character_id) === Number(status?.character_asset_id) &&
      Number(row.job_id) === Number(unit?.jobId ?? status?.job_id) &&
      Number(row.asset_type) === 1,
  );
  return (
    costume(data, unit) ||
    data.fieldAssets?.[row?.field_character_asset_id]?.asset_name ||
    fieldCharacterAsset(data, unit?.id) ||
    `mo_ff6_p${String(unit?.id).padStart(3, "0")}`
  );
}

export function puppetFieldAsset(data, id, unit) {
  return (
    costume(data, unit) || fieldCharacterAsset(data, id) || `mo_ff6_p${String(id).padStart(3, "0")}`
  );
}

export function setPartyAppearance(game, actor, unit) {
  if (!actor || !unit) return;
  actor.characterId = unit.id;
  if (actor.vehicle > 1) actor.walkAsset = partyFieldAsset(game.data, unit);
  else actor.asset = partyFieldAsset(game.data, unit);
}

export function refreshCostume(game, unit) {
  const forms = (game.data.appearanceConditions || []).filter(
    (row) => row.characterId == null || Number(row.characterId) === Number(unit?.id),
  );
  if (!unit || (!forms.length && unit.disguise == null)) return;
  // Conditions are authoritative; RemoveCondition must not leave a stale form.
  if (Number(unit.id) === 2 || unit.disguise != null)
    unit.disguise =
      forms.find((row) => row.form && unit.conditions?.includes(row.conditionId))?.form || 0;
  if (game.player?.characterId === unit.id) setPartyAppearance(game, game.player, unit);
  for (const [key, actor] of game.actors || []) {
    if (actor.characterId === unit.id) setPartyAppearance(game, actor, unit);
    else if (actor.characterId == null && Number(key) === -unit.id && Number(key) < 0) {
      const asset = puppetFieldAsset(game.data, unit.id, unit);
      if (actor.vehicle > 1) actor.walkAsset = asset;
      else actor.asset = asset;
    }
  }
}
