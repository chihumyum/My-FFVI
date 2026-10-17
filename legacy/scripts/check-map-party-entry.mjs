// Source metadata and controlled MapSetup projections. No Windows execution,
// story-route traversal, browser rendering or playable-map coverage is implied.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 2 && args[0] === "--build-dir"));
const build = resolve(root, args[1] ?? "dist");
const module = (name) => import(pathToFileURL(build + "/src/" + name));
const { loadSystemSource } = await module("compiler/system-source.js");
const { loadCorpus } = await module("compiler/corpus.js");
const { hash } = await module("compiler/content.js");
const { bindMapPackages } = await module("compiler/map-package.js");
const { compileEntityGroup } = await module("compiler/entity-group.js");
const { compileMapPartyEntry, compileNarsheMapEntrySeed } = await module("compiler/map-party-entry.js");
const { compilePartyActorCatalog, compileNarshePartyActorCheckpoint } = await module("compiler/party-actors.js");
const { compileTransportationCatalog, compileNarsheTransportationCheckpoint } = await module("compiler/transportation.js");
const { prepareMapPartyEntry, readMapPartySwitching } = await module("core/map-party-entry.js");
const { EventState, UnknownEventValue } = await module("core/event-state.js");
const { Transportations } = await module("core/transportation.js");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const reportPath = root + "build/reports/map-party-entry-check.json";
await rm(reportPath, { force: true });
execFileSync(process.execPath, [root + "scripts/check-map-party-entry-native.mjs"], { cwd: root, stdio: "pipe" });
const nativeBytes = await readFile(root + "build/reports/map-party-entry-native-check.json");
const native = JSON.parse(nativeBytes);
assert.equal(native.semanticsVerified, false);
const corpus = await loadCorpus(root);
assert.equal(corpus.manifest.sources.find((s) => s.file === "GameAssembly.dll")?.sha256, native.nativeSha256);
const source = await loadSystemSource(root, corpus.manifest.parentSourceSetHash);
assert.equal(source.sourceSetHash, corpus.sourceSetHash);
const seed = compileNarsheMapEntrySeed(corpus.assets);
assert.deepEqual(seed.values, [{ ref: { category: "ScenarioFlag3", index: 45 }, value: 0 }]);
const prelude = seed.scripts.map((s) => corpus.assets.find((a) => a.source.assetPath === s.source.assetPath));
const scenarioWrites = prelude.flatMap((asset) => asset.data.Mnemonics.flatMap((m, index) =>
  ["SetFlag", "ResetFlag", "FlipFlag", "Calc"].includes(m.mnemonic) && m.operands.sValues[0]?.startsWith("ScenarioFlag")
    ? [{ script: asset.source.assetPath, index, mnemonic: m.mnemonic, category: m.operands.sValues[0], cell: m.operands.iValues[0] }] : []));
assert.deepEqual(scenarioWrites.map((w) => [w.index, w.mnemonic, w.category, w.cell]),
  [[12, "SetFlag", "ScenarioFlag1", 0], [13, "SetFlag", "ScenarioFlag4", 132]]);
assert.throws(() => compileNarsheMapEntrySeed(corpus.assets.filter((a) => a !== prelude[0])));
const changedPrelude = structuredClone(prelude);
changedPrelude[5].data.Mnemonics[12].operands.sValues[0] = "ScenarioFlag3";
assert.throws(() => compileNarsheMapEntrySeed(changedPrelude), /source needs review/);
const byId = new Map(corpus.assets.map((a) => [a.id, a]));
const maps = [], definitions = new Map();
let sourcePoints = 0;
for (const binding of bindMapPackages(corpus.assets, corpus.tables)) {
  const group = byId.get(binding.groups.entity_default), tile = byId.get(binding.tilemap);
  try {
    assert.ok(group && tile, "missing default source group or geometry");
    const entities = compileEntityGroup("entity_default", group, corpus.tables, corpus.messages);
    const { definition } = compileMapPartyEntry(corpus.tables, Number(binding.id), tile.data, group, entities.entities);
    // Read the original point objects separately from the reduced entity shape.
    for (const point of definition.pointIns) {
      const indices = point.source.pointer.match(/^\/layers\/(\d+)\/objects\/(\d+)$/);
      assert.ok(indices);
      const layer = group.data.layers[Number(indices[1])], raw = layer.objects[Number(indices[2])];
      const p = Object.fromEntries(raw.properties.map((p) => [p.name, p.value]));
      assert.equal(point.id, Number(p.object_id));
      assert.equal(point.x, raw.x / 16);
      assert.equal(point.y, raw.y / 16 - (raw.gid ? raw.height / 16 : 0));
      assert.equal(point.layer, { BottomObject: 0, GroundObject: 1, UpperObject: 2, CeilObject: 3 }[layer.name]);
      assert.equal(point.direction, { 1: "up", 2: "right", 4: "down", 8: "left" }[p.direction]);
      assert.equal(point.linkObject, Number(p.link_object_id ?? 0));
      sourcePoints++;
    }
    definitions.set(Number(binding.id), definition);
    maps.push({ mapId: Number(binding.id), metadata: "compiled", definitionHash: hash(definition),
      pointCount: definition.pointIns.length, unrelatedEntityBlockers: entities.blockers.length });
  } catch (error) {
    maps.push({ mapId: Number(binding.id), metadata: "blocked", reason: error.message });
  }
}
const misc = corpus.assets.filter((a) => a.source.assetPath.endsWith("/serial_misc_assets.json"));
assert.equal(misc.length, 1);
const catalog = compilePartyActorCatalog(corpus.tables, misc[0].data).catalog;
const members = [[1, 19], [31, 18], [32, 18]].map(([sourceId, jobId], index) => ({
  id: `source:${sourceId}`, index, sourceId, jobId, enabled: true, row: "front", conditionIds: [],
}));
const initial = compileNarshePartyActorCheckpoint(catalog, corpus.assets, members);
const transportCatalog = compileTransportationCatalog(source.reader, corpus.tables["transportation.csv"].map((r) => Number(r.id))).catalog;
const transportCheckpoint = compileNarsheTransportationCheckpoint(transportCatalog, corpus.assets);
const transportation = new Transportations(transportCatalog);
const event = new EventState();
for (const { ref, value } of [...seed.values, ...transportCheckpoint.knownReleaseFlags]) event.write(ref, value);
const read = (ref) => { try { return event.read(ref); } catch (e) { if (e instanceof UnknownEventValue) return null; throw e; } };
const controlled = [], blocked = [];
for (const mapId of [3, 4, 5, 6]) {
  const definition = definitions.get(mapId);
  assert.ok(definition, "source entry metadata must compile: " + mapId);
  const transport = transportation.projectMapEntry({ currentId: transportCheckpoint.identity.id,
    loadId: transportation.pointInIdentity().id, mapId, stayMapIds: {}, availability: transportation.availability(read) });
  assert.equal(transport.currentId, 6);
  for (const point of definition.pointIns) {
    const input = { definition, entrance: point.id, mapViewType: 0,
      prior: { kind: "field-party-actors-v1", context: initial.context, playerAssetCacheId: initial.playerAssetCacheId },
      playerVisible: false, party: { activeMembers: members, parties: [members, [], []] },
      transportation: transportation.identity(transport.currentId), canPartySwitching: readMapPartySwitching(read) };
    const before = JSON.stringify(input);
    const plan = prepareMapPartyEntry(catalog, input);
    assert.deepEqual([plan.player.x, plan.player.y, plan.player.layer, plan.player.direction], [point.x, point.y, point.layer, point.direction]);
    assert.equal(plan.player.visible, false);
    assert.equal(plan.player.asset, "mo_ff6_p001");
    assert.equal(plan.player.mount, "mo_ff6_v006_c00");
    assert.deepEqual(plan.checkpoint.context.puppets, initial.context.puppets);
    assert.deepEqual(plan.ownedConditionChanges, []);
    const offset = misc[0].data.character_viewpoint_offset_list.find((r) => r.asset_id === 38);
    assert.ok(offset);
    assert.deepEqual(plan.cameraOffset, { x: Math.fround(offset.viewpoint_offsetx), y: Math.fround(offset.viewpoint_offsety) });
    assert.equal(JSON.stringify(input), before);
    controlled.push({ mapId, entrance: point.id, player: plan.player, transport: plan.checkpoint.context.currentTransport,
      source: point.source, hiddenActorCount: plan.hiddenActorIds.length, cameraOffset: plan.cameraOffset });
  }
}
const input = { definition: definitions.get(4), entrance: 1, mapViewType: 0,
  prior: { kind: "field-party-actors-v1", context: initial.context, playerAssetCacheId: initial.playerAssetCacheId },
  playerVisible: true, party: { activeMembers: members, parties: [members, [], []] },
  transportation: transportCheckpoint.identity, canPartySwitching: false };
for (const [name, mutate] of [
  ["unknown-party-flag", (x) => { x.canPartySwitching = null; }],
  ["multi-party-placement", (x) => { x.canPartySwitching = true; }],
  ["saved-position-path", (x) => { x.entrance = -1; }],
  ["unimplemented-view", (x) => { x.mapViewType = 1; }],
  ["linked-open-trigger", (x) => { x.definition.pointIns[0].linkObject = 999; }],
  ["missing-condition-provider", (x) => { x.prior.context.conditionResidents = null; }],
  ["wrong-transport-identity", (x) => { x.transportation.id = 38; }],
]) {
  const bad = structuredClone(input); mutate(bad);
  const before = JSON.stringify(bad);
  assert.throws(() => prepareMapPartyEntry(catalog, bad));
  assert.equal(JSON.stringify(bad), before);
  blocked.push({ name, pass: true });
}
const poison = corpus.tables["condition.csv"].find((r) => Number(r.condition_type) === 5);
assert.ok(poison);
const poisoned = structuredClone(input);
poisoned.party.activeMembers[0].conditionIds = [Number(poison.id)];
poisoned.party.parties[0][0].conditionIds = [Number(poison.id)];
assert.deepEqual(prepareMapPartyEntry(catalog, poisoned).ownedConditionChanges, []);
assert.deepEqual(poisoned.party.activeMembers[0].conditionIds, [Number(poison.id)]);
const report = {
  lane: "source-map-party-entry-controlled-projection", sourceSetHash: corpus.sourceSetHash,
  parentSourceSetHash: corpus.manifest.parentSourceSetHash,
  nativeReportSha256: sha(nativeBytes), bootstrapSeed: seed, scenarioWrites,
  metadata: { maps, sourcePoints }, controlled, blocked,
  conditionPersistence: { sourceId: Number(poison.id), type: 5, unchanged: true },
  semanticsVerified: false,
  doesNotEstablish: ["original-game-execution", "browser-rendering", "complete-prelude-execution", "script-reachability-to-probe-maps", "playable-map-coverage", "multi-party-placement", "companion-lifecycle", "full-game-migration"],
};
const output = JSON.stringify(report, null, 2) + "\n";
await writeFile(reportPath, output);
console.log(JSON.stringify({ metadataCompiled: maps.filter((m) => m.metadata === "compiled").length,
  metadataBlocked: maps.filter((m) => m.metadata === "blocked").length,
  sourcePoints, controlled: controlled.length, rejectedDependencies: blocked.length,
  reportSha256: sha(output), semanticsVerified: false }, null, 2));
