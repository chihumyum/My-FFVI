// Actual source scripts, with the explicit framework presentation derivative.
// Headless title/media acknowledgements are controlled; no original-game oracle.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2), options = new Map();
for (let i = 0; i < args.length; i += 2) {
  assert.ok(["--dist", "--report"].includes(args[i]) && args[i + 1] &&
    !args[i + 1].startsWith("--") && !options.has(args[i]), "Use --dist/--report <path>");
  options.set(args[i], args[i + 1]);
}
const runtime = resolve(root, options.get("--dist") ?? "dist");
const load = (name) => import(pathToFileURL(resolve(runtime, "src/core", name + ".js")));
const [{ GameContentRepository }, { GameSession }, { GameFlow }, { FieldFadeState },
  { NewGameFieldEntry }, { createSourcePresentationContext }, { GameMapLoader }] = await Promise.all([
  load("game-content"), load("game-session"), load("game-flow"), load("field-fade"),
  load("new-game-field-entry"), load("source-presentation"), load("game-map-loader"),
]);
const aliases = { "/game/content.json": "/game/narshe.json", "/game/battle.json": "/game/opening-playable.json",
  "/game/new-game.json": "/game/source-new-game.json" };
const repo = new GameContentRepository(async (url) => {
  assert.match(url, /^\/(game|framework|world)\/[a-zA-Z0-9/_-]+\.json$/);
  return JSON.parse(await readFile(root + "/build" + (aliases[url] ?? url), "utf8"));
}, "framework");
const { content, catalog, map, battle } = await repo.sourceNewGame();
const presentation = createSourcePresentationContext({ kind: "title-new-game",
  titleCleanupComplete: true, openingCallbackStarted: false });
const entry = new NewGameFieldEntry(content.entry, presentation);
const titleFade = new FieldFadeState({ imageColor: { r: 0, g: 0, b: 0, a: 1 },
  rendererColor: { r: 1, g: 1, b: 1, a: 0 }, raycastTarget: false });
const start = entry.prepareStart(titleFade, { active: true, callbacks: "absent" });
start.commit();
let fade = start.fade;
fade.advance(0.51);
while (entry.phase !== "field-preparing") {
  const next = entry.prepareResume(fade, true);
  assert.ok(next); next.commit(); fade = next.fade;
}
const game = GameSession.prepareNewGame(content, catalog, map, battle, fade, presentation,
  { audioReadiness: { isReady: () => true }, soundPresentation: { isPresented: () => true },
    transportationTimestamp: () => "639273600000000000" });
const launch = entry.prepareLaunch(fade, game.newGamePreparation(true));
game.launchNewGame(launch.launch); launch.commit();
const flow = new GameFlow(game), host = { visible: true, mediaReady: true, overlayOpen: false };
flow.start();
const mapLoader = new GameMapLoader(flow, repo, {
  prepare: async field => { assert.notEqual(game.field, field, "Presentation prepares a private map"); },
  discard: () => {},
});
const ownedAtStart = game.state.snapshot(), transitions = [], answers = [], motionSamples = [], transportation = [], sounds = [];
const transportationOffsets = new WeakMap();
const soundOffsets = new WeakMap();
function recordTransportation(field) {
  const offset = transportationOffsets.get(field) ?? 0;
  transportation.push(...field.transportationExecutions.slice(offset).map((entry) => ({
    mapId: field.content.map.identity.mapId, ...entry,
  })));
  transportationOffsets.set(field, field.transportationExecutions.length);
  const soundOffset = soundOffsets.get(field) ?? 0;
  sounds.push(...field.soundExecutions.slice(soundOffset).map(entry => ({
    mapId: field.content.map.identity.mapId, ...entry,
  })));
  soundOffsets.set(field, field.soundExecutions.length);
}
const sampledActors = new Set();
const report = { kind: "framework-source-route-check-v1", result: "running", profile: content.developmentProfile.kind,
  entryHash: content.contentHash, catalogHash: catalog.contentHash, battleHash: battle.contentHash,
  sourceEntryHash: content.developmentProfile.sourceContentHash,
  controlledInputs: ["headless title, field UI and immediately ready audio", "10ms host updates", "automatic dialogue confirm; first displayed choice", "fixed explicit transportation timestamp"],
  omittedEnvironmentEffects: content.developmentProfile.omissions.length,
  originalGameExecuted: false, completeOpening: false, transitions, answers, motionSamples, transportation, sounds };
const output = resolve(root, options.get("--report") ?? "build/reports/framework-source-route-check.json");
let elapsedMs = 0, boundary = null;
try {
  for (; elapsedMs < 120000; elapsedMs += 10) {
    recordTransportation(game.field);
    const stop = game.field.stop;
    if (stop?.kind === "map-transition") {
      const old = game.field, owned = JSON.stringify(game.state.snapshot());
      const result = await mapLoader.load();
      if (result.status === "failed") {
        assert.equal(game.field, old);
        assert.equal(JSON.stringify(game.state.snapshot()), owned);
        boundary = { kind: "map-preparation", request: stop.request, site: stop.site, message: String(result.error) }; break;
      }
      assert.equal(result.status, "committed", "Source route cannot silently cancel a map request");
      transitions.push({ from: old.content.map.identity.mapId, to: result.field.content.map.identity.mapId,
        site: stop.site, omittedEnvironmentEffects: result.field.content.developmentProfile?.omissions.length ?? 0 });
    }
    if (game.field.stop?.kind === "unsupported") { boundary = structuredClone(game.field.stop); break; }
    if (game.battle) { boundary = { kind: "battle", encounter: game.battle.content.encounterId }; break; }
    if (game.field.choice) {
      const choice = game.field.choice;
      assert.equal(flow.choose(choice.id, 0), true); answers.push({ id: choice.id, index: 0 });
    } else if (game.field.dialogue) flow.confirm();
    flow.advance(10, host);
    for (const actor of Object.values(game.field.actors)) {
      const motion = actor.motion, key = `${game.field.content.map.identity.mapId}:${actor.id}`;
      if (!motion || motion.manual || motion.elapsed <= 0 || motion.elapsed >= motion.duration || sampledActors.has(key)) continue;
      sampledActors.add(key);
      motionSamples.push({ mapId: game.field.content.map.identity.mapId, actorId: actor.id,
        elapsedMs, position: { x: actor.x, y: actor.y }, from: motion.from, to: motion.to,
        progressMs: motion.elapsed, durationMs: motion.duration });
    }
    if (game.checkpointReady) { boundary = { kind: "stable-field", mapId: game.field.content.map.identity.mapId }; break; }
  }
  assert.equal(ownedAtStart.initialization, "source-new-game");
  assert.ok(boundary, "Source route did not reach an observable boundary within 120s");
  assert.ok(transitions.length > 0, `The source route must commit its first map handoff: ${JSON.stringify(boundary)}`);
  assert.ok(motionSamples.length > 0, `Source actor movement must actually advance after map handoff: ${JSON.stringify(boundary)}`);
  report.result = "passed";
} catch (error) { report.result = "failed"; throw error; }
finally {
  recordTransportation(game.field);
  Object.assign(report, { elapsedMs, boundary, mapId: game.field.content.map.identity.mapId,
    currentPhase: flow.phase, checkpointReady: game.checkpointReady });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, elapsedMs, transitions: transitions.length,
    mapId: report.mapId, boundary }));
}
