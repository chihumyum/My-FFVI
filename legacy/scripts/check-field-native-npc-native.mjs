// Source-byte and prefab/scene checks; neither the original game nor Unity is run.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = root + "build/reports/field-native-npc-native-check.json";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const identity = {
  nativeSha256: "1a7e12c90c6a734e17dda507dd6ab7555090dff6a1e96f3473a90c29916ca6dc",
  symbolsSha256: "5067386c455a1b16e7bed8789859a41c10740bb7487303c3dafdb273cca26ef3",
  headerSha256: "71e6ec207e0faa50e38ab34628922cb78eaaff54747ffda7f410515f401fd718",
};
await mkdir(root + "build/reports", { recursive: true }); await rm(output, { force: true });
for (const [key, file] of Object.entries({ nativeSha256: "build/runtime/game/GameAssembly.dll",
  symbolsSha256: "build/native/il2cpp/script.json", headerSha256: "build/native/il2cpp/il2cpp_ghidra.h" }))
  assert.equal(sha(await readFile(root + file)), identity[key], file);
const symbols = JSON.parse(await readFile(root + "build/native/il2cpp/script.json", "utf8"));
const addresses = [...new Set(symbols.ScriptMethod.map((m) => m.Address))].sort((a, b) => a - b);
const batches = {
  "v33-native-map-hosts": ["e174d0", "e17a40", "309e30", "30b830", "304070", "9f3240"],
  "v33-field-host-details": ["579810", "43de80", "2c0040"],
  "v33-field-effect-control": ["351aa0"],
  "tile-binding": ["305420", "2d87a0"],
  "minimap-anchor": ["b27340"],
  "minimap": ["9f2700"],
  "npc-interaction": ["e171f0", "e17c80", "e18240"],
  "npc-controllers": ["5781b0", "57c7d0"],
  "map-lifecycle": ["3529b0", "352d90", "352fb0", "2ed6f0"],
  "map-entry": ["aafe70"],
  "v30-field-factories-complete": ["309d10"],
  "v30-field-render-factory": ["aeb200"],
  "v28-opening-primitives": ["2c6a30"],
  "v29-camera-coordinates-complete": ["2c26f0"],
  "v20-map-party-entry": ["879870"],
  "actor-dispatch": ["aeb570"],
  "v29-field-hosts": ["2d9b50"],
};
const methods = [], code = new Map();
for (const [batch, entries] of Object.entries(batches)) {
  const receipt = JSON.parse(await readFile(root + `build/native/${batch}/complete.json`, "utf8"));
  assert.equal(receipt.status, "complete"); assert.equal(receipt.semanticsVerified, false);
  for (const [key, value] of Object.entries(identity)) assert.equal(receipt[key], value, batch);
  for (const hex of entries) {
    const rva = "0x" + hex, rows = receipt.methods.filter((m) => m.rva === rva);
    assert.equal(rows.length, 1, rva);
    const method = rows[0], bytes = await readFile(root + `build/native/${batch}/${hex}.c`);
    assert.equal(sha(bytes), method.decompiledSha256, rva);
    assert.equal(Number(method.nextSymbolRva), addresses.find((a) => a > Number(rva)));
    methods.push({ batch, ...method }); code.set(hex, bytes.toString());
  }
}
const raw = [
  ["311400", "Last.Map.MapManager$$SetRootTransform"],
  ["311560", "Last.Map.MapManager$$SetStandbyEntityAnchor"],
  ["38dda0", "FieldMap$$CreateInstance"],
  ["57bcd0", "Last.Map.FieldNonPlayerController$$Init"],
  ["57d140", "Last.Map.FieldNonPlayerController$$.ctor"],
  ["580070", "Last.Map.FieldNonPlayerWaitController$$.ctor"],
  ["389c70", "Last.Map.FieldNonPlayerController$$get_IsMovingType"],
  ["e18410", "Last.Entity.Field.FieldNonPlayer$$.ctor"],
  ["e170d0", "Last.Entity.Field.FieldNonPlayer$$GetUpdateAttribute"],
  ["b294c0", "MapUtility$$TransformDirection"],
  ["87c5a0", "Last.Entity.Field.FieldCharaEntity$$.ctor"],
  ["aecb00", "Last.Entity.Field.FieldSpriteEntity$$.ctor"],
  ["2ca950", "Last.Interpreter.Instructions.Puppet.<>c__DisplayClass45_1$$<SetPos>b__0"],
  ["2c81f0", "Last.Interpreter.Instructions.Puppet$$.cctor"],
].map(([hex, name]) => {
  const rva = Number("0x" + hex);
  assert.ok(symbols.ScriptMethod.some((m) => m.Address === rva && m.Name === name), name);
  return { rva: "0x" + hex, name, size: addresses.find((a) => a > rva) - rva };
});
const python = String.raw`import sys,json,hashlib,capstone,struct
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
constants=[]
for rva in [0x16303ec,0x1630040]:
 section,offset,data=p.read(rva,4);constants.append(dict(rva=hex(rva),hex=data.hex(),value=struct.unpack('<f',data)[0]))
print(json.dumps(dict(ranges=out,constants=constants)))`;
const data = JSON.parse(execFileSync(root + ".venv/bin/python", ["-c", python, root], {
  input: JSON.stringify([...methods.map((m) => ({ rva: m.rva, size: Number(m.nextSymbolRva) - Number(m.rva) })), ...raw]),
  maxBuffer: 30 * 1024 * 1024,
}));
const range = (rva) => data.ranges.find((r) => r.rva === rva);
methods.forEach((m, i) => assert.equal(data.ranges[i].sha256, m.nativeRangeSha256, m.rva));
const has = (rva, mnemonic, operands) => assert.ok(range(rva).instructions.some((i) =>
  i.mnemonic === mnemonic && i.operands === operands), `${rva} ${mnemonic} ${operands}`);
assert.match(code.get("305420"), /case 6:[\s\S]*PropertyNpc[\s\S]*GetAssetStructure_30b830[\s\S]*CreateOutOfRangeMapPosition[\s\S]*CreateNonPlayer[\s\S]*SetProperty[\s\S]*FieldNonPlayer__Init/);
assert.match(code.get("305420"), /case 0x11:[\s\S]*PropertyNpc[\s\S]*FieldNonPlayer__Init/);
assert.match(code.get("e171f0"), /_28_Init.methodPtr[\s\S]*_68_InitAssetStructure.methodPtr/);
assert.match(code.get("e174d0"), /FieldCharaEntity__Init[\s\S]*initStartPosition[\s\S]*initLayer[\s\S]*initStartDirection/);
assert.match(code.get("2d9b50"), /if \(entityId == 0\)[\s\S]*return [^;]*scrollDummy;/);
assert.match(code.get("2d9b50"), /if \(0x7fffffff < \(uint\)entityId\)[\s\S]*GetResidentPartyEntityId/);
assert.match(code.get("2d9b50"), /entityList[\s\S]*_Property_k__BackingField[\s\S]*\(\*\(uint \*\)\(lVar2 \+ 0x20\) != entityId\)/);
assert.match(code.get("e18240"), /initStartPosition[\s\S]*_28_Init.methodPtr/);
assert.match(code.get("e17c80"), /updateAttribute = 2/);
// This decompiler casts the inherited property as PropertyEntity[]. Bind its
// byte offset to the actual PropertyNpc layout instead of trusting that alias.
has("0xe17c80", "cmp", "byte ptr [rdx + 0xf3], 0");
has("0xe17c80", "mov", "dword ptr [rdi + 0x208], 0xa");
assert.match(code.get("aeb200"), /SetupSpritesAnim/); assert.doesNotMatch(code.get("aeb200"), /PlayAnimation|CueAnimation|Random/);
assert.match(code.get("3529b0"), /allEntityGroupList/);
assert.match(code.get("352d90"), /SetActive\(__this_01,false/);
assert.match(code.get("2ed6f0"), /GetEntitiesEvent[\s\S]*SetEntitiesEnable[\s\S]*RegisterEntity[\s\S]*SetupNonPlayerControllerList/);
assert.match(code.get("579810"), /FactoryFieldNonPlayerController[\s\S]*_5_get_IsMovingType[\s\S]*_6_Init.methodPtr/);
assert.match(code.get("579810"), /_float___TypeInfo,\(__this_01->fields\)._size[\s\S]*UnityEngine_Random__Range/);
assert.match(code.get("aafe70"), /RegisterEntityWithoutDuplication[\s\S]*_10_GetUpdateAttribute[\s\S]*currentAttribute &/);
assert.match(code.get("b27340"), /_TilePos_k__BackingField[\s\S]*width \/ 2[\s\S]*iVar3 \/ 2/);
assert.match(code.get("309e30"), /standbyEntityAnchor[\s\S]*get_position/);
assert.match(code.get("304070"), /MapModel__Destroy/);
assert.match(code.get("351aa0"), /allEntityGroupList[\s\S]*Destroy/);
has("0x57bcd0", "call", "0xe18240"); has("0x57bcd0", "jmp", "0x57c7d0");
has("0x389c70", "xor", "al, al");
has("0x580070", "call", "0x57d140");
has("0x580070", "mov", "byte ptr [rbx + 0x64], 0");
has("0x57d140", "call", "0xb294c0");
has("0x57d140", "movzx", "eax, byte ptr [rbx + 0xf2]");
has("0x57d140", "mov", "byte ptr [rdi + 0x65], al");
assert.match(code.get("57c7d0"), /keepPreDirection[\s\S]*isTurnAround[\s\S]*isIdling == false[\s\S]*_41_LookAt/);
assert.match(code.get("879870"), /TransformDirection[\s\S]*_41_LookAt/);
assert.match(code.get("aeb570"), /SameAnimation[\s\S]*isPlay != false[\s\S]*return[\s\S]*_51_CueAnimation/);
assert.doesNotMatch(code.get("2d87a0"), /LookAt|CueAnimation|PlayAnimation/);
has("0xe170d0", "mov", "eax, dword ptr [rcx + 0x208]");
has("0xe18410", "mov", "dword ptr [rbx + 0x208], 2");
has("0x87c5a0", "jmp", "0xaecb00");
has("0x38dda0", "call", "0x311400");
has("0x311400", "call", "0x12ee5c0"); has("0x311560", "call", "0x12ee5c0");
assert.ok(range("0x311560").instructions.some((i) => i.references.includes(0x16303ec)));
assert.deepEqual(data.constants, [{ rva: "0x16303ec", hex: "0060ea46", value: 30000 },
  { rva: "0x1630040", hex: "000080bf", value: -1 }]);
// Ghidra's 43de80 PIC warning truncates its final write. Check the real tail.
has("0x43de80", "call", "0x1098f50"); has("0x43de80", "mov", "qword ptr [rbx], rax");
assert.ok(symbols.ScriptMethod.some((m) => m.Address === 0x1098f50 && m.Name === "System.String$$ToUpper"));
assert.ok(range("0xb294c0").instructions.some((i) => i.references.includes(0x1630040)));
assert.match(code.get("2c6a30"), /MoveEntityLayerWithWorldPosition[\s\S]*IsNullOrEmpty[\s\S]*SetPosCallback__Invoke/);
assert.match(code.get("2c26f0"), /GetChangeLayerValue[\s\S]*set_localPosition[\s\S]*if \(layer == 0\)[\s\S]*set_layer\(pUVar5,layer \+ 8/);
assert.match(code.get("2c26f0"), /0x18,_Last_Map_IEntityAccessor_TypeInfo[\s\S]*0x19,_Last_Map_IEntityAccessor_TypeInfo/);
assert.match(code.get("2c0040"), /request == 0[\s\S]*GetLayerByZOrder[\s\S]*iVar3 - 9U/);
assert.equal(range("0x2ca950").sha256, "b9c9beeb129ff35433f027d864b35bf70a403ff7ac2f2f446a28f29f740301eb");
assert.equal(range("0x2c81f0").sha256, "96a6cd6536296614ea661b4a69b15220ecf96728fc89dbfd5dbf8433978277a9");
const dump = await readFile(root + "build/native/il2cpp/dump.cs", "utf8");
const body = (name) => { const at = dump.indexOf(name); assert.ok(at >= 0); return dump.slice(at, dump.indexOf("\n// Namespace:", at + name.length)); };
assert.match(body("public class PropertyNpc :"), /<IsMoveWhileDisplayMessage>k__BackingField; \/\/ 0xF3/);
assert.match(body("public class PropertyEntity //"), /int <EntityId>k__BackingField; \/\/ 0x20/);
assert.match(body("public class FieldNonPlayer :"), /int updateAttribute; \/\/ 0x208/);
assert.doesNotMatch(body("public class FieldNonPlayerWaitController :"), /override.*(?:Init|IsMovingType|UpdateController|OnChangeViewType)/);
assert.match(body("public abstract class FieldNonPlayerController //"), /RVA: 0x2C8EF0[^\n]*Slot: 9\s+public virtual void OnChangeViewType/);
assert.doesNotMatch(body("public class FieldNonPlayer :"), /void (?:Awake|OnEnable|Start|OnAfterDeserialize)\(/);
assert.match(body("public class Mapobject :"), /RVA: 0x4A5D70[^\n]*\s+public string get_AssetName/);

const sceneFile = "FINAL FANTASY VI_Data/StreamingAssets/aa/StandaloneWindows64/scene_maingame_scenes_all_934d23f66ea5ce66932f11655d1e4899.bundle";
const sceneSha = "9b406d18f7e629a9cd224fdae27757897753554e5468fb7ee411baf8de8fe5c7";
assert.equal(sha(await readFile(root + "build/runtime/game/" + sceneFile)), sceneSha);
const scenePython = String.raw`import sys,json,UnityPy
env=UnityPy.load(sys.argv[1]);out=[]
for o in env.objects:
 if o.type.name!='MonoBehaviour':continue
 d=o.read_typetree()
 if 'mapRendererParent' not in d:continue
 assert o.read().m_Script.read().m_ClassName=='FieldMap'
 objects=o.assets_file.objects;go=objects[d['m_GameObject']['m_PathID']].read_typetree()
 transform=[objects[c['component']['m_PathID']] for c in go['m_Component'] if objects[c['component']['m_PathID']].type.name=='Transform'];assert len(transform)==1
 t=transform[0].read_typetree()
 out.append(dict(serializedFile=o.assets_file.name,component=str(o.path_id),gameObject=str(d['m_GameObject']['m_PathID']),name=go['m_Name'],transform=str(transform[0].path_id),position=t['m_LocalPosition'],rotation=t['m_LocalRotation'],scale=t['m_LocalScale'],parentFile=t['m_Father']['m_FileID'],parent=str(t['m_Father']['m_PathID'])))
print(json.dumps(out))`;
const scene = JSON.parse(execFileSync(root + ".venv/bin/python", ["-c", scenePython, root + "build/runtime/game/" + sceneFile]));
assert.deepEqual(scene, [{ serializedFile: "CAB-2551423dda0aad973a6f5a52774d59d7", component: "17", gameObject: "2", name: "RootObject", transform: "7",
  position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 }, parentFile: 0, parent: "0" }]);
const report = { kind: "field-native-npc-native", ...identity, dumpSha256: sha(dump),
  methods: methods.map((m, i) => ({ ...m, range: data.ranges[i] })), rawRanges: data.ranges.slice(methods.length), constants: data.constants,
  scene: { file: sceneFile, sha256: sceneSha, fieldRoots: scene }, originalGameExecuted: false, semanticsVerified: false,
  facts: ["Object kinds 6 and 17 create FieldNonPlayer using Mapobject asset and shadow metadata",
    "Raw object position is offset by mapRange origin before centered native placement; out-of-range uses the independent standby world transform",
    "Ordinary FieldMap root is identity and SetStandbyEntityAnchor sets local x/y to 30000",
    "Event groups are disabled and unregistered before activation; creation builds playback without selecting or playing a key",
    "First Wait activation reinitializes the saved initial pose; nonmoving Wait contributes no Random.Range or Guid permutation entries",
    "Controller Setup performs a second stopped LookAt when source turn_around is true, retaining authored next-pose selection",
    "NPC update attribute is 2 or 10 from move_while_display_message; no per-instance Unity Update/OnEnable host is invented",
    "GetFieldEntity returns scrollDummy for zero and special actors for negative selectors; positive lookup compares the map entity's source PropertyEntity.EntityId",
    "MapModel.Destroy disposes map-local group entities; party residents are a separate owner scope"],
  limits: ["Only first ordinary Wait activation is represented; repeated activation and autonomous controllers remain blocked",
    "Custom shadow, minimap, stencil, birdview and cross-layer NPC providers remain unresolved",
    "Native rendering parity and dynamic original-game behavior are not established by static source checks"] };
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ result: "pass", methods: methods.length, rawRanges: raw.length, sceneRoots: scene.length,
  originalGameExecuted: false, semanticsVerified: false }));
