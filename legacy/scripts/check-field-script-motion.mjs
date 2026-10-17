// All source Move/Lerp sites, with source provenance and decoder integration.
// Actual session/renderer journeys are separate from these compilation counts.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url)), args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 2 && args[0] === "--compiled-dir"), "Use --compiled-dir <directory>");
const compiled = resolve(root, args[1] ?? "dist"),
  module = (name) => import(pathToFileURL(resolve(compiled, "src", name + ".js")).href),
  sha = (bytes) => createHash("sha256").update(bytes).digest("hex"),
  output = root + "build/reports/field-script-motion-check.json";
await mkdir(root + "build/reports", { recursive: true });
await rm(output, { force: true });
execFileSync(process.execPath, [root + "scripts/check-field-script-motion-native.mjs"], { cwd: root, stdio: "pipe" });
const nativeBytes = await readFile(root + "build/reports/field-script-motion-native-check.json"),
  native = JSON.parse(nativeBytes),
  { loadCorpus } = await module("compiler/corpus"),
  { hash } = await module("compiler/content"),
  { decodeFieldOp } = await module("compiler/field"),
  { compileFieldScriptMotionInstruction } = await module("compiler/field-script-motion"),
  corpus = await loadCorpus(root), scripts = corpus.assets.filter((asset) => asset.kind === "script");
assert.equal(corpus.manifest.sources.find((source) => source.file === "GameAssembly.dll")?.sha256, native.nativeSha256);
assert.equal(native.semanticsVerified, false);
const calls = [], blocked = [], histogram = { direction: {}, speedSelector: {}, steps: {}, layer: {}, duration: {}, arcHeight: {} },
  count = (table, key) => { table[key] = (table[key] ?? 0) + 1; };
for (const asset of scripts) {
  for (const [index, raw] of (asset.data.Mnemonics ?? []).entries()) {
    if (!["Move", "Lerp"].includes(raw.mnemonic)) continue;
    const site = { script: asset.data.Name, index, source: { ...asset.source, pointer: `/Mnemonics/${index}` } },
      decoded = decodeFieldOp(raw, site, corpus.messages, corpus.tables);
    let op;
    try { op = compileFieldScriptMotionInstruction(raw); }
    catch (error) {
      assert.equal(decoded.kind, "blocked", "incomplete source must not use the former lenient Move decoder");
      blocked.push({ ...site, assetId: asset.id, mnemonic: raw.mnemonic, instructionHash: hash(raw), reason: error.message });
      continue;
    }
    assert.deepEqual(decoded, { ...site, ...op });
    assert.equal(decoded.script, asset.data.Name, "decoder must preserve Site.script provenance");
    const [a, b, c] = raw.operands.iValues, [duration, arcHeight] = raw.operands.rValues,
      animation = raw.operands.sValues[0];
    assert.equal(op.command.animation, animation);
    if (raw.mnemonic === "Move") {
      assert.equal(op.command.kind, "move");
      assert.equal(op.command.direction, ["up", "right", "down", "left"][a]);
      assert.equal(op.command.steps, b);
      assert.equal(op.command.speedId, c < 0 ? null : native.speedTable.selectors[c]);
      count(histogram.direction, a); count(histogram.speedSelector, c); count(histogram.steps, b);
    } else {
      assert.equal(op.command.kind, "lerp");
      assert.equal(op.command.x, a); assert.equal(op.command.y, b); assert.equal(op.command.layer, c);
      assert.equal(op.command.duration, duration); assert.equal(op.command.arcHeight, arcHeight);
      count(histogram.layer, c); count(histogram.duration, duration); count(histogram.arcHeight, arcHeight);
    }
    calls.push({ ...site, assetId: asset.id, mnemonic: raw.mnemonic, instructionHash: hash(raw),
      opHash: hash(op), command: op.command });
  }
}
const moves = calls.filter((call) => call.mnemonic === "Move"), lerps = calls.filter((call) => call.mnemonic === "Lerp");
assert.equal(moves.length, 6342); assert.equal(lerps.length, 4897); assert.equal(blocked.length, 4);
assert.ok(blocked.every((call) => call.mnemonic === "Move"));
assert.equal(calls.length + blocked.length, 11243);
assert.deepEqual(Object.keys(histogram.speedSelector).map(Number).sort((a, b) => a - b), [-1, 0, 1, 2, 3, 4, 5, 6]);
assert.deepEqual(Object.keys(histogram.layer).map(Number).sort((a, b) => a - b), [0, 1, 2, 3]);
const opening = calls.filter((call) => call.script === "sc_e_0001_1" && [38, 39].includes(call.index));
assert.equal(opening.length, 2);
assert.deepEqual(opening.map((call) => call.command), [
  { kind: "move", direction: "down", steps: 1, speedId: 1, animation: "Default" },
  { kind: "lerp", x: 38, y: 50, layer: 0, duration: 0.5, arcHeight: 0, animation: "WalkR" },
]);
const report = {
  kind: "source-field-script-motion", sourceSetHash: corpus.sourceSetHash,
  parentSourceSetHash: corpus.manifest.parentSourceSetHash, nativeSha256: native.nativeSha256,
  nativeReportSha256: sha(nativeBytes), semanticsVerified: false, originalGameExecuted: false,
  admitted: { sites: calls.length, moves: moves.length, lerps: lerps.length,
    scriptAssets: new Set(calls.map((call) => call.assetId)).size,
    explicitMoveAnimations: moves.filter((call) => call.command.animation !== "").length,
    explicitLerpAnimations: lerps.filter((call) => call.command.animation !== "").length },
  calls, blocked, histogram, opening,
  limits: ["Compilation counts are not playable sites, scene coverage or story reachability",
    "Actor/camera target resolution and unsupported layers, arc offsets, movement-area, collision and callback hosts remain runtime responsibilities",
    "Four incomplete legacy Move arrays stay blocked; negative Lerp duration and unknown reserved operands stay blocked",
    "No original game execution or pixel/timing parity was measured"],
};
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ result: "pass", ...report.admitted, blocked: blocked.length,
  openingSites: opening.length, semanticsVerified: false, originalGameExecuted: false }));
