// Complete selected-area source bindings and controlled shared actor lifecycle.
// This never grants source-story reachability, Unity controller parity or GPU acceptance.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runtimeDigest } from "./runtime-digest.mjs";

const root = fileURLToPath(new URL("..", import.meta.url)), options = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i];
  assert.ok(!options.has(key) && ["--compiled-dir", "--content-dir", "--report"].includes(key) &&
    process.argv[i + 1] && !process.argv[i + 1].startsWith("--"), "Use --compiled-dir/--content-dir/--report <path>");
  options.set(key, process.argv[++i]);
}
const compiled = resolve(root, options.get("--compiled-dir") ?? "dist"),
  contentDir = resolve(root, options.get("--content-dir") ?? "build/content-packages"),
  output = resolve(root, options.get("--report") ?? "build/reports/field-npc-activity-check.json"),
  load = name => import(pathToFileURL(resolve(compiled, name + ".js"))),
  sha = bytes => createHash("sha256").update(bytes).digest("hex"),
  read = async path => JSON.parse(await readFile(path, "utf8")),
  declarations = { kind: "framework-npc-area-declaration-v1", policy: "framework-npc-area-v1",
    missingFirstInterval: "source-ctor-true", random: "web-xorshift32-v1",
    collision: "actor-grid-reservations-v1", schedule: "fixed-step-source-order-v1",
    takeover: "pause-autonomous-motion-v1" };
const report = { kind: "field-npc-activity-check-v1", result: "running", areaId: 8,
  sourceStory: "unassessed", originalGameExecuted: false, browserVerified: false, nativeParity: false,
  gpuVerified: false, cases: [], limitations: [
    "The complete 56-map area and 36 physical Area NPC declarations are source inventory, not story reachability",
    "Every original controller, dialogue, event, media and presentation diagnostic remains visible",
    "Published sidecars select explicit Web RNG, ordering, grid collision, takeover and missing-first-interval policies",
    "Factory readiness requires the actual selected map presentation and media; blocked maps are not given synthetic views",
    "Controlled lifecycle combines original NPC parameters and media with a declared synthetic persistent party and collision outcome",
    "The controlled runner exercises shared candidates, Actor.motion and joint codecs directly; it is not a Field/Flow story replay",
    "Source visual idling, Unity random order, native physics and exact native PauseMove/ResumeMove remain unverified",
  ] };
await mkdir(dirname(output), { recursive: true });

try {
  const [corpusApi, compiler, npc, activity, nativeActors, nativeCodec, activityCodec, factoryApi,
    camera, views, worldCompiler, integrity, fixture, motion, animationApi, hostApi, dependencies] = await Promise.all([
    "src/compiler/corpus", "src/compiler/field-npc-activity", "src/core/field-native-npc",
    "src/core/field-npc-activity", "src/core/field-native-actors", "src/core/field-native-checkpoint",
    "src/core/field-npc-activity-checkpoint", "src/core/field-actor-factory", "src/core/field-camera",
    "src/core/field-actor-view", "src/compiler/world", "src/core/content-integrity",
    "tests/fixtures/field-actor-factory", "src/core/field-script-motion", "src/core/actor-animation",
    "src/core/field-npc-activity-host", "src/compiler/content-dependencies",
  ].map(load));
  const runtimeHash = await runtimeDigest(root, compiled); report.runtimeHash = runtimeHash;
  const refs = await read(resolve(contentDir, "south-figaro-area.json")),
    manifestBytes = await readFile(resolve(contentDir, "south-figaro-area/manifest.json")), manifest = JSON.parse(manifestBytes),
    buildBytes = await readFile(resolve(contentDir, "south-figaro-area/build-report.json")), build = JSON.parse(buildBytes),
    world = await integrity.verifyContent(await read(resolve(contentDir, "south-figaro-area/world.json")), refs.world.contentHash);
  assert.deepEqual(manifest.contentRefs, refs); assert.deepEqual(build.refs, refs);
  const ids = [...Array(28)].flatMap((_, i) => [38 + i, 219 + i]).sort((a, b) => a - b);
  assert.deepEqual(manifest.mapIds.slice().sort((a, b) => a - b), ids);
  const maps = await Promise.all(ids.map(async id => integrity.verifyContent(
    await read(resolve(contentDir, `south-figaro-area/maps/${id}.json`)), world.maps[id].contentHash)));
  const corpus = await corpusApi.loadCorpus(root);
  assert.equal(world.sourceSetHash, corpus.sourceSetHash);
  assert.equal(world.parentSourceSetHash, corpus.manifest.parentSourceSetHash);
  report.sourceSetHash = corpus.sourceSetHash; report.parentSourceSetHash = corpus.manifest.parentSourceSetHash;
  const inventories = maps.map(map => compiler.compileFieldNpcActivitySources(corpus, map.mapId)),
    sourceRecords = inventories.flatMap(inventory => inventory.definitions),
    sourceKey = source => JSON.stringify([source.file, source.assetPath, source.serializedFile, source.objectId, source.pointer]);
  assert.equal(sourceRecords.length, 36); assert.equal(new Set(sourceRecords.map(source => sourceKey(source.source))).size, 36);
  assert.equal(inventories.reduce((sum, inventory) => sum + inventory.counts.blocked, 0), 0);
  const activityMaps = inventories.filter(inventory => inventory.definitions.length).map(inventory => inventory.mapId);
  assert.deepEqual(activityMaps, [38, 39, 42, 44, 56, 59, 61, 62, 219, 220, 223, 225, 237, 242]);
  const histogram = (values, key) => values.reduce((counts, item) => {
    const name = String(key(item)); counts[name] = (counts[name] ?? 0) + 1; return counts;
  }, {});
  report.content = { worldHash: world.contentHash, manifestSha256: sha(manifestBytes), buildReportSha256: sha(buildBytes),
    mapCount: maps.length, pointIns: maps.reduce((sum, map) => sum + (map.partyEntry?.pointIns.length ?? 0), 0),
    diagnosticCount: build.diagnostics.length, diagnosticCodes: histogram(build.diagnostics, item => item.code),
    sourceMapPins: build.sourceInputs.maps, runtimeAdmission: build.runtimeAdmission };
  assert.equal(report.content.pointIns, 135); assert.equal(build.runtimeAdmission, "unassessed");
  const independentInteractions = sourceRecords.filter(source => source.sourceBlockers.some(reason =>
    !["Native NPC autonomous movement controller is unresolved", "Unsupported NPC movement controller 2"].includes(reason)));
  assert.equal(independentInteractions.length, 5);
  report.inventory = { physicalObjects: 36, maps: activityMaps, definitions: sourceRecords,
    firstInterval: histogram(sourceRecords, source => source.parameters.firstIntervalPresent ? "explicit" : "missing"),
    sourceSpeedIds: histogram(sourceRecords, source => source.parameters.sourceSpeedId),
    independentInteractions: independentInteractions.map(source => ({ mapId: source.mapId, group: source.group,
      entityId: source.entityId, source: source.source, blockers: source.sourceBlockers })) };
  report.cases.push({ name: "whole-area-source-identity-and-complete-unknown-diagnostics", result: "passed", maps: 56, npcs: 36 });

  const mediaBytes = await readFile(resolve(root, "build/world-media/media.json")), media = JSON.parse(mediaBytes),
    mediaSnapshot = await read(resolve(root, "build/world-media/snapshot.json"));
  assert.equal(mediaSnapshot.files.find(file => file.file === "media.json").sha256, sha(mediaBytes));
  assert.equal(media.parentSourceSetHash, corpus.sourceSetHash);
  const { hash, canonical } = await load("src/compiler/content");
  assert.equal(hash(media.sources), media.sourceSetHash);
  const checkedSources = new Set(), checkedSprites = new Set(), characters = {}, mediaIssues = [];
  const checkSource = source => {
    assert.equal(corpus.manifest.sources.find(item => item.file === source.file)?.sha256, source.sha256);
    if (checkedSources.has(source.file)) return;
    assert.equal(sha(readFileSync(resolve(root, "build/runtime/game", source.file))), source.sha256);
    checkedSources.add(source.file);
  };
  for (const source of sourceRecords) {
    checkSource(source.source); checkSource(source.areaReferences[0].source);
    const definition = source.nativeFactory, name = definition.asset.asset;
    if (characters[name]) continue;
    const raw = media.characters[name]; assert.ok(raw, "Missing actual source NPC media: " + name);
    checkSource(raw.animation.source);
    assert.ok(raw.animation.source.assetPath.endsWith("/" + definition.asset.animationAsset + "/anim_info.json"));
    const result = worldCompiler.compileWorldCharacter(raw, (file, digest) => {
      assert.ok(file.startsWith("sprites/") && !file.includes(".."));
      if (checkedSprites.has(file)) return;
      assert.equal(sha(readFileSync(resolve(root, "build/world-media", file))), digest);
      assert.equal(mediaSnapshot.files.find(item => item.file === file)?.sha256, digest); checkedSprites.add(file);
    });
    characters[name] = result.character; mediaIssues.push(...result.issues.map(issue => ({ asset: name, ...issue })));
    assert.equal(canonical(characters[name]), canonical(world.characters[name]));
  }
  const { compileFieldActorFactory } = await load("src/compiler/field-actor-factory"),
    { compileFieldNativeNpcStandby } = await load("src/compiler/field-native-npc"),
    factory = compileFieldActorFactory(corpus.manifest.sources), standby = npc.fieldNativeNpcStandbyPosition(
      compileFieldNativeNpcStandby(corpus.manifest.sources));
  report.media = { assets: Object.keys(characters).length, spriteFiles: checkedSprites.size,
    originalFiles: checkedSources.size, mediaSha256: sha(mediaBytes), issues: mediaIssues };
  report.cases.push({ name: "actual-mapobject-media-and-original-source-digests", result: "passed", ...report.media, issues: mediaIssues.length });

  const template = build.npcActivity?.template ?? { ...declarations, reason: "Prepublication controlled preparation; no source story grant" };
  const derived = new Map(sourceRecords.map(source => [sourceKey(source.source), compiler.deriveFrameworkNpcActivity(source,
    { ...template, kind: declarations.kind, sourceHash: source.contentHash })]));
  report.preparations = [];
  const prepared = [];
  for (const inventory of inventories.filter(item => item.definitions.length)) {
    const map = maps.find(map => map.mapId === inventory.mapId), presentation = map.frameworkPresentation;
    if (!presentation) {
      const reason = build.presentations.find(item => item.mapId === map.mapId)?.reason ?? "Missing trusted map presentation";
      report.preparations.push(...inventory.definitions.map(source => ({ mapId: map.mapId, group: source.group,
        entityId: source.entityId, source: source.source, definitionHash: derived.get(sourceKey(source.source)).program.definitionHash,
        status: "blocked", provider: "map-presentation", reason })));
      continue;
    }
    const { view, composition } = presentation, providers = { mapRenderContext: view.contextId,
      transportationType: "unknown", footAttribute: () => null, upperTexture: composition.upperTexture,
      ceilTexture: composition.ceilTexture, composition, applyViewProperties: layer => views.projectFieldActorView(view, layer) };
    for (const group of new Set(inventory.definitions.map(source => source.group))) {
      const bindings = inventory.definitions.filter(source => source.group === group).map(source => derived.get(sourceKey(source.source))),
        input = { definitions: bindings.map(binding => binding.definition), factory, characters,
          mapRange: inventory.mapRange, providers, existingActorIds: [], activityPolicy: declarations.policy, standbyAnchorPosition: standby },
        candidate = npc.prepareFieldNativeNpcGroup(input), actors = candidate.actors.map(data =>
          nativeActors.createNativeFieldActorProjection(data, inventory.mapRange, { assets: {} }));
      assert.deepEqual(npc.fieldNativeNpcRetirement(candidate.actors), bindings.map(binding => binding.definition.entityId));
      for (const [index, binding] of bindings.entries()) {
        const actor = actors[index], inArea = activity.fieldNpcAreaContains(binding.program.moveArea,
          { x: actor.native.entity.position.x, y: actor.native.entity.position.y }),
          readiness = { mapId: map.mapId, group, entityId: actor.id, source: binding.source.source,
            definitionHash: binding.program.definitionHash, status: inArea ? "prepared" : "blocked",
            sourcePosition: { ...actor.native.entity.position }, moveArea: binding.program.moveArea,
            ...(inArea ? {} : { provider: "return-to-area", reason: "Original starting position needs an explicit return-to-area provider" }) };
        for (const direction of ["up", "right", "down", "left"]) {
          const playback = actor.animation.clone(); playback.move(direction, activity.sourceNpcSecondsPerCell(binding.program.sourceSpeedEnum)); playback.frame();
        }
        assert.equal(actor.animation, actor.native.entity.animation);
        report.preparations.push(readiness);
        if (inArea) prepared.push({ binding, actor, providers, mapRange: inventory.mapRange, map, input, candidate });
      }
    }
  }
  report.providerReadiness = { prepared: prepared.length, blocked: report.preparations.filter(item => item.status === "blocked").length,
    blockedByProvider: histogram(report.preparations.filter(item => item.status === "blocked"), item => item.provider) };
  assert.equal(report.preparations.length, 36); assert.ok(prepared.length > 0);
  report.cases.push({ name: "shared-native-factory-and-area-readiness-with-blocked-presentations-retained", result: "passed",
    ...report.providerReadiness });

  // The actual source actor is never replaced by a controller-owned position.
  const chosen = prepared.find(item => item.binding.source.sourceBlockers.length === 2) ?? prepared[0],
    { binding, actor, providers, mapRange } = chosen, program = binding.program;
  let state = activity.createNpcActivity(program, { generation: 1,
    seed: Math.max(1, Number.parseInt(program.definitionHash.slice(0, 8), 16)), initialDelayMs: 0 }), ticket = null;
  const delta = { up: { x: 0, y: -1 }, right: { x: 1, y: 0 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 } };
  const hostInput = () => ({ worldPosition: { x: actor.native.entity.position.x, y: actor.native.entity.position.y },
    direction: actor.direction, motionActive: actor.motion !== null, dtMs: 10, updateMask: 2,
    destinations: Object.fromEntries(Object.entries(delta).map(([direction, offset]) => [direction,
      camera.fieldCameraCellToWorld(mapRange, { x: actor.x + offset.x, y: actor.y + offset.y }, program.layer)])) });
  // Strip native Z from the point-only pure-controller protocol.
  const input = () => { const next = hostInput(); next.destinations = Object.fromEntries(Object.entries(next.destinations)
    .map(([direction, point]) => [direction, { x: point.x, y: point.y }])); return next; };
  let proposal, currentInput;
  for (let i = 0; i < 1000; i++) {
    currentInput = input(); proposal = activity.prepareNpcActivity(program, state, currentInput);
    if (proposal.intent) break;
    state = activity.settleNpcActivity(program, proposal, "idle", state, currentInput).state;
  }
  assert.ok(proposal.intent, "Actual NPC parameters did not produce an in-area intent");
  const actorValue = value => canonical({ position: value.native.entity.position, direction: value.direction,
    motion: value.motion, steps: value.steps, animation: value.animation.snapshot() });
  const before = actorValue(actor), stateBefore = canonical(state), actorIdentity = actor, entityIdentity = actor.native.entity;
  assert.throws(() => actor.animation.clone().play("controlled-missing-animation", false, 1), /Missing actor animation|animation/i);
  assert.equal(actorValue(actor), before); assert.equal(canonical(state), stateBefore);
  assert.throws(() => activity.settleNpcActivity(program, structuredClone(proposal), "started", state, currentInput), /foreign|Stale/);
  report.cases.push({ name: "source-parameter-proposal-and-media-failure-publish-no-partial-pose-or-rng", result: "passed",
    mapId: chosen.map.mapId, group: binding.definition.group, entityId: actor.id, source: binding.source.source });
  const secondsPerCell = activity.sourceNpcSecondsPerCell(program.sourceSpeedEnum), direction = proposal.intent.direction,
    playback = actor.animation.clone(); playback.move(direction, secondsPerCell); playback.frame();
  const candidateMotion = { from: { x: actor.x, y: actor.y }, to: { x: actor.x + delta[direction].x, y: actor.y + delta[direction].y },
    elapsed: 0, duration: secondsPerCell * 1000, manual: false },
    settlement = activity.settleNpcActivity(program, proposal, "started", state, currentInput);
  state = settlement.state; ticket = settlement.ticket;
  actor.direction = direction; actor.animation = playback; actor.motion = candidateMotion;
  const tick = value => { const next = motion.prepareFieldActorMotionTick(value.motion, value.animation, 10);
    value.x = next.point.x; value.y = next.point.y; value.motion = next.motion; value.animation = next.animation;
    if (next.completedSegment) value.steps++; };
  tick(actor); assert.ok(actor.motion);
  const pausedMotion = actor.motion, pausedPlayback = actor.animation, pausedValue = actorValue(actor),
    acquisition = activity.acquireNpcActivity(program, state, "controlled-source-interaction");
  state = acquisition.state;
  assert.throws(() => activity.completeNpcActivity(program, state, ticket), /paused|Stale/);
  assert.throws(() => activityCodec.captureFieldNpcActivities({ [actor.id]: { program, state, actor } }), /Event-held/);
  for (let i = 0; i < 5; i++) { const pausedInput = input(), p = activity.prepareNpcActivity(program, state, pausedInput);
    assert.equal(p.intent, null); state = activity.settleNpcActivity(program, p, "idle", state, pausedInput).state; }
  assert.equal(actor.motion, pausedMotion); assert.equal(actor.animation, pausedPlayback); assert.equal(actorValue(actor), pausedValue);
  const resumed = activity.releaseNpcActivity(program, state, acquisition.lease), oldTicket = ticket;
  state = resumed.state; ticket = resumed.ticket;
  assert.throws(() => activity.completeNpcActivity(program, state, oldTicket), /Stale/);
  assert.equal(actorValue(actor), pausedValue); assert.equal(actor, actorIdentity); assert.equal(actor.native.entity, entityIdentity);
  report.cases.push({ name: "same-motion-event-takeover-pauses-and-resumes-with-reticketed-authority", result: "passed" });

  const persistent = fixture.fieldActorFactoryFixture(), allCharacters = { ...persistent.characters, ...characters },
    controlledProviders = { ...providers, transportationType: 1, footAttribute: () => 0 },
    persistentCandidate = factoryApi.createFieldActorFactoryCandidate({ ...persistent.input, factory,
      characters: allCharacters, providers: controlledProviders }),
    owner = Object.fromEntries(nativeActors.createNativeFieldActorProjections(persistentCandidate, mapRange,
      persistent.partyCatalog).map(value => [value.id, value]));
  assert.ok(!Object.hasOwn(owner, actor.id)); owner[actor.id] = actor;
  const metadata = activityCodec.captureFieldNpcActivities({ [actor.id]: { program, state, actor } }),
    restoredMetadata = activityCodec.restoreFieldNpcActivities({ [actor.id]: program }, JSON.parse(JSON.stringify(metadata)), { generation: 2 }),
    context = { mapRange, bindings: persistentCandidate.bindings, factory, partyCatalog: persistent.partyCatalog,
      partyCheckpoint: persistent.entry.checkpoint, characters: allCharacters, npcs: [binding.definition], providers: controlledProviders,
      autonomousMotions: restoredMetadata.autonomousMotions },
    nativeSave = nativeCodec.captureFieldNativeCheckpoint(owner, context), nativeBytesBefore = canonical(nativeSave);
  assert.equal(nativeSave.kind, "native-field-actors-checkpoint-v2");
  const look = animationApi.ActorAnimation.prototype.look, cue = animationApi.ActorAnimation.prototype.cue, random = Math.random;
  const forbidden = () => { throw new Error("Joint restore must not run Init/Look/Cue/random"); };
  let restoredActors;
  animationApi.ActorAnimation.prototype.look = forbidden; animationApi.ActorAnimation.prototype.cue = forbidden; Math.random = forbidden;
  try { restoredActors = nativeCodec.restoreFieldNativeCheckpoint(JSON.parse(JSON.stringify(nativeSave)), context); }
  finally { animationApi.ActorAnimation.prototype.look = look; animationApi.ActorAnimation.prototype.cue = cue; Math.random = random; }
  const restored = restoredActors.find(value => value.id === actor.id), newState = restoredMetadata.activities[actor.id].state,
    newTicket = restoredMetadata.activities[actor.id].ticket;
  assert.notEqual(restored, actor); assert.notEqual(restored.native.entity, actor.native.entity);
  assert.equal(actorValue(restored), actorValue(actor)); assert.equal(newState.rngDraws, state.rngDraws);
  assert.equal(newState.rngState, state.rngState); assert.equal(newState.waitMs, state.waitMs);
  assert.throws(() => activity.completeNpcActivity(program, newState, ticket), /Stale/);
  assert.equal(canonical(nativeCodec.captureFieldNativeCheckpoint(Object.fromEntries(restoredActors.map(value => [value.id, value])), context)), nativeBytesBefore);
  while (actor.motion) { tick(actor); tick(restored); assert.equal(actorValue(restored), actorValue(actor)); }
  state = activity.completeNpcActivity(program, state, ticket);
  const continuedState = activity.completeNpcActivity(program, newState, newTicket);
  for (const key of ["rngState", "rngDraws", "waitMs", "direction", "remainingSteps", "commandId", "pending", "holder"])
    assert.deepEqual(continuedState[key], state[key]);
  assert.equal(canonical(nativeSave), nativeBytesBefore);
  assert.throws(() => activity.completeNpcActivity(program, state, ticket), /Stale/);
  report.controlledLifecycle = { mapId: chosen.map.mapId, group: binding.definition.group, entityId: actor.id,
    source: binding.source.source, definitionHash: program.definitionHash, collision: "explicit-started-one-cardinal-cell",
    initialDelayMs: 0, persistentParty: "declared-synthetic-factory-fixture", persistentPlayerProviders: "controlled-walking-uniform-zero",
    sourceSpeedEnum: program.sourceSpeedEnum,
    secondsPerCell, nativeCheckpointKind: nativeSave.kind, oldTicketRejected: true,
    noInitOnRestore: true, originalActorIdentityPreserved: true, motionAndPositionSingleOwner: true };
  report.cases.push({ name: "joint-native-and-controller-save-restores-progress-without-initialization-or-random-draws", result: "passed" });

  // Publication acceptance is last, so prepublication diagnostics can still
  // retain the independent source/factory/control evidence above.
  assert.equal(build.recipeKind, "initialized-source-map-recipe-v4", "Current publication lacks the selected NPC host recipe");
  assert.equal(build.npcActivity.nativeRulesVerified, false);
  assert.deepEqual(build.npcActivity.counts, { maps: 56, declared: 36, derived: 36, blocked: 0 });
  let workPlanBytes = null;
  try { workPlanBytes = await readFile(resolve(contentDir, "source-batches/work-plan.json")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (contentDir === resolve(root, "build/content-packages")) assert.ok(workPlanBytes,
    "The public collection requires its runtime-bound source work plan");
  if (workPlanBytes) {
    const workPlan = await integrity.verifyContent(JSON.parse(workPlanBytes)),
      batch = workPlan.batches.find(item => item.packageId === "south-figaro-area");
    assert.equal(workPlan.runtimeSha256, runtimeHash, "NPC check and public collection use different runtimes");
    assert.ok(batch); assert.equal(batch.recipeSha256, build.recipeSha256);
    assert.equal(batch.work.contentHashes.world, world.contentHash);
    for (const map of maps) assert.equal(batch.work.contentHashes["map:" + map.mapId], map.contentHash);
    report.publicationRuntime = { status: "bound", workPlanSha256: sha(workPlanBytes), runtimeHash };
  } else report.publicationRuntime = { status: "unassessed", reason: "Private area candidate has no whole-collection runtime receipt" };
  const strictMaps = [];
  report.groupAdmission = [];
  for (const map of maps) {
    const inventory = inventories.find(item => item.mapId === map.mapId), sidecar = map.frameworkNpcActivity;
    assert.ok(sidecar); assert.equal(sidecar.nativeRulesVerified, false);
    assert.equal(sidecar.sourceMapHash, map.developmentProfile.sourceContentHash);
    assert.equal(sidecar.bindings.length, inventory.definitions.length);
    for (const actual of sidecar.bindings) assert.equal(canonical(actual), canonical(derived.get(sourceKey(actual.source.source))));
    const builtInventory = build.npcActivity.maps.find(item => item.mapId === map.mapId);
    assert.ok(builtInventory); assert.equal(canonical(builtInventory.sources), canonical(inventory.definitions));
    assert.deepEqual(builtInventory.counts, { ...inventory.counts, derived: inventory.definitions.length });
    const hostBindings = hostApi.bindFieldNpcActivities({ ...map, sourceSetHash: world.sourceSetHash,
      parentSourceSetHash: world.parentSourceSetHash });
    assert.equal(hostBindings.size, inventory.definitions.length);
    const sourceMap = await integrity.verifyContent(await read(resolve(contentDir, `source/maps/${map.mapId}.json`)),
      sidecar.sourceMapHash);
    const { contentHash: _, developmentProfile: __, frameworkPresentation: ___, frameworkNpcActivity: ____,
      walkEncounters: _____, frameworkWalkBinding: ______, ...retained } = map;
    const { contentHash: sourceHash, ...sourceBody } = sourceMap;
    assert.equal(canonical(retained), canonical(sourceBody)); assert.equal(sourceMap.developmentProfile, undefined);
    for (const group of new Set(inventory.definitions.map(source => source.group))) {
      const original = sourceMap.map.groups[group], remaining = hostApi.fieldNpcGroupBlockers(original, sidecar);
      assert.deepEqual(remaining, original.blockers.filter(blocker => blocker.reason !== "Unsupported NPC movement controller 2"));
      report.groupAdmission.push({ mapId: map.mapId, group, originalBlockers: original.blockers.length,
        remainingBlockers: remaining, storyAdmission: "unassessed" });
    }
    for (const source of inventory.definitions) {
      const entity = sourceMap.map.groups[source.group].entities.find(item => item.id === source.entityId);
      assert.ok(entity); assert.ok(entity.nativeNpc === null || entity.nativeNpc === undefined,
        "The strict source NPC cannot acquire a controller definition from its Web sidecar");
      assert.ok(entity.nativeNpcBlockers.includes("Native NPC autonomous movement controller is unresolved"));
      assert.ok(sourceMap.map.groups[source.group].blockers.some(blocker => sourceKey(blocker.source) === sourceKey(source.source) &&
        blocker.reason === "Unsupported NPC movement controller 2"));
    }
    strictMaps.push(sourceMap);
  }
  const { contentHash: ignoredWorldHash, developmentProfile: ignoredProfile, ...strictCatalogBody } = structuredClone(world);
  for (const sourceMap of strictMaps) {
    const pin = build.sourceInputs.maps.find(item => item.mapId === sourceMap.mapId); assert.ok(pin);
    strictCatalogBody.maps[String(sourceMap.mapId)] = { ...strictCatalogBody.maps[String(sourceMap.mapId)],
      url: pin.url, contentHash: sourceMap.contentHash };
  }
  const strictCatalog = { ...strictCatalogBody, contentHash: await integrity.contentDigest(strictCatalogBody) };
  assert.equal(strictCatalog.contentHash, build.sourceInputs.world.contentHash);
  const strict = dependencies.analyzeContentDependencies({ catalog: strictCatalog, maps: strictMaps, roots: manifest.roots, mapIds: ids }),
    publishedDiagnostics = new Set(build.diagnostics.map(canonical));
  assert.ok(strict.diagnostics.every(diagnostic => publishedDiagnostics.has(canonical(diagnostic))),
    "The published area dropped a strict source diagnostic");
  report.strictSource = { diagnosticCount: strict.diagnostics.length, diagnosticCodes: histogram(strict.diagnostics, item => item.code),
    providerRequirements: strict.providerRequirements.length, providerAssessments: strict.providerAssessments.length,
    retainedInPublishedBatch: true, originalMapBodiesChanged: false };
  report.cases.push({ name: "same-publication-rederived-sidecars-and-unchanged-original-map-bodies", result: "passed", bindings: 36, maps: 56 });
  assert.equal(await runtimeDigest(root, compiled), runtimeHash, "Runtime changed while checking the area");
  assert.equal(sha(await readFile(resolve(contentDir, "south-figaro-area/build-report.json"))), sha(buildBytes),
    "A publication overlapped this check");
  if (workPlanBytes) assert.equal(sha(await readFile(resolve(contentDir, "source-batches/work-plan.json"))), sha(workPlanBytes),
    "The source work plan changed while checking the area");
  report.result = "passed";
} catch (error) {
  report.result = "failed"; report.error = error instanceof Error ? error.stack : String(error); process.exitCode = 1;
}
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ result: report.result, report: output, cases: report.cases.length,
  npcs: report.inventory?.physicalObjects ?? 0, providerReadiness: report.providerReadiness,
  ...(report.error ? { error: report.error.split("\n")[0] } : {}) }));
