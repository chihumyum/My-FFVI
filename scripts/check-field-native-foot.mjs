// Raw native foot capability is checked independently from the encounter foot
// provider. Current source packages are verified; no original game is run.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 2 && args[0] === "--compiled-dir"), "Use --compiled-dir <directory>");
const compiled = resolve(root, args[1] ?? "dist"), sha = (data) => createHash("sha256").update(data).digest("hex");
const module = (name) => import(pathToFileURL(resolve(compiled, "src", name + ".js")).href);
const output = resolve(root, "build/reports/field-native-foot-check.json");
await mkdir(resolve(root, "build/reports"), { recursive: true });
const report = { formatVersion: 1, lane: "source-package-raw-native-foot-capability", status: "running",
  semanticsVerified: false, originalGameExecuted: false, browserExecuted: false,
  packages: [], cases: [], maps: [], blockedAttributeReference: null,
  limitations: ["A map's encounter default never grants its actor raw-foot capability.",
    "Nonempty Attribute references remain blocked; no grid, collision, layer or foot ID is substituted.",
    "This checker queries bound capabilities; it does not execute map transitions, shaders or the original DLL."] };
let stage = "load-runtime";
const check = (name, run) => { run(); report.cases.push({ name, pass: true }); };
try {
  const { verifyContent } = await module("core/content-integrity");
  const { canonical } = await module("core/canonical");
  const { readFieldNativeFoot, validateFieldNativeFoot } = await module("core/field-native-foot");
  const { compileFieldNativeFoot } = await module("compiler/field-native-foot");
  const { compileFieldEntryContext } = await module("compiler/field-entry-context");
  const { fieldPuppetSemiTransparent } = await module("core/field-puppet-effects");
  const { loadCorpus } = await module("compiler/corpus");
  const { hash } = await module("compiler/content");
  const corpus = await loadCorpus(root);
  const readPackage = async (file, expected) => {
    const bytes = await readFile(resolve(root, file)), value = await verifyContent(JSON.parse(bytes), expected);
    report.packages.push({ file, contentHash: value.contentHash, fileSha256: sha(bytes) }); return value;
  };
  stage = "source-provenance";
  const world = await readPackage("build/world/catalog.json");
  assert.equal(world.sourceSetHash, corpus.sourceSetHash);
  assert.equal(world.parentSourceSetHash, corpus.manifest.parentSourceSetHash);
  report.sourceSetHash = corpus.sourceSetHash; report.parentSourceSetHash = corpus.manifest.parentSourceSetHash;
  const nativePath = "build/reports/field-native-foot-native-check.json", nativeBytes = await readFile(resolve(root, nativePath));
  const native = JSON.parse(nativeBytes);
  check("the capability is backed by complete static native evidence from the supplied source set", () => {
    assert.equal(native.semanticsVerified, false); assert.equal(native.methods.length, 6); assert.equal(native.rawRanges.length, 3);
    assert.ok(corpus.manifest.sources.some((entry) => entry.file === "GameAssembly.dll" && entry.sha256 === native.nativeSha256));
  });
  report.native = { file: nativePath, sha256: sha(nativeBytes), nativeSha256: native.nativeSha256,
    methods: native.methods.length, rawRanges: native.rawRanges.length, semanticsVerified: false };

  const definitions = new Map(), inputs = [];
  for (const mapId of [3, 609, 572]) {
    stage = "verify-map-" + mapId;
    const rows = corpus.tables["map.csv"].filter((row) => Number(row.id) === mapId); assert.equal(rows.length, 1);
    const row = rows[0], packages = corpus.assets.filter((asset) => asset.kind === "map-package" &&
      asset.data.asset_group_name === row.asset_name);
    assert.equal(packages.length, 1);
    const pkg = packages[0], before = canonical(pkg);
    const definition = compileFieldNativeFoot(pkg.data, pkg.source, row.map_name);
    assert.equal(canonical(pkg), before);
    const indexed = world.maps[String(mapId)]; assert.ok(indexed); assert.match(indexed.url, /^\/world\/maps\/[0-9]+\.json$/);
    const map = await readPackage("build" + indexed.url, indexed.contentHash);
    check("map " + mapId + " publishes the exact package-bound raw foot definition", () => {
      assert.equal(map.mapId, mapId); assert.equal(map.sourceSetHash, corpus.sourceSetHash);
      assert.equal(map.parentSourceSetHash, corpus.manifest.parentSourceSetHash);
      assert.deepEqual(map.nativeFoot, definition, "Rebuild world with the source native-foot compiler");
      validateFieldNativeFoot(definition, row.map_name);
      const index = Number(definition.source.pointer.split("/")[2]);
      assert.equal(pkg.data.map[index].name, row.map_name);
      assert.equal(Object.hasOwn(pkg.data.map[index], "attribute"), false);
      assert.equal(definition.attributeRepresentation, "missing");
      assert.equal(definition.source.objectId, pkg.source.objectId);
    });
    definitions.set(mapId, definition); inputs.push({ pkg, before });
    report.maps.push({ mapId, mapName: row.map_name, source: definition.source, packageDataHash: hash(pkg.data),
      monsterSetId: Number(row.monster_set_id), definition, definitionHash: hash(definition) });
  }
  check("Map3 encounter default and native raw foot are independently bound", () => {
    const encounter = compileFieldEntryContext(corpus.assets, corpus.tables, 3);
    assert.equal(encounter.foot.kind, "uniform-zero");
    assert.equal(encounter.foot.basis, "default-monster-set");
    assert.equal(definitions.get(3).basis, "package-attribute-absent");
    assert.equal(encounter.foot.monsterSetId, 129);
  });
  const positions = [{ x: 0, y: 0, z: 0 }, { x: 88, y: 136, z: 349 },
    { x: -1024.5, y: 8192.25, z: -16 }, { x: 1.5, y: 2.25, z: 3.125 }];
  check("absent Attribute yields raw zero at finite native positions without copying actor ownership", () => {
    for (const definition of definitions.values()) for (const position of positions) {
      const before = canonical({ definition, position });
      assert.equal(readFieldNativeFoot(definition, position), 0);
      for (const transportationType of [null, 1, 12])
        assert.equal(fieldPuppetSemiTransparent(transportationType, readFieldNativeFoot(definition, position)), false);
      assert.equal(canonical({ definition, position }), before);
    }
  });
  check("source map identity and unknown provider cannot borrow another map's zero result", () => {
    assert.throws(() => validateFieldNativeFoot(definitions.get(3), definitions.get(609).mapName), /another source map/);
    assert.throws(() => readFieldNativeFoot(undefined, positions[0]), /unavailable/);
  });
  stage = "known-attribute-grid-remains-blocked";
  const grids = corpus.assets.filter((asset) => asset.kind === "map-package").flatMap((pkg) =>
    pkg.data.map.filter((map) => typeof map.attribute === "string" && map.attribute !== "").map((map) => ({ pkg, map })));
  assert.ok(grids.length > 0);
  const actual = grids[0];
  check("an actual nonempty source Attribute reference remains explicit unsupported input", () => {
    assert.throws(() => compileFieldNativeFoot(actual.pkg.data, actual.pkg.source, actual.map.name), /attribute grid is not implemented/);
    report.blockedAttributeReference = { source: actual.pkg.source, mapName: actual.map.name, reference: actual.map.attribute };
  });
  check("source inputs remain unchanged after both admitted and rejected queries", () => {
    for (const input of inputs) assert.equal(canonical(input.pkg), input.before);
  });
  report.implementation = await Promise.all(["core/field-native-foot", "compiler/field-native-foot"].map(async (name) => ({
    file: "src/" + name + ".ts", sha256: sha(await readFile(resolve(root, "src", name + ".ts"))),
    compiledSha256: sha(await readFile(resolve(compiled, "src", name + ".js"))),
  })));
  report.checkerSha256 = sha(await readFile(fileURLToPath(import.meta.url)));
  report.counts = { cases: report.cases.length, verifiedPackages: report.packages.length, sourceMaps: report.maps.length,
    rawFootQueries: definitions.size * positions.length, explicitlyBlockedSourceReferences: 1 };
  report.status = "pass";
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ status: report.status, ...report.counts, semanticsVerified: false,
    reportSha256: sha(await readFile(output)) }));
} catch (error) {
  report.status = "failed"; report.failedStage = stage;
  report.error = { name: error.name, message: error.message, stack: error.stack };
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  throw error;
}
