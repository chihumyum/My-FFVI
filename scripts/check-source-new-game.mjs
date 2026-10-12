// Real published source packages through the production fresh-session host.
// Audio readiness and title/UI observations are explicit controlled inputs;
// this is neither a browser playthrough nor original-game dynamic acceptance.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 2 && args[0] === "--compiled-dir"),
  "Use --compiled-dir <directory>");
const compiled = resolve(root, args[1] ?? "dist");
const module = (name) => import(pathToFileURL(resolve(compiled, "src", name + ".js")).href);
const sha = (data) => createHash("sha256").update(data).digest("hex");
const output = resolve(root, "build/reports/source-new-game-check.json");
await mkdir(resolve(root, "build/reports"), { recursive: true });

const report = {
  formatVersion: 1, kind: "source-new-game-session-check", status: "running",
  lane: "real-source-packages-with-controlled-title-ui-and-audio-observations",
  semanticsVerified: false, originalGameExecuted: false, browserExecuted: false,
  gpuShaderParity: false, completeOpening: false, sourceSessionCreated: false,
  packages: [], cases: [],
  controlledInputs: [
    "Ordinary title context after completed cleanup; advertisement opening callback did not start.",
    "An active title fade host with absent callbacks starts from an explicitly clear renderer multiplier.",
    "Verified local packages stand in for completed scene loading and a ready field UI; no browser UI was created.",
    "Audio assets are hash-checked, then the readiness port returns true immediately. No decoder, playback or device timing is measured.",
    "The production session receives fixed 10 ms host updates, with no confirm input, manual movement, source edits or stop reset.",
    "Camera projection uses an explicit 16:9, 108-pixel orthographic viewport; no rendered pixels are compared.",
  ],
  limitations: [
    "The checker executes the first source segment and attempts its requested destination without substituting the development checkpoint.",
    "Ordinary native actor map lifecycle is implemented; destination entity/compositor admission and stable saves remain separate capabilities.",
    "Static source binding and controlled Web execution do not establish original-game timing or visual equivalence.",
  ],
};
let stage = "load-runtime";
let game = null;
let elapsedMs = 0;
const check = (name, fn) => { fn(); report.cases.push({ name, pass: true }); };

try {
  const { verifyContent } = await module("core/content-integrity");
  const { GameSession } = await module("core/game-session");
  const { NewGameFieldEntry } = await module("core/new-game-field-entry");
  const { FieldFadeState } = await module("core/field-fade");
  const { createSourcePresentationContext } = await module("core/source-presentation");
  const { createNewGame } = await module("core/new-game");
  const { fieldCameraCellToWorld } = await module("core/field-camera");
  const { canonical } = await module("core/canonical");
  const readPackage = async (file, expected) => {
    const bytes = await readFile(resolve(root, file));
    const content = await verifyContent(JSON.parse(bytes), expected);
    report.packages.push({ file, contentHash: content.contentHash, fileSha256: sha(bytes) });
    return content;
  };

  stage = "verify-source-packages";
  const content = await readPackage("build/game/source-new-game.json");
  const world = await readPackage("build/world/catalog.json", content.worldCatalogHash);
  const battle = await readPackage("build/game/opening-playable.json", content.battleCatalogHash);
  const indexed = world.maps[String(content.entry.mapId)];
  assert.ok(indexed);
  assert.match(indexed.url, /^\/world\/maps\/[0-9]+\.json$/);
  const map = await readPackage("build" + indexed.url, indexed.contentHash);
  check("current source package identities and entry route agree", () => {
    assert.equal(content.kind, "source-new-game-content-v1");
    assert.equal(content.mapContentHash, map.contentHash);
    assert.equal(map.sourceSetHash, content.sourceSetHash);
    assert.equal(world.sourceSetHash, content.sourceSetHash);
    assert.equal(world.parentSourceSetHash, content.parentSourceSetHash);
    assert.equal(map.parentSourceSetHash, content.parentSourceSetHash);
    assert.equal(map.mapId, 609); assert.equal(content.entry.entrance, 1);
    assert.equal(battle.common.profile, "narshe-playability-v33");
    assert.equal(content.entry.reservedScript.name, "sc_e_0001");
    assert.equal(map.scriptPuppetContexts[content.entry.reservedScript.name].scriptHash,
      content.entry.reservedScript.contentHash);
  });
  report.sourceSetHash = content.sourceSetHash;
  report.parentSourceSetHash = content.parentSourceSetHash;
  report.profile = battle.common.profile;
  report.entry = structuredClone(content.entry);

  const program = map.scripts[content.entry.reservedScript.name];
  const play = program.filter((op) => op.kind === "source-message" && op.command.kind === "play");
  const set = program.filter((op) => op.kind === "position" && op.cameraCommand);
  const motion = program.filter((op) => op.kind === "field-camera-motion");
  assert.equal(play.length, 1); assert.equal(set.length, 1); assert.equal(motion.length, 1);
  const subtitle = play[0], cameraSet = set[0], cameraMotion = motion[0];
  assert.deepEqual(cameraSet.cameraCommand, { kind: "set-position", x: 29, y: 5, layer: 0 });
  assert.deepEqual(cameraMotion.command, { kind: "lerp", x: 29, y: 24, layer: 0, duration: 11, arcHeight: 0 });
  const cameraStart = fieldCameraCellToWorld(map.partyEntry.mapRange,
    { x: cameraSet.cameraCommand.x, y: cameraSet.cameraCommand.y }, 0);
  const cameraEnd = fieldCameraCellToWorld(map.partyEntry.mapRange,
    { x: cameraMotion.command.x, y: cameraMotion.command.y }, 0);

  stage = "verify-audio-readiness-dependencies";
  const audioTracks = new Map(), audioCalls = [];
  for (const id of new Set(program.filter((op) => op.kind === "bgm-ready").map((op) => op.track))) {
    const track = world.bgm?.tracks[id]; assert.ok(track, "Missing source audio readiness dependency " + id);
    assert.match(track.file, /^\/bgm\/tracks\/[a-f0-9]{64}\.[a-z0-9]+$/);
    assert.equal(sha(await readFile(resolve(root, "build" + track.file))), track.sha256);
    audioTracks.set(canonical(track), { id, file: track.file, sha256: track.sha256,
      source: track.source, tableSource: track.tableSource });
  }
  const audioReadiness = { isReady(track) {
    const bound = audioTracks.get(canonical(track));
    assert.ok(bound, "Readiness queried an unverified or changed source track");
    audioCalls.push({ atMs: elapsedMs, track: bound.id, sha256: bound.sha256, ready: true });
    return true;
  } };
  report.audio = { assetBytesVerified: true, decoderExecuted: false, playbackExecuted: false,
    readiness: "controlled-immediate-true", tracks: [...audioTracks.values()], calls: audioCalls };

  stage = "ordinary-title-protocol";
  const presentation = createSourcePresentationContext({ kind: "title-new-game",
    titleCleanupComplete: true, openingCallbackStarted: false });
  const entry = new NewGameFieldEntry(content.entry, presentation);
  const titleFade = new FieldFadeState({ imageColor: { r: 0, g: 0, b: 0, a: 1 },
    rendererColor: { r: 1, g: 1, b: 1, a: 0 }, raycastTarget: false });
  const titleBefore = titleFade.snapshot();
  const start = entry.prepareStart(titleFade, { active: true, callbacks: "absent" });
  assert.deepEqual(titleFade.snapshot(), titleBefore); start.commit();
  let fade = start.fade;
  const phases = [{ phase: entry.phase, effects: start.effects }];
  assert.equal(entry.prepareResume(fade, true), null, "Cached resources do not bypass the title fade");
  for (let frame = 0; frame < 51; frame++) fade.advance(0.01);
  for (const phase of ["scene-loading", "scene-activated", "field-preparing"]) {
    const next = entry.prepareResume(fade, true); assert.ok(next);
    next.commit(); fade = next.fade; assert.equal(entry.phase, phase);
    phases.push({ phase, effects: next.effects });
  }
  report.title = { phases, initialFade: titleBefore, preparedFade: fade.snapshot(),
    sourcePresentation: presentation, controlledSceneAndUiAcknowledgements: true };

  stage = "prepare-fresh-game-session";
  const beforeFade = fade.snapshot(), inputsBefore = canonical({ content, map, battle, world });
  game = GameSession.prepareNewGame(content, world, map, battle, fade, presentation, { audioReadiness });
  report.sourceSessionCreated = true;
  const initial = game.state.snapshot(), plan = createNewGame(battle.gameState.sourceNewGame);
  check("fresh owner retains the complete source initializer without development condition 607", () => {
    assert.equal(initial.formatVersion, 8); assert.equal(initial.initialization, "source-new-game");
    assert.deepEqual(initial.nativeState, { kind: "source-native-state-v1", entrySeed: plan.entry, ...plan.nativeInitialization });
    assert.deepEqual(game.state.fieldPuppetRoster.current(), { owned: [
      { ownedId: 1, sourceId: 1, enabled: true, conditionTypes: [] },
      { ownedId: 2, sourceId: 31, enabled: true, conditionTypes: [] },
      { ownedId: 3, sourceId: 32, enabled: true, conditionTypes: [] },
    ], party: [1, 2, 3, 0] });
    assert.deepEqual(initial.roster.map((member) => member.conditionIds), [[], [], []]);
    assert.deepEqual(initial.equipmentStock, plan.owned.equipmentStock);
    assert.deepEqual(initial.items, plan.owned.items);
    assert.deepEqual(game.battlePreferences, plan.battlePreferences);
  });
  const actors = Object.values(game.field.actors);
  const identities = actors.map((actor) => ({ id: actor.id, actor, entity: actor.native?.entity }));
  const point = map.partyEntry.pointIns.filter((p) => p.id === content.entry.entrance);
  check("source PointIn installs 55 real actor instances and the distinct camera owner", () => {
    assert.equal(point.length, 1); assert.equal(actors.length, 55);
    assert.ok(actors.every((actor) => actor.native));
    assert.equal(game.field.actors[game.field.cameraActorId], undefined);
    assert.deepEqual({ x: game.field.player.x, y: game.field.player.y, layer: game.field.player.layer,
      direction: game.field.player.direction }, { x: 26, y: 7, layer: 0, direction: "up" });
    assert.deepEqual(game.field.player.native.entity.position, { x: 88, y: 136, z: 349 });
    assert.deepEqual(game.field.player.native.entity.position,
      fieldCameraCellToWorld(map.partyEntry.mapRange, { x: point[0].x, y: point[0].y }, point[0].layer));
    assert.equal(game.field.cameraSnapshot.target, "player");
    assert.equal(game.field.entrySynchronized, false);
    assert.equal(game.field.stop, null); assert.equal(game.field.busy, false);
    assert.equal(canonical({ content, map, battle, world }), inputsBefore);
    assert.deepEqual(fade.snapshot(), beforeFade);
  });
  report.prepared = { actorCount: actors.length, ownedFormatVersion: initial.formatVersion,
    initialization: initial.initialization, nativeStateSha256: sha(canonical(initial.nativeState)),
    ownedSha256: sha(canonical(initial)), roster: game.state.fieldPuppetRoster.current(),
    pointIn: point[0], playerPosition: structuredClone(game.field.player.native.entity.position),
    camera: game.field.cameraSnapshot, mapCollisionLayers: Object.keys(map.map.collisions),
    missingCollisionDataNotSynthesized: true, entrySynchronized: game.field.entrySynchronized };

  stage = "launch-reserved-source-script";
  const launch = entry.prepareLaunch(fade, game.newGamePreparation(true));
  assert.equal(launch.launch.scriptName, content.entry.reservedScript.name);
  assert.equal(launch.launch.fallbackBranch, "discard-after-reserved-script");
  game.launchNewGame(launch.launch); launch.commit();
  assert.equal(entry.phase, "launched"); assert.equal(game.field.stop, null);
  check("reserved script runs instead of the initializer or fallback script", () => {
    assert.equal(game.field.cameraSnapshot.target, "dummy");
    assert.deepEqual(game.field.cameraSnapshot.dummy.position, cameraStart);
    assert.equal(game.field.isEntityVisible(game.field.player.id), false);
    assert.equal(game.field.entrySynchronized, false);
    assert.notEqual(launch.launch.scriptName, map.initializer);
    assert.notEqual(launch.launch.scriptName, content.entry.fallbackScript.name);
    assert.equal(audioCalls.length, 1); assert.equal(audioCalls[0].track, 1);
  });
  report.launch = { scriptName: launch.launch.scriptName, scriptContentHash: launch.launch.scriptContentHash,
    fallbackBranch: launch.launch.fallbackBranch, mapInitializer: map.initializer,
    camera: game.field.cameraSnapshot, initialFade: game.field.fader.snapshot() };

  stage = "run-first-source-subtitle-and-camera";
  const viewport = { aspect: 16 / 9, orthographicSize: 108, isClamp: true, effectOffset: { x: 0, y: 0 } };
  const milestones = [], messageTransitions = [];
  const reached = new Set();
  let previousMessage = "", sawText = false, sawClear = false, sawFadeOut = false, sawCameraInterior = false;
  let ownedBeforeStop = initial;
  const capture = (name) => {
    if (reached.has(name)) return;
    reached.add(name);
    milestones.push({ name, atMs: elapsedMs, camera: game.field.cameraSnapshot,
      cameraProjection: game.field.cameraProjection(viewport), fade: game.field.fader.snapshot() });
  };
  capture("source-camera-start");
  while (game.field.stop === null && elapsedMs < 120000) {
    ownedBeforeStop = game.state.snapshot();
    game.advance(10); elapsedMs += 10;
    const message = game.field.sourceMessage.projection;
    const compact = message === null ? null : { key: message.key, phase: message.phase,
      textLength: message.text.length, textSha256: sha(message.text), acceptsInput: message.acceptsInput,
      alignment: message.alignment, anchor: message.anchor, window: message.window };
    if (canonical(compact) !== previousMessage) {
      messageTransitions.push({ atMs: elapsedMs, message: compact }); previousMessage = canonical(compact);
    }
    if (message?.text) {
      assert.equal(message.key, subtitle.command.key);
      assert.equal(message.text, subtitle.command.document.text);
      assert.equal(message.acceptsInput, false);
      sawText = true; capture("first-source-subtitle-visible");
    }
    const alpha = game.field.fade.rendererColor.a;
    if (alpha === 0) { sawClear = true; capture("script-fade-in-clear"); }
    if (sawClear && alpha > 0) { sawFadeOut = true; capture("script-fade-out-started"); }
    if (sawFadeOut && alpha === 1) capture("script-fade-out-opaque");
    const camera = game.field.cameraSnapshot;
    if (camera.dummy.position.y < cameraStart.y && camera.dummy.position.y > cameraEnd.y) {
      sawCameraInterior = true;
      if (elapsedMs >= 5500) capture("source-camera-interior");
    }
    if (canonical(camera.dummy.position) === canonical(cameraEnd)) capture("source-camera-end");
    if (sawText && message === null) capture("source-subtitle-closed");
  }
  report.execution = { elapsedMs, logicalFrames: elapsedMs / 10, messageTransitions, milestones,
    stop: structuredClone(game.field.stop), entrySynchronized: game.field.entrySynchronized,
    finalCamera: game.field.cameraSnapshot, finalFade: game.field.fader.snapshot(),
    finalRoster: game.state.fieldPuppetRoster.current() };
  check("source subtitle, asynchronous camera Lerp and source fades finish before the first blocker", () => {
    assert.ok(sawText && sawClear && sawFadeOut && sawCameraInterior);
    for (const name of ["source-subtitle-closed", "source-camera-end", "script-fade-out-opaque"])
      assert.ok(reached.has(name), name);
    assert.equal(game.field.sourceMessage.projection, null);
    assert.equal(game.field.updateAttributeMask, 3);
    assert.deepEqual(game.field.cameraSnapshot.dummy.position, cameraEnd);
    assert.equal(game.field.fade.rendererColor.a, 1);
  });
  check("the owned condition publishes through native actors and reaches the real next-map instruction", () => {
    const stop = game.field.stop;
    assert.ok(stop, "No explicit stop before the 120-second safety bound");
    assert.equal(stop.kind, "map-transition");
    assert.equal(stop.site.script, content.entry.reservedScript.name);
    assert.equal(stop.site.index, 19); assert.equal(stop.site.kind, "change-map");
    assert.equal(stop.site.source.pointer, "/Mnemonics/19");
    assert.deepEqual(stop.request, { mapId: 3, entrance: 1, continuation: "sc_e_0001_1", birdview: false,
      skipFade: false, skipBgm: true, origin: "script" });
    assert.deepEqual(game.state.snapshot().roster.map((member) => member.conditionIds), [[53], [53], [53]]);
    assert.ok(game.state.fieldPuppetRoster.current().owned.every((member) => canonical(member.conditionTypes) === "[607]"));
    const expected = structuredClone(initial);
    for (const member of expected.roster) member.conditionIds = [53];
    assert.deepEqual(game.state.snapshot(), expected);
    assert.deepEqual(ownedBeforeStop, initial);
    assert.deepEqual(game.field.cameraOffset, { x: 0, y: 16 });
    assert.equal(game.field.player.native.fieldAssetId, 1);
    assert.equal(game.field.player.native.charaZOffset, 0.5);
    assert.equal(game.field.entrySynchronized, false);
    assert.equal(game.battle, null);
  });
  stage = "attempt-source-destination";
  const destination = await readPackage("build/world/maps/3.json", world.maps["3"].contentHash);
  const beforeTransition = { field: game.field, owned: game.state.snapshot(),
    camera: game.field.cameraSnapshot, fade: game.field.fader.snapshot() };
  let transitionFailure = null;
  try { game.world.prepare(world, destination); }
  catch (error) { transitionFailure = error instanceof Error ? error.message : String(error); }
  check("the destination entity gate leaves the condition and old field intact without publishing a partial map", () => {
    assert.equal(transitionFailure, "Destination field-effect particle allocation requires a transactional map lifecycle provider");
    assert.equal(game.field, beforeTransition.field);
    assert.deepEqual(game.state.snapshot(), beforeTransition.owned);
    assert.deepEqual(game.field.cameraSnapshot, beforeTransition.camera);
    assert.deepEqual(game.field.fader.snapshot(), beforeTransition.fade);
    assert.equal(game.world.transitions.length, 0);
  });
  report.destination = { requested: structuredClone(game.field.stop.request), contentHash: destination.contentHash,
    prepared: false, published: false, failure: transitionFailure,
    nativeFoot: destination.nativeFoot, actorViewBlockers: destination.actorViewBlockers };
  check("the running source host preserves actor identities and the unsupported native save boundary", () => {
    for (const entry of identities) {
      assert.equal(game.field.actors[entry.id], entry.actor);
      assert.equal(game.field.actors[entry.id].native.entity, entry.entity);
    }
    assert.equal(game.field.actors[game.field.cameraActorId], undefined);
    assert.equal(game.checkpointReady, false);
    assert.throws(() => game.checkpoint(), /Cannot save/);
    assert.deepEqual(titleFade.snapshot(), titleBefore);
    assert.deepEqual(fade.snapshot(), beforeFade);
    assert.equal(canonical({ content, map, battle, world }), inputsBefore);
  });

  stage = "bind-checker-and-runtime";
  report.implementation = await Promise.all(["core/game-session", "core/source-new-game", "core/game-state",
    "core/world-session", "core/field", "core/field-native-actors", "core/field-camera-host",
    "core/source-message", "core/new-game-field-entry"].map(async (name) => ({
      file: "src/" + name + ".ts", sha256: sha(await readFile(resolve(root, "src", name + ".ts"))),
      compiledSha256: sha(await readFile(resolve(compiled, "src", name + ".js"))),
    })));
  report.checkerSha256 = sha(await readFile(fileURLToPath(import.meta.url)));
  report.status = "pass";
  report.outcome = "source-condition-applied-next-map-requested-destination-explicitly-blocked";
  report.counts = { cases: report.cases.length, actors: actors.length, owners: initial.roster.length,
    verifiedPackages: report.packages.length, audioReadyCalls: audioCalls.length,
    logicalFrames: elapsedMs / 10, messageTransitions: messageTransitions.length, milestones: milestones.length };
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ status: report.status, outcome: report.outcome, ...report.counts,
    elapsedMs, blockedAt: { script: game.field.stop.site.script, index: game.field.stop.site.index,
      reason: transitionFailure }, reportSha256: sha(await readFile(output)),
    semanticsVerified: false, originalGameExecuted: false, browserExecuted: false }));
} catch (error) {
  report.status = "fail";
  report.failure = { stage, message: error instanceof Error ? error.message : String(error),
    elapsedMs, stop: game?.field.stop ?? null };
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.error(JSON.stringify({ status: "fail", ...report.failure, semanticsVerified: false }));
  process.exitCode = 1;
}
