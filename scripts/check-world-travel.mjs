// Verified source geometry and actors through the app's public gameplay owners.
// Navigation, encounter cadence and flat materials are explicit Web policies.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, ".."), args = process.argv.slice(2);
let compiled = "dist", contentDirectory = "build/content-packages", reportFile = "build/reports/world-travel-check.json";
for (let i = 0; i < args.length; i++) {
  assert.ok(["--compiled-dir", "--content-dir", "--report"].includes(args[i]) && args[i + 1]);
  const name = args[i], value = args[++i];
  if (name === "--compiled-dir") compiled = value;
  else if (name === "--content-dir") contentDirectory = value;
  else reportFile = value;
}
const load = name => import(pathToFileURL(resolve(root, compiled, "src/core/" + name + ".js")).href);
const [{ GameContentRepository }, { GameSession }, { GameFlow }, { GameEntryLoader }, { GameCommands },
  { GameMapLoader }, { GameBattleHandoff }, { CheckpointStorage }, { contentDigest }, { worldTerrainCollisionMask }] =
  await Promise.all(["game-content", "game-session", "game-flow", "game-entry-loader", "game-commands",
    "game-map-loader", "game-battle-handoff", "saved-game", "content-integrity", "world-terrain"].map(load));
const hook = registerHooks({ resolve(specifier, context, next) {
  return next(specifier.startsWith("/runtime/")
    ? pathToFileURL(resolve(root, compiled, "src", specifier.slice(9))).href : specifier, context);
} });
let Renderer;
try { ({ Renderer } = await import("../apps/game/renderer.js")); } finally { hook.deregister(); }

// Records actual Renderer calls and supplies explicitly controlled opaque RGBA.
// Source PNG signatures/dimensions are checked, but this is not image decoding,
// browser rasterization or an original-game pixel comparison.
class Canvas {
  constructor(width = 320, height = 180, calls = []) {
    this.width = width; this.height = height; this.calls = calls; this.puts = 0;
    this.ownerDocument = { createElement: () => new Canvas(0, 0, calls) };
  }
  getContext() { return this.context ??= new Context(this); }
}
class Context {
  constructor(canvas) { this.canvas = canvas; this.depth = 0; this.globalAlpha = 1; }
  save() { this.depth++; }
  restore() { assert.ok(this.depth > 0); this.depth--; }
  translate(x, y) { assert.ok([x, y].every(Number.isFinite)); }
  scale(x, y) { assert.ok([x, y].every(Number.isFinite)); }
  transform(...values) { assert.ok(values.every(Number.isFinite)); }
  fillRect(...values) { assert.ok(values.every(Number.isFinite)); }
  drawImage(image, ...values) {
    assert.ok(image && values.every(Number.isFinite));
    this.canvas.calls.push({ file: image.file ?? "offscreen", values });
  }
  createImageData(width, height) { return { width, height, data: new Uint8ClampedArray(width * height * 4) }; }
  getImageData() {
    const image = this.createImageData(this.canvas.width, this.canvas.height);
    for (let i = 0; i < image.data.length; i += 4) image.data.set([80, 100, 120, 255], i);
    return image;
  }
  putImageData(image) { assert.equal(image.data.length, this.canvas.width * this.canvas.height * 4); this.canvas.puts++; }
}
const host = { visible: true, mediaReady: true, overlayOpen: false }, runtime = { battleHandoff: "prepared" };
const base = resolve(root, contentDirectory), output = resolve(root, reportFile), stages = [];
const report = { kind: "framework-world-travel-check-v1", result: "running", stages,
  evidence: { source: "verified source maps 1 and 3, unchanged terrain/PointIn/exit and new-game initialization",
    authored: "independent travel route, explicit return interaction, encounter cadence and flat material policy",
    gameplay: "public repository/session/flow/commands/map-loader/battle-handoff/storage owners",
    presentation: "real Renderer with controlled Canvas and RGBA; actual PNG signature and dimensions only",
    semanticsVerified: false, originalGameExecuted: false, browserVerified: false, sourceStoryAdmitted: false } };
const passed = (name, detail) => stages.push({ name, passed: true, ...(detail ? { detail } : {}) });
await mkdir(resolve(output, ".."), { recursive: true });

try {
  const refs = JSON.parse(await readFile(resolve(base, "world-travel.json"), "utf8")), urls = [];
  const repository = new GameContentRepository(async url => {
    assert.ok(url.startsWith("/content-packages/"));
    const file = resolve(base, url.slice("/content-packages/".length)), rel = relative(base, file);
    assert.ok(rel && rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel));
    urls.push(url); return JSON.parse(await readFile(file, "utf8"));
  }, "framework", refs);
  const bundle = await repository.initializedNewGame();
  const sourceReport = JSON.parse(await readFile(resolve(base, "world-travel/build-report.json"), "utf8"));
  assert.equal(bundle.map.mapId, 1); assert.equal(bundle.map.entryView.isWorld, true);
  assert.equal(bundle.map.map.width, 256); assert.equal(bundle.map.map.height, 256);
  assert.equal(bundle.content.kind, "framework-new-game-content-v1");
  assert.equal(repository.hasSourceEntry, false); assert.equal(repository.hasDevelopmentEntry, false);
  assert.equal(sourceReport.sourceGeometryChanged, false); assert.equal(sourceReport.ownedInitializerChanged, false);
  assert.equal(sourceReport.initialStoryFlagsChanged, false);
  report.refs = refs; report.entryHash = bundle.content.contentHash; report.initializerHash = bundle.content.initializerHash;
  passed("verified-independent-world-travel-package-with-unchanged-source-initializer");

  const flow = new GameFlow(), entries = new GameEntryLoader(flow, { discard: () => {} });
  const start = await entries.begin("new-game").prepare(async context => {
    const session = await GameSession.prepareFrameworkNewGame(bundle.content, bundle.catalog, bundle.map, bundle.battle, runtime);
    assert.ok(context.isCurrent()); return { session, presentation: null };
  });
  assert.equal(start.status, "committed", String(start.error?.stack ?? start.error ?? start.status));
  let game = start.session, commands = new GameCommands(flow, game);
  const originalState = game.state, originalWorld = game.world;
  flow.advance(0, host);
  const ok = () => {
    assert.notEqual(game.field.stop?.kind, "unsupported", JSON.stringify(game.field.stop));
    assert.equal(game.encounterPreparationError, null);
  };
  function dismiss() {
    for (let i = 0; game.field.dialogue && i < 4; i++) { assert.ok(flow.confirm()); flow.advance(10, host); }
    ok(); assert.equal(game.field.dialogue, null);
  }
  function step(direction) {
    assert.equal(flow.move(direction), true, JSON.stringify(game.field.stop));
    for (let i = 0; game.field.player.motion && i < 100; i++) { flow.advance(10, host); ok(); }
    ok(); assert.equal(game.field.player.motion, null);
  }
  assert.ok(game.state.nativeState); assert.equal(game.state.initialization, "source-new-game");
  assert.deepEqual([game.field.player.x, game.field.player.y, game.field.player.layer], [84, 34, 0]);
  assert.ok(game.players.every(player => !player.conditionIds.includes(607)));
  dismiss(); assert.equal(game.checkpointReady, true);
  const originalOwner = game.state.snapshot();
  report.initial = { players: game.players.map(({ id, level, hp, mp }) => ({ id, level, hp, mp })), gil: game.gil };
  passed("source-point-in-and-native-actor-owner-enter-world-idle");

  async function render(field) {
    const images = new Map(), files = new Set(Object.values(field.content.map.textures));
    for (const actor of Object.values(field.actors)) if (field.isEntityVisible(actor.id) &&
        actor.x >= 0 && actor.x < field.content.map.width && actor.y >= 0 && actor.y < field.content.map.height &&
        actor.asset && actor.animation?.frame())
      files.add(field.content.characters[actor.asset].sprites[actor.animation.frame().sprite].file);
    for (const file of files) {
      assert.match(file, /^\/[A-Za-z0-9/_-]+\.png$/);
      const png = await readFile(resolve(root, "build", file.slice(1)));
      assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
      const boundHash = /\/([a-f0-9]{64})\.png$/.exec(file)?.[1];
      if (boundHash) assert.equal(createHash("sha256").update(png).digest("hex"), boundHash);
      const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
      assert.ok(width > 0 && height > 0); images.set(file, { file, width, height });
    }
    const canvas = new Canvas(), renderer = new Renderer(canvas, field.content, images), time = field.time;
    const before = field.checkpoint(), player = field.player, native = player.native;
    renderer.draw(field); assert.equal(canvas.puts, 1); assert.equal(canvas.getContext().depth, 0);
    assert.equal(field.time, time); assert.equal(field.player, player); assert.equal(player.native, native);
    assert.deepEqual(field.checkpoint(), before);
    return { canvas, renderer, images };
  }
  const worldDraw = await render(game.field), background = bundle.map.actorView.backgrounds[0].texture;
  assert.ok(worldDraw.canvas.calls.some(call => call.file === background.url));
  assert.ok(worldDraw.canvas.calls.some(call => Object.values(game.field.content.map.textures).includes(call.file) && call.file !== background.url));
  assert.ok(worldDraw.renderer.presentationOmissions.some(item => item.kind === "ocean-shader"));
  const missing = new Map(worldDraw.images); missing.delete(background.url);
  const failedCanvas = new Canvas(); assert.throws(() => new Renderer(failedCanvas, game.field.content, missing).draw(game.field));
  assert.equal(failedCanvas.puts, 0);
  const strict = structuredClone(game.field.content); delete strict.developmentProfile.worldMap;
  assert.throws(() => new Renderer(new Canvas(), strict, worldDraw.images).draw(game.field), /框架策略/);
  passed("flat-renderer-consumes-bound-source-textures-and-live-actors-with-explicit-negative-gates");

  // This failure is a real impassable terrain cell, not an authored collider.
  assert.equal(worldTerrainCollisionMask(bundle.map.map.worldTerrain, 1, { x: 85, y: 34 }), 0);
  assert.equal(flow.move("right"), false); ok();
  assert.deepEqual([game.field.player.x, game.field.player.y], [84, 34]);
  assert.deepEqual(game.state.snapshot(), originalOwner);
  passed("source-terrain-rejects-water-step-without-owned-step-or-position-publication");

  let failMedia = false, discarded = 0;
  const loader = new GameMapLoader(flow, repository, { prepare: async field => {
    if (failMedia) throw new Error("controlled map media failure");
    return { mapId: field.content.map.identity.mapId };
  }, discard: () => { discarded++; } });
  async function transition(mapId) {
    assert.equal(game.field.stop?.kind, "map-transition"); assert.equal(game.field.stop.request.mapId, mapId);
    const result = await loader.load();
    assert.equal(result.status, "committed", String(result.error?.stack ?? result.error ?? result.status));
    assert.equal(game.state, originalState); assert.equal(game.world, originalWorld);
    assert.equal(game.field.content.map.identity.mapId, mapId); flow.advance(0, host); dismiss();
  }
  step("up"); assert.equal(game.field.stop?.kind, "map-transition");
  const request = game.field.stop, previousField = game.field, beforeMap = game.state.snapshot();
  failMedia = true; const failed = await loader.load(); assert.equal(failed.status, "failed");
  assert.equal(failed.error.message, "controlled map media failure");
  assert.equal(game.field, previousField); assert.equal(game.field.stop, request);
  assert.deepEqual(game.state.snapshot(), beforeMap); failMedia = false;
  await transition(3); assert.deepEqual([game.field.player.x, game.field.player.y, game.field.player.layer], [38, 61, 1]);
  await render(game.field);
  passed("real-source-exit-media-failure-retry-commits-one-location-entry");

  assert.equal(flow.move("down"), false); ok(); assert.equal(game.field.player.direction, "down");
  assert.ok(flow.confirm()); flow.advance(10, host); await transition(1);
  assert.deepEqual([game.field.player.x, game.field.player.y, game.field.player.layer], [84, 34, 0]);
  assert.deepEqual(game.state.snapshot(), beforeMap); await render(game.field);
  passed("authored-return-interaction-restores-world-terrain-camera-and-same-owned-owner");

  assert.ok(game.field.content.walkEncounters, "World-map walk encounters must be explicitly declared");
  let walking = 0;
  while (!game.field.stop && walking < 20) { step(walking % 2 ? "right" : "left"); walking++; }
  assert.equal(game.field.stop?.kind, "encounter"); assert.deepEqual(game.field.stop.returnTo, { kind: "field-idle" });
  assert.equal(game.field.stop.party, 517); assert.equal(game.battle, null);
  const beforeBattle = game.state.snapshot(), fieldBeforeBattle = game.field;
  const handoff = new GameBattleHandoff(flow, { prepareStart: async () => ({ kind: "battle" }),
    prepareReturn: async () => ({ kind: "field" }), discard: () => {} });
  const entered = await handoff.start();
  assert.equal(entered.status, "committed", String(entered.error?.stack ?? entered.error ?? entered.status));
  const battle = game.battle; assert.ok(battle); flow.advance(0, host);
  let ticks = 0, accepted = 0;
  while (battle.phase === "active" && ticks++ < 30000) {
    for (const actor of battle.ready) {
      const command = battle.commandMenu(actor.id).find(item => item.available && item.kind === "ability" && item.abilityIds.includes(1));
      assert.ok(command, "Actual source owner lacks its ordinary attack command");
      const target = battle.targetChoices(actor.id, 1).find(choice => choice.targetIds.some(id => battle.enemies.some(enemy => enemy.id === id)));
      if (target && commands.command(battle, actor.id, 1, target.selection, command.id)) accepted++;
    }
    flow.advance(10, host); ok();
  }
  assert.equal(battle.phase, "victory", "Unchanged source encounter did not reach victory");
  assert.ok(accepted > 0); assert.deepEqual(game.state.snapshot(), beforeBattle);
  const reward = structuredClone(battle.reward), returned = await handoff.return();
  assert.equal(returned.status, "committed", String(returned.error?.stack ?? returned.error ?? returned.status));
  assert.equal(game.field, fieldBeforeBattle); assert.equal(game.state, originalState); assert.equal(game.world, originalWorld);
  flow.advance(10, host); ok(); assert.equal(game.checkpointReady, true);
  const afterBattle = game.state.snapshot();
  assert.equal(afterBattle.gil, beforeBattle.gil + reward.gil);
  assert.equal(afterBattle.completedBattles.length, beforeBattle.completedBattles.length + 1);
  report.battle = { encounterId: 517, walkingSteps: walking, acceptedCommands: accepted, ticks, reward };
  passed("world-walking-prepared-source-battle-rewards-and-idle-return-on-the-same-field");

  flow.pause(true); assert.ok(commands.menuReady);
  assert.ok(commands.menu({ kind: "change-party", change: { kind: "set-row", position: 0, row: "back" } }));
  const saved = game.checkpoint(), savedDigest = await contentDigest(saved);
  const bytes = new Map(), storage = new CheckpointStorage({ getItem: key => bytes.get(key) ?? null,
    setItem: (key, value) => bytes.set(key, value) }, "framework", "world-travel");
  const ticket = flow.beginOperation("save"), prepared = await storage.prepareSave(saved, game.field.time);
  assert.ok(ticket.isCurrent()); prepared.commit(); assert.ok(ticket.finish());
  const oldCommands = commands, previous = game;
  const restored = await entries.begin("load").prepare(async context => {
    const loaded = await storage.load(); assert.ok(loaded && context.isCurrent());
    const packages = await repository.restoreSessionContent(loaded.checkpoint); assert.ok(context.isCurrent());
    const session = GameSession.restore(loaded.checkpoint, packages.initial, packages.battle, packages.world, runtime);
    return { session, presentation: null, options: { paused: true } };
  });
  assert.equal(restored.status, "committed", String(restored.error?.stack ?? restored.error ?? restored.status));
  game = restored.session; commands = new GameCommands(flow, game); flow.observeHost(host);
  assert.notEqual(game, previous); assert.equal(await contentDigest(game.checkpoint()), savedDigest);
  assert.equal(oldCommands.menu({ kind: "change-party", change: { kind: "set-row", position: 0, row: "front" } }), false);
  assert.ok(commands.menuReady); assert.ok(commands.menu({ kind: "change-party", change: { kind: "set-row", position: 0, row: "front" } }));
  flow.pause(false); flow.advance(0, host); await render(game.field);
  const pos = { x: game.field.player.x, y: game.field.player.y };
  step(pos.x === 83 ? "right" : "left"); assert.notEqual(game.field.player.x, pos.x);
  assert.equal(game.state.snapshot().completedBattles.length, afterBattle.completedBattles.length);
  passed("menu-row-save-repository-restore-new-owner-and-next-world-step-without-replayed-rewards");
  report.result = "passed"; report.checkpointHash = savedDigest; report.urls = [...new Set(urls)];
  report.discardedPresentations = discarded;
  report.generatorHash = createHash("sha256").update(await readFile(new URL(import.meta.url))).digest("hex");
} catch (error) { report.result = "failed"; report.error = error.stack ?? String(error); }
finally { await writeFile(output, JSON.stringify(report, null, 2) + "\n"); }
console.log(JSON.stringify({ result: report.result, stages: stages.length, report: reportFile }));
if (report.result !== "passed") process.exitCode = 1;
