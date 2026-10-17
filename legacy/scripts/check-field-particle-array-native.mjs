import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url)), sha = (v) => createHash("sha256").update(v).digest("hex");
const json = async (p) => JSON.parse(await readFile(resolve(root, p), "utf8"));
const nativeSha256 = "7930dbf028be9e3d146a92dc756a166f10cada81f433c49b8fb4eb6767ae9845";
const pdbSha256 = "c7bbffbd21b1ee59e18612b566d6815aa0d2218397d0e187051cbd239b152d85";
const dll = "build/runtime/game/UnityPlayer.dll", pdb = "build/native/unity-player-symbols/UnityPlayer_Win64_il2cpp_x64.pdb";
const needed = new Set(["0x1947d0", "0x17e2f0", "0x18a500", "0x19a270", "0x19cc30", "0x19c5d0", "0x1957f0", "0x186c80"]);
const batches = ["v37-particle-array", "v36-unity-particle-birth-context", "v36-unity-particle-lifecycle-context"];
let checks = 0; const check = (fn) => { fn(); checks++; };
const nativeBytes = await readFile(resolve(root, dll)), pdbBytes = await readFile(resolve(root, pdb));
check(() => assert.equal(sha(nativeBytes), nativeSha256)); check(() => assert.equal(sha(pdbBytes), pdbSha256));
const methods = new Map();
for (const batch of batches) {
  const base = "build/native/" + batch, bytes = await readFile(resolve(root, base, "inspection.json"));
  const inspection = JSON.parse(bytes), receipt = await json(base + "/complete.json");
  check(() => assert.equal(receipt.status, "complete")); check(() => assert.equal(receipt.semanticsVerified, false));
  check(() => assert.equal(receipt.nativeSha256, nativeSha256)); check(() => assert.equal(receipt.inspectionSha256, sha(bytes)));
  check(() => assert.deepEqual(receipt.pdb, inspection.pdb)); check(() => assert.equal(receipt.methods.length, inspection.methods.length));
  for (const method of receipt.methods) {
    const code = await readFile(resolve(root, base, method.file)); check(() => assert.equal(sha(code), method.decompiledSha256));
    const { file, decompiledSha256, ...body } = method;
    check(() => assert.deepEqual(body, inspection.methods.find((m) => m.rva === method.rva)));
    if (needed.has(method.rva)) methods.set(method.rva, { batch, ...method });
  }
}
check(() => assert.equal(methods.size, needed.size));
await mkdir(resolve(root, "build/reports"), { recursive: true });
const python = resolve(root, ".venv/bin/python"), verifiedPath = "build/reports/field-particle-array-inspection.json";
execFileSync(python, ["tools/native/inspect_unity_particles.py", "--dll", dll, "--pdb", pdb,
  "--publics", "build/native/unity-player-symbols/symbols.txt", "--locals", "build/native/unity-player-symbols/locals.txt",
  ...[...needed].flatMap((rva) => ["--rva", rva]), "--out", verifiedPath], { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 });
const verified = await json(verifiedPath);
check(() => assert.equal(verified.pdb.guid, "4420B376-89DD-4CFE-AEC8-2300F4A999D2")); check(() => assert.equal(verified.pdb.age, 1));
for (const method of methods.values()) {
  const actual = verified.methods.find((m) => m.rva === method.rva);
  for (const key of ["sha256", "size", "aliases", "directCalls", "tailTargets"]) check(() => assert.deepEqual(actual?.[key], method[key]));
}
for (const [from, target] of [["0x1947d0", "0x17e2f0"], ["0x1947d0", "0x19c5d0"], ["0x1957f0", "0x17e2f0"],
  ["0x17e2f0", "0x19cc30"], ["0x18a500", "0x19cc30"], ["0x18a500", "0x19c5d0"], ["0x19a270", "0x1947d0"]])
  check(() => assert.ok(verified.methods.find((m) => m.rva === from)?.directCalls.some((c) => c.targetRva === target)));
const probePath = "build/reports/field-particle-array-instruction-probes.json";
execFileSync(python, ["tools/native/probe_unity_particle_array.py", "--dll", dll, "--out", probePath], { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 });
const probeBytes = await readFile(resolve(root, probePath)), probes = JSON.parse(probeBytes);
check(() => assert.equal(probes.nativeSha256, nativeSha256)); check(() => assert.equal(probes.semanticsVerified, false));
check(() => assert.equal(probes.existing.length, 309)); check(() => assert.equal(probes.newborn.length, 448)); check(() => assert.equal(probes.copies.length, 72));
const report = { lane: "exact-local-unity-array-static-and-isolated-instruction-binding", semanticsVerified: false, checks, nativeSha256, pdbSha256,
  methods: [...methods.values()].map(({ batch, rva, aliases, size, sha256 }) => ({ batch, rva, aliases, size, sha256 })),
  verifiedInspection: verifiedPath, instructionProbes: probePath, instructionProbeSha256: sha(probeBytes),
  existingCases: probes.existing.length, newbornCases: probes.newborn.length, scratchCopyCases: probes.copies.length,
  controlledProviders: probes.controlledProviders, doesNotEstablish: probes.notVerified };
await writeFile(resolve(root, "build/reports/field-particle-array-native-check.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ checks, methods: methods.size, existingCases: report.existingCases, newbornCases: report.newbornCases,
  scratchCopyCases: report.scratchCopyCases, semanticsVerified: false }));
