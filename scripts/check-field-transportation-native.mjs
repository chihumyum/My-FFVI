// Re-read the supplied binary/metadata and existing complete exports. Static
// bindings are not original-game execution or a complete transportation host.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = root + "build/reports/field-transportation-native-check.json";
const sha = value => createHash("sha256").update(value).digest("hex");
const identity = {
  nativeSha256: "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
  symbolsSha256: "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3",
  headerSha256: "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718",
  metadataSha256: "9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45",
};
await mkdir(root + "build/reports", { recursive: true });
await rm(output, { force: true });
const files = {
  nativeSha256: "build/runtime/game/GameAssembly.dll",
  symbolsSha256: "build/native/il2cpp/script.json",
  headerSha256: "build/native/il2cpp/il2cpp_ghidra.h",
  metadataSha256: "build/runtime/game/FINAL FANTASY VI_Data/il2cpp_data/Metadata/global-metadata.dat",
};
for (const [key, path] of Object.entries(files)) assert.equal(sha(await readFile(root + path)), identity[key], path);
const symbols = JSON.parse(await readFile(root + files.symbolsSha256, "utf8"));
const addresses = [...new Set(symbols.ScriptMethod.map(method => method.Address))].sort((a, b) => a - b);
const bind = (rva, name) => assert.equal(symbols.ScriptMethod.filter(method =>
  method.Address === Number(rva) && method.Name === name).length, 1, name);
const batches = {
  "v19-transport-boarding": [
    ["2cb2b0", "Last.Interpreter.Instructions.External.Vehicle$$SetVehicle"],
    ["27a190", "Last.Interpreter.Instructions.SystemCall.Current$$GetOnMagitekArmor"],
  ],
  "v18-field-movement-callback": [["2cb0c0", "Last.Interpreter.Instructions.External.Vehicle$$RideVehicleNPC"]],
  "v19-transport-enable": [["2f1fe0", "Last.Map.FieldController$$TransportationEnabled"]],
  "v19-transport-entry": [["2d3e80", "Last.Map.FieldController$$ChangeTransportation"]],
  "v19-transport-initial": [["990fd0", "Last.Map.TransportationController$$ChangeTransportation"]],
  "v18-field-transport-final": [["2df020", "Last.Map.FieldController$$Last.Map.IEntityAccessor.RideOnTransportation"]],
  "v29-field-providers": [["2df400", "Last.Map.FieldController$$Last.Map.IEntityAccessor.RideOutTransportation"]],
  "v19-party-actor-riding": [["991bc0", "Last.Map.TransportationController$$Last.Map.ITransportation.SetupCharaAsset"]],
  "v19-party-actor-ride-on": [["87a500", "Last.Entity.Field.FieldCharaEntity$$RideOn"]],
};
const methods = [], code = new Map();
for (const [batch, entries] of Object.entries(batches)) {
  const receipt = JSON.parse(await readFile(root + `build/native/${batch}/complete.json`, "utf8"));
  assert.equal(receipt.status, "complete", batch); assert.equal(receipt.semanticsVerified, false, batch);
  for (const key of ["nativeSha256", "symbolsSha256", "headerSha256"]) assert.equal(receipt[key], identity[key], batch);
  for (const [hex, name] of entries) {
    const rva = "0x" + hex; bind(rva, name);
    const entries = receipt.methods.filter(method => method.rva === rva);
    assert.equal(entries.length, 1, rva);
    const method = entries[0], data = await readFile(root + `build/native/${batch}/${hex}.c`);
    assert.equal(Number(method.nextSymbolRva), addresses.find(address => address > Number(rva)), rva);
    assert.equal(sha(data), method.decompiledSha256, rva);
    assert.ok(data.toString().startsWith(`/* RVA ${rva}; ${method.name};`));
    methods.push({ batch, sourceName: name, ...method }); code.set(rva, data.toString());
  }
}

// String assignments and delegate registrations are independently bound by
// static-field offset. Labels alone never determine the wrapper arguments.
const wrappers = [
  ["GetOnShip", 0x27a230, 2, false, 0, 0x1fd56c0, 0x200fd50],
  ["GetOnChocobo", 0x279fb0, 3, false, 1, 0x1fd5688, 0x200fe70],
  ["GetOnChocoboBackground", 0x279f10, 3, true, 1, 0x1fd5650, 0x200fe18],
  ["GetOnBlackJack", 0x279e70, 4, false, 0, 0x1fd5618, 0x200fee0],
  ["GetOnBlackJackBackground", 0x279dd0, 4, true, 0, 0x1fd5608, 0x200fe98],
  ["GetOnFalcon", 0x27a0f0, 5, false, 0, 0x1fd55d8, 0x200fdd0],
  ["GetOnFalconBackground", 0x27a050, 5, true, 0, 0x1fd5580, 0x200fdc0],
  ["GetOnMagitekArmor", 0x27a190, 6, false, 0, 0x1fd5560, 0x200fd60],
  ["GetOnTranceTina", 0x27a2d0, 7, true, 0, 0x1fd5508, 0x200fcf0],
  ["GetOnBird", 0x279d30, 8, true, 0, 0x1fd54c8, 0x200ff18],
  ["GetOffTransportation", 0x279c90, 1, false, 0, 0x1fd54a8, 0x200ff88],
  ["GetOffTransportationBackground", 0x279bf0, 1, true, 0, 0x1fd5458, 0x200ff20],
];
const raw = wrappers.map(([shortName, address]) => {
  const rva = "0x" + address.toString(16), name = "Last.Interpreter.Instructions.SystemCall.Current$$" + shortName;
  bind(rva, name);
  return { rva, name, size: addresses.find(a => a > address) - address };
});
for (const [address, name] of [
  [0x2cb7c0, "Last.Interpreter.Instructions.External.Vehicle$$.cctor"],
  [0x87a4c0, "Last.Entity.Field.FieldCharaEntity$$ReturnRidingCharaAsset"],
]) {
  const rva = "0x" + address.toString(16); bind(rva, name);
  raw.push({ rva, name, size: addresses.find(a => a > address) - address });
}
bind("0x2a1e70", "Last.Interpreter.Instructions.SystemCall.Current$$.cctor");
raw.push(
  { rva: "0x2a1ea6", size: 0x2a209e - 0x2a1ea6, name: "Current.cctor reviewed selector assignments" },
  { rva: "0x2a52fa", size: 0x2a5671 - 0x2a52fa, name: "Current.cctor reviewed selector registrations" },
  { rva: "0x409ff0", size: 16, name: "shared return-0 stub" },
);
const python = String.raw`import sys,json,hashlib,capstone
from pathlib import Path
sys.path.insert(0,sys.argv[1]);from tools.native.inspect_pe import PEImage
p=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
cs=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64);cs.detail=True
out=[]
for r in json.load(sys.stdin):
 section,offset,data=p.read(int(r['rva'],0),r['size'])
 instructions=[]
 for i in cs.disasm(data,int(r['rva'],0)):
  refs=[hex(i.address+i.size+o.mem.disp) for o in i.operands if o.type==capstone.x86.X86_OP_MEM and o.mem.base==capstone.x86.X86_REG_RIP]
  instructions.append(dict(rva=hex(i.address),mnemonic=i.mnemonic,operands=i.op_str,refs=refs))
 out.append(dict(**r,section=section,fileOffset=offset,sha256=hashlib.sha256(data).hexdigest(),instructions=instructions))
print(json.dumps(out))`;
const ranges = JSON.parse(execFileSync(root + ".venv/bin/python", ["-c", python, root], {
  input: JSON.stringify([...methods.map(m => ({ rva: m.rva, size: Number(m.nextSymbolRva) - Number(m.rva) })), ...raw]),
  maxBuffer: 16 * 1024 * 1024,
}));
methods.forEach((method, index) => assert.equal(ranges[index].sha256, method.nativeRangeSha256, method.rva));
const instructions = rva => ranges.find(range => range.rva === rva).instructions;
const has = (rva, mnemonic, operands) => assert.ok(instructions(rva).some(i =>
  i.mnemonic === mnemonic && i.operands === operands), `${rva}: ${mnemonic} ${operands}`);
const hasRef = (rva, register, address) => assert.ok(instructions(rva).some(i => i.mnemonic === "mov" &&
  i.operands.startsWith(register + ", ") && i.refs.includes("0x" + address.toString(16))), `${rva}: ${register} reference ${address.toString(16)}`);
const text = rva => instructions(rva).map(i => `${i.mnemonic} ${i.operands}`).join("\n");
const immediate = value => value < 10 ? String(value) : "0x" + value.toString(16);
const assigned = instructions("0x2a1ea6"), registered = instructions("0x2a52fa");
const selectorBindings = wrappers.map(([name, address, transportationId, isBackground, viewType, stringAddress, methodAddress], index) => {
  const rva = "0x" + address.toString(16), staticOffset = index * 8;
  const label = symbols.ScriptString.filter(string => string.Address === stringAddress);
  assert.equal(label.length, 1, name);
  const metadata = symbols.ScriptMetadataMethod.filter(method => method.Address === methodAddress);
  assert.equal(metadata.length, 1, name);
  assert.equal(metadata[0].Name, `Method$Last.Interpreter.Instructions.SystemCall.Current.${name}()`);
  assert.equal(metadata[0].MethodAddress, address);
  has(rva, "mov", `r9d, ${transportationId}`);
  has(rva, "mov", `dword ptr [rsp + 0x30], ${viewType}`);
  has(rva, "mov", `byte ptr [rsp + 0x28], ${Number(isBackground)}`);
  has(rva, "mov", "byte ptr [rsp + 0x20], 1");
  has(rva, "lea", `ecx, [r9 + ${immediate(21 - transportationId)}]`);
  has(rva, "call", "0x4f390"); has(rva, "jmp", "0x409ff0");
  hasRef("0x2a1ea6", "rdx", stringAddress); hasRef("0x2a52fa", "r8", methodAddress);
  const assignmentIndex = assigned.findIndex(i => i.refs.includes("0x" + stringAddress.toString(16)));
  const assignmentEnd = assigned.findIndex((i, n) => n > assignmentIndex && i.mnemonic === "mov" && i.operands === "qword ptr [rcx], rdx");
  assert.ok(assignmentEnd > assignmentIndex);
  const additions = assigned.slice(assignmentIndex, assignmentEnd).filter(i => i.mnemonic === "add" && i.operands.startsWith("rcx, "));
  assert.deepEqual(additions.map(i => i.operands), staticOffset ? [`rcx, ${immediate(staticOffset)}`] : []);
  const registrationIndex = registered.findIndex(i => i.refs.includes("0x" + methodAddress.toString(16)));
  const load = registered.slice(0, registrationIndex).filter(i => i.mnemonic === "mov" && i.operands.startsWith("rdi, ")).at(-1);
  assert.equal(load?.operands, staticOffset ? `rdi, qword ptr [rcx + ${immediate(staticOffset)}]` : "rdi, qword ptr [rcx]");
  const registrationTail = registered.slice(registrationIndex, registrationIndex + 12);
  assert.ok(registrationTail.some(i => i.mnemonic === "call" && i.operands === "0x2ba1d0"));
  assert.ok(registrationTail.some(i => i.mnemonic === "call" && i.operands === "0x4e5f0"), name);
  return { selector: label[0].Value, method: name, rva, stringAddress, methodAddress, staticOffset,
    command: { kind: "change", transportationId, changeCollisionEnable: true, isBackground, viewType } };
});

const dump = await readFile(root + "build/native/il2cpp/dump.cs", "utf8");
const field = symbols.ScriptMetadata.filter(m => m.Address === 0x1fcc590);
assert.equal(field.length, 1); assert.equal(field[0].Name, "Field$<PrivateImplementationDetails>.BEEB24953FC8A8FB6F55F4F2C54FF3EB6C247757");
const offset = dump.match(/__StaticArrayInitTypeSize=16 BEEB24953FC8A8FB6F55F4F2C54FF3EB6C247757 \/\*Metadata offset (0x[0-9A-F]+)\*\//);
assert.ok(offset, "direction blob metadata identity");
const metadata = await readFile(root + files.metadataSha256), blobOffset = Number(offset[1]), blob = metadata.subarray(blobOffset, blobOffset + 16);
const directions = Array.from({ length: 4 }, (_, i) => blob.readInt32LE(i * 4));
assert.deepEqual(directions, [1, 2, 4, 8]);
has("0x2cb7c0", "mov", "edx, 4"); hasRef("0x2cb7c0", "rdx", 0x1fcc590);
has("0x2cb7c0", "call", "0xe5f1d0"); has("0x2cb7c0", "mov", "qword ptr [rcx], rbx");
has("0x2cb2b0", "mov", "edi, dword ptr [rax + 0x28]");
has("0x2cb2b0", "movd", "xmm2, dword ptr [rax + 0x2c]");
has("0x2cb2b0", "cvtdq2ps", "xmm2, xmm2"); has("0x2cb2b0", "cvtdq2ps", "xmm1, xmm1");
assert.match(code.get("0x2cb2b0"), /m_Items\[4\] \+ 8/);
assert.match(code.get("0x2cb2b0"), /m_Items\[5\] \* 4/);
assert.match(code.get("0x2cb2b0"), /FUN_18004f780\(7\)[\s\S]*get_layer/);
assert.match(code.get("0x2cb2b0"), /FUN_18004f690\(0x16,[\s\S]*iVar7,1,iVar1/);
assert.match(code.get("0x2cb0c0"), /m_Items\[0\] == 1[\s\S]*FUN_18004e800\(0x1d,[\s\S]*m_Items\[1\]/);
assert.match(code.get("0x2cb0c0"), /FUN_18004ebd0\(0x1c,[\s\S]*iVar4,pSVar1->m_Items\[0\]/);
assert.match(code.get("0x2f1fe0"), /SetDataStorageFlag[\s\S]*get_Position[\s\S]*set_Position/);
assert.match(code.get("0x2f1fe0"), /SetTransportationData[\s\S]*TransportationController__SetData/);
assert.match(code.get("0x2f1fe0"), /System_DateTime__get_Now[\s\S]*set_TimeStampTicks/);
assert.match(code.get("0x2f1fe0"), /SetStayMapId[\s\S]*SetGpsMonitor/);
assert.match(code.get("0x990fd0"), /_Enable_k__BackingField == false[\s\S]*oldTransport[\s\S]*return iVar6/);
assert.match(code.get("0x2d3e80"), /item == 0[\s\S]*LogError[\s\S]*return;/);
assert.match(code.get("0x2d3e80"), /CollisionEnable[\s\S]*ChangeTransportationCollisionEntity[\s\S]*SetupCurrentTransportMappingData[\s\S]*TransportationUploadData/);
assert.match(code.get("0x2d3e80"), /_9_ChangeEncount[\s\S]*PlayFieldBgmOrTransportationBgm[\s\S]*RemoveConditionFromCharacters/);
for (const rva of ["0x2df020", "0x2df400"]) assert.match(code.get(rva), /GetFieldEntity[\s\S]*FieldCharaEntity_TypeInfo[\s\S]*ArgumentException/);
assert.match(code.get("0x2df020"), /_AssetId_k__BackingField !=[\s\S]*_AssetId_k__BackingField[\s\S]*get_RideOnCharaAnimationStructure[\s\S]*SetAssetStructure/);
assert.match(code.get("0x2df400"), /ReturnRidingCharaAsset[\s\S]*_82_RideOut/);
has("0x87a4c0", "lea", "rbx, [rcx + 0x1a0]"); has("0x87a4c0", "call", "0xaec180");
assert.match(text("0x87a4c0"), /call 0xaec180[\s\S]*mov qword ptr \[rbx\], 0/);
assert.match(code.get("0x991bc0"), /_FrontStructure_k__BackingField ==[\s\S]*SetAssetStructure/);
assert.match(code.get("0x87a500"), /ridingAssetStructure = \(__this->fields\).super._AssetStructure_k__BackingField/);
has("0x409ff0", "xor", "eax, eax"); has("0x409ff0", "ret", "");
assert.ok(/ChangeTransportation\(int transportationId, bool changeCollisionEnable = True, bool isBackground = False, ViewType viewType = 0\)/.test(dump), "ChangeTransportation parameter roles");
const report = {
  kind: "field-transportation-native", ...identity, dumpSha256: sha(dump), semanticsVerified: false,
  originalGameExecuted: false, methods: methods.map((method, index) => ({ ...method, sourceRange: ranges[index] })),
  rawRanges: ranges.slice(methods.length), selectorBindings,
  directionTable: { field: field[0], metadataOffset: blobOffset, sha256: sha(blob), values: directions },
  interpreter: { placement: "i0 identity; i1 parking map; i2/i3 int-to-float position; i4=0 live player layer, otherwise +8; i5 direction index",
    npc: "i0=1 RideOut(i1), otherwise RideOn(i1,i0); missing/non-character target throws",
    completion: "Next after synchronous accessor invocation; syntax does not grant a runtime provider" },
  limits: ["No original-game replay", "Current selector cctor is verified only at the two cited raw ranges",
    "Complete ChangeTransportation has map/input/encounter/condition/audio/GPS side effects; this receipt is not a ready-host claim",
    "Disabled requests retain current identity but the caller still passes requested ID to several later effects",
    "Actual-player SetupCharaAsset and NPC same-outer optimization are different branches"],
};
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ result: "pass", methods: methods.length, rawRanges: raw.length,
  sourceSelectors: selectorBindings.length, semanticsVerified: false, originalGameExecuted: false }));
