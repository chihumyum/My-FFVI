// Exact engine/PDB binding and isolated instruction probes. No Unity process runs.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const sha = (value) => createHash("sha256").update(value).digest("hex");
const json = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));
const nativeSha256 = "7930dbf028be9e3d146a92dc756a166f10cada81f433c49b8fb4eb6767ae9845";
const pdbSha256 = "c7bbffbd21b1ee59e18612b566d6815aa0d2218397d0e187051cbd239b152d85";
const pdb = "build/native/unity-player-symbols/UnityPlayer_Win64_il2cpp_x64.pdb";
const dll = "build/runtime/game/UnityPlayer.dll";
let checks = 0; const check = (fn) => { fn(); checks++; };
const dllBytes = await readFile(resolve(root, dll)), pdbBytes = await readFile(resolve(root, pdb));
check(() => assert.equal(sha(dllBytes), nativeSha256)); check(() => assert.equal(sha(pdbBytes), pdbSha256));
const batches = ["v35-unity-particle-seeds", "v35-unity-particle-emission"], methods = [];
for (const batch of batches) {
  const base = "build/native/" + batch, inspectionBytes = await readFile(resolve(root, base, "inspection.json"));
  const inspection = JSON.parse(inspectionBytes), receipt = await json(base + "/complete.json");
  check(() => assert.equal(receipt.status, "complete")); check(() => assert.equal(receipt.semanticsVerified, false));
  check(() => assert.equal(receipt.nativeSha256, nativeSha256)); check(() => assert.equal(receipt.inspectionSha256, sha(inspectionBytes)));
  check(() => assert.deepEqual(receipt.pdb, inspection.pdb)); check(() => assert.equal(receipt.methods.length, inspection.methods.length));
  for (const method of receipt.methods) {
    const text = await readFile(resolve(root, base, method.file)); check(() => assert.equal(sha(text), method.decompiledSha256));
    check(() => assert.deepEqual({ ...method, file: undefined, decompiledSha256: undefined }, { ...inspection.methods.find((m) => m.rva === method.rva), file: undefined, decompiledSha256: undefined }));
    methods.push({ batch, ...method });
  }
}
const verifiedPath = "build/reports/field-particle-emitter-inspection.json";
execFileSync(resolve(root, ".venv/bin/python"), ["tools/native/inspect_unity_particles.py", "--dll", dll, "--pdb", pdb,
  "--publics", "build/native/unity-player-symbols/symbols.txt", "--locals", "build/native/unity-player-symbols/locals.txt",
  ...methods.flatMap((m) => ["--rva", m.rva]), "--out", verifiedPath], { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 });
const verified = await json(verifiedPath);
check(() => assert.equal(verified.pdb.guid, "4420B376-89DD-4CFE-AEC8-2300F4A999D2")); check(() => assert.equal(verified.pdb.age, 1));
check(() => assert.equal(verified.pdb.symbolUrl, "https://symbolserver.unity3d.com/UnityPlayer_Win64_il2cpp_x64.pdb/4420B37689DD4CFEAEC82300F4A999D21/UnityPlayer_Win64_il2cpp_x64.pdb"));
for (const method of methods) {
  const actual = verified.methods.find((m) => m.rva === method.rva);
  check(() => assert.equal(actual?.sha256, method.sha256)); check(() => assert.equal(actual?.size, method.size));
  check(() => assert.deepEqual(actual?.aliases, method.aliases));
}
for (const [from, target, alias] of [
  ["0x184760", "0x764bd0", "?RandomizeState@Rand@@QEAAXXZ"],
  ["0x764bd0", "0x814370", "?GetSystemEntropy@@YA_NPEAE_K@Z"],
  ["0x814370", "0xeceadc", "BCryptGenRandom"],
  ["0x20abb0", "0x764ce0", "?SetSeed@RandN@@QEAAXAEBU_int1@math@@@Z"],
  ["0xda98f0", "0x764ce0", "?SetSeed@RandN@@QEAAXAEBU_int1@math@@@Z"],
]) check(() => assert.ok(verified.methods.find((m) => m.rva === from)?.directCalls.some((c) => c.targetRva === target && c.aliases.includes(alias))));
for (const [name, target] of [["get_randomSeed", "0x3804f0"], ["set_randomSeed", "0x38d130"], ["Simulate", "0x378e00"], ["Play", "0x378480"]]) {
  const calls = verified.icalls.filter((c) => c.name === "UnityEngine.ParticleSystem::" + name);
  check(() => assert.equal(calls.length, 1)); check(() => assert.equal(calls[0].functionRva, target));
  check(() => assert.ok(calls[0].aliases.length > 0));
}
const probePath = "build/reports/field-particle-emitter-instruction-probes.json";
execFileSync(resolve(root, ".venv/bin/python"), ["tools/native/probe_unity_particle_emitter.py", "--dll", dll, "--out", probePath], { cwd: root, encoding: "utf8" });
const probes = await json(probePath);
check(() => assert.equal(probes.nativeSha256, nativeSha256)); check(() => assert.equal(probes.semanticsVerified, false));
const report = { lane: "exact-local-unity-engine-and-pdb-static-binding", semanticsVerified: false, nativeSha256, pdbSha256,
  checks, methods: methods.map(({ batch, rva, aliases, size, sha256 }) => ({ batch, rva, aliases, size, sha256 })),
  icallRegistrations: verified.icalls.length, verifiedInspection: verifiedPath, instructionProbes: probePath,
  instructionProbeSha256: sha(await readFile(resolve(root, probePath))),
  doesNotEstablish: ["Original-game execution", "Automatic entropy values", "Engine frame/substep scheduling", "Complete particle prefab execution"] };
await mkdir(resolve(root, "build/reports"), { recursive: true });
await writeFile(resolve(root, "build/reports/field-particle-emitter-native-check.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ checks, nativeMethods: methods.length, icallRegistrations: report.icallRegistrations, semanticsVerified: false }));
