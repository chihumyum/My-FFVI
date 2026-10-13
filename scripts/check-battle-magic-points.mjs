// Source reward policy with an explicitly controlled encounter substitution.
// The source candidates retain independent capability gaps; this runs the actual shared session,
// combat actions, owned settlement and save/restore without editing exports.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { controlledAudioRuntime } from "./controlled-audio.mjs";

const root = resolve(import.meta.dirname, ".."), args = process.argv.slice(2), options = new Map();
for (let i = 0; i < args.length; i += 2) {
  assert.ok(["--compiled-dir", "--fixture-dir"].includes(args[i]) && args[i + 1] &&
    !args[i + 1].startsWith("--") && !options.has(args[i]),
    "Use [--compiled-dir <directory>] [--fixture-dir <ignored-output-directory>]");
  options.set(args[i], args[i + 1]);
}
const compiled = resolve(root, options.get("--compiled-dir") ?? "dist");
const load = name => import(pathToFileURL(resolve(compiled, "src", name + ".js")).href);
const output = resolve(root, "build/reports/battle-magic-points-check.json");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const stage = (name, details = {}) => report.stages.push({ name, result: "passed", ...details });
const report = {
  kind: "source-policy-controlled-battle-magic-points-v1", result: "running", stages: [],
  evidence: {
    lane: "verified-source-reward-policy-and-existing-source-combat-with-controlled-field-entry",
    rewardSourcePartyId: 4, executedEnemyPartyId: 3002,
    controlledInputs: [
      "Source party 4 reward policy is applied only to a private copy of existing source party 3002",
      "Source party 3002 combatants, AI, abilities, equipment, conditions, EXP/Gil and drop rules remain unchanged",
      "Existing development-checkpoint field and owned roster, not fresh source new-game story execution",
      "Every two eligible free-walking steps starts party 3002; normal source fixed formation remains",
      "Explicit framework-battle-escape-v1 policy; source escape probability and timing are not reproduced",
      "No starting money, items, equipment, skills or character state is granted by this checker",
      "Headless audio acknowledgements and in-memory CheckpointStorage",
    ],
    limitations: [
      "The positive-reward source parties' independent blockers remain in candidateDiagnostics",
      "Source sc_b_0239 and battle flag 14 have only the existing source-bound development omission; they are not executed",
      "No complete esper, equipment or background learning system is certified",
      "No original runtime execution, main-story reachability or browser rendering is certified",
    ],
    sourceRewardValuesVerified: false, originalGameExecuted: false, browserVerified: false,
    fullSourceEncounterExecuted: false, fullGameMigration: false,
  },
};
await mkdir(resolve(output, ".."), { recursive: true });

try {
  const [{ compileOpeningBattle, battleTableIndex }, { compileOpeningPlayable },
    { compileBattleEncounterSources }, { compileBattleEncounterRuntime }, { compileBattleRewardPolicy },
    { compileParameterLimits }, { compilePhysicalLimits }, { readSnapshot, snapshotFile },
    { verifyContent, contentDigest }, { GameSession }, { GameFlow }, { CheckpointStorage }] = await Promise.all([
    load("compiler/battle"), load("compiler/opening-playable"), load("compiler/battle-encounters"),
    load("compiler/battle-encounter-runtime"), load("compiler/battle-result"), load("compiler/parameters"),
    load("compiler/physical-parameters"), load("compiler/integrity"), load("core/content-integrity"),
    load("core/game-session"), load("core/game-flow"), load("core/saved-game"),
  ]);
  const paths = ["build/import/tables.json", "build/battle/battle.json", "build/game/narshe.json"];
  const inputBytes = await Promise.all(paths.map(path => readFile(resolve(root, path))));
  const imported = await readSnapshot(resolve(root, "build/import"));
  const exported = await readSnapshot(resolve(root, "build/battle"));
  const fieldExport = await readSnapshot(resolve(root, "build/field"));
  assert.deepEqual(snapshotFile(imported, "tables.json"), inputBytes[0]);
  assert.deepEqual(snapshotFile(exported, "battle.json"), inputBytes[1]);
  const tables = JSON.parse(inputBytes[0]), media = JSON.parse(inputBytes[1]);
  const sourceField = await verifyContent(JSON.parse(inputBytes[2]));
  // These functions return in-memory products. They do not publish or rewrite
  // build/game, the battle selection or any of the verified source snapshots.
  const source = await compileOpeningBattle(root), sourceCatalog = await compileOpeningPlayable(root, source);
  assert.equal(source.parentSourceSetHash, sourceField.parentSourceSetHash);
  assert.equal(sourceCatalog.common.fieldSourceSetHash, sourceField.sourceSetHash);
  const reader = battleTableIndex(tables, media.tableSources);
  const names = JSON.parse(snapshotFile(fieldExport, "field.json")).messages.system_zhc;
  const legacy = source.encounters.find(encounter => encounter.metadata.scriptId === 8010 &&
    encounter.script?.source.assetPath.endsWith("/sc_b_0239.json") && encounter.metadata.battleFlagGroupId === 11);
  assert.ok(legacy);
  assert.equal(reader.row("script.csv", 8010).values.script_name, "sc_b_0239");
  const flags = reader.group("battle_flag_group.csv", "group_id", 11);
  assert.deepEqual(flags.map(row => [row.values.id, row.values.battle_flag_id]), [["16", "14"]]);
  assert.deepEqual(flags, legacy.metadata.battleFlags);
  const json = name => {
    const matches = Object.values(media.assets).filter(asset => asset.source.assetPath.endsWith("/" + name + ".json"));
    assert.equal(matches.length, 1, "Unresolved source JSON: " + name);
    const asset = matches[0], file = media.sources.find(s => s.file === asset.source.file || s.file.endsWith("/" + asset.source.file));
    assert.ok(file, "Unbound source JSON: " + name);
    return { data: asset.data, source: { ...asset.source, sha256: file.sha256,
      sourceSetHash: media.parentSourceSetHash, battleSourceSetHash: media.sourceSetHash } };
  };
  const spritePath = suffix => {
    const matches = Object.keys(media.sprites).filter(key => key.toLowerCase().endsWith(suffix.toLowerCase()));
    assert.equal(matches.length, 1, "Unresolved source sprite: " + suffix); return matches[0];
  };
  const selected = compileBattleEncounterSources(reader, { partyIds: [4, 274], json, spritePath });
  for (const encounter of selected.encounters) {
    assert.equal(encounter.metadata.scriptId, 8010);
    assert.deepEqual(encounter.script.source, legacy.script.source);
    assert.deepEqual(encounter.metadata.battleFlags, legacy.metadata.battleFlags);
  }
  const zero = { hp: 0, mp: 0, magic: 0, vitality: 0, attack: 0, defense: 0,
    magicDefense: 0, agility: 0, weight: 0, evasion: 0, magicEvasion: 0 };
  const runtime = compileBattleEncounterRuntime(reader, {
    requestedPartyIds: selected.requestedPartyIds, encounters: selected.encounters, sourceDiagnostics: selected.diagnostics,
    abilities: sourceCatalog.common.abilities, conditions: sourceCatalog.common.conditions, sprites: media.sprites,
    name(key) { assert.equal(typeof names[key], "string", "Missing source monster name"); return names[key]; },
    parameters: { temporary: zero, limits: compileParameterLimits(reader).values },
    physical: { temporary: { attack: 0, strength: 0, accuracy: 0, criticalRate: 0 }, limits: compilePhysicalLimits(reader).values },
    development: {
      // Bind to the verified candidate objects after full source comparison.
      // Runtime's exact source contract must not be weakened to an ID-only list.
      scripts: selected.encounters.map(encounter => ({ id: 8010, source: encounter.script.source,
        reason: "Existing verified sc_b_0239 development omission; battle event script is not executed" })),
      flagGroups: [{ id: 11, rows: flags, reason: "Existing verified group 11 / NoARBattle 14 development omission" }],
      formations: { kind: "framework-battle-formations-v1", id: "magic-point-candidate-normal", weights: [1, 0, 0, 0, 0, 0] },
      escape: { kind: "framework-battle-escape-v1", id: "magic-point-candidate-escape" },
    },
  });
  assert.equal(runtime.encounters[4], undefined);
  assert.ok(runtime.encounters[274]);
  assert.ok(runtime.diagnostics.some(d => d.partyId === 4 && d.code === "asset-reference"));
  const { compileConditionResistances } = await load("compiler/condition-resistances");
  const sourceResistances = compileConditionResistances(reader, 749, sourceCatalog.common.conditions.rules.definitions);
  for (const enemy of runtime.encounters[274].enemies) {
    assert.equal(enemy.sourceId, 249);
    assert.deepEqual(enemy.conditionResistances, sourceResistances.resistances);
  }
  assert.equal(runtime.diagnostics.some(d => d.partyId === 274 &&
    ["enemy-provider", "enemy-condition-resistance"].includes(d.code)), false);
  assert.ok(runtime.diagnostics.some(d => d.partyId === 274 && d.kind === "runtime-dependency" &&
    d.code === "ability-plan" && d.dependency?.id === 696));
  assert.ok(runtime.diagnostics.some(d => d.partyId === 274 && d.code === "battle-script" && d.kind === "development-omission"));
  assert.ok(runtime.diagnostics.some(d => d.partyId === 274 && d.code === "battle-flags" && d.kind === "development-omission"));
  assert.equal(runtime.diagnostics.some(d => ["battle-script", "battle-flags"].includes(d.code) && d.kind === "blocked"), false);
  report.candidateDiagnostics = runtime.diagnostics;
  stage("source-candidates-bind-resistances-and-retain-media-and-latent-ability-blockers", {
    requested: selected.requestedPartyIds, report: runtime.report,
    resistanceGroup: 749, resistanceRows: sourceResistances.sources.map(row => row.source),
  });

  const row = reader.row("monster_party.csv", 4);
  assert.equal(row.source.rowId, "4"); assert.equal(Number(row.values.get_value) > 0, true);
  assert.equal(Number(row.values.script_name), 8010); assert.equal(Number(row.values.battle_flag_group_id), 11);
  const policy = compileBattleRewardPolicy({ getAp: Number(row.values.get_ap), getValue: Number(row.values.get_value),
    battleFlags: flags.map(flag => Number(flag.values.battle_flag_id)) });
  assert.deepEqual(policy, { kind: "battle-reward-policy-v1", ap: 0, magicPoints: 1 });
  report.sourceReward = { party: row, policy, script: legacy.script.source, flags };
  report.evidence.sourceRewardValuesVerified = true;
  stage("positive-source-party-reward-policy-compiled-without-row-mutation", { partyId: 4, policy });

  const field = structuredClone(sourceField), catalog = structuredClone(sourceCatalog), partyId = 3002;
  assert.ok(catalog.encounters[partyId]);
  assert.equal(catalog.common.qualificationContext.mode, "source");
  assert.ok(catalog.gameState.characterInitializations);
  const encounter = catalog.encounters[partyId], originalEncounter = structuredClone(encounter);
  encounter.rewardPolicy = structuredClone(policy);
  encounter.escapePolicy = { kind: "framework-battle-escape-v1", id: "source-reward-controlled-escape" };
  field.walkEncounters = { kind: "framework-walk-encounters-v1", id: "source-reward-controlled-walking",
    minSteps: 2, maxSteps: 2, transportationIds: [field.entry.transportationId], parties: [{ partyId, weight: 1 }] };
  field.limitations.push("Controlled MagicPoint probe: party 4 reward policy on party 3002; two-step walking and development escape. No story reachability or complete esper learning is asserted.");
  const restoredCatalog = structuredClone(catalog);
  restoredCatalog.encounters[partyId] = originalEncounter;
  assert.deepEqual(restoredCatalog, sourceCatalog, "Only the named private reward/escape policies may change battle content");
  for (const content of [field, catalog]) {
    const { contentHash: _, ...payload } = content;
    content.contentHash = await contentDigest(payload); await verifyContent(content);
  }
  report.hashes = {
    sourceSetHash: source.parentSourceSetHash, battleSourceSetHash: source.sourceSetHash,
    sourceCompiledHash: source.contentHash, sourceCatalogHash: sourceCatalog.contentHash,
    sourceFieldHash: sourceField.contentHash, controlledFieldHash: field.contentHash, controlledCatalogHash: catalog.contentHash,
    files: Object.fromEntries(paths.map((path, index) => [path, sha(inputBytes[index])])),
  };
  stage("private-source-combat-binding-preserves-enemies-ai-media-and-owned-initialization", {
    executedPartyId: partyId, rewardPartyId: 4, rewardPolicy: policy, inventoryGrants: [],
  });
  if (options.has("--fixture-dir")) {
    const directory = resolve(root, options.get("--fixture-dir"));
    assert.ok(directory.startsWith(resolve(root, "build") + "/"), "Browser fixture must remain inside ignored build/");
    await mkdir(directory, { recursive: true });
    await Promise.all([
      writeFile(resolve(directory, "field.json"), JSON.stringify(field) + "\n"),
      writeFile(resolve(directory, "catalog.json"), JSON.stringify(catalog) + "\n"),
      writeFile(resolve(directory, "manifest.json"), JSON.stringify({ kind: "controlled-magic-points-browser-fixture-v1",
        field: "field.json", catalog: "catalog.json", seed: 314, hashes: report.hashes,
        originalEncounterRewardPolicy: originalEncounter.rewardPolicy, actualEncounterId: partyId,
        rewardSourcePartyId: 4, sourceReward: report.sourceReward, inventoryGrants: [],
        evidence: report.evidence, candidateDiagnostics: report.candidateDiagnostics }, null, 2) + "\n"),
    ]);
    report.fixtureDirectory = directory;
  }

  const host = { visible: true, mediaReady: true, overlayOpen: false }, audio = controlledAudioRuntime();
  let session = new GameSession(field, catalog, 314, audio), flow = new GameFlow(session);
  flow.start(); flow.advance(0, host);
  const fieldStart = [session.field.player.x, session.field.player.y];
  const magicValues = snapshot => snapshot.roster.map(member => ({ id: member.id, value: member.magicLearningValue }));
  const enter = () => {
    for (const direction of ["up", "down"]) {
      assert.equal(flow.move(direction), true); flow.advance(240, host);
    }
    assert.equal(flow.phase, "battle"); assert.ok(session.battle);
    assert.equal(session.battle.content.encounterId, partyId);
    assert.deepEqual(session.battle.content.rewardPolicy, policy);
    assert.deepEqual(session.battle.content.enemies, originalEncounter.enemies);
    assert.deepEqual([session.field.player.x, session.field.player.y], fieldStart);
  };
  const victory = label => {
    enter(); const battle = session.battle, owner = session.state, fieldOwner = session.field;
    const before = owner.snapshot(), actions = [], seen = new Set();
    for (let tick = 0; tick < 16000 && battle.phase === "active"; tick++) {
      for (const actor of battle.ready) {
        const ally = battle.players.find(player => player.hp > 0 && player.hp < player.maxHp * 0.6);
        const target = ally ?? battle.targets(actor.id, 218)[0];
        if (target) battle.command(actor.id, ally ? 222 : 218, target.id);
      }
      flow.advance(10, host);
      const action = battle.action;
      if (action?.resolved && !seen.has(action)) {
        seen.add(action); actions.push({ actor: action.actor, source: structuredClone(action.source), results: structuredClone(action.results) });
      }
    }
    assert.equal(flow.phase, "victory");
    assert.ok(actions.some(action => action.source.kind === "ability" && action.source.id === 218 &&
      action.results.some(result => result.effects.some(effect => effect.resource === "hp" &&
        !effect.recovery && !effect.missed && effect.amount > 0))), "The encounter must be defeated by actual source actions");
    assert.ok(battle.players.every(player => player.hp > 0), "This path demonstrates all living party members");
    assert.equal(battle.reward.magicPoints, policy.magicPoints);
    assert.deepEqual(owner.snapshot(), before, "Victory presentation does not publish rewards");
    const result = battle.previewVictory(), expected = new Map(before.roster.map(member => [member.id, member.magicLearningValue]));
    for (const player of result.players) {
      const value = Math.min(128, expected.get(player.id) + (player.hp > 0 ? policy.magicPoints : 0));
      assert.equal(player.magicLearningValue, value); expected.set(player.id, value);
    }
    assert.equal(flow.continueVictory(), true); assert.equal(flow.continueVictory(), false);
    assert.equal(flow.phase, "exploration"); assert.equal(session.state, owner); assert.equal(session.field, fieldOwner);
    const after = owner.snapshot();
    for (const member of after.roster) assert.equal(member.magicLearningValue, expected.get(member.id));
    assert.equal(session.checkpointReady, true);
    stage(label, { magicPoints: battle.reward.magicPoints, before: magicValues(before), after: magicValues(after),
      recipients: battle.reward.recipients, sourceActions: actions, receipts: after.completedBattles });
  };
  victory("real-actions-win-and-every-surviving-owner-receives-full-source-magicpoint");
  const memory = new Map(), storage = new CheckpointStorage({ getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value) }, "framework");
  const saveRestore = async (label, sequence) => {
    const saved = session.checkpoint(); await storage.save(saved, sequence);
    const loaded = await storage.load(); assert.ok(loaded);
    session = GameSession.restore(loaded.checkpoint, field, catalog, undefined, audio);
    assert.deepEqual(session.checkpoint(), saved);
    flow = new GameFlow(session); flow.start(); flow.advance(0, host);
    stage(label, { saveHash: loaded.contentHash, values: magicValues(session.state.snapshot()),
      receipts: session.state.snapshot().completedBattles });
  };
  await saveRestore("actual-checkpoint-storage-and-restore-retain-magic-learning-values", 1);
  victory("restored-session-wins-again-and-adds-exactly-one-more-source-reward");
  const beforeEscape = session.state.snapshot();
  enter(); const escaping = session.battle;
  assert.equal(flow.canEscape, true); assert.equal(flow.requestEscape(), true); assert.equal(flow.requestEscape(), false);
  for (let tick = 0; tick < 1000 && flow.phase === "battle"; tick++) flow.advance(10, host);
  assert.equal(flow.phase, "escaped"); assert.equal(escaping.reward, null);
  assert.deepEqual(magicValues(session.state.snapshot()), magicValues(beforeEscape));
  assert.equal(flow.continueEscape(), true); assert.equal(flow.continueEscape(), false);
  const afterEscape = session.state.snapshot();
  assert.deepEqual(magicValues(afterEscape), magicValues(beforeEscape));
  assert.equal(afterEscape.gil, beforeEscape.gil);
  assert.deepEqual(afterEscape.roster.map(member => [member.id, member.exp, member.abilities]),
    beforeEscape.roster.map(member => [member.id, member.exp, member.abilities]));
  assert.deepEqual(afterEscape.completedBattles.map(receipt => receipt.outcome), ["victory", "victory", "escaped"]);
  stage("escape-from-positive-reward-encounter-does-not-award-magicpoint-or-learning", {
    before: magicValues(beforeEscape), after: magicValues(afterEscape), receipts: afterEscape.completedBattles,
  });
  await saveRestore("escape-result-restores-without-replaying-a-positive-reward", 2);
  for (const [index, path] of paths.entries())
    assert.deepEqual(await readFile(resolve(root, path)), inputBytes[index], "Verified source/published input must remain unchanged");
  await Promise.all([verifyContent(field), verifyContent(catalog)]);
  stage("source-rows-and-published-inputs-remain-unchanged");
  report.result = "passed";
} catch (error) {
  report.result = "failed"; report.error = String(error.stack ?? error); throw error;
} finally {
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, stages: report.stages.length, report: output }));
}
