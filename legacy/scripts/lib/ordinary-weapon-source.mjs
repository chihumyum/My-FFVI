import assert from "node:assert/strict";

/** Recompile from the manifest-bound BattleExtraDesc asset, not from the
 * published equipment catalog whose interpretation the caller is checking. */
export function exportedOrdinaryWeaponEffects(exported, reader, compile) {
  const matches = Object.values(exported.assets).filter((asset) =>
    asset.source.assetPath.endsWith("/battle_extra_data.json"));
  assert.equal(matches.length, 1, "Missing/ambiguous source BattleExtraDesc");
  const asset = matches[0];
  const containers = exported.sources.filter((entry) => entry.file === asset.source.file ||
    entry.file.endsWith("/" + asset.source.file));
  assert.equal(containers.length, 1, "Unbound weapon extra source");
  assert.match(containers[0].sha256, /^[0-9a-f]{64}$/);
  return { ...compile(reader, asset.data), source: { ...asset.source,
    sha256: containers[0].sha256, sourceSetHash: exported.parentSourceSetHash,
    battleSourceSetHash: exported.sourceSetHash,
  } };
}
