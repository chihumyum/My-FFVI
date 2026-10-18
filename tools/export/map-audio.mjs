export function compileMapAudio(rows) {
  return Object.fromEntries(
    rows.map((row) => [
      row.id,
      {
        bgmId: Number(row.bgm_id) || 0,
        environmentId: Number(row.environmental_se_id) || 0,
      },
    ]),
  );
}
