import { controlledAudioRuntime } from "./controlled-audio.mjs";
// One continuous development-profile journey through the real session owner.
// Authored content is a message -> shared script call -> two-Potion grant event.
// This is a systems acceptance lane, not source new-game or main-story parity.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const options = new Map();
for (let i = 0; i < args.length; i += 2) {
  assert.ok(["--dist", "--field", "--catalog", "--report", "--battle-handoff"].includes(args[i]) && args[i + 1] &&
    !args[i + 1].startsWith("--") && !options.has(args[i]), "Use --dist/--field/--catalog/--report <path>, --battle-handoff prepared");
  options.set(args[i], args[i + 1]);
}
const compiled = resolve(root, options.get("--dist") ?? "dist");
const preparedHandoff = options.has("--battle-handoff");
assert.ok(!preparedHandoff || options.get("--battle-handoff") === "prepared", "Unknown battle handoff mode");
const reportPath = resolve(root, options.get("--report") ?? "build/reports/game-framework-check.json");
const module = (name) => import(pathToFileURL(resolve(compiled, "src/core", name + ".js")));
const report = {
  kind: "continuous-game-framework-check-v1", lane: "controlled-development-profile",
  result: "running", stages: [],
  controlledInputs: ["New development-checkpoint session, not GameSession.prepareNewGame",
    "Private message and returning cross-script grant: source item 2, count 2", "In-memory browser-storage port",
    "Temporarily absent battle continuation tests failure before reward publication; restored before retry",
    "Headless visible/media-ready/overlay observations; no renderer or audio assertion"],
  doesNotEstablish: ["source-new-game completion", "main-story migration", "original-runtime parity",
    "browser presentation", "particle or shader admission", "full-game migration"],
};
await mkdir(resolve(reportPath, ".."), { recursive: true });
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");

try {
  const { GameSession } = await module("game-session");
  const { GameFlow } = await module("game-flow");
  const { GameBattleHandoff } = await module("game-battle-handoff");
  const { CheckpointStorage, decodeSavedGame } = await module("saved-game");
  const { verifyContent, contentDigest } = await module("content-integrity");
  const readContent = async (path) => verifyContent(JSON.parse(await readFile(resolve(root, path), "utf8")));
  const field = await readContent(options.get("--field") ?? "build/game/narshe.json");
  const catalog = await readContent(options.get("--catalog") ?? "build/game/opening-playable.json");
  assert.equal(catalog.common.qualificationContext.mode, "source");
  assert.equal(catalog.common.fieldSourceSetHash, field.sourceSetHash);
  assert.equal(catalog.gameState.items[2].power, 50);
  assert.ok(catalog.gameState.items[2].uses.menu.plan, "The real Potion effect must be available");
  assert.deepEqual(catalog.gameState.initialItems, [{ id: 58, count: 1 }], "Published inventory must not grant the controlled Potion");

  const controlledField = structuredClone(field), script = "controlled_framework_supplies";
  assert.equal(controlledField.scripts[script], undefined);
  const source = { file: "controlled-game-framework", assetPath: "Fixtures/GameFramework/supplies.json" };
  controlledField.scripts[script] = [
    { kind: "message", key: "CONTROLLED_FRAMEWORK_SUPPLIES", speaker: "", text: "Framework inventory probe", script, index: 0, source },
    { kind: "script-transition", targetScript: script + "_grant", returnToCaller: true, script, index: 1, source },
    { kind: "exit", script, index: 2, source },
  ];
  controlledField.scripts[script + "_grant"] = [
    { kind: "nop", script: script + "_grant", index: 0, source },
    { kind: "inventory", command: { kind: "grant-item", id: 2, count: 2 }, result: null,
      dependencies: [{ table: "content.csv", id: 2 }, { table: "item.csv", id: 1 }], script: script + "_grant", index: 1, source },
    { kind: "exit", script: script + "_grant", index: 2, source },
  ];
  if (preparedHandoff) {
    const next = script + "_second_battle", after = next + "_after";
    controlledField.scripts[next] = [{ kind: "encounter", party: 3, continuation: after, script: next, index: 0, source }];
    controlledField.scripts[after] = [{ kind: "exit", script: after, index: 0, source }];
    controlledField.scriptLocals = { ...controlledField.scriptLocals, [next]: null, [after]: null };
  }
  controlledField.scriptLocals = { ...controlledField.scriptLocals, [script]: null, [script + "_grant"]: null };
  controlledField.scriptTransitionMetadata = { ...controlledField.scriptTransitionMetadata,
    [script]: { customAnimations: "none" }, [script + "_grant"]: { customAnimations: "none" } };
  const { contentHash: discardedHash, ...controlledPayload } = controlledField;
  controlledField.contentHash = await contentDigest(controlledPayload);
  await verifyContent(controlledField);
  assert.notEqual(controlledField.contentHash, field.contentHash);
  Object.assign(report, { sourceSetHash: field.parentSourceSetHash, fieldHash: field.contentHash,
    controlledFieldHash: controlledField.contentHash, battleCatalogHash: catalog.contentHash, profile: catalog.common.profile });

  const sessionRuntime = () => ({ ...controlledAudioRuntime(), ...(preparedHandoff ? { battleHandoff: "prepared" } : {}) });
  const flow = new GameFlow(new GameSession(controlledField, catalog, undefined, sessionRuntime()));
  let startGate = null, preparationError = null, preparedViews = 0, discardedViews = 0;
  const handoff = new GameBattleHandoff(flow, {
    prepareStart: async (view) => {
      if (startGate) await startGate;
      if (preparationError) throw preparationError;
      preparedViews++; return { encounterId: view.content.encounterId };
    },
    prepareReturn: async (view) => {
      if (preparationError) throw preparationError;
      preparedViews++; return { encounterId: view.content.encounterId };
    },
    discard: () => { discardedViews++; },
  });
  const host = { visible: true, mediaReady: true, overlayOpen: false };
  const game = () => flow.session;
  const owned = () => game().state.snapshot();
  const count = (id) => owned().items.find((item) => item.id === id)?.count ?? 0;
  const tick = (ms = 10, state = host) => flow.advance(ms, state);
  const stage = (name, details = {}) => report.stages.push({ step: report.stages.length + 1, name,
    phase: flow.phase, position: [game().field.player.x, game().field.player.y], gil: game().gil,
    completedEncounters: [...game().completedEncounters], ...details });
  const stable = () => {
    for (let n = 0; n < 12000; n++) {
      assert.equal(game().battle, null, "Field continuation must not silently enter another battle");
      assert.equal(game().field.stop, null, game().field.stop?.message);
      if (game().field.dialogue) flow.confirm();
      if (game().checkpointReady) return;
      tick();
    }
    assert.fail("Field continuation did not reach a stable checkpoint");
  };

  const initial = game().checkpoint();
  assert.equal(initial.origin.kind, "development-checkpoint");
  assert.equal(flow.phase, "title"); tick(60000);
  assert.equal(flow.move("up"), false); assert.equal(flow.confirm(), false);
  assert.deepEqual(game().checkpoint(), initial);
  flow.start();
  assert.equal(flow.move("up"), false, "A new owner needs its own media readiness observation");
  tick(0);
  assert.equal(flow.phase, "exploration");
  assert.equal(flow.pause(true), true); tick(60000);
  assert.equal(flow.phase, "paused"); assert.equal(flow.move("up"), false);
  assert.deepEqual(game().checkpoint(), initial);
  assert.equal(flow.pause(false), true);
  for (const blockedHost of [{ ...host, visible: false }, { ...host, mediaReady: false }, { ...host, overlayOpen: true }]) {
    tick(60000, blockedHost); assert.equal(flow.move("up"), false); assert.equal(flow.confirm(), false);
    assert.deepEqual(game().checkpoint(), initial, "Suppressed time must not mutate the session");
  }
  tick(0); assert.deepEqual(game().checkpoint(), initial, "Resume cannot replay suppressed elapsed time");
  stage("title-start-and-host-gates");

  assert.equal(flow.move("up"), true); tick(240);
  assert.equal(flow.move("down"), true); tick(240);
  assert.deepEqual([game().field.player.x, game().field.player.y], [38, 49]);
  assert.equal(game().field.startEvent(script), true);
  tick();
  assert.equal(flow.phase, "dialogue");
  assert.equal(count(2), 0, "A waiting dialogue must not award its later command");
  assert.equal(game().menuReady, false);
  assert.throws(() => game().checkpoint(), /during battle, movement or an event/);
  assert.equal(flow.confirm(), true); stable();
  assert.equal(count(2), 2); assert.equal(count(58), 1);
  flow.confirm(); tick();
  assert.equal(count(2), 2, "Repeated confirmation must not rerun the completed grant");
  stage("explore-event-confirm-and-single-grant", { itemId: 2, count: count(2) });

  const beforeMenu = owned(), leader = beforeMenu.roster[0];
  assert.equal(game().useMenuItem(2, leader.id), false, "Full-HP target is not a menu effect");
  assert.deepEqual(owned(), beforeMenu, "Rejected use must not consume inventory");
  const choices = game().state.equipmentChoices(leader.id, 1);
  const empty = choices.find((choice) => catalog.gameState.equipmentSystem.catalog.definitions[choice.id].empty);
  assert.ok(empty, "The actual owned empty equipment must be selectable");
  const weapon = leader.equipment[0], stock = structuredClone(beforeMenu.equipmentStock);
  assert.equal(game().changeEquipment(leader.id, 1, empty.id), true);
  assert.deepEqual(owned().equipmentStock, stock);
  assert.equal(game().changeEquipment(leader.id, 1, weapon), true);
  assert.equal(game().changeEquipment(leader.id, 1, weapon), false);
  assert.deepEqual(owned(), beforeMenu, "Unequip/re-equip must preserve the whole owned state");
  game().setBattlePreferences({ mode: "wait", speedIndex: 2 });
  stage("inventory-equipment-and-battle-preference-menu", { weapon, emptyEquipment: empty.id });

  for (let n = 0; n < 11; n++) { assert.equal(flow.move("up"), true); tick(240); }
  for (let n = 0; n < 12000 && !game().battle && !(preparedHandoff && game().field.stop?.kind === "encounter"); n++) {
    assert.notEqual(flow.phase, "blocked", game().field.stop?.message);
    if (game().field.dialogue) flow.confirm();
    tick();
  }
  if (preparedHandoff) {
    const request = game().field.stop, before = owned(), fieldTime = game().field.time;
    let release; startGate = new Promise(resolve => { release = resolve; });
    const pending = handoff.start();
    assert.equal(game().battle, null); assert.equal(game().state.inBattle, true);
    tick(60000); game().advance(60000);
    assert.equal(game().field.time, fieldTime); assert.deepEqual(owned(), before);
    handoff.cancel(); release();
    assert.equal((await pending).status, "cancelled"); startGate = null;
    assert.equal(game().field.stop, request); assert.equal(game().state.inBattle, false);
    assert.deepEqual(owned(), before); assert.equal(game().battle, null);
    stage("cancelled-entry-drops-time-and-retains-the-exact-source-request");
    preparationError = new Error("Controlled battle media preparation failure");
    const failedEntry = await handoff.start(); assert.equal(failedEntry.status, "failed");
    assert.equal(game().field.stop, request); assert.equal(game().state.inBattle, false);
    assert.deepEqual(owned(), before); preparationError = null;
    assert.equal((await handoff.start()).status, "committed"); tick(0);
    stage("failed-entry-retries-without-selecting-another-encounter");
  }
  assert.equal(flow.phase, "battle");
  const battleBeforeLoss = game().battle, beforeBattle = owned();
  assert.equal(battleBeforeLoss.content.encounterId, 3);
  assert.deepEqual(battleBeforeLoss.players.map((player) =>
    battleBeforeLoss.commandMenu(player.id).find((command) => command.id === 26).abilityIds.length), [8, 4, 4]);
  assert.equal(battleBeforeLoss.command(leader.id, 34, leader.id), false, "An unlearned skill cannot be selected");
  assert.equal(game().useMenuItem(2, leader.id), false);
  assert.equal(game().changeEquipment(leader.id, 1, empty.id), false);
  assert.equal(flow.continueVictory(), false);
  assert.throws(() => game().checkpoint(), /during battle, movement or an event/);
  stage("real-field-encounter-and-owned-command-entry", { encounterId: 3 });

  for (let n = 0; n < 30 && flow.phase === "battle"; n++) tick(60000);
  assert.equal(flow.phase, "defeat");
  assert.equal(flow.continueVictory(), false);
  assert.deepEqual(owned(), beforeBattle, "Defeat must not commit battle HP, rewards, growth or stock");
  assert.deepEqual(game().completedEncounters, []);
  if (preparedHandoff) assert.equal((await handoff.retry()).status, "committed");
  else assert.equal(flow.retryBattle(), true);
  assert.equal(flow.retryBattle(), false, "Only a defeated battle can be retried");
  assert.equal(flow.phase, "battle");
  assert.notEqual(game().battle, battleBeforeLoss);
  assert.deepEqual(game().battle.players.map(({ id, hp, mp }) => ({ id, hp, mp })),
    beforeBattle.roster.map(({ id, hp, mp }) => ({ id, hp, mp })));
  assert.deepEqual(owned(), beforeBattle);
  stage("defeat-keeps-owner-and-retry-reuses-lease");

  let acceptedCommands = 0;
  for (let n = 0; n < 12000 && flow.phase === "battle"; n++) {
    const battle = game().battle;
    for (const actor of battle.ready) {
      const ally = battle.players.find((p) => p.hp > 0 && p.hp < p.maxHp * 0.6);
      const target = ally ?? battle.targets(actor.id, 218)[0];
      if (target && battle.command(actor.id, ally ? 222 : 218, target.id)) acceptedCommands++;
    }
    tick();
  }
  assert.equal(flow.phase, "victory"); assert.ok(acceptedCommands > 0);
  const reward = structuredClone(game().battle.reward);
  const encounter = catalog.encounters[3];
  const expectedGil = encounter.enemies.reduce((sum, enemy) => sum + enemy.gil, 0);
  const expectedExp = Math.floor(encounter.enemies.reduce((sum, enemy) => sum + enemy.exp, 0) / beforeBattle.roster.length);
  assert.equal(reward.gil, expectedGil); assert.equal(reward.each, expectedExp);
  assert.deepEqual(owned(), beforeBattle, "Victory presentation alone cannot publish the reward");
  const pendingBattle = game().battle, pendingStop = game().field.stop;
  const continuation = pendingStop.continuation, returnScripts = game().field.content.scripts;
  const continuationOps = returnScripts[continuation];
  assert.ok(continuationOps);
  try {
    delete returnScripts[continuation];
    if (preparedHandoff) {
      const refused = await handoff.return(); assert.equal(refused.status, "failed");
      assert.match(refused.error.message, /Missing battle continuation/);
    } else assert.throws(() => flow.continueVictory(), /Missing battle continuation/);
    assert.equal(game().battle, pendingBattle); assert.equal(game().field.stop, pendingStop);
    assert.deepEqual(game().battle.reward, reward);
    assert.deepEqual(owned(), beforeBattle, "A failed return cannot publish any reward, stock or growth");
    assert.deepEqual(game().completedEncounters, []);
  } finally { returnScripts[continuation] = continuationOps; }
  stage("failed-victory-return-preserves-reward-and-owner");
  if (preparedHandoff) {
    preparationError = new Error("Controlled field return media failure");
    assert.equal((await handoff.return()).status, "failed");
    assert.equal(game().battle, pendingBattle); assert.deepEqual(owned(), beforeBattle);
    preparationError = null;
    assert.equal((await handoff.return()).status, "committed"); tick(0);
    stage("return-media-failure-preserves-the-terminal-battle-and-receipt");
  } else assert.equal(flow.continueVictory(), true);
  const awarded = owned();
  assert.ok(reward.dropPlan, "The actual source reward provider must be available");
  const potionDrops = reward.dropPlan.grants.filter((grant) => grant.kind === "grant-item" && grant.id === 2)
    .reduce((sum, grant) => sum + grant.count, 0);
  assert.equal(count(2), 2 + potionDrops, "Victory includes actual source drops as well as the controlled starting items");
  assert.equal(flow.continueVictory(), false);
  assert.deepEqual(owned(), awarded, "Duplicate reward confirmation must have no owned-state effect");
  stable();
  assert.equal(game().gil, beforeBattle.gil + expectedGil);
  assert.deepEqual(game().completedEncounters, [3]);
  for (const player of owned().roster) {
    const old = beforeBattle.roster.find((p) => p.id === player.id);
    assert.equal(player.exp, old.exp + expectedExp);
    assert.equal(player.level, catalog.common.experience.filter((row) => row.exp <= player.exp).at(-1).level);
    assert.deepEqual(player.equipment, old.equipment);
    if (old.level === 1) assert.ok(player.maxHp > old.maxHp, "Level-up must update shared parameters");
  }
  assert.deepEqual(owned().roster.map((p) => p.level), [3, 2, 2]);
  assert.equal(game().field.flags.ScenarioFlag1[1], true);
  assert.deepEqual([...game().field.hiddenEntities].sort(), ["164", "165", "177"]);
  assert.deepEqual(owned().equipmentStock, stock);
  stage("victory-one-reward-growth-and-field-return", { reward: { gil: expectedGil, eachExp: expectedExp, drops: reward.drops },
    levels: owned().roster.map((p) => p.level), acceptedCommands });

  const injured = owned().roster.find((p) => p.hp > 0 && p.hp < p.maxHp && p.maxHp - p.hp <= 50);
  assert.ok(injured, "The actual battle/growth result must provide a Potion target");
  assert.ok(game().state.menuItemTargets(2).includes(injured.id));
  const remainingPotions = count(2) - 1;
  assert.equal(game().useMenuItem(2, injured.id), true);
  assert.equal(owned().roster.find((p) => p.id === injured.id).hp, injured.maxHp);
  assert.equal(count(2), remainingPotions);
  assert.equal(game().useMenuItem(2, injured.id), false);
  assert.equal(count(2), remainingPotions, "A repeated full-HP item confirmation does not consume another Potion");
  stage("field-menu-consumes-one-real-item", { target: injured.id, itemCount: count(2) });

  const memory = new Map(); let writeFailure = false;
  const storage = new CheckpointStorage({ getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => { if (writeFailure) throw new Error("Controlled storage write failure"); memory.set(key, value); } });
  const savedCheckpoint = game().checkpoint(), savedOwner = game();
  const save = flow.beginOperation("save");
  assert.equal(flow.phase, "loading"); assert.equal(flow.move("up"), false);
  tick(60000); assert.deepEqual(game().checkpoint(), savedCheckpoint);
  await storage.save(savedCheckpoint, 0);
  assert.equal(save.finish(), true); assert.equal(save.finish(), false);
  assert.equal(flow.phase, "exploration");
  const slotBytes = [...memory.entries()];
  const failedSave = flow.beginOperation("save"); writeFailure = true;
  await assert.rejects(storage.save(savedCheckpoint, 1), /Controlled storage write failure/);
  writeFailure = false; failedSave.cancel();
  assert.deepEqual([...memory.entries()], slotBytes, "Failed storage publication preserves the last valid save");
  assert.equal(game(), savedOwner); assert.deepEqual(game().checkpoint(), savedCheckpoint);
  stage("save-and-failed-write-preserve-one-owner");

  assert.equal(flow.move("down"), true); tick(240);
  assert.notDeepEqual(game().checkpoint(), savedCheckpoint);
  const liveBeforeLoad = game(), liveCheckpoint = game().checkpoint();
  const failedLoad = flow.beginOperation("load");
  const saved = await storage.load(); assert.ok(saved);
  const corrupt = JSON.parse([...memory.values()][0]).current;
  const tampered = JSON.parse(corrupt); tampered.checkpoint.owned.gil++;
  await assert.rejects(decodeSavedGame(JSON.stringify(tampered)), /Content payload changed/);
  failedLoad.cancel();
  assert.equal(game(), liveBeforeLoad); assert.deepEqual(game().checkpoint(), liveCheckpoint);

  const load = flow.beginOperation("load");
  const restored = GameSession.restore(saved.checkpoint, controlledField, catalog, undefined, sessionRuntime());
  assert.deepEqual(restored.checkpoint(), savedCheckpoint);
  assert.equal(load.publish(restored), true);
  assert.equal(load.publish(liveBeforeLoad), false, "A consumed load ticket cannot reinstall an old session");
  assert.equal(game(), restored); assert.equal(flow.move("up"), false, "Load clears old media readiness");
  tick(0); assert.equal(flow.phase, "exploration");
  assert.deepEqual(game().battlePreferences, { mode: "wait", speedIndex: 2 });
  assert.equal(count(2), remainingPotions); assert.equal(count(58), 1);
  assert.equal(flow.continueVictory(), false); assert.deepEqual(game().checkpoint(), savedCheckpoint);
  stage("load-validated-checkpoint-and-refresh-host-readiness");

  for (const direction of ["down", "up", "up"]) { assert.equal(flow.move(direction), true); tick(240); }
  assert.equal(game().battle, null); assert.equal(game().field.stop, null);
  assert.deepEqual(game().completedEncounters, [3]);
  assert.equal(game().gil, savedCheckpoint.owned.gil);
  assert.equal(flow.continueVictory(), false);
  const finalCheckpoint = game().checkpoint();
  const nextSave = flow.beginOperation("save"); await storage.save(finalCheckpoint, 2); nextSave.finish();
  assert.deepEqual((await storage.load(true)).checkpoint, savedCheckpoint, "Previous save stays recoverable");
  assert.deepEqual((await storage.load()).checkpoint, finalCheckpoint);
  stage("continue-after-restore-without-retrigger-or-double-reward");

  if (preparedHandoff) {
    assert.equal(game().field.startEvent(script + "_second_battle"), true); tick();
    assert.equal(game().battle, null); assert.equal((await handoff.start()).status, "committed"); tick(0);
    for (let n = 0; n < 12000 && game().battle.phase === "active"; n++) {
      const battle = game().battle;
      for (const actor of battle.ready) {
        const ally = battle.players.find(p => p.hp > 0 && p.hp < p.maxHp * 0.6);
        const target = ally ?? battle.targets(actor.id, 218)[0];
        if (target) battle.command(actor.id, ally ? 222 : 218, target.id);
      }
      tick();
    }
    assert.equal(game().battle.phase, "victory");
    assert.equal((await handoff.return()).status, "committed"); tick(0); stable();
    assert.deepEqual(game().completedEncounters, [3, 3]);
    assert.equal(owned().completedBattles.length, 2);
    const second = game().checkpoint(), save = flow.beginOperation("save");
    await storage.save(second, 3); save.finish();
    const loaded = await storage.load();
    const candidate = GameSession.restore(loaded.checkpoint, controlledField, catalog, undefined, sessionRuntime());
    assert.deepEqual(candidate.checkpoint(), second);
    report.secondBattle = { completedBattles: 2, checkpointHash: await contentDigest(second) };
    stage("restored-owner-enters-and-settles-another-battle-on-the-same-contract");
  }

  const pending = flow.beginOperation("load"), current = game();
  flow.returnToTitle();
  assert.equal(pending.isCurrent(), false); assert.equal(pending.publish(savedOwner), false);
  assert.equal(game(), current); assert.equal(flow.phase, "title");
  const titleCheckpoint = game().checkpoint();
  tick(60000); assert.deepEqual(game().checkpoint(), titleCheckpoint);
  const restart = flow.beginOperation("load");
  const latest = await storage.load();
  assert.equal(restart.publish(GameSession.restore(latest.checkpoint, controlledField, catalog, undefined, sessionRuntime()), { paused: true }), true);
  assert.equal(flow.phase, "paused"); tick(60000);
  assert.deepEqual(game().checkpoint(), titleCheckpoint);
  assert.equal(flow.pause(false), true); tick(0);
  assert.equal(flow.move("down"), true); tick(240);
  assert.equal(flow.phase, "exploration"); assert.equal(game().battle, null);
  assert.equal(game().gil, titleCheckpoint.owned.gil);
  assert.deepEqual(game().completedEncounters, preparedHandoff ? [3, 3] : [3]);
  stage("title-cancels-stale-load-and-paused-restore-continues");

  // The controlled event never escapes the private copy or changes source qualification.
  assert.equal(field.scripts[script], undefined);
  await verifyContent(field); await verifyContent(controlledField); await verifyContent(catalog);
  Object.assign(report, { result: "pass", stageCount: report.stages.length,
    battleHandoff: preparedHandoff ? { mode: "prepared", preparedViews, discardedViews,
      compatibilityPolicy: "explicit-development-checkpoint", sourceNativeHandoffVerified: false } : { mode: "synchronous-compatibility" },
    final: { gil: game().gil, levels: owned().roster.map((p) => p.level), items: owned().items,
      completedEncounters: [...game().completedEncounters], preferences: game().battlePreferences },
    originalRuntimeOracle: false, storyCoverageExpanded: false, completeMigration: false });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, stages: report.stageCount, lane: report.lane,
    final: report.final, report: reportPath }));
} catch (error) {
  Object.assign(report, { result: "fail", error: { name: error.name, message: error.message } });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  throw error;
}
