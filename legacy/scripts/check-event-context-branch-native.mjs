// Static source binding; these checks do not execute or validate the original game.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = root + "build/reports/event-context-branch-native-check.json";
const sha = (data) => createHash("sha256").update(data).digest("hex");
const identity = {
  nativeSha256: "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
  symbolsSha256: "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3",
  headerSha256: "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718",
};
await mkdir(root + "build/reports", { recursive: true });
await rm(output, { force: true });
for (const [key, path] of Object.entries({ nativeSha256: "build/runtime/game/GameAssembly.dll",
  symbolsSha256: "build/native/il2cpp/script.json", headerSha256: "build/native/il2cpp/il2cpp_ghidra.h" }))
  assert.equal(sha(await readFile(root + path)), identity[key], path);
const symbols = JSON.parse(await readFile(root + "build/native/il2cpp/script.json", "utf8"));
const addresses = [...new Set(symbols.ScriptMethod.map((method) => method.Address))].sort((a, b) => a - b);
const bind = (rva, name) => assert.equal(symbols.ScriptMethod.filter((m) => m.Address === Number(rva) && m.Name === name).length, 1, name);
const batches = {
  "event-interaction-v39": [
    ["b43990", "Last.Interpreter.Instructions.External.Branch$$BranchByCharacter"],
    ["b44a20", "Last.Interpreter.Instructions.External.Branch$$BranchByPlayerDirection"],
  ],
  "v18-field-foot-monitor": [
    ["86e820", "Last.Management.UserDataManager$$GetCorpsListClone"],
    ["870230", "Last.Management.UserDataManager$$GetMemberData"],
  ],
  "shared-event-vm": [["2bb700", "Last.Interpreter.Instructions.Internal.Main$$JumpCommon"]],
  "event-state": [["834420", "Last.Interpreter.Core.ProgramCounter$$JumpTo"]],
  "ai-state": [["82d2c0", "Last.Interpreter.Core$$Clock"]],
};
const methods = [], code = new Map();
for (const [batch, entries] of Object.entries(batches)) {
  const receipt = JSON.parse(await readFile(root + `build/native/${batch}/complete.json`, "utf8"));
  assert.equal(receipt.status, "complete"); assert.equal(receipt.semanticsVerified, false);
  for (const [key, value] of Object.entries(identity)) assert.equal(receipt[key], value);
  for (const [hex, name] of entries) {
    const rva = "0x" + hex; bind(rva, name);
    const matches = receipt.methods.filter((method) => method.rva === rva);
    assert.equal(matches.length, 1, rva);
    const method = matches[0], bytes = await readFile(root + `build/native/${batch}/${hex}.c`);
    assert.equal(Number(method.nextSymbolRva), addresses.find((address) => address > Number(rva)));
    assert.equal(sha(bytes), method.decompiledSha256, rva);
    assert.ok(bytes.toString().startsWith(`/* RVA ${rva}; ${method.name};`));
    methods.push({ batch, sourceName: name, ...method }); code.set(rva, bytes.toString());
  }
}
const raw = [
  ["e0dd70", "Last.Entity.Field.FieldEntity$$GetNormalizedDirectionVector"],
  ["871840", "Last.Management.UserDataManager$$GetOwnedCharactersClone"],
  ["52ffe0", "Last.Data.User.OwnedCharacterData$$get_IsEnableCorps"],
  ["4a4310", "Last.Management.UserDataManager.<>c__DisplayClass127_0$$<GetMemberData>b__0"],
  ["52ffc0", "Last.Data.User.OwnedCharacterData$$get_Id"],
  ["530160", "Last.Data.User.OwnedCharacterData$$get_characterStatusId"],
].map(([hex, name]) => {
  const rva = "0x" + hex; bind(rva, name);
  return { rva, name, size: addresses.find((address) => address > Number(rva)) - Number(rva) };
});
// 409ff0 is a shared generic return-0 stub, not a uniquely named source method.
raw.push({ rva: "0x409ff0", name: "shared return-0 stub at the two reviewed call sites", size: 16 });
const python = String.raw`import sys,json,hashlib,capstone
from pathlib import Path
sys.path.insert(0,sys.argv[1]);from tools.native.inspect_pe import PEImage
p=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
cs=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64)
out=[]
for r in json.load(sys.stdin):
 section,offset,data=p.read(int(r['rva'],0),r['size'])
 instructions=[dict(rva=hex(i.address),mnemonic=i.mnemonic,operands=i.op_str) for i in cs.disasm(data,int(r['rva'],0))]
 out.append(dict(**r,section=section,fileOffset=offset,sha256=hashlib.sha256(data).hexdigest(),instructions=instructions))
print(json.dumps(out))`;
const ranges = JSON.parse(execFileSync(root + ".venv/bin/python", ["-c", python, root], {
  input: JSON.stringify([...methods.map((m) => ({ rva: m.rva, size: Number(m.nextSymbolRva) - Number(m.rva) })), ...raw]),
  maxBuffer: 8 * 1024 * 1024,
}));
methods.forEach((method, index) => assert.equal(ranges[index].sha256, method.nativeRangeSha256, method.rva));
const has = (rva, mnemonic, operands) => assert.ok(ranges.find((r) => r.rva === rva).instructions.some((i) =>
  i.mnemonic === mnemonic && i.operands === operands), `${rva} ${mnemonic} ${operands}`);
assert.match(code.get("0xb43990"), /GetOwnedCharactersClone\s*\(pLVar8,false/);
assert.match(code.get("0xb43990"), /m_Items\[2\] != 0/);
assert.match(code.get("0xb43990"), /\(uint\)!bVar4 != pSVar1->m_Items\[1\]/);
assert.match(code.get("0xb43990"), /GetCorpsListClone[\s\S]*GetMemberData[\s\S]*get_characterStatusId/);
assert.match(code.get("0xb43990"), /m_Items\[3\][\s\S]*JumpCommon/);
assert.match(code.get("0x86e820"), /_corpsList_k__BackingField/);
assert.match(code.get("0x870230"), /_corpsList_k__BackingField[\s\S]*_OwnedCharacterList_k__BackingField/);
has("0x871840", "test", "r14b, r14b"); has("0x871840", "call", "0x52ffe0");
has("0x871840", "je", "0x8718e0");
has("0x4a4310", "call", "0x52ffc0"); has("0x4a4310", "cmp", "eax, dword ptr [rbx + 0x10]");
has("0x52ffc0", "mov", "eax, dword ptr [rax + 0x10]");
has("0x530160", "mov", "eax, dword ptr [rax + 0x14]");
has("0xb44a20", "mov", "r8, qword ptr [rax + 0x90]");
has("0xb44a20", "mov", "ecx, 7"); has("0xb44a20", "call", "0xe0dd70");
has("0xe0dd70", "movss", "xmm0, dword ptr [rcx + 0x50]");
has("0xe0dd70", "movss", "xmm1, dword ptr [rcx + 0x54]");
has("0xe0dd70", "mov", "dword ptr [rsp + 0x34], 0");
assert.match(code.get("0xb44a20"), /UStackX_18\.x == 0\.0[\s\S]*0\.0 < UStackX_18\.y[\s\S]*m_Items\[0\][\s\S]*else[\s\S]*m_Items\[2\]/);
assert.match(code.get("0xb44a20"), /UStackX_18\.x <= 0\.0[\s\S]*m_Items\[3\][\s\S]*m_Items\[1\]/);
assert.match(code.get("0x2bb700"), /ProgramCounter__JumpTo/);
assert.match(code.get("0x834420"), /_min_k__BackingField <= address[\s\S]*address <=[\s\S]*_currentAddress_k__BackingField = address/);
assert.match(code.get("0x82d2c0"), /\(int\)auStack_28\[0\] == 0[\s\S]*ProgramCounter__ForwardStep/);
has("0x409ff0", "xor", "eax, eax"); has("0x409ff0", "ret", "");
const dump = await readFile(root + "build/native/il2cpp/dump.cs", "utf8");
assert.match(dump, /Slot: 7\s*public abstract FieldEntity GetPlayerEntity\(\);/);
assert.match(dump, /private IEntityAccessor <entityAccessor>k__BackingField; \/\/ 0x90/);
const report = {
  kind: "event-context-branch-native", ...identity, dumpSha256: sha(dump),
  semanticsVerified: false, originalGameExecuted: false,
  methods: methods.map((method, index) => ({ ...method, sourceRange: ranges[index] })),
  rawRanges: ranges.slice(methods.length),
  interpretation: {
    character: "i0 source character; i1 present=0/absent=1; i2 current corps=0/enabled owned=1; i3 label",
    direction: "actual player slot7; north/east/south/west labels in i0..3; known zero vector selects south",
    flow: "JumpCommon/JumpTo then Next/ForwardStep: selected label+1, including label0",
  },
  limits: ["Static source evidence is not original-game execution", "Only complete Format.type1 operand forms are admitted",
    "Readonly owner snapshots and known cardinal/zero directions are required", "No story reachability or full-game parity claim"],
};
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ result: "pass", methods: methods.length, rawRanges: raw.length,
  semanticsVerified: false, originalGameExecuted: false }));
