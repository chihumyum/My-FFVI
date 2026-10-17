// PR's misc declaration maps condition types to field character IDs. Neither
// IDs nor CSV row numbers may be substituted for character_id in this join.
export function compileAppearanceConditions(tables, assets) {
  const changes = assets.flatMap((asset) => asset.data?.change_character_condition_list || []);
  return changes
    .flatMap((change) => {
      const field = (tables["field_character_asset.csv"] || []).find(
        (row) => Number(row.character_id) === Number(change.field_character_asset_cid),
      );
      if (!field?.asset_name)
        throw Error(`Missing field condition appearance ${change.condition_type}`);
      return (tables["condition.csv"] || [])
        .filter((row) => Number(row.condition_type) === Number(change.condition_type))
        .map((row) => ({
          conditionId: Number(row.id),
          conditionType: Number(row.condition_type),
          asset: field.asset_name,
          ...([665, 666].includes(Number(row.condition_type))
            ? { form: Number(row.condition_type) === 665 ? 2 : 1 }
            : {}),
        }));
    })
    .sort((a, b) => a.conditionId - b.conditionId);
}
