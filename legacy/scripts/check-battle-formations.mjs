// Verified local content with explicitly synthetic eligibility and authored
// selection rules. This is a shared-system probe, not native party 3 coverage.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { controlledAudioRuntime } from "./controlled-audio.mjs";

const root = resolve(import.meta.dirname, ".."), args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 2 && args[0] === "--compiled-dir" && args[1],
  "Use --compiled-dir <directory>");
const compiled = resolve(root, args[1] ?? "dist");
const load = (name) => import(pathToFileURL(resolve(compiled, "src/core", name + ".js")).href);
const reportPath = resolve(root, "build/reports/battle-formations-check.json");
const demoPath = resolve(root, "build/framework/formation-demo");
const report = {
  kind: "battle-formations-integration-v1", result: "running", stages: [], branches: [],
  evidence: {
    lane: "verified-local-development-content-with-controlled-formation-inputs",
    sourcePartyId: 3,
    controlledInputs: {
      patterns: [1, 0, 1, 0, 0, 0], weights: [1, 0, 1, 0, 0, 0],
      walking: "Every two eligible player steps selects party 3",
    },
    limitations: [
      "The six eligibility bits are synthetic test input, not original party 3 eligibility.",
      "Formation weights, domain-separated RNG and walking thresholds are explicit Web development rules.",
      "The existing development entry and its omissions remain; this does not exercise fresh source initialization.",
      "Audio readiness and presentation acknowledgement are controlled headless hosts; storage is in memory.",
    ],
    sourceEligibilityVerified: false, sourceRandomSelectionVerified: false,
    semanticsVerified: false, browserVerified: false, originalGameExecuted: false, fullGameMigration: false,
  },
};
await mkdir(resolve(reportPath, ".."), { recursive: true });
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
try {
  const [{ GameSession }, { GameFlow }, { CheckpointStorage }, { verifyContent, contentDigest },
    { createBattleFormationPlan, selectBattleFormation, validateBattleFormationChoice }] = await Promise.all([
    load("game-session"), load("game-flow"), load("saved-game"), load("content-integrity"), load("battle-formations"),
  ]);
  const sourcePaths = ["build/game/narshe.json", "build/game/opening-playable.json"];
  const sourceBytes = await Promise.all(sourcePaths.map((path) => readFile(resolve(root, path))));
  const [sourceField, sourceBattle] = await Promise.all(sourceBytes.map((bytes) => verifyContent(JSON.parse(bytes.toString()))));
  const field = structuredClone(sourceField), battle = structuredClone(sourceBattle);
  const encounter = battle.encounters[3];
  assert.ok(encounter && encounter.encounterId === 3, "Verified catalog must contain party 3");
  const plan = createBattleFormationPlan([1, 0, 1, 0, 0, 0], {
    kind: "framework-battle-formations-v1", id: "controlled-formation-demo", weights: [1, 0, 1, 0, 0, 0],
  });
  encounter.formation = null;
  encounter.formationPlan = plan;
  field.walkEncounters = {
    kind: "framework-walk-encounters-v1", id: "controlled-formation-walk", minSteps: 2, maxSteps: 2,
    transportationIds: [sourceField.entry.transportationId], parties: [{ partyId: 3, weight: 1 }],
  };
  field.limitations.push("Controlled formation demo: synthetic party 3 eligibility [1,0,1,0,0,0], equal development weights and a two-step walking threshold; not the source random encounter or formation rules.");
  // Assert the fixture did not weaken enemy AI, effects, rewards, media or owned
  // initialization. Only the entry's selection fields may differ in the catalog.
  const originalRest = structuredClone(sourceBattle), fixtureRest = structuredClone(battle);
  for (const catalog of [originalRest, fixtureRest]) {
    delete catalog.encounters[3].formation;
    delete catalog.encounters[3].formationPlan;
  }
  assert.deepEqual(fixtureRest, originalRest);
  for (const content of [field, battle]) {
    const { contentHash: _, ...payload } = content;
    content.contentHash = await contentDigest(payload);
    await verifyContent(content);
  }
  report.hashes = {
    sourceField: sourceField.contentHash, sourceBattle: sourceBattle.contentHash,
    controlledField: field.contentHash, controlledBattle: battle.contentHash,
    sourceFiles: Object.fromEntries(sourcePaths.map((path, index) => [path, hash(sourceBytes[index])])),
  };
  report.sourceLimitations = { field: sourceField.limitations, battle: sourceBattle.common.limitations };
  report.stages.push({ name: "verified-content-and-detached-controlled-selection", patterns: plan.patterns,
    enemyIds: encounter.enemies.map((enemy) => enemy.id), catalogDependenciesUnchanged: true });
  await mkdir(demoPath, { recursive: true });
  await Promise.all([
    writeFile(resolve(demoPath, "field.json"), JSON.stringify(field) + "\n"),
    writeFile(resolve(demoPath, "battle.json"), JSON.stringify(battle) + "\n"),
  ]);
  report.demo = { field: "build/framework/formation-demo/field.json", battle: "build/framework/formation-demo/battle.json" };

  const host = { visible: true, mediaReady: true, overlayOpen: false };
  const seeds = [0, 1];
  assert.deepEqual(new Set(seeds.map((seed) => selectBattleFormation(plan, seed).formation)), new Set(["normal", "opposed"]));
  const growth = (state) => state.roster.map((member) => ({ id: member.id, level: member.level, exp: member.exp }));
  const move = (flow, direction) => {
    assert.equal(flow.move(direction), true, `Move ${direction} must be accepted`);
    flow.advance(240, host);
  };
  function win(flow, seed, serial) {
    const session = flow.session, fieldOwner = session.field, playerOwner = fieldOwner.player;
    const ownedOwner = session.state, before = ownedOwner.snapshot(), flags = fieldOwner.eventState.snapshot();
    const b = session.battle;
    assert.equal(flow.phase, "battle"); assert.ok(b);
    assert.equal(fieldOwner.stop.returnTo.kind, "field-idle");
    assert.equal(b.content.encounterId, 3);
    const battleSeed = (seed + Math.imul(serial, 0x9e3779b1)) >>> 0;
    assert.deepEqual(b.content.formationChoice, selectBattleFormation(plan, battleSeed));
    validateBattleFormationChoice(b.content.formationChoice, b.content.formation, battleSeed);
    assert.deepEqual(b.content.enemies, sourceBattle.encounters[3].enemies);
    assert.deepEqual(b.content.abilities, sourceBattle.common.abilities);
    assert.deepEqual(b.content.sprites, sourceBattle.common.sprites);
    const submitted = [], resolved = [], seen = new Set();
    let healingQueued = false, healed = false, ticks = 0;
    // Let a real enemy action injure a player, then exercise 222 before winning
    // with 218. No HP/MP/ATB or rewards are injected into the battle owners.
    for (; ticks < 12000 && flow.phase === "battle"; ticks++) {
      if (!healingQueued) {
        const injured = b.players.find((player) => player.hp > 0 && player.hp < player.maxHp);
        const actor = b.ready[0];
        if (injured && actor) {
          assert.equal(b.command(actor.id, 222, injured.id), true);
          submitted.push({ abilityId: 222, actor: actor.id, target: injured.id });
          healingQueued = true;
        }
      } else if (healed) {
        for (const actor of b.ready) {
          const injured = b.players.find((player) => player.hp > 0 && player.hp < player.maxHp * 0.6);
          const target = injured ?? b.targets(actor.id, 218)[0];
          if (target) {
            const abilityId = injured ? 222 : 218;
            assert.equal(b.command(actor.id, abilityId, target.id), true);
            submitted.push({ abilityId, actor: actor.id, target: target.id });
          }
        }
      }
      flow.advance(10, host);
      const action = b.action;
      if (action?.resolved && !seen.has(action)) {
        seen.add(action);
        if (action.source.kind === "ability" && [218, 222].includes(action.source.id)) {
          resolved.push({ abilityId: action.source.id, actor: action.actor, results: structuredClone(action.results) });
          if (action.source.id === 222) healed = true;
        }
      }
    }
    assert.equal(flow.phase, "victory", JSON.stringify({ phase: flow.phase, error: session.field.stop, ticks }));
    assert.ok(resolved.some((action) => action.abilityId === 218), "Source attack must execute");
    assert.ok(resolved.some((action) => action.abilityId === 222 && action.results.some((result) =>
      result.effects.some((effect) => effect.resource === "hp" && effect.recovery && effect.amount > 0))),
    "Source recovery must actually restore HP");
    assert.deepEqual(ownedOwner.snapshot(), before, "Battle results must stay private before victory publication");
    const reward = structuredClone(b.reward);
    assert.ok(reward && reward.gil > 0 && reward.exp > 0);
    assert.equal(flow.continueVictory(), true);
    assert.equal(flow.continueVictory(), false, "Victory cannot apply twice");
    assert.equal(flow.phase, "exploration");
    assert.equal(session.field, fieldOwner); assert.equal(session.field.player, playerOwner);
    assert.equal(session.state, ownedOwner);
    assert.equal(session.gil, before.gil + reward.gil);
    assert.equal(session.checkpoint().encounterSerial, serial + 1);
    assert.deepEqual(fieldOwner.eventState.snapshot(), flags, "Idle return must not restart a story script");
    const after = ownedOwner.snapshot();
    assert.ok(after.roster.some((member) => member.exp > before.roster.find((old) => old.id === member.id).exp),
      "Source growth must reach the existing owned characters");
    return { serial, battleSeed, formation: b.content.formation, choice: b.content.formationChoice,
      ticks, submitted, resolved, reward, growthBefore: growth(before), growthAfter: growth(after),
      gilBefore: before.gil, gilAfter: after.gil, sameFieldAndOwnedOwners: true };
  }

  for (const seed of seeds) {
    const runtime = controlledAudioRuntime(), session = new GameSession(field, battle, seed, runtime);
    const flow = new GameFlow(session);
    flow.start(); flow.advance(0, host);
    const branch = { seed, firstFormation: selectBattleFormation(plan, seed).formation, battles: [] };
    report.branches.push(branch);
    move(flow, "up"); assert.equal(flow.phase, "exploration");
    assert.equal(session.checkpoint().walkEncounters.completedSteps, 1);
    move(flow, "down"); assert.equal(flow.phase, "battle");
    report.stages.push({ name: "walking-selects-first-formation", seed, formation: session.battle.content.formation });
    branch.battles.push(win(flow, seed, 0));
    report.stages.push({ name: "source-actions-rewards-growth-and-idle-return", seed, serial: 1 });

    flow.pause(true); assert.equal(session.menuReady, true);
    const checkpoint = session.checkpoint();
    flow.advance(60000, host); assert.deepEqual(session.checkpoint(), checkpoint, "Paused menu must not advance clocks");
    const bytes = new Map(), storage = new CheckpointStorage({
      getItem: (key) => bytes.get(key) ?? null, setItem: (key, value) => bytes.set(key, value),
    }, "framework");
    await storage.save(checkpoint, seed + 1);
    const saved = await storage.load(); assert.ok(saved);
    const restored = GameSession.restore(saved.checkpoint, field, battle, undefined, runtime);
    assert.deepEqual(restored.checkpoint(), checkpoint);
    branch.savedGameHash = saved.contentHash;
    report.stages.push({ name: "menu-checkpoint-storage-and-restored-owner", seed, saveHash: saved.contentHash });
    const replay = new GameFlow(restored); replay.start(); replay.advance(0, host);
    move(replay, "up"); assert.equal(replay.phase, "exploration");
    move(replay, "down"); assert.equal(replay.phase, "battle");
    branch.battles.push(win(replay, seed, 1));
    const final = restored.checkpoint();
    assert.equal(final.encounterSerial, 2);
    assert.equal(final.walkEncounters.encounters, 2);
    assert.equal(final.walkEncounters.completedSteps, 4);
    assert.deepEqual(restored.completedEncounters, [3, 3]);
    await storage.save(final, seed + 3);
    assert.deepEqual(GameSession.restore((await storage.load()).checkpoint, field, battle, undefined, runtime).checkpoint(), final);
    report.stages.push({ name: "restored-walking-second-battle-and-second-checkpoint", seed,
      formation: branch.battles[1].formation, serial: final.encounterSerial, gil: restored.gil });
  }

  // Reuse the focused controlled fault regression instead of manufacturing a
  // malformed source catalog or adding another long source battle loop here.
  const retryTest = resolve(compiled, "tests/battle-formation-session.test.js");
  const retry = spawnSync(process.execPath, ["--test", "--test-reporter=tap", "--test-name-pattern",
    "^failed construction and explicit retry preserve", retryTest], { encoding: "utf8" });
  await writeFile(resolve(root, "build/reports/battle-formations-retry.log"), retry.stdout + retry.stderr);
  assert.equal(retry.error, undefined);
  assert.equal(retry.status, 0, retry.stdout + retry.stderr);
  assert.match(retry.stdout, /# pass 1\b/);
  report.stages.push({ name: "failed-construction-and-explicit-retry-preserve-seed",
    lane: "synthetic-controlled-fault", passed: 1, test: "tests/battle-formation-session.test.ts",
    log: "build/reports/battle-formations-retry.log" });
  // Byte-check both inputs again to catch accidental mutation of published data.
  for (let index = 0; index < sourcePaths.length; index++)
    assert.deepEqual(await readFile(resolve(root, sourcePaths[index])), sourceBytes[index]);
  await Promise.all([verifyContent(field), verifyContent(battle)]);
  report.stages.push({ name: "published-inputs-unchanged-and-controlled-hashes-still-valid" });
  report.result = "passed";
} catch (error) {
  report.result = "failed"; report.error = String(error.stack ?? error); throw error;
} finally {
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, stages: report.stages.length,
    battles: report.branches.reduce((total, branch) => total + branch.battles.length, 0), report: reportPath }));
}
