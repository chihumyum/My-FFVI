// Complete source pool through declared player inputs and the existing owners.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runtimeDigest } from "./runtime-digest.mjs";
import { runContentBatchRoute } from "./content-batch-route.mjs";

const root = fileURLToPath(new URL("..", import.meta.url)), options = new Map();
for (let i = 2; i < process.argv.length; i++) {
  assert.ok(["--compiled-dir", "--content-dir", "--report"].includes(process.argv[i]) && !options.has(process.argv[i]) &&
    process.argv[i + 1] && !process.argv[i + 1].startsWith("--"), "Use --compiled-dir/--content-dir/--report <path>");
  options.set(process.argv[i], process.argv[++i]);
}
const compiled = resolve(root, options.get("--compiled-dir") ?? "dist"),
  contentDir = resolve(root, options.get("--content-dir") ?? "build/content-packages"),
  output = resolve(root, options.get("--report") ?? "build/reports/source-interiors-battles-check.json"),
  packageId = "south-figaro-interiors-battles", consumed = new Map(),
  sha = bytes => createHash("sha256").update(bytes).digest("hex"),
  load = name => import(pathToFileURL(resolve(compiled, "src", name + ".js")));
const report = { kind: "source-interiors-battles-check-v1", result: "running", packageId, cases: [],
  sourceCampaignComplete: false, sourceStoryReachability: "unassessed", nativeParity: false, browserVerified: false,
  limitations: ["Source initialization and the declared 228/PointIn2 Web placement are unchanged",
    "Complete raw source pool and all strict diagnostics remain; threshold and weighting are explicit Web rules",
    "Fixed player-input replay uses common session, map, command, prepared handoff and checkpoint owners",
    "Flag32 and outside maps remain independent unassessed branches", "Headless media readiness is not browser or original execution"] };
await mkdir(dirname(output), { recursive: true });
async function readURL(url) {
  assert.match(url, /^\/(?:content-packages|content-releases)\/[A-Za-z0-9/_-]+\.json$/);
  const path = url.startsWith("/content-packages/") ? resolve(contentDir, url.slice(18)) : resolve(root, "build", "." + url),
    bytes = await readFile(path);
  if (consumed.has(path)) assert.equal(sha(bytes), consumed.get(path), "Consumed content changed");
  else consumed.set(path, sha(bytes));
  return JSON.parse(bytes);
}
const inventory = state => new Map([...state.items.map(item => [`item:${item.id}`, item.count]),
  ...state.equipmentStock.map(item => [`equipment:${item.id}`, item.count])]);
try {
  const [integrity, content, batch, dependencies, walking, battleAnalysis, repositoryApi, historyApi, newGame, eventState,
    treasureApi] = await Promise.all(["core/content-integrity", "compiler/content", "compiler/content-batch",
    "compiler/content-dependencies", "compiler/source-walk-policy", "compiler/content-batch-battle", "core/game-content",
    "core/game-content-history", "core/new-game", "core/event-state", "core/treasure-inventory"].map(load));
  const runtimeHash = await runtimeDigest(root, compiled); report.runtimeHash = runtimeHash;
  const recipePath = resolve(root, "content-batches", packageId + ".recipe.json"), recipeBytes = await readFile(recipePath),
    recipe = JSON.parse(recipeBytes), contractPath = resolve(root, "content-batches", packageId + ".journey.json"),
    contractBytes = await readFile(contractPath), contract = JSON.parse(contractBytes),
    refs = await readURL(`/content-packages/${packageId}.json`),
    manifest = await readURL(`/content-packages/${packageId}/manifest.json`),
    built = await readURL(`/content-packages/${packageId}/build-report.json`),
    world = await integrity.verifyContent(await readURL(refs.world.url), refs.world.contentHash),
    entry = await integrity.verifyContent(await readURL(refs.initialized.entry.url), refs.initialized.entry.contentHash),
    battle = await integrity.verifyContent(await readURL(refs.initialized.battle.url), refs.initialized.battle.contentHash),
    maps = await Promise.all(contract.mapIds.map(async id => integrity.verifyContent(await readURL(world.maps[id].url), world.maps[id].contentHash)));
  assert.equal(contract.kind, "source-interiors-battles-journey-contract-v1"); assert.equal(contract.packageId, packageId);
  assert.deepEqual(contract.mapIds, [228, 229, 230, 231, 233, 234, 235, 236]);
  assert.deepEqual(manifest.contentRefs, refs); assert.deepEqual(built.refs, refs); assert.equal(built.recipeSha256, sha(recipeBytes));
  assert.equal(built.runtimeAdmission, "unassessed"); assert.equal(built.nativeWalkingRulesVerified, false);
  assert.equal(contract.sourceSetHash, world.sourceSetHash); assert.equal(contract.parentSourceSetHash, world.parentSourceSetHash);
  const originalMaps = [];
  for (const map of maps) {
    const pin = built.sourceInputs.maps.find(pin => pin.mapId === map.mapId); assert.ok(pin);
    const original = await integrity.verifyContent(await readURL(pin.url), pin.contentHash); originalMaps.push(original);
    const { contentHash: _, developmentProfile: __, frameworkPresentation: ___, walkEncounters: ____,
      frameworkWalkBinding: _____, ...retained } = map, { contentHash: ignored, ...body } = original;
    assert.equal(content.canonical(retained), content.canonical(body), "A raw source room changed");
    if (map.mapId !== 234) { assert.equal(map.walkEncounters, undefined); assert.equal(map.frameworkWalkBinding, undefined); }
  }
  const sourceEntry = await integrity.verifyContent(await readURL("/content-packages/source/entry.json"), built.sourceInputs.entry.contentHash),
    sourceBattle = await integrity.verifyContent(await readURL("/content-packages/source/battle.json"), built.sourceInputs.battle.contentHash);
  assert.equal(sourceEntry.developmentProfile, undefined); assert.deepEqual(battle.gameState, sourceBattle.gameState);
  assert.equal(entry.initializerHash, await integrity.contentDigest(battle.gameState.sourceNewGame));
  report.cases.push({ name: "unchanged-complete-source-rooms-and-initialization", result: "passed" });

  const plan = batch.planContentBatch(manifest, { entry, battle, catalog: world, maps }),
    route = manifest.routes.find(route => route.id === contract.routeId); assert.ok(route);
  assert.deepEqual(route, recipe.manifest.routes.find(route => route.id === route.id));
  assert.equal(await integrity.contentDigest(route.inputs), contract.programHash);
  assert.equal(await integrity.contentDigest(route.battleInputs), contract.battleProgramHash);
  assert.deepEqual(route.requiredMapIds, contract.mapIds); assert.deepEqual(route.requiredEncounterIds, [126, 374, 375]);
  assert.deepEqual(route.battleAbilityIds, []); assert.deepEqual(plan.diagnostics, built.diagnostics);
  assert.equal(plan.manifestHash, built.manifestHash);
  assert.deepEqual(built.diagnostics.filter(issue => issue.code === "map-outside-batch").map(issue => issue.mapId).sort((a, b) => a - b), [219, 227, 232]);
  assert.ok(built.diagnostics.some(issue => issue.code === "source-walk-encounter-policy-unimplemented"));
  assert.equal(built.diagnostics.filter(issue => /WITHOUT_ROUTE$/.test(issue.code)).length, 0);
  const { contentHash: omittedHash, developmentProfile: omittedProfile, ...originalWorld } = structuredClone(world);
  for (const original of originalMaps) originalWorld.maps[original.mapId] = { ...originalWorld.maps[original.mapId],
    url: built.sourceInputs.maps.find(pin => pin.mapId === original.mapId).url, contentHash: original.contentHash };
  const strictWorld = { ...originalWorld, contentHash: await integrity.contentDigest(originalWorld) };
  assert.equal(strictWorld.contentHash, built.sourceInputs.world.contentHash);
  const strict = dependencies.analyzeContentDependencies({ catalog: strictWorld, maps: originalMaps, roots: manifest.roots, mapIds: manifest.mapIds }),
    recorded = new Set(built.diagnostics.map(content.canonical));
  assert.ok(strict.diagnostics.every(issue => recorded.has(content.canonical(issue))), "A strict source diagnostic was dropped");
  const directory = await integrity.verifyContent(await readURL("/content-packages/source-battle-directory/framework.json"), built.battleDirectory.catalogHash),
    directoryReport = await integrity.verifyContent(await readURL("/content-packages/source-battle-directory/build-report.json"), built.battleDirectory.reportHash),
    requests = await integrity.verifyContent(await readURL("/content-packages/source-battle-directory/requests.json"), built.battleDirectory.requestsHash),
    strictCatalog = await integrity.verifyContent(await readURL("/content-packages/source-battle-directory/strict.json"), directoryReport.strictCatalogHash);
  assert.deepEqual(battle, directory); assert.ok(requests.requestedPartyIds.length > 3);
  for (const id of route.requiredEncounterIds) {
    assert.ok(requests.requestedPartyIds.includes(id));
    assert.ok(strictCatalog.encounterDiagnostics.some(issue => issue.partyId === id && ["battle-script", "battle-flags"].includes(issue.code)),
      "Original strict battle script/flags evidence disappeared");
  }
  const completePool = battleAnalysis.analyzeBatchEncounters(battle, [126, 374, 375]);
  assert.ok(completePool.encounters.every(encounter => encounter.status === "ready"));
  const map234 = maps.find(map => map.mapId === 234), declaration = recipe.walking.maps[0].declaration,
    walk = walking.compileSourceWalkPolicy({ mapId: 234, source: map234.sourceWalkEncounters, catalog: battle, declaration });
  assert.equal(walk.status, "ready"); assert.deepEqual(walk.encounterIds, [126, 374, 375]);
  assert.deepEqual(walk.dependencies.map(row => ({ slot: row.slot, partyId: row.partyId, rawRate: row.rawRate })), contract.walking.sourceSlots);
  assert.deepEqual(walk.policy.parties, [{ partyId: 375, weight: 80 }, { partyId: 374, weight: 80 }, { partyId: 126, weight: 96 }]);
  walking.assertSourceWalkPolicyBinding({ mapId: 234, source: map234.sourceWalkEncounters, catalog: battle,
    binding: map234.frameworkWalkBinding, policy: map234.walkEncounters });
  report.cases.push({ name: "complete-original-pool-diagnostics-and-explicit-web-policy", result: "passed", diagnostics: built.diagnostics,
    completePool, walking: walk, requestedDirectoryParties: requests.requestedPartyIds.length });

  const legacyRecipe = JSON.parse(await readFile(resolve(root, "content-batches", contract.baseJourney.recipe)));
  assert.equal(legacyRecipe.walking, null);
  assert.equal(await integrity.contentDigest(legacyRecipe.manifest.routes.find(route => route.id === contract.baseJourney.routeId).inputs),
    contract.baseJourney.programHash);
  let repository = new repositoryApi.GameContentRepository(readURL, "framework", refs);
  if (contentDir === resolve(root, "build/content-packages")) {
    const work = await integrity.verifyContent(await readURL("/content-packages/source-batches/work-plan.json")),
      selected = work.batches.find(item => item.packageId === packageId); assert.ok(selected);
    assert.equal(work.runtimeSha256, runtimeHash); assert.equal(selected.recipeSha256, sha(recipeBytes));
    assert.equal(selected.work.manifestHash, plan.manifestHash); assert.deepEqual(selected.work.contentHashes, plan.contentHashes);
    const history = new historyApi.GameContentHistory({ current: repository, profile: "framework", packageId, refs, loadJson: readURL }),
      current = await history.openCurrent(); repository = current.repository;
    report.publicationRuntime = { status: "bound", runtimeHash, releaseId: current.release.release.id };
  } else report.publicationRuntime = { status: "unassessed", reason: "Private candidate; no public collection receipt" };
  report.content = { refs, sourceSetHash: world.sourceSetHash, parentSourceSetHash: world.parentSourceSetHash,
    recipeSha256: sha(recipeBytes), journeyContractSha256: sha(contractBytes), manifestHash: plan.manifestHash,
    dependencyHash: plan.dependencyHash, programHash: contract.programHash, battleProgramHash: contract.battleProgramHash };
  report.cases.push({ name: "exact-declared-program-content-runtime-and-preserved-no-encounter-journey", result: "passed" });

  const run = await runContentBatchRoute({ root, compiled, plan, routeId: route.id, repository, runtimeHash, captureFinalState: true });
  report.journey = run;
  assert.equal(run.receipt.result, "completed", JSON.stringify(run.receipt.boundary));
  assert.deepEqual([...run.receipt.visitedMapIds].sort((a, b) => a - b), contract.mapIds);
  assert.equal(run.receipt.finalMapId, 228); assert.equal(run.receipt.checkpointReady, true); assert.equal(run.receipt.saveRestored, true);
  const victories = run.trace.filter(row => row.kind === "victory"), outcomes = run.trace.filter(row => row.kind === "declared-battle-outcome");
  assert.deepEqual(victories.map(row => row.id), contract.walking.expectedEncounterSequence);
  assert.equal(outcomes.length, contract.acceptance.expectedVictories); assert.ok(outcomes.every(row => row.phase === "victory"));
  assert.equal(run.execution.committedStarts, 5); assert.equal(run.execution.committedReturns, 5); assert.equal(run.execution.duplicateReturnsRejected, 5);
  const returns = run.trace.filter(row => row.kind === "ordinary-walking-return");
  assert.equal(returns.length, 5); assert.ok(returns.every(row => row.sameField && row.positionRetained));
  assert.equal(run.receipt.program.inputCount, route.inputs.length); assert.ok(run.receipt.program.restoreCount > 1);
  assert.ok(run.receipt.program.postRestoreInputCount > 0); assert.equal(run.execution.staleCommandChannelsRejected, run.receipt.program.restoreCount);
  assert.ok(run.trace.some((row, index) => row.kind === "save-restore" && !row.final &&
    run.trace.slice(0, index).some(prior => prior.kind === "victory") && run.trace.slice(index + 1).some(later => later.kind === "direction-input")));
  report.cases.push({ name: "five-natural-pool-entries-same-field-returns-restore-and-new-input", result: "passed" });

  const inputs = run.trace.filter(row => row.kind === "declared-battle-input"), resolutions = run.trace.filter(row => row.kind === "declared-battle-action-resolved");
  assert.ok(inputs.length > 0 && inputs.every(row => row.ownerBound && (row.rule.target.kind === "side"
    ? row.selection.kind === "side" && row.selection.side === row.rule.target.side
    : row.selection.kind === "single" && row.selection.id === row.rule.target.id)));
  assert.ok(inputs.some(row => row.rule.action.kind === "ability" && row.rule.action.abilityId === 1 && row.rule.commandId === 1));
  for (const row of inputs) {
    assert.notEqual(row.rule.commandId, 26); assert.notEqual(row.rule.action.abilityId, 218); assert.notEqual(row.rule.action.abilityId, 222);
  }
  assert.ok(resolutions.some(row => row.action.kind === "counter" && [487, 696].includes(row.action.source.id)),
    "No actual source command-conditioned interrupt completed");
  const menus = run.trace.filter(row => row.kind === "menu-command"),
    fieldCures = menus.filter(row => row.command.kind === "use-ability"),
    fieldItems = menus.filter(row => row.command.kind === "use-item");
  assert.equal(fieldCures.length, 4); assert.equal(fieldItems.length, 1);
  assert.ok(menus.every(row => row.accepted && row.ownerBound && row.pauseRestored));
  for (const [index, row] of fieldCures.entries()) {
    const declared = contract.inputStrategy.fieldRecovery[index];
    assert.equal(row.inputIndex, declared.inputIndex);
    assert.deepEqual(row.command, { kind: "use-ability", actorId: "player:1", abilityId: 31, selection: { kind: "all" } });
    const beforeActor = row.beforeOwned.roster.find(member => member.id === row.command.actorId),
      afterActor = row.afterOwned.roster.find(member => member.id === row.command.actorId);
    assert.equal(beforeActor.sourceId, 1); assert.ok(beforeActor.hp > 0);
    assert.equal(beforeActor.mp - afterActor.mp, battle.gameState.fieldAbilities.abilities[31].cost);
    assert.deepEqual(row.beforeOwned.items, row.afterOwned.items);
    assert.deepEqual(row.beforeOwned.equipmentStock, row.afterOwned.equipmentStock);
    assert.ok(row.afterOwned.roster.some(member => member.hp > row.beforeOwned.roster.find(before => before.id === member.id).hp),
      "The actual field ability must heal, not only accept an input");
    for (const member of row.afterOwned.roster) {
      const before = row.beforeOwned.roster.find(before => before.id === member.id);
      assert.equal(member.sourceId, before.sourceId); assert.deepEqual(member.conditionIds, before.conditionIds);
      assert.ok(member.hp >= before.hp && member.hp <= member.maxHp);
      if (member.id !== row.command.actorId) assert.equal(member.mp, before.mp);
    }
    const traceIndex = run.trace.indexOf(row), earlier = run.trace.slice(0, traceIndex).filter(row => row.kind === "victory");
    assert.equal(earlier.length, index + 1); assert.equal(earlier.at(-1).id, declared.afterEncounter);
  }
  const ether = fieldItems[0];
  assert.deepEqual(ether.command, { kind: "use-item", itemId: 6, targetId: "player:1" });
  assert.equal(ether.inputIndex, contract.inputStrategy.fieldRecovery[1].etherInputIndex);
  assert.equal(ether.beforeOwned.items.find(item => item.id === 6).count, 1);
  assert.equal(ether.afterOwned.items.find(item => item.id === 6).count, 0);
  assert.ok(ether.afterOwned.roster.find(member => member.id === "player:1").mp >
    ether.beforeOwned.roster.find(member => member.id === "player:1").mp);
  for (const gear of contract.inputStrategy.equipment)
    assert.equal(run.finalState.finalOwned.roster.find(member => member.id === gear.playerId).equipment[gear.slot - 1], gear.contentId);
  report.cases.push({ name: "exact-legal-player-commands-and-natural-source-interrupt-execution", result: "passed",
    acceptedInputs: inputs.length, resolvedActions: resolutions.length, fieldCures: fieldCures.length, fieldItems: fieldItems.length });

  const { initialOwned: initial, finalOwned: final, checkpoint } = run.finalState;
  assert.deepEqual(checkpoint.owned, final); assert.equal(final.completedBattles.length, 5);
  assert.deepEqual(final.completedBattles.map(row => row.encounterId), contract.walking.expectedEncounterSequence);
  const initialEvents = new eventState.EventState(newGame.createNewGame(battle.gameState.sourceNewGame).events),
    finalEvents = new eventState.EventState(checkpoint.world.field.eventState), flags = contract.treasures.map(box => box.flagId),
    expected = inventory(initial), add = (kind, id, count) => expected.set(`${kind}:${id}`, (expected.get(`${kind}:${id}`) ?? 0) + count);
  let treasureGil = 0;
  for (const box of contract.treasures) {
    const map = originalMaps.find(map => map.mapId === box.mapId), entity = map.map.groups.entity_default.entities.find(entity => entity.id === box.entityId);
    assert.equal(entity.treasure.flagId, box.flagId); assert.equal(entity.treasure.scriptId, 0);
    const ref = { category: "TreasureFlag1", index: box.flagId }; assert.equal(initialEvents.read(ref), 0); assert.equal(finalEvents.read(ref), 1);
    const reward = entity.treasure.reward;
    if (reward.kind === "grant-gil") treasureGil += reward.amount; else add(reward.kind === "grant-item" ? "item" : "equipment", reward.id, reward.count);
  }
  assert.deepEqual(flags, [27, 28, 29, 30, 31, 33, 34, 35, 36, 37, 38, 39]); assert.equal(treasureGil, 3000);
  for (const outcome of outcomes) {
    assert.ok(Array.isArray(outcome.reward.drops));
    for (const drop of outcome.reward.drops) add(drop.kind, drop.id, drop.count);
  }
  for (const row of resolutions) if (row.action.source.kind === "item") add("item", row.action.source.id, -1);
  for (const row of fieldItems) add("item", row.command.itemId, -1);
  const actual = inventory(final);
  for (const key of new Set([...expected.keys(), ...actual.keys()])) assert.equal(actual.get(key) ?? 0, expected.get(key) ?? 0, `Inventory mismatch ${key}`);
  const battleGil = outcomes.reduce((sum, row) => sum + row.reward.gil, 0);
  assert.equal(final.gil - initial.gil, treasureGil + battleGil); assert.equal(final.totalGil - initial.totalGil, treasureGil + battleGil);
  const lastPlayers = outcomes.at(-1).units.filter(unit => unit.side === "player");
  for (const player of lastPlayers) {
    const held = final.roster.find(member => member.id === player.id); assert.ok(held);
    assert.equal(held.hp, player.hp); assert.equal(held.mp, player.mp);
  }
  report.cases.push({ name: "source-treasure-flags-exact-inventory-and-five-once-only-reward-transactions", result: "passed", treasureGil, battleGil });
  const flag32 = { category: "TreasureFlag1", index: 32 };
  assert.equal(initialEvents.read(flag32), 0); assert.equal(finalEvents.read(flag32), 0);
  assert.ok(originalMaps.find(map => map.mapId === 233).scripts.sc_map_20361_14);
  assert.equal(await runtimeDigest(root, compiled), runtimeHash, "Runtime changed during journey check");
  assert.equal(sha(await readFile(recipePath)), sha(recipeBytes)); assert.equal(sha(await readFile(contractPath)), sha(contractBytes));
  for (const [path, digest] of consumed) assert.equal(sha(await readFile(path)), digest, "Consumed publication changed");
  report.cases.push({ name: "independent-flag32-branch-and-final-runtime-content-lock", result: "passed" }); report.result = "passed";
} catch (error) { report.result = "failed"; report.error = String(error.stack ?? error); throw error; }
finally { await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, cases: report.cases.length, report: output })); }
