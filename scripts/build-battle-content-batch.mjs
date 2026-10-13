// A separately declared source battle selection. It extends a pinned catalog's
// encounter/reward content, never its owned seed, story route or capabilities.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { compileSharedBattleSource } from "../dist/src/compiler/battle.js";
import { compileGameCatalogModules } from "../dist/src/compiler/game-catalog.js";
import { loadSystemSource } from "../dist/src/compiler/system-source.js";
import { compileBattleEncounterSources } from "../dist/src/compiler/battle-encounters.js";
import { compileBattleEncounterRuntime } from "../dist/src/compiler/battle-encounter-runtime.js";
import { createBattleHandoffMusicLookup } from "../dist/src/compiler/battle-handoff.js";
import { readSnapshot, snapshotFile } from "../dist/src/compiler/integrity.js";
import { canonical, hash } from "../dist/src/compiler/content.js";
import { verifyContent } from "../dist/src/core/content-integrity.js";
import { validateBattleDropCatalog } from "../dist/src/core/battle-rewards.js";
import { parseBattleHandoffPolicy } from "../dist/src/core/battle-handoff-content.js";
import { parseBattleBatchEntryPolicy, compileBattleBatchEntryPolicy } from "../dist/src/compiler/battle-batch-entry.js";

const repository = resolve(import.meta.dirname, "..");
const digest = /^[a-f0-9]{64}$/;
function fields(value, expected) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), "Invalid battle batch record");
  assert.ok(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  assert.deepEqual(Reflect.ownKeys(value).sort(), expected.split(",").sort(), "Invalid battle batch fields");
  assert.ok(Object.values(Object.getOwnPropertyDescriptors(value)).every(d => d.enumerable && "value" in d),
    "Battle batch fields must be own data");
}
export function parseBattleContentBatchDeclaration(raw) {
  const extended = raw && Object.hasOwn(raw, "entryPolicy");
  fields(raw, "kind,id,parentSourceSetHash,battleSourceSetHash,baseCatalogRef,partyIds,handoff" +
    (extended ? ",entryPolicy" : ""));
  assert.equal(raw.kind, extended ? "battle-content-batch-declaration-v2" : "battle-content-batch-declaration-v1");
  assert.match(raw.id, /^[a-z0-9][a-z0-9-]{0,79}$/);
  assert.match(raw.parentSourceSetHash, digest); assert.match(raw.battleSourceSetHash, digest);
  fields(raw.baseCatalogRef, "url,contentHash");
  assert.match(raw.baseCatalogRef.url, /^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.json$/);
  assert.match(raw.baseCatalogRef.contentHash, digest);
  assert.ok(Array.isArray(raw.partyIds) && raw.partyIds.length > 0 &&
    raw.partyIds.every(id => Number.isInteger(id) && id > 0 && id <= 0x7fffffff) &&
    new Set(raw.partyIds).size === raw.partyIds.length, "Invalid battle batch party selection");
  return { ...structuredClone(raw), handoff: parseBattleHandoffPolicy(raw.handoff),
    ...(extended ? { entryPolicy: parseBattleBatchEntryPolicy(raw.entryPolicy) } : {}) };
}
const within = (parent, path) => {
  const child = relative(parent, path);
  return child && child !== ".." && !child.startsWith(".." + sep) && !isAbsolute(child);
};
const uniqueMerge = (before, extra, label) => {
  const result = structuredClone(before), ids = new Map(result.map(row => [row.id, row]));
  assert.equal(ids.size, result.length, "Duplicate " + label);
  for (const row of extra) {
    const previous = ids.get(row.id);
    if (previous) assert.equal(canonical(previous), canonical(row), "Conflicting source " + label + ": " + row.id);
    else { result.push(structuredClone(row)); ids.set(row.id, row); }
  }
  return result;
};
const summarize = (entries, diagnostics) => ({
  requested: entries.length, compiledDefinitions: entries.filter(e => e.status === "compiled").length,
  blocked: entries.filter(e => e.status === "blocked").length,
  withRuntimeDependencies: new Set(diagnostics.filter(d => d.kind === "runtime-dependency").map(d => d.partyId)).size,
  withDevelopmentOmissions: new Set(diagnostics.filter(d => d.kind === "development-omission").map(d => d.partyId)).size,
  originalGameExecuted: false, entries,
});

/** Complete source readers resolve selected data; the declared base alone
 * supplies executable abilities, conditions, media and owned content. A blocked
 * selection returns its diagnostics and no replacement/fallback catalog. */
export async function compileBattleContentBatch(root, rawDeclaration) {
  root = resolve(root);
  const declaration = parseBattleContentBatchDeclaration(rawDeclaration);
  const build = resolve(root, "build"), basePath = await realpath(resolve(build, declaration.baseCatalogRef.url.slice(1)));
  assert.ok(within(build, basePath), "Battle base must be inside build");
  const base = await verifyContent(JSON.parse(await readFile(basePath, "utf8")), declaration.baseCatalogRef.contentHash);
  assert.equal(base.kind, "narshe-battle-catalog");
  assert.ok(base.common && base.gameState && base.encounters && base.encounterReport);
  const [source, snapshot] = await Promise.all([compileSharedBattleSource(root), readSnapshot(resolve(root, "build/battle"))]);
  const exported = JSON.parse(snapshotFile(snapshot, "battle.json").toString());
  assert.equal(source.parentSourceSetHash, declaration.parentSourceSetHash, "Batch parent source pin mismatch");
  assert.equal(exported.sourceSetHash, declaration.battleSourceSetHash, "Batch battle source pin mismatch");
  const [modules, system] = await Promise.all([compileGameCatalogModules(root, source), loadSystemSource(root, source.parentSourceSetHash)]);
  assert.equal(base.common.fieldSourceSetHash, modules.common.fieldSourceSetHash, "Battle base field source mismatch");
  // Retain every consumed table identity in the independent batch report.
  const bindings = new Map(), reader = {};
  for (const method of ["row", "unique", "group", "matching"]) reader[method] = (...args) => {
    const result = system.reader[method](...args);
    for (const row of Array.isArray(result) ? result : [result]) {
      const binding = { table: args[0], source: row.source };
      bindings.set(canonical(binding), structuredClone(binding));
    }
    return result;
  };
  reader.handoffMusic = createBattleHandoffMusicLookup(system.tables, reader);
  const descriptors = compileBattleEncounterSources(reader, {
    partyIds: declaration.partyIds,
    json: name => {
      const matches = Object.values(exported.assets).filter(asset => asset.source.assetPath.endsWith("/" + name + ".json"));
      assert.equal(matches.length, 1, "Missing or ambiguous battle JSON: " + name);
      const asset = matches[0], files = exported.sources.filter(file =>
        file.file === asset.source.file || file.file.endsWith("/" + asset.source.file));
      assert.equal(files.length, 1, "Unbound battle JSON: " + name);
      return { data: structuredClone(asset.data), source: { ...asset.source, sha256: files[0].sha256,
        sourceSetHash: source.parentSourceSetHash, battleSourceSetHash: source.sourceSetHash } };
    },
    spritePath: suffix => {
      const matches = Object.keys(exported.sprites).filter(key => key.toLowerCase().endsWith(suffix.toLowerCase()));
      assert.equal(matches.length, 1, "Missing or ambiguous battle sprite: " + suffix);
      return matches[0];
    },
  });
  const runtime = compileBattleEncounterRuntime(reader, { ...modules.runtimeInput,
    requestedPartyIds: descriptors.requestedPartyIds, encounters: descriptors.encounters,
    sourceDiagnostics: descriptors.diagnostics, abilities: base.common.abilities,
    conditions: base.common.conditions, sprites: base.common.sprites,
    handoff: { policy: declaration.handoff }, development: declaration.entryPolicy
      ? compileBattleBatchEntryPolicy(declaration.entryPolicy, descriptors.encounters)
      : { scripts: [], flagGroups: [] } });
  // A source drop rule may extend rewards, but never grants initial stock or
  // fills a missing ownership/capability catalog from another entry.
  for (const content of runtime.drops.contents) {
    const admitted = content.kind === "item" ? base.gameState.items[content.id]
      : base.gameState.equipmentSystem?.catalog.definitions[content.id];
    if (admitted) continue;
    for (const encounter of Object.values(runtime.encounters)) {
      const masters = new Set(encounter.enemies.map(enemy => enemy.sourceId));
      if (!runtime.drops.monsters.some(monster => masters.has(monster.id) && monster.slots.some(slot => slot.contentId === content.id))) continue;
      runtime.diagnostics.push({ partyId: encounter.encounterId, kind: "blocked", code: "batch-owned-drop-content",
        reason: "Pinned base has no owned " + content.kind + " definition for source drop " + content.id,
        source: encounter.handoff.source.row, dependency: { table: "content.csv", id: content.id } });
    }
  }
  const incomplete = new Set(runtime.diagnostics.filter(d => d.kind === "blocked" || d.kind === "runtime-dependency").map(d => d.partyId));
  const entries = runtime.report.entries.map(entry => incomplete.has(entry.partyId)
    ? { ...entry, status: "blocked" } : entry);
  const report = { kind: "battle-content-batch-build-v1", id: declaration.id,
    declarationHash: hash(declaration), baseCatalogRef: declaration.baseCatalogRef,
    parentSourceSetHash: source.parentSourceSetHash, battleSourceSetHash: exported.sourceSetHash,
    compiledSharedSourceSetHash: source.sourceSetHash, originalRequestedPartyIds: [...exported.encounterPartyIds],
    partyIds: [...descriptors.requestedPartyIds], result: entries.every(entry => entry.status === "compiled") ? "compiled" : "blocked",
    handoff: declaration.handoff, runtime: { ...runtime.report, ...summarize(entries, runtime.diagnostics) },
    diagnostics: runtime.diagnostics,
    sourceBindings: [...bindings.values()].sort((a, b) => canonical(a).localeCompare(canonical(b))),
    sources: descriptors.encounters.map(encounter => ({ partyId: encounter.partyId, source: encounter.source,
      metadata: encounter.metadata, patterns: encounter.patterns, background: encounter.background,
      enemies: encounter.enemies.map(enemy => ({ sourceId: enemy.monsterId, uniqueId: enemy.slot,
        group: enemy.group, x: enemy.x, y: enemy.y, sprite: enemy.sprite, aiSource: enemy.ai.source })) })),
    initialStateChanged: false, sourceRoutesChanged: false, nativeHandoffVerified: false,
    sourceGameplayVerified: false, fullGameMigrated: false,
    ...(declaration.entryPolicy ? { entryPolicy: declaration.entryPolicy,
      entryScope: "authored-framework-entry-with-source-bound-omissions" } : {}) };
  if (report.result === "blocked") return { catalog: null, report };
  assert.equal(canonical(base.common.drops.weights), canonical(runtime.drops.weights), "Source drop weights conflict with base");
  const drops = { ...structuredClone(base.common.drops),
    monsters: uniqueMerge(base.common.drops.monsters, runtime.drops.monsters, "monster drop"),
    contents: uniqueMerge(base.common.drops.contents, runtime.drops.contents, "drop content") };
  validateBattleDropCatalog(drops);
  const selected = new Set(declaration.partyIds), { contentHash: oldHash, ...payload } = structuredClone(base);
  payload.common.drops = drops;
  payload.encounters = { ...payload.encounters, ...runtime.encounters };
  payload.encounterDiagnostics = [...payload.encounterDiagnostics.filter(d => !selected.has(d.partyId)), ...runtime.diagnostics];
  const combinedEntries = [...payload.encounterReport.entries.filter(e => !selected.has(e.partyId)), ...entries].sort((a, b) => a.partyId - b.partyId);
  payload.encounterReport = { ...payload.encounterReport, ...summarize(combinedEntries, payload.encounterDiagnostics),
    handoffSources: [...(payload.encounterReport.handoffSources ?? []).filter(e => !selected.has(e.partyId)), ...runtime.report.handoffSources] };
  const catalog = { ...payload, contentHash: hash(payload) };
  await verifyContent(catalog);
  assert.equal(canonical(catalog.gameState), canonical(base.gameState));
  const { drops: ignoredBefore, ...beforeCommon } = base.common, { drops: ignoredAfter, ...afterCommon } = catalog.common;
  assert.equal(canonical(beforeCommon), canonical(afterCommon));
  report.contentHash = catalog.contentHash;
  report.addedDropMonsterIds = runtime.drops.monsters.filter(row => !base.common.drops.monsters.some(old => old.id === row.id)).map(row => row.id);
  report.addedDropContentIds = runtime.drops.contents.filter(row => !base.common.drops.contents.some(old => old.id === row.id)).map(row => row.id);
  return { catalog, report };
}

/** Publish only a complete declared selection. Failed builds preserve any
 * previous independent output; no source export or default catalog is touched. */
export async function buildBattleContentBatch({ root = repository,
  declarationPath = "content-batches/ordinary-battles.json", outDir = "build/content-batches/ordinary-battles" } = {}) {
  root = resolve(root);
  const declaration = JSON.parse(await readFile(resolve(root, declarationPath), "utf8"));
  const result = await compileBattleContentBatch(root, declaration);
  if (!result.catalog) { const error = new Error("Battle content batch is blocked"); error.report = result.report; throw error; }
  const target = resolve(root, outDir), parent = resolve(target, ".."), backup = target + ".previous";
  assert.ok(within(resolve(root, "build/content-batches"), target), "Independent battle output must be inside build/content-batches");
  await mkdir(parent, { recursive: true });
  const staged = await mkdtemp(resolve(parent, ".battle-batch-"));
  try {
    await writeFile(resolve(staged, "battle.json"), canonical(result.catalog) + "\n");
    await writeFile(resolve(staged, "report.json"), JSON.stringify(result.report, null, 2) + "\n");
    await writeFile(resolve(staged, "declaration.json"), canonical(parseBattleContentBatchDeclaration(declaration)) + "\n");
    try { await stat(backup); throw new Error("Inspect interrupted battle batch publication: " + backup); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    let previous = false;
    try { await rename(target, backup); previous = true; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    try { await rename(staged, target); }
    catch (error) { if (previous) await rename(backup, target); throw error; }
    if (previous) await rm(backup, { recursive: true });
  } finally { await rm(staged, { recursive: true, force: true }); }
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  assert.ok(args.length <= 2, "Use build-battle-content-batch.mjs [declaration.json] [outDir]");
  const result = await buildBattleContentBatch({ declarationPath: args[0], outDir: args[1] });
  console.log(JSON.stringify({ result: result.report.result, partyIds: result.report.partyIds,
    contentHash: result.catalog.contentHash, output: args[1] ?? "build/content-batches/ordinary-battles" }));
}
