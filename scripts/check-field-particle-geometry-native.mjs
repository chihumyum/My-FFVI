// Exact local binaries/PDB and static method closure. Never launches the game.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url)), sha = (v) => createHash("sha256").update(v).digest("hex");
const json = async (p) => JSON.parse(await readFile(resolve(root, p), "utf8"));
const source = { nativeSha256: "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
  symbolsSha256: "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3",
  headerSha256: "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718" };
let checks = 0; const check = (fn) => { fn(); checks++; };
for (const [path, digest] of [["build/runtime/game/GameAssembly.dll", source.nativeSha256], ["build/native/il2cpp/script.json", source.symbolsSha256],
  ["build/native/il2cpp/il2cpp_ghidra.h", source.headerSha256]]) {
  const bytes = await readFile(resolve(root, path)); check(() => assert.equal(sha(bytes), digest));
}
const managedMethods = [], code = new Map();
for (const [batch, addresses] of Object.entries({ "v33-field-effect-lifecycle": [0xe0c570, 0x87dc90], "v31-field-background-layout": [0x43b490] })) {
  const receipt = await json("build/native/" + batch + "/complete.json");
  for (const [key, digest] of Object.entries(source)) check(() => assert.equal(receipt[key], digest));
  check(() => assert.equal(receipt.status, "complete")); check(() => assert.equal(receipt.semanticsVerified, false));
  for (const address of addresses) {
    const method = receipt.methods.find((m) => Number(m.rva) === address); assert.ok(method);
    const text = await readFile(resolve(root, "build/native", batch, address.toString(16) + ".c"));
    check(() => assert.equal(sha(text), method.decompiledSha256)); code.set(address, text.toString()); managedMethods.push({ batch, ...method });
  }
}
const python = `import json,hashlib,sys
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from tools.native.inspect_pe import PEImage
from capstone import Cs,CS_ARCH_X86,CS_MODE_64
pe=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
cs=Cs(CS_ARCH_X86,CS_MODE_64)
methods=json.load(sys.stdin)
out={'managed':[hashlib.sha256(pe.read(int(x['rva'],0),int(x['nextSymbolRva'],0)-int(x['rva'],0))[2]).hexdigest() for x in methods],'raw':[]}
for a,b in [(0x10190e0,0x1019175),(0x1019180,0x10191dd),(0x1019240,0x10192e5),(0x1019390,0x10193ec),(0xe0c802,0xe0c832)]:
 data=pe.read(a,b-a)[2]
 rows=[{'rva':hex(i.address-0x180000000),'instruction':i.mnemonic+' '+i.op_str} for i in cs.disasm(data,0x180000000+a)]
 out['raw'].append({'rva':hex(a),'endRva':hex(b),'sha256':hashlib.sha256(data).hexdigest(),'instructions':rows})
print(json.dumps(out))`;
const raw = JSON.parse(execFileSync(resolve(root, ".venv/bin/python"), ["-c", python, root], { input: JSON.stringify(managedMethods), encoding: "utf8" }));
managedMethods.forEach((m, i) => check(() => assert.equal(m.nativeRangeSha256, raw.managed[i])));
const asm = new Map(raw.raw.map((r) => [Number(r.rva), r.instructions.map((i) => i.instruction).join("\n")]));
check(() => assert.match(asm.get(0xe0c802), /addss xmm0, xmm0[\s\S]*xor r9d, r9d[\s\S]*cvttss2si edx, xmm0[\s\S]*mov r8d, edx[\s\S]*call 0x181019180[\s\S]*mov dl, 1[\s\S]*call 0x181019390/));
check(() => assert.match(asm.get(0x1019180), /xor ecx, ecx[\s\S]*mov dword ptr \[rsp \+ 0x20\], ecx[\s\S]*call 0x181019240/));
check(() => assert.match(asm.get(0x1019240), /mov eax, dword ptr \[rsp \+ 0x70\][\s\S]*mov dword ptr \[rsp \+ 0x20\], eax[\s\S]*call 0x1810190e0/));
check(() => assert.match(asm.get(0x10190e0), /mov dword ptr \[rcx \+ 8\], 1[\s\S]*test ecx, ecx[\s\S]*mov dword ptr \[rbx \+ 0x1c\], edi/));
check(() => assert.match(asm.get(0x1019390), /mov ecx, dword ptr \[rcx \+ 0x14\][\s\S]*call 0x180fc9f60[\s\S]*call 0x180fc9e80[\s\S]*mov dword ptr \[rdi \+ 0x14\], eax[\s\S]*call 0x180fca000[\s\S]*and ecx, 0xfffffffb[\s\S]*or ecx, 4/));
check(() => assert.match(code.get(0xe0c570), /get_orthographicSize[\s\S]*set_cullingMask\(pUVar25,0x4000/));
check(() => assert.match(code.get(0x87dc90), /iVar10 = 0x995;[\s\S]*iVar10 = 0x99c;[\s\S]*set_renderQueue\(material,0x99a/));
check(() => assert.match(code.get(0x43b490), /0xa00000005[\s\S]*0x100000001/));

const dll = "build/runtime/game/UnityPlayer.dll", pdb = "build/native/unity-player-symbols/UnityPlayer_Win64_il2cpp_x64.pdb";
const nativeSha256 = "7930dbf028be9e3d146a92dc756a166f10cada81f433c49b8fb4eb6767ae9845",
  pdbSha256 = "c7bbffbd21b1ee59e18612b566d6815aa0d2218397d0e187051cbd239b152d85";
const dllBytes = await readFile(resolve(root, dll)), pdbBytes = await readFile(resolve(root, pdb));
check(() => assert.equal(sha(dllBytes), nativeSha256)); check(() => assert.equal(sha(pdbBytes), pdbSha256));
const engineMethods = [];
for (const [batch, addresses] of Object.entries({ "v35-unity-particle-seeds": [0xd7aaf0, 0xd7c9f0, 0xd7c720],
  "v35-unity-particle-emission": [0xd7ecc0, 0xd88f50, 0xd5bfd0] })) {
  const base = "build/native/" + batch, receipt = await json(base + "/complete.json"), inspectionBytes = await readFile(resolve(root, base, "inspection.json"));
  const inspection = JSON.parse(inspectionBytes);
  check(() => assert.equal(receipt.status, "complete")); check(() => assert.equal(receipt.semanticsVerified, false));
  check(() => assert.equal(receipt.nativeSha256, nativeSha256)); check(() => assert.equal(receipt.inspectionSha256, sha(inspectionBytes)));
  check(() => assert.deepEqual(receipt.pdb, inspection.pdb)); check(() => assert.equal(receipt.pdb.sha256, pdbSha256));
  check(() => assert.equal(receipt.pdb.guid, "4420B376-89DD-4CFE-AEC8-2300F4A999D2")); check(() => assert.equal(receipt.pdb.age, 1));
  for (const address of addresses) {
    const method = receipt.methods.find((m) => Number(m.rva) === address); assert.ok(method);
    const text = await readFile(resolve(root, base, method.file)); check(() => assert.equal(sha(text), method.decompiledSha256));
    engineMethods.push({ batch, ...method });
  }
}
const inspectionPath = "build/reports/field-particle-geometry-engine-inspection.json";
execFileSync(resolve(root, ".venv/bin/python"), ["tools/native/inspect_unity_particles.py", "--dll", dll, "--pdb", pdb,
  "--publics", "build/native/unity-player-symbols/symbols.txt", "--locals", "build/native/unity-player-symbols/locals.txt",
  ...engineMethods.flatMap((m) => ["--rva", m.rva]), "--out", inspectionPath], { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 });
const inspected = await json(inspectionPath);
for (const method of engineMethods) {
  const actual = inspected.methods.find((m) => m.rva === method.rva); assert.ok(actual);
  check(() => assert.equal(actual.sha256, method.sha256)); check(() => assert.equal(actual.size, method.size));
  check(() => assert.deepEqual(actual.aliases, method.aliases));
}
const generator = inspected.methods.find((m) => m.rva === "0xd5bfd0");
check(() => assert.deepEqual(generator.aliases, ["GenerateParticleGeometry<0,0,0,0>"]));
check(() => assert.equal(generator.size, 5825)); check(() => assert.equal(generator.boundary, "pdb-procedure-length"));
const report = { formatVersion: 1, lane: "exact-local-particle-geometry-static-binding", status: "pass", checks,
  source, managedMethods, rawDescriptorRanges: raw.raw, engine: { nativeSha256, pdbSha256, inspectionPath, methods: engineMethods },
  semanticsVerified: false, originalGameExecuted: false, admittedParticleGenerators: 0,
  limitations: ["Six exact UnityPlayer geometry methods are bound, but SIMD billboard expansion/job inputs are not yet implemented.",
    "The real RT requests sRGB and depthBits=0. Existing ordinary-field depth attachments do not prove that particle RT has depth.",
    "Static decompilation receipts and instruction assertions do not establish native GPU raster/color-encoding equivalence."] };
await mkdir(resolve(root, "build/reports"), { recursive: true });
await writeFile(resolve(root, "build/reports/field-particle-geometry-native-check.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ status: "pass", checks, managedMethods: managedMethods.length, rawRanges: raw.raw.length,
  engineMethods: engineMethods.length, semanticsVerified: false, admittedParticleGenerators: 0 }));
