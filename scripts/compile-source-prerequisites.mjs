import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir, readlink, realpath } from "node:fs/promises";
import { isAbsolute, posix, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const repository = resolve(import.meta.dirname, "..");
const SNAPSHOTS = ["import", "corpus", "battle", "field", "world-media", "field-background-media", "map-ui", "bgm", "environment", "se"];
// Both ordinary and whole-world battle producers read these exact existing
// proofs through compileGameCatalogModules. They belong to the same candidate
// input fence as the source snapshots, not the mutable general report domain.
const CATALOG_EVIDENCE = ["build/reports/v71-esper-native-complete/complete.json",
  "build/reports/v71-esper-native-complete/856d80.c"];
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
  const [content, integrity, world, newGame, framework, sourceCatalog, composition, battle, catalog, playable, logical, corpus, packages, background, periodic, renderHost, npcArea, npcFlat, effectFlat, ordinary] = await Promise.all([
    load("compiler/content"), load("core/content-integrity"), load("compiler/world"), load("compiler/source-new-game"),
    load("compiler/framework-content"), load("core/source-catalog"), load("core/field-native-composition"),
    load("compiler/battle"), load("compiler/game-catalog"), load("compiler/opening-playable"), load("compiler/field-logical-effects"),
    load("compiler/corpus"), load("compiler/map-package"), load("compiler/field-background"),
    load("compiler/framework-periodic-presentation"), load("compiler/field-native-composition"),
    load("compiler/framework-npc-area"), load("compiler/framework-npc-flat-projection"), load("compiler/framework-field-effect-flat-projection"),
    load("compiler/framework-ordinary-presentation"),
  ]);
  return { ...content, ...integrity, ...world, ...newGame, ...framework, ...sourceCatalog, ...composition,
    ...battle, ...catalog, ...playable, ...logical, ...corpus, ...packages, ...background, ...periodic, ...renderHost, ...npcArea, ...npcFlat, ...effectFlat, ...ordinary };
}

/** Explicit Web producer input, not a source/save capability grant. */
function logicalInput(raw, root) {
  if (raw === undefined) return undefined;
  exact(raw, "kind,input,reason", "logical field effects input");
  if (raw.kind !== "web-logical-field-effects-input-v1" || typeof raw.reason !== "string" || !raw.reason.trim())
    throw new Error("Invalid logical field effects input declaration");
  const input = filePath(root, raw.input), part = relative(resolve(root,"build"),input);
  if (!part || part === ".." || part.startsWith(".."+sep) || isAbsolute(part) ||
      part.split(sep).some(name => ["content-packages","content-releases"].includes(name)))
    throw new Error("Logical field effects require a local prerequisite snapshot outside public collections");
  return { kind: raw.kind, input: displayPath(root,input), reason: raw.reason };
}

/** Fixed public Web policy only: no external rule file or source override is
 * introduced. All source/media/host reads are already in the v1/v2 input lock. */
export function sourcePeriodicMapsInput(raw) {
  if (raw === undefined) return undefined;
  exact(raw, "kind,reason", "periodic maps input");
  const descriptors=Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(raw).length!==2 || Object.values(descriptors).some(d=>!d.enumerable||!Object.hasOwn(d,"value")) ||
      descriptors.kind.value!=="web-source-periodic-presentation-input-v1" ||
      typeof descriptors.reason.value!=="string" || !descriptors.reason.value.trim())
    throw new Error("Invalid periodic maps input declaration");
  return {kind:descriptors.kind.value,reason:descriptors.reason.value};
}

/** A distinct whole ordinary-map input. Periodic assessment permission never
 * implies this policy, and neither a map, recipe nor save supplies its scope. */
export function sourceOrdinaryFieldsInput(raw) {
  if(raw===undefined)return undefined;
  exact(raw,"kind,reason","ordinary field presentation input");
  const descriptors=Object.getOwnPropertyDescriptors(raw);
  if(Reflect.ownKeys(raw).length!==2||Object.values(descriptors).some(d=>!d.enumerable||!Object.hasOwn(d,"value"))||
      descriptors.kind.value!=="web-source-ordinary-field-presentation-input-v1"||
      typeof descriptors.reason.value!=="string"||!descriptors.reason.value.trim())
    throw new Error("Invalid ordinary field presentation input declaration");
  return{kind:descriptors.kind.value,reason:descriptors.reason.value};
}

/** Fixed existing Web Area policy for the complete source domain. It is a
 * trusted producer option, never an authored map list or a saved capability. */
export function sourceNpcAreasInput(raw) {
  if (raw === undefined) return undefined;
  exact(raw, "kind,reason", "NPC Areas input");
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(raw).length !== 2 || Object.values(descriptors).some(d => !d.enumerable || !Object.hasOwn(d, "value")) ||
      descriptors.kind.value !== "web-source-npc-area-input-v1" || typeof descriptors.reason.value !== "string" || !descriptors.reason.value.trim())
    throw new Error("Invalid NPC Areas input declaration");
  return { kind: descriptors.kind.value, reason: descriptors.reason.value };
}

/** Explicit whole-source Web projection; no authored map/selector list. */
export function sourceNpcFlatInput(raw) {
  exact(raw,"kind,reason","NPC flat input");
  const d=Object.getOwnPropertyDescriptors(raw);
  if(Reflect.ownKeys(raw).length!==2 || Object.values(d).some(v=>!v.enumerable||!Object.hasOwn(v,"value")) ||
    d.kind.value!=="web-source-npc-flat-input-v1" || typeof d.reason.value!=="string" || !d.reason.value.trim())
    throw new Error("Invalid NPC flat input declaration");
  return {kind:d.kind.value,reason:d.reason.value};
}

/** A separate explicit board projection; no source/map list or saved grant. */
export function sourceFieldEffectFlatInput(raw) {
  exact(raw,"kind,reason","field effect flat input");
  const d=Object.getOwnPropertyDescriptors(raw);
  if(Reflect.ownKeys(raw).length!==2 || Object.values(d).some(v=>!v.enumerable||!Object.hasOwn(v,"value")) ||
    d.kind.value!=="web-source-field-effect-flat-input-v1" || typeof d.reason.value!=="string" || !d.reason.value.trim())
    throw new Error("Invalid field effect flat input declaration");
  return {kind:d.kind.value,reason:d.reason.value};
}

/** Capture exactly the current compiler's input domain. Raw-source exports
 * retain their original source fingerprints; this does not hash all Unity
 * bundles or claim all source files are live-verified. */
export async function captureSourcePrerequisiteInputs({ root = repository, compiledDir = "dist", logicalFieldEffects } = {}) {
  root = resolve(root); compiledDir = resolve(root, compiledDir);
  const logical = logicalInput(logicalFieldEffects, root);
  const files = [], directories = [], recorded = new Map();
  const add = async (file, expected) => {
    file = resolve(file);
    if (recorded.has(file)) {
      if (expected !== undefined && recorded.get(file).sha256 !== expected)
        throw new Error("Conflicting source prerequisite digest: " + file);
      return;
    }
    const record = await fingerprint(root, file, expected);files.push(record);recorded.set(file,record);
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
  await add(resolve(root, "build/game/opening-playable.json"));
  for(const path of CATALOG_EVIDENCE)await add(resolve(root,path));
  const hosts = new Map();
  for (const source of api.ordinaryFieldCompositionRenderHost().sources) {
    if (hosts.has(source.file) && hosts.get(source.file) !== source.sha256) throw new Error("Ambiguous original composition input");
    hosts.set(source.file, source.sha256);
  }
  for (const [file, expected] of hosts) await add(resolve(root, "build/runtime/game", file), expected);
  if (logical) {
    const path = filePath(root, logical.input); await directory(path);
    const manifestPath = resolve(path,"snapshot.json"); await add(manifestPath);
    const manifest = snapshotManifest(JSON.parse(await readFile(manifestPath,"utf8")));
    for (const item of manifest.files) await add(resolve(path,item.file),item.sha256);
    const media = JSON.parse(await readFile(resolve(path,"media.json"),"utf8"));
    if (media.adapterVersion !== "field-effect-media-lossless-wip-0.2.0")
      throw new Error("Public logical field effects require the lossless typed-scalar/raw-object export");
    // The whole original manifest is part of this publication fence. A receipt
    // or mutable decoded JSON cannot substitute for the bundles' exact bytes.
    const corpus = JSON.parse(await readFile(resolve(root,"build/corpus/corpus.json"),"utf8"));
    for (const row of corpus.sources) {
      const source = filePath(resolve(root,"build/runtime/game"),row.file);
      if (!source.startsWith(resolve(root,"build/runtime/game")+sep)) throw new Error("Unsafe original effect source");
      await add(source,row.sha256);
      if (recorded.get(source).bytes !== row.bytes) throw new Error("Original effect source size changed");
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path)); directories.sort((a, b) => a.path.localeCompare(b.path));
  const corpus = JSON.parse(await readFile(resolve(root, "build/corpus/corpus.json"), "utf8"));
  hash(corpus.sourceSetHash, "corpus source set"); hash(corpus.parentSourceSetHash, "parent source set");
  if (api.hash(corpus.sources) !== corpus.sourceSetHash) throw new Error("Corpus source manifest fingerprint mismatch");
  const inputs = { kind: logical ? "source-prerequisite-input-lock-v2" : "source-prerequisite-input-lock-v1",
    ...(logical ? { logicalFieldEffects: logical } : {}), sourceSetHash: corpus.sourceSetHash,
    parentSourceSetHash: corpus.parentSourceSetHash, compiledDir, compilerDigest: compilerIdentity(files, compiledDir, root), files, directories };
  await validateSourcePrerequisiteInputs(inputs, { root });
  return inputs;
}

/** The publication owner must call this again immediately before publishing
 * its complete downstream collection. A stale candidate cannot refresh pins. */
export async function validateSourcePrerequisiteInputs(raw, { root = repository } = {}) {
  root = resolve(root);
  const lock = structuredClone(raw);
  const version2 = lock?.kind === "source-prerequisite-input-lock-v2";
  exact(lock, "kind,sourceSetHash,parentSourceSetHash,compiledDir,compilerDigest,files,directories" + (version2 ? ",logicalFieldEffects" : ""), "source prerequisite lock");
  if (!["source-prerequisite-input-lock-v1","source-prerequisite-input-lock-v2"].includes(lock.kind) || typeof lock.compiledDir !== "string" ||
      !isAbsolute(lock.compiledDir) || resolve(lock.compiledDir) !== lock.compiledDir ||
      !Array.isArray(lock.files) || !lock.files.length || !Array.isArray(lock.directories) || !lock.directories.length)
    throw new Error("Invalid source prerequisite input lock");
  for (const key of ["sourceSetHash", "parentSourceSetHash", "compilerDigest"]) hash(lock[key], key);
  const seen = new Set(), byPath = new Map();
  for (const item of lock.files) {
    exact(item, "path,sha256,bytes,realPath", "source prerequisite file"); hash(item.sha256, "input file");
    const file = filePath(root, item.path);
    if (seen.has(file) || !Number.isSafeInteger(item.bytes) || item.bytes < 0 ||
        typeof item.realPath !== "string" || !isAbsolute(item.realPath)) throw new Error("Invalid or duplicate source prerequisite file");
    seen.add(file);byPath.set(file,item);
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
      const input = byPath.get(resolve(root,path,file.file));
      if (!input || input.sha256 !== file.sha256) throw new Error("Incomplete source prerequisite snapshot: " + path + "/" + file.file);
    }
  }
  if (!seen.has(resolve(lock.compiledDir, "src"))) throw new Error("Missing source prerequisite compiler directory");
  for (const path of [...CATALOG_EVIDENCE,"build/game/source-catalog.json", "build/game/opening-playable.json", "build/runtime/game/FINAL FANTASY VI_Data/level0",
    "build/runtime/game/FINAL FANTASY VI_Data/globalgamemanagers"])
    if (!byPath.has(resolve(root,path)))
      throw new Error("Missing source prerequisite dependency: " + path);
  if (compilerIdentity(lock.files, lock.compiledDir, root) !== lock.compilerDigest)
    throw new Error("Source prerequisite compiler identity mismatch");
  const corpus = await readLockedJson(lock, root, "build/corpus/corpus.json");
  if (corpus.sourceSetHash !== lock.sourceSetHash || corpus.parentSourceSetHash !== lock.parentSourceSetHash)
    throw new Error("Source prerequisite source identity changed");
  if (version2) {
    const logical = logicalInput(lock.logicalFieldEffects,root), directory = filePath(root,logical.input);
    if (!seen.has(directory)) throw new Error("Missing logical effect snapshot directory");
    const manifest = snapshotManifest(await readLockedJson(lock,root,displayPath(root,resolve(directory,"snapshot.json"))));
    for (const row of manifest.files) {
      const input = byPath.get(resolve(directory,row.file));
      if (!input || input.sha256 !== row.sha256) throw new Error("Incomplete logical effect snapshot");
    }
    const media = await readLockedJson(lock,root,displayPath(root,resolve(directory,"media.json")));
    if (media.adapterVersion !== "field-effect-media-lossless-wip-0.2.0") throw new Error("Logical effect snapshot is not lossless");
    for (const row of corpus.sources) {
      const file = filePath(resolve(root,"build/runtime/game"),row.file), input = byPath.get(file);
      if (!file.startsWith(resolve(root,"build/runtime/game")+sep) || !input || input.sha256 !== row.sha256 || input.bytes !== row.bytes)
        throw new Error("Incomplete original effect source binding");
    }
    const snapshotFiles = new Map(manifest.files.map(row => [row.file,row]));
    for (const graph of Object.values(media.groups)) for (const object of graph.objects) {
      const raw = object.rawObject, bound = raw && snapshotFiles.get(raw.file), input = bound && byPath.get(resolve(directory,bound.file));
      if (!raw || !input || raw.sha256 !== input.sha256 || raw.bytes !== input.bytes) throw new Error("Unbound original effect object bytes");
    }
  }
  return true;
}

/** Pure upstream DAG: current battle capabilities -> source world/new game -> explicit framework
 * derivation. It never writes packages, generated recipes, reports or archives. */
export async function compileSourcePrerequisites({ root = repository, compiledDir = "dist", logicalFieldEffects, periodicMaps, ordinaryFields, mapAnimatedEntities, npcAreas, npcFlat, fieldEffectFlat } = {}) {
  if (mapAnimatedEntities !== undefined && mapAnimatedEntities !== "web-field-animated-map-entities-v1")
    throw new Error("Unknown source framework animated map entity policy");
  const periodicDeclaration = sourcePeriodicMapsInput(periodicMaps);
  const ordinaryDeclaration = sourceOrdinaryFieldsInput(ordinaryFields);
  const npcDeclaration = sourceNpcAreasInput(npcAreas);
  const flatDeclaration = npcFlat === undefined ? undefined : sourceNpcFlatInput(npcFlat);
  const effectFlatDeclaration = fieldEffectFlat === undefined ? undefined : sourceFieldEffectFlatInput(fieldEffectFlat);
  if(effectFlatDeclaration && logicalFieldEffects === undefined) throw new Error("Flat field effects require an explicit logical input");
  root = resolve(root);
  const inputs = await captureSourcePrerequisiteInputs({ root, compiledDir, logicalFieldEffects });
  const api = await modules(inputs.compiledDir);
  const [previousBattle, previousDevelopment, field] = await Promise.all([
    readLockedJson(inputs, root, "build/game/source-catalog.json"),
    readLockedJson(inputs, root, "build/game/opening-playable.json"),
    readLockedJson(inputs, root, "build/field/field.json"),
  ]);
  await api.verifyContent(previousBattle); api.assertSourceGameCatalog(previousBattle);
  await api.verifyContent(previousDevelopment);
  const [source, opening] = await Promise.all([api.compileSharedBattleSource(root), api.compileOpeningBattle(root)]);
  const feeBaselineOptions = {messageFeeAdditionBaseline:"omit-source-message-fees-for-addition-audit-v1"};
  const [battle, development, battleFeeBaseline, developmentFeeBaseline] = await Promise.all([
    api.compileSharedGameCatalog(root, source), api.compileOpeningPlayable(root, opening),
    api.compileSharedGameCatalog(root, source, feeBaselineOptions),
    api.compileOpeningPlayable(root, opening, feeBaselineOptions),
  ]);
  await api.verifyContent(battle); api.assertSourceGameCatalog(battle);
  await api.verifyContent(development);
  const battleRebindings = [], sourceMessageFeeBaselines = new Map();
  for (const [url, before, after] of [["/game/source-catalog.json", previousBattle, battle],
    ["/game/opening-playable.json", previousDevelopment, development]]) {
    if (before.common.sourceContentHash !== after.common.sourceContentHash ||
        before.common.fieldSourceSetHash !== after.common.fieldSourceSetHash ||
        api.canonical(before.gameState) !== api.canonical(after.gameState))
      throw new Error("Battle capability rebuild changed source identity or owned initialization: " + url);
    battleRebindings.push({ kind: "compiled-battle-rebinding-v1", url,
      previousHash: before.contentHash, candidateHash: after.contentHash, compilerDigest: inputs.compilerDigest,
      sourceContentHash: after.common.sourceContentHash, fieldSourceSetHash: after.common.fieldSourceSetHash,
      gameStateHash: api.hash(after.gameState) });
  }
  for (const [url, before, baseline] of [
    ["/game/source-catalog.json", previousBattle, battleFeeBaseline],
    ["/game/opening-playable.json", previousDevelopment, developmentFeeBaseline],
  ]) {
    await api.verifyContent(baseline);
    if (baseline.common.sourceMessageFees !== undefined || api.canonical(before.gameState) !== api.canonical(baseline.gameState))
      throw new Error("Source fee baseline changed initialization or includes the added field");
    sourceMessageFeeBaselines.set(url,{baseline,rebinding:{
      kind:"compiled-battle-rebinding-v1",url,previousHash:before.contentHash,candidateHash:baseline.contentHash,
      compilerDigest:inputs.compilerDigest,sourceContentHash:baseline.common.sourceContentHash,
      fieldSourceSetHash:baseline.common.fieldSourceSetHash,gameStateHash:api.hash(baseline.gameState),
    }});
  }
  if (field.parentSourceSetHash !== inputs.parentSourceSetHash || api.hash(field.sources) !== field.sourceSetHash ||
      battle.common.fieldSourceSetHash !== field.sourceSetHash)
    throw new Error("Source prerequisite battle/field source mismatch");
  const expectedSourceFields = { kind: battle.kind, contentHash: battle.contentHash,
    fieldSourceSetHash: field.sourceSetHash, parentSourceSetHash: inputs.parentSourceSetHash,
    initializerHash: api.hash(battle.gameState.sourceNewGame) };
  const strict = await api.compileWorld(root);
  const entry = await api.compileSourceNewGame(root, battle, strict);
  const frameworkOptions = { ...(mapAnimatedEntities ? { mapAnimatedEntities } : {}) };
  let logicalReport = null;
  if (inputs.kind === "source-prerequisite-input-lock-v2") {
    const declaration = inputs.logicalFieldEffects, directory = filePath(root,declaration.input);
    const media = await readLockedJson(inputs,root,displayPath(root,resolve(directory,"media.json")));
    const corpus = await readLockedJson(inputs,root,"build/corpus/corpus.json");
    const groups = new Set();
    for (const map of strict.maps) for (const group of Object.values(map.map?.groups ?? {}))
      for (const entity of group.entities) if (entity.kind === 11 && entity.effect) groups.add(entity.effect.assetGroup);
    if (api.canonical([...groups].sort()) !== api.canonical(Object.keys(media.groups).sort()))
      throw new Error("Lossless field effect export must retain the complete whole-world board asset-group cohort");
    // Exactly one pure compilation is shared by original-URL and linked-URL
    // framework derivatives. Neither strict maps nor scripts acquire policy.
    const result = api.compileWebLogicalEffectCatalog(media,{sourceSetHash:corpus.sourceSetHash,
      parentSourceSetHash:corpus.parentSourceSetHash,sources:corpus.sources});
    frameworkOptions.logicalFieldEffects = { catalog: result.catalog, declaration: {
      kind:"web-logical-field-effects-declaration-v1", policy:result.catalog.webPolicy.kind,
      sourceSetHash:inputs.sourceSetHash,parentSourceSetHash:inputs.parentSourceSetHash,
      catalogHash:result.catalog.webPolicy.catalogHash,mapIds:strict.maps.map(map => map.mapId),reason:declaration.reason,
    }};
    logicalReport = {input:declaration.input,graphs:Object.keys(media.groups).length,
      accepted:Object.keys(result.catalog.media).length,rejected:result.rejected,catalogHash:result.catalog.webPolicy.catalogHash,
      pureCompilations:1,originalSourceFilesVerified:corpus.sources.length,nativeParity:false,sourceProgramExecutionGranted:false};
  }
  let periodicReport = null;
  if (periodicDeclaration) {
    // Enumerate every original looping map, retaining failed assessments too.
    // These exact corpus/background/boot snapshots are in the existing lock;
    // none is read from public packages or from an external authored rule file.
    const corpus = await api.loadCorpus(root), sources = corpus.manifest.sources.map(({file,sha256})=>({file,sha256}));
    if (corpus.sourceSetHash!==inputs.sourceSetHash || corpus.manifest.parentSourceSetHash!==inputs.parentSourceSetHash)
      throw new Error("Periodic presentation corpus/input-lock identity mismatch");
    const assets = new Map(corpus.assets.map(asset=>[asset.id,asset])), bindings = api.bindMapPackages(corpus.assets,corpus.tables),
      background = await api.loadFieldBackgroundMedia(root,corpus.sourceSetHash),
      renderHost = await api.loadFieldCompositionRenderHost(root,sources), assessments=[];
    for (const map of strict.maps.filter(map=>map.entryView?.loopType).sort((a,b)=>a.mapId-b.mapId)) {
      let presentation=null; const blockers=[];
      try {
        const matches=bindings.filter(binding=>Number(binding.id)===map.mapId);
        if(matches.length!==1||!matches[0].tilemap||!matches[0].packageId)throw new Error("Periodic source map package binding unavailable");
        const binding=matches[0],tilemap=assets.get(binding.tilemap),mapPackage=assets.get(binding.packageId);
        if(!tilemap||!mapPackage)throw new Error("Periodic source tilemap/package asset unavailable");
        presentation=api.compileFrameworkPeriodicPresentation({map,sources,tilemap,mapPackage,
          backgroundMedia:background.media,verify:background.verify,renderHost});
      } catch(error) { blockers.push(String(error?.message??error)); }
      assessments.push({mapId:map.mapId,sourceContentHash:map.contentHash,presentation,blockers});
    }
    frameworkOptions.periodicPresentations=assessments;
    periodicReport={declaration:periodicDeclaration,assessmentsHash:api.hash(assessments),maps:assessments.length,
      compiled:assessments.filter(row=>row.presentation).length,unready:assessments.filter(row=>!row.presentation).length,
      pureCompilations:1,sourceGameplayAdmitted:false,nativeParity:false};
  }
  let ordinaryReport=null;
  if(ordinaryDeclaration){
    const corpus=await api.loadCorpus(root),sources=corpus.manifest.sources.map(({file,sha256})=>({file,sha256}));
    if(corpus.sourceSetHash!==inputs.sourceSetHash||corpus.manifest.parentSourceSetHash!==inputs.parentSourceSetHash)
      throw new Error("Ordinary presentation corpus/input-lock identity mismatch");
    const renderHost=await api.loadFieldCompositionRenderHost(root,sources);
    frameworkOptions.ordinaryPresentations=api.assessFrameworkOrdinaryWorld(corpus,strict.catalog,strict.maps,renderHost,ordinaryDeclaration.reason);
    ordinaryReport={declaration:ordinaryDeclaration,maps:frameworkOptions.ordinaryPresentations.length,
      available:frameworkOptions.ordinaryPresentations.filter(row=>row.presentation).length,
      derived:frameworkOptions.ordinaryPresentations.filter(row=>row.mode==='flat-alternative').length,
      nativePreserved:frameworkOptions.ordinaryPresentations.filter(row=>row.mode==='native-preserved').length,
      unready:frameworkOptions.ordinaryPresentations.filter(row=>!row.presentation).length,
      assessmentsHash:api.hash(frameworkOptions.ordinaryPresentations),pureCompilations:1,sourceGameplayAdmitted:false,nativeParity:false};
  }
  let npcReport = null;
  if (npcDeclaration) {
    const corpus = await api.loadCorpus(root);
    if (corpus.sourceSetHash !== inputs.sourceSetHash || corpus.manifest.parentSourceSetHash !== inputs.parentSourceSetHash)
      throw new Error("NPC Areas corpus/input-lock identity mismatch");
    const template = api.frameworkNpcAreaTemplate(npcDeclaration.reason);
    frameworkOptions.npcAreaAssessments = api.assessFrameworkNpcAreaWorld(corpus, strict.catalog, strict.maps, template);
    npcReport = { declaration: npcDeclaration, template, assessmentsHash: api.hash(frameworkOptions.npcAreaAssessments),
      maps: frameworkOptions.npcAreaAssessments.length,
      declared: frameworkOptions.npcAreaAssessments.reduce((sum, a) => sum + a.record.counts.declared, 0),
      derived: frameworkOptions.npcAreaAssessments.reduce((sum, a) => sum + a.record.counts.derived, 0),
      pureCompilations: 1, sourceGameplayAdmitted: false, nativeParity: false };
    npcReport.unready = npcReport.declared - npcReport.derived;
  }
  let npcFlatReport = null;
  if (flatDeclaration) {
    const corpus=await api.loadCorpus(root);
    frameworkOptions.npcFlatAssessments=api.assessFrameworkNpcFlatWorld(corpus,strict.catalog,strict.maps,flatDeclaration.reason);
    npcFlatReport={declaration:flatDeclaration,maps:frameworkOptions.npcFlatAssessments.length,assessmentsHash:api.hash(frameworkOptions.npcFlatAssessments),nativeParity:false};
  }
  let effectFlatReport = null;
  if(effectFlatDeclaration) {
    const corpus=await api.loadCorpus(root);
    frameworkOptions.fieldEffectFlat=api.assessFrameworkFieldEffectFlatWorld(corpus,strict.catalog,strict.maps,frameworkOptions.logicalFieldEffects.catalog,effectFlatDeclaration.reason);
    const p=frameworkOptions.fieldEffectFlat.projection;
    effectFlatReport={declaration:effectFlatDeclaration,assessmentHash:frameworkOptions.fieldEffectFlat.contentHash,maps:p.mapSources.length,declared:p.objects.length,derived:p.bindings.length,unready:p.objects.length-p.bindings.length,nativeParity:false};
  }
  const framework = api.compileFrameworkContent(strict.catalog, strict.maps, entry,frameworkOptions);
  const payloads = new Map([["/game/source-catalog.json", battle], ["/game/opening-playable.json", development],
    ["/world/catalog.json", strict.catalog], ["/game/source-new-game.json", entry],
    ["/framework/world/catalog.json", framework.catalog], ["/framework/new-game.json", framework.entry]]);
  for (const map of strict.maps) payloads.set(`/world/maps/${map.mapId}.json`, map);
  for (const map of framework.maps) payloads.set(`/framework/world/maps/${map.mapId}.json`, map);
  await validateSourcePrerequisiteInputs(inputs, { root });
  const report = { kind: "source-prerequisite-candidate-v1", published: false,
    sourceSetHash: inputs.sourceSetHash, parentSourceSetHash: inputs.parentSourceSetHash, compilerDigest: inputs.compilerDigest,
    stages: [{ name: "capture-inputs", status: "passed" }, { name: "battle-capability-rebuild", status: "passed" },
      { name: "source-world", status: "passed" }, { name: "source-new-game", status: "passed" },
      { name: "framework-derivation", status: "passed" }, { name: "revalidate-inputs", status: "passed" }],
    battle: { mode: "same-candidate-rebuild", expectedSourceFields, dependencyRebindings: battleRebindings },
    strict: { catalogHash: strict.catalog.contentHash, entryHash: entry.contentHash, maps: strict.maps.length,
      mapsWithBlockers: strict.maps.filter(map => map.blockers.length).length },
    framework: framework.report, logicalFieldEffects: logicalReport, ...(periodicReport?{periodicMaps:periodicReport}:{}),
    ...(ordinaryReport?{ordinaryFields:ordinaryReport}:{}),
    ...(npcReport ? { npcAreas: npcReport } : {}),
    ...(npcFlatReport ? { npcProjection: npcFlatReport } : {}),
    ...(effectFlatReport ? { fieldEffectProjection: effectFlatReport } : {}),
    inputScope: { snapshotRoots: SNAPSHOTS.map(name => "build/" + name), files: inputs.files.length,
      originalFiles: inputs.files.filter(file => file.path.startsWith("build/runtime/game/")).map(file => file.path),
      nativeReceiptFiles: [...CATALOG_EVIDENCE], originalSourceFilesVerified: logicalReport ? "whole-corpus" : "composition-host-only", rawExports: "snapshot-and-source-manifest-bound" },
    payloads: [...payloads].map(([url, content]) => ({ url, contentHash: content.contentHash })),
    sourceGameplayAdmitted: false, browserVerified: false, nativeVerified: false,
    limitations: ["Battle catalogs are rebuilt by the current compiler from the same locked source inputs; owned initialization is unchanged.",
      "All indexed source maps and unresolved diagnostics are retained; candidate compilation is not gameplay admission.",
      "Only the directly consumed original composition host files are byte-checked here. Other original sources remain bound by verified export manifests.",
      "The publication owner must revalidate this input lock and explicitly rebind dependent recipes before its single publication."],
  };
  return { payloads, report, inputs, battleRebindings, frameworkOptions, sourceMessageFeeBaselines };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2); let compiledDir = "dist";
  if (args.length === 2 && args[0] === "--compiled-dir") compiledDir = args[1];
  else if (args.length) throw new Error("Use compile-source-prerequisites.mjs [--compiled-dir <dir>]");
  const result = await compileSourcePrerequisites({ root: repository, compiledDir });
  console.log(JSON.stringify({ kind: result.report.kind, payloads: result.payloads.size,
    sourceMaps: result.report.strict.maps, compilerDigest: result.inputs.compilerDigest, published: false }));
}
