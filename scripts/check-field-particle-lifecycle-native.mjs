// Byte/PDB qualification and isolated source scheduler instruction probes.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const sha = (v) => createHash("sha256").update(v).digest("hex");
const json = async (p) => JSON.parse(await readFile(resolve(root, p), "utf8"));
const nativeSha256 = "7930dbf028be9e3d146a92dc756a166f10cada81f433c49b8fb4eb6767ae9845";
const pdbSha256 = "c7bbffbd21b1ee59e18612b566d6815aa0d2218397d0e187051cbd239b152d85";
const dll = "build/runtime/game/UnityPlayer.dll", pdb = "build/native/unity-player-symbols/UnityPlayer_Win64_il2cpp_x64.pdb";
let checks = 0; const check = (fn) => { fn(); checks++; };
for (const [path, digest] of [[dll, nativeSha256], [pdb, pdbSha256]]) {
  const bytes = await readFile(resolve(root, path)); check(() => assert.equal(sha(bytes), digest));
}
const methods = [];
for (const batch of ["v36-unity-particle-lifecycle", "v36-unity-particle-lifecycle-context", "v35-unity-particle-seeds", "v36-unity-particle-birth-context"]) {
  const base = "build/native/" + batch, bytes = await readFile(resolve(root, base, "inspection.json"));
  const inspection = JSON.parse(bytes), receipt = await json(base + "/complete.json");
  check(() => assert.equal(receipt.status, "complete")); check(() => assert.equal(receipt.semanticsVerified, false));
  check(() => assert.equal(receipt.nativeSha256, nativeSha256)); check(() => assert.equal(receipt.inspectionSha256, sha(bytes)));
  check(() => assert.deepEqual(receipt.pdb, inspection.pdb)); check(() => assert.equal(receipt.methods.length, inspection.methods.length));
  for (const m of receipt.methods) {
    const code = await readFile(resolve(root, base, m.file)); check(() => assert.equal(sha(code), m.decompiledSha256));
    const { file, decompiledSha256, ...definition } = m;
    check(() => assert.deepEqual(definition, inspection.methods.find((v) => v.rva === m.rva)));
    methods.push({ batch, ...m });
  }
}
const inspectionPath = "build/reports/field-particle-lifecycle-inspection.json";
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
for (const [from, targets] of [
  ["0x197820", ["0x18e750", "0x1972a0"]],
  ["0x1972a0", ["0x1b0d30", "0x19a270", "0x1af7e0", "0x195e60"]],
  ["0x189920", ["0x550120", "0x18ce20", "0x13f8bec", "0x13f8b5c"]],
  ["0x18faf0", ["0x191860", "0x194180"]], ["0x194180", ["0x191860", "0x1892a0", "0x18faf0", "0x189920", "0x197e10"]],
  ["0x186c80", ["0x19bff0", "0x19c5d0"]],
]) for (const target of targets) check(() => assert.ok(verified.methods.find((m) => m.rva === from)?.directCalls.some((c) => c.targetRva === target)));
const instructionProbes = "build/reports/field-particle-lifecycle-instruction-probes.json";
execFileSync(resolve(root, ".venv/bin/python"), ["tools/native/probe_unity_particle_lifecycle.py", "--dll", dll, "--out", instructionProbes], { cwd: root, encoding: "utf8" });
const probeBytes = await readFile(resolve(root, instructionProbes)), probes = JSON.parse(probeBytes);
check(() => assert.equal(probes.nativeSha256, nativeSha256)); check(() => assert.equal(probes.semanticsVerified, false));
const report = { formatVersion: 1, status: "pass", lane: "exact-source-particle-clock-and-lifecycle-binding", checks,
  nativeSha256, pdbSha256, methods, inspectionPath, instructionProbes, instructionProbeSha256: sha(probeBytes), semanticsVerified: false,
  originalGameExecuted: false, admittedFullEmitters: 0, limitations: probes.notVerified, providers: probes.providers };
await mkdir(resolve(root, "build/reports"), { recursive: true });
await writeFile(resolve(root, "build/reports/field-particle-lifecycle-native-check.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ checks, nativeMethods: methods.length, timesteps: probes.timesteps.length,
  prewarmCases: probes.prewarm.length, scheduleCases: probes.schedules.length, allocationCases: probes.allocations.length,
  playSequenceCases: probes.playSequences.length, birthTimingCases: probes.birthTimings.length, admittedFullEmitters: 0 }));
