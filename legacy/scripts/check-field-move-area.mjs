// Compile all source MoveArea objects; compilation counts are not playable maps.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url)), args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 2 && args[0] === "--compiled-dir", "Use --compiled-dir <directory>");
const compiled = resolve(root, args[1] ?? "dist"), module = (name) => import(pathToFileURL(resolve(compiled, "src", name + ".js")).href),
  sha = (bytes) => createHash("sha256").update(bytes).digest("hex"), output = root + "build/reports/field-move-area-check.json";
await mkdir(root + "build/reports", { recursive: true }); await rm(output, { force: true });
execFileSync(process.execPath, [root + "scripts/check-field-move-area-native.mjs"], { cwd: root, stdio: "pipe" });
const nativeBytes = await readFile(root + "build/reports/field-move-area-native-check.json"), native = JSON.parse(nativeBytes),
  { loadCorpus } = await module("compiler/corpus"), { hash } = await module("compiler/content"),
  { bindMapPackages } = await module("compiler/map-package"),
  { compileEntityGroup, entityProperties } = await module("compiler/entity-group"),
  { compileFieldCameraMapRange } = await module("compiler/field-camera"),
  { validateFieldMoveAreas, fieldMoveAreas, findFieldMoveArea } = await module("core/field-move-area"),
  corpus = await loadCorpus(root), bindings = bindMapPackages(corpus.assets, corpus.tables),
  byId = new Map(corpus.assets.map((asset) => [asset.id, asset])), references = new Map();
assert.equal(corpus.manifest.sources.find((source) => source.file === "GameAssembly.dll")?.sha256, native.nativeSha256);
assert.equal(native.semanticsVerified, false);
for (const binding of bindings) for (const [name, id] of Object.entries(binding.groups)) {
  if (!references.has(id)) references.set(id, []);
  references.get(id).push({ name, binding });
}
const sourceFiles = new Set(), groups = new Map(), sites = [], admitted = [], blocked = [];
for (const asset of corpus.assets) {
  if (!Array.isArray(asset.data?.layers)) continue;
  const objects = asset.data.layers.flatMap((layer, li) => Array.isArray(layer.objects)
    ? layer.objects.flatMap((object, oi) => {
      const properties = entityProperties(object.properties);
      return properties.object_type === 13 ? [{ object, properties, li, oi }] : [];
    }) : []);
  if (!objects.length) continue;
  const refs = references.get(asset.id) ?? [], names = [...new Set(refs.map((ref) => ref.name))];
  assert.ok(names.length <= 1, "Source area group has several aliases; its internal identity requires review");
  const name = names[0] ?? basename(asset.source.assetPath, ".json"), group = compileEntityGroup(name, asset, corpus.tables, corpus.messages);
  groups.set(asset.id, group); validateFieldMoveAreas(group.entities);
  assert.equal(corpus.manifest.sources.filter((source) => source.file === asset.source.file && source.sha256 === asset.source.sha256).length, 1);
  if (!sourceFiles.has(asset.source.file)) {
    assert.equal(sha(await readFile(root + "build/runtime/game/" + asset.source.file)), asset.source.sha256);
    sourceFiles.add(asset.source.file);
  }
  const contexts = refs.map(({ binding }) => {
    const tilemap = byId.get(binding.tilemap), defaults = byId.get(binding.groups.entity_default);
    assert.ok(tilemap && defaults, "Source area map lacks explicit range inputs");
    return { mapId: Number(binding.id), range: compileFieldCameraMapRange(tilemap.data, defaults.data),
      tilemap: { source: tilemap.source, hash: hash(tilemap.data) }, defaults: { source: defaults.source, hash: hash(defaults.data) } };
  });
  for (const { object, properties, li, oi } of objects) {
    const pointer = `/layers/${li}/objects/${oi}`, entity = group.entities.find((e) => e.source.pointer === pointer),
      reasons = group.blockers.filter((b) => b.source.pointer === pointer || b.source.pointer === `/layers/${li}`).map((b) => b.reason),
      site = { assetId: asset.id, source: { ...asset.source, pointer }, group: name,
        rawHash: hash(object), sourceEntityId: properties.entity_id, objectId: properties.object_id,
        maps: contexts.map((context) => context.mapId), definition: entity?.moveArea ?? null,
        blockers: reasons, otherGroupBlockers: group.blockers.filter((b) => b.source.pointer !== pointer).map((b) => b.reason) };
    sites.push(site);
    if (!entity?.moveArea || reasons.length) { assert.ok(reasons.length); blocked.push(site); continue; }
    assert.equal(entity.kind, 13); assert.equal(entity.asset, null); assert.equal(entity.nativeNpc, undefined);
    assert.equal(entity.moveArea.sourceEntityId, properties.entity_id); assert.equal(entity.moveArea.objectId, properties.object_id);
    assert.equal(entity.moveArea.source.objectId, asset.source.objectId); assert.equal(entity.moveArea.source.sha256, asset.source.sha256);
    const before = hash(entity), projections = contexts.map((context) => {
      const projection = fieldMoveAreas([entity], context.range)[0];
      assert.deepEqual(projection.moveArea.width, object.width); assert.deepEqual(projection.moveArea.height, object.height);
      assert.deepEqual(findFieldMoveArea([entity], properties.object_id, context.range), projection);
      assert.ok(Object.values(projection.cellArea).every(Number.isInteger));
      assert.ok(Object.values(projection.moveArea).every(Number.isFinite));
      projection.definition.geometry.width = -1;
      assert.equal(hash(entity), before, "Query must not mutate trusted content");
      return { ...context, projection: fieldMoveAreas([entity], context.range)[0] };
    });
    admitted.push({ ...site, projections });
  }
}
assert.equal(sites.length, 162); assert.equal(admitted.length, 161); assert.equal(blocked.length, 1);
assert.match(blocked[0].blockers.join(" "), /geometry or transform|Unsupported entity transform/);
assert.ok(admitted.some((site) => site.sourceEntityId === 0));
assert.ok(admitted.some((site) => site.sourceEntityId === -1));
const route = bindings.find((binding) => binding.id === "178"); assert.ok(route);
const routeGroup = groups.get(route.groups.entity_default); assert.ok(routeGroup);
assert.ok(!routeGroup.blockers.some((blocker) => /kind 13|field move area/i.test(blocker.reason)));
const routeEntity = routeGroup.entities.find((entity) => entity.kind === 13 && entity.objectId === 1); assert.ok(routeEntity?.moveArea);
const routeRange = compileFieldCameraMapRange(byId.get(route.tilemap).data, byId.get(route.groups.entity_default).data),
  routeArea = findFieldMoveArea(routeGroup.entities, 1, routeRange);
assert.equal(routeArea.definition.entityId, "16");
assert.deepEqual(routeArea.definition.geometry, { x: 144, y: 256, width: 144, height: 144, layer: 1 });
// This is a source compiler regression only. Other kinds/media/controllers and
// actual map publication remain independently validated by framework journeys.
const report = { kind: "source-field-move-area", sourceSetHash: corpus.sourceSetHash,
  parentSourceSetHash: corpus.manifest.parentSourceSetHash, nativeReportSha256: sha(nativeBytes),
  semanticsVerified: false, originalGameExecuted: false,
  counts: { sourceObjects: sites.length, admittedDefinitions: admitted.length, blockedDefinitions: blocked.length,
    sourceFiles: sourceFiles.size, projectedMapBindings: admitted.reduce((count, site) => count + site.projections.length, 0) },
  admitted, blocked, routeProbe: { mapId: 178, range: routeRange, area: routeArea, remainingGroupBlockers: routeGroup.blockers },
  limits: ["Source object compilation and rectangle projection are not playable-map coverage",
    "One hidden source region remains outside the admitted transform subset",
    "Autonomous AreaMove/Route/Random controllers, arbitrary region actor commands and repeat group activation remain unsupported",
    "The only state owner remains FieldGame entityList; activeGroups reconstruct the trusted data on Web restore",
    "No original game runtime, browser rendering or story reachability is proven by this report"] };
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ result: "pass", ...report.counts, routeMoveArea: routeArea.definition.objectId,
  semanticsVerified: false, originalGameExecuted: false }));
