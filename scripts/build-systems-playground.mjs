// Authored system stages reuse source geometry/media and the unchanged owned
// baseline. This is a development-only package, never a source story variant.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, posix, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { compileDevelopmentMapEntry } from "../dist/src/compiler/development-map-entry.js";
import { canonical, hash } from "../dist/src/compiler/content.js";
import { verifyContent } from "../dist/src/core/content-integrity.js";
import { GameContentRepository } from "../dist/src/core/game-content.js";
import { parseGameContentRefs } from "../dist/src/core/game-content-refs.js";

const repository = resolve(import.meta.dirname, ".."), recipeName = "content-batches/systems-playground.recipe.json";
const seal = value => { const { contentHash: _, ...payload } = value; return { ...payload, contentHash: hash(payload) }; };
const fields = (value, keys) => assert.deepEqual(Object.keys(value).sort(), keys.split(",").sort());
const integer = (value, min = 0) => assert.ok(Number.isInteger(value) && value >= min && value <= 0x7fffffff);
const within = (parent, path) => {
  const child = relative(parent, path);
  return child && child !== ".." && !child.startsWith(".." + sep) && !isAbsolute(child);
};

export async function compileSystemsPlayground(root, rawRecipe, recipeSha256, { readJson } = {}) {
  root = resolve(root); const recipe = structuredClone(rawRecipe), build = resolve(root, "build");
  fields(recipe, "kind,id,baseField,battle,baseWorld,mapRules,areaId,supplies,stages");
  assert.equal(recipe.kind, "systems-playground-recipe-v1"); assert.equal(recipe.id, "systems-playground");
  assert.match(recipeSha256, /^[a-f0-9]{64}$/); integer(recipe.areaId, 1);
  const read = async ref => {
    fields(ref, "url,contentHash");
    assert.match(ref.url, /^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.json$/);
    assert.equal(posix.normalize(ref.url), ref.url, "Unexpected noncanonical content path");
    assert.match(ref.contentHash, /^[a-f0-9]{64}$/);
    const path = resolve(build, ref.url.slice(1)); assert.ok(within(build, path));
    let value;
    if (readJson) value = await readJson(ref.url);
    else {
      const actual = await realpath(path); assert.ok(within(build, actual));
      value = JSON.parse(await readFile(actual, "utf8"));
    }
    return verifyContent(structuredClone(value), ref.contentHash);
  };
  const [baseField, sourceBattle, baseWorld, mapRules] = await Promise.all(
    [recipe.baseField, recipe.battle, recipe.baseWorld, recipe.mapRules].map(read));
  assert.equal(baseWorld.developmentProfile.kind, "framework-development-v1");
  assert.equal(baseField.sourceSetHash, sourceBattle.common.fieldSourceSetHash);
  assert.equal(baseField.parentSourceSetHash, baseWorld.parentSourceSetHash);
  assert.equal(mapRules.parentSourceSetHash, baseWorld.parentSourceSetHash);
  assert.equal(mapRules.sourceSetHash, baseWorld.sourceSetHash);
  assert.equal(mapRules.mediaSourceSetHash, baseWorld.mediaSourceSetHash);
  assert.ok(mapRules.partyEntry && mapRules.partyEntry.loopType === 0);
  assert.equal(baseField.map.width, mapRules.partyEntry.width); assert.equal(baseField.map.height, mapRules.partyEntry.height);
  fields(recipe.supplies, "itemId,count"); integer(recipe.supplies.itemId, 1); integer(recipe.supplies.count, 1);
  assert.ok(sourceBattle.gameState.items[recipe.supplies.itemId]?.uses.menu.plan, "Supply item has no admitted owned menu plan");
  assert.ok(Array.isArray(recipe.stages) && recipe.stages.length === 2);
  assert.equal(new Set(recipe.stages.map(stage => stage.id)).size, 2);
  // Author stages do not impersonate a native map or acquire an implicit
  // empty exclusion set. The developer explicitly reuses one source row.
  const qualificationRows = sourceBattle.common.battleEntry.maps.filter(row => row.id === mapRules.mapId);
  assert.equal(qualificationRows.length, 1, "Missing or ambiguous source map qualification row");
  const qualification = qualificationRows[0];
  const derivedMapQualification = recipe.stages.map(stage => {
    assert.ok(!sourceBattle.common.battleEntry.maps.some(row => row.id === stage.id));
    return { stageMapId: stage.id, fromMapId: mapRules.mapId,
      values: { sleepingAvailability: qualification.sleepingAvailability, movingAvailability: qualification.movingAvailability } };
  });
  const battle = seal({ ...structuredClone(sourceBattle), common: { ...structuredClone(sourceBattle.common),
    battleEntry: { ...structuredClone(sourceBattle.common.battleEntry), maps: [
      ...structuredClone(sourceBattle.common.battleEntry.maps),
      ...derivedMapQualification.map(row => ({ id: row.stageMapId, ...row.values })),
    ] }, limitations: [...sourceBattle.common.limitations,
      `Authored systems stages ${recipe.stages.map(stage => stage.id).join(", ")} explicitly inherit map ${mapRules.mapId} sleeping/moving eligibility; this is development policy, not source-map admission.`] } });
  assert.equal(canonical(battle.gameState), canonical(sourceBattle.gameState));
  const source = pointer => ({ file: recipeName, assetPath: "Authored/SystemsPlayground/recipe.json",
    pointer, sha256: recipeSha256 });
  const profile = originalHash => ({ kind: "framework-development-v1", policy: "omit-anonymous-environment-particles-v1",
    sourceContentHash: originalHash, omissions: [], transportation: baseWorld.developmentProfile.transportation });
  const maps = recipe.stages.map((stage, index) => {
    fields(stage, "id,name,partyId,entrance,trigger,portal,before,after");
    integer(stage.id, 1); integer(stage.partyId, 1);
    assert.equal(baseWorld.maps[stage.id], undefined, "Author stage must not replace a source map");
    assert.ok(typeof stage.name === "string" && stage.name.length > 0);
    assert.ok(typeof stage.before === "string" && stage.before.length > 0 && typeof stage.after === "string" && stage.after.length > 0);
    const encounter = battle.encounters[stage.partyId]; assert.ok(encounter, "Missing selected battle definition");
    assert.equal(encounter.handoff?.policy?.audio, "retain-field"); assert.equal(encounter.handoff?.policy?.introduction, "omit");
    assert.ok(!battle.encounterDiagnostics.some(d => d.partyId === stage.partyId && ["blocked", "runtime-dependency"].includes(d.kind)),
      "Stage enemy party has an unresolved runtime dependency");
    fields(stage.entrance, "x,y,layer,direction"); fields(stage.trigger, "x,y"); integer(stage.entrance.layer);
    assert.ok(["up", "right", "down", "left"].includes(stage.entrance.direction));
    for (const position of [stage.entrance, stage.trigger, ...(stage.portal ? [stage.portal] : [])]) {
      integer(position.x); integer(position.y);
      assert.ok(position.x < baseField.map.width && position.y < baseField.map.height);
      assert.equal(baseField.map.collisions[stage.entrance.layer]?.[position.y * baseField.map.width + position.x], 0,
        "Authored system route must use existing walkable geometry");
    }
    if (stage.portal) {
      fields(stage.portal, "x,y,mapId"); assert.ok(recipe.stages.some(other => other.id === stage.portal.mapId));
    }
    const script = "systems_stage_" + (index + 1), after = script + "_after", pointer = "/stages/" + index;
    const op = (scriptName, number, value) => ({ script: scriptName, index: number, source: source(pointer + "/script/" + number), ...value });
    const memberFlag = { category: "MapLocalVariable", index: 0 };
    const instructions = [{ kind: "branch", left: memberFlag, operator: "＝", right: { kind: "immediate", value: 1 }, target: 0 },
      { kind: "message", key: "SYSTEMS_STAGE_" + index, speaker: "", text: stage.before }];
    if (index === 0) instructions.push({ kind: "inventory", command: { kind: "grant-item", id: recipe.supplies.itemId, count: recipe.supplies.count },
      result: null, dependencies: [{ table: "content.csv", id: recipe.supplies.itemId }] });
    instructions.push({ kind: "calc", left: memberFlag, operator: "←", right: { kind: "immediate", value: 1 } },
      { kind: "encounter", party: stage.partyId, continuation: after }, { kind: "nop" }, { kind: "exit" });
    instructions[0].target = instructions.length - 2;
    const afterInstructions = [{ kind: "message", key: "SYSTEMS_STAGE_AFTER_" + index, speaker: "", text: stage.after },
      ...(stage.portal ? [{ kind: "entities", group: "systems_portal" }] : []), { kind: "exit" }];
    const makeEntity = (id, kind, point, extra = {}) => ({ id, objectId: 0, kind, x: point.x, y: point.y,
      layer: stage.entrance.layer, width: 1, height: 1, direction: "up", asset: null, script: null,
      collision: null, destinationLayer: null, source: source(pointer + "/entities/" + id), ...extra });
    const pointSource = source(pointer + "/entrance"), point = { id: 1, ...stage.entrance, linkObject: 0, source: pointSource };
    const entranceEntity = makeEntity("systems_entrance", 0, stage.entrance, { objectId: 1, direction: stage.entrance.direction, source: pointSource });
    const entities = [entranceEntity, makeEntity("systems_battle_trigger", 2, stage.trigger, { script })];
    const groups = { entity_default: { name: "entity_default", source: source(pointer + "/entities"), blockers: [], entities } };
    if (stage.portal) groups.systems_portal = { name: "systems_portal", source: source(pointer + "/portal"), blockers: [],
      entities: [makeEntity("systems_portal", 3, stage.portal, { destination: { mapId: stage.portal.mapId, entrance: 1 } })] };
    const geometry = { ...structuredClone(baseField.map), id: "SystemsStage_" + (index + 1),
      identity: { mapId: stage.id, areaId: recipe.areaId }, source: source(pointer), groups, entities,
      initialGroups: ["entity_default"], entryContext: { ...structuredClone(baseField.map.entryContext), mapId: stage.id,
        groups: Object.fromEntries(Object.keys(groups).map(name => [name, { savePointCount: 0, reason: null, source: groups[name].source }])) } };
    const partyEntry = { ...structuredClone(mapRules.partyEntry), mapId: stage.id, pointIns: [point], conditionColliders: [] };
    return seal({ formatVersion: 1, kind: "world-map-development", parentSourceSetHash: baseWorld.parentSourceSetHash,
      sourceSetHash: baseWorld.sourceSetHash, mediaSourceSetHash: baseWorld.mediaSourceSetHash,
      developmentProfile: profile(baseField.contentHash), mapId: stage.id, areaId: recipe.areaId, name: stage.name,
      map: geometry, partyEntry, partyEntryBlockers: [], scripts: { [script]: instructions.map((value, number) => op(script, number, value)),
        [after]: afterInstructions.map((value, number) => op(after, number, value)) },
      scriptLocals: { [script]: null, [after]: null },
      scriptSystemFlags: { [script]: { keepBadStatusVisual: false }, [after]: { keepBadStatusVisual: false } },
      scriptTransitionMetadata: { [script]: { customAnimations: "none" }, [after]: { customAnimations: "none" } },
      initializer: null, characterAssets: Object.keys(baseField.characters), blockers: [],
      limitations: ["Authored systems playground using source Narshe visuals; not source geography or story reachability.",
        "MapLocalVariable[0] guards this stage once. It is initialized by the actual map-entry lifecycle, never a seeded story flag."] });
  });
  const prefix = "/content-packages/" + recipe.id, catalog = seal({ ...structuredClone(baseWorld),
    characters: { ...structuredClone(baseWorld.characters), ...structuredClone(baseField.characters) },
    developmentProfile: profile(baseWorld.contentHash), maps: Object.fromEntries(maps.map(map => [map.mapId,
      { url: prefix + "/maps/" + map.mapId + ".json", contentHash: map.contentHash, name: map.name, areaId: map.areaId,
        geometryReady: true, defaultGroupReady: true, blockers: [] }])),
    limitations: ["Development-only authored system stages; original world packages and story state are preserved."] });
  const entry = await compileDevelopmentMapEntry({ baseField, baseBattle: battle, catalog, map: maps[0], entrance: 1 });
  const refs = parseGameContentRefs({ kind: "game-content-refs-v1", profile: "framework", source: null,
    world: { url: prefix + "/world.json", contentHash: catalog.contentHash },
    development: { entry: { url: prefix + "/entry.json", contentHash: entry.contentHash },
      battle: { url: prefix + "/battle.json", contentHash: battle.contentHash } } });
  const payloads = new Map([[refs.world.url, catalog], [refs.development.entry.url, entry], [refs.development.battle.url, battle],
    ...maps.map(map => [prefix + "/maps/" + map.mapId + ".json", map])]);
  const repo = new GameContentRepository(async url => { assert.ok(payloads.has(url), "Unexpected system package reference: " + url); return payloads.get(url); }, "framework", refs);
  const opening = await repo.opening(); assert.equal(opening.development.map.mapId, maps[0].mapId);
  for (const map of maps) await repo.map(map.mapId);
  const report = { kind: "systems-playground-build-v1", package: recipe.id, profile: "framework", entryOrigin: "development-checkpoint",
    recipeSha256, inputs: { baseField: recipe.baseField, battle: recipe.battle, baseWorld: recipe.baseWorld, mapRules: recipe.mapRules },
    refs, sourceBattleHash: sourceBattle.contentHash, derivedBattleHash: battle.contentHash, derivedMapQualification,
    mapQualificationSource: { rawBattleHash: sourceBattle.contentHash, mapRules: recipe.mapRules,
      row: structuredClone(qualification) },
    maps: maps.map(map => ({ mapId: map.mapId, contentHash: map.contentHash, scripts: Object.keys(map.scripts) })),
    route: recipe.stages, authoredState: "stage-local MapLocalVariable[0]; no new initial or source story flags",
    sourceGameplayAdmitted: false, initialOwnedSeedsChanged: false, originalPackagesChanged: false,
    geometrySource: baseField.map.source, capabilities: ["walking trigger", "manual message", "owned inventory", "ordinary source enemy party",
      "prepared battle handoff", "owned reward/growth", "menu", "stable checkpoint restore", "data-driven world transition"],
    nativeHandoffVerified: false, browserVerified: false, gameplayCheck: "not-run-by-builder" };
  return { entry, battle, catalog, maps, refs, payloads, report };
}

export async function buildSystemsPlayground({ root = repository, recipePath = recipeName, out } = {}) {
  root = resolve(root);
  assert.equal(resolve(root, recipePath), resolve(root, recipeName), "Only the declared systems-playground recipe is supported");
  const bytes = await readFile(resolve(root, recipePath)), recipe = JSON.parse(bytes.toString());
  const result = await compileSystemsPlayground(root, recipe, createHash("sha256").update(bytes).digest("hex"));
  const build = resolve(root, "build"), target = resolve(root, out ?? "build/content-packages"), backup = target + ".previous-systems";
  assert.ok(within(build, target), "System content output must be inside build");
  await mkdir(resolve(target, ".."), { recursive: true });
  const staged = await mkdtemp(resolve(target, "../.systems-content-packages-"));
  try {
    try { await cp(resolve(build, "content-packages"), staged, { recursive: true }); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    for (const [url, payload] of result.payloads) {
      const file = resolve(staged, url.slice("/content-packages/".length)); assert.ok(within(staged, file));
      await mkdir(resolve(file, ".."), { recursive: true }); await writeFile(file, canonical(payload) + "\n");
    }
    await writeFile(resolve(staged, "systems-playground.json"), canonical(result.refs) + "\n");
    await writeFile(resolve(staged, "systems-playground/build-report.json"), JSON.stringify(result.report, null, 2) + "\n");
    try { await stat(backup); throw new Error("Inspect interrupted systems content publication"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    let previous = false;
    try { await rename(target, backup); previous = true; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    try { await rename(staged, target); }
    catch (error) { if (previous) await rename(backup, target); throw error; }
    if (previous) await rm(backup, { recursive: true });
  } finally { await rm(staged, { recursive: true, force: true }); }
  await mkdir(resolve(build, "reports"), { recursive: true });
  await writeFile(resolve(build, "reports/systems-playground-build.json"), JSON.stringify(result.report, null, 2) + "\n");
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), options = {};
  if (args[0] && !args[0].startsWith("--")) options.recipePath = args.shift();
  assert.ok(args.length === 0 || args.length === 2 && args[0] === "--out", "Use build-systems-playground.mjs [recipe.json] [--out build/collection]");
  if (args.length) options.out = args[1];
  const result = await buildSystemsPlayground(options);
  console.log(JSON.stringify({ package: "systems-playground", profile: result.refs.profile,
    maps: result.maps.map(map => map.mapId), entryHash: result.entry.contentHash,
    refs: (options.out ?? "build/content-packages") + "/systems-playground.json",
    sourceGameplayAdmitted: false }));
}
