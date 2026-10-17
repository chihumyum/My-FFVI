// One declared original-content journey through the common route driver.
// Source story, native parity, the Flag32 branch and browser execution remain separate.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runtimeDigest } from "./runtime-digest.mjs";
import { runContentBatchRoute } from "./content-batch-route.mjs";

const root = fileURLToPath(new URL("..", import.meta.url)), options = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i];
  assert.ok(!options.has(key) && ["--compiled-dir", "--content-dir", "--report"].includes(key) &&
    process.argv[i + 1] && !process.argv[i + 1].startsWith("--"), "Use --compiled-dir/--content-dir/--report <path>");
  options.set(key, process.argv[++i]);
}
const compiled = resolve(root, options.get("--compiled-dir") ?? "dist"),
  contentDir = resolve(root, options.get("--content-dir") ?? "build/content-packages"),
  output = resolve(root, options.get("--report") ?? "build/reports/source-interiors-journey-check.json"),
  packageId = "south-figaro-interiors", routeId = "source-interiors-full-loop-and-treasures",
  mapIds = [228, 229, 230, 231, 233, 234, 235, 236], flagIds = [27, 28, 29, 30, 31, 33, 34, 35, 36, 37, 38, 39],
  load = name => import(pathToFileURL(resolve(compiled, "src", name + ".js"))),
  sha = bytes => createHash("sha256").update(bytes).digest("hex"), read = async path => JSON.parse(await readFile(path, "utf8"));
const report = { kind: "source-interiors-journey-check-v1", result: "running", packageId, routeId, cases: [],
  sourceCampaignComplete: false, sourceStoryReachability: "unassessed", browserVerified: false, originalGameExecuted: false,
  nativeParity: false, limitations: [
    "Eight source rooms use the declared 228/PointIn2 Web placement and unchanged source initialization",
    "One continuous declared player-input journey proves this state and route; it does not establish other story phases or branches",
    "The complete original diagnostics, external exits, encounter requirements and raw source payload remain in the batch",
    "Flag32's independent empty-box interaction is unassessed and deliberately untouched",
    "Walking encounters remain undeclared; a source battle directory is not battle-trigger or campaign coverage",
    "The common driver uses controlled headless media/audio readiness and real session/map/save APIs",
  ] };
await mkdir(dirname(output), { recursive: true });
const consumed = new Map();
async function readURL(url) {
  assert.match(url, /^\/(?:content-packages|content-releases)\/[A-Za-z0-9/_-]+\.json$/);
  const path = url.startsWith("/content-packages/") ? resolve(contentDir, url.slice("/content-packages/".length))
    : resolve(root, "build", "." + url), bytes = await readFile(path);
  if (consumed.has(path)) assert.equal(sha(bytes), consumed.get(path), "Journey content changed while being read");
  else consumed.set(path, sha(bytes));
  return JSON.parse(bytes);
}
function inventoryChanges(before, after) {
  const rows = key => {
    const old = new Map(before[key].map(row => [row.id, row.count])), next = new Map(after[key].map(row => [row.id, row.count]));
    return [...new Set([...old.keys(), ...next.keys()])].sort((a, b) => a - b).flatMap(id => {
      const change = (next.get(id) ?? 0) - (old.get(id) ?? 0); return change ? [{ id, count: change }] : [];
    });
  };
  return { gil: after.gil - before.gil, totalGil: after.totalGil - before.totalGil,
    items: rows("items"), equipment: rows("equipmentStock") };
}
try {
  const [integrity, content, batch, dependencies, repositoryApi, historyApi, eventApi, newGameApi, treasureApi] = await Promise.all([
    "core/content-integrity", "compiler/content", "compiler/content-batch", "compiler/content-dependencies",
    "core/game-content", "core/game-content-history", "core/event-state", "core/new-game", "core/treasure-inventory",
  ].map(load));
  const runtimeHash = await runtimeDigest(root, compiled); report.runtimeHash = runtimeHash;
  const recipePath = resolve(root, "content-batches/south-figaro-interiors.recipe.json"), recipeBytes = await readFile(recipePath),
    recipe = JSON.parse(recipeBytes), contractBytes = await readFile(resolve(root, "content-batches/south-figaro-interiors.journey.json")),
    contract = JSON.parse(contractBytes), refs = await readURL(`/content-packages/${packageId}.json`),
    manifestBytes = await readFile(resolve(contentDir, packageId, "manifest.json")), manifest = JSON.parse(manifestBytes),
    buildBytes = await readFile(resolve(contentDir, packageId, "build-report.json")), built = JSON.parse(buildBytes),
    world = await integrity.verifyContent(await readURL(refs.world.url), refs.world.contentHash),
    entry = await integrity.verifyContent(await readURL(refs.initialized.entry.url), refs.initialized.entry.contentHash),
    battleCatalog = await integrity.verifyContent(await readURL(refs.initialized.battle.url), refs.initialized.battle.contentHash),
    maps = await Promise.all(mapIds.map(async id => integrity.verifyContent(await readURL(world.maps[id].url), world.maps[id].contentHash)));
  assert.deepEqual(manifest.contentRefs, refs); assert.deepEqual(built.refs, refs);
  assert.equal(built.recipeSha256, sha(recipeBytes)); assert.deepEqual(manifest.mapIds, mapIds);
  assert.deepEqual(recipe.manifest.mapIds, mapIds); assert.equal(recipe.walking, null);
  assert.equal(recipe.kind, "initialized-source-map-recipe-v3"); assert.equal(built.runtimeAdmission, "unassessed");
  assert.equal(contract.kind, "source-interiors-journey-contract-v1"); assert.equal(contract.packageId, packageId);
  assert.equal(contract.routeId, routeId); assert.deepEqual(contract.mapIds, mapIds);
  assert.equal(contract.sourceSetHash, world.sourceSetHash); assert.equal(contract.parentSourceSetHash, world.parentSourceSetHash);
  const routes = manifest.routes.filter(route => route.id === routeId); assert.equal(routes.length, 1);
  const route = routes[0]; assert.deepEqual(route, recipe.manifest.routes.find(route => route.id === routeId));
  assert.equal(await integrity.contentDigest(route.inputs), contract.programHash);
  assert.equal(route.entry, "framework-new-game"); assert.equal(route.expectedMapId, 228);
  assert.deepEqual(route.requiredMapIds, mapIds); assert.deepEqual(route.requiredEncounterIds, []);
  assert.ok(route.inputs.some(input => input.kind === "save-restore"));
  const sourceMaps = [];
  for (const map of maps) {
    const pin = built.sourceInputs.maps.find(pin => pin.mapId === map.mapId); assert.ok(pin);
    const sourceMap = await integrity.verifyContent(await readURL(pin.url), pin.contentHash);
    assert.equal(map.developmentProfile.sourceContentHash, sourceMap.contentHash);
    const { contentHash: _, developmentProfile: __, frameworkPresentation: ___, ...retained } = map,
      { contentHash: sourceHash, ...original } = sourceMap;
    assert.equal(content.canonical(retained), content.canonical(original)); assert.equal(map.walkEncounters, undefined);
    assert.equal(map.frameworkNpcActivity, undefined); sourceMaps.push(sourceMap);
  }
  const sourceEntry = await integrity.verifyContent(await readURL("/content-packages/source/entry.json"), built.sourceInputs.entry.contentHash),
    sourceBattle = await integrity.verifyContent(await readURL("/content-packages/source/battle.json"), built.sourceInputs.battle.contentHash);
  assert.equal(content.canonical(battleCatalog.gameState), content.canonical(sourceBattle.gameState));
  assert.equal(entry.initializerHash, await integrity.contentDigest(sourceBattle.gameState.sourceNewGame));
  assert.equal(sourceEntry.developmentProfile, undefined);
  report.content = { refs, manifestSha256: sha(manifestBytes), buildReportSha256: sha(buildBytes), recipeSha256: sha(recipeBytes),
    journeyContractSha256: sha(contractBytes), manifestHash: await integrity.contentDigest(manifest), worldHash: world.contentHash,
    sourceSetHash: world.sourceSetHash, parentSourceSetHash: world.parentSourceSetHash,
    sourceMaps: sourceMaps.map(map => ({ mapId: map.mapId, contentHash: map.contentHash })), originalMapPayloadsChanged: false };
  report.cases.push({ name: "same-content-pins-and-unchanged-eight-original-room-payloads", result: "passed" });

  const plan = batch.planContentBatch(manifest, { entry, battle: battleCatalog, catalog: world, maps });
  assert.equal(plan.manifestHash, built.manifestHash); assert.deepEqual(plan.diagnostics, built.diagnostics);
  assert.equal(plan.diagnostics.filter(issue => issue.code === "BATCH_MAP_WITHOUT_ROUTE").length, 0);
  const outside = built.diagnostics.filter(issue => issue.code === "map-outside-batch");
  assert.deepEqual(outside.map(issue => issue.mapId).sort((a, b) => a - b), [219, 227, 232]);
  assert.ok(built.diagnostics.some(issue => issue.code === "source-walk-encounter-policy-unimplemented"));
  assert.ok(built.diagnostics.some(issue => issue.code === "BATCH_ENCOUNTER_WITHOUT_ROUTE"));
  const { contentHash: ignored, developmentProfile: omitted, ...sourceWorldBody } = structuredClone(world);
  for (const map of sourceMaps) {
    const pin = built.sourceInputs.maps.find(pin => pin.mapId === map.mapId);
    sourceWorldBody.maps[map.mapId] = { ...sourceWorldBody.maps[map.mapId], url: pin.url, contentHash: map.contentHash };
  }
  const sourceWorld = { ...sourceWorldBody, contentHash: await integrity.contentDigest(sourceWorldBody) };
  assert.equal(sourceWorld.contentHash, built.sourceInputs.world.contentHash);
  const strict = dependencies.analyzeContentDependencies({ catalog: sourceWorld, maps: sourceMaps, roots: manifest.roots, mapIds });
  const reported = new Set(built.diagnostics.map(content.canonical));
  assert.ok(strict.diagnostics.every(issue => reported.has(content.canonical(issue))), "A strict source diagnostic was dropped");
  report.diagnostics = { complete: built.diagnostics, count: built.diagnostics.length, originalField: strict.diagnostics,
    providerRequirements: strict.providerRequirements, outsideBoundaries: outside, runtimeAdmission: "unassessed" };
  report.cases.push({ name: "complete-source-and-battle-gaps-retained-after-declared-map-coverage", result: "passed" });

  let workBytes = null;
  try { workBytes = await readFile(resolve(contentDir, "source-batches/work-plan.json")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const publicCollection = contentDir === resolve(root, "build/content-packages");
  if (publicCollection) assert.ok(workBytes, "The public collection requires a runtime-bound work plan");
  const repository = new repositoryApi.GameContentRepository(readURL, "framework", refs);
  let runnerRepository = repository;
  if (workBytes) {
    const work = await integrity.verifyContent(JSON.parse(workBytes)), selected = work.batches.find(item => item.packageId === packageId);
    assert.equal(work.runtimeSha256, runtimeHash); assert.ok(selected); assert.equal(selected.recipeSha256, sha(recipeBytes));
    assert.equal(selected.work.manifestHash, plan.manifestHash);
    for (const [name, value] of Object.entries(plan.contentHashes)) assert.equal(selected.work.contentHashes[name], value);
    const selection = await integrity.verifyContent(await readURL("/content-packages/source-batches/selection.json"));
    assert.equal(selection.items.find(item => item.id === packageId)?.sha256, sha(recipeBytes));
    report.publicationRuntime = { status: "bound", runtimeHash, workPlanSha256: sha(workBytes) };
  } else report.publicationRuntime = { status: "unassessed", reason: "Private content candidate has no published collection receipt" };
  if (publicCollection) {
    const history = new historyApi.GameContentHistory({ current: repository, profile: "framework", packageId, refs, loadJson: readURL }),
      pinned = await history.openCurrent(); runnerRepository = pinned.repository;
    report.releaseId = pinned.release.release.id;
  }
  report.cases.push({ name: "declared-primitive-program-and-runtime-content-identity", result: "passed", inputs: route.inputs.length });

  const defaults = sourceMaps.flatMap(map => map.map.groups.entity_default.entities.filter(entity => entity.treasure)
    .map(entity => ({ mapId: map.mapId, entity }))).sort((a, b) => a.entity.treasure.flagId - b.entity.treasure.flagId);
  assert.equal(defaults.length, 12); assert.deepEqual(defaults.map(row => row.entity.treasure.flagId), flagIds);
  assert.equal(contract.treasures.length, 12);
  for (const row of defaults) {
    const metadata = contract.treasures.find(item => item.mapId === row.mapId && item.entityId === row.entity.id);
    assert.ok(metadata); assert.equal(metadata.flagId, row.entity.treasure.flagId);
    assert.equal(content.canonical(metadata.source), content.canonical(row.entity.source));
    assert.equal(row.entity.treasure.scriptId, 0); assert.equal(row.entity.mapObject.interaction.kind, "treasure");
    const face = route.inputs[metadata.faceInputIndex];
    assert.equal(face.kind, "face"); assert.equal(face.mapId, row.mapId); assert.equal(face.entityId, row.entity.id);
    assert.deepEqual(route.inputs[metadata.confirmInputIndex], { kind: "confirm" });
    assert.deepEqual(route.inputs[metadata.restoreInputIndex], { kind: "save-restore" });
  }
  const repeat = contract.emptyRevisit;
  assert.equal(repeat.mapId, 230); assert.equal(repeat.flagId, 27);
  assert.equal(route.inputs[repeat.firstFaceInputIndex].mapId, repeat.mapId);
  assert.equal(route.inputs[repeat.firstFaceInputIndex].entityId, repeat.entityId);
  assert.equal(defaults.find(row => row.mapId === repeat.mapId && row.entity.id === repeat.entityId)?.entity.treasure.flagId, repeat.flagId);
  assert.deepEqual(route.inputs[repeat.firstFaceInputIndex], route.inputs[repeat.repeatFaceInputIndex]);
  assert.deepEqual(route.inputs[repeat.firstConfirmInputIndex], { kind: "confirm" });
  assert.deepEqual(route.inputs[repeat.repeatConfirmInputIndex], { kind: "confirm" });
  assert.deepEqual(route.inputs[repeat.firstRestoreInputIndex], { kind: "save-restore" });
  assert.deepEqual(route.inputs[repeat.repeatRestoreInputIndex], { kind: "save-restore" });
  const run = await runContentBatchRoute({ root, compiled, plan, routeId, repository: runnerRepository, runtimeHash, captureFinalState: true });
  report.journey = run;
  assert.equal(run.receipt.result, "completed", JSON.stringify(run.receipt.boundary));
  assert.deepEqual(run.receipt.visitedMapIds.slice().sort((a, b) => a - b), mapIds);
  assert.equal(run.receipt.finalMapId, 228); assert.equal(run.receipt.checkpointReady, true);
  assert.equal(run.receipt.saveRestored, true); assert.equal(run.receipt.program.inputCount, route.inputs.length);
  assert.deepEqual(run.receipt.completedEncounterIds, []);
  assert.ok(run.receipt.program.restoreCount >= 2); assert.ok(run.receipt.program.postRestoreInputCount > 0);
  assert.ok(run.trace.some(item => item.kind === "map" && item.to === 233));
  report.cases.push({ name: "continuous-eight-room-loop-original-initializer-and-storage-continuation", result: "passed" });

  const contactInputs = run.trace.filter(item => item.kind === "direction-input" && item.result.kind === "door"),
    completedDoors = run.trace.filter(item => item.kind === "door-complete"),
    faced = run.trace.filter(item => item.kind === "direction-input" && item.input.kind === "face");
  assert.equal(contactInputs.length, 3); assert.equal(completedDoors.length, 3); assert.equal(faced.length, 13);
  assert.ok(faced.every(item => item.accepted && item.result.kind === "facing"));
  assert.ok(run.trace.filter(item => item.kind === "save-restore").every(item => item.staleCommandsRejected));
  report.inputs = { doors: contactInputs, completedDoors, facing: faced,
    restored: run.receipt.program.restoreCount, restoreContinuationInputs: run.receipt.program.postRestoreInputCount };
  report.cases.push({ name: "source-door-contact-and-explicit-facing-retain-the-existing-owners", result: "passed" });

  const { initialOwned, finalOwned, checkpoint } = run.finalState;
  assert.equal(content.canonical(finalOwned), content.canonical(checkpoint.owned));
  const initialEvents = new eventApi.EventState(newGameApi.createNewGame(battleCatalog.gameState.sourceNewGame).events),
    finalEvents = new eventApi.EventState(checkpoint.world.field.eventState),
    actual = inventoryChanges(initialOwned, finalOwned), expected = { gil: 0, totalGil: 0, items: [], equipment: [] };
  const rewards = { items: new Map(), equipment: new Map() };
  for (const { entity } of defaults) {
    const definition = entity.treasure, command = definition.reward;
    assert.equal(initialEvents.read(treasureApi.treasureFlagRef(definition.flagId)), 0);
    assert.equal(finalEvents.read(treasureApi.treasureFlagRef(definition.flagId)), 1);
    if (command.kind === "grant-gil") { expected.gil += command.amount; expected.totalGil += command.amount; }
    else {
      const values = rewards[command.kind === "grant-item" ? "items" : "equipment"];
      values.set(command.id, (values.get(command.id) ?? 0) + command.count);
    }
  }
  for (const key of ["items", "equipment"]) expected[key] = [...rewards[key]].sort(([a], [b]) => a - b)
    .map(([id, count]) => ({ id, count }));
  assert.deepEqual(actual, expected); assert.equal(expected.gil, 3000);
  assert.deepEqual(finalOwned.completedBattles, initialOwned.completedBattles);
  report.treasures = { sourceFlags: flagIds, grantedOnce: 12, explicitConfirmations: 13, actualRewardDelta: actual,
    expectedRewardDelta: expected, emptyRevisit: repeat, emptyRevisitDuplicatedReward: false,
    finalCheckpointHash: await integrity.contentDigest(checkpoint) };
  report.cases.push({ name: "twelve-original-rewards-persist-and-restored-empty-box-revisit-cannot-grant-twice", result: "passed" });

  const branchMap = sourceMaps.find(map => map.mapId === 233), branch = branchMap.scripts.sc_map_20361_14.find(op =>
    op.kind === "branch" && op.left.category === "TreasureFlag1" && op.left.index === 32);
  assert.ok(branch); assert.equal(branchMap.initializer, "sc_map_20361_14");
  assert.equal(initialEvents.read(treasureApi.treasureFlagRef(32)), 0); assert.equal(finalEvents.read(treasureApi.treasureFlagRef(32)), 0);
  assert.ok(!contract.treasures.some(item => item.flagId === 32));
  report.unassessedBranch = { mapId: 233, flagId: 32, value: 0, branch, retainedSourceGroups: Object.keys(branchMap.map.groups),
    status: "unassessed" };
  report.cases.push({ name: "independent-flag32-branch-and-source-walking-battle-gaps-remain-unassessed", result: "passed" });
  assert.equal(await runtimeDigest(root, compiled), runtimeHash, "Runtime changed during the source journey");
  assert.equal(sha(await readFile(recipePath)), sha(recipeBytes));
  assert.equal(sha(await readFile(resolve(root, "content-batches/south-figaro-interiors.journey.json"))), sha(contractBytes));
  assert.equal(sha(await readFile(resolve(contentDir, packageId, "build-report.json"))), sha(buildBytes));
  for (const [path, digest] of consumed) assert.equal(sha(await readFile(path)), digest, "A publication overlapped the source journey");
  report.result = "passed";
} catch (error) {
  report.result = "failed"; report.error = error instanceof Error ? error.stack : String(error); process.exitCode = 1;
}
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ result: report.result, report: output, cases: report.cases.length,
  maps: report.journey?.receipt.visitedMapIds, treasures: report.treasures?.grantedOnce,
  ...(report.error ? { error: report.error.split("\n")[0] } : {}) }));
