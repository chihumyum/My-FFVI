// Same-build source qualification. The sample IDs are checks, never runtime branches.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
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
const [{ loadCorpus }, { hash }, { compileFieldActorView }, { compileFieldNativeComposition, loadFieldCompositionRenderHost },
  { assertFieldCompositionRenderTargets, fieldCompositionActorTextures, validateFieldNativeComposition,
    prepareFieldCompositionTargets, composeFieldNativePixels },
  { projectFieldActorView }] = await Promise.all([load("compiler/corpus"), load("compiler/content"),
  load("compiler/field-actor-view"), load("compiler/field-native-composition"), load("core/field-native-composition"),
  load("core/field-actor-view")]);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const corpus = await loadCorpus(root), native = JSON.parse(await readFile(root + "build/reports/field-native-composition-native-check.json", "utf8"));
assert.equal(native.kind, "field-native-composition-native"); assert.equal(native.completeMethods, 25);
assert.equal(native.programs.length, 4); assert.equal(native.originalGameExecuted, false); assert.equal(native.gpuExecuted, false);
assert.equal(sha(await readFile(root + "build/runtime/game/GameAssembly.dll")), native.nativeSha256);
const verified = new Set(), cases = [], renderHost = await loadFieldCompositionRenderHost(root, corpus.manifest.sources);
const mediaBytes = await readFile(root + "build/world-media/media.json"), media = JSON.parse(mediaBytes),
  mediaSnapshot = JSON.parse(await readFile(root + "build/world-media/snapshot.json", "utf8"));
assert.equal(mediaSnapshot.files.find((f) => f.file === "media.json").sha256, sha(mediaBytes));
assert.equal(media.parentSourceSetHash, corpus.sourceSetHash); assert.equal(hash(media.sources), media.sourceSetHash);
const decoded = new Map();
async function png(file, expected) {
  assert.ok(!file.includes(".."));
  const bytes = await readFile(root + "build/world-media/" + file);
  assert.equal(sha(bytes), expected); assert.equal(mediaSnapshot.files.find((f) => f.file === file).sha256, expected);
  if (!decoded.has(file)) {
    const result = JSON.parse(execFileSync(root + ".venv/bin/python", ["-c",
      "from PIL import Image;import sys,json,base64;i=Image.open(sys.argv[1]).convert('RGBA');print(json.dumps(dict(width=i.width,height=i.height,data=base64.b64encode(i.tobytes()).decode())))",
      root + "build/world-media/" + file], { maxBuffer: 8 * 1024 * 1024 }));
    decoded.set(file, { width: result.width, height: result.height, data: new Uint8ClampedArray(Buffer.from(result.data, "base64")) });
  }
  return decoded.get(file);
}
const at = (image, x, y) => [...image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];
const actorAsset = media.characters.mo_ff6_p001, actorSprite = actorAsset.sprites.WalkB_00;
assert.ok(actorAsset.animation.data.animation.find((a) => a.name === "WalkB").frames.some((f) => f.sprite_name === "WalkB_00"));
assert.equal(corpus.manifest.sources.find((s) => s.file === actorSprite.source.file).sha256, actorSprite.source.sha256);
assert.equal(sha(await readFile(root + "build/runtime/game/" + actorSprite.source.file)), actorSprite.source.sha256);
verified.add(actorSprite.source.file);
const actorPixels = await png(actorSprite.file, actorSprite.sha256);
let headPixel = null;
for (let y = 0; y < actorPixels.height * 0.75 && headPixel === null; y++) for (let x = 0; x < actorPixels.width; x++) {
  const rgba = at(actorPixels, x, y); if (rgba[3] === 255) { headPixel = { x, y, rgba }; break; }
}
assert.ok(headPixel);
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
  const definition = compileFieldNativeComposition(corpus.manifest.sources, view, tilemap, renderHost);
  validateFieldNativeComposition(definition, view);
  for (const source of definition.sources) {
    assert.equal(corpus.manifest.sources.filter((s) => s.file === source.file && s.sha256 === source.sha256).length, 1);
    if (!verified.has(source.file)) {
      assert.equal(sha(await readFile(root + "build/runtime/game/" + source.file)), source.sha256); verified.add(source.file);
    }
  }
  for (const source of renderHost.sources) if (!verified.has(source.file)) {
    assert.equal(sha(await readFile(root + "build/runtime/game/" + source.file)), source.sha256); verified.add(source.file);
  }
  if (!sourceOnly) {
    assert.deepEqual(published.map.nativeComposition, definition, "The public map must include the current source-bound composition capability");
    assert.deepEqual(published.actorView, view);
  }
  const group = tilemap.data.layers.find((l) => l.name === "TileGroup"), layers = group.layers.map((l) => ({
    name: l.name, width: l.width, height: l.height, nonzeroTiles: l.data.filter((gid) => (gid & 0x0fffffff) !== 0).length }));
  if (id === 3) {
    assert.deepEqual(layers.map((l) => [l.name, l.nonzeroTiles]), [["BottomLayer", 4096], ["GroundLayer", 265], ["UpperLayer", 953], ["CeilLayer", 102]]);
    assert.deepEqual(definition.renderTargets, { upper: "source-rendered", ceil: "source-rendered" });
    assertFieldCompositionRenderTargets(definition);
    const withoutHost = compileFieldNativeComposition(corpus.manifest.sources, view, tilemap);
    assert.throws(() => assertFieldCompositionRenderTargets(withoutHost), /allocation and sampling/);
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
  const sourcePixels = [];
  if (id === 3) for (const [layerName, cell, gid, expectedSource] of [
    ["UpperLayer", [26, 7], 599, [91, 81, 75, 252]], ["CeilLayer", [51, 24], 501, [16, 16, 16, 252]],
  ]) {
    const layer = group.layers.find((l) => l.name === layerName), raw = layer.data[cell[1] * layer.width + cell[0]] >>> 0;
    assert.equal(raw, gid, "the tested source tile has no extra flip flags");
    const set = [...published.map.tilesets].sort((a, b) => b.firstgid - a.firstgid).find((s) => s.firstgid <= gid);
    const texture = published.map.textures[set.image]; assert.ok(texture.startsWith("/world-media/textures/"));
    const file = texture.slice("/world-media/".length), pixels = await png(file, posix.basename(file, ".png"));
    const n = gid - set.firstgid, sx = (n % set.columns) * set.tilewidth, sy = Math.floor(n / set.columns) * set.tileheight;
    assert.deepEqual(at(pixels, sx, sy), expectedSource);
    const q = { image: pixels, layer: layerName, source: { x: sx, y: sy, width: 16, height: 16 },
      // Deliberately controlled 320x180 viewport, using actual source tile and
      // actor pixels. This is not an assertion of a reachable story pose.
      destination: { x: 100, y: 80, width: 16, height: 16 }, flipX: false, flipY: false, diagonal: false, depth: layerName === "UpperLayer" ? 150 : 50 };
    const targets = prepareFieldCompositionTargets(definition, { width: 320, height: 180, tiles: [q] });
    const target = targets[layerName === "UpperLayer" ? "upper" : "ceil"], a = expectedSource[3];
    // Independent byte arithmetic for the source gray clear and SrcAlpha
    // blend, including alpha*alpha. Do not call the implementation's formulas.
    const expectedTarget = expectedSource.map((c, i) => Math.round((c * a + (i === 3 ? 0 : 24) * (255 - a)) / 255));
    assert.deepEqual(at(target, 100, 80), expectedTarget);
    const actor = { image: actorPixels, source: { x: 0, y: 0, width: actorPixels.width, height: actorPixels.height },
      destination: { x: 100 - headPixel.x, y: 80 - headPixel.y, width: actorPixels.width, height: actorPixels.height },
      flipX: false, flipY: false, diagonal: false, depth: q.depth + 10, alpha: 1,
      first: layerName === "UpperLayer" ? targets.upper : targets.ceil, second: null };
    const output = composeFieldNativePixels({ width: 320, height: 180, tiles: [q], actors: [actor] });
    const expectedHead = headPixel.rgba.map((c, i) => Math.round(c + (expectedTarget[i] - c) * expectedTarget[3] / 255));
    assert.deepEqual(at(output, 100, 80), expectedHead);
    const noTarget = composeFieldNativePixels({ width: 320, height: 180, tiles: [q], actors: [{ ...actor, first: null }] });
    assert.deepEqual(at(noTarget, 100, 80), headPixel.rgba); assert.notDeepEqual(expectedHead, headPixel.rgba);
    const cleared = prepareFieldCompositionTargets(definition, { width: 320, height: 180, tiles: [] });
    assert.deepEqual(at(cleared[layerName === "UpperLayer" ? "upper" : "ceil"], 100, 80), [24, 24, 24, 0]);
    sourcePixels.push({ layer: layerName, cell, gid, sourceRGBA: expectedSource, expectedTarget, expectedHead,
      sprite: actorSprite.source, spritePixel: headPixel, controlledViewport: true });
  }
  cases.push({ mapId: id, mapHash: contentHash, tilemap: tilemap.source, sourceContentHash: hash(tilemap.data),
    definitionHash: hash(definition), layers, targets: definition.renderTargets, publishedChecked: !sourceOnly,
    sourcePixels, execution: "ordinary-material-inputs-ready" });
}
const report = { kind: "field-native-composition", parentSourceSetHash: corpus.manifest.parentSourceSetHash,
  sourceSetHash: corpus.sourceSetHash, nativeSha256: native.nativeSha256, nativeReportSha256: sha(await readFile(root + "build/reports/field-native-composition-native-check.json")),
  cases, sourceFilesChecked: verified.size, publishedChecked: sourceOnly ? 0 : cases.length,
  originalGameExecuted: false, gpuExecuted: false, pixelParityVerified: false,
  renderHost, mediaImagesChecked: decoded.size,
  limitations: ["Ordinary 16:9 Upper/Ceil RT provider is source-bound; bird/other aspect and original GPU framebuffer parity are not established.",
    "Ordinary body/head fragments are implemented; native character shadow remains an explicit presentation omission."] };
const output = root + "build/reports/field-native-composition-check.json";
await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ result: "pass", maps: cases.length, sourceFiles: verified.size, publishedChecked: report.publishedChecked,
  nonemptyRenderTargets: "source-normal-16:9", sourcePixelCases: cases.reduce((n, c) => n + c.sourcePixels.length, 0), originalGameExecuted: false }));
