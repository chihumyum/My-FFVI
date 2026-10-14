import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir, readlink, realpath } from "node:fs/promises";
import { isAbsolute, posix, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const repository = resolve(import.meta.dirname, "..");
const SNAPSHOTS = ["corpus", "battle", "field", "world-media", "field-background-media", "map-ui", "bgm", "environment", "se"];
const HASH = /^[a-f0-9]{64}$/;
const sha = value => createHash("sha256").update(value).digest("hex");
const digest = value => sha(JSON.stringify(value));

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid " + label);
  return value;
}
function exact(value, keys, label) {
  object(value, label);
  if (Object.keys(value).sort().join(",") !== keys.split(",").sort().join(",")) throw new Error("Invalid " + label + " fields");
}
function hash(value, label) {
  if (typeof value !== "string" || !HASH.test(value)) throw new Error("Invalid " + label + " digest");
}
function filePath(root, path) {
  if (typeof path !== "string" || !path || path.includes("\\") || path.includes("\0")) throw new Error("Invalid input path");
  if (isAbsolute(path)) {
    if (resolve(path) !== path) throw new Error("Noncanonical absolute input path");
    return path;
  }
  if (posix.normalize(path) !== path || path.split("/").some(part => !part || part === "." || part === ".."))
    throw new Error("Unsafe relative input path");
  return resolve(root, path);
}
function displayPath(root, file) {
  const path = relative(root, file);
  return path && path !== ".." && !path.startsWith(".." + sep) && !isAbsolute(path) ? path.split(sep).join("/") : file;
}

/** Hash one file at a time; large media snapshots never have a second retained
 * in-memory byte owner. Bind the logical path's real target as well as bytes. */
async function fingerprint(root, file, expected) {
  const original = await realpath(file), stat = await lstat(original);
  if (!stat.isFile()) throw new Error("Input is not a file: " + file);
  const hasher = createHash("sha256"); let bytes = 0;
  for await (const chunk of createReadStream(file)) { hasher.update(chunk); bytes += chunk.length; }
  const sha256 = hasher.digest("hex");
  if (bytes !== stat.size || await realpath(file) !== original || expected !== undefined && expected !== sha256)
    throw new Error("Source prerequisite input changed: " + file);
  return { path: displayPath(root, file), sha256, bytes, realPath: original };
}

/** Names, types and symlink destinations detect added/removed dependencies.
 * Traversal does not follow directory symlinks into an unbounded source tree. */
async function directoryEntries(directory) {
  const entries = [], files = [];
  const walk = async (path, prefix) => {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = prefix ? prefix + "/" + entry.name : entry.name, file = resolve(path, entry.name);
      if (entry.isDirectory()) { entries.push([name, "directory"]); await walk(file, name); }
      else if (entry.isFile()) { entries.push([name, "file"]); files.push(file); }
      else if (entry.isSymbolicLink()) { entries.push([name, "symlink", await readlink(file)]); files.push(file); }
      else throw new Error("Unsupported source input directory entry: " + file);
    }
  };
  entries.push([".", "real-directory", await realpath(directory)]);
  await walk(directory, "");
  return { entriesDigest: digest(entries), files };
}

function snapshotManifest(raw) {
  exact(raw, "formatVersion,files", "source snapshot");
  if (raw.formatVersion !== 1 || !Array.isArray(raw.files) || !raw.files.length) throw new Error("Invalid source snapshot");
  const seen = new Set();
  for (const item of raw.files) {
    exact(item, "file,sha256", "source snapshot file"); hash(item.sha256, "source snapshot");
    if (typeof item.file !== "string" || isAbsolute(item.file) || item.file.includes("\\") || item.file.includes("\0") ||
        posix.normalize(item.file) !== item.file || item.file.split("/").some(part => !part || part === "." || part === "..") ||
        seen.has(item.file)) throw new Error("Unsafe or duplicate source snapshot file");
    seen.add(item.file);
  }
  return raw;
}

function compilerIdentity(files, compiledDir, root) {
  const prefix = resolve(compiledDir, "src") + sep;
  const code = files.filter(file => filePath(root, file.path).startsWith(prefix) && file.path.endsWith(".js"))
    .map(file => ({ path: relative(compiledDir, filePath(root, file.path)).split(sep).join("/"), sha256: file.sha256, bytes: file.bytes }))
    .sort((a, b) => a.path.localeCompare(b.path));
  if (!code.length) throw new Error("Missing compiled source prerequisite modules");
  return digest(code);
}

async function readLockedJson(inputs, root, path) {
  const file = filePath(root, path), input = inputs.files.find(item => filePath(root, item.path) === file);
  if (!input || await realpath(file) !== input.realPath) throw new Error("Unbound source prerequisite JSON: " + path);
  const bytes = await readFile(file);
  if (bytes.length !== input.bytes || sha(bytes) !== input.sha256) throw new Error("Changed source prerequisite JSON: " + path);
  return JSON.parse(bytes.toString("utf8"));
}

async function modules(compiledDir) {
  const load = name => import(pathToFileURL(resolve(compiledDir, "src", name + ".js")).href);
  const [content, integrity, world, newGame, framework, sourceCatalog, composition] = await Promise.all([
    load("compiler/content"), load("core/content-integrity"), load("compiler/world"), load("compiler/source-new-game"),
    load("compiler/framework-content"), load("core/source-catalog"), load("core/field-native-composition"),
  ]);
  return { ...content, ...integrity, ...world, ...newGame, ...framework, ...sourceCatalog, ...composition };
}

/** Capture exactly the current compiler's input domain. Raw-source exports
 * retain their original source fingerprints; this does not hash all Unity
 * bundles or claim all source files are live-verified. */
export async function captureSourcePrerequisiteInputs({ root = repository, compiledDir = "dist" } = {}) {
  root = resolve(root); compiledDir = resolve(root, compiledDir);
  const files = [], directories = [], recorded = new Set();
  const add = async (file, expected) => {
    file = resolve(file);
    if (recorded.has(file)) {
      if (expected !== undefined && files.find(item => filePath(root, item.path) === file).sha256 !== expected)
        throw new Error("Conflicting source prerequisite digest: " + file);
      return;
    }
    files.push(await fingerprint(root, file, expected)); recorded.add(file);
  };
  const directory = async path => {
    const value = await directoryEntries(path);
    directories.push({ path: displayPath(root, path), entriesDigest: value.entriesDigest });
    return value.files;
  };
  // Lock all emitted application modules, including compiler/core and their
  // field/contracts imports. Tests and unrelated reports are outside this lock.
  for (const file of await directory(resolve(compiledDir, "src"))) if (file.endsWith(".js")) await add(file);
  await add(resolve(import.meta.dirname, "compile-source-prerequisites.mjs"));
  const api = await modules(compiledDir);
  for (const name of SNAPSHOTS) {
    const path = resolve(root, "build", name); await directory(path);
    const manifestPath = resolve(path, "snapshot.json"); await add(manifestPath);
    const manifest = snapshotManifest(JSON.parse(await readFile(manifestPath, "utf8")));
    for (const item of manifest.files) await add(resolve(path, item.file), item.sha256);
  }
  await add(resolve(root, "build/game/source-catalog.json"));
  const hosts = new Map();
  for (const source of api.ordinaryFieldCompositionRenderHost().sources) {
    if (hosts.has(source.file) && hosts.get(source.file) !== source.sha256) throw new Error("Ambiguous original composition input");
    hosts.set(source.file, source.sha256);
  }
  for (const [file, expected] of hosts) await add(resolve(root, "build/runtime/game", file), expected);
  files.sort((a, b) => a.path.localeCompare(b.path)); directories.sort((a, b) => a.path.localeCompare(b.path));
  const corpus = JSON.parse(await readFile(resolve(root, "build/corpus/corpus.json"), "utf8"));
  hash(corpus.sourceSetHash, "corpus source set"); hash(corpus.parentSourceSetHash, "parent source set");
  if (api.hash(corpus.sources) !== corpus.sourceSetHash) throw new Error("Corpus source manifest fingerprint mismatch");
  const inputs = { kind: "source-prerequisite-input-lock-v1", sourceSetHash: corpus.sourceSetHash,
    parentSourceSetHash: corpus.parentSourceSetHash, compiledDir, compilerDigest: compilerIdentity(files, compiledDir, root), files, directories };
  await validateSourcePrerequisiteInputs(inputs, { root });
  return inputs;
}

/** The publication owner must call this again immediately before publishing
 * its complete downstream collection. A stale candidate cannot refresh pins. */
export async function validateSourcePrerequisiteInputs(raw, { root = repository } = {}) {
  root = resolve(root);
  const lock = structuredClone(raw);
  exact(lock, "kind,sourceSetHash,parentSourceSetHash,compiledDir,compilerDigest,files,directories", "source prerequisite lock");
  if (lock.kind !== "source-prerequisite-input-lock-v1" || typeof lock.compiledDir !== "string" ||
      !isAbsolute(lock.compiledDir) || resolve(lock.compiledDir) !== lock.compiledDir ||
      !Array.isArray(lock.files) || !lock.files.length || !Array.isArray(lock.directories) || !lock.directories.length)
    throw new Error("Invalid source prerequisite input lock");
  for (const key of ["sourceSetHash", "parentSourceSetHash", "compilerDigest"]) hash(lock[key], key);
  const seen = new Set();
  for (const item of lock.files) {
    exact(item, "path,sha256,bytes,realPath", "source prerequisite file"); hash(item.sha256, "input file");
    const file = filePath(root, item.path);
    if (seen.has(file) || !Number.isSafeInteger(item.bytes) || item.bytes < 0 ||
        typeof item.realPath !== "string" || !isAbsolute(item.realPath)) throw new Error("Invalid or duplicate source prerequisite file");
    seen.add(file);
    const actual = await fingerprint(root, file, item.sha256);
    if (actual.bytes !== item.bytes || actual.realPath !== item.realPath) throw new Error("Source prerequisite path/size changed: " + item.path);
  }
  seen.clear();
  for (const item of lock.directories) {
    exact(item, "path,entriesDigest", "source prerequisite directory"); hash(item.entriesDigest, "input directory");
    const directory = filePath(root, item.path);
    if (seen.has(directory)) throw new Error("Duplicate source prerequisite directory"); seen.add(directory);
    if ((await directoryEntries(directory)).entriesDigest !== item.entriesDigest)
      throw new Error("Source prerequisite directory changed: " + item.path);
  }
  for (const name of SNAPSHOTS) {
    const path = `build/${name}`;
    if (!seen.has(resolve(root, path))) throw new Error("Missing source prerequisite snapshot directory: " + path);
    const manifest = snapshotManifest(await readLockedJson(lock, root, path + "/snapshot.json"));
    for (const file of manifest.files) {
      const input = lock.files.find(item => filePath(root, item.path) === resolve(root, path, file.file));
      if (!input || input.sha256 !== file.sha256) throw new Error("Incomplete source prerequisite snapshot: " + path + "/" + file.file);
    }
  }
  if (!seen.has(resolve(lock.compiledDir, "src"))) throw new Error("Missing source prerequisite compiler directory");
  for (const path of ["build/game/source-catalog.json", "build/runtime/game/FINAL FANTASY VI_Data/level0",
    "build/runtime/game/FINAL FANTASY VI_Data/globalgamemanagers"])
    if (!lock.files.some(item => filePath(root, item.path) === resolve(root, path)))
      throw new Error("Missing source prerequisite dependency: " + path);
  if (compilerIdentity(lock.files, lock.compiledDir, root) !== lock.compilerDigest)
    throw new Error("Source prerequisite compiler identity mismatch");
  const corpus = await readLockedJson(lock, root, "build/corpus/corpus.json");
  if (corpus.sourceSetHash !== lock.sourceSetHash || corpus.parentSourceSetHash !== lock.parentSourceSetHash)
    throw new Error("Source prerequisite source identity changed");
  return true;
}

/** Pure upstream DAG: source world -> source new game -> explicit framework
 * derivation. It never writes packages, generated recipes, reports or archives. */
export async function compileSourcePrerequisites({ root = repository, compiledDir = "dist" } = {}) {
  root = resolve(root);
  const inputs = await captureSourcePrerequisiteInputs({ root, compiledDir });
  const api = await modules(inputs.compiledDir);
  const [battle, field] = await Promise.all([
    readLockedJson(inputs, root, "build/game/source-catalog.json"), readLockedJson(inputs, root, "build/field/field.json"),
  ]);
  await api.verifyContent(battle); api.assertSourceGameCatalog(battle);
  if (field.parentSourceSetHash !== inputs.parentSourceSetHash || api.hash(field.sources) !== field.sourceSetHash ||
      battle.common.fieldSourceSetHash !== field.sourceSetHash)
    throw new Error("Source prerequisite battle/field source mismatch");
  const expectedSourceFields = { kind: battle.kind, contentHash: battle.contentHash,
    fieldSourceSetHash: field.sourceSetHash, parentSourceSetHash: inputs.parentSourceSetHash,
    initializerHash: api.hash(battle.gameState.sourceNewGame) };
  const strict = await api.compileWorld(root);
  const entry = await api.compileSourceNewGame(root, battle, strict);
  const framework = api.compileFrameworkContent(strict.catalog, strict.maps, entry);
  const payloads = new Map([["/world/catalog.json", strict.catalog], ["/game/source-new-game.json", entry],
    ["/framework/world/catalog.json", framework.catalog], ["/framework/new-game.json", framework.entry]]);
  for (const map of strict.maps) payloads.set(`/world/maps/${map.mapId}.json`, map);
  for (const map of framework.maps) payloads.set(`/framework/world/maps/${map.mapId}.json`, map);
  await validateSourcePrerequisiteInputs(inputs, { root });
  const report = { kind: "source-prerequisite-candidate-v1", published: false,
    sourceSetHash: inputs.sourceSetHash, parentSourceSetHash: inputs.parentSourceSetHash, compilerDigest: inputs.compilerDigest,
    stages: [{ name: "capture-inputs", status: "passed" }, { name: "strict-source-battle-reuse", status: "passed" },
      { name: "source-world", status: "passed" }, { name: "source-new-game", status: "passed" },
      { name: "framework-derivation", status: "passed" }, { name: "revalidate-inputs", status: "passed" }],
    battle: { mode: "verified-reuse", expectedSourceFields },
    strict: { catalogHash: strict.catalog.contentHash, entryHash: entry.contentHash, maps: strict.maps.length,
      mapsWithBlockers: strict.maps.filter(map => map.blockers.length).length },
    framework: framework.report,
    inputScope: { snapshotRoots: SNAPSHOTS.map(name => "build/" + name), files: inputs.files.length,
      originalFiles: inputs.files.filter(file => file.path.startsWith("build/runtime/game/")).map(file => file.path),
      nativeReceiptFiles: [], originalSourceFilesVerified: "composition-host-only", rawExports: "snapshot-and-source-manifest-bound" },
    payloads: [...payloads].map(([url, content]) => ({ url, contentHash: content.contentHash })),
    sourceGameplayAdmitted: false, browserVerified: false, nativeVerified: false,
    limitations: ["The current strict source battle catalog is reused and fingerprint-locked, not recompiled.",
      "All indexed source maps and unresolved diagnostics are retained; candidate compilation is not gameplay admission.",
      "Only the directly consumed original composition host files are byte-checked here. Other original sources remain bound by verified export manifests.",
      "The publication owner must revalidate this input lock and explicitly rebind dependent recipes before its single publication."],
  };
  return { payloads, report, inputs };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2); let compiledDir = "dist";
  if (args.length === 2 && args[0] === "--compiled-dir") compiledDir = args[1];
  else if (args.length) throw new Error("Use compile-source-prerequisites.mjs [--compiled-dir <dir>]");
  const result = await compileSourcePrerequisites({ root: repository, compiledDir });
  console.log(JSON.stringify({ kind: result.report.kind, payloads: result.payloads.size,
    sourceMaps: result.report.strict.maps, compilerDigest: result.inputs.compilerDigest, published: false }));
}
