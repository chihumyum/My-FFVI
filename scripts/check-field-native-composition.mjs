// Same-build source qualification. The sample IDs are checks, never runtime branches.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, posix, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url)), args = process.argv.slice(2);
let compiled = resolve(root, "dist"), sourceOnly = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--compiled-dir" && args[i + 1]) compiled = resolve(root, args[++i]);
  else if (args[i] === "--source-only") sourceOnly = true;
  else throw new Error("Use [--compiled-dir <directory>] [--source-only]");
}
const load = (path) => import(pathToFileURL(resolve(compiled, "src", path + ".js")).href);
const [{ loadCorpus }, { hash }, { compileFieldActorView }, { compileFieldNativeComposition },
  { assertFieldCompositionRenderTargets, fieldCompositionActorTextures, validateFieldNativeComposition },
  { projectFieldActorView }] = await Promise.all([load("compiler/corpus"), load("compiler/content"),
  load("compiler/field-actor-view"), load("compiler/field-native-composition"), load("core/field-native-composition"),
  load("core/field-actor-view")]);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const corpus = await loadCorpus(root), native = JSON.parse(await readFile(root + "build/reports/field-native-composition-native-check.json", "utf8"));
assert.equal(native.kind, "field-native-composition-native"); assert.equal(native.completeMethods, 19);
assert.equal(native.programs.length, 4); assert.equal(native.originalGameExecuted, false); assert.equal(native.gpuExecuted, false);
assert.equal(sha(await readFile(root + "build/runtime/game/GameAssembly.dll")), native.nativeSha256);
const verified = new Set(), cases = [];
for (const id of [3, 609]) {
  const published = JSON.parse(await readFile(root + `build/world/maps/${id}.json`, "utf8"));
  const { contentHash, ...body } = published; assert.equal(hash(body), contentHash);
  assert.equal(published.parentSourceSetHash, corpus.manifest.parentSourceSetHash);
  const matches = corpus.assets.filter((a) => a.source.assetPath === published.map.source.assetPath);
  assert.equal(matches.length, 1); const tilemap = matches[0];
  assert.deepEqual(tilemap.source, published.map.source);
  const packages = corpus.assets.filter((a) => a.source.assetPath === posix.dirname(posix.dirname(tilemap.source.assetPath)) + "/package.json");
  assert.equal(packages.length, 1); const mapPackage = packages[0];
  const view = compileFieldActorView(corpus.manifest.sources, tilemap, mapPackage, published.partyEntry.mapRange);
  const definition = compileFieldNativeComposition(corpus.manifest.sources, view, tilemap);
  validateFieldNativeComposition(definition, view);
  for (const source of definition.sources) {
    assert.equal(corpus.manifest.sources.filter((s) => s.file === source.file && s.sha256 === source.sha256).length, 1);
    if (!verified.has(source.file)) {
      assert.equal(sha(await readFile(root + "build/runtime/game/" + source.file)), source.sha256); verified.add(source.file);
    }
  }
  if (!sourceOnly) {
    assert.deepEqual(published.map.nativeComposition, definition, "The public map must include the current source-bound composition capability");
    assert.deepEqual(published.actorView, view);
  }
  const group = tilemap.data.layers.find((l) => l.name === "TileGroup"), layers = group.layers.map((l) => ({
    name: l.name, width: l.width, height: l.height, nonzeroTiles: l.data.filter((gid) => (gid & 0x0fffffff) !== 0).length }));
  if (id === 3) {
    assert.deepEqual(layers.map((l) => [l.name, l.nonzeroTiles]), [["BottomLayer", 4096], ["GroundLayer", 265], ["UpperLayer", 953], ["CeilLayer", 102]]);
    assert.deepEqual(definition.renderTargets, { upper: "unresolved", ceil: "unresolved" });
    assert.throws(() => assertFieldCompositionRenderTargets(definition), /allocation and sampling/);
  } else {
    assert.deepEqual(layers.map((l) => [l.name, l.nonzeroTiles]), [["BottomLayer", 392]]);
    assert.deepEqual(definition.renderTargets, { upper: "disabled", ceil: "disabled" });
    assertFieldCompositionRenderTargets(definition);
    assert.deepEqual(fieldCompositionActorTextures(definition, 9), { first: null, second: null });
  }
  for (const layer of [9, 10, 11, 12]) assert.deepEqual(projectFieldActorView(definition.view, layer), projectFieldActorView(view, layer));
  const changed = structuredClone(tilemap); changed.data.layers.find((l) => l.name === "TileGroup").layers[0].data[0] ^= 1;
  assert.throws(() => compileFieldNativeComposition(corpus.manifest.sources, view, changed), /bound actor view/);
  const missingShader = corpus.manifest.sources.filter((s) => !s.file.includes("shaders_assets_all_"));
  assert.throws(() => compileFieldNativeComposition(missingShader, view, tilemap), /shader source/);
  const foreign = structuredClone(view); foreign.sources[0].contentHash = "0".repeat(64);
  assert.throws(() => validateFieldNativeComposition(definition, foreign), /actor view/);
  cases.push({ mapId: id, mapHash: contentHash, tilemap: tilemap.source, sourceContentHash: hash(tilemap.data),
    definitionHash: hash(definition), layers, targets: definition.renderTargets, publishedChecked: !sourceOnly,
    execution: id === 3 ? "blocked-nonempty-render-target" : "ordinary-material-inputs-ready" });
}
const report = { kind: "field-native-composition", parentSourceSetHash: corpus.manifest.parentSourceSetHash,
  sourceSetHash: corpus.sourceSetHash, nativeSha256: native.nativeSha256, nativeReportSha256: sha(await readFile(root + "build/reports/field-native-composition-native-check.json")),
  cases, sourceFilesChecked: verified.size, publishedChecked: sourceOnly ? 0 : cases.length,
  originalGameExecuted: false, gpuExecuted: false, pixelParityVerified: false,
  limitations: ["Nonempty Upper/Ceil camera allocation and sampling are not inferred from layer order.",
    "Ordinary body/head fragments are implemented; native character shadow remains an explicit presentation omission."] };
const output = root + "build/reports/field-native-composition-check.json";
await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ result: "pass", maps: cases.length, sourceFiles: verified.size, publishedChecked: report.publishedChecked,
  nonemptyRenderTargets: "blocked", originalGameExecuted: false }));
