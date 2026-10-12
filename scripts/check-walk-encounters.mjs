// Real local field/party/battle content under an explicit authored walking
// policy. This exercises shared systems, not Narshe's native random table.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { controlledAudioRuntime } from "./controlled-audio.mjs";

const root = resolve(import.meta.dirname, ".."), args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 2 && args[0] === "--compiled-dir");
const compiled = args[1] ?? "dist";
const load = name => import(pathToFileURL(resolve(root, compiled, "src/core", name + ".js")));
const [{ GameSession }, { GameFlow }, { CheckpointStorage }, { verifyContent, contentDigest }] = await Promise.all([
  load("game-session"), load("game-flow"), load("saved-game"), load("content-integrity"),
]);
const source = await verifyContent(JSON.parse(await readFile(resolve(root, "build/game/narshe.json"), "utf8")));
const battle = await verifyContent(JSON.parse(await readFile(resolve(root, "build/game/opening-playable.json"), "utf8")));
const field = structuredClone(source);
field.walkEncounters = { kind: "framework-walk-encounters-v1", id: "controlled-system-walk", minSteps: 2, maxSteps: 2,
  transportationIds: [source.entry.transportationId], parties: [{ partyId: 3, weight: 1 }] };
field.limitations.push("Controlled walking-system probe: every two eligible steps selects party 3; not the source map's random table.");
const { contentHash: _, ...payload } = field; field.contentHash = await contentDigest(payload);
const output = resolve(root, "build/reports/walk-encounters-check.json");
const report = { kind: "walk-encounters-integration-v1", result: "running", stages: [],
  sourceFieldHash: source.contentHash, controlledFieldHash: field.contentHash, battleCatalogHash: battle.contentHash,
  evidence: { lane: "source-content-with-authored-development-policy", browserVerified: false,
    sourceRandomEncountersVerified: false, originalGameExecuted: false, fullGameMigration: false } };
await mkdir(resolve(output, ".."), { recursive: true });
try {
  // Kept in ignored local output for an isolated browser probe. Published
  // source packages and existing browser progress are never overwritten.
  await mkdir(resolve(root, "build/framework/walk-demo"), { recursive: true });
  await writeFile(resolve(root, "build/framework/walk-demo/field.json"), JSON.stringify(field) + "\n");
  const runtime = controlledAudioRuntime(), game = new GameSession(field, battle, 314, runtime);
  const flow = new GameFlow(game), host = { visible: true, mediaReady: true, overlayOpen: false };
  const stage = name => report.stages.push({ name, phase: flow.phase, gil: flow.session.gil,
    position: [flow.session.field.player.x, flow.session.field.player.y], completed: flow.session.completedEncounters });
  flow.start(); flow.advance(0, host);
  const originalField = game.field, player = game.field.player, owned = game.state.snapshot();
  assert.equal(flow.move("up"), true); flow.advance(240, host);
  const saved = game.checkpoint(); assert.equal(saved.walkEncounters.completedSteps, 1);
  const memory = new Map(), storage = new CheckpointStorage({ getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) }, "framework");
  await storage.save(saved, 1);
  const restored = GameSession.restore((await storage.load()).checkpoint, field, battle, undefined, runtime);
  assert.deepEqual(restored.checkpoint(), saved);
  stage("walking-countdown-survives-save-and-restore");
  const replay = new GameFlow(restored); replay.start(); replay.advance(0, host);
  for (const current of [flow, replay]) {
    assert.equal(current.move("down"), true); current.advance(240, host);
    assert.equal(current.phase, "battle");
    assert.equal(current.session.field.stop.returnTo.kind, "field-idle");
    assert.equal(current.session.battle.content.encounterId, 3);
  }
  stage("player-walking-selects-and-opens-shared-battle");
  for (const current of [flow, replay]) {
    for (let n = 0; n < 12000 && current.phase === "battle"; n++) {
      const b = current.session.battle;
      for (const actor of b.ready) {
        const ally = b.players.find(p => p.hp > 0 && p.hp < p.maxHp * 0.6);
        const target = ally ?? b.targets(actor.id, 218)[0];
        if (target) b.command(actor.id, ally ? 222 : 218, target.id);
      }
      current.advance(10, host);
    }
    assert.equal(current.phase, "victory");
    assert.deepEqual(current.session.state.snapshot(), owned, "Rewards are not applied before return");
    assert.equal(current.continueVictory(), true); assert.equal(current.continueVictory(), false);
    assert.equal(current.phase, "exploration");
    assert.ok(current.session.gil > owned.gil);
  }
  assert.equal(game.field, originalField); assert.equal(game.field.player, player);
  assert.deepEqual([player.x, player.y], [38, 49]);
  assert.deepEqual(restored.checkpoint(), game.checkpoint());
  assert.deepEqual(game.field.eventState.snapshot(), saved.world.field.eventState, "No story continuation or flag changes");
  stage("real-rewards-growth-and-same-field-return-once");
  flow.pause(true); flow.advance(60000, host);
  assert.equal(game.checkpointReady, true); assert.equal(game.menuReady, true);
  const end = game.checkpoint(); await storage.save(end, 2);
  const final = GameSession.restore((await storage.load()).checkpoint, field, battle, undefined, runtime);
  assert.deepEqual(final.checkpoint(), end);
  flow.pause(false); flow.advance(0, host); assert.equal(flow.move("up"), true); flow.advance(240, host);
  assert.equal(flow.phase, "exploration");
  assert.equal(game.checkpoint().walkEncounters.completedSteps, 3);
  stage("menu-save-load-and-next-walk");
  report.result = "passed";
} catch (error) { report.result = "failed"; report.error = String(error.stack ?? error); throw error; }
finally { await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, stages: report.stages.length, report: output })); }
