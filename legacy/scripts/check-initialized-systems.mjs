// Real source initialization on an explicitly authored map. The same public
// gameplay owners execute facilities, one ordinary battle and saved progress.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, ".."), args = process.argv.slice(2);
let compiled = "dist", contentDirectory = "build/content-packages", reportFile = "build/reports/initialized-systems-check.json";
for (let i = 0; i < args.length; i++) {
  assert.ok(["--compiled-dir", "--content-dir", "--report"].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith("--"));
  const name = args[i], value = args[++i];
  if (name === "--compiled-dir") compiled = value;
  else if (name === "--content-dir") contentDirectory = value;
  else reportFile = value;
}
const load = name => import(pathToFileURL(resolve(root, compiled, "src/core/" + name + ".js")).href);
const [{ GameContentRepository }, { GameSession }, { GameFlow }, { GameEntryLoader }, { GameCommands },
  { GameBattleHandoff }, { CheckpointStorage }, { contentDigest }] = await Promise.all([
  "game-content", "game-session", "game-flow", "game-entry-loader", "game-commands", "game-battle-handoff",
  "saved-game", "content-integrity",
].map(load));
const tests = [], base = resolve(root, contentDirectory), output = resolve(root, reportFile);
const report = { kind: "initialized-systems-check-v1", result: "running", tests,
  evidence: { lane: "framework-initialized", sourceGameplayAdmitted: false, originalGameExecuted: false,
    browserVerified: false, semanticsVerified: false, fullGameMigration: false,
    initialization: "source DataInitialize through GameState.createNewGame; no legacy native-state seed patch",
    gameplay: "authored assetless facilities, actual shop rules, owned magic stone, ordinary source party and restore",
    media: "explicit asynchronous headless readiness; no image decoding or audible acceptance" } };
const host = { visible: true, mediaReady: true, overlayOpen: false }, runtime = { battleHandoff: "prepared" };
const passed = name => tests.push({ name, passed: true });
const member = (owned, id) => owned.roster.find(row => row.id === id);
await mkdir(resolve(output, ".."), { recursive: true });

try {
  const refs = JSON.parse(await readFile(resolve(base, "systems-initialized.json"), "utf8"));
  const urls = [];
  const repository = new GameContentRepository(async url => {
    assert.ok(url.startsWith("/content-packages/"), "Initialized package cannot borrow a legacy location");
    const file = resolve(base, url.slice("/content-packages/".length)), rel = relative(base, file);
    assert.ok(rel && rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel));
    urls.push(url); return JSON.parse(await readFile(file, "utf8"));
  }, "framework", refs);
  const bundle = await repository.initializedNewGame();
  assert.equal(repository.hasInitializedEntry, true); assert.equal(repository.hasSourceEntry, false);
  assert.equal(repository.hasDevelopmentEntry, false); assert.equal(bundle.content.kind, "framework-new-game-content-v1");
  report.refs = refs; report.entryHash = bundle.content.contentHash; report.initializerHash = bundle.content.initializerHash;
  passed("trusted-v2-entry-world-battle-map-and-source-initializer-pins");

  const flow = new GameFlow(), entries = new GameEntryLoader(flow, { discard: () => {} });
  const start = await entries.begin("new-game").prepare(async context => {
    const game = await GameSession.prepareFrameworkNewGame(bundle.content, bundle.catalog, bundle.map, bundle.battle, runtime);
    assert.ok(context.isCurrent()); return { session: game, presentation: null };
  });
  assert.equal(start.status, "committed", String(start.error?.stack ?? start.error ?? start.status));
  let game = start.session, commands = new GameCommands(flow, game);
  flow.advance(0, host);
  assert.ok(game.state.nativeState); assert.equal(game.state.initialization, "source-new-game");
  assert.equal(game.field.stop, null); assert.equal(game.field.checkpointReady, true);
  assert.equal(game.field.player.x, 38); assert.equal(game.field.player.y, 49);
  assert.deepEqual(game.players.map(player => player.id), bundle.battle.common.players.map(player => player.id));
  assert.ok(game.players.every(player => !player.conditionIds.includes(607)));
  report.initial = { players: game.players.map(({ id, level, hp, mp, conditionIds }) => ({ id, level, hp, mp, conditionIds })), gil: game.gil };
  passed("fresh-native-owner-field-actors-and-normal-initializer-reach-idle");

  // These declared stations collide. A rejected step still changes facing,
  // exactly as ordinary app movement does, then confirmation interacts.
  function face(direction) {
    const position = { x: game.field.player.x, y: game.field.player.y };
    assert.equal(flow.move(direction), false); flow.advance(10, host);
    assert.deepEqual({ x: game.field.player.x, y: game.field.player.y }, position);
    assert.equal(game.field.player.direction, direction);
  }
  face("down"); assert.equal(flow.confirm(), true); flow.advance(0, host);
  assert.equal(game.field.stop, null); assert.ok(game.field.dialogue);
  assert.ok(game.state.nativeState.ownedMagicStones.includes(73));
  flow.confirm(); flow.advance(10, host);
  assert.equal(game.field.eventState.read({ category: "MapLocalVariable", index: 0 }), 1);
  flow.pause(true); assert.equal(commands.menu({ kind: "change-magic-stone", playerId: "player:1", contentId: 73 }), true);
  flow.pause(false); flow.advance(0, host);
  assert.equal(game.magicStoneMenu("player:1").currentContentId, 73);
  passed("actual-native-object-receipt-and-owned-magic-stone-menu-equip");

  const stoneState = game.state.snapshot(); flow.confirm(); flow.advance(0, host);
  assert.deepEqual(game.state.snapshot(), stoneState); flow.confirm(); flow.advance(10, host);
  passed("actual-map-local-guard-prevents-repeat-magic-stone-awards");

  face("right"); flow.confirm(); flow.advance(0, host);
  assert.equal(game.field.currentShop?.groupId, 2); assert.equal(commands.shopReady, true);
  const product = bundle.battle.gameState.shops.products.find(row => row.groupId === 2 && row.contentId === 2);
  assert.ok(product); const beforeShop = game.state.snapshot();
  assert.ok(commands.tradeShop({ kind: "buy", productId: product.id, count: 2 }));
  assert.equal(game.gil, beforeShop.gil - product.buy * 2);
  assert.equal(commands.closeShop(game.field.currentShop?.id), true); flow.advance(10, host);
  assert.equal(game.field.currentShop, null); assert.equal(game.checkpointReady, true);
  passed("native-field-object-shop-source-product-pricing-and-close");

  face("up"); flow.confirm(); flow.advance(0, host);
  assert.ok(game.field.choice); assert.equal(flow.choose(game.field.choice.id, 2), true);
  flow.advance(10, host); assert.equal(game.field.choice, null); assert.equal(game.field.stop, null);
  assert.equal(game.checkpointReady, true);
  passed("native-choice-return-releases-the-field-and-menu");

  const beforeBattle = game.state.snapshot(), owned = game.state, world = game.world;
  flow.confirm(); flow.advance(0, host); assert.ok(game.field.choice);
  assert.equal(flow.choose(game.field.choice.id, 1), true); flow.advance(10, host);
  assert.equal(game.field.stop?.kind, "encounter"); assert.equal(game.field.stop.party, 517);
  assert.equal(game.battle, null);
  const handoff = new GameBattleHandoff(flow, {
    prepareStart: async view => {
      assert.equal(flow.phase, "battle-entry"); assert.equal(game.battle, null); assert.equal(game.state.inBattle, true);
      assert.equal(view.content.encounterId, 517); assert.ok(view.mediaUrls.length > 0);
      const time = game.field.time; flow.advance(10, host); await Promise.resolve(); assert.equal(game.field.time, time);
      return { kind: "battle", urls: [...view.mediaUrls] };
    },
    prepareReturn: async view => {
      assert.equal(flow.phase, "battle-return"); assert.equal(view.outcome, "victory");
      assert.equal(game.battle.phase, "victory"); assert.deepEqual(game.state.snapshot(), beforeBattle);
      const time = game.field.time; flow.advance(10, host); await Promise.resolve(); assert.equal(game.field.time, time);
      return { kind: "field" };
    }, discard: () => {},
  });
  const battleStart = await handoff.start();
  assert.equal(battleStart.status, "committed", String(battleStart.error?.stack ?? battleStart.error ?? battleStart.status));
  const battle = game.battle; assert.ok(battle); flow.advance(0, host);
  assert.deepEqual(game.state.snapshot(), beforeBattle);
  let accepted = 0, ticks = 0;
  while (battle.phase === "active" && ticks++ < 30000) {
    for (const actor of battle.ready) {
      const command = battle.commandMenu(actor.id).find(row => row.available && row.kind === "ability" && row.abilityIds.includes(1));
      assert.ok(command, "Actual owned actor has no ordinary attack command");
      const target = battle.targetChoices(actor.id, 1).find(choice => choice.targetIds.some(id => battle.enemies.some(enemy => enemy.id === id)));
      if (!target) {
        assert.ok(battle.enemies.every(enemy => enemy.hp === 0), "Ordinary attack lost its live enemy target");
        continue;
      }
      if (commands.command(battle, actor.id, 1, target.selection, command.id)) accepted++;
    }
    flow.advance(10, host);
    assert.notEqual(game.field.stop?.kind, "unsupported", JSON.stringify(game.field.stop));
  }
  assert.equal(battle.phase, "victory", "Unchanged ordinary source attacks must complete this declared upgrade battle");
  assert.ok(accepted > 0); const reward = structuredClone(battle.reward); assert.ok(reward);
  assert.equal(reward.gil, battle.content.enemies.reduce((sum, enemy) => sum + enemy.gil, 0));
  assert.deepEqual(game.state.snapshot(), beforeBattle);
  const returned = await handoff.return();
  assert.equal(returned.status, "committed", String(returned.error?.stack ?? returned.error ?? returned.status));
  assert.equal(game.state, owned); assert.equal(game.world, world); assert.equal(game.battle, null);
  const afterBattle = game.state.snapshot();
  assert.equal(afterBattle.gil, beforeBattle.gil + reward.gil);
  assert.equal(afterBattle.completedBattles.length, beforeBattle.completedBattles.length + 1);
  for (const player of battle.players)
    assert.equal(member(afterBattle, player.id).exp, member(beforeBattle, player.id).exp + (player.hp > 0 ? reward.each : 0));
  await assert.rejects(handoff.return(), /pending encounter or terminal battle/);
  assert.deepEqual(game.state.snapshot(), afterBattle);
  flow.advance(10, host); assert.ok(game.field.dialogue); flow.confirm(); flow.advance(10, host);
  assert.equal(game.checkpointReady, true);
  report.battle = { encounterId: 517, acceptedCommands: accepted, ticks, reward, completedBattles: afterBattle.completedBattles.length };
  passed("public-prepared-ordinary-battle-victory-reward-growth-and-one-return");

  const saved = game.checkpoint(); assert.equal(saved.formatVersion, 6);
  const bytes = new Map(), storage = new CheckpointStorage({ getItem: key => bytes.get(key) ?? null,
    setItem: (key, value) => bytes.set(key, value) }, "framework", "systems-initialized");
  flow.pause(true); const saveTicket = flow.beginOperation("save");
  const preparedSave = await storage.prepareSave(saved, game.field.time); assert.ok(saveTicket.isCurrent());
  preparedSave.commit(); assert.equal(saveTicket.finish(), true);
  const savedDigest = await contentDigest(saved), previous = game, previousCommands = commands;
  const restored = await entries.begin("load").prepare(async context => {
    const stored = await storage.load(); assert.ok(stored); assert.ok(context.isCurrent());
    const packages = await repository.restoreSessionContent(stored.checkpoint); assert.ok(context.isCurrent());
    const session = GameSession.restore(stored.checkpoint, packages.initial, packages.battle, packages.world, runtime);
    assert.equal(await contentDigest(session.checkpoint()), savedDigest);
    return { session, presentation: null, options: { paused: true } };
  });
  assert.equal(restored.status, "committed", String(restored.error?.stack ?? restored.error ?? restored.status));
  game = restored.session; commands = new GameCommands(flow, game); flow.observeHost(host);
  assert.equal(previousCommands.menu({ kind: "change-magic-stone", playerId: "player:1", contentId: 0 }), false);
  assert.equal(await contentDigest(previous.checkpoint()), savedDigest); assert.deepEqual(game.checkpoint(), saved);
  assert.equal(commands.menuReady, true); flow.pause(false); flow.advance(0, host);
  passed("v6-namespaced-storage-restore-preserves-rewards-native-actors-and-command-owner");

  flow.confirm(); flow.advance(0, host); assert.ok(game.field.choice);
  assert.equal(flow.choose(game.field.choice.id, 2), true); flow.advance(10, host);
  assert.equal(game.checkpointReady, true); assert.deepEqual(game.state.snapshot(), afterBattle);
  passed("restored-owner-continues-the-next-real-field-input-without-replaying-a-reward");
  report.result = "passed"; report.urls = [...new Set(urls)]; report.checkpointHash = savedDigest;
} catch (error) {
  report.result = "failed"; report.error = error.stack ?? String(error);
} finally { await writeFile(output, JSON.stringify(report, null, 2) + "\n"); }
console.log(JSON.stringify({ result: report.result, tests: tests.length, report: reportFile }));
if (report.result !== "passed") process.exitCode = 1;
