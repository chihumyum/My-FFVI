// Real-source compile and deterministic projection; no original GPU is run.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url)), args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 2 && args[0] === "--compiled-dir");
const compiled = resolve(root, args[1] ?? "dist");
const module = (name) => import(pathToFileURL(resolve(compiled, "src", name + ".js")).href);
const { loadCorpus } = await module("compiler/corpus");
const { bindMapPackages } = await module("compiler/map-package");
const { compileFieldCameraMapRange } = await module("compiler/field-camera");
const { compileFieldBackgroundLayers, loadFieldBackgroundMedia } = await module("compiler/field-background");
const { projectFieldBackground } = await module("core/field-background");
const { verifyContent } = await module("core/content-integrity");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const output = root + "build/reports/field-background-check.json";
await mkdir(root + "build/reports", { recursive: true }); await rm(output, { force: true });
execFileSync(process.execPath, [root + "scripts/check-field-background-native.mjs"], { cwd: root, stdio: "pipe" });
const nativeBytes = await readFile(root + "build/reports/field-background-native-check.json");
const native = JSON.parse(nativeBytes), corpus = await loadCorpus(root);
assert.equal(corpus.manifest.sources.find((s) => s.file === "GameAssembly.dll").sha256, native.nativeSha256);
const assets = (id) => { const matches = corpus.assets.filter((a) => a.id === id); assert.equal(matches.length, 1); return matches[0]; };
const binding = bindMapPackages(corpus.assets, corpus.tables).filter((m) => m.id === "609"); assert.equal(binding.length, 1);
const map = binding[0], tilemap = assets(map.tilemap), defaults = assets(map.groups.entity_default);
const mapRange = compileFieldCameraMapRange(tilemap.data, defaults.data);
assert.deepEqual(mapRange, { x: 0, y: 0, width: 42, height: 32 });
const provider = await loadFieldBackgroundMedia(root, corpus.sourceSetHash);
assert.equal(sha(await readFile(root + "build/field-background-media/media.json")), native.mediaSha256);
const input = { sources: corpus.manifest.sources, tilemap, mapRange, loopType: 0, ...provider };
const result = compileFieldBackgroundLayers(input); assert.deepEqual(result.blockers, []); assert.equal(result.layers.length, 1);
const layer = result.layers[0];
assert.equal(layer.texture.source.objectId, "8345249061274128293");
assert.equal(layer.texture.textureSource.objectId, "4542441163904577767");
assert.deepEqual(layer.mapSize, { width: 672, height: 512 }); assert.deepEqual(layer.size, { width: 1920, height: 512 });
assert.deepEqual(layer.offset, { x: -864, y: -24 }); assert.deepEqual(layer.manualSpeed, { x: 0.5, y: 0.5 });
assert.deepEqual(layer.renderHost.renderCamera, { x: 0, y: 0 }); assert.deepEqual(layer.renderHost.rendererWorld, { x: 0, y: 0 });
const view = { scrollCamera: { x: 80, y: 112 }, renderCamera: layer.renderHost.renderCamera,
  rendererWorld: layer.renderHost.rendererWorld, screen: { width: 512, height: 288 }, renderTarget: { width: 512, height: 288 } };
const first = projectFieldBackground(layer, view);
// Independent source arithmetic: U=.5*(80+864+336-160)-96=464;
// V=.5*(256-112-144)+112-24+256-144=200. PNG top=512-288-200=24.
assert.deepEqual(first.uvOffset, { x: 464 / 512, y: 200 / 512 });
assert.deepEqual(first.patches, [
  { source: { x: 464, y: 24, width: 48, height: 288 }, destination: { x: 0, y: 0, width: 48, height: 288 } },
  { source: { x: 0, y: 24, width: 464, height: 288 }, destination: { x: 48, y: 0, width: 464, height: 288 } },
]);
const samples = [112, 56, 0, -56, -112].map((y) => {
  const projection = projectFieldBackground(layer, { ...view, scrollCamera: { x: 80, y } });
  assert.equal(projection.uvOffset.y * 512, 144 + y / 2);
  assert.equal(projection.patches.reduce((sum, p) => sum + p.destination.width * p.destination.height, 0), 512 * 288);
  assert.deepEqual(projection.localOffset, { x: 0, y: 0 }); return { y, ...projection };
});
const blocked = [];
for (const [name, mutate] of [
  ["unknown horizontal fixed-scroll provider", (l) => { l.properties.find((p) => p.name === "h_manual_scroll").value = false; }],
  ["unrecovered auto scroll", (l) => { l.properties.push({ name: "auto_scroll", type: "bool", value: true }); }],
  ["unrecovered border mesh", (l) => { l.properties.find((p) => p.name === "h_left_width").value = 16; }],
]) {
  const altered = structuredClone(tilemap); mutate(altered.data.layers.find((l) => l.id === layer.layerId));
  const outcome = compileFieldBackgroundLayers({ ...input, tilemap: altered });
  assert.equal(outcome.layers.length, 0); assert.equal(outcome.blockers.length, 1); blocked.push({ name, reason: outcome.blockers[0].reason });
}
const mediaCount = Object.values(provider.media.images).reduce((n, group) => n + Object.keys(group).length, 0); assert.equal(mediaCount, 49);
// The current public world must carry the same source-bound host and texture.
const world = await verifyContent(JSON.parse(await readFile(root + "build/world/catalog.json", "utf8")));
assert.equal(world.sourceSetHash, corpus.sourceSetHash); const indexed = world.maps["609"];
assert.match(indexed.url, /^\/world\/maps\/609\.json$/);
const published = await verifyContent(JSON.parse(await readFile(root + "build" + indexed.url, "utf8")), indexed.contentHash);
assert.deepEqual(published.map.backgrounds, result.layers);
const report = { kind: "field-background-source", sourceSetHash: corpus.sourceSetHash,
  nativeReceiptSha256: sha(nativeBytes), mediaSourceSetHash: provider.media.sourceSetHash,
  counts: { textures: mediaCount, admittedSourceBackgrounds: result.layers.length, cameraSamples: samples.length, rejectionBranches: blocked.length },
  tilemap: tilemap.source, layer, samples, blocked, published: { worldHash: world.contentHash, mapHash: published.contentHash },
  originalGameExecuted: false, gpuExecuted: false, browserAccepted: false,
  limits: ["center repeat only", "ordinary fresh normal render host", "manual both axes", "no borders/auto-scroll/loops/custom shader", "not full-story admission"] };
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ result: "pass", ...report.counts, publishedWorldBinding: true, originalGameExecuted: false, gpuExecuted: false }));
