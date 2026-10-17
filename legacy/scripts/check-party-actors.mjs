// Independent raw-table/source checks. This is not original-game execution.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const index = process.argv.indexOf("--build-dir");
const build = resolve(root, index < 0 ? "dist" : process.argv[index + 1]);
const { compilePartyActorCatalog, compileNarshePartyActorCheckpoint } = await import(pathToFileURL(build + "/src/compiler/party-actors.js"));
const { preparePartyActors, partyMemberFieldAsset } = await import(pathToFileURL(build + "/src/core/party-actors.js"));
const read = async (path) => JSON.parse(await readFile(root + path, "utf8"));
const sha = (s) => createHash("sha256").update(s).digest("hex");
const tableBytes = await readFile(root + "build/import/tables.json");
const tables = JSON.parse(tableBytes);
const battleSource = await read("build/battle/battle.json");
const miscRecords = Object.values(battleSource.assets).filter((a) => a.source.assetPath.endsWith("/serial_misc_assets.json"));
assert.equal(miscRecords.length, 1);
const misc = miscRecords[0].data;
const { catalog, dependencies } = compilePartyActorCatalog(tables, misc);
const assetRows = tables["field_character_asset.csv"], characterRows = tables["character_asset.csv"];
const rawAsset = (id) => {
  const matches = assetRows.filter((a) => Number(a.id) === id);
  assert.equal(matches.length, 1);
  return matches[0];
};
assert.equal(assetRows.length, 47);
assert.equal(catalog.residents.length, 47);
assert.deepEqual(catalog.residents, assetRows.map((a) => ({ characterId: Number(a.character_id), fieldAssetId: Number(a.id) })));
assert.ok(catalog.residents.some((a) => a.characterId === 204));
assert.ok(catalog.residents.some((a) => a.characterId === 108));
const members = [[1, 19], [31, 18], [32, 18]].map(([sourceId, jobId], index) => ({
  id: `owned:${sourceId}`, index, sourceId, jobId, enabled: true, row: "front", conditionIds: [],
}));
const sourceMappings = members.map((m) => {
  const first = characterRows.find((r) => Number(r.character_id) === m.sourceId && Number(r.job_id) === m.jobId);
  assert.ok(first);
  const expected = Number(first.field_character_asset_id);
  const actual = partyMemberFieldAsset(catalog, m);
  assert.equal(actual.id, expected);
  assert.equal(actual.asset, rawAsset(expected).asset_name);
  return { sourceId: m.sourceId, jobId: m.jobId, rowId: Number(first.id), fieldAssetId: expected };
});
assert.deepEqual(sourceMappings.map((r) => r.fieldAssetId), [1, 31, 31]);
assert.deepEqual(sourceMappings.map((r) => r.rowId), [33, 1081, 1116]);
const records = (await Promise.all([
  "map_20010_assets_all_162c173f95a38b2a517f5b1708a98e6c",
  "map_40037_assets_all_1d18f7f40eee0a55af0d7e5b7aaf23f9",
  "map_40000_assets_all_2a9aa4fca66bf397923a415639bbd405",
].map((name) => read("build/corpus/bundles/" + name + ".json")))).flat();
const checkpoint = compileNarshePartyActorCheckpoint(catalog, records, members);
const before = JSON.stringify(checkpoint);
assert.deepEqual(checkpoint.sourceProof.route, [609, 572, 3]);
assert.equal(checkpoint.context.leaderIndex, 0);
assert.equal(checkpoint.context.companion, null);
assert.equal(checkpoint.playerAssetCacheId, 1);
assert.deepEqual(checkpoint.context.currentTransport, { id: 6, typeId: 12, fieldAssetId: 38 });
assert.deepEqual(checkpoint.context.player, { id: "-1001", fieldAssetId: 38, riderFieldAssetId: 1, riding: true });
assert.deepEqual(checkpoint.context.puppets.map((a) => [a.fieldAssetId, a.riderFieldAssetId, a.riding]),
  [[38, 1, true], [38, 31, true], [38, 31, true], [1, null, false]]);
assert.deepEqual(checkpoint.context.conditionColliders, [{ id: "354", collisionType: 0, throughConditionType: 0 }]);
assert.deepEqual(checkpoint.context.multiParty.map((p) => [p.leaderIndex, p.actor.fieldAssetId, p.actor.riding, p.members.length]),
  [[0, null, false, 0], [0, null, false, 0], [0, null, false, 0]]);
assert.deepEqual(checkpoint.sourceProof.sourcePuppetBindings.map((p) => [p.sourceEntityId, p.actorId]),
  [[-1001, "native:puppet:0"], [-1002, "native:puppet:1"], [-1003, "native:puppet:2"]]);
const context = structuredClone(checkpoint.context);
context.multiParty[0].members = structuredClone(members);
const plan = preparePartyActors(catalog, members, context, true);
assert.equal(plan.cameraOffset, null); // source riding branch leaves it untouched
assert.deepEqual(plan.colliderChanges, []);
assert.equal(plan.playerAssetCache.id, 1);
assert.deepEqual(plan.changes.map((c) => [c.actorId, c.asset.id, c.mode]), [
  ["-1001", 1, "rider"], ["native:puppet:0", 1, "rider"], ["native:puppet:1", 31, "rider"],
  ["native:puppet:2", 31, "rider"], ["native:puppet:3", 1, "replace"], ["native:party:0", 1, "replace"],
]);
assert.equal(JSON.stringify(checkpoint), before);
const switched = structuredClone(context); switched.leaderIndex = 1;
const switchedPlan = preparePartyActors(catalog, members, switched, true);
assert.equal(switchedPlan.changes[0].asset.id, 31);
assert.equal(switchedPlan.changes[0].mode, "rider");
assert.equal(switchedPlan.playerAssetCache.id, 31);
const invalid = structuredClone(members); invalid[0].conditionIds.push(1);
assert.throws(() => compileNarshePartyActorCheckpoint(catalog, records, invalid), /initial member/);
assert.throws(() => compileNarshePartyActorCheckpoint(catalog, records.filter((r) => !r.source.assetPath.endsWith("/entity_default.json")), members), /checkpoint source/);
const tampered = structuredClone(records);
tampered.find((r) => r.source.assetPath.endsWith("/sc_e_0001_3.json")).data.Mnemonics[6].operands.iValues[1] = -1002;
assert.throws(() => compileNarshePartyActorCheckpoint(catalog, tampered, members), /source needs review/);
const report = { lane: "source-party-actor-projection", tableSha256: sha(tableBytes), miscSource: miscRecords[0].source,
  sourceMappings, dependencyCount: dependencies.length, checkpoint, plan,
  nativeExecutionVerified: false, doesNotEstablish: ["original-game-parity", "general-prelude-execution", "future-map-context", "all-source-media-loaded", "full-game-reachability"] };
const output = JSON.stringify(report, null, 2) + "\n";
await writeFile(root + "build/reports/party-actors-check.json", output);
console.log(JSON.stringify({ residents: catalog.residents.length, sourceMappings, changes: plan.changes.length,
  reportSha256: sha(output), nativeExecutionVerified: false }, null, 2));
