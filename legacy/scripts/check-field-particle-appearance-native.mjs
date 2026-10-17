// Rebuild exact source Size/Color caches and final buffers from original
// engine instructions. No running Unity scene or game is claimed.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const sha = (v) => createHash("sha256").update(v).digest("hex");
const json = async (p) => JSON.parse(await readFile(resolve(root, p), "utf8"));
const nativeSha256 = "7930dbf028be9e3d146a92dc756a166f10cada81f433c49b8fb4eb6767ae9845";
const pdbSha256 = "c7bbffbd21b1ee59e18612b566d6815aa0d2218397d0e187051cbd239b152d85";
const dll = "build/runtime/game/UnityPlayer.dll", pdb = "build/native/unity-player-symbols/UnityPlayer_Win64_il2cpp_x64.pdb";
const batches = ["v37-particle-appearance", "v37-particle-appearance-modules", "v37-particle-appearance-gradient",
  "v36-particle-motion-curve-binding", "v36-particle-motion-curves", "v36-particle-motion-initial", "v36-particle-motion-velocity", "v36-particle-motion-integration",
  "v36-particle-motion-leaves", "v36-unity-particle-lifecycle", "v36-unity-particle-birth-context", "v36-unity-particle-birth-speed",
  "v36-unity-particle-geometry", "v35-unity-particle-emission"];
const required = new Set("19ba50 1f1190 1e5e50 1e64a0 19a320 1b0d80 17e210 755d00 1a1af0 1a1470 1a15a0 1ad670 762db0 75d030 18cbd0 75e4a0 185510 191370 19a690 1972a0 1957f0 196260 d88830 d88f50".split(" ").map((v) => "0x" + v));
let checks = 0; const check = (fn) => { fn(); checks++; };
for (const [path, digest] of [[dll, nativeSha256], [pdb, pdbSha256]]) {
  const bytes = await readFile(resolve(root, path)); check(() => assert.equal(sha(bytes), digest));
}
const methods = [], receipts = [];
for (const batch of batches) {
  const base = "build/native/" + batch, bytes = await readFile(resolve(root, base, "inspection.json"));
  const inspection = JSON.parse(bytes), receipt = await json(base + "/complete.json");
  check(() => assert.equal(receipt.status, "complete")); check(() => assert.equal(receipt.semanticsVerified, false));
  check(() => assert.equal(receipt.nativeSha256, nativeSha256)); check(() => assert.equal(receipt.inspectionSha256, sha(bytes)));
  check(() => assert.deepEqual(receipt.pdb, inspection.pdb)); check(() => assert.equal(receipt.methods.length, inspection.methods.length));
  for (const m of receipt.methods) {
    const code = await readFile(resolve(root, base, m.file)); check(() => assert.equal(sha(code), m.decompiledSha256));
    const { file, decompiledSha256, ...definition } = m;
    check(() => assert.deepEqual(definition, inspection.methods.find((v) => v.rva === m.rva)));
    if (required.has(m.rva) && !methods.some((v) => v.rva === m.rva)) methods.push({ batch, ...m });
  }
  receipts.push({ batch, inspectionSha256: sha(bytes), methods: receipt.methods.length });
}
check(() => assert.equal(methods.length, required.size));
const inspectionPath = "build/reports/field-particle-appearance-inspection.json";
execFileSync(resolve(root, ".venv/bin/python"), ["tools/native/inspect_unity_particles.py", "--dll", dll, "--pdb", pdb,
  "--publics", "build/native/unity-player-symbols/symbols.txt", "--locals", "build/native/unity-player-symbols/locals.txt",
  ...methods.flatMap((m) => ["--rva", m.rva]), "--out", inspectionPath], { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 });
const verified = await json(inspectionPath);
check(() => assert.equal(verified.pdb.guid, "4420B376-89DD-4CFE-AEC8-2300F4A999D2")); check(() => assert.equal(verified.pdb.age, 1));
for (const m of methods) {
  const actual = verified.methods.find((v) => v.rva === m.rva);
  check(() => assert.equal(actual?.sha256, m.sha256)); check(() => assert.equal(actual?.size, m.size));
  check(() => assert.deepEqual(actual?.aliases, m.aliases));
}
for (const [from, targets] of [["0x19ba50", ["0x1f1190"]], ["0x1f1190", ["0x1e5e50", "0x1e64a0"]],
  ["0x19a320", ["0x1b0d80"]], ["0x1b0d80", ["0x17e210", "0x1ad670"]], ["0x17e210", ["0x755d00"]],
  ["0x755d00", ["0x1a1470"]], ["0x1ad670", ["0x185510", "0x1a15a0"]], ["0x1a1470", ["0x1a1af0"]],
  ["0x762db0", ["0x75d030"]], ["0x19a690", ["0x191370", "0x19ba50"]], ["0x1972a0", ["0x19ba50"]],
  ["0x1957f0", ["0x196260", "0x19a860", "0x19ba50"]], ["0xd88f50", ["0x19a320"]], ["0xd88830", ["0x7608d0"]]])
  for (const target of targets) check(() => assert.ok(verified.methods.find((m) => m.rva === from)?.directCalls.some((c) => c.targetRva === target), `${from} -> ${target}`));
// CalculateInitialValues handles velocity, not lifetime Color/Size. Keep the
// source phase graph explicit rather than inferring it from a generic curve.
check(() => assert.ok(!verified.methods.find((m) => m.rva === "0x196260").directCalls.some((c) => ["0x1f1190", "0x1b0d80"].includes(c.targetRva))));
const instructionProbes = "build/reports/field-particle-appearance-instruction-probes.json";
execFileSync(resolve(root, ".venv/bin/python"), ["tools/native/probe_unity_particle_appearance.py", "--dll", dll, "--media", "build/v33-field-effect-media/media.json", "--out", instructionProbes], { cwd: root, encoding: "utf8" });
const probeBytes = await readFile(resolve(root, instructionProbes)), probes = JSON.parse(probeBytes);
check(() => assert.equal(probes.nativeSha256, nativeSha256)); check(() => assert.equal(probes.semanticsVerified, false));
const report = { formatVersion: 1, status: "pass", lane: "exact-source-particle-final-size-color-binding", checks, nativeSha256, pdbSha256,
  methods, receipts, inspectionPath, instructionProbes, instructionProbeSha256: sha(probeBytes), semanticsVerified: false,
  originalGameExecuted: false, admittedFullEmitters: 0, limitations: probes.limitations };
await mkdir(resolve(root, "build/reports"), { recursive: true });
await writeFile(resolve(root, "build/reports/field-particle-appearance-native-check.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ checks, nativeMethods: methods.length, instructionCases: Object.fromEntries(["bindings", "sizes", "colors"].map((k) => [k, probes[k].length])), admittedFullEmitters: 0 }));
