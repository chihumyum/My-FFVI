// Actual source scripts, with the explicit framework presentation derivative.
// Headless title/media acknowledgements are controlled; no original-game oracle.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runtimeDigest } from "./runtime-digest.mjs";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2), options = new Map();
for (let i = 0; i < args.length; i += 2) {
  assert.ok(["--dist", "--report", "--content", "--max-elapsed-ms"].includes(args[i]) && args[i + 1] &&
    !args[i + 1].startsWith("--") && !options.has(args[i]),
  "Use --dist/--report/--content <path> or --max-elapsed-ms <positive multiple of 10>");
  options.set(args[i], args[i + 1]);
}
// Long source cutscenes use the same clock as ordinary play. A budget is a
// host bound, never permission to skip a source wait or advance a task's PC.
const maxElapsedMs = Number(options.get("--max-elapsed-ms") ?? 600000);
assert.ok(Number.isSafeInteger(maxElapsedMs) && maxElapsedMs >= 10 && maxElapsedMs <= 3600000 &&
  maxElapsedMs % 10 === 0, "Source route budget must be a multiple of 10ms between 10ms and one hour");
const runtime = resolve(root, options.get("--dist") ?? "dist");
const load = (name) => import(pathToFileURL(resolve(runtime, "src/core", name + ".js")));
const [{ GameContentRepository }, { GameSession }, { GameFlow }, { FieldFadeState },
  { NewGameFieldEntry }, { createSourcePresentationContext }, { GameMapLoader },
  { createWebFieldMessageSequencePort }] = await Promise.all([
  load("game-content"), load("game-session"), load("game-flow"), load("field-fade"),
  load("new-game-field-entry"), load("source-presentation"), load("game-map-loader"), load("source-message-sequence"),
]);
const appBytes = await readFile(resolve(root, "apps/game/app.js"));
assert.match(appBytes.toString(), /import \{ createWebFieldMessageSequencePort \} from "\/runtime\/core\/source-message-sequence\.js"/);
assert.match(appBytes.toString(), /sourceMessageSequence: createWebFieldMessageSequencePort\(\)/);
const policyModuleSha256 = createHash("sha256").update(await readFile(resolve(runtime, "src/core/source-message-sequence.js"))).digest("hex");
const directory = resolve(root, options.get("--content") ?? "build/content-packages");
const consumed = new Map(), runtimeSha256 = await runtimeDigest(root, runtime);
const read = async url => {
  assert.match(url, /^\/content-packages\/[a-zA-Z0-9/_-]+\.json$/);
  const path = resolve(directory, url.slice("/content-packages/".length));
  const bytes = await readFile(path);
  consumed.set(path, bytes);
  return JSON.parse(bytes);
};
const refs = await read("/content-packages/framework.json");
const repo = new GameContentRepository(read, "framework", refs);
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
const sourceMessageSequence = createWebFieldMessageSequencePort();
const messageContext = sourceMessageSequence.prepare().context;
const game = GameSession.prepareNewGame(content, catalog, map, battle, fade, presentation,
  { sourceMessageSequence, audioReadiness: { isReady: () => true }, soundPresentation: { isPresented: () => true },
    transportationTimestamp: () => "639273600000000000" });
const launch = entry.prepareLaunch(fade, game.newGamePreparation(true));
game.launchNewGame(launch.launch); launch.commit();
const flow = new GameFlow(game), host = { visible: true, mediaReady: true, overlayOpen: false };
flow.start();
const mapLoader = new GameMapLoader(flow, repo, {
  prepare: async field => { assert.notEqual(game.field, field, "Presentation prepares a private map"); },
  discard: () => {},
});
const ownedAtStart = game.state.snapshot(), transitions = [], answers = [], confirms = [], motionSamples = [], transportation = [], sounds = [];
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
  acceptanceScope: "bounded source boundary probe; passing does not complete the opening or campaign",
  maxElapsedMs,
  runtimeSha256, contentRefs: refs, messageContext, policyModuleSha256, messagePolicy: "createWebFieldMessageSequencePort (same production module as app)", sourceCampaignComplete: false, browserVerified: false,
  entryHash: content.contentHash, catalogHash: catalog.contentHash, battleHash: battle.contentHash,
  sourceEntryHash: content.developmentProfile.sourceContentHash,
  controlledInputs: ["headless title, field UI and immediately ready audio", "10ms host updates", "automatic dialogue confirm; first displayed choice", "fixed explicit transportation timestamp"],
  omittedEnvironmentEffects: content.developmentProfile.omissions.length,
  originalGameExecuted: false, completeOpening: false, transitions, answers, confirms, motionSamples, transportation, sounds };
const output = resolve(root, options.get("--report") ?? "build/reports/framework-source-route-check.json");
let elapsedMs = 0, boundary = null;
try {
  for (; elapsedMs < maxElapsedMs; elapsedMs += 10) {
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
    } else if (game.field.dialogue || game.field.sourceMessage.projection?.acceptsInput) {
      const before = { dialogue: game.field.dialogue, source: game.field.sourceMessage.projection };
      const accepted = flow.confirm();
      confirms.push({ elapsedMs, mapId: game.field.content.map.identity.mapId, accepted,
        before, after: { dialogue: game.field.dialogue, source: game.field.sourceMessage.projection } });
    }
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
  assert.ok(boundary, `Source route exhausted its ${maxElapsedMs}ms host budget before an observable boundary`);
  assert.ok(transitions.length > 0, `The source route must commit its first map handoff: ${JSON.stringify(boundary)}`);
  assert.ok(motionSamples.length > 0, `Source actor movement must actually advance after map handoff: ${JSON.stringify(boundary)}`);
  for (const [path, bytes] of consumed) assert.ok((await readFile(path)).equals(bytes), "Published source route input changed");
  assert.equal(await runtimeDigest(root, runtime), runtimeSha256, "Runtime changed during source route execution");
  report.result = "passed";
} catch (error) { report.result = "failed"; throw error; }
finally {
  recordTransportation(game.field);
  Object.assign(report, { elapsedMs, boundary, mapId: game.field.content.map.identity.mapId,
    currentPhase: flow.phase, checkpointReady: game.checkpointReady,
    budgetExhausted: boundary === null && elapsedMs >= maxElapsedMs });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, elapsedMs, transitions: transitions.length,
    mapId: report.mapId, boundary }));
}
