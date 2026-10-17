// Static source/media closure and refusal probes. No Unity simulator or visual oracle.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url)), args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 2 && args[0] === "--compiled-dir"), "Use --compiled-dir <directory>");
const compiled = resolve(root, args[1] ?? "dist"), sha = (value) => createHash("sha256").update(value).digest("hex");
const load = (name) => import(pathToFileURL(resolve(compiled, "src", name + ".js")).href);
const output = resolve(root, "build/reports/field-effects-check.json");
const report = { formatVersion: 1, lane: "source-field-effect-board-and-prefab-inspection", status: "running",
  semanticsVerified: false, originalGameExecuted: false, browserExecuted: false, sourceGroups: [], boards: [], cases: [],
  limitations: ["No Unity ParticleSystem simulation or source particle/board material implementation is admitted.",
    "A logical board and shared-player owner is executable only with an explicit prepared host; real source media remains blocked.",
    "This checker compiles current source objects directly; it does not claim published world or story reachability.",
    "Event-group creation order and particle/RNG saves remain gated. Transactional ordinary map handoff requires an explicit candidate host."] };
const check = (name, work) => { work(); report.cases.push({ name, pass: true }); };
let stage = "load-source";
try {
  const { loadCorpus } = await load("compiler/corpus"), { hash } = await load("compiler/content");
  const { bindMapPackages } = await load("compiler/map-package");
  const { compileEntityGroup, entityProperties } = await load("compiler/entity-group");
  const { compileFieldEffectMedia, fieldEffectCompilationBlockers } = await load("compiler/field-effects");
  const { compileFieldCameraMapRange } = await load("compiler/field-camera");
  const { FieldEffects, projectFieldEffectBoard, projectFieldEffectPlacement } = await load("core/field-effects");
  const corpus = await loadCorpus(root), byId = new Map(corpus.assets.map((asset) => [asset.id, asset]));
  const exportedBytes = await readFile(resolve(root, "build/v33-field-effect-media/media.json"));
  const exported = JSON.parse(exportedBytes), snapshot = JSON.parse(await readFile(resolve(root, "build/v33-field-effect-media/snapshot.json")));
  assert.deepEqual(snapshot.files, [{ file: "media.json", sha256: sha(exportedBytes) }]);
  assert.equal(exported.adapterVersion, "field-effect-media-0.1.0");
  assert.equal(exported.parentSourceSetHash, corpus.manifest.sourceSetHash);
  assert.equal(exported.sourceSetHash, hash(exported.sources));
  report.sourceSetHash = corpus.sourceSetHash; report.parentSourceSetHash = exported.parentSourceSetHash;
  report.media = { file: "build/v33-field-effect-media/media.json", sha256: sha(exportedBytes), sourceSetHash: exported.sourceSetHash };
  for (const entry of exported.sources) {
    const original = await readFile(resolve(root, "build/runtime/game", entry.file));
    assert.equal(original.length, entry.bytes); assert.equal(sha(original), entry.sha256);
  }
  const nativeBytes = await readFile(resolve(root, "build/reports/field-effects-native-check.json")), native = JSON.parse(nativeBytes);
  assert.equal(native.semanticsVerified, false); assert.equal(native.methods.length, 39); assert.equal(native.rawBindings.length, 12);
  assert.ok(corpus.manifest.sources.some((entry) => entry.file === "GameAssembly.dll" && entry.sha256 === native.nativeSha256));
  report.native = { file: "build/reports/field-effects-native-check.json", sha256: sha(nativeBytes),
    nativeSha256: native.nativeSha256, methods: native.methods.length, rawBindings: native.rawBindings.length };
  const groups = ["ef_ff6_m_001", "ef_ff6_m_002", "ef_ff6_m_003", "ef_ff6_m_004", "ef_ff6_m_016"];
  assert.deepEqual(Object.keys(exported.groups), groups);
  const catalog = { media: {} };
  for (const [index, group] of groups.entries()) {
    stage = "prefab-" + group;
    const input = exported.groups[group], before = hash(input), media = compileFieldEffectMedia(group, input);
    check(group + " follows one runtime EffectPrefab particle, not both prefabs in its bundle", () => {
      assert.equal(media.particles.length, 1);
      assert.equal(typeof media.particles[0].id, "string");
      assert.ok(input.hierarchyIds.includes(media.particles[0].id));
      assert.equal(input.objects.filter((object) => object.type === "ParticleSystem").length, 2);
      assert.equal(input.rootId, input.source.objectId); assert.match(input.source.assetPath, /\/Prefabs\/EffectPrefab\.prefab$/);
      assert.ok(exported.sources.some((entry) => entry.file === input.source.file && entry.sha256 === input.source.sha256));
      const expectedSize = [256, 128, 32, 32, 32][index];
      assert.deepEqual(media.renderTexture, { width: expectedSize, height: expectedSize, filterMode: 0, wrapMode: 1 });
      assert.equal(media.animator, null); assert.ok(media.particles[0].enabledModules.includes("NoiseModule"));
      assert.ok(media.blockers.some((reason) => reason.includes("NoiseModule")));
      assert.ok(media.blockers.some((reason) => reason.includes("autoRandomSeed")));
      assert.ok(media.blockers.some((reason) => /material|shader/.test(reason)));
      assert.equal(hash(input), before);
    });
    catalog.media[group] = media;
    report.sourceGroups.push({ group, source: media.source, particles: media.particles, renderTexture: media.renderTexture,
      objectCount: input.objects.length, runtimeHierarchyCount: input.hierarchyIds.length, blockers: media.blockers,
      definitionSha256: hash(media) });
  }
  stage = "map3-boards";
  const binding = bindMapPackages(corpus.assets, corpus.tables).find((entry) => entry.id === "3"); assert.ok(binding);
  assert.deepEqual(binding.issues, []);
  const defaultAsset = byId.get(binding.groups.entity_default), tile = byId.get(binding.tilemap);
  assert.ok(defaultAsset && tile); const beforeSource = hash(defaultAsset);
  const range = compileFieldCameraMapRange(tile.data, defaultAsset.data);
  const compiledGroup = compileEntityGroup("entity_default", defaultAsset, corpus.tables, corpus.messages),
    effects = compiledGroup.entities.filter((entity) => entity.kind === 11);
  const actualIds = defaultAsset.data.layers.flatMap((layer) => layer.objects
    .filter((object) => entityProperties(object.properties).object_type === 11).map((object) => object.id));
  assert.deepEqual(actualIds, [515, 520, 518, 521, 522, 523, 524, 525, 517, 516, 526, 519, 532, 533, 534]);
  assert.equal(effects.length, 15);
  check("all fifteen source boards remain in default order and have explicit media blockers", () => {
    assert.equal(effects.length, actualIds.length);
    const refs = effects.map((entity) => entity.source.pointer);
    assert.equal(new Set(refs).size, 15);
    for (const entity of effects) {
      assert.ok(entity.effect); assert.equal(entity.layer, 3);
      assert.deepEqual(entity.effect.source, entity.source);
      assert.ok(compiledGroup.blockers.some((blocker) => blocker.source.pointer === entity.source.pointer &&
        blocker.reason.includes("particle provider unavailable")));
      assert.ok(!compiledGroup.blockers.some((blocker) => blocker.source.pointer === entity.source.pointer &&
        blocker.reason === "Unsupported entity kind 11"));
    }
  });
  check("the full source map has no event-group boards, so default-only pool order is source closed", () => {
    for (const [name, id] of Object.entries(binding.groups)) if (name !== "entity_default") {
      const asset = byId.get(id); assert.ok(asset);
      assert.equal(asset.data.layers.flatMap((layer) => layer.objects)
        .filter((object) => entityProperties(object.properties).object_type === 11).length, 0);
    }
  });
  let hostPrepares = 0;
  const owner = new FieldEffects(catalog, { prepare() { hostPrepares++; throw new Error("must not reach an unadmitted source renderer"); } });
  const beforeOwner = owner.snapshot(), counts = {};
  for (const [index, entity] of effects.entries()) {
    const definition = entity.effect, media = catalog.media[definition.assetGroup]; assert.ok(media);
    counts[definition.assetGroup] = (counts[definition.assetGroup] ?? 0) + 1;
    const placement = projectFieldEffectPlacement(definition, { range, tileMapPresent: true, standbyAnchor: null }, entity.layer);
    const mesh = projectFieldEffectBoard(definition, media.renderTexture);
    check("source board " + actualIds[index] + " stays blocked before any partial owner/renderer publication", () => {
      assert.equal(placement.layer, 12); assert.equal(placement.position.z, 49);
      assert.equal(mesh.renderQueue, 2458); assert.equal(mesh.affectedMode, 0); assert.equal(mesh.zTest, 4);
      assert.equal(mesh.collider.enabled, false); assert.equal(mesh.vertices.length, mesh.uv.length);
      assert.throws(() => owner.prepare([{ kind: "create", id: entity.id, definition, position: placement.position }]), /particle provider unavailable/);
      assert.deepEqual(owner.snapshot(), beforeOwner); assert.equal(hostPrepares, 0);
    });
    report.boards.push({ sourceObjectId: actualIds[index], entityId: entity.id, definition, placement,
      meshHash: hash(mesh), vertices: mesh.vertices.length, triangles: mesh.triangles.length / 3,
      blockers: fieldEffectCompilationBlockers(definition, media) });
  }
  assert.deepEqual(counts, { ef_ff6_m_001: 8, ef_ff6_m_002: 1, ef_ff6_m_003: 2, ef_ff6_m_004: 1, ef_ff6_m_016: 3 });
  assert.equal(hash(defaultAsset), beforeSource);
  report.map = { id: 3, name: binding.name, source: defaultAsset.source, range, sourceBoardOrder: actualIds,
    eventGroupsInspected: Object.keys(binding.groups).length - 1 };
  report.counts = { cases: report.cases.length, actualBoards: effects.length, effectPrefabs: groups.length,
    runtimeParticles: report.sourceGroups.reduce((n, group) => n + group.particles.length, 0),
    blockedBoards: effects.length, admittedSourcePrefabs: 0, hostPrepares };
  report.implementation = await Promise.all(["core/field-effects", "compiler/field-effects"].map(async (name) => ({
    file: "src/" + name + ".ts", sha256: sha(await readFile(resolve(root, "src", name + ".ts"))),
    compiledSha256: sha(await readFile(resolve(compiled, "src", name + ".js"))),
  })));
  report.checkerSha256 = sha(await readFile(fileURLToPath(import.meta.url))); report.status = "pass";
  await mkdir(resolve(root, "build/reports"), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ status: report.status, ...report.counts, semanticsVerified: false, reportSha256: sha(await readFile(output)) }));
} catch (error) {
  report.status = "failed"; report.failedStage = stage; report.error = { name: error.name, message: error.message, stack: error.stack };
  await mkdir(resolve(root, "build/reports"), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + "\n"); throw error;
}
