// Actual source enemies/rewards with a plainly authored invocation driver.
// The development entry's existing players/resources/commands are untouched.
// This lane verifies shared ownership, not native handoff or story reachability.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { controlledAudioRuntime } from "./controlled-audio.mjs";
import { compileBattleContentBatch, buildBattleContentBatch } from "./build-battle-content-batch.mjs";

const root = resolve(import.meta.dirname, ".."), options = new Map(), args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
  assert.ok(["--dist", "--catalog", "--report"].includes(args[i]) && args[i + 1] && !options.has(args[i]),
    "Use --dist/--catalog/--report <path>");
  options.set(args[i], args[i + 1]);
}
const compiled = resolve(root, options.get("--dist") ?? "dist");
const module = name => import(pathToFileURL(resolve(compiled, "src/core", name + ".js")));
const [{ GameSession }, { GameFlow }, { GameBattleHandoff }, { GameCommands },
  { verifyContent, contentDigest }, { canonical }, { assessBattleHandoff }] = await Promise.all([
  "game-session", "game-flow", "game-battle-handoff", "game-commands", "content-integrity", "canonical", "battle-handoff-content",
].map(module));
const reportPath = resolve(root, options.get("--report") ?? "build/reports/battle-content-batch-check.json");
const report = { kind: "battle-content-batch-check-v1", lane: "source-battles-with-explicit-development-handoff",
  result: "running", stages: [], encounters: [],
  controlledInputs: ["Legacy development checkpoint; no new roster, ability, HP, MP or inventory grants",
    "Private encounter -> exit event driver; no source script, flag, trigger or route edited",
    "Actual available magitek commands 218/222 through GameCommands; fixed replay seed",
    "Headless available audio/output facts and private media host; no rendering/audio acceptance"],
  doesNotEstablish: ["native battle handoff", "native RNG/target parity", "story reachability", "source new-game completion",
    "browser presentation", "full-game migration"],
};
await mkdir(resolve(reportPath, ".."), { recursive: true });
const stage = (name, detail = {}) => report.stages.push({ step: report.stages.length + 1, name, ...detail });
try {
  const read = async path => verifyContent(JSON.parse(await readFile(resolve(root, path), "utf8")));
  const declaration = JSON.parse(await readFile(resolve(root, "content-batches/ordinary-battles.json"), "utf8"));
  const catalogPath = options.get("--catalog") ?? "build/content-batches/ordinary-battles/battle.json";
  const [catalog, base, field] = await Promise.all([read(catalogPath), read("build" + declaration.baseCatalogRef.url), read("build/game/narshe.json")]);
  const built = JSON.parse(await readFile(resolve(root, "build/content-batches/ordinary-battles/report.json"), "utf8"));
  assert.equal(base.contentHash, declaration.baseCatalogRef.contentHash);
  assert.equal(catalog.contentHash, built.contentHash);
  assert.equal(built.result, "compiled"); assert.equal(built.runtime.withRuntimeDependencies, 0);
  assert.deepEqual(built.partyIds, [...declaration.partyIds].sort((a, b) => a - b));
  assert.equal(canonical(catalog.gameState), canonical(base.gameState));
  const { drops: baseDrops, ...baseCommon } = base.common, { drops: batchDrops, ...batchCommon } = catalog.common;
  assert.equal(canonical(batchCommon), canonical(baseCommon));
  assert.equal(catalog.common.fieldSourceSetHash, field.sourceSetHash);
  for (const [id, encounter] of Object.entries(base.encounters))
    if (!declaration.partyIds.includes(Number(id))) assert.equal(canonical(catalog.encounters[id]), canonical(encounter));
  const sourceExport = JSON.parse(await readFile(resolve(root, "build/battle/battle.json"), "utf8"));
  assert.equal(sourceExport.sourceSetHash, declaration.battleSourceSetHash);
  assert.deepEqual(sourceExport.encounterPartyIds, built.originalRequestedPartyIds);
  Object.assign(report, { contentHash: catalog.contentHash, baseCatalogRef: declaration.baseCatalogRef,
    parentSourceSetHash: built.parentSourceSetHash, battleSourceSetHash: built.battleSourceSetHash,
    partyIds: built.partyIds, originalRequestedPartyIds: built.originalRequestedPartyIds,
    addedDropMonsterIds: built.addedDropMonsterIds, addedDropContentIds: built.addedDropContentIds });
  stage("source-selection-closed-with-unmodified-base-owned-and-capability-content");

  const driver = structuredClone(field), source = { file: "controlled-ordinary-battles",
    assetPath: "Fixtures/OrdinaryBattles/invocation.json" };
  for (const partyId of built.partyIds) {
    const script = "controlled_ordinary_battle_" + partyId, after = script + "_after";
    assert.equal(driver.scripts[script], undefined); assert.equal(driver.scripts[after], undefined);
    driver.scripts[script] = [{ kind: "encounter", party: partyId, continuation: after, script, index: 0, source }];
    driver.scripts[after] = [{ kind: "exit", script: after, index: 0, source }];
    for (const name of [script, after]) {
      (driver.scriptLocals ??= {})[name] = null;
      (driver.scriptTransitionMetadata ??= {})[name] = { customAnimations: "none" };
      (driver.scriptSystemFlags ??= {})[name] = { keepBadStatusVisual: false };
    }
  }
  const { contentHash: oldFieldHash, ...driverPayload } = driver;
  driver.contentHash = await contentDigest(driverPayload); await verifyContent(driver);
  report.sourceFieldHash = field.contentHash; report.controlledDriverHash = driver.contentHash;
  const host = { visible: true, mediaReady: true, overlayOpen: false };
  const pristine = new GameSession(field, base, 20261010, controlledAudioRuntime()).state.snapshot();
  for (const partyId of built.partyIds) {
    const session = new GameSession(structuredClone(driver), catalog, 20261010,
      { ...controlledAudioRuntime(), battleHandoff: "prepared" });
    const initial = session.state.snapshot();
    // catalogHash is a save binding, not a new persistent initial-state grant.
    assert.equal(canonical({ ...initial, catalogHash: pristine.catalogHash }), canonical(pristine));
    const flow = new GameFlow(session), commands = new GameCommands(flow, session);
    let preparationFailure = null, prepares = 0;
    const handoff = new GameBattleHandoff(flow, {
      prepareStart: async view => {
        const admission = assessBattleHandoff(view.content.handoff, "framework");
        assert.equal(admission.status, "ready");
        assert.equal(assessBattleHandoff(view.content.handoff, "source").status, "blocked");
        assert.deepEqual(admission.policy, declaration.handoff);
        assert.equal(view.content.encounterId, partyId);
        const urls = [...view.mediaUrls]; assert.ok(urls.length > 0);
        // The same lease supplies the actual required media. Existence here
        // is headless preparation, not a rendered/native appearance oracle.
        for (const url of urls) {
          assert.match(url, /^\/[A-Za-z0-9/_-]+\.png$/);
          const bytes = await readFile(resolve(root, "build", url.slice(1)));
          assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
        }
        if (preparationFailure) throw preparationFailure;
        prepares++; return { encounterId: partyId, mediaUrls: urls };
      },
      prepareReturn: async view => {
        assert.equal(view.outcome, "victory");
        if (preparationFailure) throw preparationFailure;
        prepares++; return { encounterId: partyId };
      }, discard: () => {},
    });
    flow.start(); flow.advance(0, host);
    assert.equal(session.field.startEvent("controlled_ordinary_battle_" + partyId), true);
    flow.advance(10, host); assert.equal(session.field.stop?.kind, "encounter");
    assert.equal(session.battle, null); assert.deepEqual(session.state.snapshot(), initial);
    const request = session.field.stop;
    if (partyId === built.partyIds[0]) {
      preparationFailure = new Error("Controlled missing battle media");
      const failed = await handoff.start(); assert.equal(failed.status, "failed");
      assert.equal(session.field.stop, request); assert.equal(session.state.inBattle, false);
      assert.deepEqual(session.state.snapshot(), initial); assert.equal(session.battle, null);
      preparationFailure = null;
      stage("failed-source-battle-preparation-keeps-exact-request-and-owned-seed");
    }
    assert.equal((await handoff.start()).status, "committed"); flow.advance(0, host);
    const battle = session.battle, encounter = catalog.encounters[partyId];
    assert.equal(flow.phase, "battle"); assert.equal(battle.content.encounterId, partyId);
    assert.deepEqual(battle.enemies.map(enemy => ({ id: enemy.id, sourceId: enemy.sourceId })),
      encounter.enemies.map(enemy => ({ id: enemy.id, sourceId: enemy.sourceId })));
    assert.deepEqual(session.state.snapshot(), initial);
    let accepted = 0, ticks = 0;
    for (; ticks < 12000 && battle.phase === "active"; ticks++) {
      for (const actor of battle.ready) {
        const menu = battle.commandMenu(actor.id);
        const ally = battle.players.find(player => player.hp > 0 && player.hp < player.maxHp * 0.6);
        const abilityId = ally ? 222 : 218;
        const command = menu.find(command => command.available && command.abilityIds.includes(abilityId));
        assert.ok(command, "Actual owner has no required admitted command " + abilityId);
        const target = ally ?? battle.targets(actor.id, abilityId)[0];
        if (target && commands.command(battle, actor.id, abilityId, target.id, command.id)) accepted++;
      }
      flow.advance(10, host);
    }
    assert.equal(battle.phase, "victory", "Source party " + partyId + " did not reach victory through owned commands");
    assert.ok(accepted > 0); assert.equal(flow.phase, "victory");
    assert.deepEqual(session.state.snapshot(), initial, "Victory display cannot publish rewards/resources");
    const receipt = structuredClone(battle.reward);
    const expectedGil = encounter.enemies.reduce((sum, enemy) => sum + enemy.gil, 0);
    assert.equal(receipt.gil, expectedGil); assert.equal(receipt.magicPoints, encounter.rewardPolicy.magicPoints);
    assert.equal(receipt.each, Math.floor(encounter.enemies.reduce((sum, enemy) => sum + enemy.exp, 0) /
      battle.players.filter(player => player.hp > 0).length));
    assert.ok(receipt.dropPlan, "Actual source drop planner must produce the victory receipt");
    assert.equal(commands.canReturnBattle(battle), true);
    if (partyId === built.partyIds[0]) {
      preparationFailure = new Error("Controlled failed field media preparation");
      const failed = await handoff.return(); assert.equal(failed.status, "failed");
      assert.equal(session.battle, battle); assert.equal(session.field.stop, request);
      assert.deepEqual(session.state.snapshot(), initial); assert.deepEqual(battle.reward, receipt);
      preparationFailure = null;
      stage("failed-victory-return-preserves-terminal-battle-and-once-only-receipt");
    }
    assert.equal((await handoff.return()).status, "committed");
    assert.equal(session.battle, null); assert.equal(session.state.inBattle, false);
    for (let n = 0; n < 50 && !session.checkpointReady; n++) flow.advance(10, host);
    assert.equal(session.checkpointReady, true); assert.equal(flow.phase, "exploration");
    const returned = session.state.snapshot();
    assert.equal(returned.gil, initial.gil + expectedGil);
    assert.deepEqual(session.completedEncounters, [partyId]);
    assert.equal(returned.completedBattles.length, 1); assert.equal(returned.completedBattles[0].encounterId, partyId);
    assert.deepEqual(returned.party, initial.party);
    for (const player of returned.roster) {
      const previous = initial.roster.find(before => before.id === player.id);
      assert.deepEqual(player.equipment, previous.equipment); assert.equal(player.enabled, previous.enabled);
      assert.equal(player.exp, previous.exp + (player.hp > 0 ? receipt.each : 0));
      assert.equal(player.magicLearningValue, previous.magicLearningValue + (player.hp > 0 ? receipt.magicPoints : 0));
    }
    for (const id of new Set([...initial.items.map(item => item.id), ...returned.items.map(item => item.id)])) {
      const dropCount = receipt.dropPlan.grants.filter(grant => grant.kind === "grant-item" && grant.id === id)
        .reduce((sum, grant) => sum + grant.count, 0);
      assert.equal(returned.items.find(item => item.id === id)?.count ?? 0,
        (initial.items.find(item => item.id === id)?.count ?? 0) + dropCount);
    }
    assert.equal(commands.canReturnBattle(battle), false);
    await assert.rejects(() => handoff.return(), /pending encounter or terminal battle/);
    assert.deepEqual(session.state.snapshot(), returned);
    // Stable persistence reconstructs the same owner/resources without replay.
    const checkpoint = session.checkpoint(), restored = GameSession.restore(checkpoint, driver, catalog,
      undefined, { ...controlledAudioRuntime(), battleHandoff: "prepared" });
    assert.deepEqual(restored.state.snapshot(), returned);
    report.encounters.push({ partyId, result: "victory-returned", sourceIdSlots: encounter.participants.initial,
      acceptedCommands: accepted, ticks, gil: receipt.gil, eachExp: receipt.each, magicPoints: receipt.magicPoints,
      dropGrants: receipt.dropPlan.grants, prepares, checkpointRestored: true });
    stage("source-battle-command-victory-return-and-save-binding", { partyId });
  }
  const blocked = await compileBattleContentBatch(root, { ...declaration, partyIds: [2147483647] });
  assert.equal(blocked.catalog, null); assert.equal(blocked.report.result, "blocked");
  assert.ok(blocked.report.diagnostics.some(diagnostic => diagnostic.kind === "blocked"));
  // A rejected selection never republishes an existing completed batch.
  const temporary = await mkdtemp(resolve(root, "build/content-batches/.battle-check-"));
  try {
    const badPath = resolve(temporary, "blocked.json");
    await writeFile(badPath, JSON.stringify({ ...declaration, partyIds: [2147483647] }));
    await assert.rejects(() => buildBattleContentBatch({ root, declarationPath: badPath,
      outDir: "build/content-batches/ordinary-battles" }), error => error.report?.result === "blocked");
    assert.equal((await read(catalogPath)).contentHash, catalog.contentHash);
  } finally { await rm(temporary, { recursive: true, force: true }); }
  await assert.rejects(() => compileBattleContentBatch(root, { ...declaration,
    baseCatalogRef: { ...declaration.baseCatalogRef, contentHash: "0".repeat(64) } }), /Content identity mismatch/);
  stage("missing-source-selection-and-wrong-base-pin-never-publish-fallback-content");
  report.result = "passed";
} catch (error) {
  report.result = "failed"; report.error = error.stack ?? String(error);
  throw error;
} finally { await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n"); }
console.log(JSON.stringify({ result: report.result, sourceBattles: report.encounters.length,
  stages: report.stages.length, nativeHandoffVerified: false, sourceGameplayVerified: false,
  report: reportPath }));
