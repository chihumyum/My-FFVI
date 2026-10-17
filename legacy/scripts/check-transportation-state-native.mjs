// Existing source exports plus exact constructor/setter instructions. No game
// process, new decompilation or copied evidence report is used as an oracle.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
await rm(root + "build/reports/transportation-state-native-check.json", { force: true });
const sha = (value) => createHash("sha256").update(value).digest("hex");
const identity = {
  nativeSha256: "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
  symbolsSha256: "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3",
  headerSha256: "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718",
};
for (const [key, file] of Object.entries({ nativeSha256: "build/runtime/game/GameAssembly.dll",
  symbolsSha256: "build/native/il2cpp/script.json", headerSha256: "build/native/il2cpp/il2cpp_ghidra.h" }))
  assert.equal(sha(await readFile(root + file)), identity[key]);
const methods = [], code = new Map();
for (const [batch, rvas] of [
  ["v19-transport-lifecycle", ["8e18a0", "8e1a90"]],
  ["v19-transport-entry", ["8e13c0"]],
  ["v19-transport-enable", ["2f1fe0"]],
  ["v19-transport-boarding", ["2cb2b0"]],
]) {
  const receipt = JSON.parse(await readFile(root + `build/native/${batch}/complete.json`, "utf8"));
  assert.equal(receipt.status, "complete"); assert.equal(receipt.semanticsVerified, false);
  for (const [key, value] of Object.entries(identity)) assert.equal(receipt[key], value);
  for (const rva of rvas) {
    const matches = receipt.methods.filter((method) => method.rva === "0x" + rva);
    assert.equal(matches.length, 1);
    const bytes = await readFile(root + `build/native/${batch}/${rva}.c`);
    assert.equal(sha(bytes), matches[0].decompiledSha256);
    code.set(rva, bytes.toString("utf8")); methods.push({ batch, ...matches[0] });
  }
}
const symbols = JSON.parse(await readFile(root + "build/native/il2cpp/script.json", "utf8"));
const raw = [
  { rva: "0x9f5160", size: 128, name: "Last.Map.SaveEntityData$$.ctor" },
  { rva: "0x8e1d00", size: 64, name: "Last.Data.User.SaveTransportationData$$SetData" },
  { rva: "0xb25940", size: 48, name: "MapUtility$$GetOnLayerZOrderByLayer" },
];
for (const entry of raw)
  assert.equal(symbols.ScriptMethod.filter((method) => method.Address === Number(entry.rva) && method.Name === entry.name).length, 1);
const inspected = JSON.parse(execFileSync(root + ".venv/bin/python", ["-c", `import json,sys,hashlib
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from tools.native.inspect_pe import PEImage
from capstone import Cs,CS_ARCH_X86,CS_MODE_64
p=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
cs=Cs(CS_ARCH_X86,CS_MODE_64); out=[]; ins={}
for r in json.load(sys.stdin):
 start=int(r['rva'],0); data=p.read(start,r['size'])[2]
 ins.update({i.address-0x180000000:(i.mnemonic,i.op_str) for i in cs.disasm(data,0x180000000+start)})
 out.append(dict(**r,sha256=hashlib.sha256(data).hexdigest()))
def check(rva,mnemonic,operands): assert ins[rva]==(mnemonic,operands),(hex(rva),ins[rva])
check(0x9f51d2,'mov','dword ptr [rbx + 0x1c], 0')
# SetData identity check, then only position/direction/map/ticks. No enable+28.
for rva,mnemonic,operands in [(0x8e1d05,'mov','eax, dword ptr [rdx + 0x20]'),
 (0x8e1d08,'cmp','dword ptr [rcx + 0x20], eax'),
 (0x8e1d12,'movsd','qword ptr [rcx + 0x10], xmm0'),
 (0x8e1d1a,'mov','dword ptr [rcx + 0x18], eax'),
 (0x8e1d20,'mov','dword ptr [rcx + 0x1c], eax'),
 (0x8e1d26,'mov','dword ptr [rcx + 0x24], eax'),
 (0x8e1d2d,'mov','qword ptr [rcx + 0x30], rax')]: check(rva,mnemonic,operands)
check(0xb25940,'add','ecx, -9')
check(0xb25954,'xor','eax, eax')
for rva,value in [(0xb25957,'0x31'),(0xb2595d,'0x95'),(0xb25963,'0xf9'),(0xb25969,'0x15d')]: check(rva,'mov','eax, '+value)
print(json.dumps(out))`, root], { input: JSON.stringify([
  ...methods.map((method) => ({ rva: method.rva, size: Number(method.nextSymbolRva) - Number(method.rva) })), ...raw,
]), encoding: "utf8" }));
methods.forEach((method, index) => assert.equal(inspected[index].sha256, method.nativeRangeSha256));
const patterns = [
  ["8e18a0", /SaveEntityData___ctor[\s\S]*mapId = -1[\s\S]*0x447a0000,0x447a0000,0xc47a0000[\s\S]*timeStampTicks = 0/],
  ["8e1a90", /DataStorage__Get[\s\S]*return iVar4 != 0/],
  ["8e13c0", /DataStorage__Set[\s\S]*\(uint\)enable/],
  ["2f1fe0", /SetDataStorageFlag\(__this_01,enable[\s\S]*set_MessageSpeed_529f10\(__this_01,stayMapId/],
  ["2f1fe0", /mapPos->fields\)\.has_value != false/],
  ["2f1fe0", /layer.fields.has_value != false[\s\S]*8 < iVar8[\s\S]*GetOnLayerZOrderByLayer/],
  ["2f1fe0", /direction.fields.has_value != false[\s\S]*set_BattleMessageSpeed_529d40/],
  ["2f1fe0", /if \(!enable\)/],
  ["2f1fe0", /DateTime__get_Now[\s\S]*set_TimeStampTicks/],
  ["2f1fe0", /SetTransportationData[\s\S]*TransportationController__SetData/],
  ["2cb2b0", /FUN_18004f690\(0x16,_Last_Map_IMapAccessor_TypeInfo,lVar4,iVar7,1,iVar1/],
];
for (const [rva, pattern] of patterns) assert.match(code.get(rva), pattern);
for (const [rva, name] of [[0x529f10, "Last.Data.User.OwnedTransportationData$$set_MapId"],
  [0x529d40, "Last.Data.User.OwnedTransportationData$$set_Direction"]])
  assert.equal(symbols.ScriptMethod.filter((method) => method.Address === rva && method.Name === name).length, 1);
const report = { kind: "transportation-owned-state-native-v1", ...identity, methods,
  raw: inspected.slice(methods.length), semanticChecks: patterns.length,
  semanticsVerified: false, originalGameExecuted: false,
  scope: "TransportationEnabled owned payload; release remains EventState; runtime controller/media/GPS are separate" };
await mkdir(root + "build/reports", { recursive: true });
await writeFile(root + "build/reports/transportation-state-native-check.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ methods: methods.length, rawMethods: raw.length,
  semanticChecks: patterns.length, reportSha256: sha(JSON.stringify(report)), semanticsVerified: false }));
