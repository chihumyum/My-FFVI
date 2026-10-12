// Decode every package-bound source site, with independent expectations from
// raw operands and the freshly checked binary bindings. Runtime transportation
// admission is a separate host/profile decision, not this compiler's result.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url)), args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 2 && args[0] === "--compiled-dir"), "Use --compiled-dir <directory>");
const compiled = resolve(root, args[1] ?? "dist");
const module = name => import(pathToFileURL(resolve(compiled, "src", name + ".js")).href);
const { loadCorpus } = await module("compiler/corpus");
const { bindMapPackages, resolveMapScript } = await module("compiler/map-package");
const { decodeFieldOp } = await module("compiler/field");
const { hash } = await module("compiler/content");
const { compileFieldTransportationInstruction, fieldTransportationSelectors } = await module("compiler/field-transportation");
const output = root + "build/reports/field-transportation-check.json";
await mkdir(root + "build/reports", { recursive: true }); await rm(output, { force: true });
execFileSync(process.execPath, [root + "scripts/check-field-transportation-native.mjs"], { cwd: root, stdio: "pipe" });
const nativeBytes = await readFile(root + "build/reports/field-transportation-native-check.json"), native = JSON.parse(nativeBytes);
const corpus = await loadCorpus(root), assets = new Map(corpus.assets.map(asset => [asset.id, asset]));
assert.equal(native.semanticsVerified, false);
assert.equal(corpus.manifest.sources.find(source => source.file === "GameAssembly.dll")?.sha256, native.nativeSha256);
const selectors = new Map(native.selectorBindings.map(binding => [binding.selector, binding]));
assert.deepEqual(fieldTransportationSelectors, [...selectors.keys()]);
const maps = bindMapPackages(corpus.assets, corpus.tables), users = new Map();
for (const map of maps) {
  const seen = new Set(), queue = [...map.scripts];
  while (queue.length) {
    const id = queue.pop(); if (seen.has(id)) continue; seen.add(id);
    if (!users.has(id)) users.set(id, new Set()); users.get(id).add(map.id);
    const asset = assets.get(id); assert.equal(asset?.kind, "script");
    for (const raw of asset.data.Mnemonics) {
      if (!["Encount", "ChangeScript"].includes(raw.mnemonic)) continue;
      const target = resolveMapScript(map, raw.operands.sValues[0]); if (target) queue.push(target);
    }
  }
}
const transportation = new Map(corpus.tables["transportation.csv"].map(row => [Number(row.id), row]));
const mapIds = new Set(corpus.tables["map.csv"].map(row => Number(row.id)));
const sites = [], counts = { SetVehicle: 0, RideVehicleNPC: 0, SysCall: 0 }, selectorCounts = Object.fromEntries([...selectors.keys()].map(selector => [selector, 0]));
let reservedOperandRejections = 0;
for (const [assetId, mapUsers] of users) {
  const asset = assets.get(assetId);
  for (const [index, raw] of asset.data.Mnemonics.entries()) {
    if (!["SetVehicle", "RideVehicleNPC"].includes(raw.mnemonic) && !(raw.mnemonic === "SysCall" && selectors.has(raw.operands.sValues[0]))) continue;
    const [id, i1, i2, i3, i4, i5] = raw.operands.iValues;
    const expected = raw.mnemonic === "SetVehicle"
      ? { kind: "place", transportationId: id, stayMapId: i1,
          position: { x: Math.fround(i2), y: Math.fround(i3) },
          layer: i4 === 0 ? { kind: "player" } : { kind: "unity", value: i4 + 8 },
          direction: native.directionTable.values[i5] }
      : raw.mnemonic === "RideVehicleNPC"
        ? { kind: "ride-npc", transportationId: id, actorSelector: i1 }
        : selectors.get(raw.operands.sValues[0]).command;
    const provenance = { script: asset.data.Name ?? asset.id, index,
      source: { ...asset.source, pointer: `/Mnemonics/${index}` } };
    const before = structuredClone(raw), op = compileFieldTransportationInstruction(raw);
    assert.deepEqual(op, { kind: "field-transportation", command: expected });
    assert.deepEqual(raw, before);
    assert.deepEqual(decodeFieldOp(raw, provenance, {}, corpus.tables), { ...provenance, ...op });
    assert.ok(transportation.has(expected.transportationId), "source transport identity reference");
    if (expected.kind === "place") assert.ok(mapIds.has(expected.stayMapId), "source parking map reference");
    assert.match(provenance.source.objectId, /^-?\d+$/);
    assert.match(provenance.source.sha256, /^[0-9a-f]{64}$/);
    const rejected = structuredClone(raw); rejected.operands.iValues[7] = 1;
    assert.throws(() => compileFieldTransportationInstruction(rejected), /reserved|Unsupported/);
    assert.equal(decodeFieldOp(rejected, provenance, {}, corpus.tables).kind, "blocked");
    reservedOperandRejections++;
    counts[raw.mnemonic]++;
    if (raw.mnemonic === "SysCall") selectorCounts[raw.operands.sValues[0]]++;
    sites.push({ ...provenance, maps: [...mapUsers].sort(), mnemonic: raw.mnemonic,
      rawHash: hash(raw), command: expected, commandHash: hash(op),
      lifecycleAdmission: "requires transactional host and explicit profile" });
  }
}
assert.deepEqual(counts, { SetVehicle: 42, RideVehicleNPC: 171, SysCall: 64 });
assert.equal(sites.length, 277); assert.equal(reservedOperandRejections, 277);
assert.equal(Object.values(selectorCounts).filter(count => count > 0).length, 11);
const opening = sites.filter(site => site.script === "sc_e_0001_3" && site.index >= 4 && site.index <= 8);
assert.deepEqual(opening.map(site => site.index), [4, 5, 6, 7, 8]);
assert.deepEqual(opening.map(site => site.command), [
  { kind: "place", transportationId: 6, stayMapId: 20, position: { x: 10, y: 20 }, layer: { kind: "player" }, direction: 1 },
  { kind: "change", transportationId: 6, changeCollisionEnable: true, isBackground: false, viewType: 0 },
  { kind: "ride-npc", transportationId: 6, actorSelector: -1001 },
  { kind: "ride-npc", transportationId: 6, actorSelector: -1002 },
  { kind: "ride-npc", transportationId: 6, actorSelector: -1003 },
]);
const report = {
  kind: "field-transportation-source", sourceSetHash: corpus.sourceSetHash, nativeSha256: native.nativeSha256,
  nativeReceiptSha256: createHash("sha256").update(nativeBytes).digest("hex"),
  decodedSourceSites: sites.length, sharedDispatcherSites: sites.length, reservedOperandRejections,
  counts, selectorCounts, opening, sourceInstructions: sites,
  semanticsVerified: false, originalGameExecuted: false, sourceLifecycleAdmitted: false,
  limits: ["All counts describe decoded source instructions, not playable maps or complete vehicle systems",
    "Placement keeps a live actual-player layer request; the compiler does not supply that layer",
    "Source entity selectors retain their values; missing or non-character targets require host rejection",
    "Strict source execution remains gated on complete side-effect providers",
    "Framework transportation is an explicitly reported runtime variant; its integration is checked separately",
    "No original-game dynamic equivalence claim"],
};
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ result: "pass", decodedSourceSites: sites.length, sharedDispatcherSites: sites.length,
  counts, sourceSelectorsUsed: 11, reservedOperandRejections, sourceLifecycleAdmitted: false }));
