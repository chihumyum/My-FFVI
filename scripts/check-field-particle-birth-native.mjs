// Local exact-build/PDB binding plus isolated original-instruction execution.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const sha = (b) => createHash("sha256").update(b).digest("hex");
const json = async (p) => JSON.parse(await readFile(resolve(root, p), "utf8"));
const dll = "build/runtime/game/UnityPlayer.dll", pdb = "build/native/unity-player-symbols/UnityPlayer_Win64_il2cpp_x64.pdb";
const nativeSha256 = "7930dbf028be9e3d146a92dc756a166f10cada81f433c49b8fb4eb6767ae9845";
const pdbSha256 = "c7bbffbd21b1ee59e18612b566d6815aa0d2218397d0e187051cbd239b152d85";
const publics = "build/native/unity-player-symbols/symbols.txt", locals = "build/native/unity-player-symbols/locals.txt";
const batches = ["birth", "birth-dispatch", "birth-context", "birth-speed", "birth-rotation"].map((s) => "v36-unity-particle-" + s);
let checks = 0; const check = (fn) => { fn(); checks++; };
const nativeBytes = await readFile(resolve(root, dll)), pdbBytes = await readFile(resolve(root, pdb));
check(() => assert.equal(sha(nativeBytes), nativeSha256)); check(() => assert.equal(sha(pdbBytes), pdbSha256));
const methods = [];
for (const batch of batches) {
  const path = "build/native/" + batch, bytes = await readFile(resolve(root, path, "inspection.json"));
  const inspection = JSON.parse(bytes), receipt = await json(path + "/complete.json");
  check(() => assert.equal(receipt.status, "complete")); check(() => assert.equal(receipt.semanticsVerified, false));
  check(() => assert.equal(receipt.inspectionSha256, sha(bytes))); check(() => assert.equal(receipt.nativeSha256, nativeSha256));
  check(() => assert.deepEqual(receipt.pdb, inspection.pdb)); check(() => assert.equal(receipt.methods.length, inspection.methods.length));
  for (const m of receipt.methods) {
    const bytes = await readFile(resolve(root, path, m.file)); check(() => assert.equal(sha(bytes), m.decompiledSha256));
    const { file, decompiledSha256, ...body } = m;
    check(() => assert.deepEqual(body, inspection.methods.find((item) => item.rva === m.rva)));
    methods.push({ batch, ...m });
  }
}
await mkdir(resolve(root, "build/reports"), { recursive: true });
const verifiedPath = "build/reports/field-particle-birth-inspection.json", shapePath = "build/reports/field-particle-birth-shape-inspection.json";
const python = resolve(root, ".venv/bin/python");
execFileSync(python, ["tools/native/inspect_unity_particles.py", "--dll", dll, "--pdb", pdb, "--publics", publics, "--locals", locals,
  ...methods.filter((m) => m.rva !== "0xda9940").flatMap((m) => ["--rva", m.rva]), "--out", verifiedPath], { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 });
execFileSync(python, ["tools/native/probe_unity_particle_birth.py", "--dll", dll, "--inspect", verifiedPath, "--publics", publics, "--locals", locals,
  "--out", shapePath], { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 });
const verified = await json(verifiedPath), shape = await json(shapePath), all = [...verified.methods, ...shape.methods];
check(() => assert.equal(verified.pdb.guid, "4420B376-89DD-4CFE-AEC8-2300F4A999D2")); check(() => assert.equal(verified.pdb.age, 1));
for (const m of methods) {
  const actual = all.find((v) => v.rva === m.rva);
  check(() => assert.equal(actual?.sha256, m.sha256)); check(() => assert.equal(actual?.size, m.size)); check(() => assert.deepEqual(actual?.aliases, m.aliases));
  check(() => assert.deepEqual(actual?.directCalls, m.directCalls)); check(() => assert.deepEqual(actual?.tailTargets, m.tailTargets));
}
for (const [from, target] of [["0x1957f0", "0x20b2d0"], ["0x1957f0", "0xda9940"], ["0x1957f0", "0x196260"],
  ["0xda9940", "0xd972c0"], ["0xd972c0", "0xda6ef0"], ["0xd972c0", "0xda7d90"], ["0x196260", "0x185510"]])
  check(() => assert.ok(all.find((m) => m.rva === from)?.directCalls.some((c) => c.targetRva === target)));
const switchBody = all.find((m) => m.rva === "0xda9940");
check(() => assert.equal(switchBody.switch.targets.length, 19)); check(() => assert.equal(switchBody.switch.tableRva, "0xdaaf60"));
const probePath = "build/reports/field-particle-birth-instruction-probes.json";
execFileSync(python, ["tools/native/probe_unity_particle_birth.py", "--dll", dll, "--out", probePath], { cwd: root, encoding: "utf8" });
const probes = await json(probePath);
check(() => assert.equal(probes.nativeSha256, nativeSha256)); check(() => assert.equal(probes.semanticsVerified, false));
check(() => assert.equal(probes.cases.length, 30)); check(() => assert.equal(probes.controlledCases.length, 3));
const report = { lane: "exact-local-unity-birth-static-and-isolated-instruction-binding", semanticsVerified: false, checks, nativeSha256, pdbSha256,
  methods: methods.map(({ batch, rva, aliases, size, sha256 }) => ({ batch, rva, aliases, size, sha256 })),
  verifiedInspection: verifiedPath, verifiedShapeInspection: shapePath, instructionProbes: probePath,
  instructionProbeSha256: sha(await readFile(resolve(root, probePath))),
  actualParameterBatches: probes.cases.reduce((n, c) => n + c.steps.length, 0), controlledExtensionBatches: probes.controlledCases.length,
  doesNotEstablish: ["Original Windows/Unity process execution", "System entropy or scheduling", "Every physical CPU's reciprocal estimates", "Complete emitter rendering"] };
await writeFile(resolve(root, "build/reports/field-particle-birth-native-check.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ checks, nativeMethods: methods.length, actualParameterBatches: report.actualParameterBatches, controlledExtensionBatches: report.controlledExtensionBatches, semanticsVerified: false }));
