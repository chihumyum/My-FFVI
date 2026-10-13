// Real source compilation with controlled exported-snapshot mutations and a
// fresh production session. This is not browser or original-game acceptance.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 2 && args[0] === "--dist", "Use --dist <directory>");
const compiled = resolve(root, args[1] ?? "dist");
const module = name => import(pathToFileURL(resolve(compiled, "src", name + ".js")).href);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const output = resolve(root, "build/reports/shared-game-catalog-check.json");
await mkdir(dirname(output), { recursive: true });
const report = {
  formatVersion: 1, kind: "shared-game-catalog-mechanism-check-v1", result: "running",
  nativeVerified: false, browserVerified: false, originalGameExecuted: false,
  semanticsVerified: false, sourceGameplayVerified: false, stages: [], packages: [],
  scope: "shared compiler, explicit entry composition and fresh-session ownership",
  limitations: [
    "Edited exported snapshots are controlled independence probes, not changed original-game bytes.",
    "Ready definitions and blocked diagnostics do not certify gameplay, timing or native parity.",
    "The inventory transaction uses the fresh owner's public port; no source story or added native script root is executed.",
    "An added synthetic typed root has no native script context and is correctly rejected before its inventory operation publishes.",
  ],
};
// Captured by re-running the pre-split compiler and comparing its complete
// canonical result to the then-published artifact. The receipt remains local.
const baseline = {
  sourceSetHash: "709e349895fa29bf3f34b36ec527dcebb189b81c79c7b9437dff4237c2203ac6",
  parentSourceSetHash: "6638e4e4f46835754f17c376a253da6de7a1996cab5e9fda71ff09cddace8965",
  contentHash: "bbc228c88a15a97c10fd0a7a7d962f8349169bd9e1af33390dd2c56061ecd139",
  openingPlayableContentHash: "0dc745cd3f410fd836344f0983e75ef3ad0998a236b30e78ffd84134636edbf5",
};
let currentStage = "load-modules";
const scratch = [];
async function stage(name, body) {
  currentStage = name;
  const details = await body();
  report.stages.push({ name, result: "passed", ...(details ?? {}) });
}
try {
  const { compileOpeningBattle, compileSharedBattleSource, validateBattleMediaSelection } = await module("compiler/battle");
  const { readSnapshot, snapshotFile } = await module("compiler/integrity");
  const { compileOpeningPlayable } = await module("compiler/opening-playable");
  const { compileSharedGameCatalog } = await module("compiler/game-catalog");
  const { compileSourceNewGame } = await module("compiler/source-new-game");
  const { assertSourceGameCatalog } = await module("core/source-catalog");
  const { hash, canonical } = await module("compiler/content");
  const { verifyContent } = await module("core/content-integrity");
  const { createNewGame } = await module("core/new-game");
  const { createSourceNativeState } = await module("core/source-native-state");
  const { GameSession } = await module("core/game-session");
  const { FieldFadeState } = await module("core/field-fade");
  const { createSourcePresentationContext } = await module("core/source-presentation");
  let legacy, shared, catalog, legacyCatalog, entry, world, map, game;
  const packageFile = async (file, expected) => {
    const bytes = await readFile(resolve(root, file));
    const value = await verifyContent(JSON.parse(bytes), expected);
    report.packages.push({ file, contentHash: value.contentHash, fileSha256: sha(bytes) });
    return value;
  };

  await stage("legacy-source-and-entry-bind-the-verified-media-scope", async () => {
    const exported = await readSnapshot(resolve(root, "build/battle")), imported = await readSnapshot(resolve(root, "build/import"));
    const media = JSON.parse(snapshotFile(exported, "battle.json"));
    validateBattleMediaSelection(media, JSON.parse(snapshotFile(imported, "tables.json")));
    legacy = await compileOpeningBattle(root);
    assert.equal(legacy.sourceSetHash, media.sourceSetHash);
    assert.equal(legacy.parentSourceSetHash, baseline.parentSourceSetHash);
    assert.deepEqual(legacy.encounterPartyIds, media.encounterPartyIds);
    if (media.adapterVersion === "battle-0.3.0") {
      assert.equal(legacy.sourceSetHash, baseline.sourceSetHash);
      assert.equal(legacy.contentHash, baseline.contentHash);
    }
    assert.deepEqual(legacy, await packageFile("build/game/opening-battle.json", legacy.contentHash));
    assert.equal(legacy.entryProviders.ownedConditionCheckpoint.conditionType, 607);
    legacyCatalog = await compileOpeningPlayable(root, legacy);
    if (media.adapterVersion === "battle-0.3.0") assert.equal(legacyCatalog.contentHash, baseline.openingPlayableContentHash);
    assert.deepEqual(legacyCatalog, await packageFile("build/game/opening-playable.json", legacyCatalog.contentHash));
    return { sourceSetHash: legacy.sourceSetHash, parentSourceSetHash: legacy.parentSourceSetHash,
      sourceContentHash: legacy.contentHash, developmentCatalogHash: legacyCatalog.contentHash,
      adapterVersion: media.adapterVersion, mediaSelection: media.mediaSelection ?? null };
  });

  await stage("shared-source-keeps-requested-content-and-blockers-without-a-seed", async () => {
    shared = await compileSharedBattleSource(root);
    await verifyContent(shared);
    assert.equal(Object.hasOwn(shared.entryProviders, "ownedConditionCheckpoint"), false);
    for (const key of ["sourceSetHash", "parentSourceSetHash", "nativeProfile", "encounters",
      "encounterPartyIds", "encounterDiagnostics", "initialParty", "ownedInitializations",
      "ownedInitializationBlockers", "characterGrowth", "characterGrowthBlockers", "battleAppearance"])
      assert.deepEqual(shared[key], legacy[key], key);
    assert.deepEqual(shared.entryProviders.catalog, legacy.entryProviders.catalog);
    assert.ok(shared.ownedInitializationBlockers.length > 0);
    assert.ok(shared.encounterPartyIds.length > 0);
    return { sourceContentHash: shared.contentHash, requestedPartyIds: shared.encounterPartyIds,
      sourceEncounterDiagnostics: shared.encounterDiagnostics,
      initializationBlockers: shared.ownedInitializationBlockers.length };
  });

  await stage("source-entry-uses-real-initializer-and-retains-unimplemented-battle-dependencies", async () => {
    catalog = await compileSharedGameCatalog(root, shared);
    await verifyContent(catalog); assertSourceGameCatalog(catalog);
    assert.equal(catalog.common.sourceContentHash, shared.contentHash);
    assert.equal(Object.hasOwn(catalog.gameState, "initialOwnedConditions"), false);
    const plan = createNewGame(catalog.gameState.sourceNewGame);
    assert.deepEqual(catalog.common.players.map(p => [p.id, p.sourceId, p.conditionIds]),
      plan.owned.roster.map(p => [p.id, p.sourceId, p.conditionIds]));
    assert.deepEqual(catalog.encounterReport.entries.map(e => e.partyId).sort((a, b) => a - b),
      [...shared.encounterPartyIds].sort((a, b) => a - b));
    assert.equal(catalog.encounterReport.withDevelopmentOmissions, 0);
    assert.ok(catalog.encounterDiagnostics.every(d => d.kind !== "development-omission"));
    const script = shared.encounters.filter(e => e.metadata.scriptId === 8010);
    const flags = shared.encounters.filter(e => e.metadata.battleFlagGroupId === 11);
    assert.ok(script.length && flags.length, "Source regression dependencies disappeared");
    for (const encounter of script) {
      assert.ok(catalog.encounterDiagnostics.some(d => d.partyId === encounter.partyId &&
        d.kind === "blocked" && d.code === "battle-script" && d.dependency?.id === 8010));
      assert.equal(catalog.encounters[encounter.partyId], undefined);
    }
    for (const encounter of flags) {
      assert.ok(catalog.encounterDiagnostics.some(d => d.partyId === encounter.partyId &&
        d.kind === "blocked" && d.code === "battle-flags"));
      assert.equal(catalog.encounters[encounter.partyId], undefined);
    }
    assert.throws(() => assertSourceGameCatalog(legacyCatalog), /condition seed/);
    return { sourceCatalogHash: catalog.contentHash, initialSourceIds: plan.owned.roster.map(p => p.sourceId),
      initialConditionIds: plan.owned.roster.map(p => p.conditionIds), encounterReport: catalog.encounterReport,
      diagnostics: catalog.encounterDiagnostics };
  });

  // Rebind only the snapshot envelope of an isolated controlled export. Source
  // file fingerprints and decimal object identities are not rewritten.
  const mutatePrelude = async variant => {
    const fixture = await mkdtemp(resolve(root, "build/v60-shared-source-")); scratch.push(fixture);
    await mkdir(resolve(fixture, "build/corpus/bundles"), { recursive: true });
    for (const directory of ["import", "battle", "field"])
      await symlink(resolve(root, "build", directory), resolve(fixture, "build", directory), "dir");
    const directory = resolve(root, "build/corpus");
    const manifestBytes = await readFile(resolve(directory, "corpus.json"));
    const manifest = JSON.parse(manifestBytes);
    const snapshot = JSON.parse(await readFile(resolve(directory, "snapshot.json"), "utf8"));
    const proof = legacy.entryProviders.ownedConditionCheckpoint.scripts.at(-1);
    assert.ok(proof); assert.match(proof.source.objectId, /^-?\d+$/);
    const bundles = manifest.bundles.filter(b => b.file === proof.source.file);
    assert.equal(bundles.length, 1); const bundle = bundles[0];
    const sourceBytes = await readFile(resolve(directory, bundle.output));
    assert.equal(sha(sourceBytes), snapshot.files.find(f => f.file === bundle.output).sha256);
    assert.equal(sha(manifestBytes), snapshot.files.find(f => f.file === "corpus.json").sha256);
    const records = JSON.parse(sourceBytes), selected = records.filter(a =>
      a.source.assetPath === proof.source.assetPath && a.source.objectId === proof.source.objectId);
    assert.equal(selected.length, 1); assert.equal(hash(selected[0].data), proof.contentHash);
    let changed = records;
    if (variant === "missing") {
      changed = records.filter(a => a !== selected[0]); bundle.jsonAssets--; bundle.scripts--;
    } else {
      const index = proof.instructionIndices[0], operands = selected[0].data.Mnemonics[index].operands;
      assert.equal(operands.iValues.length, 8);
      operands.iValues[7] = operands.iValues[7] === 0 ? 1 : 0;
      assert.notEqual(hash(selected[0].data), proof.contentHash);
    }
    const replacements = new Map([[bundle.output, Buffer.from(JSON.stringify(changed))],
      ["corpus.json", Buffer.from(JSON.stringify(manifest))]]);
    for (const item of snapshot.files) {
      const destination = resolve(fixture, "build/corpus", item.file);
      await mkdir(dirname(destination), { recursive: true });
      const replacement = replacements.get(item.file);
      if (replacement) { await writeFile(destination, replacement); item.sha256 = sha(replacement); }
      else await symlink(resolve(directory, item.file), destination, "file");
    }
    await writeFile(resolve(fixture, "build/corpus/snapshot.json"), JSON.stringify(snapshot));
    return { fixture, provenance: proof.source, mutation: variant,
      exportBundleSha256: sha(replacements.get(bundle.output)), originalDataHash: proof.contentHash };
  };
  for (const variant of ["missing", "mismatch"]) {
    await stage(`shared-production-ignores-${variant}-development-proof`, async () => {
      const probe = await mutatePrelude(variant);
      const actual = await compileSharedBattleSource(probe.fixture);
      assert.deepEqual(actual, shared);
      const actualCatalog = await compileSharedGameCatalog(probe.fixture, actual);
      assert.deepEqual(actualCatalog, catalog);
      assertSourceGameCatalog(actualCatalog);
      await assert.rejects(() => compileOpeningBattle(probe.fixture),
        variant === "missing" ? /checkpoint script/ : /checkpoint source needs review/);
      const { fixture: _, ...evidence } = probe;
      return { ...evidence, sharedSourceHash: actual.contentHash, sourceCatalogHash: actualCatalog.contentHash,
        sharedCompiledDirectly: true, developmentAdapterRejected: true };
    });
  }

  await stage("production-new-game-builder-binds-the-independent-source-catalog", async () => {
    entry = await compileSourceNewGame(root, catalog);
    await verifyContent(entry);
    assert.equal(entry.battleCatalogHash, catalog.contentHash);
    assert.notEqual(entry.battleCatalogHash, legacyCatalog.contentHash);
    world = await packageFile("build/world/catalog.json", entry.worldCatalogHash);
    map = await packageFile(`build/world/maps/${entry.entry.mapId}.json`, entry.mapContentHash);
    assert.equal(world.sourceSetHash, entry.sourceSetHash);
    assert.equal(map.parentSourceSetHash, shared.parentSourceSetHash);
    return { entryContentHash: entry.contentHash, sourceCatalogHash: entry.battleCatalogHash,
      entry: entry.entry };
  });

  await stage("fresh-production-session-uses-source-owned-identities-and-resources", async () => {
    const before = canonical({ catalog, entry, world, map });
    const fade = new FieldFadeState({ imageColor: { r: 0, g: 0, b: 0, a: 1 },
      rendererColor: { r: 1, g: 1, b: 1, a: 0 }, raycastTarget: false });
    const presentation = createSourcePresentationContext({ kind: "title-new-game",
      titleCleanupComplete: true, openingCallbackStarted: false });
    game = GameSession.prepareNewGame(entry, world, map, catalog, fade, presentation);
    const plan = createNewGame(catalog.gameState.sourceNewGame), owned = game.state.snapshot();
    assert.equal(owned.initialization, "source-new-game");
    assert.equal(owned.catalogHash, catalog.contentHash);
    assert.deepEqual(owned.nativeState, createSourceNativeState(plan));
    assert.deepEqual(owned.roster.map(p => [p.id, p.sourceId, p.ownedId, p.name, p.hp, p.mp, p.conditionIds]),
      plan.owned.roster.map(p => [p.id, p.sourceId, p.ownedId, p.name, p.hp, p.mp, p.conditionIds]));
    assert.deepEqual(owned.party, plan.owned.party); assert.deepEqual(owned.items, plan.owned.items);
    assert.deepEqual(owned.equipmentStock, plan.owned.equipmentStock);
    assert.equal(game.gil, plan.owned.gil); assert.deepEqual(game.battlePreferences, plan.battlePreferences);
    assert.equal(game.battle, null); assert.ok(game.field.player.native);
    assert.deepEqual(game.state.fieldPuppetRoster.current().owned.map(p => [p.ownedId, p.sourceId]),
      plan.owned.roster.map(p => [p.ownedId, p.sourceId]));
    assert.equal(canonical({ catalog, entry, world, map }), before);
    return { ownedSnapshotHash: hash(owned), roster: owned.roster.map(p => ({ id: p.id, sourceId: p.sourceId,
      ownedId: p.ownedId, conditionIds: p.conditionIds })), sourceStoryExecuted: false };
  });

  await stage("fresh-session-inventory-transaction-retains-its-single-owner", async () => {
    const owner = game.state, field = game.field, initial = owner.snapshot(), events = field.eventState.snapshot();
    // Provider admission and the real public ownership transaction are checked
    // without inventing source puppet flags for an added script root.
    const script = "v60_controlled_owner_port";
    const source = { file: "synthetic-v60", assetPath: "controlled-owner-event", objectId: "9007199254740999" };
    const op = { kind: "inventory", script, index: 0, source,
      command: { kind: "grant-gil", amount: 9 }, result: null, dependencies: [] };
    const assessment = field.assessInstructionAdmission(op);
    assert.equal(assessment.status, "ready");
    const pending = owner.fieldInventory.prepare(op.command);
    assert.equal(pending.result, null); assert.deepEqual(owner.snapshot(), initial);
    pending.commit(); assert.throws(() => pending.commit());
    assert.equal(field.stop, null); assert.equal(game.state, owner); assert.equal(game.field, field);
    const after = owner.snapshot(), expected = structuredClone(initial);
    expected.gil += 9; expected.totalGil += 9;
    assert.deepEqual(after, expected); assert.equal(game.gil, after.gil);
    assert.equal(field.eventState, game.world.field.eventState); assert.deepEqual(field.eventState.snapshot(), events);
    assert.deepEqual(game.players.map(p => p.id), initial.party.slots[initial.party.selectedSlot].filter(c => c.id !== null).map(c => c.id));
    return { lane: "controlled-public-owner-transaction-on-fresh-production-session", amount: 9,
      ownedSnapshotBefore: hash(initial), ownedSnapshotAfter: hash(after), oneSessionStateOwner: true,
      sourceStoryExecuted: false, fieldVmExecuted: false };
  });
  await stage("synthetic-typed-root-remains-blocked-without-native-context", async () => {
    const initial = game.state.snapshot(), packages = canonical({ catalog, entry, world, map });
    const field = game.field, script = "v60_controlled_missing_native_context";
    const source = { file: "synthetic-v60", assetPath: "controlled-root-without-native-context",
      objectId: "9007199254740999" };
    const op = { kind: "inventory", script, index: 0, source,
      command: { kind: "grant-gil", amount: 9 }, result: null, dependencies: [] };
    assert.equal(field.assessInstructionAdmission(op).status, "ready");
    assert.equal(field.content.scriptPuppetContexts?.[script], undefined);
    // Replace the private script dictionary; do not mutate the source map's
    // shared object or copy another script's source flags into this fixture.
    field.content.scripts = { ...field.content.scripts, [script]: [op,
      { kind: "exit", script, index: 1, source }] };
    assert.equal(field.startEvent(script), true); game.advance(0);
    assert.equal(field.stop?.kind, "unsupported");
    assert.equal(field.stop.message, "Source puppet lifecycle host or script context is unavailable");
    assert.deepEqual(field.stop.site, op); assert.deepEqual(game.state.snapshot(), initial);
    assert.equal(canonical({ catalog, entry, world, map }), packages);
    return { lane: "synthetic-typed-root-on-fresh-source-session", nativeContextProvided: false,
      providerAssessment: "ready", ownedStatePublished: false, sourceStoryExecuted: false,
      stop: structuredClone(field.stop) };
  });
  report.result = "passed";
} catch (error) {
  report.result = "failed"; report.failure = { stage: currentStage,
    message: error instanceof Error ? error.message : String(error) };
  process.exitCode = 1;
} finally {
  for (const directory of scratch) await rm(directory, { recursive: true, force: true });
  report.compiledDirectory = compiled;
  report.compiledInputs = [];
  for (const name of ["compiler/battle", "compiler/battle-source-entry", "compiler/game-catalog",
    "compiler/opening-playable", "compiler/source-new-game", "core/source-catalog", "core/game-session"])
    try { report.compiledInputs.push({ module: name, sha256: sha(await readFile(resolve(compiled, "src", name + ".js"))) }); }
    catch { /* A missing module is already reported at the failed stage. */ }
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ report: "build/reports/shared-game-catalog-check.json", result: report.result,
    stages: report.stages.length, ...(report.failure ? { failure: { stage: report.failure.stage,
      message: report.failure.message.slice(0, 360) } } : {}) }));
}
