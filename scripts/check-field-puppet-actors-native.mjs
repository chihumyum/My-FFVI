// Static, source-bound evidence. This checker never executes the original game.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = root + "build/reports/field-puppet-actors-native-check.json";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
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
const addresses = [...new Set(symbols.ScriptMethod.map((m) => m.Address))].sort((a, b) => a - b);
const bind = (rva, name) => assert.equal(symbols.ScriptMethod.filter((m) => m.Address === Number(rva) && m.Name === name).length, 1, name);
const batches = {
  "event-operators": [["5f2530", "Last.Interpreter.Integrator$$Execute"]],
  "v28-puppet-lifecycle": [["5f40c0", "Last.Interpreter.Integrator$$PuppetCoreEntry"]],
  "v28-puppet-finalize": [["5f2e90", "Last.Interpreter.Integrator$$InitializePlayerPuppetEntities"],
    ["5f3d90", "Last.Interpreter.Integrator$$IsMapScriptOfWorldMap"]],
  "v29-field-hosts": [
    ["5f2a80", "Last.Interpreter.Integrator$$GetPartyLeaderPuppetEntityID"],
    ["5f4050", "Last.Interpreter.Integrator$$PlayerPuppetIsToBeKept"],
    ["5f2010", "Last.Interpreter.Integrator$$CopyEntityLayer"],
    ["5f60e0", "Last.Interpreter.Integrator.PartyPuppetAssignment$$Assign"],
    ["2db030", "Last.Map.FieldController$$GetPartyLeaderAssetIdWithCondition"],
    ["2db630", "Last.Map.FieldController$$GetResidentPartyEntityId"],
    ["2d9b50", "Last.Map.FieldController$$GetFieldEntity"],
    ["5f2ca0", "Last.Interpreter.Integrator$$InitCameraDummy"],
  ],
  "v29-field-providers": [
    ["2df5f0", "Last.Map.FieldController$$Last.Map.IEntityAccessor.SwitchTransparentBody"],
    ["2d1730", "Last.Map.FieldController$$ApplyMainViewCustomPropertiesToEntity"],
    ["2d17a0", "Last.Map.FieldController$$AttachTransparentTexture"],
    ["2df400", "Last.Map.FieldController$$Last.Map.IEntityAccessor.RideOutTransportation"],
  ],
  "v29-field-following": [["2db390", "Last.Map.FieldController$$GetPickupCharacterIndex"]],
  "v29-puppet-opaque": [
    ["40acc0", "Serial.FF6.Map.TransportationEvent$$.ctor"],
    ["878fd0", "Last.Entity.Field.FieldCharaEntity$$ConversionOpaqueBody"],
    ["878af0", "Last.Entity.Field.FieldCharaEntity$$AttachTransparentTexture"],
  ],
  "v18-condition-appearance": [["9e2e90", "Last.Map.ConditionAssetControl$$GetConditionData"]],
  "v28-field-visibility-collision": [
    ["2ee1c0", "Last.Map.FieldController$$SetMapColliderEnabled"],
    ["2ed3a0", "Last.Map.FieldController$$SetEntityCollisionEnabled"],
    ["2ee190", "Last.Map.FieldController$$SetInteractiveTargetObservationEnabled"],
  ],
};
const methods = [], code = new Map();
for (const [batch, entries] of Object.entries(batches)) {
  const receipt = JSON.parse(await readFile(root + `build/native/${batch}/complete.json`, "utf8"));
  assert.equal(receipt.status, "complete"); assert.equal(receipt.semanticsVerified, false);
  for (const [key, value] of Object.entries(identity)) assert.equal(receipt[key], value);
  for (const [hex, name] of entries) {
    const rva = "0x" + hex; bind(rva, name);
    const matches = receipt.methods.filter((m) => m.rva === rva); assert.equal(matches.length, 1, rva);
    const method = matches[0], bytes = await readFile(root + `build/native/${batch}/${hex}.c`);
    assert.equal(Number(method.nextSymbolRva), addresses.find((a) => a > Number(rva)));
    assert.equal(sha(bytes), method.decompiledSha256, rva);
    assert.ok(bytes.toString().startsWith(`/* RVA ${rva}; ${method.name};`));
    methods.push({ batch, sourceName: name, ...method }); code.set(rva, bytes.toString());
  }
}
const raw = [
  ["5f62f0", "Last.Interpreter.Integrator.PartyPuppetAssignment$$ToIndex"],
  ["2db620", "Last.Map.FieldController$$GetPlayerPuppetEntity"],
  ["2db170", "Last.Map.FieldController$$GetPartyPuppetEntity"],
  ["350f70", "Last.Map.FieldController.<>c__DisplayClass306_0$$<GetResidentPartyEntityId>b__0"],
  ["58cb00", "Last.Map.FieldController.<>c__DisplayClass306_0$$<GetResidentPartyEntityId>b__1"],
  ["55de90", "Last.Map.FieldController.<>c$$<GetResidentPartyEntityId>b__306_3"],
  ["530160", "Last.Data.User.OwnedCharacterData$$get_characterStatusId"],
  ["52ffc0", "Last.Data.User.OwnedCharacterData$$get_Id"],
  ["871840", "Last.Management.UserDataManager$$GetOwnedCharactersClone"],
  ["9e30f0", "Last.Map.ConditionAssetControl$$SearchConditionCharacterId"],
  ["6d2100", "Serial.Template.Map.TransportationEvent$$IsSemiTransparentBody"],
  ["87a4c0", "Last.Entity.Field.FieldCharaEntity$$ReturnRidingCharaAsset"],
  ["87a680", "Last.Entity.Field.FieldCharaEntity$$RideOut"],
  ["491610", "Last.Data.User.Corps$$get_CharacterId"],
].map(([hex, name]) => {
  const rva = "0x" + hex; bind(rva, name);
  return { rva, name, size: addresses.find((a) => a > Number(rva)) - Number(rva) };
});
const python = String.raw`import sys,json,hashlib,capstone
from pathlib import Path
sys.path.insert(0,sys.argv[1]);from tools.native.inspect_pe import PEImage
p=PEImage((Path(sys.argv[1])/'build/runtime/game/GameAssembly.dll').read_bytes())
md=capstone.Cs(capstone.CS_ARCH_X86,capstone.CS_MODE_64);md.detail=True
out=[]
for r in json.load(sys.stdin):
 section,offset,data=p.read(int(r['rva'],0),r['size']);instructions=[]
 for i in md.disasm(data,int(r['rva'],0)):
  refs=[i.address+i.size+o.mem.disp for o in i.operands if o.type==capstone.x86.X86_OP_MEM and o.mem.base==capstone.x86.X86_REG_RIP]
  instructions.append(dict(rva=hex(i.address),mnemonic=i.mnemonic,operands=i.op_str,references=refs))
 out.append(dict(**r,section=section,fileOffset=offset,sha256=hashlib.sha256(data).hexdigest(),instructions=instructions))
print(json.dumps(out))`;
const ranges = JSON.parse(execFileSync(root + ".venv/bin/python", ["-c", python, root], {
  input: JSON.stringify([...methods.map((m) => ({ rva: m.rva, size: Number(m.nextSymbolRva) - Number(m.rva) })), ...raw]),
  maxBuffer: 40 * 1024 * 1024,
}));
methods.forEach((m, i) => assert.equal(ranges[i].sha256, m.nativeRangeSha256, m.rva));
const range = (rva) => ranges.find((r) => r.rva === rva);
const has = (rva, mnemonic, operands) => assert.ok(range(rva).instructions.some((i) => i.mnemonic === mnemonic && i.operands === operands), `${rva} ${mnemonic} ${operands}`);
has("0x5f62f0", "mov", "eax, 0xfffffc17"); has("0x5f62f0", "sub", "eax, edx");
has("0x2db620", "jmp", "0x2db170"); has("0x2db170", "call", "0x2db390");
has("0x58cb00", "call", "0x530160"); has("0x55de90", "jmp", "0x52ffc0");
has("0x530160", "mov", "eax, dword ptr [rax + 0x14]");
has("0x52ffc0", "mov", "eax, dword ptr [rax + 0x10]");
has("0x491610", "mov", "rax, qword ptr [rcx + 0x10]");
has("0x491610", "mov", "eax, dword ptr [rax + 0x14]");
has("0x871840", "call", "0x52ffe0");
has("0x9e30f0", "call", "0x9e2e90");
has("0x6d2100", "cmp", "esi, 9");
has("0x6d2100", "call", "qword ptr [rax + 0x190]");
has("0x6d2100", "call", "qword ptr [rax + 0x180]");
has("0x87a4c0", "call", "0xaec180");
has("0x87a680", "jmp", "0xe1c970");
assert.match(code.get("0x5f2530"), /isSkipInitialize[\s\S]*keepPlayerPuppet[\s\S]*keepBadStatusVisual[\s\S]*ridingVehicle/);
assert.match(code.get("0x5f2e90"), /InitCameraDummy[\s\S]*GetPartyLeaderPuppetEntityID/);
assert.match(code.get("0x5f2e90"), /_29_OverwriteEntityPosition/);
assert.match(code.get("0x5f2010"), /set_layer[\s\S]*FUN_18004e940\(0x18,[\s\S]*0x19/);
const header = await readFile(root + "build/native/il2cpp/il2cpp_ghidra.h", "utf8");
assert.ok(/_172_ApplyMainViewCustomPropertiesToEntity;\s*VirtualInvokeData _173_AttachTransparentTexture;/.test(header));
const dump = await readFile(root + "build/native/il2cpp/dump.cs", "utf8");
assert.ok(/Slot: 24\s*public abstract void ApplyMainViewCustomPropertiesToEntity\(FieldEntity e\);/.test(dump));
assert.ok(/Slot: 25\s*public abstract void AttachTransparentTexture\(FieldEntity e\);/.test(dump));
assert.match(code.get("0x2db630"), /OrderByDescending/);
assert.match(code.get("0x2d9b50"), /companionPuppetEntity/);
assert.match(code.get("0x2df400"), /ReturnRidingCharaAsset[\s\S]*RideOut/);
assert.match(code.get("0x2df5f0"), /SwitchTransparentBody[\s\S]*WorldPositionToCellPosition[\s\S]*IsSemiTransparentBody/);
assert.match(code.get("0x40acc0"), /pSVar6,10,[\s\S]*pSVar6,0xb,[\s\S]*pSVar6,0xc,[\s\S]*pSVar6,0xd,[\s\S]*_RiverFootAttribute/);
assert.match(code.get("0x40acc0"), /pSVar6,9,[\s\S]*pSVar6,0x1e,[\s\S]*_ForestFootAttribute/);
assert.match(code.get("0x2ee1c0"), /GetBaseLayer\(pMVar3,9/);
assert.match(code.get("0x2ee1c0"), /GetBaseLayer\(pMVar3,10/);
assert.match(code.get("0x2ee1c0"), /GetBaseLayer\(pMVar3,0xb/);
assert.match(code.get("0x2ed3a0"), /companionPuppetEntity[\s\S]*SetCollisionEnabled/);
assert.match(code.get("0x2ee190"), /isObserving = enabled/);
const metadata = await readFile(root + "build/runtime/game/FINAL FANTASY VI_Data/il2cpp_data/Metadata/global-metadata.dat");
assert.equal(sha(metadata), "9b426d617a022020feee61cdfc19b16ce1a51c07542fe1dd59169e12f35a3e45");
const puppetArray = metadata.subarray(0x4deeca, 0x4deeca + 24);
assert.equal(createHash("sha1").update(puppetArray).digest("hex"), "6b372126e9c5fbed78423e63cf29ef67f92b43b5");
const sourcePuppetIds = Array.from({ length: 6 }, (_, i) => puppetArray.readInt32LE(i * 4));
assert.deepEqual(sourcePuppetIds, [-1001, -1002, -1003, -1004, -1005, -1010]);
const materialStrings = ["_ConversionSemiTransparentAlpha", "_OneUpTex", "_TwoUpTex", "_ApplyOneUpTex", "_ApplyTwoUpTex"]
  .map((value) => {
    const items = symbols.ScriptString.filter((item) => item.Value === value); assert.equal(items.length, 1, value);
    const owner = value === "_ConversionSemiTransparentAlpha" ? "0x878fd0" : "0x878af0";
    assert.ok(range(owner).instructions.some((i) => i.references.includes(items[0].Address)), value);
    return items[0];
  });
const report = { kind: "field-puppet-actors-native", ...identity, metadataSha256: sha(metadata),
  dumpSha256: sha(dump),
  semanticsVerified: false, originalGameExecuted: false,
  methods: methods.map((m, i) => ({ ...m, sourceRange: ranges[i] })), rawRanges: ranges.slice(methods.length),
  sourcePuppetIds, materialStrings,
  limits: ["Static source evidence is not an original-game behavioral oracle", "Ghidra inline tails are not negative evidence; raw ranges stop at next distinct symbol",
    "Ordinary same-map/same-layer opaque and already-unmounted effects only; special material/riding transitions remain gated",
    "Exec callback absence and actor factory initialization must be established by each trusted runtime host"] };
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ result: "pass", methods: methods.length, rawRanges: raw.length,
  metadataPuppetIds: sourcePuppetIds.length, semanticsVerified: false, originalGameExecuted: false }));
