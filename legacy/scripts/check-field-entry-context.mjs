// Source map metadata and controlled qualification projections. These counts
// are provider capabilities, not playable maps, routes or original-game parity.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { posix, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 2 && args[0] === "--build-dir"));
const build = resolve(root, args[1] ?? "dist");
const module = (name) => import(pathToFileURL(build + "/src/" + name + ".js"));
const { loadCorpus } = await module("compiler/corpus");
const { loadSystemSource } = await module("compiler/system-source");
const { compileFieldEntryContext } = await module("compiler/field-entry-context");
const { compileBattleEntryCatalog } = await module("compiler/battle-entry");
const { projectFieldEntryContext } = await module("core/field-entry-context");
const { projectBattleFieldState } = await module("core/field-battle-entry");
const { FieldGame } = await module("core/field");
const { hash } = await module("compiler/content");
const reportPath = root + "build/reports/field-entry-context-check.json";
await mkdir(root + "build/reports", { recursive: true });
await rm(reportPath, { force: true });
execFileSync(process.execPath, [root + "scripts/check-field-entry-context-native.mjs"], { cwd: root, stdio: "pipe" });
const nativeBytes = await readFile(root + "build/reports/field-entry-context-native-check.json"), native = JSON.parse(nativeBytes);
assert.equal(native.semanticsVerified, false);
const corpus = await loadCorpus(root), source = await loadSystemSource(root, corpus.manifest.parentSourceSetHash);
assert.equal(source.sourceSetHash, corpus.sourceSetHash);
assert.ok(corpus.manifest.sources.some((row) => row.file === "GameAssembly.dll" && row.sha256 === native.nativeSha256));
const misc = corpus.assets.filter((asset) => asset.source.assetPath.endsWith("/serial_misc_assets.json"));
assert.equal(misc.length, 1);
const entryCatalog = compileBattleEntryCatalog(source.reader, corpus.tables, misc[0]).catalog;
const transportations = corpus.tables["transportation.csv"].map((row) => ({ id: Number(row.id), type: Number(row.type_id) }));
const maps = [], probes = [], definitions = new Map();
let inspectedGroups = 0, sourceSavePoints = 0, unknownGroups = 0;
for (const row of corpus.tables["map.csv"]) {
  const mapId = Number(row.id), definition = compileFieldEntryContext(corpus.assets, corpus.tables, mapId);
  definitions.set(mapId, definition);
  const matches = corpus.assets.filter((asset) => asset.kind === "map-package" && asset.data.asset_group_name === row.asset_name)
    .flatMap((asset) => asset.data.map.filter((map) => map.name === row.map_name).map((map) => ({ asset, map })));
  assert.equal(matches.length, 1);
  const { asset, map } = matches[0];
  const declared = [...(map.entity_default ? [{ name: "entity_default", asset: map.entity_default }] : []), ...map.entity];
  assert.deepEqual(Object.keys(definition.groups), declared.map((group) => group.name));
  for (const group of declared) {
    inspectedGroups++;
    const path = posix.join(posix.dirname(asset.source.assetPath), group.asset + ".json");
    const raw = corpus.assets.filter((candidate) => candidate.kind === "data" && candidate.source.file === asset.source.file && candidate.source.assetPath === path);
    assert.equal(raw.length, 1);
    let count = 0, unknown = false;
    for (const layer of raw[0].data.layers) for (const object of layer.objects) {
      const types = object.properties.filter((property) => property.name === "object_type");
      if (types.length !== 1 || !Number.isSafeInteger(types[0].value) || types[0].value < 0) unknown = true;
      else if (types[0].value === 9) count++;
    }
    const compiled = definition.groups[group.name];
    assert.equal(compiled.savePointCount, unknown ? null : count);
    if (unknown) unknownGroups++;
    else sourceSavePoints += count;
  }
  const actualMonsterSet = corpus.tables["monster_set.csv"].find((set) => set.id === row.monster_set_id);
  if (actualMonsterSet && Number(row.monster_set_id) > 0) {
    assert.equal(definition.foot.kind, "uniform-zero");
    assert.equal(definition.foot.basis, "default-monster-set");
  } else assert.equal(definition.foot.kind, map.attribute ? "unresolved" : "uniform-zero");
  const noSavePoint = definition.groups.entity_default?.savePointCount === 0;
  const states = [];
  for (const entrySynchronized of [false, true]) {
    const result = projectFieldEntryContext(definition, { mapId, transportationId: 1,
      activeGroups: ["entity_default"], player: { x: 0, y: 0, layer: 1 }, entrySynchronized });
    assert.equal(result.state.beastFieldController, true);
    assert.equal(result.state.isSavePoint, noSavePoint ? false : null);
    assert.equal(result.state.footAttributeType, entrySynchronized && definition.foot.kind === "uniform-zero" ? 0 : null);
    const qualified = projectBattleFieldState(entryCatalog, result.state, transportations);
    if (!entrySynchronized || definition.foot.kind !== "uniform-zero") assert.equal(qualified.invalidContentIds, null);
    if (entrySynchronized && definition.foot.kind === "uniform-zero" && noSavePoint)
      assert.ok(qualified.invalidContentIds, `source ordinary-map qualification: ${mapId}`);
    probes.push({ mapId, entrySynchronized, state: result.state, ...qualified });
    states.push({ entrySynchronized, qualified: qualified.invalidContentIds !== null });
  }
  maps.push({ mapId, definitionHash: hash(definition), foot: definition.foot.kind,
    basis: definition.foot.kind === "uniform-zero" ? definition.foot.basis : null,
    defaultSavePoints: definition.groups.entity_default?.savePointCount ?? null,
    groupCount: Object.keys(definition.groups).length, states });
}
// Controlled host uses actual source provider metadata. Its tiny scripts are
// synthetic lifecycle probes, not a substituted source map initializer.
const controlled = [], definition = definitions.get(3), evidence = definition.foot.source;
assert.equal(definition.foot.kind, "uniform-zero");
const op = (value, index) => ({ script: "controlled", index, source: evidence, ...value });
const content = { formatVersion: 1, kind: "field-development", sourceSetHash: corpus.sourceSetHash,
  parentSourceSetHash: corpus.manifest.parentSourceSetHash, contentHash: "controlled-field-entry-context",
  map: { id: "controlled-source-provider", identity: { mapId: 3, areaId: 1 }, entryContext: definition,
    width: 3, height: 3, tileSize: 16, layers: [], tilesets: [], textures: {}, collisions: { 1: Array(9).fill(0) },
    entities: [], initialGroups: ["entity_default"], groups: { entity_default: { name: "entity_default", source: evidence, entities: [], blockers: [] } }, source: evidence },
  characters: {}, scripts: { init: [op({ kind: "encounter", party: 1, continuation: "after" }, 0)], after: [op({ kind: "exit" }, 0)] },
  entry: { synchronization: { kind: "map-entry" }, transportationId: 1,
    player: { x: 1, y: 1, layer: 1, direction: "up", asset: "controlled", mount: "" }, evidence: [evidence], description: "controlled source provider, synthetic lifecycle" }, limitations: [] };
const field = new FieldGame(content);
field.startMapEntry("init");
assert.equal(field.entrySynchronized, false);
assert.equal(projectBattleFieldState(entryCatalog, field.battleEntryContext.state, transportations).invalidContentIds, null);
controlled.push({ name: "initializer-encounter-cannot-invent-current-map-foot", pass: true });
field.finishEncounter(1);
assert.equal(field.entrySynchronized, true);
const exclusions = projectBattleFieldState(entryCatalog, field.battleEntryContext.state, transportations);
assert.deepEqual(exclusions.invalidContentIds, [16, 17, 1309]);
controlled.push({ name: "source-map3-walking-after-completed-entry", invalidContentIds: exclusions.invalidContentIds });
const checkpoint = field.checkpoint(), restored = FieldGame.restore(content, checkpoint);
assert.deepEqual(restored.battleEntryContext, field.battleEntryContext);
assert.equal(restored.move("up"), true);
restored.advance(240);
assert.equal(restored.battleEntryContext.state.footAttributeType, 0);
controlled.push({ name: "entry-proof-restore-and-uniform-movement", pass: true });
const report = { kind: "source-field-entry-context-check", parentSourceSetHash: corpus.manifest.parentSourceSetHash,
  sourceSetHash: corpus.sourceSetHash, nativeReportSha256: createHash("sha256").update(nativeBytes).digest("hex"),
  semanticsVerified: false, maps, probes, controlled, counts: {
    sourceMaps: maps.length, uniformFootDefinitions: maps.filter((map) => map.foot === "uniform-zero").length,
    unresolvedFootDefinitions: maps.filter((map) => map.foot === "unresolved").length,
    inspectedGroups, sourceSavePoints, unknownGroups, controlledQualificationProbes: probes.length, controlledHostChecks: controlled.length },
  limitations: ["Provider compilation and controlled qualification are not playable-map or story coverage.",
    "Save-point callbacks and world attribute grid selection remain unknown; no false default is inserted.",
    "The fixed opening development checkpoint has no completed-map-entry seed and keeps foot context unknown.",
    "No random encounter scheduler or native runtime comparison is included."] };
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ report: reportPath, ...report.counts, semanticsVerified: false }));
