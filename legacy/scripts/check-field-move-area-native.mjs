// Source identity/static method validation, not an original-game execution oracle.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url)),
  output = root + "build/reports/field-move-area-native-check.json",
  sha = (bytes) => createHash("sha256").update(bytes).digest("hex"),
  identity = {
    nativeSha256: "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
    symbolsSha256: "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3",
    headerSha256: "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718",
  };
await mkdir(root + "build/reports", { recursive: true }); await rm(output, { force: true });
for (const [key, path] of Object.entries({ nativeSha256: "build/runtime/game/GameAssembly.dll",
  symbolsSha256: "build/native/il2cpp/script.json", headerSha256: "build/native/il2cpp/il2cpp_ghidra.h" }))
  assert.equal(sha(await readFile(root + path)), identity[key], path);
const symbols = JSON.parse(await readFile(root + "build/native/il2cpp/script.json", "utf8")),
  addresses = [...new Set(symbols.ScriptMethod.map((m) => m.Address))].sort((a, b) => a - b),
  methods = [], code = new Map(), batches = {
    "v42-move-area": [
      ["9f3080", "Last.Map.PropertyMoveArea$$ConvertPropertyToData"],
      ["9f1cd0", "Last.Map.PropertyAreaObject$$ConvertPropertyToData"],
      ["578720", "Last.Map.FieldNonPlayerControllerManager$$GetPropertyMapArea"],
    ],
    "minimap": [["9f2700", "Last.Map.PropertyEntity$$ConvertPropertyToData"]],
    "minimap-anchor": [["b27340", "MapUtility$$ParseMapObjectGroupData"]],
    "tile-binding": [["305420", "Last.Map.MapManager$$CreateEntity"]],
    "v33-field-host-details": [["579810", "Last.Map.FieldNonPlayerControllerManager$$SetupNonPlayerControllerList"]],
    "npc-controllers": [["5781b0", "Last.Map.FieldNonPlayerControllerManager$$FactoryFieldNonPlayerController"]],
    "map-lifecycle": [["2ed6f0", "Last.Map.FieldController$$SetEventEntityGroup"]],
    "v19-transport-lifecycle": [["2e3d30", "Last.Map.FieldController$$MapSetup"]],
  };
for (const [batch, entries] of Object.entries(batches)) {
  const receipt = JSON.parse(await readFile(root + `build/native/${batch}/complete.json`, "utf8"));
  assert.equal(receipt.status, "complete"); assert.equal(receipt.semanticsVerified, false);
  for (const [key, value] of Object.entries(identity)) assert.equal(receipt[key], value, batch);
  for (const [hex, sourceName] of entries) {
    const rva = "0x" + hex, rows = receipt.methods.filter((m) => m.rva === rva);
    assert.equal(rows.length, 1); assert.equal(symbols.ScriptMethod.filter((m) => m.Address === Number(rva) && m.Name === sourceName).length, 1);
    const method = rows[0], bytes = await readFile(root + `build/native/${batch}/${hex}.c`);
    assert.equal(Number(method.nextSymbolRva), addresses.find((a) => a > Number(rva)));
    assert.equal(sha(bytes), method.decompiledSha256); assert.ok(bytes.toString().startsWith(`/* RVA ${rva}; ${method.name};`));
    methods.push({ batch, sourceName, ...method }); code.set(rva, bytes.toString());
  }
}
const clearRva = 0x577eb0;
assert.equal(symbols.ScriptMethod.filter((m) => m.Address === clearRva && m.Name === "Last.Map.FieldNonPlayerControllerManager$$Clear").length, 1);
const raw = [
  { rva: "0x577eb0", size: addresses.find((a) => a > clearRva) - clearRva, name: "FieldNonPlayerControllerManager.Clear" },
  { rva: "0x50c20", size: 0xc0, name: "nearest-even float rounding helper including final alignment byte" },
];
const python = String.raw`import sys,json,hashlib,capstone
from pathlib import Path
sys.path.insert(0,sys.argv[1]);from tools.native.inspect_pe import PEImage
p=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
cs=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64);out=[]
for r in json.load(sys.stdin):
 section,offset,data=p.read(int(r['rva'],0),r['size'])
 out.append(dict(**r,section=section,fileOffset=offset,sha256=hashlib.sha256(data).hexdigest(),instructions=[dict(rva=hex(i.address),mnemonic=i.mnemonic,operands=i.op_str) for i in cs.disasm(data,int(r['rva'],0))]))
print(json.dumps(out))`;
const ranges = JSON.parse(execFileSync(root + ".venv/bin/python", ["-c", python, root], {
  input: JSON.stringify([...methods.map((m) => ({ rva: m.rva, size: Number(m.nextSymbolRva) - Number(m.rva) })), ...raw]),
  maxBuffer: 12 * 1024 * 1024,
}));
methods.forEach((m, i) => assert.equal(ranges[i].sha256, m.nativeRangeSha256, m.rva));
const has = (rva, mnemonic, operands) => assert.ok(ranges.find((r) => r.rva === rva).instructions.some((i) =>
  i.mnemonic === mnemonic && i.operands === operands), `${rva} ${mnemonic} ${operands}`);
// Avoid the decompiler's omitted x64 float arguments: Size and MoveArea width
// really read source original dimensions, not optional custom width/height.
has("0x9f2700", "movd", "xmm2, dword ptr [r14 + 0xe4]");
has("0x9f2700", "movd", "xmm1, dword ptr [r14 + 0xe0]");
has("0x9f3080", "movd", "xmm3, dword ptr [rbx + 0xe0]");
has("0x9f3080", "movd", "xmm6, dword ptr [rbx + 0xe4]");
has("0x9f3080", "movss", "dword ptr [rsp + 0x20], xmm6");
has("0x577eb0", "mov", "rcx, qword ptr [rbx + 0x18]");
has("0x577eb0", "call", "0xbc3c00");
has("0x50c20", "test", "al, 1");
assert.match(code.get("0x305420"), /case 0xd:[\s\S]*PropertyMoveArea_TypeInfo[\s\S]*mapObjectMoveAreaPrefab/);
assert.match(code.get("0x579810"), /propertyMoveAreaList[\s\S]*Add_1450a80\(pSVar9,pLVar7/);
assert.doesNotMatch(code.get("0x579810"), /propertyMoveAreaList[\s\S]*__Clear/);
assert.match(code.get("0x578720"), /_ObjectId_k__BackingField != linkObject/);
assert.match(code.get("0x578720"), /UnityEngine_Debug__LogError/);
assert.match(code.get("0x5781b0"), /FieldNonPlayerWaitController_TypeInfo/);
assert.match(code.get("0x5781b0"), /GetPropertyMapArea/);
assert.match(code.get("0x2ed6f0"), /SetupCurrentPropertyList[\s\S]*SetupNonPlayerControllerList\s*\(pLVar6,entityList,/);
assert.match(code.get("0x2e3d30"), /FieldNonPlayerControllerManager__Clear[\s\S]*SetupNonPlayerControllerList/);
const dump = await readFile(root + "build/native/il2cpp/dump.cs", "utf8");
assert.match(dump, /MoveArea = 13;/);
assert.match(dump, /List<PropertyMoveArea> propertyMoveAreaList; \/\/ 0x18/);
const report = { kind: "field-move-area-native", ...identity, dumpSha256: sha(dump),
  semanticsVerified: false, originalGameExecuted: false,
  methods: methods.map((m, i) => ({ ...m, sourceRange: ranges[i] })), rawRanges: ranges.slice(methods.length),
  interpretation: {
    identity: "ObjectType 13 creates PropertyMoveArea; its ObjectId, not EntityId, is the autonomous-controller link key",
    geometry: "CellArea rounds relative pixel coordinates and original dimensions divided by 16; MoveArea uses source world position minus half original dimensions",
    lifecycle: "MapSetup clears the controller manager; each SetEventEntityGroup appends only that new group's areas; queries preserve first ObjectId match",
    consumer: "Wait does not consume a region; AreaMove requires its own currently unsupported controller",
  }, limits: ["Static source bindings are not original-game execution parity", "No autonomous NPC movement or script actor capability is granted"] };
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ result: "pass", methods: methods.length, rawRanges: raw.length, semanticsVerified: false, originalGameExecuted: false }));
