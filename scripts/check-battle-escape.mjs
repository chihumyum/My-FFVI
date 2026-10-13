// Continuous shared-owner acceptance using verified local content and an
// explicitly authored escape/walking policy. No original escape probability,
// main-story completion or browser/native presentation is certified here.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { controlledAudioRuntime } from "./controlled-audio.mjs";

const root = resolve(import.meta.dirname, ".."), args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 2 && args[0] === "--compiled-dir" && args[1],
  "Use --compiled-dir <directory>");
const compiled = resolve(root, args[1] ?? "dist");
const load = name => import(pathToFileURL(resolve(compiled, "src/core", name + ".js")).href);
const output = resolve(root, "build/reports/battle-escape-check.json");
const demo = resolve(root, "build/framework/escape-demo");
const partyId = 3002, seed = 314, potionId = 2, potionCount = 4;
const report = {
  kind: "battle-escape-integration-v1", result: "running", stages: [],
  evidence: {
    lane: "verified-local-content-with-controlled-development-policies",
    sourcePartyId: partyId,
    controlledInputs: [
      "Existing development-checkpoint field and owned roster, not source new-game initialization",
      "Every two eligible free-walking steps selects party 3002",
      "Explicit framework-battle-escape-v1 policy; no source escape probability or input timing",
      "Four source content 2 Potions added only to this private catalog's initial inventory",
      "Headless audio readiness/presentation acknowledgements and in-memory checkpoint storage",
    ],
    limitations: [
      "This journey does not inject return-publication faults; atomic failure/retry is covered separately by core tests",
      "Source party, enemy AI, ability effects, qualification, growth, rewards and media are otherwise unchanged",
      "No source encounter selection, complete campaign, browser presentation or original-game parity is established",
    ],
    sourceEscapeSemanticsVerified: false, browserVerified: false, originalGameExecuted: false,
    fullGameMigration: false,
  },
};
await mkdir(resolve(output, ".."), { recursive: true });
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
try {
  const [{ GameSession }, { GameFlow }, { CheckpointStorage }, { verifyContent, contentDigest }] = await Promise.all([
    load("game-session"), load("game-flow"), load("saved-game"), load("content-integrity"),
  ]);
  const inputPaths = ["build/game/narshe.json", "build/game/opening-playable.json"];
  const inputBytes = await Promise.all(inputPaths.map(path => readFile(resolve(root, path))));
  const [sourceField, sourceBattle] = await Promise.all(inputBytes.map(bytes => verifyContent(JSON.parse(bytes.toString()))));
  const field = structuredClone(sourceField), catalog = structuredClone(sourceBattle);
  const encounter = catalog.encounters[partyId];
  assert.ok(encounter && encounter.encounterId === partyId, "Real holdout party 3002 must be present");
  assert.equal(sourceBattle.common.qualificationContext.mode, "source");
  assert.ok(catalog.gameState.items[potionId]?.uses.battle.plan, "Source Potion must have a real battle plan");
  assert.equal(catalog.gameState.initialItems.some(item => item.id === potionId), false,
    "The private inventory addition must not be confused with published initial ownership");
  field.walkEncounters = {
    kind: "framework-walk-encounters-v1", id: "controlled-escape-walk", minSteps: 2, maxSteps: 2,
    transportationIds: [sourceField.entry.transportationId], parties: [{ partyId, weight: 1 }],
  };
  field.limitations.push("Controlled escape-system demo: two-step walking encounters and an authored escape policy; four test Potions exist only in the paired private battle catalog.");
  encounter.escapePolicy = { kind: "framework-battle-escape-v1", id: "controlled-ordinary-escape" };
  catalog.gameState.initialItems.push({ id: potionId, count: potionCount });
  // Prove the fixture changes only the declarations named above. In
  // particular, no combatant, learned action, formula or reward is injected.
  const unchangedBattle = structuredClone(catalog);
  if (sourceBattle.encounters[partyId].escapePolicy === undefined) delete unchangedBattle.encounters[partyId].escapePolicy;
  else unchangedBattle.encounters[partyId].escapePolicy = structuredClone(sourceBattle.encounters[partyId].escapePolicy);
  unchangedBattle.gameState.initialItems = structuredClone(sourceBattle.gameState.initialItems);
  assert.deepEqual(unchangedBattle, sourceBattle);
  for (const content of [field, catalog]) {
    const { contentHash: _, ...payload } = content;
    content.contentHash = await contentDigest(payload);
    await verifyContent(content);
  }
  report.hashes = {
    sourceField: sourceField.contentHash, sourceBattle: sourceBattle.contentHash,
    controlledField: field.contentHash, controlledBattle: catalog.contentHash,
    files: Object.fromEntries(inputPaths.map((path, index) => [path, hash(inputBytes[index])])),
  };
  report.sourceLimitations = { field: sourceField.limitations, battle: sourceBattle.common.limitations,
    encounter: sourceBattle.encounterDiagnostics?.filter(entry => entry.partyId === partyId) ?? [] };
  await mkdir(demo, { recursive: true });
  await Promise.all([
    writeFile(resolve(demo, "field.json"), JSON.stringify(field) + "\n"),
    writeFile(resolve(demo, "battle.json"), JSON.stringify(catalog) + "\n"),
  ]);
  report.demo = { field: "build/framework/escape-demo/field.json", battle: "build/framework/escape-demo/battle.json" };

  const host = { visible: true, mediaReady: true, overlayOpen: false }, runtime = controlledAudioRuntime();
  const session = new GameSession(field, catalog, seed, runtime), flow = new GameFlow(session);
  flow.start(); flow.advance(0, host);
  const fieldOwner = session.field, playerOwner = fieldOwner.player, ownedOwner = session.state;
  const baseline = ownedOwner.snapshot(), flags = fieldOwner.eventState.snapshot();
  assert.equal(baseline.formatVersion, 13, "Escape settlement retains field random ownership and outcome-bearing receipts");
  const count = (stacks, id) => stacks.find(item => item.id === id)?.count ?? 0;
  const resources = players => players.map(player => ({ id: player.id, hp: player.hp, mp: player.mp,
    row: player.row, conditionIds: [...player.conditionIds] }));
  const stage = (name, details = {}) => report.stages.push({ name, phase: flow.phase, ...details });
  const walk = current => {
    for (const direction of ["up", "down"]) {
      assert.equal(current.move(direction), true); current.advance(240, host);
    }
    assert.equal(current.phase, "battle");
    assert.equal(current.session.field.stop.returnTo.kind, "field-idle");
    assert.equal(current.session.battle.content.encounterId, partyId);
  };
  stage("verified-private-content-and-explicit-inventory", { potionId, potionCount, seed });
  assert.equal(flow.canEscape, false); assert.equal(flow.requestEscape(), false);
  walk(flow);
  const battle = session.battle, seen = new Set(), actions = [];
  const observe = () => {
    const action = battle.action;
    if (action?.resolved && !seen.has(action)) {
      seen.add(action);
      actions.push({ actor: action.actor, side: battle.combatants.find(unit => unit.id === action.actor).side,
        source: structuredClone(action.source), results: structuredClone(action.results) });
    }
  };
  const tick = () => { flow.advance(10, host); observe(); };
  const until = (predicate, label, limit = 12000) => {
    for (let n = 0; n < limit; n++) {
      if (predicate()) return;
      assert.equal(flow.phase, "battle", `${label}: unexpected ${flow.phase}`);
      tick();
    }
    assert.fail(`${label}: timed out without altering live combat state`);
  };
  const injured = () => battle.players.find(player => player.hp > 0 && player.hp < player.maxHp);
  const healing = action => action.results.some(result => result.effects.some(effect =>
    effect.resource === "hp" && effect.recovery && effect.amount > 0));
  const damaging = action => action.results.some(result => result.effects.some(effect =>
    effect.resource === "hp" && !effect.recovery && effect.amount > 0 && !effect.missed));
  stage("free-walking-enters-real-source-battle", { playerIds: battle.players.map(player => player.id),
    enemyIds: battle.enemies.map(enemy => enemy.id) });

  const rowActor = battle.players.find(player => player.sourceId === 31);
  assert.ok(rowActor);
  until(() => battle.ready.some(player => player.id === rowActor.id), "row actor readiness");
  assert.equal(rowActor.row, "front");
  assert.equal(battle.command(rowActor.id, 4, rowActor.id, 5), true);
  until(() => rowActor.row === "back" && battle.action === null, "source row change finishes");
  assert.ok(actions.some(action => action.source.kind === "ability" && action.source.id === 4 &&
    action.results.some(result => result.effects.some(effect => effect.resource === "row" && effect.after === "back"))));
  stage("real-row-action-changes-leased-corps", { actor: rowActor.id, row: rowActor.row });

  const mage = battle.players.find(player => player.sourceId === 1);
  assert.ok(mage);
  until(() => !!injured() && battle.ready.some(player => player.id === mage.id), "real enemy injury before Cure");
  assert.ok(actions.some(action => action.side === "enemy" && damaging(action)), "Enemy action must actually damage a player");
  const cureTarget = injured(), mpBefore = mage.mp, mpCost = battle.abilityCost(mage.id, 31).mp;
  assert.ok(mpCost > 0 && battle.canUse(mage.id, 31, 7));
  assert.equal(battle.command(mage.id, 31, cureTarget.id, 7), true);
  until(() => actions.some(action => action.actor === mage.id && action.source.kind === "ability" &&
    action.source.id === 31 && healing(action)) && battle.action === null, "owned Cure pays MP and heals");
  assert.equal(mage.mp, mpBefore - mpCost);
  stage("enemy-damage-and-naturally-owned-magic", { actor: mage.id, target: cureTarget.id, abilityId: 31,
    mpBefore, mpCost, mpAfter: mage.mp });

  until(() => !!injured() && battle.ready.length > 0, "real enemy injury before Potion");
  const itemActor = battle.ready[0], itemTarget = injured();
  assert.equal(battle.commandItem(itemActor.id, potionId, { kind: "single", id: itemTarget.id }, 3), true);
  until(() => actions.some(action => action.source.kind === "item" && action.source.id === potionId && healing(action)) &&
    battle.action === null, "source Potion resolves");
  assert.equal(count(battle.inventory, potionId), potionCount - 1);
  assert.deepEqual(ownedOwner.snapshot(), baseline, "Used item and resource changes remain in the battle lease");
  stage("real-item-consumption-stays-private-before-return", { actor: itemActor.id, target: itemTarget.id,
    itemId: potionId, remaining: count(battle.inventory, potionId) });

  // Request while an actual enemy action has started but has not reached its
  // effect point. Also reserve a future Potion: only the started action may
  // complete after the request; the queued reservation must not be consumed.
  until(() => battle.action !== null && !battle.action.resolved &&
    battle.enemies.some(enemy => enemy.id === battle.action.actor) && battle.ready.length > 0,
  "started enemy action before escape");
  const active = battle.action, activeBefore = structuredClone(active), beforeActionPlayers = resources(battle.players);
  const cancelledActor = battle.ready[0], cancelledTarget = battle.players.find(player => player.hp > 0);
  assert.equal(battle.commandItem(cancelledActor.id, potionId, { kind: "single", id: cancelledTarget.id }, 3), true);
  assert.ok(battle.pendingActions.some(action => action.actor === cancelledActor.id && action.source.kind === "item"));
  assert.equal(count(battle.inventory, potionId), potionCount - 1);
  assert.equal(battle.inventory.find(item => item.id === potionId).available, potionCount - 2);
  assert.equal(flow.canEscape, true);
  flow.pause(true); assert.equal(flow.canEscape, false); assert.equal(flow.requestEscape(), false);
  flow.advance(500, host); assert.equal(battle.action.elapsed, activeBefore.elapsed);
  flow.pause(false); flow.advance(0, host);
  assert.equal(flow.requestEscape(), true);
  assert.equal(flow.requestEscape(), false, "A duplicate request cannot restart or overwrite escape");
  assert.equal(battle.escapePending, true); assert.equal(flow.phase, "battle");
  assert.equal(battle.action, active, "The started action must retain its identity");
  assert.deepEqual(resources(battle.players), beforeActionPlayers, "Requesting escape cannot fast-forward or erase effects");
  assert.equal(battle.command(cancelledActor.id, 4, cancelledActor.id, 5), false);
  assert.throws(() => session.checkpoint(), /battle|event|movement/i);
  until(() => flow.phase === "escaped", "started action resolves before escape");
  assert.equal(active.resolved, true, "Escape must not cancel the committed-in-progress enemy action");
  assert.ok(damaging({ results: active.results }), "This seed must retain actual enemy damage on the escape boundary");
  assert.equal(battle.reward, null); assert.deepEqual(battle.pendingActions, []);
  assert.equal(count(battle.inventory, potionId), potionCount - 1);
  assert.equal(battle.inventory.find(item => item.id === potionId).available, potionCount - 1,
    "Unstarted Potion reservation must be released without consumption");
  assert.equal(actions.filter(action => action.source.kind === "item").length, 1);
  const escaped = battle.previewEscape(); assert.ok(escaped);
  assert.deepEqual(escaped.consumedItems, [{ id: potionId, count: 1 }]);
  const preview = structuredClone(escaped);
  escaped.players[0].hp = -1; escaped.consumedItems[0].count = 99;
  assert.deepEqual(battle.previewEscape(), preview, "Escape preview cannot mutate the terminal candidate");
  assert.deepEqual(ownedOwner.snapshot(), baseline, "No result is committed before field return");
  stage("pending-action-settles-and-unstarted-item-is-released", { source: activeBefore.source,
    actor: activeBefore.actor, requestedAtElapsed: activeBefore.elapsed, results: active.results,
    cancelledActor: cancelledActor.id, consumedItems: preview.consumedItems, players: resources(preview.players) });

  assert.equal(flow.continueEscape(), true); assert.equal(flow.continueEscape(), false);
  assert.equal(flow.phase, "exploration"); assert.equal(session.battle, null);
  assert.equal(session.field, fieldOwner); assert.equal(session.field.player, playerOwner); assert.equal(session.state, ownedOwner);
  assert.deepEqual([playerOwner.x, playerOwner.y], [38, 49]);
  assert.deepEqual(fieldOwner.eventState.snapshot(), flags, "Ordinary escape must not run a story continuation");
  const expected = structuredClone(baseline);
  for (const result of preview.players) {
    const player = expected.roster.find(member => member.id === result.id);
    assert.equal(result.level, player.level); assert.equal(result.exp, player.exp);
    assert.equal(result.maxHp, player.maxHp); assert.equal(result.maxMp, player.maxMp);
    Object.assign(player, { hp: result.hp, mp: result.mp, conditionIds: [...result.conditionIds] });
    const cell = expected.party.slots[expected.party.selectedSlot].find(cell => cell.id === result.id);
    assert.ok(cell); cell.row = result.row;
  }
  expected.items.find(item => item.id === potionId).count--;
  expected.completedBattles.push({ serial: 0, encounterId: partyId, outcome: "escaped" });
  assert.deepEqual(ownedOwner.snapshot(), expected,
    "Only resources, conditions, row, actual item consumption and escaped receipt may persist; no reward or learning");
  assert.deepEqual(session.completedEncounters, [], "Escaping must not certify victory or completed content");
  assert.equal(session.menuReady, true); assert.equal(session.checkpointReady, true);
  stage("same-field-return-with-zero-rewards-or-learning", { players: resources(preview.players),
    receipts: expected.completedBattles, gilBefore: baseline.gil, gilAfter: session.gil });

  const bytes = new Map(), storage = new CheckpointStorage({
    getItem: key => bytes.get(key) ?? null, setItem: (key, value) => bytes.set(key, value),
  }, "framework");
  const checkpoint = session.checkpoint();
  assert.equal(checkpoint.encounterSerial, 1);
  assert.equal(checkpoint.walkEncounters.encounters, 1);
  await storage.save(checkpoint, 1);
  const saved = await storage.load(); assert.ok(saved);
  const restored = GameSession.restore(saved.checkpoint, field, catalog, undefined, runtime);
  assert.deepEqual(restored.checkpoint(), checkpoint); assert.deepEqual(restored.completedEncounters, []);
  const replay = new GameFlow(restored); replay.start(); replay.advance(0, host);
  stage("escaped-receipt-and-consumed-resources-survive-storage", { saveHash: saved.contentHash,
    encounterSerial: checkpoint.encounterSerial });

  walk(replay);
  const nextBattle = restored.battle, beforeVictory = restored.state.snapshot();
  assert.deepEqual(resources(nextBattle.players), resources(preview.players));
  assert.equal(count(nextBattle.inventory, potionId), potionCount - 1);
  const victoryActions = [], victorySeen = new Set();
  for (let n = 0; n < 12000 && replay.phase === "battle"; n++) {
    for (const actor of nextBattle.ready) {
      const ally = nextBattle.players.find(player => player.hp > 0 && player.hp < player.maxHp * 0.6);
      const target = ally ?? nextBattle.targets(actor.id, 218)[0];
      if (target) assert.equal(nextBattle.command(actor.id, ally ? 222 : 218, target.id), true);
    }
    replay.advance(10, host);
    const action = nextBattle.action;
    if (action?.resolved && !victorySeen.has(action)) {
      victorySeen.add(action); victoryActions.push({ actor: action.actor,
        source: structuredClone(action.source), results: structuredClone(action.results) });
    }
  }
  assert.equal(replay.phase, "victory");
  assert.ok(victoryActions.some(action => action.source.kind === "ability" && action.source.id === 218 && damaging(action)));
  assert.deepEqual(restored.state.snapshot(), beforeVictory, "Next victory still uses the existing one-time commit boundary");
  const rewards = structuredClone(nextBattle.reward);
  assert.ok(rewards && rewards.exp > 0 && rewards.gil > 0);
  assert.equal(replay.continueVictory(), true); assert.equal(replay.continueVictory(), false);
  assert.equal(replay.phase, "exploration"); assert.equal(restored.gil, baseline.gil + rewards.gil);
  assert.deepEqual(restored.completedEncounters, [partyId]);
  assert.deepEqual(restored.state.snapshot().completedBattles, [
    { serial: 0, encounterId: partyId, outcome: "escaped" }, { serial: 1, encounterId: partyId, outcome: "victory" },
  ]);
  assert.ok(restored.state.snapshot().roster.some(player =>
    player.exp > baseline.roster.find(member => member.id === player.id).exp));
  assert.deepEqual(restored.field.eventState.snapshot(), flags);
  const final = restored.checkpoint();
  assert.equal(final.encounterSerial, 2); assert.equal(final.walkEncounters.encounters, 2);
  assert.equal(final.walkEncounters.completedSteps, 4);
  await storage.save(final, 2);
  assert.deepEqual(GameSession.restore((await storage.load()).checkpoint, field, catalog, undefined, runtime).checkpoint(), final);
  stage("restored-session-wins-next-battle-and-saves-once", { rewards,
    completedEncounters: restored.completedEncounters, receipts: final.owned.completedBattles });

  report.actions = actions;
  report.nextBattleActions = victoryActions;
  for (let index = 0; index < inputPaths.length; index++)
    assert.deepEqual(await readFile(resolve(root, inputPaths[index])), inputBytes[index], "Published content bytes must remain unchanged");
  await Promise.all([verifyContent(field), verifyContent(catalog)]);
  stage("published-inputs-unchanged-and-private-hashes-valid");
  report.result = "passed";
} catch (error) {
  report.result = "failed"; report.error = String(error.stack ?? error); throw error;
} finally {
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, stages: report.stages.length, report: output }));
}
